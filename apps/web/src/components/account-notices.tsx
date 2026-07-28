'use client';

import * as React from 'react';
import Link from 'next/link';
import { Banner, Button } from '@luciel/ui';
import type { AccountNotice } from '@luciel/api-client';
import { useSession } from '@/lib/hooks';

/**
 * Account-level notices in the dashboard shell (Legal §A5, §A10, §B10).
 *
 * §A5 is the binding case: if the free starter allowance is REDUCED, existing
 * accounts get at least 30 days' notice delivered both by email AND "as an
 * in-dashboard notification visible on next login" — the dashboard half exists
 * precisely because a registered email address may have gone stale.
 *
 * Dismissal is therefore session-scoped and deliberately NOT persisted: waving a
 * notice away clears it for this visit, and it is visible again on next login,
 * which is exactly the commitment. The server owns the lead-time arithmetic and
 * the wording; this component only renders what it is given.
 *
 * BACKEND DEPENDENCY: reads `notices` off the `/api/v1/auth/me` payload. The
 * field is optional, so until the backend emits it nothing renders.
 */
const tone: Record<AccountNotice['kind'], 'info' | 'warning'> = {
  allowance_reduction: 'warning',
  price_change: 'warning',
  terms_change: 'info',
};

export function AccountNotices() {
  const session = useSession();
  const [dismissed, setDismissed] = React.useState<string[]>([]);

  const notices = (session.data?.notices ?? []).filter((n) => !dismissed.includes(n.noticeId));
  if (notices.length === 0) return null;

  return (
    <div className="mb-vm-5 space-y-vm-3">
      {notices.map((n) => (
        <Banner key={n.noticeId} tone={tone[n.kind]}>
          <div className="flex items-start justify-between gap-vm-4">
            <div>
              <strong>{n.title}</strong>
              <p className="mt-vm-1">{n.body}</p>
              {n.effectiveAt && (
                <p className="mt-vm-1 text-vm-0">
                  Takes effect {new Date(n.effectiveAt).toLocaleDateString()}.
                </p>
              )}
              {n.learnMoreHref && (
                <Link href={n.learnMoreHref} className="mt-vm-1 inline-block underline">
                  Read the details
                </Link>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() => setDismissed((prev) => [...prev, n.noticeId])}
              aria-label={`Dismiss notice: ${n.title}`}
            >
              Dismiss
            </Button>
          </div>
        </Banner>
      ))}
    </div>
  );
}
