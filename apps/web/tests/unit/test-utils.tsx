import * as React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';

/**
 * A QueryClient whose cache already holds served answers, so the first render is the
 * settled screen and a test waits for no read it is not about. Seeded answers never go
 * stale on their own (a mutation's invalidation still re-reads them), and a read that
 * is not seeded runs as usual.
 */
export function seededQueryClient(
  answers: ReadonlyArray<readonly [QueryKey, unknown]>,
): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  for (const [key, data] of answers) client.setQueryData(key, data);
  return client;
}

/** Render helper that wraps a component in a QueryClient: a fresh one unless one is given. */
export function renderWithQuery(
  ui: React.ReactElement,
  client: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): RenderResult {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
