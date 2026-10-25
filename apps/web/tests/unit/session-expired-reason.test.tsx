import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { LucielApiError } from '@luciel/api-client';
import { api } from '@/lib/api';
import { AuthGuard } from '@/components/auth-guard';
import LoginPage from '@/app/(auth)/login/page';

/**
 * Round 7 WP-12 (the expired_session scenario project): a session the browser still
 * holds but the API refuses — expired, or revoked by a password reset — bounces the
 * owner to /login WITH the reason and the page they were on, and the login page says
 * why instead of greeting them as if nothing happened.
 */

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard/leads',
  useParams: () => ({}),
}));

afterEach(() => {
  vi.restoreAllMocks();
  replace.mockReset();
  window.history.replaceState(null, '', '/');
});

describe('session expired', () => {
  it('the guard sends a refused session to /login with the reason and where it was', async () => {
    window.history.replaceState(null, '', '/dashboard/leads');
    vi.spyOn(api.auth, 'me').mockRejectedValue(
      new LucielApiError({ code: 'unauthorized', message: 'Session expired.' }),
    );
    renderWithQuery(
      <AuthGuard>
        <p>gated</p>
      </AuthGuard>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        '/login?reason=session_expired&next=%2Fdashboard%2Fleads',
      ),
    );
    expect(screen.queryByText('gated')).not.toBeInTheDocument();
  });

  it('the login page says the session ended when sent there for that reason', async () => {
    window.history.replaceState(null, '', '/login?reason=session_expired');
    renderWithQuery(<LoginPage />);
    expect(await screen.findByTestId('login-reason')).toHaveTextContent(
      'Your session has ended — it expired or was signed out elsewhere.',
    );
  });

  it('a plain visit to the login page carries no reason, and an unknown reason is not echoed', async () => {
    window.history.replaceState(null, '', '/login?reason=%3Cscript%3E');
    renderWithQuery(<LoginPage />);
    await screen.findByRole('button', { name: 'Log in' });
    expect(screen.queryByTestId('login-reason')).not.toBeInTheDocument();
  });

  // The copy map is a plain object: an inherited key is not a reason. `__proto__`
  // used to hand React Object.prototype as a child (the page crashed) and
  // `constructor` rendered an empty banner.
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'an inherited key (?reason=%s) is not a reason: no banner, and the page renders',
    async (key) => {
      window.history.replaceState(null, '', `/login?reason=${key}`);
      renderWithQuery(<LoginPage />);
      // render() flushes the after-mount reason read, so the form being there means
      // the page survived it.
      await screen.findByRole('button', { name: 'Log in' });
      expect(screen.queryByTestId('login-reason')).not.toBeInTheDocument();
    },
  );
});
