import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createLucielClient, LucielApiError } from '../index';
import type { Connection, MockControl, MockRuntime } from '../index';

/**
 * The mock's deferSync control (round 7 — the asynchronous crawl). The next
 * `knowledge.syncConnection` is answered "still running", its connection serves
 * `syncJob.state: 'syncing'` — to a page loaded afterwards too (the walk reloads
 * mid-crawl) — and it completes later with the result a synchronous sync computes,
 * resolved through the same poll as the http adapter. Without it the mock answers
 * as it always did.
 */

const DRIVE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SITE = 'https://sarahchen.com/services';

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
    control: () => {
      if (!control) throw new Error('control not installed');
      return control;
    },
  };
}

const jobOf = (rows: Connection[], id: string) => rows.find((c) => c.connectionId === id)?.syncJob;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T22:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('mock deferSync', () => {
  it('without it, a sync answers at once — the result as today, the job on record', async () => {
    const page = fakeTab().load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    await expect(page.knowledge.syncConnection(crawl.connectionId)).resolves.toEqual({
      added: [SITE],
      updated: [],
      removed: [],
    });
    const job = jobOf(await page.connections.list(), crawl.connectionId);
    expect(job).toMatchObject({ state: 'synced', result: { added: [SITE] } });
  });

  it('stamps syncing (served across a reload), then completes with the same result', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const crawl = await page.knowledge.startCrawl([SITE]);
    expect(jobOf(await page.connections.list(), crawl.connectionId)).toBeNull();

    tab.control().deferSync(4000);
    let settled: unknown;
    const pending = page.knowledge.syncConnection(crawl.connectionId).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBeUndefined();

    // A reload while it runs: a fresh client over the same store reads "syncing".
    const reloaded = tab.load();
    const during = jobOf(await reloaded.connections.list(), crawl.connectionId);
    expect(during).toMatchObject({ state: 'syncing', trigger: 'manual' });
    expect(typeof during?.startedAt).toBe('string');
    // Nothing was crawled yet.
    expect((await reloaded.knowledge.listSources()).some((s) => s.name === SITE)).toBe(false);

    await vi.advanceTimersByTimeAsync(4500);
    await pending;
    expect(settled).toEqual({ added: [SITE], updated: [], removed: [] });

    // The page loaded mid-crawl sees it finish too — the row and the synced page.
    const after = tab.load();
    expect(jobOf(await after.connections.list(), crawl.connectionId)).toMatchObject({
      state: 'synced',
      startedAt: during?.startedAt,
      result: { added: [SITE], updated: [], removed: [] },
    });
    const page1 = (await after.knowledge.listSources()).find((s) => s.name === SITE);
    expect(page1?.lastSyncedAt).toBeTruthy();

    // Only the NEXT sync was deferred: the one after answers at once again.
    await expect(after.knowledge.syncConnection(crawl.connectionId)).resolves.toEqual({
      added: [],
      updated: [SITE],
      removed: [],
    });
  });

  it('a FAST refusal (no deferSync) still throws the 409 AND leaves the row failed, as the server records it', async () => {
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

  it('a sync of a connection that is not there is a 404 with nothing recorded', async () => {
    const tab = fakeTab();
    const page = tab.load();
    const missing = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const err = (await page.knowledge
      .syncConnection(missing)
      .catch((e: unknown) => e)) as LucielApiError;
    expect(err.code).toBe('not_found');
    expect(jobOf(await page.connections.list(), missing)).toBeUndefined();
  });

  it('a deferred sync on a revoked grant fails with the served "Sync unavailable" text', async () => {
    const tab = fakeTab();
    const page = tab.load();
    tab.control().revokeKnowledgeGrant(DRIVE);
    tab.control().deferSync(1000);
    const outcome = page.knowledge.syncConnection(DRIVE).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1500);
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
