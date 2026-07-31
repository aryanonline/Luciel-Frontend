import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import ConfigurePage from '@/app/(app)/dashboard/configure/page';

/**
 * OAuth consent landing (Arch §3.2.3/§3.8.7). The backend finishes the exchange
 * and 303s the browser back to the configure screen carrying the outcome. The
 * owner has just left the product, approved something on a provider's site and
 * come back — a silently changed chip is not an answer, and the params must not
 * survive the announcement or a refresh re-announces a stale connection.
 */

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: nav.replace,
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => nav.params,
  usePathname: () => '/dashboard/configure',
  useParams: () => ({}),
}));

beforeEach(() => {
  nav.replace.mockClear();
});

describe('consent landing — success', () => {
  it("names the provider from the served registry and clears the params", async () => {
    nav.params = new URLSearchParams({
      status: 'connected',
      provider: 'google_calendar',
      connectionId: '44444444-4444-4444-8444-444444444444',
    });
    renderWithQuery(<ConfigurePage />);

    // Case-sensitive on purpose: "Google Calendar" is the registry's
    // displayName. The de-snaked fallback would read "Google calendar", so this
    // fails if the name stops coming from the served catalog.
    expect(await screen.findByText(/Google Calendar is connected\./)).toBeInTheDocument();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard/configure'));
  });

  it('can be dismissed', async () => {
    nav.params = new URLSearchParams({ status: 'connected', provider: 'google_calendar' });
    renderWithQuery(<ConfigurePage />);

    const notice = await screen.findByText(/Google Calendar is connected\./);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss this message/i }));
    expect(notice).not.toBeInTheDocument();
  });
});

describe('consent landing — error', () => {
  it('gives the reason in plain language and clears the params', async () => {
    nav.params = new URLSearchParams({
      status: 'error',
      client: 'hubspot',
      reason: 'access_denied',
    });
    renderWithQuery(<ConfigurePage />);

    // `client` names the sign-in when the attempt failed before a provider was
    // settled on; the registry still supplies the capitalization.
    expect(await screen.findByText(/We could not connect HubSpot\./)).toBeInTheDocument();
    expect(screen.getByText(/The consent screen was declined/i)).toBeInTheDocument();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard/configure'));
  });
});
