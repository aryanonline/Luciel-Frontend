import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';
import { KnowledgeConnections } from '@/components/config/knowledge-connections';
import { api } from '@/lib/api';
import {
  LucielApiError,
  type Connection,
  type KnowledgeChunkPage,
  type KnowledgeSource,
} from '@luciel/api-client';

/**
 * Round 7 WP-4c — knowledge, as served.
 *
 *  (a) GET /sources/{id}/chunks answers KnowledgeChunkPageOut {chunks, totalChunks,
 *      pageSize}: the preview says "Showing the first 10 of <totalChunks> pieces",
 *      never the page length; an older bare list claims no total.
 *  (b) D10: a source paused for reconnect keeps answering seven days from
 *      `pausedSince`, then stops — "stops answering on <date>", then "No longer
 *      answering — reconnect to resume". Without a served date, no date is claimed.
 *  (c) An origin tombstone is not restorable: a listed one offers no actions and
 *      says why; the restore route's 409 renders verbatim and the Undo goes away.
 *  (d) A manual re-sync on a revoked grant marks the connection broken server-side
 *      before the 409 — the chip re-reads the served status, never a local green.
 */

const DAY = 24 * 60 * 60 * 1000;
const day = (d: Date) => d.toLocaleDateString(undefined, { dateStyle: 'medium' });

const source = (over: Partial<KnowledgeSource> = {}): KnowledgeSource => ({
  sourceId: '11111111-1111-4111-8111-111111111111',
  name: 'Price list.pdf',
  origin: 'upload',
  ingestionStatus: 'ready',
  sizeBytes: 120_000,
  lastUpdatedAt: '2026-09-01T00:00:00Z',
  usedByQuestions7d: 0,
  ...over,
});

