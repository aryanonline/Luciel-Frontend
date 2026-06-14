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
