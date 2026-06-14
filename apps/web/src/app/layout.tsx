import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/lib/query-provider';

/**
 * Root layout. Shared by all route groups; each group adds its own chrome.
 * Inter is the single locked brand family (§5) — self-hosted via next/font so
 * it loads WITHOUT an external stylesheet that would weaken the strict CSP
 * (§3.6). next/font inlines the font CSS and serves the files same-origin.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600'],
});

/**
 * Force per-request (dynamic) rendering app-wide. This is REQUIRED for the
 * nonce-based CSP to work: a per-request nonce can only be applied to Next's
 * inline bootstrap scripts when the page is rendered per request. With static
 * prerendering, the build-time HTML has no nonce and the CSP blocks hydration
 * (breaking all interactivity). The cost is no static caching of these pages,
 * which is acceptable for an authenticated app shell + a small marketing site.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'VantageMind — Your business, answered.',
  description:
    'Assemble an AI employee for your business in minutes. Start free with 50 conversations a month — no credit card.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
