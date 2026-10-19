import { test, expect, expectPending, mockControl, reloadAndExpect } from '../support/fixtures';

/**
 * Scenario `closed` (round 7 WP-12; owner decision D5): the account was closed three
 * days ago, inside its 30-day reopen window. Every dashboard page leads to the
 * reduced page, which offers exactly two things — re-export and reopen — both
 * reported, and reopening brings the Luciel back as it was.
 */
test('a closed account gets the reduced page: re-export, then reopen', async ({ page }) => {
  await test.step('any dashboard page leads to the closed-account page', async () => {
    await page.goto('/dashboard/leads');
    await page.waitForURL(/\/account-closed$/);
    await expect(page.getByRole('heading', { name: 'Your account is closed' })).toBeVisible();
    await expect(
      page.getByText('Reopening brings everything back as it was before you closed'),
    ).toBeVisible();
  });

  await test.step('re-export: a failure is said, nothing pretends', async () => {
    await mockControl(page).failNext('account.requestExport');
    await page.getByRole('button', { name: 'Download my data again' }).click();
    await expect(page.getByText('Internal Server Error')).toBeVisible();
    await expect(page.getByText('Your export is ready.')).toHaveCount(0);
  });

  await test.step('re-export: pending, then the served link and what happened to the email', async () => {
    await expectPending(
      page,
      () => page.getByRole('button', { name: 'Download my data again' }).click(),
      page.getByRole('button', { name: 'Preparing…' }),
    );
    await expect(page.getByText('Your export is ready.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download your export' })).toBeVisible();
    await expect(page.getByText('We also emailed this link to you.')).toBeVisible();
  });
  await reloadAndExpect(page, 'the export left the account closed', async () => {
    await expect(page.getByRole('heading', { name: 'Your account is closed' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reopen my account' })).toBeEnabled();
  });

  await test.step('reopen: a failure keeps it closed and says so', async () => {
    await mockControl(page).failNext('account.reopen');
    await page.getByRole('button', { name: 'Reopen my account' }).click();
    await expect(page.getByText('Internal Server Error')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your account is closed' })).toBeVisible();
  });

  await test.step('reopen: pending, then what the reopen actually did', async () => {
    await expectPending(
      page,
      () => page.getByRole('button', { name: 'Reopen my account' }).click(),
      page.getByRole('button', { name: 'Reopening…' }),
    );
    await expect(page.getByRole('heading', { name: 'Your account is open again' })).toBeVisible();
    await expect(page.getByText('Your Luciel is back and answering again.')).toBeVisible();
  });
  await reloadAndExpect(page, 'the reopen', async () => {
    // Not closed any more: the reduced page sends the owner on to the dashboard.
    await page.waitForURL(/\/dashboard$/);
    await expect(page.getByRole('main').getByText('Active', { exact: true })).toBeVisible();
  });

  await test.step('the dashboard pages answer again', async () => {
    await page.goto('/dashboard/leads');
    await expect(page.getByRole('heading', { name: 'Leads', exact: true })).toBeVisible();
    await expect(page.getByText('Jordan P.').first()).toBeVisible();
  });
});
