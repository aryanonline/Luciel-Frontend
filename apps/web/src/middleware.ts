import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request security middleware (Space Instructions §3.6, §6.1/§6.2).
 *
 * 1. Strict, nonce-based CSP:
 *    - default-src 'self'; no 'unsafe-inline' for scripts (we use a per-request
 *      nonce passed to next/script and inline styles where unavoidable);
 *    - connect-src allowlisted to the API origin + Stripe;
 *    - frame-src for Stripe Checkout only;
 *    - object-src 'none'; base-uri 'self';
 *    - frame-ancestors 'none' (dashboard must not be iframable — clickjacking
 *      defense). Applied app-wide here; the marketing site is also not meant to
 *      be framed.
 *
 * 2. Server-side auth gating for the (app) route group (Arch §3.7.1a):
 *    - The session cookie is httpOnly, so the JWT is NEVER read in JS
 *      (Space Instructions §3.3). The middleware checks for cookie PRESENCE
 *      as defense-in-depth UX redirect: unauthenticated → /login.
 *    - The API remains the authority for session validity: an absent cookie
 *      means unauthenticated with certainty; a present-but-expired cookie
 *      reaches the API which returns 401, and the client-side auth-guard or
 *      hooks.ts then redirects (Arch §3.7.1a). Verifying the JWT here would
 *      require the secret in the edge runtime and is out of scope for this
 *      defense-in-depth layer.
 *    - The verify-wall flow is preserved: the auth-guard component and
 *      me()→state routing handle unverified users (Space Instructions §7).
 */

const API_ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.vantagemind.com';
const STRIPE = 'https://js.stripe.com';
const STRIPE_API = 'https://api.stripe.com';
const STRIPE_CHECKOUT = 'https://checkout.stripe.com';
// hCaptcha (contact form) per hCaptcha's official CSP guidance.
const HCAPTCHA = 'https://hcaptcha.com https://*.hcaptcha.com';

/**
 * The session cookie name must match the backend (Arch §3.7.1a).
 * It is httpOnly so the value cannot be read here — only presence is checked.
 */
const SESSION_COOKIE = 'session';

/**
 * Path prefixes that belong to the (app) route group and require a session.
 * Must match the Next.js (app) group layout: /dashboard/*, /first-run/*.
 */
const APP_ROUTE_PREFIXES = ['/dashboard', '/first-run'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = crypto.randomUUID().replace(/-/g, '');

  const csp = [
    `default-src 'self'`,
    // Scripts: self + nonce + Stripe. No 'unsafe-inline'.
    `script-src 'self' 'nonce-${nonce}' ${STRIPE} ${HCAPTCHA}`,
    // Styles: 'self' + hCaptcha + 'unsafe-inline'. We deliberately do NOT put a
    // nonce on style-src: a nonce would cause the browser to IGNORE
    // 'unsafe-inline', which hCaptcha's injected widget styles require. Styles
    // are a low-risk vector; the meaningful protection is on script-src, which
    // keeps its nonce and omits 'unsafe-inline'.
    `style-src 'self' ${HCAPTCHA} 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${API_ORIGIN} ${STRIPE_API} ${HCAPTCHA}`,
    `frame-src ${STRIPE} ${STRIPE_CHECKOUT} ${HCAPTCHA}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  // ── Auth gate: (app) routes require the session cookie ─────────────────────
  // Cookie presence is a reliable negative signal: if the cookie is absent the
  // user is definitely not authenticated and must log in. If the cookie is
  // present the API is the authority on validity (it returns 401 on expiry and
  // the client routes to /login). This avoids JWT verification in middleware
  // while providing the correct UX redirect for the common unauthenticated case.
  const isAppRoute = APP_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isAppRoute) {
    const hasSession = request.cookies.has(SESSION_COOKIE);
    if (!hasSession) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      // Preserve the original destination so the login page can redirect back.
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  const requestHeaders = new Headers(request.headers);
  // Expose the nonce to the app (read in the root layout for next/script).
  requestHeaders.set('x-nonce', nonce);
  // CRITICAL: Next.js auto-applies this nonce to its OWN inline bootstrap/
  // hydration scripts ONLY when it sees the CSP (containing the nonce) on the
  // REQUEST headers it processes. Without this, Next emits un-nonced inline
  // scripts that the response CSP then blocks — breaking hydration entirely
  // (no interactivity, no hCaptcha, no animations). Setting it here is the
  // documented App Router nonce pattern.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Apply to everything except static assets and the Next image optimizer.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
