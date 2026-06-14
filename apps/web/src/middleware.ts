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
 * 2. (Scaffold) auth gating for the (app) route group is stubbed: the real
 *    middleware will check the session cookie and redirect unauthenticated or
 *    unverified users (Arch §3.7.1a). Left as a TODO so we don't ship a fake
 *    auth check — honesty about what's not built (Space Instructions §3.7).
 */

const API_ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.vantagemind.com';
const STRIPE = 'https://js.stripe.com';
const STRIPE_API = 'https://api.stripe.com';
const STRIPE_CHECKOUT = 'https://checkout.stripe.com';
// hCaptcha (contact form) per hCaptcha's official CSP guidance.
const HCAPTCHA = 'https://hcaptcha.com https://*.hcaptcha.com';

export function middleware(request: NextRequest) {
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
