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
  /** Free starter allowance — 50 (Vision §7). */
  freeAllowance: z.literal(50),
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
});
export type BillingInfo = z.infer<typeof billingInfo>;

/** Adding a card = Stripe Checkout, no charge at save (Customer Journey §6). */
export const checkoutSession = z.object({
  /** Hosted Stripe Checkout URL the UI redirects to. */
  url: z.string().url(),
});
export type CheckoutSession = z.infer<typeof checkoutSession>;
