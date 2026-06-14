'use client';

import * as React from 'react';

/**
 * Minimal hCaptcha wrapper (the stack already uses hCaptcha). Loads the hCaptcha
 * script once and renders the challenge into a container, returning the token
 * via onVerify. The token is what the BACKEND verifies server-side before
 * accepting a contact message — client-side presence is necessary but not
 * sufficient (defense in depth).
 *
 * SITE KEY: the site key is a PUBLIC value (safe in the client) — it is NOT the
 * secret. The secret lives only on the backend. Configure the real public key
 * via NEXT_PUBLIC_HCAPTCHA_SITE_KEY. Until then we use hCaptcha's official test
 * key so the widget renders in development without a real account.
 */
const TEST_SITE_KEY = '10000000-ffff-ffff-ffff-000000000001'; // hCaptcha's documented test key
const SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || TEST_SITE_KEY;

declare global {
  interface Window {
    hcaptcha?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
    __vmHcaptchaOnLoad?: () => void;
  }
}

export function HCaptcha({ onVerify }: { onVerify: (token: string | null) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const widgetId = React.useRef<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !ref.current || !window.hcaptcha || widgetId.current) return;
      widgetId.current = window.hcaptcha.render(ref.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => onVerify(token),
        'expired-callback': () => onVerify(null),
        'error-callback': () => onVerify(null),
      });
    };

    if (window.hcaptcha) {
      renderWidget();
    } else if (!document.getElementById('hcaptcha-script')) {
      const s = document.createElement('script');
      s.id = 'hcaptcha-script';
      s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=__vmHcaptchaOnLoad';
      s.async = true;
      s.defer = true;
      window.__vmHcaptchaOnLoad = renderWidget;
      document.head.appendChild(s);
    } else {
      // Script tag exists but not ready yet; poll briefly.
      const id = setInterval(() => {
        if (window.hcaptcha) {
          clearInterval(id);
          renderWidget();
        }
      }, 200);
      return () => clearInterval(id);
    }

    return () => {
      cancelled = true;
    };
  }, [onVerify]);

  return <div ref={ref} className="min-h-[78px]" aria-label="Spam protection challenge" />;
}
