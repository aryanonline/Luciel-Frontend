import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Connection, ConnectionProviders, Luciel, ProviderOption } from '@luciel/api-client';

/**
 * Meta messaging is THREE channel rows on TWO grants (Arch §3.1.2, contract
 * §2). WhatsApp and Messenger are separate rows sharing the ONE Facebook grant
 * — signing in on either row authorizes both, but each row still binds its own
 * id before it answers. Instagram DMs sign in on Business Login for Instagram,
 * its own client on its own connection type — Facebook rejects an authorize
 * request carrying the `instagram_*` scopes and fails the whole dialog, so
 * riding the shared grant took WhatsApp and Messenger down with it.
 *
 * What the pillar owes the owner: each row connected on the client that can
 * actually connect it, each independently honest about whether it is available
 * (contract §1), never a shared Meta sign-in that claims to cover Instagram,
 * and a destination ask that names the row's OWN id — three rows, three
 * different ids.
 */

const startConnection = vi.fn();
const catalog = vi.fn<[string | undefined], ConnectionProviders[]>();
/** Connection rows served to the pillar; null falls through to the mock adapter. */
const served = vi.hoisted(() => ({ connections: null as Connection[] | null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        list: async () => served.connections ?? actual.api.connections.list(),
        listProviders: (connectionType?: string) => Promise.resolve(catalog(connectionType)),
        start: (...args: unknown[]) => Promise.resolve(startConnection(...args)),
      },
    },
  };
});

const oauth = (provider: string, displayName: string, configured: boolean): ProviderOption => ({
  provider,
  displayName,
  authKind: 'oauth',
  helpText: `${displayName} help text.`,
  configured,
  credentialFields: [],
  scopeKind: null,
});

/** The served catalog, with each client's availability set per test. The Meta
 *  provider's displayName is just "Meta" — each row carries its own channel
 *  name, so the registry label no longer enumerates surfaces. */
function servedCatalog({
  meta,
  instagram,
}: {
  meta: boolean;
  instagram: boolean;
}): ConnectionProviders[] {
  return [
    {
      connectionType: 'channel_auth',
      providers: [oauth('meta', 'Meta', meta)],
    },
    {
      connectionType: 'instagram_auth',
      providers: [oauth('instagram', 'Instagram', instagram)],
    },
    { connectionType: 'sms_sender', providers: [] },
  ];
}

function serve(availability: { meta: boolean; instagram: boolean }) {
  catalog.mockImplementation((connectionType) => {
    const groups = servedCatalog(availability);
    return connectionType ? groups.filter((g) => g.connectionType === connectionType) : groups;
  });
}

/** Both grants authorized, neither with any destination bound yet. */
const authorizedGrants = (): Connection[] => [
  {
    connectionId: '11111111-1111-4111-8111-111111111111',
    connectionType: 'channel_auth',
    provider: 'meta',
    status: 'connected',
    createdAt: '2026-02-01T10:00:00Z',
  },
  {
    connectionId: '22222222-2222-4222-8222-222222222222',
    connectionType: 'instagram_auth',
    provider: 'instagram',
    status: 'connected',
    createdAt: '2026-02-01T10:05:00Z',
  },
];

const base: Luciel = {
  instanceId: '55555555-5555-4555-8555-555555555555',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'voice', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'whatsapp', enabled: true },
    { id: 'messenger', enabled: true },
    { id: 'instagram', enabled: true },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

