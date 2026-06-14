'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LucielApiError } from '@luciel/api-client';
import { useSession } from '@/lib/hooks';

/**
 * Client-side session guard for the dashboard surfaces. HONEST NOTE
 * (Space Instructions §3.7): real enforcement belongs in middleware against the
 * httpOnly session cookie (Arch §3.7.1a). Because this build runs against the
 * mock with no backend, the guard calls api.auth.me() and routes:
 *   - 401 / no session  → /login
 *   - unverified        → /verify
 *   - verified, no Luciel → /first-run (handled where needed)
 * This is a UX redirect, NOT a security control — the server is the authority.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading, error } = useSession();

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
  if (error || !data || data.nextRoute !== 'dashboard') {
    // Redirecting; render nothing to avoid a flash of gated content.
    return null;
  }
  return <>{children}</>;
}
