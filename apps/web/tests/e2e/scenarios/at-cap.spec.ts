import { test, expect, expectPending, mockControl, reloadAndExpect } from '../support/fixtures';
import { stubStripe } from '../support/provider-stubs';

/**
 * Scenario `at_cap` (round 7 WP-12): the free 50 are used, there is no card, and a
 * visitor is mid-conversation. The pages it changes: the Overview (the at-capacity
 * banner and the full budget bar), Conversations (the in-flight session, held and
 * answered by a person), and Billing (adding a card through Checkout lifts the cap).
 */
const LUCIEL = "Sarah's Front-Desk Assistant";
const IN_FLIGHT = '#55555555';

test('at the cap: the banner says so, a person can take the live conversation, and a card lifts the cap', async ({
  page,
  baseURL,
}) => {
  await test.step('Overview: at capacity, said once and plainly', async () => {
    await page.goto('/dashboard');
    await expect(page.getByText("You've reached your 50 free conversations")).toBeVisible();
    await expect(
      page.getByText(`${LUCIEL}: 50 conversations this billing period (50 free + 0 billed)`),
    ).toBeVisible();
    await expect(page.getByTestId('identity-line')).toContainText(
      '50 of 50 free conversations used this period',
    );
  });

  const row = page.getByRole('listitem').filter({ hasText: IN_FLIGHT });

  await test.step('Conversations: the in-flight session is listed, open, not ended', async () => {
    await page.goto('/dashboard/conversations');
    await expect(row.getByText(/^In progress — started/)).toBeVisible();
    await expect(row.getByText(/^Ended/)).toHaveCount(0);
  });

  await test.step('take it over: pending, then held', async () => {
    await expectPending(
      page,
      () => row.getByRole('button', { name: 'Take over' }).click(),
      row.getByRole('button', { name: 'Taking over…' }),
    );
    await expect(row.getByRole('button', { name: 'Hand back' })).toBeVisible();
  });
  await reloadAndExpect(page, 'the takeover', async () => {
    await expect(row.getByRole('button', { name: 'Hand back' })).toBeVisible();
  });

  const reply = 'Thanks for waiting — I can book you in for Thursday at 10.';
  await test.step('reply as a person: the widget picks it up by polling, never "instantly"', async () => {
    await row.getByRole('button', { name: /In progress — started/ }).click();
    const compose = page.getByLabel(
      'You are replying as yourself — Luciel is not answering this conversation.',
    );
    await compose.fill(reply);
    await expectPending(
      page,
      () => page.getByRole('button', { name: 'Send reply' }).click(),
      page.getByRole('button', { name: 'Sending…' }),
    );
    await expect(
      page.getByText('Sent — the visitor will see this on their next refresh.'),
    ).toBeVisible();
    await expect(page.getByText(/instantly|real[- ]time/i)).toHaveCount(0);
  });
  await reloadAndExpect(page, 'the reply and its delivery outcome', async () => {
    await row.getByRole('button', { name: /In progress — started/ }).click();
    await expect(page.getByText(reply)).toBeVisible();
    await expect(page.getByTestId('delivery-outcome').last()).toHaveText(
      'Sent — the visitor sees this on their next refresh (widget replies are picked up by polling, not pushed).',
    );
  });

  await test.step('hand it back to Luciel', async () => {
    await row.getByRole('button', { name: 'Hand back' }).click();
    await expect(row.getByRole('button', { name: 'Take over' })).toBeVisible();
  });
  await reloadAndExpect(page, 'the hand-back', async () => {
    await expect(row.getByRole('button', { name: 'Take over' })).toBeVisible();
  });

  await test.step('Billing: no card, capped — a failed checkout start says so and stays put', async () => {
    await stubStripe(page, baseURL ?? 'http://localhost:3000');
    await page.goto('/dashboard/billing');
    await expect(page.getByText('No card on file — your Luciel is capped')).toBeVisible();
    await mockControl(page).failNext('billing.startCheckout');
    await page.getByRole('button', { name: 'Add payment method' }).click();
    await expect(
      page.getByText('We could not open secure checkout just now. Please try again.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/billing$/);
  });

  await test.step('add a card through Checkout: pending, the Stripe page, back with the card', async () => {
    await expectPending(
      page,
      () => page.getByRole('button', { name: 'Add payment method' }).click(),
      page.getByRole('button', { name: 'Opening secure checkout…' }),
    );
    await page.waitForURL(/checkout\.stripe\.com/);
    await page.getByRole('link', { name: 'Save card' }).click();
    await page.waitForURL(/\/dashboard\/billing\?checkout=success/);
    await expect(page.getByText('Your card was saved.')).toBeVisible();
    await expect(page.getByText(/VISA ending 4242/)).toBeVisible();
  });
  await reloadAndExpect(page, 'the card on file', async () => {
    await expect(page.getByText(/VISA ending 4242/)).toBeVisible();
    await expect(page.getByText('Pay-as-you-go is on. Conversations 1–50')).toBeVisible();
  });

  await test.step('Overview: the cap is lifted', async () => {
    await page.goto('/dashboard');
    await expect(page.getByText(/Pay-as-you-go is on: above 50/)).toBeVisible();
    await expect(page.getByText("You've reached your 50 free conversations")).toHaveCount(0);
  });
});
