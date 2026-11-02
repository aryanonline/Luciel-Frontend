import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createLucielClient } from '../index';
import { LucielApiError } from '../schemas';
import {
  STILL_SYNCING_MESSAGE,
  SYNC_RECONNECTED_MESSAGE,
  SYNC_FINISHED_UNREAD_MESSAGE,
  SYNC_REMOVED_MESSAGE,
  SYNC_TAKEN_OVER_MESSAGE,
  awaitSyncJob,
  isSyncRemoved,
  isSyncStillRunning,
  readAfterSync,
} from '../adapters/sync-job';

/**
 * The asynchronous crawl (round 7; Arch §3.2.3 "making it asynchronous is a tracked
 * follow-up"). Live walk run 8 (2026-10-25): a crawl of the 8-page marketing site ran
 * inside POST …/sync for over 60 s, the load balancer answered a 504 with no CORS
 * headers and the browser reported "Network request failed." while the crawl went on.
 * The server now answers 202 {connectionId, state: 'syncing', startedAt} when a sync
 * outlives its 20 s inline wait; `knowledge.syncConnection` keeps its contract by
 * polling the served `syncJob` on GET /knowledge/sync-connections.
 */

const BASE_URL = 'https://api.example.com';
const CONN = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const STARTED = '2026-10-25T22:27:35.000Z';
const SHRINK =
  'The source now reports 1 item(s) where 4 are synced, so nothing was removed. If you did remove them at the source, sync again and confirm the shrink.';

type Job = Record<string, unknown> | null;

