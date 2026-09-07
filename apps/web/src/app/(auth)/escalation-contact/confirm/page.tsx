'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardTitle, CardDescription } from '@luciel/ui';
import { api } from '@/lib/api';

/**
 * Public escalation-contact confirmation landing (round 5B item 13). The
 * recipient is usually NOT the account owner (a manager's inbox, a shared
 * sales address) and has no dashboard session — the single-use token in the
 * emailed link is the whole authorization, mirroring the backend route's
 * posture. Success and failure both land on plain, closable copy: there is no
 * next step here for someone who isn't the owner, so the page never links
 * into the dashboard.
 */
function ConfirmInner() {
  const params = useSearchParams();
  const token = params.get('token');

  const [status, setStatus] = React.useState<'confirming' | 'confirmed' | 'error'>(
    token ? 'confirming' : 'error',
  );

  React.useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        await api.escalationContact.confirm({ token });
        setStatus('confirmed');
      } catch {
        setStatus('error');
      }
    })();
  }, [token]);

  if (status === 'confirming') {
    return (
      <Card>
        <CardTitle>Confirming this address…</CardTitle>
        <CardDescription>One moment.</CardDescription>
      </Card>
    );
  }

  if (status === 'confirmed') {
    return (
      <Card>
        <CardTitle>Address confirmed</CardTitle>
        <CardDescription>
          This inbox will now receive escalation alerts — hot leads, frustrated customers, and
          questions the AI assistant hands to a person. You can close this page.
        </CardDescription>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>This confirmation link didn&apos;t work</CardTitle>
      <CardDescription>
        It may have expired, already been used, or been replaced by a newer email. Ask the business
        owner to re-send the confirmation from their escalation settings, then use the newest link.
      </CardDescription>
    </Card>
  );
}

export default function EscalationContactConfirmPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <CardTitle>Loading…</CardTitle>
        </Card>
      }
    >
      <ConfirmInner />
    </Suspense>
  );
}
