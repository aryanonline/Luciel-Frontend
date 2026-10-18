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
import { LucielApiError } from '@luciel/api-client';
import { useBilling, useLuciel, qk } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { cardExpiryWarning } from '@/lib/card-expiry';
import { periodAnchorSentence } from '@/lib/billing-period';

/**
 * What "Update payment method" could not do, in the owner's words. The portal
 * refuses with 503 while payments are not live (the same truth the read carries
 * as `paymentsAvailable: false`) and with 409 when there is no card to replace.
 */
type PortalRefusal = 'not_live' | 'no_card' | 'failed';

/**
 * Billing (Customer Journey §6; Arch §3.4.1b, §3.6.7; Legal §A3). Single plan:
 * free 50 per billing period, then PAYG $39/100 rounded up per 100-block. The
 * period is the Stripe billing cycle once a card exists (the calendar month
 * before that) — so the copy says "billing period", never "month", which read
 * as a calendar promise the product does not make (audit F007). Adding a card =
 * Stripe Checkout, no charge at save, no re-setup. Removing a card reverts to
 * free-cap with NO data loss. Dunning degrades to free-cap, never deletes data.
 * Never implies tiers or feature-gating — there are none.
 */
/**
 * Stripe sends the owner back to /dashboard/billing?checkout=success|cancel
 * (2026-09-05 audit F160). Say what happened; on success refresh the billing read
 * so the new card shows without a manual reload. Under Suspense because Next
 * requires a boundary around useSearchParams consumers.
 */
function CheckoutReturnNotice() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const outcome = params.get('checkout');
  React.useEffect(() => {
    if (outcome === 'success') void qc.invalidateQueries({ queryKey: qk.billing });
  }, [outcome, qc]);
  if (outcome === 'success') {
    return (
      <Banner tone="info">
        Your card was saved. Pay-as-you-go is on: conversations 1–50 each billing period stay free,
        and nothing about your Luciel changed.
      </Banner>
    );
  }
  if (outcome === 'cancel') {
    return (
      <Banner tone="info">
        Checkout was cancelled — no card was saved and nothing changed. You can add one whenever you
        like.
      </Banner>
    );
  }
  return null;
}

