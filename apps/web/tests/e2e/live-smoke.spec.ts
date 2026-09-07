import { test, expect } from '@playwright/test';

/**
 * Read-only smoke against a DEPLOYED environment (round 6 WP-J, audit F171).
 *
 * Opt-in and dispatch-only: set E2E_LIVE=1 with E2E_BASE_URL (the dashboard
 * origin), E2E_EMAIL and E2E_PASSWORD (a dev-only walk account, never a customer).
 * The Playwright config selects the `live-smoke` project — and starts no dev
 * server — only when E2E_LIVE=1, so the routine CI run never touches a live site.
 * The walk signs in, reads the overview, the embed snippet and the billing card,
 * and changes nothing.
 */
const LIVE = process.env.E2E_LIVE === '1';
const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

test.describe('live smoke (read-only)', () => {
  test.skip(
    !LIVE || !EMAIL || !PASSWORD,
    'set E2E_LIVE=1, E2E_BASE_URL, E2E_EMAIL and E2E_PASSWORD to walk a deployed environment',
  );

  test('signs in and reads the overview, embed snippet and billing card', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // The overview names the employee and its capacity in conversations.
    await expect(page.getByText(/conversation/i).first()).toBeVisible({ timeout: 30_000 });

    // The embed page serves the real snippet for this tenant's key.
    await page.goto('/dashboard/embed');
    await expect(page.getByText(/embed\.vantagemind\.ai\/v1\/luciel\.js/)).toBeVisible({
      timeout: 30_000,
    });

    // Billing reads in billing-period wording.
    await page.goto('/dashboard/billing');
    await expect(page.getByText('This billing period')).toBeVisible({ timeout: 30_000 });
  });
});
