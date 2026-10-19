import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { renderWithQuery } from './test-utils';
import { LucielApiError, type AccountStatus, type Session } from '@luciel/api-client';
import AccountClosedPage from '@/app/(app)/account-closed/page';
import LoginPage from '@/app/(auth)/login/page';
import { AuthGuard } from '@/components/auth-guard';
import { middleware } from '@/middleware';
import { api } from '@/lib/api';

/**
 * Round 7 WP-5 / owner decision D5 — the closed-account reduced page.
 *
 * A closed account still signs in; for 30 days it may read its status, reopen, and
 * re-request its export, and every other admin route answers the typed 403
 * `account_closed` (`detail.reopenUntil`). Pinned here: the page renders the served
 * status with EXACTLY two actions; reopen and re-export each show pending, success
 * and error; past the window the page says so with no actions; and every guard —
 * the login redirect, the dashboard AuthGuard, the middleware — sends a closed
 * account to /account-closed instead of bouncing it to /login.
 */

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/account-closed',
  useParams: () => ({}),
}));

const DAY = 24 * 60 * 60 * 1000;
const closedAt = new Date(Date.now() - 3 * DAY).toISOString();
const reopenUntil = new Date(Date.now() + 27 * DAY).toISOString();
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });

const closedStatus: AccountStatus = {
  state: 'closed',
  closedAt,
  reopenUntil,
  canReopen: true,
  lucielRestoredOnReopen: true,
};

const closedRefusal = (until: string | null) =>
  new LucielApiError({
    code: 'unauthorized',
    message: 'Account closed.',
    reason: 'account_closed',
    detail: { closedAt, reopenUntil: until },
  });

function closedSession(nextRoute: Session['nextRoute'] = 'dashboard'): Session {
  return {
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
    nextRoute,
    notices: [],
  };
}

