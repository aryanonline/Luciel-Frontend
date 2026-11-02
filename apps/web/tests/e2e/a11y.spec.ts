import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, type ScenarioName } from './support/fixtures';
import { MOCK_SESSION_COOKIE } from './mock-session';

/**
 * Accessibility gate (Space Instructions §3, §8; Arch §5.16). WCAG 2.1 AA is
 * definition-of-done: EVERY page of the app is measured, and a PR that ships an AA
 * violation is rejected.
 *
 * Round 7 WP-12: the gate covers every route under src/app (23 today) — the last
 * test fails when a page is added without an entry here. Each entry names the page's
 * own heading and the gate waits for it (and for no "Loading…" to be left) before
 * axe runs: round 6 WP-J (audit F171) found the dashboard checks had been measuring
 * the login page, because the middleware bounced them there. The URL is asserted too.
 *
 * The session-presence cookie is planted for every check (support/fixtures.ts — the
 * public pages are unaffected by it); a page that only exists in one account state
 * (first-run, the closed-account page) runs under that mock scenario.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const LUCIEL = "Sarah's Front-Desk Assistant";

interface Route {
  /** The route as the app serves it (what a page.tsx under src/app resolves to). */
  route: string;
  /** What the browser opens (the route, plus a token where the page needs one). */
  open?: string;
  /** The page's own heading: the gate measures nothing until it is on screen. */
  heading: string | RegExp;
  /** The account state the page exists in (default: the seeded, verified tenant). */
  scenario?: ScenarioName;
}

const ROUTES: Route[] = [
  // Marketing and legal.
  { route: '/', heading: 'Your business, answered.' },
  { route: '/contact', heading: 'We’d love to hear from you' },
  { route: '/embed-preview', heading: 'See a Luciel in action' },
  { route: '/legal/terms', heading: 'Terms of Service' },
  { route: '/legal/privacy', heading: 'Privacy Policy' },
  { route: '/legal/dpa', heading: 'Data Processing Addendum' },
  // Authentication journey.
  { route: '/signup', heading: 'Create your account' },
  { route: '/login', heading: 'Log in' },
  { route: '/forgot', heading: 'Reset your password' },
  { route: '/reset', open: '/reset?token=a11y-reset-token', heading: 'Set a new password' },
  { route: '/verify', heading: 'Check your email' },
  {
    route: '/escalation-contact/confirm',
    open: '/escalation-contact/confirm?token=a11y-confirm-token',
    heading: 'Address confirmed',
  },
  // The gated app.
  { route: '/first-run', heading: 'Let’s get your Luciel running', scenario: 'fresh' },
  { route: '/account-closed', heading: 'Your account is closed', scenario: 'closed' },
  { route: '/dashboard', heading: LUCIEL },
  { route: '/dashboard/configure', heading: `Configure ${LUCIEL}` },
  { route: '/dashboard/embed', heading: 'Embed & launch' },
  { route: '/dashboard/conversations', heading: 'Conversations' },
  { route: '/dashboard/leads', heading: 'Leads' },
  { route: '/dashboard/billing', heading: 'Billing' },
  { route: '/dashboard/analytics', heading: 'Analytics' },
  { route: '/dashboard/audit', heading: 'Audit log' },
  { route: '/dashboard/account', heading: 'Manage account' },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const r of ROUTES) {
  test.describe(`${r.route}${r.scenario ? ` (${r.scenario})` : ''}`, () => {
    if (r.scenario) test.use({ mockScenario: r.scenario });

    test('has no WCAG 2.1 AA violations', async ({ page }) => {
      await page.goto(r.open ?? r.route);
      // The page named — not a redirect target (F171).
      await expect(page).toHaveURL(new RegExp(`^[^?#]*//[^/]+${escape(r.route)}(\\?.*)?$`));
      // Apostrophes in served names are typographic or straight depending on the page.
      const name =
        typeof r.heading === 'string'
          ? new RegExp(`^${escape(r.heading).replace(/['’]/g, "['’]")}$`)
          : r.heading;
      await expect(page.getByRole('heading', { name }).first()).toBeVisible({
        timeout: 20_000,
      });
      // Settled: no loading state left for axe to measure instead of the page.
      await expect(page.getByText(/^Loading\b/)).toHaveCount(0, { timeout: 20_000 });
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(results.violations).toEqual([]);
    });
  });
}

