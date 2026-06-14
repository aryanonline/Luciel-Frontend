'use client';

import { Card, CardTitle, CardDescription, Button, Banner, ProgressBar } from '@luciel/ui';
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

  const addCard = async () => {
    const session = await api.billing.startCheckout();
    // Real flow redirects to Stripe Checkout; here we open the mock URL.
    window.open(session.url, '_blank', 'noopener,noreferrer');
  };
  const removeCard = async () => {
    await api.billing.removePaymentMethod();
    qc.invalidateQueries({ queryKey: qk.billing });
  };

  return (
    <div className="space-y-vm-5">
      <h1 className="font-heading text-vm-5">Billing</h1>

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
        {b && luciel.data && (
          <>
            <ProgressBar
              className="mt-vm-3"
              value={b.conversationsThisPeriod}
              max={Math.max(b.freeAllowance, b.conversationsThisPeriod)}
              tone={b.atCap ? 'warning' : 'accent'}
              label={`${luciel.data.name}: ${b.conversationsThisPeriod} conversations this month (${b.freeAllowance} free + ${b.billedThisPeriod} billed)`}
            />
            <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
              Resets {new Date(b.periodResetsAt).toLocaleDateString()} (your billing-cycle date).
              {b.billedThisPeriod > 0 &&
                ` PAYG so far: ${Math.ceil(b.billedThisPeriod / 100)} × 100 × $39 = $${
                  Math.ceil(b.billedThisPeriod / 100) * 39
                }.`}
            </p>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>Payment method</CardTitle>
        {b?.billingState === 'payg_enabled' && billing.data?.paymentMethod ? (
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
            <Button variant="secondary" className="mt-vm-3" onClick={removeCard}>
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
            <Button variant="primary" className="mt-vm-3" onClick={addCard}>
              Add payment method
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
