import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createLucielClient, LucielApiError } from '../index';
import type { Connection, MockControl, MockRuntime } from '../index';

/**
 * The mock's holdNextSync / releaseSync control (round 7 — the asynchronous crawl). The
 * next knowledge sync is answered "still running", its connection serves `syncJob.state:
 * 'syncing'` — to a page loaded afterwards too (the walk reloads mid-crawl) — and it
 * completes on release with the result a synchronous sync computes, resolved through the
 * same poll as the http adapter. Without it the mock answers as it always did. It follows
 * the backend's contract for everything around a running job.
 */

const DRIVE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SITE = 'https://sarahchen.com/services';
const ALREADY_RUNNING = 'A sync of this source is already running — it will finish on its own.';
const STORE_KEY = 'luciel.mock.store.v1';

/** One tab: a shared sessionStorage + cookie jar; each load() is a page load. */
function fakeTab() {
  const store = new Map<string, string>();
  let control: MockControl | undefined;
  const load = () => {
    const runtime: MockRuntime = {
      search: '',
      pathname: '/dashboard/configure',
      readCookie: () => 'luciel_session=mock-session',
      writeCookie: () => undefined,
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      },
      installControl: (c) => {
        control = c;
      },
    };
    return createLucielClient({ adapter: 'mock', mock: { runtime } });
  };
  return {
    load,
    /** The source shrank at its origin: marked in the store, read by the next page load. */
    shrinkAtOrigin: (connectionId: string) => {
      const saved = JSON.parse(store.get(STORE_KEY) ?? '{}') as {
        state: {
          syncConnections: { connectionId: string; nonSecretConfig?: Record<string, unknown> }[];
        };
      };
      const row = saved.state.syncConnections.find((c) => c.connectionId === connectionId);
      if (!row) throw new Error('no such sync connection');
      row.nonSecretConfig = { ...row.nonSecretConfig, mockShrink: true };
      store.set(STORE_KEY, JSON.stringify(saved));
    },
    /** The persisted store, as a page load would read it. */
    persisted: () =>
      JSON.parse(store.get(STORE_KEY) ?? '{}') as {
        state?: { syncJobs?: Record<string, unknown> };
      },
    control: () => {
      if (!control) throw new Error('control not installed');
      return control;
    },
  };
}

const jobOf = (rows: Connection[], id: string) => rows.find((c) => c.connectionId === id)?.syncJob;

