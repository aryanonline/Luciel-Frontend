import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { QueryProvider } from '@/lib/query-provider';

/**
 * Root layout. Shared by BOTH route groups; each group adds its own layout
 * (marketing chrome vs. gated dashboard shell). Inter is loaded as the single
 * family (Space Instructions §5). The per-request CSP nonce (set in
 * middleware.ts) is read here so any inline script/style we add later can carry
 * it instead of forcing 'unsafe-inline'.
 */
export const metadata: Metadata = {
  title: 'VantageMind — Your business, answered.',
  description:
    'Assemble an AI employee for your business in minutes. Start free with 50 conversations a month.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the nonce marks the layout dynamic; acceptable for a scaffold.
  // The nonce is available for any inline script/style added in later PRs.
  void headers().get('x-nonce');
  return (
    <html lang="en">
      {/* Inter is declared in the token font stack with a system-ui fallback
          (Space Instructions §5). A self-hosted next/font Inter is wired in a
          later PR — we intentionally do NOT load an external font stylesheet,
          which would require weakening the strict CSP (§3.6). */}
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
