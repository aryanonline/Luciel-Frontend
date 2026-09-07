import { z } from 'zod';
import { isoTimestamp } from './common';

/**
 * Billing & conversation budget. Single plan: free 50 conversations/month, then
 * PAYG $39/100 rounded UP per 100-block (Vision §7, Arch §3.4.1b). No tiers, no
 * feature gating. The budget bar copy is specified verbatim and assembled in the
 * UI from these fields.
 */

/** Whether a payment method is on file — the one axis that changes behavior >50. */
export const billingState = z.enum(['free_cap', 'payg_enabled']);
export type BillingState = z.infer<typeof billingState>;

/** Failed-payment dunning state (Customer Journey §6, Legal §A3). */
export const dunningState = z.enum([
  'none',
  'retrying', // days 0–7, full service, retries on days 1/3/5/7
  'reduced', // day 7 reached → reverted to free-cap behavior
]);
export type DunningState = z.infer<typeof dunningState>;

export const budget = z.object({
  billingState,
  dunningState,
  /** Conversations counted this billing period. */
  conversationsThisPeriod: z.number().int().nonnegative(),
  /**
   * Free starter allowance — 50 today (Vision §7). NOT pinned to a literal: Legal
   * §A5 reserves the right to reduce it on 30 days' notice, and a literal would
   * fail validation and break the budget bar the moment that happened.
   */
  freeAllowance: z.number().int().nonnegative(),
  /** Billed (PAYG) conversations above the free allowance this period. */
  billedThisPeriod: z.number().int().nonnegative(),
  /** Period boundary tied to Stripe billing date, not the calendar month. */
  periodResetsAt: isoTimestamp,
  /**
   * Whether the account is currently at-cap (free 50 hit, no payment method).
   * Drives the at-cap dashboard message; the END-CUSTOMER at-cap reply is
   * server-driven and never rendered by admin UI (Arch §3.4.1b).
   */
  atCap: z.boolean(),
  /**
   * Server-driven heads-up: a payg_enabled account is ~80%+ through its current
   * billed 100-block and about to roll into the next $39 block (Arch §3.4.1b,
   * Vision §7). Additive/optional — this is an honest usage nudge, NOT a cap.
   */
  nearNextBlock: z.boolean().optional(),
  /**
   * Ledger truth (round 6 WP-I, audit F025), additive: whether NEW usage past the
   * free 50 is served and billed right now (a live card, dunning not reduced), and
   * this period's block watermarks — accrued against the account / already
   * reported to Stripe — so a cardless or dunned account still shows the blocks
   * it ran while it could instead of a zero that reads as never billed.
   */
  billable: z.boolean().optional(),
  accruedBlocks: z.number().int().nonnegative().optional(),
  reportedBlocks: z.number().int().nonnegative().optional(),
});
export type Budget = z.infer<typeof budget>;

export const paymentMethod = z.object({
  /** Display-only brand + last4. No PAN, no card data ever in the frontend. */
  brand: z.string(),
  last4: z.string().length(4),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int(),
});
export type PaymentMethod = z.infer<typeof paymentMethod>;

export const billingInfo = z.object({
  budget,
  /** Present only when billingState = payg_enabled. */
  paymentMethod: paymentMethod.optional(),
  /**
   * Whether a card can actually be saved through this deployment. False while
   * the platform's Stripe posture is "mock" — the checkout URL then goes nowhere,
   * and the dashboard must say payments are not live yet instead of rendering a
   * button that pretends to work (2026-09-05 audit F026). Additive/optional:
   * an older server that omits it is treated as available.
   */
  paymentsAvailable: z.boolean().optional(),
});
export type BillingInfo = z.infer<typeof billingInfo>;

/** Adding a card = Stripe Checkout, no charge at save (Customer Journey §6). */
export const checkoutSession = z.object({
  /** Hosted Stripe Checkout URL the UI redirects to. */
  url: z.string().url(),
});
export type CheckoutSession = z.infer<typeof checkoutSession>;