/** The <li> hosting a channel row, located from its enable toggle. */
const channelRow = (name: RegExp): HTMLElement => {
  const row = screen.getByRole('switch', { name }).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

beforeEach(() => {
  startConnection.mockReset();
  catalog.mockReset();
  served.connections = null;
  // Not a redirect: "Action needed:" short-circuits authorizeOrExplain before
  // it navigates, which jsdom cannot do.
  startConnection.mockResolvedValue({
    authorizeUrl: null,
    statusDetail: 'Action needed: nothing to redirect to in a test.',
  });
});

describe('§3.1.2: WhatsApp and Messenger are separate rows on the one Meta grant', () => {
  it("each row's connect button names the CHANNEL, not the vendor behind it", async () => {
    serve({ meta: true, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    // Owner feedback 2026-08-10: "Connect Meta" on a WhatsApp row speaks the
    // vendor's language, not the customer's. The button names the channel being
    // lit up; the surface copy still explains the shared Meta sign-in.
    const whatsapp = await screen.findByRole('button', { name: 'Connect WhatsApp' });
    const messenger = await screen.findByRole('button', { name: 'Connect Facebook Messenger' });
    expect(whatsapp).toBeEnabled();
    expect(messenger).toBeEnabled();
    expect(channelRow(/Enable WhatsApp/i)).toContainElement(whatsapp);
    expect(channelRow(/Enable Facebook Messenger/i)).toContainElement(messenger);
    expect(screen.queryByRole('button', { name: 'Connect Meta' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Connect Instagram' })).toBeEnabled();
  });

  it('starts the shared channel_auth/meta flow from either Meta row', async () => {
    serve({ meta: true, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect WhatsApp' }));
    await waitFor(() => expect(startConnection).toHaveBeenCalledWith('channel_auth', 'meta'));

    startConnection.mockClear();
    startConnection.mockResolvedValue({
      authorizeUrl: null,
      statusDetail: 'Action needed: nothing to redirect to in a test.',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Facebook Messenger' }));
    await waitFor(() => expect(startConnection).toHaveBeenCalledWith('channel_auth', 'meta'));
  });

  it('says on both Meta rows that the sign-in is shared — and that each row still owes its own id', async () => {
    serve({ meta: true, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    expect(
      await screen.findByText(/This Meta sign-in is shared with Facebook Messenger/i),
    ).toBeInTheDocument();
    expect(channelRow(/Enable WhatsApp/i)).toHaveTextContent(
      /one sign-in covers both rows, and each names its own id/i,
    );
    expect(channelRow(/Enable Facebook Messenger/i)).toHaveTextContent(
      /Messenger uses the same Meta sign-in as WhatsApp — signing in on either row covers both/i,
    );
    // Shared authorization is never shared liveness (honest connection states).
    expect(channelRow(/Enable Facebook Messenger/i)).toHaveTextContent(
      /still needs its own Facebook Page ID below before it answers/i,
    );
  });
});

describe('contract §2: Instagram is connected on its own client, never the Meta grant', () => {
  it('starts Instagram on instagram_auth and never asks the Meta grant for it', async () => {
    serve({ meta: true, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Instagram' }));
    await waitFor(() =>
      expect(startConnection).toHaveBeenCalledWith('instagram_auth', 'instagram'),
    );

    // The scope split is the whole point: asking Facebook for Instagram fails
    // the dialog outright and takes WhatsApp and Messenger down with it.
    expect(startConnection).not.toHaveBeenCalledWith('channel_auth', 'instagram');
    // The Instagram row offers no Meta-grant button.
    expect(
      within(channelRow(/Enable Instagram DM/i)).queryByRole('button', {
        name: /Connect (WhatsApp|Facebook Messenger)/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('forewarns that Instagram needs a professional account, before the sign-in', async () => {
    serve({ meta: true, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    // Meta's own prerequisite, discovered live: Business Login pushes a personal
    // account into a conversion flow mid-consent. Saying so here is the whole
    // point, so it must sit alongside the connect button, not after it.
    expect(
      await screen.findByText(/Requires an Instagram professional account/i),
    ).toBeInTheDocument();
    // It belongs to Instagram alone — WhatsApp and Messenger have no such gate.
    expect(screen.getAllByText(/professional account — business or creator/i)).toHaveLength(1);
  });

  it('never tells the owner the shared Meta sign-in covers Instagram', async () => {
    serve({ meta: true, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    await screen.findByRole('button', { name: 'Connect WhatsApp' });
    expect(screen.queryByText(/sign-in covers[^.]*Instagram/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Instagram has its own sign-in, so connecting it leaves WhatsApp/i),
    ).toBeInTheDocument();
  });
});

describe('contract §2: three rows, three distinct destination asks', () => {
  it('names each row’s own id in its action-needed chip once authorized', async () => {
    serve({ meta: true, instagram: true });
    served.connections = authorizedGrants();
    renderWithQuery(<ChannelsPillar luciel={base} />);

    // Authorized is not live: each row asks for the id IT answers on, by name —
    // a generic "name the id" cannot tell three rows apart.
    expect(
      await screen.findByText('Action needed: add the WhatsApp phone number ID'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Action needed: add the Facebook Page ID')).toBeInTheDocument();
    expect(
      await screen.findByText('Action needed: add the Instagram professional account ID'),
    ).toBeInTheDocument();
    // And never a false Connected chip while a destination is still owed.
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });
});

describe('contract §1: each client is honest-disabled on its own', () => {
  it('leaves WhatsApp and Messenger connectable when only Instagram is unconfigured', async () => {
    serve({ meta: true, instagram: false });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    expect(await screen.findByRole('button', { name: 'Connect WhatsApp' })).toBeEnabled();
    expect(
      await screen.findByRole('button', { name: 'Connect Facebook Messenger' }),
    ).toBeEnabled();
    expect(
      await screen.findByText(/Not available yet — Instagram sign-in not configured/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Instagram/i })).not.toBeInTheDocument();
  });

  it('leaves Instagram connectable when only the Meta app is unconfigured', async () => {
    serve({ meta: false, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    expect(await screen.findByRole('button', { name: 'Connect Instagram' })).toBeEnabled();
    // Both rows on the one grant — WhatsApp and Messenger — go down with it.
    expect(
      (await screen.findAllByText(/Not available yet — Meta app not configured/i)).length,
    ).toBe(2);
    expect(
      screen.queryByRole('button', { name: /Connect (WhatsApp|Facebook Messenger)/i }),
    ).not.toBeInTheDocument();
  });

  it('does not offer a connect button for a client the registry does not carry yet', async () => {
    catalog.mockImplementation((connectionType) => {
      const groups: ConnectionProviders[] = [
        {
          connectionType: 'channel_auth',
          providers: [oauth('meta', 'Meta', true)],
        },
        { connectionType: 'sms_sender', providers: [] },
      ];
      return connectionType ? groups.filter((g) => g.connectionType === connectionType) : groups;
    });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    expect(
      await screen.findByText(/Not available yet — Instagram sign-in not configured/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Instagram/i })).not.toBeInTheDocument();
  });
});
