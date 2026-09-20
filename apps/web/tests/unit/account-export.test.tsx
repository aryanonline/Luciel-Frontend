import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import AccountPage from '@/app/(app)/dashboard/account/page';
import { LucielApiError } from '@luciel/api-client';

/**
 * Round 7 WP-10, item 12 — the export link the UI threw away.
 *
 * POST /admin/account/export answers with the time-limited download link, and the
 * account page discarded it: email was the only delivery, and a request that
 * FAILED closed the dialog exactly like one that worked. Pinned here: on success
 * the dialog shows the served link (and still says it was emailed); on failure it
 * stays open with the reason, and no link is claimed.
 */

const requestExport = vi.fn<() => Promise<unknown>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      account: {
        ...actual.api.account,
        requestExport: () => requestExport(),
      },
    },
  };
});

beforeEach(() => {
  requestExport.mockReset();
});

async function openExportAndPrepare() {
  renderWithQuery(<AccountPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Download all my data' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare my export' }));
}

describe('account export shows the served link, or the failure', () => {
  it('renders the download link and its life on success, and keeps the email sentence', async () => {
    requestExport.mockResolvedValue({
      ok: true,
      downloadUrl: 'https://api.example.com/api/v1/admin/account/export/abc',
      ttlDays: 7,
    });
    await openExportAndPrepare();

    const link = await screen.findByRole('link', { name: 'Download your export' });
    expect(link).toHaveAttribute('href', 'https://api.example.com/api/v1/admin/account/export/abc');
    expect(screen.getByText(/It works for 7 days/)).toBeInTheDocument();
    expect(screen.getByText(/also emailed this link to you/i)).toBeInTheDocument();
    // The dialog is still open — the link is what the owner came for.
    expect(screen.getByRole('dialog', { name: 'Download all your data' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare my export' })).not.toBeInTheDocument();
  });

  it('degrades to the email sentence alone when an older server returns no link', async () => {
    requestExport.mockResolvedValue({ ok: true });
    await openExportAndPrepare();

    expect(await screen.findByText(/Your export is ready/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download your export' })).not.toBeInTheDocument();
    expect(screen.getByText(/We emailed the download link to you/i)).toBeInTheDocument();
  });

  it('keeps the dialog open with the reason when the request fails, and claims no link', async () => {
    requestExport.mockRejectedValue(
      new LucielApiError({
        code: 'server_error',
        message: 'The export could not be built right now.',
      }),
    );
    await openExportAndPrepare();

    expect(await screen.findByText(/The export could not be built right now/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Download all your data' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download your export' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Your export is ready/)).not.toBeInTheDocument();
    // The action is still there to retry.
    expect(screen.getByRole('button', { name: 'Prepare my export' })).toBeEnabled();
  });
});
