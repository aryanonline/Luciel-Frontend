import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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
import type { Connection, KnowledgeSource, KnowledgeSyncJob } from '@luciel/api-client';

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
    expect(resync).toBeDisabled();
    expect(resync).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(resync);
    expect(sync).not.toHaveBeenCalled();
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
    const list = vi
      .spyOn(api.connections, 'list')
      .mockResolvedValueOnce([crawl(syncing)])
      .mockResolvedValue([
        crawl({
          state: 'synced',
          startedAt: STARTED,
          finishedAt: '2026-10-25T22:28:40Z',
          result: { added: ['https://vantagemind.ai/'], updated: [], removed: [] },
        }),
      ]);
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
    const sourceReads = sources.mock.calls.length;
    const quotaReads = quota.mock.calls.length;

    await waitFor(() => expect(within(row).queryByText(/^Crawling…/)).not.toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(sources.mock.calls.length).toBeGreaterThan(sourceReads));
    await waitFor(() => expect(quota.mock.calls.length).toBeGreaterThan(quotaReads));
    expect(within(row).getByRole('button', { name: 'Re-sync' })).toBeEnabled();
    // Finished: the interval is off again.
    const settled = list.mock.calls.length;
    await new Promise((r) => setTimeout(r, SYNC_POLL_MS + 300));
    expect(list.mock.calls.length).toBe(settled);
  }, 10_000);
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
    expect(within(row).getByRole('button', { name: 'Re-sync' })).toBeEnabled();
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
    expect(sync).toHaveBeenCalledWith(CRAWL, { confirmShrink: true });
  });
});

describe('a first crawl still running past the poll limit', () => {
  it('closes the dialog and says it is still syncing — never "Crawled"', async () => {
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([]);
    vi.spyOn(api.connections, 'list').mockResolvedValue([]);
    vi.spyOn(api.knowledge, 'startCrawl').mockResolvedValue({
      connectionId: CRAWL,
      provider: 'website_crawl',
      status: 'connected',
      nonSecretConfig: { crawlUrls: ['https://vantagemind.ai/'] },
    });
    vi.spyOn(api.knowledge, 'syncConnection').mockRejectedValue(
      new LucielApiError({
        code: 'service_unavailable',
        message: 'Still syncing — it will finish on its own. Check this source in a minute.',
      }),
    );
    renderWithQuery(<KnowledgePillar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Crawl a website' }));
    const dialog = await screen.findByRole('dialog', { name: 'Crawl a website' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.change(within(dialog).getByLabelText(/Page address/), {
      target: { value: 'https://vantagemind.ai/' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crawl this site' }));
    expect(
      await screen.findByText(
        'Still syncing — it will finish on its own. Check this source in a minute.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Crawl a website' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/^Crawled /)).not.toBeInTheDocument();
  });
});
