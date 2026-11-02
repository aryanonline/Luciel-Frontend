'use client';

import localFont from 'next/font/local';
import './globals.css';
import { ErrorScreen, type ErrorScreenProps } from '@/components/error-screen';

// The root layout is gone when this renders, and its font variable with it. The base
// styles read var(--font-inter), which is invalid when undefined, so it is set here too.
const inter = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  display: 'swap',
  variable: '--font-inter',
  weight: '100 900',
});

/**
 * Catches an error in the root layout, replacing it, so this file renders its own
 * html and body. No inline script and no metadata export (a client file has none);
 * the title is a plain element, which React places in the head.
 */
export default function GlobalError(props: ErrorScreenProps) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <title>VantageMind</title>
        <ErrorScreen {...props} />
      </body>
    </html>
  );
}
