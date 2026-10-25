import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { LucielApiError } from '@luciel/api-client';
import AccountPage from '@/app/(app)/dashboard/account/page';
import LoginPage from '@/app/(auth)/login/page';
import { AuthGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import {
  clearSignedOutByClosure,
  markSignedOutByClosure,
  signedOutByClosure,
} from '@/lib/account-closed';

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

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard/account',
  useParams: () => ({}),
}));

beforeEach(() => {
  closeAccount.mockReset().mockResolvedValue(undefined);
  replace.mockReset();
  clearSignedOutByClosure();
  window.history.replaceState(null, '', '/');
});
afterEach(() => vi.restoreAllMocks());

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
    // A refused close signed nobody out and navigated nowhere.
    expect(replace).not.toHaveBeenCalled();
    expect(signedOutByClosure()).toBe(false);
  });
});

/**
 * Live walk run 7 (2026-10-25): closing bumps the session epoch, so the next call
 * answers 401. The page used to `router.replace('/')`, the guard read that 401 as an
 * expired session, and the owner who had just closed the account was told "your
 * session expired". Closing now signs the owner out to the login page with the
 * closure's own reason; a 401 that races that navigation goes to the same place.
 */
describe('closing signs the owner out', () => {
  it('a successful close goes to /login?reason=account_closed, not /', async () => {
    const dialog = await openCloseDialog();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete my Luciel and close account' }),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=account_closed'));
    expect(replace).not.toHaveBeenCalledWith('/');
    expect(signedOutByClosure()).toBe(true);
  });

  it('the guard sends a 401 after a closure to the closed-account login, never session_expired', async () => {
    const dialog = await openCloseDialog();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete my Luciel and close account' }),
    );
    await waitFor(() => expect(signedOutByClosure()).toBe(true));
    replace.mockReset();

    // The session read that lands after the closure: the epoch was bumped.
    window.history.replaceState(null, '', '/dashboard/account');
    vi.spyOn(api.auth, 'me').mockRejectedValue(
      new LucielApiError({ code: 'unauthorized', message: 'Session revoked.' }),
    );
    renderWithQuery(
      <AuthGuard>
        <p>gated</p>
      </AuthGuard>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=account_closed'));
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining('session_expired'));
  });

  it('the login page says the account is closed and what the 30 days allow', async () => {
    window.history.replaceState(null, '', '/login?reason=account_closed');
    renderWithQuery(<LoginPage />);
    const reason = await screen.findByTestId('login-reason');
    expect(reason).toHaveTextContent('Your account is closed, and closing it signed you out.');
    expect(reason).toHaveTextContent(
      'For 30 days you can still log in here to download your data again or reopen the account',
    );
    expect(reason).toHaveTextContent('after that, everything is permanently deleted.');
    expect(reason).not.toHaveTextContent(/session/i);
  });

  it('signing in again ends the closure sign-out: a later 401 is an expired session again', async () => {
    markSignedOutByClosure(); // what a confirmed close did (pinned above)
    window.history.replaceState(null, '', '/login?reason=account_closed');
    vi.spyOn(api.auth, 'login').mockResolvedValue({
      account: {
        adminId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        email: 'owner@example.com',
        state: 'closed',
        createdAt: '2026-01-15T14:00:00Z',
        emailVerified: true,
        hasCompletedFirstRun: true,
        hasLuciel: true,
      },
      nextRoute: 'dashboard',
      notices: [],
    });
    renderWithQuery(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'pw-123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    // A closed account signs in to the reduced page (D5).
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account-closed'));
    expect(signedOutByClosure()).toBe(false);
  });
});