/** Let the POST answer and a few polls run. */
const tick = () => vi.advanceTimersByTimeAsync(1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T22:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('mock holdNextSync', () => {
  it('without it, a sync answers at once — the result as today, the job on record', async () => {
    const page = fakeTab().load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    const started = vi.fn();
    const result = page.knowledge.syncConnection(crawl.connectionId, { onStarted: started });
    await tick();
    await expect(result).resolves.toEqual({ added: [SITE], updated: [], removed: [] });
    expect(started).not.toHaveBeenCalled();
    const job = jobOf(await page.connections.list(), crawl.connectionId);
    expect(job).toMatchObject({ state: 'synced', result: { added: [SITE] } });
  });

  it('stamps syncing (served across a reload), fires onStarted once, then completes on release', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    expect(jobOf(await page.connections.list(), crawl.connectionId)).toBeNull();

    const clicked = tab.control();
    clicked.holdNextSync();
    const started = vi.fn();
    let settled: unknown;
    const pending = page.knowledge
      .syncConnection(crawl.connectionId, { onStarted: started })
      .then((r) => (settled = r));
    await tick();
    expect(settled).toBeUndefined();
    expect(started).toHaveBeenCalledTimes(1);

    // A reload while it runs: a fresh client over the same store reads "syncing".
    const reloaded = tab.load();
    const during = jobOf(await reloaded.connections.list(), crawl.connectionId);
    expect(during).toMatchObject({ state: 'syncing', trigger: 'manual' });
    expect(typeof during?.startedAt).toBe('string');
    // Nothing was crawled yet.
    expect((await reloaded.knowledge.listSources()).some((s) => s.name === SITE)).toBe(false);

    // The page loaded mid-crawl sees it finish — the row and the synced page.
    tab.control().releaseSync();
    expect(jobOf(await reloaded.connections.list(), crawl.connectionId)).toMatchObject({
      state: 'synced',
      startedAt: during?.startedAt,
      result: { added: [SITE], updated: [], removed: [] },
    });
    const page1 = (await tab.load().knowledge.listSources()).find((s) => s.name === SITE);
    expect(page1?.lastSyncedAt).toBeTruthy();

    // The tab that clicked (no reload) resolves through its own poll, with no timer race.
    clicked.releaseSync();
    await tick();
    await pending;
    expect(settled).toEqual({ added: [SITE], updated: [], removed: [] });

    // Only the NEXT sync was held: the one after answers at once again.
    await expect(page.knowledge.syncConnection(crawl.connectionId)).resolves.toEqual({
      added: [],
      updated: [SITE],
      removed: [],
    });
  });

  it('stays syncing for as long as nobody releases it', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    tab.control().holdNextSync();
    void page.knowledge.syncConnection(crawl.connectionId).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(jobOf(await page.connections.list(), crawl.connectionId)?.state).toBe('syncing');
  });

  it('a held sync that shrinks serves shrink_pending and rejects with the conflict', async () => {
    const tab = fakeTab();
    const first = tab.load();
    const crawl = await first.knowledge.startCrawl([SITE]);
    await first.knowledge.syncConnection(crawl.connectionId);
    tab.shrinkAtOrigin(crawl.connectionId);
    const page = tab.load();
    tab.control().holdNextSync();
    const outcome = page.knowledge.syncConnection(crawl.connectionId).catch((e: unknown) => e);
    await tick();
    tab.control().releaseSync();
    await tick();
    const err = (await outcome) as LucielApiError;
    expect(err).toBeInstanceOf(LucielApiError);
    expect(err.code).toBe('conflict');
    expect(err.message).toMatch(/confirm the shrink/);
    expect(jobOf(await page.connections.list(), crawl.connectionId)).toMatchObject({
      state: 'shrink_pending',
      error: err.message,
    });
  });

  it('a held sync on a revoked grant fails with the served "Sync unavailable" text', async () => {
    const tab = fakeTab();
    const page = tab.load();
    tab.control().revokeKnowledgeGrant(DRIVE);
    tab.control().holdNextSync();
    const outcome = page.knowledge.syncConnection(DRIVE).catch((e: unknown) => e);
    await tick();
    tab.control().releaseSync();
    await tick();
    const err = (await outcome) as LucielApiError;
    expect(err).toBeInstanceOf(LucielApiError);
    expect(err.code).toBe('conflict');
    expect(err.message).toMatch(/^Sync unavailable:/);
    expect(jobOf(await page.connections.list(), DRIVE)).toMatchObject({
      state: 'failed',
      error: err.message,
    });
  });
});

