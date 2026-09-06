/**
 * 2026-09-05 audit F177: the card-expiry heads-up the billing sweep emails 45 days
 * ahead also shows in the dashboard, computed from the served expMonth/expYear.
 */
export const CARD_EXPIRY_LEAD_DAYS = 45;

/** The last day of the card's expiry month, in UTC. */
export function cardExpiresAt(expMonth: number, expYear: number): Date {
  // Day 0 of the following month is the last day of the expiry month.
  return new Date(Date.UTC(expYear, expMonth, 0, 23, 59, 59));
}

export function cardExpiryWarning(
  pm: { brand: string; last4: string; expMonth: number; expYear: number } | undefined,
  now: Date = new Date(),
): string | null {
  if (!pm) return null;
  const expires = cardExpiresAt(pm.expMonth, pm.expYear);
  const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  const mmYY = `${String(pm.expMonth).padStart(2, '0')}/${pm.expYear}`;
  if (daysLeft < 0) {
    return `Your ${pm.brand.toUpperCase()} ending ${pm.last4} expired ${mmYY}. Pay-as-you-go charges will fail until you add a current card — your Luciel keeps answering within the free 50 meanwhile.`;
  }
  if (daysLeft <= CARD_EXPIRY_LEAD_DAYS) {
    return `Your ${pm.brand.toUpperCase()} ending ${pm.last4} expires ${mmYY} (${daysLeft} day${daysLeft === 1 ? '' : 's'} from now). Add the replacement card before then so pay-as-you-go keeps running — removing and re-adding a card takes a minute and changes nothing else.`;
  }
  return null;
}
