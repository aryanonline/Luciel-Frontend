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
import { chipForConnection, type Connection, type ConnectionProviders } from '@luciel/api-client';
import {
  useLuciel,
  useBilling,
  useLeads,
  useConnections,
  useConnectionProviders,
  useSwapConnection,
} from '@/lib/hooks';
import { authorizeOrExplain } from '@/lib/oauth-connect';
import { TodayCard } from '@/components/today-card';
import {
  connectionTypeLabel,
  providerConfigured,
  providerDisplayName,
} from '@/components/config/labels';

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

/**
 * Whether a connection row's provider is actually usable today — the SAME
 * "is this actionable" truth both the row's own chip (via `chipForConnection`)
 * and the "N need attention" counter must agree on (Harmony wave 2 follow-up).
 * Prefers the payload-carried `providerAvailable` (backend contract:
 * `ConnectionOut.providerAvailable`); falls back to the served
 * providers-registry lookup for any row the backend hasn't attached it to
 * yet. One function, reused by both call sites below, so the two can never
 * drift the way `needsAttention`'s old bare `status !== 'connected'` filter
 * did from `chipForConnection`'s registry-override rule.
 */
function isProviderConfigured(
  connection: Connection,
  providers: ConnectionProviders[] | undefined,
): boolean {
  return (
    connection.providerAvailable ??
    providerConfigured(providers, connection.connectionType, connection.provider)
  );
}

