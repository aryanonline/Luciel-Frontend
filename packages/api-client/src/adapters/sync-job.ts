import { LucielApiError } from '../schemas';
import type { KnowledgeSyncJob, KnowledgeSyncResult, KnowledgeSyncStarted } from '../schemas';

/**
 * A knowledge sync that outlives the server's inline wait (round 7 — the asynchronous
 * crawl, Arch §3.2.3 follow-up). POST /knowledge/sync-connections/{id}/sync answers 200
 * with the SyncResult when the sync finishes inside the server's 20 s wait, and 202
 * `{connectionId, state: 'syncing', startedAt}` when it is still running. A crawl of a
 * multi-page site used to run inside the request and cross the load balancer's 60 s
 * idle timeout (live walk run 8, 2026-10-25: an ALB 504 with no CORS headers, read by
 * the browser as a network failure, while the crawl went on finishing server-side).
 *
 * `awaitSyncJob` turns the 202 back into the caller's contract — the same
 * `Promise<KnowledgeSyncResult>` and the same typed errors a synchronous sync gave —
 * by re-reading the connection's served `syncJob` until it leaves `syncing`. The
 * mock adapter resolves its deferred syncs through this SAME helper.
 */

/** A row the poll reads: a connection (either list) carrying its last sync job. */
export interface SyncJobRow {
  status?: string;
  syncJob?: KnowledgeSyncJob | null;
}

export interface AwaitSyncJobOptions {
  /** The connection being synced (the row `read` looks up). */
  connectionId: string;
  /** Read the connection's served row; undefined = the connection is gone. */
  read: () => Promise<SyncJobRow | undefined>;
  /**
   * The job this call started (the 202's `startedAt`, which the row's job carries
   * exactly). A job that started EARLIER is a previous run's record — keep polling. A
   * LATER one means this job ended and its record was replaced — stop: its outcome is
   * no longer on the row, and the later job's outcome is not this call's.
   */
  startedAt?: string;
  intervalMs?: number;
  maxMs?: number;
}

/** The copy when the poll gives up: the job is still running server-side. */
export const STILL_SYNCING_MESSAGE =
  'Still syncing — it will finish on its own. Check this source in a minute.';

/** Our job's record was replaced by a later job's. */
export const SYNC_TAKEN_OVER_MESSAGE =
  'Another sync of this source took over — Connected sources shows how it ends.';

/** The server's own words when a source goes during its sync (the 409 of the same fact). */
export const SYNC_REMOVED_MESSAGE =
  'This source was removed while it was syncing — nothing from that sync was kept.';

/** Our job's record was cleared because the source went back to connected. */
export const SYNC_RECONNECTED_MESSAGE =
  'This source was reconnected while it was syncing — Connected sources shows where it stands.';

/** The job finished but the read that follows it failed: its data is committed. */
export const SYNC_FINISHED_UNREAD_MESSAGE =
  'The sync finished, but we could not read the result just now. Reload this page to see it.';

/** The marker no server answer carries: this client stopped watching, nothing failed. */
const SYNC_STILL_RUNNING_REASON = 'sync_still_running';

/** The marker of a sync that ended because its source went: an outcome, not a fault. */
const SYNC_REMOVED_REASON = 'sync_removed';

const stoppedWatching = (message: string) =>
  new LucielApiError({
    code: 'service_unavailable',
    reason: SYNC_STILL_RUNNING_REASON,
    message,
  });

/**
 * True only for the poll's own give-up. A real 503 from the server has the same code
 * (embedding outage, "The sync failed before it finished…") and IS a failure, so the
 * code alone must never be read as "still running".
 */
export const isSyncStillRunning = (err: unknown): err is LucielApiError =>
  err instanceof LucielApiError && err.reason === SYNC_STILL_RUNNING_REASON;

/**
 * True when the poll found the source removed: the sync stopped and kept nothing. It is
 * how that sync ended, not a failure of anything, and very often what the owner just asked
 * for, so it is never reported as an error.
 */
export const isSyncRemoved = (err: unknown): err is LucielApiError =>
  err instanceof LucielApiError && err.reason === SYNC_REMOVED_REASON;

const sourceRemoved = () =>
  new LucielApiError({
    code: 'conflict',
    reason: SYNC_REMOVED_REASON,
    message: SYNC_REMOVED_MESSAGE,
  });

