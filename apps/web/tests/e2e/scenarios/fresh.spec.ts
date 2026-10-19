import { test, expect, reloadAndExpect } from '../support/fixtures';

/**
 * Scenario `fresh` (round 7 WP-12): a new, verified account with nothing configured
 * — no Luciel, and nothing a Luciel could have produced. The dashboard sends the
 * owner to first-run; once the Luciel exists, every collection renders its honest
 * EMPTY branch (never a loading spinner standing in for "none", never seed rows).
 */
const NAME = 'Corner Bakery Assistant';

test('a new account creates its Luciel, and every page says honestly that nothing has happened yet', async ({
  page,
}) => {
  await test.step('the dashboard sends a Luciel-less account to first-run', async () => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/first-run$/);
    await expect(page.getByText("Let's get your Luciel running")).toBeVisible();
  });

  await test.step('the form refuses an empty submit, field by field', async () => {
    await page.getByRole('button', { name: 'Create my Luciel' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/first-run$/);
  });

  await test.step('create the Luciel: setting up, then Configure', async () => {
    await page.getByLabel('What should we call your Luciel?').fill(NAME);
    await page.getByLabel('What is the website it will live on?').fill('cornerbakery.example');
    await page
      .getByLabel('In one sentence, what is your business?')
      .fill('A neighbourhood bakery that takes custom cake orders.');
    await page.getByRole('button', { name: 'Create my Luciel' }).click();
    await expect(page.getByText('Setting up your Luciel…')).toBeVisible();
    await page.waitForURL(/\/dashboard\/configure$/);
    await expect(page.getByRole('heading', { name: `Configure ${NAME}` })).toBeVisible();
  });
  await reloadAndExpect(page, 'the new Luciel', async () => {
    await expect(page.getByRole('heading', { name: `Configure ${NAME}` })).toBeVisible();
    await expect(page.getByText('Nothing here yet — upload a file, paste text')).toBeVisible();
  });

  await test.step('Overview: zero used, nothing connected', async () => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('identity-line')).toHaveText(
      `${NAME} is on duty around the clock — 0 of 50 free conversations used this period.`,
    );
    await expect(page.getByText('Nothing connected yet.')).toBeVisible();
    await expect(page.getByText('All connected and healthy.')).toHaveCount(0);
  });

  await test.step('Conversations: the empty branch, not a spinner', async () => {
    await page.goto('/dashboard/conversations');
    await expect(
      page.getByText('No conversations yet. They appear here as soon as a visitor talks'),
    ).toBeVisible();
    await expect(page.getByText('Loading conversations…')).toHaveCount(0);
  });

  await test.step('Leads: the empty branch', async () => {
    await page.goto('/dashboard/leads');
    await expect(page.getByText('No leads yet.')).toBeVisible();
    await expect(page.getByText('Loading your leads…')).toHaveCount(0);
  });

  await test.step('Analytics: honest notes where there is nothing to measure', async () => {
    await page.goto('/dashboard/analytics');
    await expect(
      page.getByText('Shows up once Luciel has replied to customers this billing period.'),
    ).toBeVisible();
    await expect(page.getByText('No conversation data yet.').first()).toBeVisible();
  });

  await test.step('Audit: the creation is the only thing on record — written by the server', async () => {
    await page.goto('/dashboard/audit');
    await expect(page.getByText('Luciel created')).toBeVisible();
    await expect(page.getByTestId('audit-detail')).toHaveText(NAME);
  });

  await test.step('Billing: the free 50 untouched, no card', async () => {
    await page.goto('/dashboard/billing');
    await expect(
      page.getByText(`${NAME}: 0 conversations this billing period (50 free + 0 billed)`),
    ).toBeVisible();
    await expect(page.getByText('No card on file — your Luciel is capped')).toBeVisible();
  });
});
