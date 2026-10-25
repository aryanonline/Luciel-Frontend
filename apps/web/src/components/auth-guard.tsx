'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Banner } from '@luciel/ui';
import { LucielApiError } from '@luciel/api-client';
import { useSession } from '@/lib/hooks';
import {
  ACCOUNT_CLOSED_LOGIN_PATH,
  ACCOUNT_CLOSED_PATH,
  isAccountClosedError,
  sessionIsClosed,
  signedOutByClosure,
} from '@/lib/account-closed';

/**
 * Client-side session guard for the dashboard surfaces. HONEST NOTE
 * (Space Instructions §3.7): real enforcement belongs in middleware against the
 * httpOnly session cookie (Arch §3.7.1a), and that is what runs first. On top of
 * it this guard calls api.auth.me() against the backend and routes:
 *   - 401 / no session  → /login (reason=account_closed right after a closure made
 *     in this page — the closure signs the owner out — otherwise session_expired)
 *   - unverified        → /verify
 *   - verified, no Luciel → /first-run (handled where needed)
 *   - CLOSED account      → /account-closed (round 7 WP-5 / D5): the session is
 *     fine — the owner signed in — so it is never a bounce to /login; every
 *     admin route would answer the typed 403 `account_closed` anyway.
 * This is a UX redirect, NOT a security control — the server is the authority.
 */
/**
 * Round 7 WP-12: the session cookie was present (the middleware let the page
 * through) but the API refused it — it expired, or a password reset revoked it.
 * Say so on the login page (`reason=session_expired`) instead of dropping the
 * owner there with no explanation, and keep where they were going.
 */
export const SESSION_EXPIRED_REASON = 'session_expired';
function sessionExpiredLogin(): string {
  const params = new URLSearchParams({ reason: SESSION_EXPIRED_REASON });
  const here = typeof window !== 'undefined' ? window.location.pathname : '';
  if (here.startsWith('/') && !here.startsWith('//') && here !== '/') params.set('next', here);
  return `/login?${params.toString()}`;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useSession();

  /**
   * The two codes above are the only ones this guard can answer by navigating.
   * Anything else — a 500, a dropped connection — leaves it with no route to
   * send the admin to, and it used to render nothing at all: a permanent blank
   * page during an outage, indistinguishable from a broken build (P1-15).
   */
  const redirecting =
    error instanceof LucielApiError &&
    (error.code === 'unauthorized' || error.code === 'verification_required');
  const unexplained = error !== null && !redirecting;
  const closed = sessionIsClosed(data);

  React.useEffect(() => {
    if (error instanceof LucielApiError) {
      // A typed account_closed outranks the 403 → unauthorized mapping (D5).
      if (isAccountClosedError(error)) router.replace(ACCOUNT_CLOSED_PATH);
      // The owner just closed the account here: the 401 is the closure's sign-out
      // (the server bumped the session epoch), never "your session expired".
      else if (error.code === 'unauthorized' && signedOutByClosure())
        router.replace(ACCOUNT_CLOSED_LOGIN_PATH);
      else if (error.code === 'unauthorized') router.replace(sessionExpiredLogin());
      else if (error.code === 'verification_required') router.replace('/verify');
    } else if (data) {
      // The served account state outranks nextRoute: a closed account still has a
      // Luciel row in its grace window, so the server may say "dashboard".
      if (sessionIsClosed(data)) router.replace(ACCOUNT_CLOSED_PATH);
      else if (data.nextRoute === 'verify_wall') router.replace('/verify');
      else if (data.nextRoute === 'first_run') router.replace('/first-run');
    }
  }, [data, error, router]);

  if (isLoading) {
    return (
      <div className="py-vm-8 text-vm-1 text-vm-text-muted" role="status">
        Loading…
      </div>
    );
  }
  if (unexplained) {
    return (
      <Banner tone="danger" className="my-vm-6">
        We could not check your session, so we have not loaded your dashboard. You are still logged
        in — this is a problem reaching us, not a problem with your account.{' '}
        <button className="underline" onClick={() => void refetch()}>
          Try again
        </button>
      </Banner>
    );
  }
  if (!data || closed || data.nextRoute !== 'dashboard') {
    // Redirecting; render nothing to avoid a flash of gated content.
    return null;
  }
  return <>{children}</>;
}
