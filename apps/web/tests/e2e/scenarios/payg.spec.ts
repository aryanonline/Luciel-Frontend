import { test, expect, expectPending, mockControl, reloadAndExpect } from '../support/fixtures';
import { stubStripe } from '../support/provider-stubs';

/**
 * Scenario `payg` (round 7 WP-12): a card on file and past the free 50. The pages
 * it changes: the Overview (pay-as-you-go wording and the next-block heads-up) and
 * Billing (the card, the running total, Update payment method through the Billing
 * Portal, and removing the card — which, past 50, puts the account at the cap).
 */
const LUCIEL = "Sarah's Front-Desk Assistant";

test('pay-as-you-go: the bill so far, the card replaced in the portal, then removed', async ({
  page,
  baseURL,
}) => {
  await test.step('Overview: past 50, billed in blocks, with the heads-up', async () => {
    await page.goto('/dashboard');
    await expect(
      page.getByText(`${LUCIEL}: 240 conversations this billing period (50 free + 190 billed)`),
    ).toBeVisible();
    await expect(
      page.getByText("You're about 80% through your current billed block"),
    ).toBeVisible();
    await expect(page.getByText("You've reached your 50 free conversations")).toHaveCount(0);
  });

  await test.step('Billing: the card and the running total', async () => {
    await stubStripe(page, baseURL ?? 'http://localhost:3000');
    await page.goto('/dashboard/billing');
    await expect(page.getByText(/VISA ending 4242/)).toBeVisible();
    await expect(page.getByTestId('period-anchor')).toContainText(
      'Pay-as-you-go so far: 2 × 100 conversations × $39 CAD = $78 CAD.',
    );
  });

  await test.step('Update payment method: a failed portal start says so, the card unchanged', async () => {
    await mockControl(page).failNext('billing.startPortal');
    await page.getByRole('button', { name: 'Update payment method' }).click();
    await expect(
      page.getByText('We could not open your billing portal just now. Your card is unchanged'),
    ).toBeVisible();
    await expect(page.getByText(/VISA ending 4242/)).toBeVisible();
  });

  await test.step('Update payment method: pending, the portal, a new card', async () => {
    await expectPending(
      page,
      () => page.getByRole('button', { name: 'Update payment method' }).click(),
      page.getByRole('button', { name: 'Opening your billing portal…' }),
    );
    await page.waitForURL(/billing\.stripe\.com/);
    await page.getByRole('link', { name: 'Replace card' }).click();
    await page.waitForURL(/\/dashboard\/billing/);
    await expect(page.getByText(/MASTERCARD ending 4444/)).toBeVisible();
  });
  await reloadAndExpect(page, 'the replaced card', async () => {
    await expect(page.getByText(/MASTERCARD ending 4444/)).toBeVisible();
    await expect(page.getByText(/VISA ending 4242/)).toHaveCount(0);
  });

  const dialog = page.getByRole('dialog', { name: 'Remove your payment method?' });
  await test.step('remove the card: a failure stays in the dialog with its reason', async () => {
    await page.getByRole('button', { name: 'Remove payment method' }).click();
    await mockControl(page).failNext('billing.removePaymentMethod');
    await dialog.getByRole('button', { name: 'Remove card' }).click();
    await expect(dialog.getByText('Internal Server Error')).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  await test.step('remove the card: pending, then no card', async () => {
    await expectPending(
      page,
      () => dialog.getByRole('button', { name: 'Remove card' }).click(),
      dialog.getByRole('button', { name: 'Removing…' }),
    );
    await expect(dialog).toBeHidden();
    await expect(page.getByText('No card on file — your Luciel is capped')).toBeVisible();
  });
  await reloadAndExpect(page, 'the removal', async () => {
    await expect(page.getByText('No card on file — your Luciel is capped')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add payment method' })).toBeVisible();
  });

  await test.step('Overview: past 50 with no card is the cap — said, not hidden', async () => {
    await page.goto('/dashboard');
    await expect(page.getByText("You've reached your 50 free conversations")).toBeVisible();
    await expect(page.getByText(/Free plan: 50 conversations per billing period/)).toBeVisible();
  });
});
