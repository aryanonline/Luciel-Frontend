import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import {
  KnowledgeConnections,
  SYNC_POLL_MS,
  knowledgeSyncRefetchInterval,
} from '@/components/config/knowledge-connections';
import { api } from '@/lib/api';
import { useQuota } from '@/lib/hooks';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';
import { LucielApiError } from '@luciel/api-client';
import { KnowledgeScopeSections } from '@/components/config/knowledge-scope';
import type {
  Connection,
  KnowledgeSource,
  KnowledgeSyncJob,
  KnowledgeSyncOptions,
  KnowledgeSyncResult,
} from '@luciel/api-client';

/**
 * Round 7 — the asynchronous crawl. A sync that outlives the server's inline wait keeps
 * running in the background and its connection serves `syncJob`. The row says what the
 * server says: "Crawling…" / "Syncing…" with when it started (Re-sync disabled, the rows
 * re-read every 2 s until it finishes — then sources and quota are re-read too), "Last
 * sync failed: <error>" beside a last-synced time that is never erased, and a served
 * shrink_pending offers the confirm-shrink decision.
 */

const CRAWL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DRIVE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SYNCED_AT = '2026-10-20T15:00:00Z';
const STARTED = '2026-10-25T22:27:35Z';

const crawl = (syncJob: KnowledgeSyncJob | null): Connection => ({
  connectionId: CRAWL,
  connectionType: 'knowledge_source',
  provider: 'website_crawl',
  displayName: 'Website crawl',
  providerAvailable: true,
  status: 'connected',
  nonSecretConfig: { crawl_urls: ['https://vantagemind.ai/'] },
  createdAt: '2026-10-20T14:59:00Z',
  syncJob,
});
const drive = (syncJob: KnowledgeSyncJob | null): Connection => ({
  connectionId: DRIVE,
  connectionType: 'knowledge_source',
  provider: 'google_drive',
  displayName: 'Google Drive',
  providerAvailable: true,
  status: 'connected',
  createdAt: '2026-02-01T10:10:00Z',
  syncJob,
});
const page: KnowledgeSource = {
  sourceId: '11111111-1111-4111-8111-111111111111',
  name: 'https://vantagemind.ai/',
  origin: 'website_crawl',
  ingestionStatus: 'ready',
  sizeBytes: 40_000,
  lastUpdatedAt: SYNCED_AT,
  usedByQuestions7d: 0,
  syncStatus: 'synced',
  lastSyncedAt: SYNCED_AT,
  connectionId: CRAWL,
};
const lastSyncedText = new Date(SYNCED_AT).toLocaleString(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const startedText = new Date(STARTED).toLocaleTimeString(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const syncing: KnowledgeSyncJob = { state: 'syncing', startedAt: STARTED, trigger: 'manual' };
const finished: KnowledgeSyncJob = {
  state: 'synced',
  startedAt: STARTED,
  finishedAt: '2026-10-25T22:28:40Z',
  result: { added: ['https://vantagemind.ai/'], updated: [], removed: [] },
};

const STILL_RUNNING = 'Still syncing — it will finish on its own. Check this source in a minute.';
/** What the adapter throws when ITS POLL gives up. */
const gaveUp = () =>
  new LucielApiError({
    code: 'service_unavailable',
    reason: 'sync_still_running',
    message: STILL_RUNNING,
  });
/** What the transport makes of a real 503 from the server. */
const REAL_503 = 'The sync failed before it finished — nothing was changed; try again.';
const real503 = () => new LucielApiError({ code: 'service_unavailable', message: REAL_503 });

/**
 * A sync that answers 202 at once and then runs on: `finish` / `fail` end it. It is a
 * spy over `syncConnection`, with the adapter's own contract.
 */
function runningSync() {
  let finish!: (r: KnowledgeSyncResult) => void;
  let fail!: (e: unknown) => void;
  const outcome = new Promise<KnowledgeSyncResult>((res, rej) => {
    finish = res;
    fail = rej;
  });
  const spy = vi
    .spyOn(api.knowledge, 'syncConnection')
    .mockImplementation(async (_id: string, opts?: KnowledgeSyncOptions) => {
      opts?.onStarted?.();
      return outcome;
    });
  return { spy, finish, fail };
}

beforeEach(() => {
  vi.spyOn(api.connections, 'listProviders').mockResolvedValue([]);
  vi.spyOn(api.knowledge, 'quota').mockResolvedValue({
    usedBytes: 40_000,
    totalBytes: 5_000_000_000,
    perFileMaxBytes: 50_000_000,
  });
});
afterEach(() => vi.restoreAllMocks());

/** The quota meter the pillar renders beside the list (an observer of the quota query). */
function QuotaReader() {
  const quota = useQuota();
  return <span>{quota.data ? 'quota read' : ''}</span>;
}

const rowOf = async (name: string | RegExp) => {
  const list = await screen.findByRole('list', { name: 'Connected sources' });
  const row = (await within(list).findByText(name)).closest('li');
  if (!row) throw new Error('row not found');
  return row as HTMLElement;
};

describe('the refetch interval follows the served job', () => {
  it('2 s while any knowledge row is syncing; off otherwise', () => {
    expect(SYNC_POLL_MS).toBe(2000);
    expect(knowledgeSyncRefetchInterval([crawl(syncing), drive(null)])).toBe(2000);
    expect(knowledgeSyncRefetchInterval([crawl(null), drive(null)])).toBe(false);
    expect(
      knowledgeSyncRefetchInterval([
        crawl({ state: 'failed', startedAt: STARTED, error: 'Sync unavailable: x' }),
      ]),
    ).toBe(false);
    // A revoked row is not listed, so its job never keeps the page polling.
    expect(knowledgeSyncRefetchInterval([{ ...crawl(syncing), status: 'revoked' }])).toBe(false);
    expect(knowledgeSyncRefetchInterval(undefined)).toBe(false);
  });
});

describe('a row whose job is syncing', () => {
  it('reads "Crawling… started <time>", keeps its last-synced time, and Re-sync is disabled', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(syncing)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    const sync = vi.spyOn(api.knowledge, 'syncConnection');
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    expect(within(row).getByText(`Crawling… started ${startedText}`)).toBeInTheDocument();
    expect(await within(row).findByText(new RegExp(`last synced ${lastSyncedText}`))).toBeTruthy();
    const resync = within(row).getByRole('button', { name: 'Re-sync' });
    // Held, but still in the tab order and saying why: not natively disabled.
    expect(resync).not.toBeDisabled();
    expect(resync).toHaveAttribute('aria-disabled', 'true');
    const reason = resync.getAttribute('aria-describedby');
    expect(reason && document.getElementById(reason)).toHaveTextContent(/^Crawling…/);
    fireEvent.click(resync);
    expect(sync).not.toHaveBeenCalled();
  });

  it('"Remove crawl" stays enabled: removing a source stops its sync', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(syncing)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    expect(within(row).getByRole('button', { name: 'Remove crawl' })).toBeEnabled();
  });

  it('a not-connected row shows no job line, whatever is served', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([
      { ...crawl(syncing), status: 'not_connected' },
    ]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    expect(within(row).queryByText(/Crawling…/)).not.toBeInTheDocument();
    expect(knowledgeSyncRefetchInterval([{ ...crawl(syncing), status: 'not_connected' }])).toBe(
      false,
    );
  });

  it('another provider reads "Syncing…"', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([drive(syncing)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([]);
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('Google Drive');
    expect(within(row).getByText(`Syncing… started ${startedText}`)).toBeInTheDocument();
    expect(within(row).queryByText(/Crawling…/)).not.toBeInTheDocument();
  });

  it('re-reads the rows every 2 s until it finishes, then re-reads sources and quota', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const list = vi
        .spyOn(api.connections, 'list')
        .mockResolvedValueOnce([crawl(syncing)])
        .mockResolvedValueOnce([crawl(syncing)])
        .mockResolvedValue([crawl(finished)]);
      const sources = vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
      const quota = vi.mocked(api.knowledge.quota);
      renderWithQuery(
        <>
          <KnowledgeConnections />
          <QuotaReader />
        </>,
      );
      await screen.findByText('quota read');
      const row = await rowOf('https://vantagemind.ai/');
      expect(within(row).getByText(/^Crawling…/)).toBeInTheDocument();
      expect(list).toHaveBeenCalledTimes(1);
      const sourceReads = sources.mock.calls.length;
      const quotaReads = quota.mock.calls.length;

      // One interval: one more read, still syncing.
      await act(() => vi.advanceTimersByTimeAsync(SYNC_POLL_MS));
      expect(list).toHaveBeenCalledTimes(2);
      expect(within(row).getByText(/^Crawling…/)).toBeInTheDocument();

      // The next one finds it finished.
      await act(() => vi.advanceTimersByTimeAsync(SYNC_POLL_MS));
      expect(list).toHaveBeenCalledTimes(3);
      expect(within(row).queryByText(/^Crawling…/)).not.toBeInTheDocument();
      await waitFor(() => expect(sources.mock.calls.length).toBeGreaterThan(sourceReads));
      await waitFor(() => expect(quota.mock.calls.length).toBeGreaterThan(quotaReads));
      expect(within(row).getByRole('button', { name: 'Re-sync' })).not.toHaveAttribute(
        'aria-disabled',
      );

      // Finished: the interval is off again, however long we wait.
      await act(() => vi.advanceTimersByTimeAsync(SYNC_POLL_MS * 5));
      expect(list).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('one always-mounted live region says how it ended', async () => {
    const list = vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(syncing)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    renderWithQuery(<KnowledgeConnections />);
    await rowOf('https://vantagemind.ai/');
    const region = screen.getByTestId('knowledge-sync-announcer');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveTextContent('');

    list.mockResolvedValue([crawl(finished)]);
    await waitFor(
      () =>
        expect(region).toHaveTextContent(
          'Finished syncing https://vantagemind.ai/ — 1 added, 0 updated, 0 removed.',
        ),
      { timeout: 5000 },
    );

    // The same node all along: its text changed, so it is announced.
    expect(screen.getByTestId('knowledge-sync-announcer')).toBe(region);
  }, 10_000);

  it('the live region says a failure too', async () => {
    const list = vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(syncing)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    renderWithQuery(<KnowledgeConnections />);
    await rowOf('https://vantagemind.ai/');
    const region = screen.getByTestId('knowledge-sync-announcer');
    list.mockResolvedValue([
      crawl({ state: 'failed', startedAt: STARTED, error: 'Sync unavailable: gone.' }),
    ]);
    await waitFor(
      () =>
        expect(region).toHaveTextContent(
          'The sync of https://vantagemind.ai/ failed: Sync unavailable: gone.',
        ),
      { timeout: 5000 },
    );
  }, 10_000);
});

describe('a Re-sync the server answers 202 (nobody is held behind it)', () => {
  it('shows "Crawling…" in the same tab, while syncConnection is still pending', async () => {
    const list = vi.spyOn(api.connections, 'list').mockResolvedValueOnce([crawl(null)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    const { spy, finish } = runningSync();
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    list.mockResolvedValue([crawl(syncing)]);
    fireEvent.click(within(row).getByRole('button', { name: 'Re-sync' }));
    expect(await within(row).findByText(/^Crawling…/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    // Busy ended with the POST: Remove crawl is free, Re-sync held by the served job only.
    expect(within(row).getByRole('button', { name: 'Remove crawl' })).toBeEnabled();
    expect(screen.queryByText(/^Synced /)).not.toBeInTheDocument();

    list.mockResolvedValue([crawl(finished)]);
    await act(async () => finish({ added: ['a'], updated: [], removed: [] }));
    expect(
      await screen.findByText('Synced https://vantagemind.ai/ — 1 added, 0 removed.'),
    ).toBeInTheDocument();
  });

  it('a failure after the 202 is a danger notice with the served text', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(null)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    const { fail } = runningSync();
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    fireEvent.click(within(row).getByRole('button', { name: 'Re-sync' }));
    await waitFor(() =>
      expect(within(row).getByRole('button', { name: 'Re-sync' })).not.toHaveAttribute(
        'aria-disabled',
      ),
    );
    await act(async () =>
      fail(new LucielApiError({ code: 'server_error', message: 'The crawl stopped halfway.' })),
    );
    const banner = await screen.findByText('The crawl stopped halfway.');
    expect(banner.closest('[data-tone], [class*="danger"]')).not.toBeNull();
  });

  it('the poll giving up is an info notice saying it runs on, never a failure', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(syncing)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    vi.spyOn(api.knowledge, 'syncConnection').mockRejectedValue(gaveUp());
    vi.mocked(api.connections.list).mockResolvedValueOnce([crawl(null)]);
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    fireEvent.click(within(row).getByRole('button', { name: 'Re-sync' }));
    const banner = await screen.findByText(STILL_RUNNING);
    expect(banner.closest('[class*="danger"]')).toBeNull();
    expect(screen.queryByText(/^Synced /)).not.toBeInTheDocument();
  });

  it('a real 503 is a failure: danger, in the server’s words', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(null)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    vi.spyOn(api.knowledge, 'syncConnection').mockRejectedValue(real503());
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    fireEvent.click(within(row).getByRole('button', { name: 'Re-sync' }));
    const banner = await screen.findByText(REAL_503);
    expect(banner.closest('[class*="danger"]')).not.toBeNull();
  });
});

describe('a row whose job failed', () => {
  it('says "Last sync failed: <error>" beside the last-synced time it keeps', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([
      crawl({
        state: 'failed',
        startedAt: STARTED,
        finishedAt: '2026-10-25T22:29:00Z',
        error: 'Sync unavailable: https://vantagemind.ai/ could not be reached.',
      }),
    ]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    expect(
      within(row).getByText(
        'Last sync failed: Sync unavailable: https://vantagemind.ai/ could not be reached.',
      ),
    ).toBeInTheDocument();
    expect(await within(row).findByText(new RegExp(`last synced ${lastSyncedText}`))).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Re-sync' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });
});

describe('a row whose job is shrink_pending', () => {
  it('shows the served sentence and confirms the shrink with one more sync', async () => {
    const sentence =
      'The source now reports 1 item(s) where 4 are synced, so nothing was removed. If you did remove them at the source, sync again and confirm the shrink.';
    vi.spyOn(api.connections, 'list').mockResolvedValue([
      crawl({ state: 'shrink_pending', startedAt: STARTED, error: sentence }),
    ]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    const sync = vi
      .spyOn(api.knowledge, 'syncConnection')
      .mockResolvedValue({ added: [], updated: [], removed: ['a', 'b', 'c'] });
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    expect(within(row).getByText(sentence, { exact: false })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, remove them and sync' }));
    expect(
      await screen.findByText('Synced — 3 source(s) removed to match the source, 0 added.'),
    ).toBeInTheDocument();
    expect(sync).toHaveBeenCalledWith(CRAWL, expect.objectContaining({ confirmShrink: true }));
  });

  it('builds its sentence from the served counts when the server sent no text', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([
      crawl({
        state: 'shrink_pending',
        startedAt: STARTED,
        error: null,
        shrink: { remote: 2, existing: 9 },
      }),
    ]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    expect(
      within(row).getByText(/The source now reports 2 item\(s\) where 9 are synced/),
    ).toBeInTheDocument();
  });

  it('offers the confirm only on a connected row', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([
      {
        ...crawl({ state: 'shrink_pending', startedAt: STARTED, error: 'It shrank.' }),
        status: 'expired',
      },
    ]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    expect(within(row).getByText('It shrank.')).toBeInTheDocument();
    expect(
      within(row).queryByRole('button', { name: 'Yes, remove them and sync' }),
    ).not.toBeInTheDocument();
  });

  it('the confirm: a poll that gives up is said as running on; a 202 re-reads the row', async () => {
    const list = vi
      .spyOn(api.connections, 'list')
      .mockResolvedValue([
        crawl({ state: 'shrink_pending', startedAt: STARTED, error: 'It shrank.' }),
      ]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    const { fail } = runningSync();
    renderWithQuery(<KnowledgeConnections />);
    const row = await rowOf('https://vantagemind.ai/');
    list.mockResolvedValue([crawl(syncing)]);
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, remove them and sync' }));
    expect(await within(row).findByText(/^Crawling…/)).toBeInTheDocument();
    await act(async () => fail(gaveUp()));
    const banner = await screen.findByText(STILL_RUNNING);
    expect(banner.closest('[class*="danger"]')).toBeNull();
    expect(screen.queryByText(/^Synced /)).not.toBeInTheDocument();
  });
});

describe('the crawl dialog', () => {
  const URL_ = 'https://vantagemind.ai/';
  const startCrawl = () => {
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([]);
    vi.spyOn(api.connections, 'list').mockResolvedValue([]);
    return vi.spyOn(api.knowledge, 'startCrawl').mockResolvedValue({
      connectionId: CRAWL,
      provider: 'website_crawl',
      status: 'connected',
      nonSecretConfig: { crawlUrls: [URL_] },
    });
  };
  const submit = async () => {
    renderWithQuery(<KnowledgePillar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Crawl a website' }));
    const dialog = await screen.findByRole('dialog', { name: 'Crawl a website' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.change(within(dialog).getByLabelText(/Page address/), {
      target: { value: URL_ },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crawl this site' }));
    return dialog;
  };
  const closed = () =>
    waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Crawl a website' })).not.toBeInTheDocument(),
    );

  it('a fast success: the byte-identical notice', async () => {
    startCrawl();
    vi.spyOn(api.knowledge, 'syncConnection').mockResolvedValue({
      added: [URL_],
      updated: [],
      removed: [],
    });
    await submit();
    expect(
      await screen.findByText(
        `Crawled ${URL_} — 1 page(s) added. Linked pages on the same site are included, within limits.`,
      ),
    ).toBeInTheDocument();
    await closed();
  });

  it('a 202 closes it with the pending notice, re-reads the rows, and reports the end', async () => {
    startCrawl();
    const { finish } = runningSync();
    const list = vi.mocked(api.connections.list);
    await submit();
    expect(
      await screen.findByText(
        `Crawling ${URL_} — this can take a few minutes. Connected sources shows when it finishes.`,
      ),
    ).toBeInTheDocument();
    await closed();
    expect(screen.queryByText(/^Crawled /)).not.toBeInTheDocument();
    const reads = list.mock.calls.length;
    expect(reads).toBeGreaterThanOrEqual(2);

    await act(async () => finish({ added: [URL_, `${URL_}login`], updated: [], removed: [] }));
    expect(
      await screen.findByText(
        `Crawled ${URL_} — 2 page(s) added. Linked pages on the same site are included, within limits.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Crawling /)).not.toBeInTheDocument();
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(reads));
  });

  it('a failure after the 202 is a danger notice with the served text', async () => {
    startCrawl();
    const { fail } = runningSync();
    await submit();
    await closed();
    await act(async () =>
      fail(new LucielApiError({ code: 'conflict', message: 'Sync unavailable: unreachable.' })),
    );
    const banner = await screen.findByText('Sync unavailable: unreachable.');
    expect(banner.closest('[class*="danger"]')).not.toBeNull();
  });

  it('the poll giving up after the 202: the still-running info, never "Crawled"', async () => {
    startCrawl();
    const { fail } = runningSync();
    await submit();
    await closed();
    await act(async () => fail(gaveUp()));
    const banner = await screen.findByText(STILL_RUNNING);
    expect(banner.closest('[class*="danger"]')).toBeNull();
    expect(screen.queryByText(/^Crawled /)).not.toBeInTheDocument();
  });

  it('a fast real 503 stays in the dialog with the URL and the rights box kept (F169)', async () => {
    startCrawl();
    vi.spyOn(api.knowledge, 'syncConnection').mockRejectedValue(real503());
    const dialog = await submit();
    expect(await within(dialog).findByText(REAL_503)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Crawl a website' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Page address/)).toHaveValue(URL_);
    expect(within(dialog).getByRole('checkbox')).toBeChecked();
  });
});

describe('the pillar’s own re-syncs', () => {
  const shrinkRefusal =
    'The source now reports 1 item(s) where 4 are synced, so nothing was removed. If you did remove them at the source, sync again and confirm the shrink.';

  it('per-source Re-sync is held, with its reason, while the connection serves syncing', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(syncing)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    const resync = vi.spyOn(api.knowledge, 'resyncSource');
    renderWithQuery(<KnowledgePillar />);
    const reason = await screen.findByText(/Re-sync is held until that finishes/);
    const item = reason.closest('li') as HTMLElement;
    const button = within(item).getByRole('button', { name: 'Re-sync' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-describedby', reason.id);
    fireEvent.click(button);
    expect(resync).not.toHaveBeenCalled();
  });

  it('per-source Re-sync that gets a 202: busy ends, the row is re-read, the end is reported', async () => {
    const list = vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(null)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    let finish!: (s: KnowledgeSource) => void;
    vi.spyOn(api.knowledge, 'resyncSource').mockImplementation(
      async (_id: string, opts?: KnowledgeSyncOptions) => {
        opts?.onStarted?.();
        return new Promise<KnowledgeSource>((res) => (finish = res));
      },
    );
    renderWithQuery(<KnowledgePillar />);
    const item = (
      await screen.findByText(page.name, { selector: 'div.truncate.text-vm-2' })
    ).closest('li') as HTMLElement;
    list.mockResolvedValue([crawl(syncing)]);
    fireEvent.click(within(item).getByRole('button', { name: 'Re-sync' }));
    expect(await screen.findByText(/^Syncing — this can take a few minutes/)).toBeInTheDocument();
    expect(await screen.findByText(/Re-sync is held until that finishes/)).toBeInTheDocument();
    expect(screen.queryByText('Working on it…')).not.toBeInTheDocument();
    list.mockResolvedValue([crawl(finished)]);
    await act(async () => finish(page));
    expect(await screen.findByText(`Re-synced “${page.name}”.`)).toBeInTheDocument();
  });

  it('per-source Re-sync whose job shrinks after the 202 still offers the decision', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(null)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    let fail!: (e: unknown) => void;
    vi.spyOn(api.knowledge, 'resyncSource').mockImplementation(
      async (_id: string, opts?: KnowledgeSyncOptions) => {
        opts?.onStarted?.();
        return new Promise<KnowledgeSource>((_res, rej) => (fail = rej));
      },
    );
    renderWithQuery(<KnowledgePillar />);
    const item = (
      await screen.findByText(page.name, { selector: 'div.truncate.text-vm-2' })
    ).closest('li') as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: 'Re-sync' }));
    await screen.findByText(/^Syncing — this can take a few minutes/);
    await act(async () => fail(new LucielApiError({ code: 'conflict', message: shrinkRefusal })));
    expect(
      await screen.findByRole('button', { name: 'Yes, remove them and sync' }),
    ).toBeInTheDocument();
  });

  it('the pillar’s confirm-shrink: the give-up is info, a real 503 is danger, rows are re-read', async () => {
    const list = vi.spyOn(api.connections, 'list').mockResolvedValue([crawl(null)]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([page]);
    vi.spyOn(api.knowledge, 'resyncSource').mockRejectedValue(
      new LucielApiError({ code: 'conflict', message: shrinkRefusal }),
    );
    const sync = vi.spyOn(api.knowledge, 'syncConnection').mockRejectedValueOnce(gaveUp());
    renderWithQuery(<KnowledgePillar />);
    const item = (
      await screen.findByText(page.name, { selector: 'div.truncate.text-vm-2' })
    ).closest('li') as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: 'Re-sync' }));
    const reads = list.mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, remove them and sync' }));
    const banner = await screen.findByText(STILL_RUNNING);
    expect(banner.closest('[class*="danger"]')).toBeNull();
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(reads));
    expect(sync).toHaveBeenCalledWith(CRAWL, expect.objectContaining({ confirmShrink: true }));

    sync.mockRejectedValueOnce(real503());
    fireEvent.click(within(item).getByRole('button', { name: 'Re-sync' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, remove them and sync' }));
    const danger = await screen.findByText(REAL_503);
    expect(danger.closest('[class*="danger"]')).not.toBeNull();
  });
});

describe('the scope panel’s "Sync now"', () => {
  const driveRow = drive(null);
  const open = async () => {
    vi.spyOn(api.knowledge, 'getScope').mockResolvedValue({
      connectionId: DRIVE,
      provider: 'google_drive',
      scopeKind: 'drive_folders',
      selections: [{ id: 'f1', name: 'Pricing', kind: 'selected' }],
      wholeAccount: false,
    });
    renderWithQuery(<KnowledgeScopeSections />);
    return screen.findByRole('button', { name: /Sync now/ });
  };

  it('a 202 lets go of the button, re-reads the rows, and reports the end', async () => {
    const list = vi.spyOn(api.connections, 'list').mockResolvedValue([driveRow]);
    const { spy, finish } = runningSync();
    const button = await open();
    const reads = list.mock.calls.length;
    fireEvent.click(button);
    expect(await screen.findByText(/^Syncing — this can take a few minutes/)).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(reads));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Synced — /)).not.toBeInTheDocument();
    await act(async () => finish({ added: [], updated: [], removed: [] }));
    expect(
      await screen.findByText('Synced — Luciel now reads exactly what you picked.'),
    ).toBeInTheDocument();
  });

  it('a fast outcome re-reads the rows too (the panel never did)', async () => {
    const list = vi.spyOn(api.connections, 'list').mockResolvedValue([driveRow]);
    vi.spyOn(api.knowledge, 'syncConnection').mockResolvedValue({
      added: [],
      updated: [],
      removed: [],
    });
    const button = await open();
    const reads = list.mock.calls.length;
    fireEvent.click(button);
    expect(
      await screen.findByText('Synced — Luciel now reads exactly what you picked.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(reads));
  });
});
