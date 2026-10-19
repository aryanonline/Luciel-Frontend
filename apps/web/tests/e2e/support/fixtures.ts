import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { MOCK_SESSION_COOKIE } from '../mock-session';

/**
 * Round 7 WP-12 — the e2e fixtures every mock project shares.
 *
 * `mockScenario` is a project OPTION (playwright.config.ts sets it per project): the
 * cookie the mock adapter reads at runtime to pick its scenario. Nothing is baked
 * into the build — one dev server serves every scenario project at once.
 * `plantSession` plants the session-presence cookie the middleware gates on (see
 * mock-session.ts); a walk that signs in for itself turns it off.
 */
export const MOCK_SCENARIO_COOKIE = 'luciel_mock_scenario';

export type ScenarioName =
  | 'verified'
  | 'fresh'
  | 'at_cap'
  | 'payg'
  | 'paused'
  | 'grace'
  | 'closed'
  | 'expired_session'
  | 'escalation_sms'
  | 'knowledge_states';

export interface MockOptions {
  /** The mock scenario this project runs (null = the build default, `verified`). */
  mockScenario: ScenarioName | null;
  /** Plant the session-presence cookie before the test (false: the test signs in). */
  plantSession: boolean;
}

export const test = base.extend<MockOptions>({
  mockScenario: [null, { option: true }],
  plantSession: [true, { option: true }],
  context: async ({ context, mockScenario, plantSession, baseURL }, use) => {
    const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
    const cookies = [];
    if (mockScenario) {
      cookies.push({
        name: MOCK_SCENARIO_COOKIE,
        value: mockScenario,
        domain: host,
        path: '/',
        sameSite: 'Lax' as const,
      });
    }
    if (plantSession) {
      cookies.push({
        name: MOCK_SESSION_COOKIE,
        // The expired_session scenario's whole point: the browser still holds a
        // cookie the server no longer honours.
        value: mockScenario === 'expired_session' ? 'stale-session' : 'mock-session',
        domain: host,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax' as const,
      });
    }
    if (cookies.length) await context.addCookies(cookies);
    await use(context);
  },
});

export { expect };

/**
 * The mock's e2e control surface (`window.__lucielMock`, installed by the mock
 * adapter's browser runtime). Every call waits for the page to have built its client.
 */
export function mockControl(page: Page) {
  const ready = () => page.waitForFunction(() => Boolean((window as never)['__lucielMock']));
  const call = async (method: string, ...args: unknown[]) => {
    await ready();
    await page.evaluate(
      ([m, a]) => {
        const control = (
          window as unknown as Record<string, Record<string, (...x: unknown[]) => void>>
        ).__lucielMock;
        control?.[m as string]?.(...(a as unknown[]));
      },
      [method, args] as const,
    );
  };
  return {
    /** The next `times` calls to `method` ("leads.archive") fail like a 500. */
    failNext: (method: string, times = 1) => call('failNext', method, times),
    /** Slow every call by `ms` so a pending state stays on screen long enough to read. */
    slow: (ms: number) => call('setExtraLatency', ms),
    /** The visitor's side ended the conversation while the page still shows it open. */
    endSession: (sessionId: string) => call('endSession', sessionId),
    /** The provider revoked this knowledge grant (the row still says connected). */
    revokeKnowledgeGrant: (connectionId: string) => call('revokeKnowledgeGrant', connectionId),
  };
}

/**
 * Pending is a state the owner must SEE (repo CLAUDE.md: every mutation shows
 * pending, success and error). The mock answers in ~150 ms, so the call is slowed
 * while the action runs and the pending label is asserted before it settles.
 */
export async function expectPending(
  page: Page,
  act: () => Promise<void>,
  pending: Locator,
  ms = 1500,
): Promise<void> {
  const control = mockControl(page);
  await control.slow(ms);
  try {
    await act();
    await expect(pending).toBeVisible();
  } finally {
    await control.slow(0);
  }
}

/**
 * The reload-after-mutation check (round 7 WP-12): a full reload drops every bit of
 * component state and the query cache, so whatever the assertions see afterwards
 * came back from the (mock) server. A page that only "remembered" a change locally
 * fails here.
 */
export async function reloadAndExpect(
  page: Page,
  what: string,
  assertions: () => Promise<void>,
): Promise<void> {
  await test.step(`reload — ${what} came back from the server`, async () => {
    await page.reload();
    await assertions();
  });
}
