import type { Page } from '@playwright/test';

/**
 * Stand-ins for the third-party pages a customer is sent to and back from (round 7
 * WP-12). Nothing here is the real provider and nothing is entered on them — each
 * stub is a page with the one or two choices the customer makes there, and each
 * choice returns the browser exactly the way the provider (and, for OAuth, the
 * backend's callback) would. The mock adapter redeems the round-trip when the
 * landing page loads (see mock-admin.ts, "provider round-trips").
 */

function stubPage(title: string, note: string, choices: [label: string, href: string][]) {
  const links = choices
    .map(([label, href]) => `<li><a href="${href.replace(/&/g, '&amp;')}">${label}</a></li>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body><main><h1>${title}</h1><p>${note}</p><ul>${links}</ul></main></body></html>`;
}

/** Stripe Checkout and the Billing Portal, returning to the backend's own URLs. */
export async function stubStripe(page: Page, origin: string): Promise<void> {
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: stubPage(
        'Stripe Checkout (test stub)',
        'Stands in for Stripe in the e2e suite. No card is entered and nothing is charged.',
        [
          ['Save card', `${origin}/dashboard/billing?checkout=success`],
          ['Cancel checkout', `${origin}/dashboard/billing?checkout=cancel`],
        ],
      ),
    }),
  );
  await page.route('https://billing.stripe.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: stubPage(
        'Stripe Billing Portal (test stub)',
        'Stands in for the hosted portal. Stripe returns to a bare /dashboard/billing; the stub says which choice was made so the mock can play the webhook.',
        [
          ['Replace card', `${origin}/dashboard/billing?mock_stripe=portal_card_updated`],
          ['Return without changes', `${origin}/dashboard/billing`],
        ],
      ),
    }),
  );
}

/**
 * The mock's stand-in consent host. Its authorize URL carries the provider and the
 * connection the backend would have bound into its signed state; Allow returns the
 * way the backend's callback 303s (`?status=connected&provider=…&connectionId=…`),
 * Decline the way a refused consent does (`?status=error&reason=access_denied`).
 */
export async function stubConsent(page: Page, origin: string): Promise<void> {
  await page.route('https://accounts.example.com/**', (route) => {
    const url = new URL(route.request().url());
    const provider = url.searchParams.get('provider') ?? '';
    const connectionId = url.searchParams.get('connection_id') ?? '';
    const back = (query: string) => `${origin}/dashboard/configure?${query}`;
    return route.fulfill({
      contentType: 'text/html',
      body: stubPage(
        `Sign in to ${provider} (test stub)`,
        'Stands in for the provider consent screen. Nothing is signed in to.',
        [
          ['Allow', back(`status=connected&provider=${provider}&connectionId=${connectionId}`)],
          [
            'Decline',
            back(
              `status=error&reason=access_denied&client=${provider}&connectionId=${connectionId}`,
            ),
          ],
        ],
      ),
    });
  });
}