describe('the mock around a running job, as the backend answers', () => {
  it('a second start is the 409, not a join', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    tab.control().holdNextSync();
    void page.knowledge.syncConnection(crawl.connectionId).catch(() => undefined);
    await tick();
    await expect(page.knowledge.syncConnection(crawl.connectionId)).rejects.toMatchObject({
      code: 'conflict',
      message: ALREADY_RUNNING,
    });
  });

  it('resyncSource during a job is the same 409', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    await page.knowledge.syncConnection(crawl.connectionId);
    const source = (await page.knowledge.listSources()).find((s) => s.name === SITE);
    tab.control().holdNextSync();
    void page.knowledge.syncConnection(crawl.connectionId).catch(() => undefined);
    await tick();
    await expect(page.knowledge.resyncSource(source?.sourceId as string)).rejects.toMatchObject({
      code: 'conflict',
      message: ALREADY_RUNNING,
    });
  });

  it('resyncSource honours the hold: onStarted, then the refreshed source on release', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    await page.knowledge.syncConnection(crawl.connectionId);
    const source = (await page.knowledge.listSources()).find((s) => s.name === SITE);
    tab.control().holdNextSync();
    const started = vi.fn();
    const pending = page.knowledge.resyncSource(source?.sourceId as string, {
      onStarted: started,
    });
    await tick();
    expect(started).toHaveBeenCalledTimes(1);
    expect(jobOf(await page.connections.list(), crawl.connectionId)?.state).toBe('syncing');
    tab.control().releaseSync();
    await tick();
    await expect(pending).resolves.toMatchObject({ sourceId: source?.sourceId });
    expect(jobOf(await page.connections.list(), crawl.connectionId)?.state).toBe('synced');
  });

  it('disconnect stops a held sync with nothing applied; the poll says so; the row has no job', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    tab.control().holdNextSync();
    const outcome = page.knowledge.syncConnection(crawl.connectionId).catch((e: unknown) => e);
    await tick();
    await page.connections.disconnect(crawl.connectionId);
    await tick();
    expect(await outcome).toMatchObject({
      code: 'conflict',
      message: 'This source was removed while it was syncing — nothing from that sync was kept.',
    });
    tab.control().releaseSync();
    expect(jobOf(await page.connections.list(), crawl.connectionId)).toBeNull();
    expect((await page.knowledge.listSources()).some((s) => s.name === SITE)).toBe(false);
  });

  it('a removed source refuses a sync in the owner’s words, and serves no job', async () => {
    const page = fakeTab().load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    await page.knowledge.syncConnection(crawl.connectionId);
    await page.connections.disconnect(crawl.connectionId);
    await expect(page.knowledge.syncConnection(crawl.connectionId)).rejects.toMatchObject({
      code: 'conflict',
      message: 'This source was removed — connect it again to sync it.',
    });
    expect(jobOf(await page.connections.list(), crawl.connectionId)).toBeNull();
  });

  it('a FAST refusal still throws the 409 AND leaves the row failed, as the server records it', async () => {
    const tab = fakeTab();
    const page = tab.load();
    tab.control().revokeKnowledgeGrant(DRIVE);
    const err = (await page.knowledge
      .syncConnection(DRIVE)
      .catch((e: unknown) => e)) as LucielApiError;
    expect(err).toBeInstanceOf(LucielApiError);
    expect(err.code).toBe('conflict');
    expect(err.message).toBe(
      'Sync unavailable: the provider refused the stored credential — reconnect it.',
    );
    // Served on both knowledge lists, and across a reload — never left on "syncing".
    const job = jobOf(await page.connections.list(), DRIVE);
    expect(job).toMatchObject({ state: 'failed', error: err.message, trigger: 'manual' });
    expect(typeof job?.startedAt).toBe('string');
    expect(typeof job?.finishedAt).toBe('string');
    expect(jobOf(await tab.load().connections.list(), DRIVE)).toMatchObject({
      state: 'failed',
      error: err.message,
    });
  });

  it('a sync of a connection that is not there is a 404 with nothing recorded in the store', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const missing = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const err = (await page.knowledge
      .syncConnection(missing)
      .catch((e: unknown) => e)) as LucielApiError;
    expect(err.code).toBe('not_found');
    expect(tab.persisted().state?.syncJobs).toBeDefined();
    expect(tab.persisted().state?.syncJobs?.[missing]).toBeUndefined();
  });

  it('a sync aimed at a connection of another type records nothing either', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const crm = (await page.connections.list()).find(
      (c) => c.connectionType !== 'knowledge_source',
    );
    expect(crm).toBeDefined();
    await expect(page.knowledge.syncConnection(crm?.connectionId as string)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(tab.persisted().state?.syncJobs?.[crm?.connectionId as string]).toBeUndefined();
  });
});