export default function DashboardPage() {
  const luciel = useLuciel();
  const billing = useBilling();
  const leads = useLeads();
  const connections = useConnections();
  // Same served registry Configure reads (contract §1): a provider it is not
  // holding an OAuth app for is `configured: false` there, and this page must
  // agree, never presenting that row as a live, actionable connection
  // (Harmony fix FE-H#7 — one truth across Overview and Configure).
  const providers = useConnectionProviders();

  const swap = useSwapConnection();
  const [swapNotice, setSwapNotice] = React.useState<string | null>(null);
  const [swapping, setSwapping] = React.useState<string | null>(null);
  const b = billing.data?.budget;
  const nearCap = b && b.billingState === 'free_cap' && b.conversationsThisPeriod >= 40 && !b.atCap;
  const nearNextBlock = b && b.billingState === 'payg_enabled' && b.nearNextBlock;
  const largeLeadStore = (leads.data?.length ?? 0) >= LARGE_LEAD_STORE;
  // 2026-09-05 audit F134: a captured lead that never reached the CRM is owner
  // attention, surfaced here so it is not discovered weeks later on the Leads page.
  const leadsNotInCrm = (leads.data ?? []).filter((l) => l.crmStatus === 'failed').length;
  /**
   * "N need attention" must count exactly the rows the list below renders
   * with the "Action needed" chip — nothing else. The prior `status !==
   * 'connected'` filter counted every non-connected row, including ones
   * whose provider the served registry cannot connect at all
   * (`providerAvailable`/registry `configured: false`), which render the
   * non-actionable "Not available yet" chip instead (Harmony wave 2, item
   * 6a). That let the header say e.g. "4 need attention" while only 3 rows
   * actually showed "Action needed" — Notion-style rows the registry marked
   * unavailable were still being counted as if there were something to do.
   * Reuses `chipForConnection`'s own override rule (registry-unavailable
   * wins regardless of status) instead of re-deriving "is this actionable"
   * with separate logic that could drift from what the chip actually shows.
   */
  // 2026-09-05 audit F059: an EXPIRED connection renders "Reconnect needed" — the
  // owner has to act on it just as much as on "Action needed" — yet the header
  // said "All connected and healthy" over it. Both actionable chips count; the
  // non-actionable "Not available yet" still does not.
  const needsAttention =
    connections.data?.filter((c) => {
      const chip = chipForConnection(c.status, isProviderConfigured(c, providers.data));
      return chip === 'action_needed' || chip === 'reconnect_needed';
    }) ?? [];
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

      {/* The employee, in one place (round 6 WP-F): on duty around the clock, what it
          can do, what it needs, what it did. Served and derived, never narrated. */}
      <TodayCard />

      {/* At-cap honesty (Customer Journey §6) — only when the server says so. */}
      {b?.atCap && (
        <Banner tone="warning">
          You&apos;ve reached your 50 free conversations this billing period. Your Luciel is still
          capturing leads and escalating them to you, but it&apos;s replying at-capacity to new
          visitors.{' '}
          <Link href="/dashboard/billing" className="underline">
            Add a payment method
          </Link>{' '}
          to keep it fully answering — you&apos;ll only pay for conversations above 50, at $39 CAD
          per 100.
        </Banner>
      )}
      {nearCap && (
        <Banner tone="info">
          You&apos;re approaching your 50 free conversations this billing period.
        </Banner>
      )}
      {nearNextBlock && (
        <Banner tone="info">
          You&apos;re about 80% through your current billed block. Once you pass it, usage rolls
          into the next $39 CAD / 100 block — this is just a heads-up, not a cap; your Luciel keeps
          answering.
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
      {leadsNotInCrm > 0 && (
        <Banner tone="warning">
          {leadsNotInCrm} lead{leadsNotInCrm === 1 ? '' : 's'} did not reach your CRM —{' '}
          <Link href="/dashboard/leads" className="underline">
            review and retry
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
                label={`${luciel.data.name}: ${b.conversationsThisPeriod} conversation${b.conversationsThisPeriod === 1 ? '' : 's'} this billing period (${b.freeAllowance} free + ${b.billedThisPeriod} billed)`}
              />
              <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
                {b.billingState === 'payg_enabled'
                  ? 'Pay-as-you-go is on: above 50, usage bills at $39 CAD / 100 conversations, rounded up per 100-block.'
                  : // Full sentence, never clamped (Harmony fix FE-H#10): the owner
                    // read this line mid-word on dev ("...it never changes your
                    // L..."), so "Luciel" is deliberately the last word — nothing
                    // after it to catch on a truncating container by accident.
                    'Free plan: 50 conversations per billing period. Add a card to keep it answering past 50 — adding a card never changes your Luciel.'}
              </p>
              {/* ONE conversation number (audit F015): the budget bar above and this stat
                  used to disagree — the bar counted billed sessions this period while the
                  stat counted every conversation row the list happened to return. A
                  conversation means the same thing here, on Billing and in Analytics. */}
              <div className="mt-vm-4 grid grid-cols-2 gap-vm-4 border-t border-vm-border pt-vm-4">
                <Stat label="Conversations this billing period" value={b.conversationsThisPeriod} />
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
            {connections.data?.map((c) => {
              // Human labels only (Harmony fix FE-H#6) — never the raw
              // `connectionType`/`provider` registry enums ("Sms_sender ·
              // Twilio"). Same word list Configure's pillars use, so a
              // connection reads identically on both pages.
              const typeLabel = connectionTypeLabel[c.connectionType] ?? c.connectionType;
              // Harmony wave 2, item 6 (backend_gaps.md §"Harmony wave 2", FE
              // CONTRACT BLOCK item 4): `ConnectionOut.displayName` is now the
              // served human label for this row's provider — render it
              // directly instead of re-deriving one from the separate
              // providers-registry fetch. Falls back to the old derivation
              // (registry lookup, then a humanized raw provider code) only for
              // rows the backend hasn't attached `displayName` to yet.
              const name =
                c.displayName ?? providerDisplayName(providers.data, c.connectionType, c.provider);
              // Configure's honest-disabled rule, restated here (FE-H#7) and
              // sharpened by item 6a: a provider the served registry does not
              // hold an OAuth app for is never offered as an actionable
              // connected account, even if a stale row says `status:
              // 'connected'` — Overview and Configure must agree on what
              // "actionable" means for the same provider. `providerAvailable`
              // (backend_gaps.md §"Harmony wave 2", FE CONTRACT BLOCK item 3)
              // is the authoritative, payload-carried version of this signal;
              // the registry-derived `providerConfigured()` lookup remains the
              // fallback for any row the backend hasn't attached it to yet.
              const configured = isProviderConfigured(c, providers.data);
              // Email is BYO-mailbox ONLY (owner ruling 2026-08-18): a legacy
              // platform-SES row keeps serving read-only, but "Change connected
              // account" would drop into a picker that offers nothing for it —
              // the mailbox connect in Configure → Email is the real path
              // (audit round 3, C15).
              const legacyEmailRow = c.connectionType === 'email_sender' && c.provider === 'ses';
              const canChangeAccount = c.status === 'connected' && configured && !legacyEmailRow;
              return (
                <li key={c.connectionId} className="text-vm-1">
                  <div className="flex items-center justify-between gap-vm-2">
                    <span className="min-w-0 truncate text-vm-text-muted">
                      {typeLabel} · {name}
                    </span>
                    {/* Harmony wave 2, item 6a: a row whose provider the
                        registry cannot connect (`providerAvailable: false`)
                        gets the same non-actionable "Not available yet" chip
                        Configure uses — never "Action needed", and this wins
                        REGARDLESS of `status` per the backend contract, so it
                        overrides even a `connected` row (chipForConnection
                        short-circuits to not_available before switching on
                        status when `configured` is false). */}
                    <StatusChip kind={chipForConnection(c.status, configured)} />
                  </div>
                  {/* Swap a connected account, proven-before-cutover (Arch §3.8.7 B,
                      Decision #39) — distinct from Reconnect (same account re-auth). */}
                  {canChangeAccount && (
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
              );
            })}
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
