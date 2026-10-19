import { test, expect } from '@playwright/test';
import { withMockSession } from './mock-session';

/**
 * Customer journey through the dashboard against the MOCK adapter (round 6 WP-J,
 * audit F171). The a11y spec proves each page renders without WCAG violations;
 * this proves the pages hold together as one product walk — overview → configure
 * → embed → conversations → leads → billing — with one real mutation on the way
 * (naming the website that may load the chat). No backend is needed: the mock
 * adapter is the seeded, verified tenant "Sarah's Front-Desk Assistant".
 *
 * Each test starts from the seed (a fresh browser context, so an empty
 * sessionStorage); within the test the mock persists its store across page loads
 * (round 7 WP-12), so a change made on one page is still there on the next.
 */
const LUCIEL = "Sarah's Front-Desk Assistant";

// The dashboard is gated on the session cookie's presence (middleware.ts); the
// mock adapter never sets one, so plant it — see mock-session.ts.
test.beforeEach(async ({ context }) => {
  await withMockSession(context);
});

test('overview → configure → embed → conversations → leads → billing', async ({ page }) => {
  // Overview: the employee's name and the honest capacity line.
  await page.goto('/dashboard');
  await expect(page.getByText(LUCIEL).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Free plan: 50 conversations per billing period/)).toBeVisible();

  // Configure: the pillars are present, headed by the Luciel's own name.
  await page.goto('/dashboard/configure');
  await expect(page.getByRole('heading', { name: `Configure ${LUCIEL}` })).toBeVisible();
  await expect(page.getByText('Channels your Luciel uses')).toBeVisible();
  await expect(page.getByText('Knowledge base')).toBeVisible();

  // Embed: the one-line snippet, and the website allowlist saved from empty to one.
  await page.goto('/dashboard/embed');
  await expect(page.getByText(/embed\.vantagemind\.ai\/v1\/luciel\.js/)).toBeVisible();
  await expect(page.getByTestId('origins-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Add https://sarahchen.com' }).click();
  await expect(page.getByText('https://sarahchen.com can load your chat.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Allowed websites' })).toContainText(
    'https://sarahchen.com',
  );

  // Conversations and leads: the lists render with the seeded rows.
  await page.goto('/dashboard/conversations');
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
  await page.goto('/dashboard/leads');
  await expect(page.getByRole('heading', { name: 'Leads', exact: true })).toBeVisible();
  await expect(page.getByText('Jordan P.').first()).toBeVisible();

  // Billing: the period card, in billing-period wording.
  await page.goto('/dashboard/billing');
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
  await expect(page.getByText('This billing period')).toBeVisible();
});
