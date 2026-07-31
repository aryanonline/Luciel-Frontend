'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Banner } from '@luciel/ui';
import { LucielApiError } from '@luciel/api-client';
import { useSession } from '@/lib/hooks';

/**
 * Client-side session guard for the dashboard surfaces. HONEST NOTE
 * (Space Instructions §3.7): real enforcement belongs in middleware against the
 * httpOnly session cookie (Arch §3.7.1a), and that is what runs first. On top of
 * it this guard calls api.auth.me() against the backend and routes:
 *   - 401 / no session  → /login
 *   - unverified        → /verify
 *   - verified, no Luciel → /first-run (handled where needed)
 * This is a UX redirect, NOT a security control — the server is the authority.
 */
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

  React.useEffect(() => {
    if (error instanceof LucielApiError) {
      if (error.code === 'unauthorized') router.replace('/login');
      else if (error.code === 'verification_required') router.replace('/verify');
    } else if (data) {
      if (data.nextRoute === 'verify_wall') router.replace('/verify');
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
  if (!data || data.nextRoute !== 'dashboard') {
    // Redirecting; render nothing to avoid a flash of gated content.
    return null;
  }
  return <>{children}</>;
}
