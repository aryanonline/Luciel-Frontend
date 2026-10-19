import { test, expect, expectPending, reloadAndExpect } from '../support/fixtures';

/**
 * Scenario `expired_session` (round 7 WP-12): the browser still holds the session
 * cookie (so the middleware lets the page through) but the server no longer honours
 * it — it expired, or a password reset revoked it. The owner is bounced to the login
 * page WITH the reason and the page they were on, and signing in puts them back.
 */
test('a stale session is bounced to login with the reason, and signing in puts the owner back', async ({
  page,
}) => {
  await test.step('a dashboard page bounces to /login, saying why and where from', async () => {
    await page.goto('/dashboard/leads');
    await page.waitForURL(/\/login\?reason=session_expired&next=%2Fdashboard%2Fleads$/);
    await expect(page.getByTestId('login-reason')).toHaveText(
      'Your session has ended — it expired or was signed out elsewhere. Log in again to pick up where you left off.',
    );
  });

  await test.step('the form still refuses an empty submit', async () => {
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Enter a valid email.')).toBeVisible();
  });

  await test.step('sign in: pending, then back on the page the owner was on', async () => {
    // Test values for the local mock (it accepts any credentials) — never a real account.
    await page.getByLabel('Email').fill('owner@example.test');
    await page.getByLabel('Password').fill('mock-password');
    await expectPending(
      page,
      () => page.getByRole('button', { name: 'Log in' }).click(),
      page.getByRole('button', { name: 'Signing in…' }),
    );
    await page.waitForURL(/\/dashboard\/leads$/);
    await expect(page.getByRole('heading', { name: 'Leads', exact: true })).toBeVisible();
  });
  await reloadAndExpect(page, 'the new session', async () => {
    await expect(page).toHaveURL(/\/dashboard\/leads$/);
    await expect(page.getByRole('heading', { name: 'Leads', exact: true })).toBeVisible();
  });

  await test.step('a plain visit to the login page carries no stale reason', async () => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await expect(page.getByTestId('login-reason')).toHaveCount(0);
  });
});
