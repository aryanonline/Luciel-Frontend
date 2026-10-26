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
  syncJob?: KnowledgeSyncJob | null;
}

export interface AwaitSyncJobOptions {
  /** The connection being synced (the row `read` looks up). */
  connectionId: string;
  /** Read the connection's served row; undefined = the connection is gone. */
  read: () => Promise<SyncJobRow | undefined>;
  /**
   * The job this call started (the 202's `startedAt`). A job on the row that started
   * EARLIER is a previous run's record, never this one's outcome — keep polling.
   */
  startedAt?: string;
  intervalMs?: number;
  maxMs?: number;
}

/** The copy when the poll gives up: the job is still running server-side. */
export const STILL_SYNCING_MESSAGE =
  'Still syncing — it will finish on its own. Check this source in a minute.';

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
      throw new LucielApiError({ code: 'not_found', message: 'Connection not found.' });
    }
    const job = row?.syncJob;
    const current =
      job &&
      (Number.isNaN(since) || Number.isNaN(time(job.startedAt)) || time(job.startedAt) >= since);
    if (job && current && FINISHED.has(job.state)) return settle(job);
    if (Date.now() + intervalMs > deadline) {
      throw new LucielApiError({ code: 'service_unavailable', message: STILL_SYNCING_MESSAGE });
    }
    await sleep(intervalMs);
  }
}
