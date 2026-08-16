'use client';

import * as React from 'react';
import {
  Card,
  CardTitle,
  CardDescription,
  Button,
  Banner,
  Modal,
  ProgressBar,
  PageHeader,
} from '@luciel/ui';
import { useBilling, useLuciel, qk } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Billing (Customer Journey §6; Arch §3.4.1b, §3.6.7; Legal §A3). Single plan:
 * free 50/month, then PAYG $39/100 rounded up per 100-block. Adding a card =
 * Stripe Checkout, no charge at save, no re-setup. Removing a card reverts to
 * free-cap with NO data loss. Dunning degrades to free-cap, never deletes data.
 * Never implies tiers or feature-gating — there are none.
 */
export default function BillingPage() {
  const billing = useBilling();
  const luciel = useLuciel();
  const qc = useQueryClient();
  const b = billing.data?.budget;
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const [redirecting, setRedirecting] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const addCard = async () => {
    setCheckoutError(null);
    setRedirecting(true);
    try {
      const session = await api.billing.startCheckout();
      // Same-tab navigation, the standard Stripe Checkout pattern: a popup opened
      // after an await is blocked by the browser, which is indistinguishable from
      // a dead button. Card details still never touch our origin.
      window.location.assign(session.url);
    } catch {
      setCheckoutError('We could not open secure checkout just now. Please try again.');
      setRedirecting(false);
    }
    // No `finally`: on success the page is navigating away, and re-enabling the
    // button would invite a second checkout session on the way out.
  };

  /** Throws on failure on purpose — the Modal reports it and stays open. */
  const removeCard = async () => {
    await api.billing.removePaymentMethod();
    qc.invalidateQueries({ queryKey: qk.billing });
    setConfirmRemove(false);
  };

  const loading = billing.isPending || luciel.isPending;
  const failed = billing.isError || luciel.isError;

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Billing"
        description="One plan: 50 free conversations a month, then $39 per 100. Adding a card never changes your Luciel — only whether it can work past the free 50."
      />

      {b?.dunningState === 'retrying' && (
        <Banner tone="warning">
          A recent payment didn&apos;t go through. Your Luciel keeps running at full capability
          while we retry over 7 days. Update your card to avoid any interruption — no data is ever
          deleted.
        </Banner>
      )}
      {b?.dunningState === 'reduced' && (
        <Banner tone="danger">
          Payment didn&apos;t succeed after our retries, so the account reverted to free-cap
          behavior. Your Luciel, knowledge, and history are all intact — add a valid card to restore
          full capability immediately.
        </Banner>
      )}

      <Card>
        <CardTitle>This month</CardTitle>
        {/* A blank card reads as "nothing to bill"; say which of the three it is (P1-11). */}
        {loading ? (
          <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
            Loading your usage…
          </p>
        ) : failed ? (
          <Banner tone="danger" className="mt-vm-3">
            We could not load your usage, so the figures below are not shown rather than shown
            wrong.{' '}
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
            <ProgressBar
              className="mt-vm-3"
              value={b.conversationsThisPeriod}
              max={Math.max(b.freeAllowance, b.conversationsThisPeriod)}
              tone={b.atCap ? 'warning' : 'accent'}
              label={`${luciel.data.name}: ${b.conversationsThisPeriod} conversation${b.conversationsThisPeriod === 1 ? '' : 's'} this month (${b.freeAllowance} free + ${b.billedThisPeriod} billed)`}
            />
            <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
              Resets {new Date(b.periodResetsAt).toLocaleDateString()} (your billing-cycle date).
              {b.billedThisPeriod > 0 &&
                // Spelled out, not "PAYG" — an owner shouldn't need our acronyms
                // to read their own bill.
                ` Pay-as-you-go so far: ${Math.ceil(b.billedThisPeriod / 100)} × 100 conversations × $39 = $${
                  Math.ceil(b.billedThisPeriod / 100) * 39
                }.`}
            </p>
          </>
        ) : (
          <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
            No usage to show yet — you have no Luciel answering conversations.
          </p>
        )}
      </Card>

      <Card>
        <CardTitle>Payment method</CardTitle>
        {checkoutError && (
          <Banner tone="danger" className="mt-vm-3">
            {checkoutError}
          </Banner>
        )}
        {billing.isPending ? (
          <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
            Loading your payment method…
          </p>
        ) : billing.isError ? (
          /* "No card on file" would be a claim we can't make while the read failed. */
          <Banner tone="danger" className="mt-vm-3">
            We could not load your payment method.{' '}
            <button className="underline" onClick={() => void billing.refetch()}>
              Try again
            </button>
          </Banner>
        ) : b?.billingState === 'payg_enabled' && billing.data?.paymentMethod ? (
          <>
            <CardDescription>
              {billing.data.paymentMethod.brand.toUpperCase()} ending{' '}
              {billing.data.paymentMethod.last4} · expires {billing.data.paymentMethod.expMonth}/
              {billing.data.paymentMethod.expYear}
            </CardDescription>
            <Banner tone="info" className="mt-vm-3">
              Pay-as-you-go is on. Conversations 1–50 each month stay free; above that bills at $39
              / 100, rounded up per 100-block, at the close of the cycle.
            </Banner>
            <Button variant="secondary" className="mt-vm-3" onClick={() => setConfirmRemove(true)}>
              Remove payment method
            </Button>
            <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
              Removing your card reverts to the free 50/month cap. Your Luciel, knowledge, and
              connections are retained — nothing is deleted.
            </p>
          </>
        ) : (
          <>
            <CardDescription>
              No card on file — your Luciel is capped at 50 free conversations/month.
            </CardDescription>
            <Banner tone="info" className="mt-vm-3">
              Adding a payment method doesn&apos;t hire a second employee. Your Luciel keeps its
              name, its knowledge, and its history — paying just means it can keep working past your
              free 50. No charge when you save the card.
            </Banner>
            <Button
              variant="primary"
              className="mt-vm-3"
              disabled={redirecting}
              onClick={() => void addCard()}
            >
              {redirecting ? 'Opening secure checkout…' : 'Add payment method'}
            </Button>
          </>
        )}
      </Card>

      {/* Removing the card changes what the account can do next month, so it is
          confirmed and reported like every other consequential action (P1-12). */}
      <Modal
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove your payment method?"
        description="Your account reverts to the free 50 conversations a month. Your Luciel, its knowledge, your leads, and your connections all stay exactly as they are — nothing is deleted. You can add a card again at any time, with no re-setup."
        confirmLabel="Remove card"
        confirmPendingLabel="Removing…"
        confirmVariant="danger"
        onConfirm={removeCard}
      />
    </div>
  );
}
