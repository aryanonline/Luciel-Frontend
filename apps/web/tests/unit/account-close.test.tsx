import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import AccountPage from '@/app/(app)/dashboard/account/page';

/**
 * Round 7 WP-10, item 13 — closing the account subsumes deleting the Luciel.
 *
 * The backend accepts `confirmDeleteLuciel` and runs the fused delete-then-close
 * itself (round 6 WP-D, F156), yet the page disabled "Close my account" while a
 * Luciel existed and told the owner to delete it first; and the confirmation said
 * transcripts were "retained for 1 year" when the cascade deletes everything at
 * day 30 (Legal §B5). Pinned here: Close is enabled with a running Luciel; the
 * confirmation states the Luciel is deleted first, offers the export, and says
 * ALL data is deleted 30 days after closure; and the confirmed close carries
 * `confirmDeleteLuciel: true`.
 */

const closeAccount = vi.fn<(opts?: { confirmDeleteLuciel?: boolean }) => Promise<void>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      account: {
        ...actual.api.account,
        close: (opts?: { confirmDeleteLuciel?: boolean }) => closeAccount(opts),
      },
    },
  };
});

beforeEach(() => {
  closeAccount.mockReset().mockResolvedValue(undefined);
});

/** Render, wait for the served (ACTIVE) Luciel, and open the close confirmation. */
async function openCloseDialog() {
  renderWithQuery(<AccountPage />);
  // The mock's verified scenario serves an ACTIVE Luciel; the note below the button
  // renders only once that read has landed, so the dialog opens on the live copy.
  await screen.findByText(/let closing do it/i);
  const closeButton = screen.getByRole('button', { name: 'Close my account' });
  expect(closeButton).toBeEnabled();
  fireEvent.click(closeButton);
  return screen.findByRole('dialog', { name: 'Close your account?' });
}

describe('close account with a Luciel still running (subsumed delete)', () => {
  it('enables Close, and the confirmation says the Luciel is deleted first and all data goes at day 30', async () => {
    const dialog = await openCloseDialog();
    expect(screen.queryByText(/Delete your Luciel first/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/closing deletes it first/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/permanently deleted 30 days after closure/i),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/1 year/i)).not.toBeInTheDocument();
    // The export is offered inside the confirmation, before anything ends.
    expect(
      within(dialog).getByRole('button', { name: 'Download all my data' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Delete my Luciel and close account' }),
    ).toBeEnabled();
  });

  it('confirms with confirmDeleteLuciel: true', async () => {
    const dialog = await openCloseDialog();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete my Luciel and close account' }),
    );
    await waitFor(() => expect(closeAccount).toHaveBeenCalledTimes(1));
    expect(closeAccount).toHaveBeenCalledWith({ confirmDeleteLuciel: true });
  });

  it('keeps the dialog open with the reason when the close is refused', async () => {
    closeAccount.mockRejectedValue(
      new Error('Your Luciel is still active. Delete it first, or confirm that closing the account deletes it.'),
    );
    const dialog = await openCloseDialog();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete my Luciel and close account' }),
    );
    expect(await within(dialog).findByText(/Your Luciel is still active/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Close your account?' })).toBeInTheDocument();
  });
});
