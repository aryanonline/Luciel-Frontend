import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createLucielClient } from '../index';
import { LucielApiError } from '../schemas';
import { STILL_SYNCING_MESSAGE } from '../adapters/sync-job';

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
function stubServer(post: { status: number; body: unknown }, jobs: Job[]) {
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
    const rows = [
      { connectionId: OTHER, provider: 'notion', status: 'connected', syncJob: null },
      { connectionId: CONN, provider: 'website_crawl', status: 'connected', syncJob: job },
    ];
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
    expect(err).toMatchObject({ code: 'service_unavailable', message: STILL_SYNCING_MESSAGE });
    expect(STILL_SYNCING_MESSAGE).toBe(
      'Still syncing — it will finish on its own. Check this source in a minute.',
    );
    expect(server.posts()).toHaveLength(1);
  });
});
