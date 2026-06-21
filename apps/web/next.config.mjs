/**
 * Next.js config. Security baseline wired from the start (Space Instructions §3):
 *  - HSTS (Strict-Transport-Security) on every response;
 *  - a strict CSP is set per-request in middleware.ts (nonce-based, so we avoid
 *    'unsafe-inline' for scripts) — see that file for the policy;
 *  - clickjacking + sniffing hardening here as static headers.
 *
 * Note: the dashboard must NOT be iframable (frame-ancestors 'none'); that lives
 * in the CSP in middleware. X-Frame-Options is set as a legacy backstop.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emit a self-contained server bundle (.next/standalone) so Next.js SSR runs on
  // AWS Amplify's compute hosting (and any container host). Without this, Amplify
  // treats the build as static files and dynamic/SSR routes 404. Interim host
  // setting for the temporary marketing site; harmless for the permanent edge.
  output: 'standalone',
  // In a pnpm monorepo the standalone tracer must root at the workspace, or the
  // hoisted node_modules are omitted from the server bundle. '../../' = repo root.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@luciel/ui', '@luciel/design-tokens', '@luciel/api-client'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
