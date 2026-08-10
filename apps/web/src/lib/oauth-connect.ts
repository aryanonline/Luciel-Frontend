import { MOCK_AUTHORIZE_ORIGIN } from '@luciel/api-client';
import { isHttpAdapter } from './api';

/**
 * The browser half of the OAuth connect flow (Arch §3.2.3/§3.8.7).
 *
 * Starting a connection mints a fresh, single-use, 10-minute signed state bound
 * to (admin, instance, connection, provider) and returns a REAL provider consent
 * URL. The admin's browser must be navigated to it in full — a `fetch` would
 * land the consent page in a response body instead of on screen — and an
 * authorize URL is never cached or reused across attempts.
 *
 * Two starts that are NOT a redirect:
 *  - a `statusDetail` beginning "Action needed:" means the provider has no
 *    registered OAuth client, and the URL is a placeholder. Show the detail.
 *  - `requiresClientForm` means this connection class is completed with details
 *    the admin types, not a sign-in.
 */

/** The only hosts we hand the browser to (Wave 1 contract §2 provider table). */
const PROVIDER_AUTHORIZE_HOSTS = [
  'accounts.google.com',
  'login.salesforce.com',
  'app.hubspot.com',
  'auth.calendly.com',
  // Meta channel connect — WhatsApp and Messenger (Decision #7).
  'www.facebook.com',
  // Instagram DMs sign in on Business Login for Instagram, which is a different
  // consent host from Facebook's — a Meta connection is two hosts, not one.
  'www.instagram.com',
  // BYO email sender (§3.1.6a): the customer's own Outlook mailbox signs in on
  // Microsoft's consent host.
  'login.microsoftonline.com',
];

const ACTION_NEEDED = 'Action needed:';

/** Survives the round-trip to the provider; the callback needs the connection id. */
const PENDING_KEY = 'luciel.pendingOauthConnection';

/**
 * Which callback route completes this flow. `knowledge` is the knowledge-sync
 * route (unchanged, and the one that reports a failed exchange only in its 409
 * body); `connection` is the GENERIC route that serves every other connection
 * type and persists the failure reason on the row (contract §2).
 */
export type OauthCallbackKind = 'knowledge' | 'connection';

export interface AuthorizeStart {
  /** Provider consent URL, or null for non-OAuth / unconfigured providers. */
  authorizeUrl?: string | null;
  statusDetail?: string | null;
  requiresClientForm?: boolean | null;
  provider: string;
  /** Known for knowledge-sync starts; the generic connect start does not return one. */
  connectionId?: string;
  /** Customer-facing name of the thing being connected. */
  label: string;
  /** Defaults to the knowledge-sync route, which is where connectionIds came from first. */
  callbackKind?: OauthCallbackKind;
}

export interface PendingConnection {
  provider: string;
  connectionId: string;
  callbackKind: OauthCallbackKind;
  /**
   * The `state` read off the authorize URL. Providers echo `state` back on the
   * redirect, so this is only a fallback for one that does not.
   */
  state?: string;
}

function isProviderAuthorizeUrl(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    host = parsed.host;
  } catch {
    return false;
  }
  if (PROVIDER_AUTHORIZE_HOSTS.includes(host)) return true;
  // The mock adapter's stand-in consent host, so the flow is walkable on mock.
  return !isHttpAdapter && host === new URL(MOCK_AUTHORIZE_ORIGIN).host;
}

/**
 * Send the admin to the provider's consent screen. Returns `null` once the
 * navigation has started, or the message to show when we deliberately did not go.
 */
export function authorizeOrExplain(start: AuthorizeStart): string | null {
  const detail = start.statusDetail ?? '';
  if (detail.startsWith(ACTION_NEEDED)) return detail;
  if (start.requiresClientForm) {
    return `${start.label} connects with details you enter rather than a sign-in, and we do not have that form in the dashboard yet. Nothing was connected.`;
  }
  if (!start.authorizeUrl || !isProviderAuthorizeUrl(start.authorizeUrl)) {
    return `We could not start a secure sign-in for ${start.label}. Please try again.`;
  }
  if (start.connectionId) {
    rememberPendingConnection({
      provider: start.provider,
      connectionId: start.connectionId,
      callbackKind: start.callbackKind ?? 'knowledge',
      state: stateFrom(start.authorizeUrl) ?? undefined,
    });
  }
  window.location.assign(start.authorizeUrl);
  return null;
}

/** The signed single-use CSRF proof the backend minted for this attempt. */
function stateFrom(authorizeUrl: string): string | null {
  try {
    return new URL(authorizeUrl).searchParams.get('state');
  } catch {
    return null;
  }
}

export function rememberPendingConnection(pending: PendingConnection): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* private mode / storage disabled — the callback falls back to the query. */
  }
}

/**
 * The flow stashed when this provider's connect started. A provider mismatch
 * falls back to whatever single flow is pending: the redirect path segment is
 * the backend's choice, and `state` is bound to (admin, instance, connection,
 * provider) server-side, so a wrong guess is rejected there rather than here.
 */
export function recallPendingConnection(provider: string): PendingConnection | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<PendingConnection>;
    if (!pending.connectionId) return null;
    return {
      provider: pending.provider ?? provider,
      connectionId: pending.connectionId,
      callbackKind: pending.callbackKind === 'connection' ? 'connection' : 'knowledge',
      state: pending.state,
    };
  } catch {
    return null;
  }
}

export function clearPendingConnection(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}
