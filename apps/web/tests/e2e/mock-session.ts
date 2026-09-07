import type { BrowserContext } from '@playwright/test';

/**
 * The (app) route group is gated server-side on the PRESENCE of the httpOnly
 * session cookie (middleware.ts, Arch §3.7.1a); the value is never read in the
 * browser. Against the MOCK adapter nothing ever sets that cookie, so every
 * dashboard URL bounced to /login — which is what the dashboard a11y checks had
 * been measuring (round 6 WP-J, audit F171). Planting a placeholder cookie is
 * exactly the presence signal the middleware asks for; the mock adapter answers
 * `me()` for the seeded, verified tenant from there.
 */
export const MOCK_SESSION_COOKIE = 'luciel_session';

export async function withMockSession(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: MOCK_SESSION_COOKIE,
      value: 'mock-session',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
