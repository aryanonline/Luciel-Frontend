'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LucielApiError } from '@luciel/api-client';
import { ACCOUNT_CLOSED_PATH, isAccountClosedError } from './account-closed';

/**
 * TanStack Query provider (server state — Space Instructions §2). A global
 * onError-style retry guard makes 401 (unauthorized) non-retryable so a
 * mid-session expiry routes to login cleanly rather than hammering the API
 * (Arch §3.7.1a). The actual redirect-on-401 is wired in a future auth PR.
 *
 * Round 7 WP-5 / D5: ANY query or mutation refused with the typed 403
 * `account_closed` (the account was closed — in another tab, or before this page
 * loaded) routes to the closed-account page. Without this, each page painted its
 * own "could not load" banner over an account that simply is closed.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const routerRef = React.useRef(router);
  routerRef.current = router;

  const [client] = React.useState(() => {
    const onError = (error: unknown) => {
      if (!isAccountClosedError(error)) return;
      if (typeof window !== 'undefined' && window.location.pathname === ACCOUNT_CLOSED_PATH) {
        return; // the reduced page renders the refusal itself (window ended)
      }
      routerRef.current.replace(ACCOUNT_CLOSED_PATH);
    };
    return new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          retry: (failureCount, error) => {
            if (error instanceof LucielApiError) {
              if (error.code === 'unauthorized' || error.code === 'verification_required') {
                return false;
              }
            }
            return failureCount < 2;
          },
        },
      },
    });
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
