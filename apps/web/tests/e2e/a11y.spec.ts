import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility gate (Space Instructions §3, §8; Arch §5.16). WCAG 2.1 AA is
 * definition-of-done. This spec asserts no AA violations on the marketing
 * landing page. As surfaces are built, each adds its own axe assertion; a PR
 * that ships an AA violation is rejected.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

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
