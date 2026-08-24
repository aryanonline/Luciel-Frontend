import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authorizeOrExplain } from '@/lib/oauth-connect';

/**
 * The consent-host allowlist is the frontend half of a two-sided contract: the
 * backend registry declares each provider's authorize endpoint, and
 * `authorizeOrExplain` refuses to hand the browser to any host outside
 * PROVIDER_AUTHORIZE_HOSTS. Round 4 (GAP-N1, live-caught in the Notion wiring
 * review): `api.notion.com` was missing, so Notion's Connect button could only
 * ever answer "We could not start a secure sign-in" — a dead flow with no
 * failing test. This table pins every REAL provider authorize host the backend
 * serves; its backend mirror is
 * test_every_oauth_authorize_host_is_mirrored_in_the_frontend_allowlist.
 * When one side changes, change both in the same commit.
 */

const REAL_AUTHORIZE_URLS: Array<[provider: string, url: string]> = [
  ['google_calendar', 'https://accounts.google.com/o/oauth2/v2/auth?state=s'],
  ['salesforce', 'https://login.salesforce.com/services/oauth2/authorize?state=s'],
  ['hubspot', 'https://app.hubspot.com/oauth/authorize?state=s'],
  ['calendly', 'https://auth.calendly.com/oauth/authorize?state=s'],
  ['meta', 'https://www.facebook.com/v19.0/dialog/oauth?state=s'],
  ['instagram', 'https://www.instagram.com/oauth/authorize?state=s'],
  ['outlook', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=s'],
  ['twilio', 'https://login.twilio.com/oauth2/authorize?state=s'],
  ['notion', 'https://api.notion.com/v1/oauth/authorize?state=s'],
];

const assign = vi.fn();
let originalLocation: Location;

beforeEach(() => {
  assign.mockClear();
  originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign },
  });
  sessionStorage.clear();
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('every real provider consent host is navigable', () => {
  it.each(REAL_AUTHORIZE_URLS)('%s → %s navigates', (provider, url) => {
    const explanation = authorizeOrExplain({
      authorizeUrl: url,
      provider,
      label: provider,
      callbackKind: 'connection',
    });
    expect(explanation).toBeNull();
    expect(assign).toHaveBeenCalledWith(url);
  });
});

describe('off-list and downgraded hosts are refused', () => {
  it('never navigates to a host outside the allowlist', () => {
    const explanation = authorizeOrExplain({
      authorizeUrl: 'https://evil.example.com/oauth/authorize',
      provider: 'notion',
      label: 'Notion',
    });
    expect(explanation).toMatch(/could not start a secure sign-in/);
    expect(assign).not.toHaveBeenCalled();
  });

  it('never navigates to a plain-http downgrade of an allowlisted host', () => {
    const explanation = authorizeOrExplain({
      authorizeUrl: 'http://api.notion.com/v1/oauth/authorize',
      provider: 'notion',
      label: 'Notion',
    });
    expect(explanation).toMatch(/could not start a secure sign-in/);
    expect(assign).not.toHaveBeenCalled();
  });
});
