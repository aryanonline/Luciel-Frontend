'use client';

import Link from 'next/link';
import { Card, CardTitle, CardDescription, Banner, ProgressBar, Button } from '@luciel/ui';
import { useLuciel, useBilling, useConversations, useLeads } from '@/lib/hooks';

/**
 * Dashboard overview. Imports ONLY the typed client hooks (§7). Renders the
 * budget bar copy EXACTLY as specified (Arch §3.4.1b) and honest state banners.
 */
export default function DashboardPage() {
  const luciel = useLuciel();
  const billing = useBilling();
  const conversations = useConversations();
  const leads = useLeads();

  const b = billing.data?.budget;
  const nearCap = b && b.billingState === 'free_cap' && b.conversationsThisPeriod >= 40 && !b.atCap;

  return (
    <div className="space-y-vm-5">
      <div>
        <h1 className="font-heading text-vm-5">
          {luciel.isLoading ? 'Loading…' : (luciel.data?.name ?? 'Your Luciel')}
        </h1>
        {luciel.data && (
          <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
            Status: {luciel.data.state.replace(/_/g, ' ')}
          </p>
        )}
      </div>

      {/* At-cap honesty (Customer Journey §6) — only when the server says so. */}
      {b?.atCap && (
        <Banner tone="warning">
          You&apos;ve reached your 50 free conversations this month. Your Luciel is still capturing
          leads and escalating them to you, but it&apos;s replying at-capacity to new visitors.{' '}
          <Link href="/dashboard/billing" className="underline">
            Add a payment method
          </Link>{' '}
          to keep it fully answering — you&apos;ll only pay for conversations above 50, at $39 per
          100.
        </Banner>
      )}
      {nearCap && (
        <Banner tone="info">You&apos;re approaching your 50 free conversations this month.</Banner>
      )}

      <div className="grid gap-vm-4 sm:grid-cols-2">
        <Card>
          <CardTitle>Conversation budget</CardTitle>
          {b && luciel.data && (
            <>
              {/* Budget bar copy — verbatim (Arch §3.4.1b). */}
              <ProgressBar
                className="mt-vm-3"
                value={b.conversationsThisPeriod}
                max={Math.max(b.freeAllowance, b.conversationsThisPeriod)}
                tone={b.atCap ? 'warning' : 'accent'}
                label={`${luciel.data.name}: ${b.conversationsThisPeriod} conversations this month (${b.freeAllowance} free + ${b.billedThisPeriod} billed)`}
              />
              <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
                {b.billingState === 'payg_enabled'
                  ? 'Pay-as-you-go is on: above 50, usage bills at $39 / 100 conversations.'
                  : 'Free plan: 50 conversations/month. Add a card to keep answering past 50.'}
              </p>
            </>
          )}
        </Card>

        <Card>
          <CardTitle>This month</CardTitle>
          <CardDescription>A quick pulse — full detail in Analytics.</CardDescription>
          <dl className="mt-vm-3 grid grid-cols-2 gap-vm-3 text-vm-1">
            <div>
              <dt className="text-vm-text-muted">Conversations</dt>
              <dd className="font-heading text-vm-4">{conversations.data?.length ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-vm-text-muted">Leads</dt>
              <dd className="font-heading text-vm-4">{leads.data?.length ?? '—'}</dd>
            </div>
          </dl>
          <div className="mt-vm-4">
            <Button asChild variant="secondary">
              <Link href="/dashboard/configure">Configure your Luciel</Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
