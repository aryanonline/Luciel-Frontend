'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Banner } from '@luciel/ui';
import type { ConnectionProviders } from '@luciel/api-client';
import { useConnectionProviders } from '@/lib/hooks';
import type { ActionNotice } from '@/lib/use-action-notice';

/**
 * What the owner is told when a provider's consent screen sends them back
 * (Arch §3.2.3/§3.8.7).
 *
 * The backend completes the exchange itself and 303s the browser to
 * `/dashboard/configure?status=connected&provider=…&connectionId=…`, or to
 * `status=error` carrying `reason` (and `client`, which names the sign-in when
 * the attempt failed before a provider was settled on). Landing back on the
 * configure screen with nothing but a changed chip is not an answer to "did
 * that work?" — the owner just left the product, approved something on someone
 * else's site, and came back.
 *
 * The params are read ONCE and then stripped, because a refresh or a back
 * button would otherwise re-announce a connection that happened minutes ago.
 */

const CONSENT_PARAMS = ['status', 'provider', 'connectionId', 'reason', 'client'];

interface ConsentResult {
  connected: boolean;
  /** Provider slug, resolved to a display name against the served registry. */
  slug: string | null;
  reason: string | null;
}

function readConsentResult(params: URLSearchParams): ConsentResult | null {
  const status = params.get('status');
  if (status !== 'connected' && status !== 'error') return null;
  return {
    connected: status === 'connected',
    slug: params.get('provider') ?? params.get('client'),
    reason: params.get('reason'),
  };
}

/**
 * The reasons in the owner's words. The vocabulary is the backend's and it is
 * open, so an unrecognized one is de-snaked and quoted rather than swallowed —
 * a wrong-but-specific reason is still something to act on, and "something went
 * wrong" is not.
 */
const REASONS: Record<string, string> = {
  access_denied: 'The consent screen was declined, so nothing was connected.',
  invalid_state:
    'That sign-in link had already been used or had expired. Start the connection again to get a fresh one.',
  state_expired:
    'That sign-in took too long and the link expired. Start the connection again to get a fresh one.',
  missing_code: 'The provider sent you back without a sign-in code. Please start the connection again.',
  exchange_failed:
    'We reached the provider but it would not complete the sign-in. Please start the connection again.',
  client_not_configured:
    'This sign-in is not switched on at our end yet. There is nothing for you to do — nothing was changed.',
  provider_error: 'The provider reported a problem with the sign-in. Please try again in a few minutes.',
  server_error: 'Something failed at our end while finishing the connection. Nothing was changed.',
};

function explain(reason: string | null): string {
  if (!reason) return 'The connection was not completed, and nothing was changed.';
  const known = REASONS[reason];
  if (known) return known;
  return `The provider reported: ${humanize(reason)}. Nothing was connected.`;
}

/** `google_calendar` → `Google calendar`, for a slug the registry does not name. */
function humanize(slug: string): string {
  const words = slug.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The provider's own name, from the served registry (Decision #6) — never a
 * hardcoded vendor. Falls back to the slug while the registry is still loading
 * or when it does not carry the provider, so the notice is never nameless.
 */
function providerName(groups: ConnectionProviders[] | undefined, slug: string | null): string {
  if (!slug) return 'That account';
  const served = groups
    ?.flatMap((group) => group.providers)
    .find((option) => option.provider === slug)?.displayName;
  return served ?? humanize(slug);
}

function ConsentLandingInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Every type's providers: the redirect names a provider, not the connection
  // type it belongs to.
  const providers = useConnectionProviders();

  const [result, setResult] = React.useState<ConsentResult | null>(() => readConsentResult(params));

  React.useEffect(() => {
    if (!CONSENT_PARAMS.some((key) => params.has(key))) return;
    const remaining = new URLSearchParams(params);
    CONSENT_PARAMS.forEach((key) => remaining.delete(key));
    const query = remaining.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [params, pathname, router]);

  if (!result) return null;

  // The same info/danger notice shape every config surface reports through, so
  // a connection landing reads like every other outcome on this screen.
  const name = providerName(providers.data, result.slug);
  const notice: ActionNotice = result.connected
    ? { tone: 'info', text: `${name} is connected. Luciel can use it from the next conversation on.` }
    : { tone: 'danger', text: `We could not connect ${name}. ${explain(result.reason)}` };

  return (
    <Banner tone={notice.tone} onDismiss={() => setResult(null)}>
      {notice.text}
    </Banner>
  );
}

/** `useSearchParams` needs a boundary for the statically rendered shell. */
export function ConsentLanding() {
  return (
    <Suspense fallback={null}>
      <ConsentLandingInner />
    </Suspense>
  );
}