beforeEach(() => {
  replace.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('the reduced page', () => {
  it('renders the served closure and exactly two actions', async () => {
    vi.spyOn(api.account, 'status').mockResolvedValue(closedStatus);
    renderWithQuery(<AccountClosedPage />);

    expect(
      await screen.findByRole('heading', { name: 'Your account is closed' }),
    ).toBeInTheDocument();
    expect(screen.getByText(`You closed it on ${day(closedAt)}.`)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Until ${day(reopenUntil)} you can reopen`)),
    ).toBeInTheDocument();
    expect(screen.getByText(/including your Luciel/)).toBeInTheDocument();

    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Reopen my account', 'Download my data again']);
    expect(replace).not.toHaveBeenCalled();
  });

  it('reopens: pending, then what the server says came back', async () => {
    vi.spyOn(api.account, 'status').mockResolvedValue(closedStatus);
    let resolve!: (v: Awaited<ReturnType<typeof api.account.reopen>>) => void;
    const reopen = vi
      .spyOn(api.account, 'reopen')
      .mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithQuery(<AccountClosedPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reopen my account' }));
    expect(await screen.findByRole('button', { name: 'Reopening…' })).toBeDisabled();
    resolve({
      state: 'verified',
      lucielRestored: true,
      lucielState: 'paused',
      billingState: 'free_cap',
    });

    expect(
      await screen.findByRole('heading', { name: 'Your account is open again' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your Luciel is back, paused as it was/)).toBeInTheDocument();
    expect(screen.getByText(/free starter allowance/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it('a refused reopen says why and leaves the account closed', async () => {
    vi.spyOn(api.account, 'status').mockResolvedValue(closedStatus);
    vi.spyOn(api.account, 'reopen').mockRejectedValue(
      new LucielApiError({ code: 'conflict', message: 'This account can no longer be reopened.' }),
    );
    renderWithQuery(<AccountClosedPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reopen my account' }));
    expect(await screen.findByText('This account can no longer be reopened.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your account is closed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen my account' })).toBeEnabled();
  });

  it('re-requests the export and shows the link with the served email outcome', async () => {
    vi.spyOn(api.account, 'status').mockResolvedValue(closedStatus);
    vi.spyOn(api.account, 'requestExport').mockResolvedValue({
      ok: true,
      downloadUrl: 'https://api.example.com/api/v1/exports/tok',
      ttlDays: 7,
      emailOutcome: 'no_sender',
    });
    renderWithQuery(<AccountClosedPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Download my data again' }));
    expect(await screen.findByRole('link', { name: 'Download your export' })).toHaveAttribute(
      'href',
      'https://api.example.com/api/v1/exports/tok',
    );
    expect(screen.getByText(/could not email this link/)).toBeInTheDocument();
    expect(screen.queryByText(/also emailed this link/)).not.toBeInTheDocument();
  });

  it('a failed re-export says so and keeps the action', async () => {
    vi.spyOn(api.account, 'status').mockResolvedValue(closedStatus);
    vi.spyOn(api.account, 'requestExport').mockRejectedValue(
      new LucielApiError({
        code: 'server_error',
        message: 'The export could not be built right now.',
      }),
    );
    renderWithQuery(<AccountClosedPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Download my data again' }));
    expect(await screen.findByText('The export could not be built right now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download my data again' })).toBeEnabled();
  });

  it('past the window: the served end date, and nothing to click', async () => {
    const ended = new Date(Date.now() - DAY).toISOString();
    vi.spyOn(api.account, 'status').mockRejectedValue(closedRefusal(ended));
    renderWithQuery(<AccountClosedPage />);

    expect(await screen.findByText(new RegExp(`ended on ${day(ended)}`))).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/login/));
  });

  it('an account that is open is sent to the dashboard', async () => {
    vi.spyOn(api.account, 'status').mockResolvedValue({
      state: 'verified',
      closedAt: null,
      reopenUntil: null,
      canReopen: false,
      lucielRestoredOnReopen: false,
    });
    renderWithQuery(<AccountClosedPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});

describe('every guard routes a closed account to the reduced page, never to /login', () => {
  it('AuthGuard: a closed session (nextRoute dashboard) goes to /account-closed', async () => {
    vi.spyOn(api.auth, 'me').mockResolvedValue(closedSession('dashboard'));
    renderWithQuery(
      <AuthGuard>
        <p>dashboard content</p>
      </AuthGuard>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account-closed'));
    expect(replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/login/));
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument();
  });

  it('AuthGuard: a typed account_closed refusal goes to /account-closed, not /login', async () => {
    vi.spyOn(api.auth, 'me').mockRejectedValue(closedRefusal(reopenUntil));
    renderWithQuery(
      <AuthGuard>
        <p>dashboard content</p>
      </AuthGuard>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account-closed'));
    expect(replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/login/));
  });

  it('AuthGuard: a plain 401 still goes to /login', async () => {
    vi.spyOn(api.auth, 'me').mockRejectedValue(
      new LucielApiError({ code: 'unauthorized', message: 'Session expired.' }),
    );
    renderWithQuery(
      <AuthGuard>
        <p>dashboard content</p>
      </AuthGuard>,
    );
    // Round 7 WP-12: with the reason the login page explains.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=session_expired'));
  });

  it('login: a closed account lands on /account-closed whatever nextRoute says', async () => {
    vi.spyOn(api.auth, 'login').mockResolvedValue(closedSession('first_run'));
    renderWithQuery(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'pw-123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account-closed'));
  });

  it('middleware: /account-closed needs the session cookie, and passes with one', () => {
    const bare = middleware(new NextRequest('https://app.example.com/account-closed'));
    expect(bare.status).toBe(307);
    expect(bare.headers.get('location')).toContain('/login?next=%2Faccount-closed');

    const withCookie = new NextRequest('https://app.example.com/account-closed', {
      headers: { cookie: 'luciel_session=opaque' },
    });
    const passed = middleware(withCookie);
    expect(passed.headers.get('location')).toBeNull();
  });
});