export default function BillingPage() {
  const billing = useBilling();
  const luciel = useLuciel();
  const qc = useQueryClient();
  const b = billing.data?.budget;
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const [redirecting, setRedirecting] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [portalOpening, setPortalOpening] = React.useState(false);
  const [portalRefusal, setPortalRefusal] = React.useState<PortalRefusal | null>(null);

  /** Replace the card on file through the hosted Stripe Billing Portal (WP-1 #5). */
  const updateCard = async () => {
    setPortalRefusal(null);
    setPortalOpening(true);
    try {
      const session = await api.billing.startPortal();
      // Same-tab navigation as Checkout: Stripe returns the owner to this page.
      window.location.assign(session.url);
    } catch (err) {
      setPortalRefusal(
        err instanceof LucielApiError && err.code === 'service_unavailable'
          ? 'not_live'
          : err instanceof LucielApiError && err.code === 'conflict'
            ? 'no_card'
            : 'failed',
      );
      setPortalOpening(false);
    }
    // No `finally`: on success the page is navigating away.
  };

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
        description="One plan: 50 free conversations each billing period, then $39 CAD per 100. Adding a card never changes your Luciel — only whether it can work past the free 50."
      />
      <React.Suspense fallback={null}>
        <CheckoutReturnNotice />
      </React.Suspense>

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
        <CardTitle>This billing period</CardTitle>
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
              label={`${luciel.data.name}: ${b.conversationsThisPeriod} conversation${b.conversationsThisPeriod === 1 ? '' : 's'} this billing period (${b.freeAllowance} free + ${b.billedThisPeriod} billed)`}
            />
            {/* Ledger truth (round 6 WP-I, audit F025): a cardless or dunned account
                still shows the blocks it ran while it could, and whether Stripe has
                been told — never a zero that reads as "nothing was ever billed". */}
            {b.billable === false && (b.accruedBlocks ?? 0) > 0 && (
              <p className="mt-vm-2 text-vm-1 text-vm-text-muted" data-testid="ledger-note">
                {b.dunningState === 'reduced'
                  ? 'Payment is failing, so new conversations stop at the free 50. '
                  : 'There is no card on file, so new conversations stop at the free 50. '}
                {`${b.accruedBlocks} paid block${b.accruedBlocks === 1 ? '' : 's'} already ran this period — `}
                {(b.reportedBlocks ?? 0) >= (b.accruedBlocks ?? 0)
                  ? 'billed on your last invoice.'
                  : 'still to be billed.'}
              </p>
            )}
            <p className="mt-vm-2 text-vm-1 text-vm-text-muted" data-testid="period-anchor">
              {periodAnchorSentence(b.periodResetsAt, b.billingState)}
              {b.billedThisPeriod > 0 &&
                // Spelled out, not "PAYG" — an owner shouldn't need our acronyms
                // to read their own bill.
                ` Pay-as-you-go so far: ${Math.ceil(b.billedThisPeriod / 100)} × 100 conversations × $39 CAD = $${
                  Math.ceil(b.billedThisPeriod / 100) * 39
                } CAD.`}
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
            {cardExpiryWarning(billing.data.paymentMethod) && (
              <Banner tone="warning" className="mt-vm-3">
                {cardExpiryWarning(billing.data.paymentMethod)}
              </Banner>
            )}
            <Banner tone="info" className="mt-vm-3">
              Pay-as-you-go is on. Conversations 1–50 each billing period stay free; above that
              bills at $39 CAD / 100, rounded up per 100-block, at the close of the cycle.
            </Banner>
            {/* Replace the card in Stripe's hosted portal (round 7 WP-1 #5): an
                expiring card no longer means remove-then-re-add. Pending while the
                portal session is minted; every refusal is said where the button is. */}
            <div className="mt-vm-3 flex flex-wrap items-center gap-vm-2">
              <Button
                variant="primary"
                disabled={portalOpening || billing.data.paymentsAvailable === false}
                onClick={() => void updateCard()}
              >
                {portalOpening ? 'Opening your billing portal…' : 'Update payment method'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
                Remove payment method
              </Button>
            </div>
            {/* The read's `paymentsAvailable: false` and the portal's 503 are the same
                truth (audit F026): say payments are not live, never a dead button. */}
            {(billing.data.paymentsAvailable === false || portalRefusal === 'not_live') && (
              <Banner tone="info" className="mt-vm-3">
                Payments aren&apos;t live yet in this environment, so the card on file can&apos;t be
                updated here for now. Your Luciel keeps working; nothing else changes.
              </Banner>
            )}
            {portalRefusal === 'no_card' && (
              <Banner tone="info" className="mt-vm-3">
                There is no card on file to update, so there is nothing to open. Add a card instead
                — it goes through secure checkout, with no charge when you save it.
                <div className="mt-vm-2">
                  <Button variant="primary" disabled={redirecting} onClick={() => void addCard()}>
                    {redirecting ? 'Opening secure checkout…' : 'Add a card'}
                  </Button>
                </div>
              </Banner>
            )}
            {portalRefusal === 'failed' && (
              <Banner tone="danger" className="mt-vm-3">
                We could not open your billing portal just now. Your card is unchanged — please try
                again.
              </Banner>
            )}
            <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
              Removing your card bills any pay-as-you-go usage already run this period, then reverts
              to the free 50 per billing period. Your Luciel, knowledge, and connections are
              retained — nothing is deleted.
            </p>
          </>
        ) : billing.data?.paymentsAvailable === false ? (
          /* The server says its Stripe posture is mock: the checkout URL would go
             nowhere, so say so instead of offering a button that pretends to work
             (audit F026). */
          <>
            <CardDescription>
              No card on file — your Luciel is capped at 50 free conversations per billing period.
            </CardDescription>
            <Banner tone="info" className="mt-vm-3">
              Payments aren&apos;t live yet in this environment, so a card can&apos;t be added here
              for now. Your Luciel keeps working within the free 50; nothing else changes.
            </Banner>
          </>
        ) : (
          <>
            <CardDescription>
              No card on file — your Luciel is capped at 50 free conversations per billing period.
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

      {/* Removing the card changes what the account can do for the rest of the period,
          so it is confirmed and reported like every other consequential action (P1-12). */}
      <Modal
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove your payment method?"
        description="Any pay-as-you-go usage already run this period is billed now, then your account reverts to the free 50 conversations per billing period. Your Luciel, its knowledge, your leads, and your connections all stay exactly as they are — nothing is deleted. You can add a card again at any time, with no re-setup."
        confirmLabel="Remove card"
        confirmPendingLabel="Removing…"
        confirmVariant="danger"
        onConfirm={removeCard}
      />
    </div>
  );
}
