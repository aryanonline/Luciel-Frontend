import { test, expect, expectPending, mockControl, reloadAndExpect } from '../support/fixtures';

/**
 * Scenario `paused` (round 7 WP-12): the Luciel is paused. The pages it changes:
 * the Overview (the state line), and Manage account (Resume instead of Pause, with
 * its failure said where the button is).
 */
test('a paused Luciel says so, and resuming it is reported — failure and success', async ({
  page,
}) => {
  const header = page.getByRole('main').getByText(/^(Paused|Active)$/);

  await test.step('Overview: Paused', async () => {
    await page.goto('/dashboard');
    await expect(header).toHaveText('Paused');
  });

  await test.step('Manage account: Resume, not Pause', async () => {
    await page.goto('/dashboard/account');
    await expect(page.getByRole('button', { name: 'Resume my Luciel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause my Luciel' })).toHaveCount(0);
  });

  await test.step('a failed resume says it is still paused', async () => {
    await mockControl(page).failNext('luciel.resume');
    await page.getByRole('button', { name: 'Resume my Luciel' }).click();
    await expect(
      page.getByText('We could not resume your Luciel. It is still paused — please try again.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume my Luciel' })).toBeVisible();
  });

  await test.step('resume: pending, then the Pause action is back', async () => {
    await expectPending(
      page,
      () => page.getByRole('button', { name: 'Resume my Luciel' }).click(),
      page.getByRole('button', { name: 'Resuming…' }),
    );
    await expect(page.getByRole('button', { name: 'Pause my Luciel' })).toBeVisible();
  });
  await reloadAndExpect(page, 'the resume', async () => {
    await expect(page.getByRole('button', { name: 'Pause my Luciel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume my Luciel' })).toHaveCount(0);
  });

  await test.step('Overview: Active again', async () => {
    await page.goto('/dashboard');
    await expect(header).toHaveText('Active');
  });
});
