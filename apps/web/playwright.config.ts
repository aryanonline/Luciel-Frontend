import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E + accessibility config. Accessibility is a non-negotiable gate
 * (Space Instructions §3, §8; Arch §5.16) — a11y checks run via
 * @axe-core/playwright. The dev server is started automatically against the
 * mock adapter so E2E needs no backend.
 *
 * Two projects (round 6 WP-J, audit F171):
 *  - `chromium` — the routine run: a11y + the mock-adapter customer journey,
 *    against the local dev server started below.
 *  - `live-smoke` — selected ONLY when E2E_LIVE=1: a read-only walk of a deployed
 *    environment at E2E_BASE_URL with E2E_EMAIL / E2E_PASSWORD. No dev server is
 *    started for it, and the routine run never includes it.
 */
const live = process.env.E2E_LIVE === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: live ? process.env.E2E_BASE_URL : 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: live
    ? [
        {
          name: 'live-smoke',
          testMatch: /live-smoke\.spec\.ts/,
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        {
          name: 'chromium',
          testIgnore: /live-smoke\.spec\.ts/,
          use: { ...devices['Desktop Chrome'] },
        },
      ],
  ...(live
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { NEXT_PUBLIC_API_ADAPTER: 'mock' },
        },
      }),
});
