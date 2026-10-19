import { defineConfig, devices, type PlaywrightTestProject } from '@playwright/test';
import type { MockOptions, ScenarioName } from './tests/e2e/support/fixtures';

/**
 * Playwright E2E + accessibility config. Accessibility is a non-negotiable gate
 * (Space Instructions §3, §8; Arch §5.16) — a11y checks run via
 * @axe-core/playwright. The dev server is started automatically against the
 * mock adapter so E2E needs no backend.
 *
 * Projects (round 6 WP-J; round 7 WP-12):
 *  - `chromium` — the routine run: the a11y gate over every route + the mock-adapter
 *    journey.
 *  - `scenario-<name>` — one per mock scenario (fresh, at-cap, payg, paused, grace,
 *    closed, expired-session). The scenario is a RUNTIME choice: the project plants
 *    the `luciel_mock_scenario` cookie the mock adapter reads, so one dev server
 *    serves every project at once. Each walks the pages its scenario changes, and
 *    every mutation is followed by a reload-after-mutation check (the mock persists
 *    its store, so what comes back after a reload came from the "server").
 *  - `walk` — the customer-style walk (tests/e2e/walk/customer-walk.spec.ts) against
 *    the mock: sign in → Today → every Configure pillar → Embed → Conversations →
 *    Leads → Analytics → Audit → Billing → Pause/Delete/Close. Timings land in the
 *    report as annotations.
 *  - `live-smoke` — ONLY when E2E_LIVE=1: a read-only walk of a deployed environment
 *    at E2E_BASE_URL with E2E_EMAIL / E2E_PASSWORD.
 *  - `live-walk` — ONLY when E2E_LIVE=1 AND E2E_LIVE_WRITE=1: the SAME walk spec
 *    against E2E_BASE_URL with the walk account (dispatch-only: live-walk.yml). It
 *    writes only to that tenant and skips, with the reason, every step that needs an
 *    owner asset or a provider consent. No trace, no video: nothing typed is kept.
 * No dev server is started for the live projects, and the routine run never
 * includes them.
 *
 * `E2E_CHROMIUM_EXECUTABLE` (optional) points Playwright at a Chromium build other
 * than the one @playwright/test pins — for a machine whose browser cache is older
 * than the installed Playwright and cannot download a new one. CI never sets it.
 */
const live = process.env.E2E_LIVE === '1';
const liveWrite = live && process.env.E2E_LIVE_WRITE === '1';
const executablePath = process.env.E2E_CHROMIUM_EXECUTABLE;

const chromium = {
  ...devices['Desktop Chrome'],
  ...(executablePath ? { launchOptions: { executablePath } } : {}),
};

/** The scenario projects — the mock scenarios a customer's account can be in. */
const SCENARIOS: ScenarioName[] = [
  'fresh',
  'at_cap',
  'payg',
  'paused',
  'grace',
  'closed',
  'expired_session',
];
const slug = (s: string) => s.replace(/_/g, '-');

const mockProjects: PlaywrightTestProject<MockOptions>[] = [
  {
    name: 'chromium',
    testMatch: /(a11y|journey)\.spec\.ts/,
    use: chromium,
  },
  ...SCENARIOS.map((scenario): PlaywrightTestProject<MockOptions> => ({
    name: `scenario-${slug(scenario)}`,
    testMatch: new RegExp(`scenarios[\\\\/]${slug(scenario)}\\.spec\\.ts`),
    use: { ...chromium, mockScenario: scenario },
  })),
  {
    name: 'walk',
    testMatch: /walk[\\/]customer-walk\.spec\.ts/,
    // The walk signs in like a customer: no planted session cookie.
    use: { ...chromium, mockScenario: 'verified', plantSession: false },
  },
];

const liveProjects: PlaywrightTestProject<MockOptions>[] = [
  {
    name: 'live-smoke',
    testMatch: /live-smoke\.spec\.ts/,
    use: chromium,
  },
  ...(liveWrite
    ? [
        {
          name: 'live-walk',
          testMatch: /walk[\\/]customer-walk\.spec\.ts/,
          // A deployed tenant is not a fixture to retry against: one pass, and no
          // trace/video that would keep what the walk typed.
          retries: 0,
          // A deployed dashboard answers over the network and reloads re-fetch every
          // query before a state line can render: the mock's 5 s is not a live budget
          // (the first live walk, 2026-10-19, lost a reload check to exactly that).
          expect: { timeout: 30_000 },
          use: {
            ...chromium,
            mockScenario: null,
            plantSession: false,
            trace: 'off',
            video: 'off',
            screenshot: 'only-on-failure',
          },
        } satisfies PlaywrightTestProject<MockOptions>,
      ]
    : []),
];

export default defineConfig<MockOptions>({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // `list` prints the walk's timing lines and every skipped step's reason to the
  // console; the HTML report keeps them as annotations.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: live ? process.env.E2E_BASE_URL : 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: live ? liveProjects : mockProjects,
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