const page = (n: number, totalChunks: number | null): KnowledgeChunkPage => ({
  chunks: Array.from({ length: n }, (_, i) => ({
    chunkId: `c0c0c0c0-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    sourceId: '11111111-1111-4111-8111-111111111111',
    ordinal: i,
    text: `piece ${i + 1}`,
  })),
  totalChunks,
  pageSize: totalChunks === null ? null : 20,
});

beforeEach(() => {
  vi.spyOn(api.knowledge, 'quota').mockResolvedValue({
    usedBytes: 120_000,
    totalBytes: 5_000_000_000,
    perFileMaxBytes: 50_000_000,
  });
});
afterEach(() => vi.restoreAllMocks());

async function openPreview(chunks: KnowledgeChunkPage) {
  vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([source()]);
  vi.spyOn(api.knowledge, 'getChunks').mockResolvedValue(chunks);
  renderWithQuery(<KnowledgePillar />);
  await screen.findByText('Price list.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  return screen.findByRole('dialog');
}

describe('(a) chunk preview counts what is served', () => {
  it('says "first 10 of <totalChunks>" from the served total, not the page length', async () => {
    const dialog = await openPreview(page(20, 300));
    expect(
      await within(dialog).findByText('Showing the first 10 of 300 pieces.'),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(11);
  });

  it('claims no total for an older server that sent only the page', async () => {
    const dialog = await openPreview(page(20, null));
    expect(await within(dialog).findByText('Showing the first 10 pieces.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/of 20 pieces/)).not.toBeInTheDocument();
  });

  it('says nothing extra when every piece is on screen', async () => {
    const dialog = await openPreview(page(4, 4));
    await within(dialog).findByText('piece 4');
    expect(within(dialog).queryByTestId('chunk-count')).not.toBeInTheDocument();
  });
});

describe('(b) D10 — a paused source answers for seven days, then stops', () => {
  it('renders the served pause as "stops answering on <date>", then "no longer answering"', async () => {
    const recent = new Date(Date.now() - 3 * DAY);
    const old = new Date(Date.now() - 9 * DAY);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([
      source({
        sourceId: '22222222-2222-4222-8222-222222222222',
        name: 'Notion — Client onboarding',
        origin: 'notion',
        syncStatus: 'paused_reconnect_needed',
        pausedSince: recent.toISOString(),
      }),
      source({
        sourceId: '33333333-3333-4333-8333-333333333333',
        name: 'HubSpot KB — Returns policy',
        origin: 'crm_kb',
        syncStatus: 'paused_reconnect_needed',
        pausedSince: old.toISOString(),
      }),
      source({
        sourceId: '44444444-4444-4444-8444-444444444444',
        name: 'Drive — undated pause',
        origin: 'google_drive',
        syncStatus: 'paused_reconnect_needed',
      }),
    ]);
    renderWithQuery(<KnowledgePillar />);

    const recentRow = (await screen.findByText('Notion — Client onboarding')).closest(
      'li',
    ) as HTMLElement;
    expect(
      within(recentRow).getByText(
        `Paused — reconnect needed. Luciel still answers from it; it stops answering on ${day(new Date(recent.getTime() + 7 * DAY))}.`,
      ),
    ).toBeInTheDocument();
    expect(within(recentRow).getByText('Reconnect needed')).toBeInTheDocument();

    const oldRow = screen.getByText('HubSpot KB — Returns policy').closest('li') as HTMLElement;
    expect(
      within(oldRow).getByText('No longer answering — reconnect to resume.'),
    ).toBeInTheDocument();

    const undated = screen.getByText('Drive — undated pause').closest('li') as HTMLElement;
    expect(within(undated).getByTestId('knowledge-paused').textContent).not.toMatch(/on \w+ \d/);
  });
});

describe('(c) an origin tombstone is not restorable', () => {
  it('a listed origin tombstone offers no actions and says why', async () => {
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([
      source({
        name: 'Old pricing page',
        origin: 'website_crawl',
        syncStatus: 'synced',
        deletedBy: 'origin',
      }),
    ]);
    renderWithQuery(<KnowledgePillar />);
    const row = (await screen.findByText('Old pricing page')).closest('li') as HTMLElement;
    expect(
      within(row).getByText(/Removed at its source, so it cannot be restored here/),
    ).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it("the restore route's 409 renders verbatim and the Undo goes away", async () => {
    const served =
      'Price list.pdf was removed at its sync source (website_crawl) and cannot be restored here. Re-add it at the source and sync again.';
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([source()]);
    vi.spyOn(api.knowledge, 'deleteSource').mockResolvedValue(undefined);
    vi.spyOn(api.knowledge, 'restoreSource').mockRejectedValue(
      new LucielApiError({ code: 'conflict', message: served }),
    );
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Price list.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    expect(await screen.findByText(served)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Undo/ })).not.toBeInTheDocument();
  });

  it('a re-sync that finds the item gone at its origin says so and re-reads the list', async () => {
    const list = vi
      .spyOn(api.knowledge, 'listSources')
      .mockResolvedValue([source({ origin: 'website_crawl', syncStatus: 'synced' })]);
    vi.spyOn(api.knowledge, 'resyncSource').mockRejectedValue(
      new LucielApiError({
        code: 'not_found',
        message: 'Source no longer exists at the sync origin.',
      }),
    );
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Price list.pdf');
    const calls = list.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Re-sync' }));
    expect(
      await screen.findByText('Source no longer exists at the sync origin.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(calls));
  });
});

describe('(d) a re-sync on a revoked grant: the chip follows the served status', () => {
  const drive = (status: Connection['status']): Connection => ({
    connectionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    connectionType: 'knowledge_source',
    provider: 'google_drive',
    displayName: 'Google Drive',
    providerAvailable: true,
    status,
    statusDetail:
      status === 'error' ? 'knowledge sync could not use the stored credential — reconnect' : null,
    createdAt: '2026-02-01T10:10:00Z',
  });

  it('re-reads connections after the 409 — Connected becomes the served broken state', async () => {
    const list = vi
      .spyOn(api.connections, 'list')
      .mockResolvedValueOnce([drive('connected')])
      .mockResolvedValue([drive('error')]);
    vi.spyOn(api.connections, 'listProviders').mockResolvedValue([]);
    vi.spyOn(api.knowledge, 'listSources').mockResolvedValue([]);
    vi.spyOn(api.knowledge, 'syncConnection').mockRejectedValue(
      new LucielApiError({
        code: 'conflict',
        message: 'Sync unavailable: the provider refused the stored credential — reconnect it.',
      }),
    );
    renderWithQuery(<KnowledgeConnections />);
    const rows = await screen.findByRole('list', { name: 'Connected sources' });
    expect(within(rows).getByText('Connected')).toBeInTheDocument();

    fireEvent.click(within(rows).getByRole('button', { name: 'Re-sync' }));
    expect(await screen.findByText(/Sync unavailable: the provider refused/)).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(rows).queryByText('Connected')).not.toBeInTheDocument());
    expect(within(rows).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });
});
