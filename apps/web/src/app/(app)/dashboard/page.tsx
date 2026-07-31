'use client';

import * as React from 'react';
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
import {
  useLuciel,
  useBilling,
  useConversations,
  useLeads,
  useConnections,
  useSwapConnection,
} from '@/lib/hooks';
import { authorizeOrExplain } from '@/lib/oauth-connect';

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

/** Soft threshold for the "your lead store is large" nudge (Arch §3.4.10a). */
const LARGE_LEAD_STORE = 250;

export default function DashboardPage() {
  const luciel = useLuciel();
  const billing = useBilling();
  const conversations = useConversations();
  const leads = useLeads();
  const connections = useConnections();

  const swap = useSwapConnection();
  const [swapNotice, setSwapNotice] = React.useState<string | null>(null);
  const [swapping, setSwapping] = React.useState<string | null>(null);
  const b = billing.data?.budget;
  const nearCap = b && b.billingState === 'free_cap' && b.conversationsThisPeriod >= 40 && !b.atCap;
  const nearNextBlock = b && b.billingState === 'payg_enabled' && b.nearNextBlock;
  const largeLeadStore = (leads.data?.length ?? 0) >= LARGE_LEAD_STORE;
  const needsAttention = connections.data?.filter((c) => c.status !== 'connected') ?? [];
  const hasConnected = (connections.data ?? []).some((c) => c.status === 'connected');

  /**
   * Swapping mints a single-use consent URL that must actually be navigated to.
   * Firing the mutation and discarding its result leaves the admin on a page
   * that silently did nothing (P0-8, hooks.ts startConnection).
   */
  const beginSwap = async (connectionId: string, provider: string) => {
    setSwapNotice(null);
    setSwapping(connectionId);
    try {
      const start = await swap.mutateAsync({ connectionId, provider });
      const explanation = authorizeOrExplain({
        ...start,
        provider,
        connectionId,
        label: provider,
        callbackKind: 'connection',
      });
      if (explanation) setSwapNotice(explanation);
    } catch {
      setSwapNotice(
        `We could not start a sign-in to change the ${provider} account. Your current connection is untouched — please try again.`,
      );
    } finally {
      setSwapping(null);
    }
  };

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
      {nearNextBlock && (
        <Banner tone="info">
          You&apos;re about 80% through your current billed block. Once you pass it, usage rolls into
          the next $39 / 100 block — this is just a heads-up, not a cap; your Luciel keeps answering.
        </Banner>
      )}
      {/* Lead-store soft threshold nudge (Arch §3.4.10a, Customer Journey §7). */}
      {largeLeadStore && (
        <Banner tone="info">
          Your lead store is getting large —{' '}
          <Link href="/dashboard/leads" className="underline">
            review stale leads
          </Link>
          .
        </Banner>
      )}

      <div className="grid gap-vm-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Conversation budget</CardTitle>
          {/* An empty card is indistinguishable from "no usage" (P1-11). */}
          {billing.isPending || luciel.isPending ? (
            <p className="mt-vm-4 text-vm-1 text-vm-text-muted" role="status">
              Loading your budget…
            </p>
          ) : billing.isError || luciel.isError ? (
            <Banner tone="danger" className="mt-vm-4">
              We could not load your budget.{' '}
              <button
                className="underline"
                onClick={() => {
                  void billing.refetch();
                  void luciel.refetch();
                }}
              >
                Try again
              </button>
            </Banner>
          ) : b && luciel.data ? (
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
          ) : (
            <p className="mt-vm-4 text-vm-1 text-vm-text-muted">
              No budget to show yet — you haven&apos;t built a Luciel.
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Connections</CardTitle>
          {/* "All connected and healthy" must never be said about a list we do
              not have, or about an account with no connections at all (P1-10). */}
          <CardDescription>
            {connections.isPending
              ? 'Checking your connections…'
              : connections.isError
                ? 'We could not check your connections.'
                : (connections.data?.length ?? 0) === 0
                  ? 'Nothing connected yet.'
                  : needsAttention.length === 0
                    ? 'All connected and healthy.'
                    : `${needsAttention.length} need${needsAttention.length === 1 ? 's' : ''} attention.`}
          </CardDescription>
          {connections.isError && (
            <Banner tone="danger" className="mt-vm-3">
              <button className="underline" onClick={() => void connections.refetch()}>
                Try again
              </button>
            </Banner>
          )}
          {swapNotice && (
            <Banner tone="danger" className="mt-vm-3">
              {swapNotice}
            </Banner>
          )}
          <ul className="mt-vm-3 space-y-vm-3">
            {connections.data?.map((c) => (
              <li key={c.connectionId} className="text-vm-1">
                <div className="flex items-center justify-between gap-vm-2">
                  <span className="min-w-0 truncate capitalize text-vm-text-muted">
                    {c.connectionType} · {c.provider}
                  </span>
                  <StatusChip kind={chipForConnection(c.status)} />
                </div>
                {/* Swap a connected account, proven-before-cutover (Arch §3.8.7 B,
                    Decision #39) — distinct from Reconnect (same account re-auth). */}
                {c.status === 'connected' && (
                  <div className="mt-vm-1">
                    <Button
                      variant="ghost"
                      onClick={() => void beginSwap(c.connectionId, c.provider)}
                      disabled={swap.isPending}
                    >
                      {swapping === c.connectionId
                        ? 'Opening sign-in…'
                        : 'Change connected account'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {hasConnected && (
            <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
              Your current connection stays live until the new one is verified.
            </p>
          )}
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
