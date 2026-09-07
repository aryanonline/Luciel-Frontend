import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withMockSession } from './mock-session';

/**
 * Accessibility gate (Space Instructions §3, §8; Arch §5.16). WCAG 2.1 AA is
 * definition-of-done. This spec asserts no AA violations on the marketing
 * landing page. As surfaces are built, each adds its own axe assertion; a PR
 * that ships an AA violation is rejected.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Round 6 WP-J (audit F171): without the session cookie every /dashboard URL was
// bounced to /login by the middleware, so the dashboard checks below had been
// measuring the login page. Planting the presence cookie makes them measure the
// pages they name; the public pages are unaffected.
test.beforeEach(async ({ context }) => {
  await withMockSession(context);
});

test('landing page has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test('signup page has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/signup');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test('dashboard configure page has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/dashboard/configure');
  // Wait for the gated content (or its loading state) to settle.
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test('privacy policy page has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/legal/privacy');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test('DPA page has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/legal/dpa');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test('embed page (email provisioning) has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/dashboard/embed');
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test('dashboard overview (connection swap) has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});
