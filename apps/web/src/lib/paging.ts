'use client';

import * as React from 'react';
import type { PageOptions } from '@luciel/api-client';

/**
 * 2026-09-05 audit WP7/F170: the list endpoints are paged (default 200, max 500).
 * The first page still arrives through the existing hooks; this keeps the OLDER
 * pages a list has asked for, so a tenant with more history than one page can
 * reach it without the page pretending the first 200 rows are everything.
 */
export const PAGE_SIZE = 200;

export interface PagedTail<T> {
  /** Rows loaded beyond the first page, oldest last, already de-duplicated. */
  extra: T[];
  /** True when the first page was full and no short page has been seen yet. */
  canLoadMore: boolean;
  loadMore: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function usePagedTail<T>(
  firstPage: T[] | undefined,
  fetchPage: (opts: PageOptions) => Promise<T[]>,
  keyOf: (row: T) => string,
): PagedTail<T> {
  const [extra, setExtra] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [exhausted, setExhausted] = React.useState(false);

  const firstCount = firstPage?.length ?? 0;
  const firstKeys = React.useMemo(() => new Set((firstPage ?? []).map(keyOf)), [firstPage, keyOf]);
  const dedupedExtra = React.useMemo(
    () => extra.filter((row) => !firstKeys.has(keyOf(row))),
    [extra, firstKeys, keyOf],
  );

  const loadMore = React.useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const page = await fetchPage({ limit: PAGE_SIZE, offset: firstCount + extra.length });
      setExtra((prev) => [...prev, ...page]);
      if (page.length < PAGE_SIZE) setExhausted(true);
    } catch {
      setError('We could not load older entries just now. Nothing changed — please try again.');
    } finally {
      setLoading(false);
    }
  }, [fetchPage, firstCount, extra.length]);

  return {
    extra: dedupedExtra,
    canLoadMore: firstCount >= PAGE_SIZE && !exhausted,
    loadMore,
    loading,
    error,
  };
}
