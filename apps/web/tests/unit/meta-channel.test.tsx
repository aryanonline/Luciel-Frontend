import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { ConnectionProviders, Luciel, ProviderOption } from '@luciel/api-client';

/**
 * Meta messaging is TWO grants (contract §2). The Facebook grant covers
 * WhatsApp and Messenger; Instagram DMs sign in on Business Login for
 * Instagram, its own client on its own connection type — Facebook rejects an
 * authorize request carrying the `instagram_*` scopes and fails the whole
 * dialog, so riding the shared grant took WhatsApp and Messenger down with it.
 *
 * What the pillar owes the owner: each surface connected on the client that can
 * actually connect it, each independently honest about whether it is available
 * (contract §1), and never a shared Meta sign-in that claims to cover Instagram.
 */

const startConnection = vi.fn();
const catalog = vi.fn<[string | undefined], ConnectionProviders[]>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
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

/** The served catalog, with each client's availability set per test. */
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
      providers: [oauth('meta', 'Meta (WhatsApp & Messenger)', meta)],
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
    { id: 'instagram_messenger', enabled: true },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

beforeEach(() => {
  startConnection.mockReset();
  catalog.mockReset();
  // Not a redirect: "Action needed:" short-circuits authorizeOrExplain before
  // it navigates, which jsdom cannot do.
  startConnection.mockResolvedValue({
    authorizeUrl: null,
    statusDetail: 'Action needed: nothing to redirect to in a test.',
  });
});

describe('contract §2: Instagram is connected on its own client, Messenger on the Meta one', () => {
  it('offers each surface its own connect button, named by the served registry', async () => {
    serve({ meta: true, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    // Case-sensitive on the registry's displayName: these names are served, not
    // written into the pillar, so this fails if either is ever hardcoded. Two
    // Meta buttons, because WhatsApp and Messenger are two surfaces on the one
    // grant and either can start it.
    const metaButtons = await screen.findAllByRole('button', {
      name: 'Connect Meta (WhatsApp & Messenger)',
    });
    expect(metaButtons).toHaveLength(2);
    metaButtons.forEach((button) => expect(button).toBeEnabled());
    expect(await screen.findByRole('button', { name: 'Connect Instagram' })).toBeEnabled();
  });

  it('starts each connect on the client that can actually complete it', async () => {
    serve({ meta: true, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Instagram' }));
    await waitFor(() =>
      expect(startConnection).toHaveBeenCalledWith('instagram_auth', 'instagram'),
    );

    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Connect Meta (WhatsApp & Messenger)' }))[0],
    );
    await waitFor(() => expect(startConnection).toHaveBeenCalledWith('channel_auth', 'meta'));

    // The scope split is the whole point: asking Facebook for Instagram fails
    // the dialog outright and takes WhatsApp and Messenger down with it.
    expect(startConnection).not.toHaveBeenCalledWith('channel_auth', 'instagram');
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

    expect(
      await screen.findByText(/This one Meta sign-in covers WhatsApp and Facebook Messenger/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Meta sign-in covers.*Instagram/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Instagram has its own sign-in, so connecting it leaves WhatsApp/i),
    ).toBeInTheDocument();
  });
});

describe('contract §1: each client is honest-disabled on its own', () => {
  it('leaves WhatsApp connectable when only Instagram is unconfigured', async () => {
    serve({ meta: true, instagram: false });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    expect(
      await screen.findAllByRole('button', { name: 'Connect Meta (WhatsApp & Messenger)' }),
    ).toHaveLength(2);
    expect(
      await screen.findByText(/Not available yet — Instagram sign-in not configured/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Instagram/i })).not.toBeInTheDocument();
  });

  it('leaves Instagram connectable when only the Meta app is unconfigured', async () => {
    serve({ meta: false, instagram: true });
    renderWithQuery(<ChannelsPillar luciel={base} />);

    expect(await screen.findByRole('button', { name: 'Connect Instagram' })).toBeEnabled();
    // Both Meta surfaces — WhatsApp and Messenger — go down with the one grant.
    expect(
      (await screen.findAllByText(/Not available yet — Meta app not configured/i)).length,
    ).toBe(2);
    expect(screen.queryByRole('button', { name: /^Connect Meta/i })).not.toBeInTheDocument();
  });

  it('does not offer a connect button for a client the registry does not carry yet', async () => {
    catalog.mockImplementation((connectionType) => {
      const groups: ConnectionProviders[] = [
        {
          connectionType: 'channel_auth',
          providers: [oauth('meta', 'Meta (WhatsApp & Messenger)', true)],
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
