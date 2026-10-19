import { test, expect, expectPending, mockControl, reloadAndExpect } from '../support/fixtures';

/**
 * Scenario `grace` (round 7 WP-12): the Luciel was deleted and is inside its 30-day
 * restore window. The pages it changes: the Overview (the state line), Configure
 * (inert — one banner, no pillars, because every write would be refused) and Manage
 * account (Restore, with Pause and Delete disabled).
 */
test('a deleted Luciel in its grace window is inert until restored — and restoring brings it back active', async ({
  page,
}) => {
  await test.step('Overview: deleted, in the grace window', async () => {
    await page.goto('/dashboard');
    await expect(page.getByText('Deleted — in grace window')).toBeVisible();
  });

  await test.step('Configure: one honest banner, no editable pillars', async () => {
    await page.goto('/dashboard/configure');
    await expect(page.getByText(/is deleted and in its 30-day restore window/)).toBeVisible();
    await expect(page.getByText('Channels your Luciel uses')).toHaveCount(0);
  });

  await test.step('Manage account: Restore offered; Pause and Delete are not', async () => {
    await page.goto('/dashboard/account');
    await expect(page.getByRole('button', { name: 'Restore my Luciel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause my Luciel' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete my Luciel' })).toBeDisabled();
  });

  await test.step('a failed restore says it is still deleted', async () => {
    await mockControl(page).failNext('luciel.restore');
    await page.getByRole('button', { name: 'Restore my Luciel' }).click();
    await expect(
      page.getByText('We could not restore your Luciel. It is still deleted — please try again.'),
    ).toBeVisible();
  });

  await test.step('restore: pending, then the window banner is gone', async () => {
    await expectPending(
      page,
      () => page.getByRole('button', { name: 'Restore my Luciel' }).click(),
      page.getByRole('button', { name: 'Restoring…' }),
    );
    await expect(page.getByText(/in its 30-day grace window/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause my Luciel' })).toBeEnabled();
  });
  await reloadAndExpect(page, 'the restore', async () => {
    await expect(page.getByRole('button', { name: 'Restore my Luciel' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete my Luciel' })).toBeEnabled();
  });

  await test.step('Configure: the pillars are back, as they were', async () => {
    await page.goto('/dashboard/configure');
    await expect(page.getByText('Channels your Luciel uses')).toBeVisible();
    await page.goto('/dashboard');
    await expect(page.getByRole('main').getByText('Active', { exact: true })).toBeVisible();
  });
});
