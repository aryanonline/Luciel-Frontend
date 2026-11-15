import { test, expect } from './support/fixtures';

/**
 * The site icon as the app serves it (2026-11-14: the app had none, so browsers logged a
 * 404 for the /favicon.ico they fetch on their own). tests/unit/site-icon.test.tsx checks
 * the files in src/app; this checks what the server answers for them, which a middleware
 * change (a deny-by-default gate, a matcher edit) or a Next upgrade that moves the metadata
 * file convention could break with every file still in place. /icon.svg and
 * /apple-icon.png pass through middleware.ts; /favicon.ico is outside its matcher.
 *
 * The browser's own icon fetch never reaches Playwright's request events, so the files are
 * requested directly.
 */
const ICONS = [
  { rel: 'icon', href: '/favicon.ico', type: 'image/x-icon' },
  { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
  { rel: 'apple-touch-icon', href: '/apple-icon.png', type: 'image/png' },
];

/** "image/svg+xml; charset=utf-8" → "image/svg+xml". */
const mediaType = (contentType: string | undefined) => contentType?.split(';')[0]?.trim();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the icon files answer 200 with their image type, to a visitor with no session', async ({
  request,
}) => {
  // The request fixture shares no cookies with the page: a first visit, signed out. A
  // redirect (to /login, say) is a failure here, not something to follow.
  for (const icon of ICONS) {
    const response = await request.get(icon.href, { maxRedirects: 0 });
    expect(response.status(), icon.href).toBe(200);
    expect(mediaType(response.headers()['content-type']), icon.href).toBe(icon.type);
  }
});

// A marketing page, and a dashboard page under the planted session (support/fixtures.ts).
for (const route of ['/', '/dashboard']) {
  test(`${route} links the icons, and each link answers with its type`, async ({ page }) => {
    await page.goto(route);
    // The page named, not the /login a missing session bounces the dashboard to.
    await expect(page).toHaveURL(new RegExp(`^[^?#]*//[^/]+${escape(route)}(\\?.*)?$`));
    for (const icon of ICONS) {
      // Next adds a content hash to the SVG and PNG links (/icon.svg?62de…).
      const link = page.locator(`head link[rel="${icon.rel}"][href^="${icon.href}"]`);
      await expect(link, `${icon.rel} ${icon.href}`).toHaveCount(1);
      await expect(link).toHaveAttribute('type', icon.type);
      const href = (await link.getAttribute('href')) ?? '';
      const response = await page.request.get(href, { maxRedirects: 0 });
      expect(response.status(), href).toBe(200);
      expect(mediaType(response.headers()['content-type']), href).toBe(icon.type);
    }
  });
}
