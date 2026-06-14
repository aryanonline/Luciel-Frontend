import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E + accessibility config. Accessibility is a non-negotiable gate
 * (Space Instructions §3, §8; Arch §5.16) — a11y checks run via
 * @axe-core/playwright. The dev server is started automatically against the
 * mock adapter so E2E needs no backend.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_API_ADAPTER: 'mock' },
  },
});
