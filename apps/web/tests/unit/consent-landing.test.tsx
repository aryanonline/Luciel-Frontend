import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ChannelConfig, Connection } from '@luciel/api-client';
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

/** Overridden per test so the landing can be driven against a real channel state. */
const served = vi.hoisted(() => ({
  channels: null as ChannelConfig[] | null,
  connections: null as Connection[] | null,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      luciel: {
        ...actual.api.luciel,
        get: async () => {
          const luciel = await actual.api.luciel.get();
          if (!luciel || !served.channels) return luciel;
          return { ...luciel, channels: served.channels };
        },
      },
      connections: {
        ...actual.api.connections,
        list: async () => served.connections ?? actual.api.connections.list(),
      },
    },
  };
});

beforeEach(() => {
  nav.replace.mockClear();
  served.channels = null;
  served.connections = null;
});

const metaGrant = (destinations?: Record<string, string>): Connection => ({
  connectionId: '66666666-6666-4666-8666-666666666666',
  connectionType: 'channel_auth',
  provider: 'meta',
  status: 'connected',
  createdAt: '2026-02-01T10:00:00Z',
  nonSecretConfig: destinations ? { destinations } : {},
});

const withWhatsApp = (): ChannelConfig[] => [
  { id: 'widget', enabled: true },
  { id: 'whatsapp', enabled: true },
];

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

/**
 * A grant is not a live channel. Meta authorization lands the channel at
 * "action needed: name the id Luciel answers on", so a banner claiming
 * "connected" contradicts the card directly below it — and the owner cannot
 * tell which one to believe.
 */
describe('consent landing — a grant that still owes a step', () => {
  it('says one step is left when the channel has no id bound yet', async () => {
    nav.params = new URLSearchParams({ status: 'connected', provider: 'meta' });
    served.channels = withWhatsApp();
    served.connections = [metaGrant()];
    renderWithQuery(<ConfigurePage />);

    expect(
      await screen.findByText(/Meta \(WhatsApp & Messenger\) is authorized — one step left\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Meta .* is connected\./)).not.toBeInTheDocument();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard/configure'));
  });

  it('says connected once the id is bound', async () => {
    nav.params = new URLSearchParams({ status: 'connected', provider: 'meta' });
    served.channels = withWhatsApp();
    served.connections = [metaGrant({ whatsapp: '1234567890' })];
    renderWithQuery(<ConfigurePage />);

    expect(
      await screen.findByText(
        /Meta \(WhatsApp & Messenger\) is connected\. Luciel can use it from the next conversation on\./,
      ),
    ).toBeInTheDocument();
  });

  it('claims only the authorization while the channel state is still unread', async () => {
    nav.params = new URLSearchParams({ status: 'connected', provider: 'meta' });
    served.channels = withWhatsApp();
    // No grant row served: the reads have not caught up with the redirect, so
    // neither "connected" nor "one step left" is a claim we can make.
    served.connections = [];
    renderWithQuery(<ConfigurePage />);

    expect(
      await screen.findByText(
        /Meta \(WhatsApp & Messenger\) is authorized\. If the channel below asks for an id/,
      ),
    ).toBeInTheDocument();
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