/** A server: the POST answers `post`; each GET serves the next job (the last repeats). */
function stubServer(post: { status: number; body: unknown }, jobs: Job[], status = 'connected') {
  const calls: { method: string; url: string }[] = [];
  let reads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (method === 'POST') {
      return new Response(JSON.stringify(post.body), {
        status: post.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    const job = jobs[Math.min(reads, jobs.length - 1)] ?? null;
    reads += 1;
    // As the server's list: a revoked row is not served.
    const rows = [
      { connectionId: OTHER, provider: 'notion', status: 'connected', syncJob: null },
      { connectionId: CONN, provider: 'website_crawl', status, syncJob: job },
    ].filter((r) => r.status !== 'revoked');
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

const accepted = {
  status: 202,
  body: { connectionId: CONN, state: 'syncing', startedAt: STARTED },
};
const syncing: Job = { state: 'syncing', startedAt: STARTED };
const client = () => createLucielClient({ adapter: 'http', baseUrl: BASE_URL });

/** Run the sync while the fake clock moves on, so every 2 s poll gets to fire. */
async function settle<T>(p: Promise<T>, ms = 20_000): Promise<T> {
  const caught = p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  await vi.advanceTimersByTimeAsync(ms);
  const r = await caught;
  if (r.ok) return r.v;
  throw r.e;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T22:27:36.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a sync that finishes inside the inline wait (200)', () => {
  it('returns the SyncResult as served, with no poll', async () => {
    const server = stubServer(
      { status: 200, body: { added: ['a'], updated: [], removed: [] } },
      [],
    );
    await expect(client().knowledge.syncConnection(CONN)).resolves.toEqual({
      added: ['a'],
      updated: [],
      removed: [],
    });
    expect(server.calls).toHaveLength(1);
  });
});

describe('a sync still running (202)', () => {
  it('polls the served syncJob until synced and returns its result; the POST is sent once', async () => {
    const server = stubServer(accepted, [
      syncing,
      syncing,
      {
        state: 'synced',
        startedAt: STARTED,
        finishedAt: '2026-10-25T22:28:40.000Z',
        // `updated` absent on the wire: the arrays default to [].
        result: { added: ['https://vantagemind.ai/', 'https://vantagemind.ai/login'], removed: [] },
        trigger: 'manual',
      },
    ]);
    const result = await settle(client().knowledge.syncConnection(CONN));
    expect(result).toEqual({
      added: ['https://vantagemind.ai/', 'https://vantagemind.ai/login'],
      updated: [],
      removed: [],
    });
    expect(server.posts()).toHaveLength(1);
    expect(server.posts()[0]?.url).toBe(
      `${BASE_URL}/api/v1/admin/knowledge/sync-connections/${CONN}/sync`,
    );
    const gets = server.calls.filter((c) => c.method === 'GET');
    expect(gets).toHaveLength(3);
    expect(gets.every((c) => c.url === `${BASE_URL}/api/v1/admin/knowledge/sync-connections`)).toBe(
      true,
    );
  });

  it('shrink_pending throws the conflict with the server sentence (the confirm-shrink path)', async () => {
    const server = stubServer(accepted, [
      syncing,
      {
        state: 'shrink_pending',
        startedAt: STARTED,
        error: SHRINK,
        shrink: { remote: 1, existing: 4 },
      },
    ]);
    const err = await settle(client().knowledge.syncConnection(CONN)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LucielApiError);
    expect((err as LucielApiError).code).toBe('conflict');
    expect((err as LucielApiError).message).toBe(SHRINK);
    expect(/confirm the shrink/i.test((err as LucielApiError).message)).toBe(true);
    expect(server.posts()).toHaveLength(1);
  });

  it('confirmShrink rides the one POST', async () => {
    const server = stubServer(accepted, [
      { state: 'synced', startedAt: STARTED, result: { added: [], updated: [], removed: ['x'] } },
    ]);
    await expect(
      settle(client().knowledge.syncConnection(CONN, { confirmShrink: true })),
    ).resolves.toEqual({ added: [], updated: [], removed: ['x'] });
    expect(server.posts()[0]?.url).toMatch(/\/sync\?confirmShrink=true$/);
  });

  it('failed with "Sync unavailable" is a conflict; any other failure a server_error', async () => {
    stubServer(accepted, [
      {
        state: 'failed',
        startedAt: STARTED,
        error: 'Sync unavailable: the site could not be reached.',
      },
    ]);
    const unreachable = await settle(client().knowledge.syncConnection(CONN)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(unreachable).toMatchObject({
      code: 'conflict',
      message: 'Sync unavailable: the site could not be reached.',
    });

    vi.unstubAllGlobals();
    const server = stubServer(accepted, [
      { state: 'failed', startedAt: STARTED, error: 'The sync stopped before it finished.' },
    ]);
    const broken = await settle(client().knowledge.syncConnection(CONN)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(broken).toMatchObject({
      code: 'server_error',
      message: 'The sync stopped before it finished.',
    });
    expect(server.posts()).toHaveLength(1);
  });

  it('a previous run’s finished job is not this run’s outcome', async () => {
    stubServer(accepted, [
      // An earlier job, still on the row for the first read.
      {
        state: 'synced',
        startedAt: '2026-10-25T20:00:00.000Z',
        result: { added: ['old'], updated: [], removed: [] },
      },
      { state: 'synced', startedAt: STARTED, result: { added: ['new'], updated: [], removed: [] } },
    ]);
    await expect(settle(client().knowledge.syncConnection(CONN))).resolves.toEqual({
      added: ['new'],
      updated: [],
      removed: [],
    });
  });

  it('still syncing after 10 minutes: service_unavailable, honest that it carries on', async () => {
    const server = stubServer(accepted, [syncing]);
    const err = await settle(client().knowledge.syncConnection(CONN), 11 * 60_000).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(err).toBeInstanceOf(LucielApiError);
    expect(err).toMatchObject({
      code: 'service_unavailable',
      reason: 'sync_still_running',
      message: STILL_SYNCING_MESSAGE,
    });
    expect(isSyncStillRunning(err)).toBe(true);
    expect(STILL_SYNCING_MESSAGE).toBe(
      'Still syncing — it will finish on its own. Check this source in a minute.',
    );
    expect(server.posts()).toHaveLength(1);
  });

  it('fires onStarted once, on the 202', async () => {
    stubServer(accepted, [
      { state: 'synced', startedAt: STARTED, result: { added: [], updated: [], removed: [] } },
    ]);
    const onStarted = vi.fn();
    await settle(client().knowledge.syncConnection(CONN, { onStarted }));
    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  it('a later job is not this call’s outcome: it stops, reason-tagged', async () => {
    stubServer(accepted, [
      syncing,
      {
        state: 'synced',
        startedAt: '2026-10-25T22:29:00.000Z',
        result: { added: ['someone-elses'], updated: [], removed: [] },
      },
    ]);
    const err = await settle(client().knowledge.syncConnection(CONN)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(err).toMatchObject({
      code: 'service_unavailable',
      reason: 'sync_still_running',
      message: SYNC_TAKEN_OVER_MESSAGE,
    });
    expect(SYNC_TAKEN_OVER_MESSAGE).toBe(
      'Another sync of this source took over — Connected sources shows how it ends.',
    );
  });

  it('a later job still running stops it just the same', async () => {
    stubServer(accepted, [{ state: 'syncing', startedAt: '2026-10-25T22:29:00.000Z' }]);
    const err = await settle(client().knowledge.syncConnection(CONN)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(isSyncStillRunning(err)).toBe(true);
  });

  it('a source removed mid-sync (no job on a not_connected row) says so, not "Still syncing"', async () => {
    const server = stubServer(accepted, [syncing, null], 'not_connected');
    const err = await settle(client().knowledge.syncConnection(CONN)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(err).toMatchObject({ code: 'conflict', message: SYNC_REMOVED_MESSAGE });
    expect(isSyncRemoved(err)).toBe(true);
    expect(isSyncStillRunning(err)).toBe(false);
    expect(server.posts()).toHaveLength(1);
  });

  it('a connection revoked mid-sync is off the list: the same sentence, not "Connection not found."', async () => {
    stubServer(accepted, [syncing], 'revoked');
    const err = await settle(client().knowledge.syncConnection(CONN)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(err).toMatchObject({ code: 'conflict', message: SYNC_REMOVED_MESSAGE });
    expect(isSyncRemoved(err)).toBe(true);
  });

  it('a refusal in the same words is not the poll finding the source gone', () => {
    expect(
      isSyncRemoved(new LucielApiError({ code: 'conflict', message: SYNC_REMOVED_MESSAGE })),
    ).toBe(false);
  });

  it('a job cleared on a connected row (a reconnect) stops the poll, reason-tagged', async () => {
    stubServer(accepted, [syncing, null]);
    const err = await settle(client().knowledge.syncConnection(CONN)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(isSyncStillRunning(err)).toBe(true);
    expect(err).toMatchObject({ message: SYNC_RECONNECTED_MESSAGE });
  });

  it('a synced job passes its refused list through', async () => {
    stubServer(accepted, [
      {
        state: 'synced',
        startedAt: STARTED,
        result: { added: ['a'], updated: [], removed: [], refused: ['too-big.pdf'] },
      },
    ]);
    await expect(settle(client().knowledge.syncConnection(CONN))).resolves.toEqual({
      added: ['a'],
      updated: [],
      removed: [],
      refused: ['too-big.pdf'],
    });
  });

  it('a run a pause halted says so instead of reading as "0 added"', async () => {
    stubServer(accepted, [
      {
        state: 'synced',
        startedAt: STARTED,
        result: { added: [], updated: [], removed: [], halted: 'instance_not_serving' },
      },
    ]);
    await expect(settle(client().knowledge.syncConnection(CONN))).resolves.toEqual({
      added: [],
      updated: [],
      removed: [],
      halted: 'instance_not_serving',
    });
  });

  it('falls back to its own sentence when a finished job carries no error text', async () => {
    stubServer(accepted, [{ state: 'shrink_pending', startedAt: STARTED, error: null }]);
    const shrink = await settle(client().knowledge.syncConnection(CONN)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(shrink).toMatchObject({
      code: 'conflict',
      message: 'The source shrank, so nothing was removed. Sync again to confirm.',
    });

    vi.unstubAllGlobals();
    stubServer(accepted, [{ state: 'failed', startedAt: STARTED, error: null }]);
    const failed = await settle(client().knowledge.syncConnection(CONN)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(failed).toMatchObject({
      code: 'server_error',
      message: 'The sync failed. Nothing was changed — please try again.',
    });
    expect(isSyncStillRunning(failed)).toBe(false);
  });
});

describe('a real 503 from the POST', () => {
  it('is a failure, never the poll’s give-up', async () => {
    stubServer(
      {
        status: 503,
        body: { message: 'The sync failed before it finished — nothing was changed; try again.' },
      },
      [],
    );
    const err = await client()
      .knowledge.syncConnection(CONN)
      .catch((e: unknown) => e as LucielApiError);
    expect(err).toBeInstanceOf(LucielApiError);
    expect(err).toMatchObject({
      code: 'service_unavailable',
      message: 'The sync failed before it finished — nothing was changed; try again.',
    });
    expect(isSyncStillRunning(err)).toBe(false);
  });
});

describe('POST /knowledge/sources/{id}/resync (the same contract)', () => {
  const SOURCE = '44444444-4444-4444-8444-444444444444';
  const refreshed = { sourceId: SOURCE, name: 'Home', lastSyncedAt: '2026-10-25T22:30:00.000Z' };

  /** The sources list answers the refreshed source; the rest is as stubServer does. */
  function stubResync(post: { status: number; body: unknown }, jobs: Job[], sources: unknown[]) {
    const server = stubServer(post, jobs);
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/knowledge/sources') && (init?.method ?? 'GET') === 'GET'
        ? new Response(JSON.stringify(sources), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : inner(input, init),
    );
    return server;
  }

  it('200: the source as served, no poll, onStarted not fired', async () => {
    const server = stubResync({ status: 200, body: refreshed }, [], []);
    const onStarted = vi.fn();
    await expect(client().knowledge.resyncSource(SOURCE, { onStarted })).resolves.toEqual(
      refreshed,
    );
    expect(onStarted).not.toHaveBeenCalled();
    expect(server.calls).toHaveLength(1);
  });

  it('202: polls the job on the answer’s connection, then returns the refreshed source', async () => {
    const server = stubResync(
      accepted,
      [
        syncing,
        { state: 'synced', startedAt: STARTED, result: { added: [], updated: [], removed: [] } },
      ],
      [refreshed],
    );
    const onStarted = vi.fn();
    await expect(settle(client().knowledge.resyncSource(SOURCE, { onStarted }))).resolves.toEqual(
      refreshed,
    );
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(server.posts()).toHaveLength(1);
    expect(server.posts()[0]?.url).toBe(
      `${BASE_URL}/api/v1/admin/knowledge/sources/${SOURCE}/resync`,
    );
  });

  it('202 and a job that fails: the job’s error, not a source', async () => {
    stubResync(
      accepted,
      [{ state: 'failed', startedAt: STARTED, error: 'Sync unavailable: gone.' }],
      [refreshed],
    );
    const err = await settle(client().knowledge.resyncSource(SOURCE)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(err).toMatchObject({ code: 'conflict', message: 'Sync unavailable: gone.' });
  });

  const removedAtOrigin = {
    state: 'synced',
    startedAt: STARTED,
    result: { added: [], updated: [], removed: ['Home'] },
  };
  const GONE = { code: 'not_found', message: 'Source no longer exists at the sync origin.' };

  it('202 and the sync removed it at its origin: the served tombstone is not_found', async () => {
    stubResync(accepted, [removedAtOrigin], [{ ...refreshed, deletedBy: 'origin' }]);
    const err = await settle(client().knowledge.resyncSource(SOURCE)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(err).toMatchObject(GONE);
  });

  it('202 and a source no longer on the list at all (purged): not_found', async () => {
    stubResync(accepted, [removedAtOrigin], []);
    const err = await settle(client().knowledge.resyncSource(SOURCE)).catch(
      (e: unknown) => e as LucielApiError,
    );
    expect(err).toMatchObject(GONE);
  });

  it('200 answering a tombstone: not_found too', async () => {
    stubResync({ status: 200, body: { ...refreshed, deletedBy: 'origin' } }, [], []);
    await expect(client().knowledge.resyncSource(SOURCE)).rejects.toMatchObject(GONE);
  });

  it('a tombstone of another source does not touch this one', async () => {
    stubResync(
      accepted,
      [removedAtOrigin],
      [{ sourceId: 'other', name: 'Old', deletedBy: 'origin' }, refreshed],
    );
    await expect(settle(client().knowledge.resyncSource(SOURCE))).resolves.toEqual(refreshed);
  });

  describe('the read of the list after a finished job', () => {
    /** Each GET of the sources list answers the next status; the last repeats. */
    function stubFlakyList(statuses: number[]) {
      stubServer(accepted, [
        { state: 'synced', startedAt: STARTED, result: { added: [], updated: [], removed: [] } },
      ]);
      const inner = globalThis.fetch;
      let reads = 0;
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).endsWith('/knowledge/sources') || (init?.method ?? 'GET') !== 'GET') {
          return inner(input, init);
        }
        const status = statuses[Math.min(reads, statuses.length - 1)] as number;
        reads += 1;
        return new Response(
          JSON.stringify(status === 200 ? [refreshed] : { message: 'Bad gateway' }),
          { status, headers: { 'content-type': 'application/json' } },
        );
      });
      return { reads: () => reads };
    }

    it('a failed read is asked again: the refreshed source comes back', async () => {
      const list = stubFlakyList([502, 200]);
      await expect(settle(client().knowledge.resyncSource(SOURCE))).resolves.toEqual(refreshed);
      expect(list.reads()).toBe(2);
    });

    it('a read that stays down never reports a failed sync: it says the sync finished', async () => {
      const list = stubFlakyList([502]);
      const err = await settle(client().knowledge.resyncSource(SOURCE)).catch(
        (e: unknown) => e as LucielApiError,
      );
      expect(err).toMatchObject({ message: SYNC_FINISHED_UNREAD_MESSAGE });
      expect(isSyncStillRunning(err)).toBe(true);
      expect(list.reads()).toBe(3);
    });

    it('an ended session rethrows at once', async () => {
      const read = vi
        .fn()
        .mockRejectedValue(
          new LucielApiError({ code: 'unauthorized', message: 'Session revoked.' }),
        );
      const err = await settle(readAfterSync(read)).catch((e: unknown) => e as LucielApiError);
      expect(err).toMatchObject({ code: 'unauthorized' });
      expect(read).toHaveBeenCalledTimes(1);
    });
  });
});

describe('awaitSyncJob reading the row', () => {
  const synced = {
    state: 'synced' as const,
    startedAt: STARTED,
    result: { added: ['a'], updated: [], removed: [] },
  };
  const run = <T>(p: Promise<T>) => settle(p).catch((e: unknown) => e as LucielApiError);

  it('a failed read is not the outcome: it keeps polling', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new LucielApiError({ code: 'server_error', message: 'Bad gateway' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ syncJob: synced });
    await expect(
      run(awaitSyncJob({ connectionId: CONN, startedAt: STARTED, read })),
    ).resolves.toEqual({ added: ['a'], updated: [], removed: [] });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('a session that ended mid-poll rethrows at once', async () => {
    const read = vi
      .fn()
      .mockRejectedValue(new LucielApiError({ code: 'unauthorized', message: 'Session revoked.' }));
    const err = await run(awaitSyncJob({ connectionId: CONN, startedAt: STARTED, read }));
    expect(err).toMatchObject({ code: 'unauthorized', message: 'Session revoked.' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('after a 202 a row that is gone is the source having gone', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ status: 'connected', syncJob: syncing })
      .mockResolvedValue(undefined);
    const err = await run(awaitSyncJob({ connectionId: CONN, startedAt: STARTED, read }));
    expect(err).toMatchObject({ code: 'conflict', message: SYNC_REMOVED_MESSAGE });
    expect(isSyncRemoved(err)).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('with no job of ours to speak for, a row that is gone is not_found', async () => {
    const read = vi.fn().mockResolvedValue(undefined);
    const err = await run(awaitSyncJob({ connectionId: CONN, read }));
    expect(err).toMatchObject({ code: 'not_found', message: 'Connection not found.' });
    expect(isSyncRemoved(err)).toBe(false);
  });

  it('with no startedAt to compare, an empty row is not yet visible: it keeps polling', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ status: 'connected', syncJob: null })
      .mockResolvedValue({ status: 'connected', syncJob: synced });
    await expect(run(awaitSyncJob({ connectionId: CONN, read }))).resolves.toMatchObject({
      added: ['a'],
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
