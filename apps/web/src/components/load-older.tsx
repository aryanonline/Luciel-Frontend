'use client';

import { Banner, Button } from '@luciel/ui';

/** The "there is more" control every paged list shares (2026-09-05 audit F170). */
export function LoadOlder({
  label,
  tail,
}: {
  label: string;
  tail: {
    canLoadMore: boolean;
    loadMore: () => Promise<void>;
    loading: boolean;
    error: string | null;
  };
}) {
  if (!tail.canLoadMore && !tail.error) return null;
  return (
    <div className="mt-vm-3 space-y-vm-2">
      {tail.error && <Banner tone="danger">{tail.error}</Banner>}
      {tail.canLoadMore && (
        <Button variant="ghost" disabled={tail.loading} onClick={() => void tail.loadMore()}>
          {tail.loading ? 'Loading…' : label}
        </Button>
      )}
    </div>
  );
}