/** True when a sync answer is the 202 "still running" body rather than a SyncResult. */
export const isSyncStarted = (body: unknown): body is KnowledgeSyncStarted =>
  typeof body === 'object' &&
  body !== null &&
  (body as { state?: unknown }).state === 'syncing' &&
  !Array.isArray((body as { added?: unknown }).added);

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const time = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? NaN : t;
};

/** The finished job's outcome, in the synchronous sync's shape (arrays default []). */
function settle(job: KnowledgeSyncJob): KnowledgeSyncResult {
  if (job.state === 'synced') {
    const r = job.result ?? {};
    const out: KnowledgeSyncResult & { refused?: string[] } = {
      added: strings(r.added),
      updated: strings(r.updated),
      removed: strings(r.removed),
    };
    // The quota's refusals ride the SyncResult today too (SyncResultOut.refused).
    if (Array.isArray(r.refused)) out.refused = strings(r.refused);
    // A run the Luciel's pause or delete halted wrote nothing: "0 added" would mislead.
    if (typeof r.halted === 'string' && r.halted) out.halted = r.halted;
    return out;
  }
  if (job.state === 'shrink_pending') {
    // The confirm-shrink UI keys on a `conflict` carrying the server's sentence.
    throw new LucielApiError({
      code: 'conflict',
      message: job.error || 'The source shrank, so nothing was removed. Sync again to confirm.',
    });
  }
  const message = job.error || 'The sync failed. Nothing was changed — please try again.';
  throw new LucielApiError({
    code: message.startsWith('Sync unavailable') ? 'conflict' : 'server_error',
    message,
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The states that end a job; anything else (syncing, or a state this client does
 *  not know yet) is still running as far as the owner is concerned. */
const FINISHED = new Set<string>(['synced', 'shrink_pending', 'failed']);

export async function awaitSyncJob({
  read,
  startedAt,
  intervalMs = 2000,
  maxMs = 10 * 60_000,
}: AwaitSyncJobOptions): Promise<KnowledgeSyncResult> {
  const deadline = Date.now() + maxMs;
  const since = time(startedAt);
  for (;;) {
    let row: SyncJobRow | undefined;
    let readOk = true;
    try {
      row = await read();
    } catch (err) {
      // A session that ended mid-poll is the caller's to route; a one-off failed read
      // is not the sync's outcome — the next poll asks again.
      if (err instanceof LucielApiError && err.code === 'unauthorized') throw err;
      readOk = false;
    }
    if (readOk && row === undefined) {
      // Both lists leave a revoked row out, so after a 202 a missing row IS the source
      // having gone. The sync stopped with it and kept nothing.
      if (!Number.isNaN(since)) throw sourceRemoved();
      throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
    }
    const job = row?.syncJob;
    if (job) {
      const at = time(job.startedAt);
      const comparable = !Number.isNaN(since) && !Number.isNaN(at);
      if (comparable && at > since) throw stoppedWatching(SYNC_TAKEN_OVER_MESSAGE);
      if ((!comparable || at === since) && FINISHED.has(job.state)) return settle(job);
    } else if (row && !Number.isNaN(since)) {
      // The 202 was answered after the job was on the row, so an empty row means the
      // record was cleared: the source was removed (the sync stopped, nothing kept) or
      // went back to connected. Waiting on would only end in a false "Still syncing".
      if (row.status === 'not_connected') throw sourceRemoved();
      throw stoppedWatching(SYNC_RECONNECTED_MESSAGE);
    }
    if (Date.now() + intervalMs > deadline) throw stoppedWatching(STILL_SYNCING_MESSAGE);
    await sleep(intervalMs);
  }
}

/**
 * A read that follows a finished job. The job's data is already committed, so a failed
 * read is never the sync's outcome: it asks again and, if the read stays down, stops
 * watching with an honest "finished" rather than reporting a failed sync. An ended
 * session is still the caller's to route.
 */
export async function readAfterSync<T>(
  read: () => Promise<T>,
  { attempts = 3, intervalMs = 2000 }: { attempts?: number; intervalMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (err) {
      if (err instanceof LucielApiError && err.code === 'unauthorized') throw err;
      if (attempt >= attempts) throw stoppedWatching(SYNC_FINISHED_UNREAD_MESSAGE);
    }
    await sleep(intervalMs);
  }
}
