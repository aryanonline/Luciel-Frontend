'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, CardDescription, CardTitle, PageHeader } from '@luciel/ui';
import { accountClosedDetail, type ReopenResult } from '@luciel/api-client';
import { api } from '@/lib/api';
import { useAccountStatus } from '@/lib/hooks';
import { formatDay } from '@/lib/account-closed';
import { ExportReady } from '@/components/export-ready';

/**
 * The closed-account reduced page (round 7 WP-5 / owner decision D5).
 *
 * A closed account still signs in. For 30 days after closure the owner gets this
 * page and exactly TWO actions — reopen the account (POST /admin/account/reopen)
 * and re-request the export (POST /admin/account/export); every other admin route
 * answers the typed 403 `account_closed`, and the guards send the owner here
 * instead of bouncing them to /login. Everything on the page is the SERVED status
 * (GET /admin/account): when it closed, until when it can be reopened, and whether
 * reopening brings the Luciel back. Past the window that read refuses with the same
 * typed 403 (reopenUntil now in the past) and the page says the window has ended,
 * with no actions.
 */
export default function AccountClosedPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const status = useAccountStatus();
  const [reopened, setReopened] = React.useState<ReopenResult | null>(null);

  const reopen = useMutation({
    mutationFn: () => api.account.reopen(),
    onSuccess: (result) => {
      setReopened(result);
      // The account is open again: every read the dashboard makes is answerable now.
      void qc.invalidateQueries();
    },
  });
  const reexport = useMutation({ mutationFn: () => api.account.requestExport() });

  const open = status.data !== undefined && status.data.state !== 'closed' && !reopened;
  React.useEffect(() => {
    // Not closed (opened in another tab, or reached by hand): nothing to do here.
    if (open) router.replace('/dashboard');
  }, [open, router]);

  if (reopened) return <Reopened result={reopened} />;

  if (status.isLoading) {
    return (
      <div className="py-vm-8 text-vm-1 text-vm-text-muted" role="status">
        Loading…
      </div>
    );
  }

  if (status.error) {
    const closed = accountClosedDetail(status.error);
    if (closed) return <WindowEnded closedAt={closed.closedAt} reopenUntil={closed.reopenUntil} />;
    return (
      <Banner tone="danger" className="my-vm-6">
        We could not read your account&apos;s status, so we cannot show what you can do with it
        right now. This is a problem reaching us — nothing about your account has changed.{' '}
        <button className="underline" onClick={() => void status.refetch()}>
          Try again
        </button>
      </Banner>
    );
  }

  const s = status.data;
  if (!s || open) {
    return (
      <p className="py-vm-8 text-vm-1" role="status">
        Your account is open.{' '}
        <Link href="/dashboard" className="underline">
          Go to your dashboard
        </Link>
      </p>
    );
  }

  const until = s.reopenUntil ? formatDay(s.reopenUntil) : null;
  return (
    <div className="mx-auto max-w-2xl space-y-vm-5">
      <PageHeader
        title="Your account is closed"
        description={
          s.closedAt
            ? `You closed it on ${formatDay(s.closedAt)}.`
            : 'This account has been closed.'
        }
      />

      <Card>
        <CardTitle>What you can still do</CardTitle>
        <CardDescription>
          {until
            ? `Until ${until} you can reopen the account or download your data again. After that, everything is permanently deleted and neither is possible.`
            : 'The closure date is not on record, so the account cannot be reopened from here.'}
        </CardDescription>

        <div className="mt-vm-4 space-y-vm-4">
          <section aria-labelledby="reopen-heading" className="space-y-vm-2">
            <h2 id="reopen-heading" className="font-label text-vm-2">
              Reopen my account
            </h2>
            <p className="text-vm-1 text-vm-text-muted">
              {s.lucielRestoredOnReopen
                ? 'Reopening brings everything back as it was before you closed — including your Luciel, in the state it was in.'
                : 'Reopening restores the account and its data. No Luciel comes back with it: there was none running when you closed, or you had deleted it yourself first (a deleted Luciel keeps its own 30-day restore).'}
            </p>
            {reopen.error ? (
              <Banner tone="danger">
                {reopen.error.message || 'We could not reopen your account. It is still closed.'}
              </Banner>
            ) : null}
            <Button
              variant="primary"
              disabled={!s.canReopen || reopen.isPending}
              onClick={() => reopen.mutate()}
            >
              {reopen.isPending ? 'Reopening…' : 'Reopen my account'}
            </Button>
            {!s.canReopen ? (
              <p className="text-vm-1 text-vm-text-muted">
                This account can no longer be reopened.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="export-heading" className="space-y-vm-2">
            <h2 id="export-heading" className="font-label text-vm-2">
              Download my data again
            </h2>
            <p className="text-vm-1 text-vm-text-muted">
              We prepare a fresh export (conversations, leads, your uploaded files, audit log, and
              your connection configuration — never secrets). The link appears here and is also
              emailed to you.
            </p>
            {reexport.error ? (
              <Banner tone="danger">
                {reexport.error.message || 'We could not prepare your export. Please try again.'}
              </Banner>
            ) : null}
            {reexport.data ? <ExportReady result={reexport.data} /> : null}
            <Button
              variant="secondary"
              disabled={reexport.isPending}
              onClick={() => reexport.mutate()}
            >
              {reexport.isPending
                ? 'Preparing…'
                : reexport.data
                  ? 'Prepare another export'
                  : 'Download my data again'}
            </Button>
          </section>
        </div>
      </Card>
    </div>
  );
}

/** Past the 30-day window: the served refusal, said plainly, with nothing to click. */
function WindowEnded({
  closedAt,
  reopenUntil,
}: {
  closedAt: string | null;
  reopenUntil: string | null;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-vm-5">
      <PageHeader
        title="Your account is closed"
        description={closedAt ? `You closed it on ${formatDay(closedAt)}.` : undefined}
      />
      <Banner tone="warning">
        {reopenUntil
          ? `The 30-day window to reopen it or download your data ended on ${formatDay(reopenUntil)}. The account and its data are being permanently deleted, so there is nothing left to do here.`
          : 'The closure date is not on record, so the account cannot be reopened or exported from here.'}
      </Banner>
    </div>
  );
}

/** What the reopen actually did — the served result, not an assumption. */
function Reopened({ result }: { result: ReopenResult }) {
  const luciel = result.lucielRestored
    ? result.lucielState === 'paused'
      ? 'Your Luciel is back, paused as it was — resume it under Manage account when you are ready.'
      : 'Your Luciel is back and answering again.'
    : 'No Luciel came back with the account. If you had deleted it yourself before closing, its own 30-day restore still applies under Manage account.';
  const billing =
    result.billingState === 'payg_enabled'
      ? 'Billing resumes on the card you had on file.'
      : 'You are on the free starter allowance (no card on file).';
  return (
    <div className="mx-auto max-w-2xl space-y-vm-5">
      <PageHeader title="Your account is open again" />
      <Banner tone="info">
        <p>{luciel}</p>
        <p className="mt-vm-1">{billing}</p>
        <div className="mt-vm-3">
          <Link href="/dashboard" className="underline">
            Go to my dashboard
          </Link>
        </div>
      </Banner>
    </div>
  );
}
