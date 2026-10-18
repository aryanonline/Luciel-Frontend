/**
 * The served period anchor (round 7 WP-1 #5): `periodResetsAt` is the boundary the
 * backend keyed the conversation counter on — the Stripe billing-cycle date once a
 * card exists, the calendar month before that (`metering._anchor_to_subscription`).
 * It is rendered as served; nothing here derives a month label locally, because a
 * local "resets on the 1st" is wrong the moment a card anchors the period to the
 * day it was saved. Lives outside the page module because an App Router page may
 * only export the route contract.
 */
export function periodAnchorSentence(
  periodResetsAt: string,
  billingState: 'free_cap' | 'payg_enabled',
): string {
  const date = new Date(periodResetsAt).toLocaleDateString();
  return billingState === 'payg_enabled'
    ? `Your free 50 reset on ${date} — your card's billing-cycle date.`
    : `Your free 50 reset on ${date}. Once a card is on file, the period follows your card's billing-cycle date instead.`;
}
