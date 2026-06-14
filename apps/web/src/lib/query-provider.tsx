'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LucielApiError } from '@luciel/api-client';

/**
 * TanStack Query provider (server state — Space Instructions §2). A global
 * onError-style retry guard makes 401 (unauthorized) non-retryable so a
 * mid-session expiry routes to login cleanly rather than hammering the API
 * (Arch §3.7.1a). The actual redirect-on-401 is wired in a future auth PR.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
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
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