// The crash page has no route. It is reached the way it was reached live: the page's
// chunk is gone when the owner navigates to it (one deploy's page, another's chunks).
test.describe('the crash page', () => {
  const ACCOUNT_CHUNK = /\/_next\/static\/chunks\/app\/.*dashboard\/account\/page.*\.js/;
  const CRASH_HEADING = 'This page didn’t load';

  const openDashboard = async (page: Page) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: LUCIEL }).first()).toBeVisible({
      timeout: 20_000,
    });
  };

  test('reloads by itself once and lands signed in on the page asked for', async ({ page }) => {
    // Gone once, there on the reload: a roll that finished in between.
    let aborted = 0;
    await page.route(ACCOUNT_CHUNK, async (route) => {
      if (aborted++ === 0) await route.abort();
      else await route.continue();
    });
    await openDashboard(page);

    await page.getByRole('link', { name: 'Manage account' }).click();
    await expect(page).toHaveURL(/\/dashboard\/account$/);
    await expect(page.getByRole('heading', { name: 'Manage account' })).toBeVisible({
      timeout: 20_000,
    });
    expect(await page.evaluate(() => sessionStorage.getItem('vm-chunk-reload-at'))).not.toBeNull();
  });

  // The path a roll really takes after the automatic reload: a file every page starts
  // from fails on a full page load, so nothing hydrates and no React boundary can run.
  test.describe('when a file fails during the page load', () => {
    const START_FILE = /\/_next\/static\/chunks\/main-app.*\.js/;
    const ACCOUNT = '/dashboard/account';

    const countLoads = (page: Page) => {
      const loads = { count: 0 };
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) loads.count++;
      });
      return loads;
    };

    test('reloads by itself once and lands on the page asked for', async ({ page }) => {
      let aborted = 0;
      await page.route(START_FILE, async (route) => {
        if (aborted++ === 0) await route.abort();
        else await route.continue();
      });
      const loads = countLoads(page);
      await page.goto(ACCOUNT, { waitUntil: 'commit' });
      await expect(page.getByRole('heading', { name: 'Manage account' })).toBeVisible({
        timeout: 20_000,
      });
      expect(loads.count).toBe(2);
      expect(
        await page.evaluate(() => sessionStorage.getItem('vm-chunk-reload-at')),
      ).not.toBeNull();
    });

    test('still failing, it stops with the copy; no violations; Reload recovers signed in', async ({
      page,
      context,
    }) => {
      await page.route(START_FILE, (route) => route.abort());
      const loads = countLoads(page);
      await page.goto(ACCOUNT, { waitUntil: 'commit' });

      await expect(page.getByRole('heading', { name: CRASH_HEADING })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(/info@vantagemind\.ai/)).toBeVisible();
      await page.waitForTimeout(1_000);
      expect(loads.count).toBe(2);

      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(results.violations).toEqual([]);

      expect((await context.cookies()).map((c) => c.name)).toContain(MOCK_SESSION_COOKIE);
      await page.unroute(START_FILE);
      await page.getByRole('button', { name: 'Reload' }).click();
      await expect(page).toHaveURL(/\/dashboard\/account$/);
      await expect(page.getByRole('heading', { name: 'Manage account' })).toBeVisible({
        timeout: 20_000,
      });
    });
  });

  test('has no WCAG 2.1 AA violations, and Reload keeps the session', async ({ page, context }) => {
    await page.route(ACCOUNT_CHUNK, (route) => route.abort());
    await openDashboard(page);
    // This tab already reloaded moments ago: the failure recurred, so the copy stays.
    await page.evaluate(() => sessionStorage.setItem('vm-chunk-reload-at', String(Date.now())));

    await page.getByRole('link', { name: 'Manage account' }).click();
    await expect(page.getByRole('heading', { name: CRASH_HEADING })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/info@vantagemind\.ai/)).toBeVisible();

    // nextjs-portal is the dev server's own error overlay, not the page.
    const results = await new AxeBuilder({ page })
      .withTags(TAGS)
      .exclude('nextjs-portal')
      .analyze();
    expect(results.violations).toEqual([]);

    // Still signed in: the chunk is back and the page asked for loads, not /login.
    expect((await context.cookies()).map((c) => c.name)).toContain(MOCK_SESSION_COOKIE);
    await page.unroute(ACCOUNT_CHUNK);
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard\/account$/);
    await expect(page.getByRole('heading', { name: 'Manage account' })).toBeVisible({
      timeout: 20_000,
    });
  });
});

/** Every page.tsx under src/app, as the route it serves (route groups dropped). */
function appRoutes(testDir: string): string[] {
  const root = join(testDir, '..', '..', 'src', 'app');
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry === 'page.tsx') {
        const segments = relative(root, dir)
          .split(sep)
          .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
        found.push(`/${segments.join('/')}`);
      }
    }
  };
  walk(root);
  return found.sort();
}

test('the gate covers every page the app serves', ({}, info) => {
  const covered = ROUTES.map((r) => r.route).sort();
  // testDir is apps/web/tests/e2e (playwright.config.ts).
  expect(covered).toEqual(appRoutes(info.project.testDir));
  expect(covered).toHaveLength(23);
});
