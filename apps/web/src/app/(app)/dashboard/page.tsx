'use client';

import Link from 'next/link';
import {
  Card,
  CardTitle,
  CardDescription,
  Banner,
  ProgressBar,
  Button,
  PageHeader,
  StatusChip,
} from '@luciel/ui';
import { chipForConnection } from '@luciel/api-client';
import { useLuciel, useBilling, useConversations, useLeads, useConnections } from '@/lib/hooks';

/**
 * Dashboard overview. Imports ONLY the typed client hooks (§7). Renders the
 * budget bar copy EXACTLY as specified (Arch §3.4.1b) and honest state banners.
 */
const stateLabel: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  luciel_grace_window: 'Deleted — in grace window',
  luciel_hard_deleted: 'Deleted',
};

export default function DashboardPage() {
  const luciel = useLuciel();
  const billing = useBilling();
  const conversations = useConversations();
  const leads = useLeads();
  const connections = useConnections();

  const b = billing.data?.budget;
  const nearCap = b && b.billingState === 'free_cap' && b.conversationsThisPeriod >= 40 && !b.atCap;
  const needsAttention = connections.data?.filter((c) => c.status !== 'connected') ?? [];

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title={luciel.isLoading ? 'Loading…' : (luciel.data?.name ?? 'Your Luciel')}
        description={
          luciel.data ? (
            <span className="inline-flex items-center gap-vm-2">
              {stateLabel[luciel.data.state] ?? luciel.data.state}
              {luciel.data.state === 'active' && (
                <span
                  className="inline-flex h-2 w-2 rounded-full bg-vm-success"
                  aria-hidden="true"
                />
              )}
            </span>
          ) : undefined
        }
        actions={
          <Button asChild variant="primary">
            <Link href="/dashboard/configure">Configure</Link>
          </Button>
        }
      />

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

      <div className="grid gap-vm-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Conversation budget</CardTitle>
          {b && luciel.data && (
            <>
              {/* Budget bar copy — verbatim (Arch §3.4.1b). */}
              <ProgressBar
                className="mt-vm-4"
                value={b.conversationsThisPeriod}
                max={Math.max(b.freeAllowance, b.conversationsThisPeriod)}
                tone={b.atCap ? 'warning' : 'accent'}
                label={`${luciel.data.name}: ${b.conversationsThisPeriod} conversations this month (${b.freeAllowance} free + ${b.billedThisPeriod} billed)`}
              />
              <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
                {b.billingState === 'payg_enabled'
                  ? 'Pay-as-you-go is on: above 50, usage bills at $39 / 100 conversations, rounded up per 100-block.'
                  : 'Free plan: 50 conversations a month. Add a card to keep answering past 50 — it never changes your Luciel.'}
              </p>
              <div className="mt-vm-4 grid grid-cols-2 gap-vm-4 border-t border-vm-border pt-vm-4">
                <Stat label="Conversations" value={conversations.data?.length ?? '—'} />
                <Stat label="Leads captured" value={leads.data?.length ?? '—'} />
              </div>
            </>
          )}
        </Card>

        <Card>
          <CardTitle>Connections</CardTitle>
          <CardDescription>
            {needsAttention.length === 0
              ? 'All connected and healthy.'
              : `${needsAttention.length} need${needsAttention.length === 1 ? 's' : ''} attention.`}
          </CardDescription>
          <ul className="mt-vm-3 space-y-vm-2">
            {connections.data?.map((c) => (
              <li
                key={c.connectionId}
                className="flex items-center justify-between gap-vm-2 text-vm-1"
              >
                <span className="min-w-0 truncate capitalize text-vm-text-muted">
                  {c.connectionType} · {c.provider}
                </span>
                <StatusChip kind={chipForConnection(c.status)} />
              </li>
            ))}
          </ul>
          <div className="mt-vm-4">
            <Button asChild variant="ghost">
              <Link href="/dashboard/configure">Manage connections</Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-vm-0 text-vm-text-muted">{label}</div>
      <div className="mt-vm-1 font-heading text-vm-5 tabular-nums">{value}</div>
    </div>
  );
}
