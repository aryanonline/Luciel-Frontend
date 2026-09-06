import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';
import type { KnowledgeQuota, KnowledgeSource } from '@luciel/api-client';
import { LucielApiError } from '@luciel/api-client';

/**
 * 2026-09-05 audit, knowledge pillar UX (F098/F139/F169/F099/F107):
 *  - a failed paste keeps the dialog open with the text still in it;
 *  - a crawl needs the rights acknowledgement before it can start;
 *  - rename exists and works; replace is offered for one-time sources;
 *  - ingestion state is stated on the row;
 *  - the storage meter is never silently absent;
 *  - a batch upload reports every file's verdict;
 *  - a refused shrink turns into a confirmable action.
 */

const listSources = vi.fn<[], Promise<KnowledgeSource[]>>();
const quota = vi.fn<[], Promise<KnowledgeQuota>>();
const pasteText = vi.fn();
const renameSource = vi.fn();
const uploadFile = vi.fn();
const resyncSource = vi.fn();
const syncConnection = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      knowledge: {
        ...actual.api.knowledge,
        listSources: () => listSources(),
        quota: () => quota(),
        pasteText: (req: unknown) => pasteText(req),
        renameSource: (id: string, name: string) => renameSource(id, name),
        uploadFile: (file: File, name: string) => uploadFile(file, name),
        resyncSource: (id: string, opts?: unknown) => resyncSource(id, opts),
        syncConnection: (id: string, opts?: unknown) => syncConnection(id, opts),
      },
    },
  };
});

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

beforeEach(() => {
  listSources.mockReset().mockResolvedValue([source()]);
  quota
    .mockReset()
    .mockResolvedValue({
      usedBytes: 120_000,
      totalBytes: 5_000_000_000,
      perFileMaxBytes: 50_000_000,
    });
  pasteText.mockReset().mockResolvedValue(source({ name: 'Cancellation policy', origin: 'paste' }));
  renameSource
    .mockReset()
    .mockImplementation(async (_id: string, name: string) => source({ name }));
  uploadFile.mockReset().mockResolvedValue(source());
  resyncSource.mockReset().mockResolvedValue(source());
  syncConnection.mockReset().mockResolvedValue({ added: [], updated: [], removed: [] });
});

describe('paste keeps its content when the save fails (F169)', () => {
  it('shows the failure inside the dialog and leaves the text in place', async () => {
    pasteText.mockRejectedValueOnce(new Error('Knowledge quota: over the limit.'));
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Price list.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Paste text' }));
    fireEvent.change(screen.getByLabelText('Name this'), {
      target: { value: 'Cancellation policy' },
    });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Cancel 24h ahead.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to knowledge' }));

    expect(await screen.findByText(/Knowledge quota: over the limit\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Text')).toHaveValue('Cancel 24h ahead.');
    expect(screen.getByLabelText('Name this')).toHaveValue('Cancellation policy');

    // Fixing whatever was wrong and trying again works from the same dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Add to knowledge' }));
    expect(
      await screen.findByText(/Added “Cancellation policy” to your knowledge base\./),
    ).toBeInTheDocument();
    expect(pasteText).toHaveBeenCalledTimes(2);
  });
});

describe('crawl requires the rights acknowledgement (F099)', () => {
  it('keeps the crawl button disabled until the owner confirms their rights', async () => {
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Price list.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Crawl a website' }));
    fireEvent.change(screen.getByLabelText('Page address'), {
      target: { value: 'https://acme.example/services' },
    });
    const crawl = screen.getByRole('button', { name: 'Crawl this site' });
    expect(crawl).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(crawl).toBeEnabled();
  });
});

describe('rename, replace and ingestion state on a source row (F098)', () => {
  it('renames a source through its own dialog', async () => {
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Price list.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Name');
    expect(input).toHaveValue('Price list.pdf');
    fireEvent.change(input, { target: { value: '2026 price list' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename', hidden: false }));
    await waitFor(() =>
      expect(renameSource).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        '2026 price list',
      ),
    );
    expect(await screen.findByText(/Renamed to “2026 price list”\./)).toBeInTheDocument();
  });

  it('offers Replace file for a one-time source and states a failed ingestion', async () => {
    listSources.mockResolvedValue([
      source({ ingestionStatus: 'error' }),
      source({
        sourceId: '22222222-2222-4222-8222-222222222222',
        name: 'Drive — Playbooks',
        origin: 'google_drive',
        syncStatus: 'synced',
        lastSyncedAt: '2026-09-01T00:00:00Z',
      }),
    ]);
    renderWithQuery(<KnowledgePillar />);
    const failed = (await screen.findByText('Price list.pdf')).closest('li') as HTMLElement;
    expect(
      within(failed).getByText(/Could not be processed — replace the file/),
    ).toBeInTheDocument();
    expect(within(failed).getByRole('button', { name: 'Replace file' })).toBeInTheDocument();
    const synced = screen.getByText('Drive — Playbooks').closest('li') as HTMLElement;
    expect(within(synced).queryByRole('button', { name: 'Replace file' })).not.toBeInTheDocument();
  });
});

describe('the storage meter is never silently absent (F139)', () => {
  it('says the usage is unavailable, with a retry, when the quota read fails', async () => {
    quota.mockRejectedValue(new Error('down'));
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Price list.pdf');
    expect(await screen.findByText(/Storage usage is unavailable right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('a batch upload reports every file (F098)', () => {
  it('names the files that landed and the ones that did not', async () => {
    uploadFile
      .mockResolvedValueOnce(source({ name: 'a.txt' }))
      .mockRejectedValueOnce(new Error('could not parse the file'));
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Price list.pdf');
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    const good = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const bad = new File(['%PDF'], 'b.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [good, bad] });
    fireEvent.change(input);
    expect(
      await screen.findByText(/Added 1 of 2 files to your knowledge base\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not added: b\.pdf \(could not parse the file\)/)).toBeInTheDocument();
  });
});

describe('a refused shrink becomes a decision (F107)', () => {
  it('offers to confirm the removals and re-syncs with confirmation', async () => {
    listSources.mockResolvedValue([
      source({
        sourceId: '33333333-3333-4333-8333-333333333333',
        name: 'acme.example/pricing',
        origin: 'website_crawl',
        syncStatus: 'synced',
        lastSyncedAt: '2026-09-01T00:00:00Z',
        connectionId: '44444444-4444-4444-8444-444444444444',
      }),
    ]);
    resyncSource.mockRejectedValueOnce(
      new LucielApiError({
        code: 'conflict',
        message:
          'The source now reports 1 item(s) where 4 are synced, so nothing was removed. If you did remove them at the source, sync again and confirm the shrink.',
      }),
    );
    syncConnection.mockResolvedValueOnce({ added: [], updated: [], removed: ['a', 'b', 'c'] });
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('acme.example/pricing');
    fireEvent.click(screen.getByRole('button', { name: 'Re-sync' }));
    const confirm = await screen.findByRole('button', { name: 'Yes, remove them and sync' });
    expect(screen.getByText(/nothing was removed/)).toBeInTheDocument();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(syncConnection).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', {
        confirmShrink: true,
      }),
    );
    expect(
      await screen.findByText(/3 source\(s\) removed to match the source/),
    ).toBeInTheDocument();
  });
});
