import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Connection, Luciel } from '@luciel/api-client';

/**
 * Round 7 WP-10, item 8 — the off-row Meta note read the raw grant status. One
 * Meta row serves WhatsApp and Messenger, so "connected" on it said "Its
 * connection is saved — nothing to set up again" on a row whose own id was
 * never bound; re-enabling landed on "Action needed: add the WhatsApp phone
 * number ID". Pinned here: the note derives from the BOUND destination per
 * surface, the never-bound row says the id is still owed, and the Manage
 * connection disclosure is still there to add it.
 */

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
      },
    },
  };
});

const allOff: Luciel = {
  instanceId: '55555555-5555-4555-8555-555555555555',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'voice', enabled: false, connectionStatus: 'unconfigured' },
    // The raw grant status rides the channel rows too — the trap this test pins.
    { id: 'whatsapp', enabled: false, connectionStatus: 'connected' },
    { id: 'messenger', enabled: false, connectionStatus: 'connected' },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

const metaRow = (destinations: Record<string, string>): Connection => ({
  connectionId: '66666666-6666-4666-8666-666666666666',
  connectionType: 'channel_auth',
  provider: 'meta',
  displayName: 'Meta',
  providerAvailable: true,
  status: 'connected',
  createdAt: '2026-02-01T10:00:00Z',
  nonSecretConfig: { destinations },
});

const rowOf = (toggleName: RegExp): HTMLElement => {
  const row = screen.getByRole('switch', { name: toggleName }).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

beforeEach(() => {
  served.connections = null;
});

describe('off-row Meta note derives from the bound destination', () => {
  it('a connected grant with only WhatsApp bound: WhatsApp saved, Messenger still owes its Page ID', async () => {
    served.connections = [metaRow({ whatsapp: '104857600000001' })];
    renderWithQuery(<ChannelsPillar luciel={allOff} />);

    const whatsapp = rowOf(/Enable WhatsApp/i);
    expect(
      await within(whatsapp).findByText(/Its connection is saved — nothing to set up again/i),
    ).toBeInTheDocument();

    const messenger = rowOf(/Enable Facebook Messenger/i);
    expect(
      await within(messenger).findByText(/still needs its Facebook Page ID before it answers/i),
    ).toBeInTheDocument();
    expect(within(messenger).queryByText(/nothing to set up again/i)).not.toBeInTheDocument();
    // The disclosure is still offered — that is where the id gets added.
    expect(within(messenger).getByText('Manage connection')).toBeInTheDocument();
  });

  it('a connected grant with nothing bound never says "nothing to set up again"', async () => {
    served.connections = [metaRow({})];
    renderWithQuery(<ChannelsPillar luciel={allOff} />);
    const whatsapp = rowOf(/Enable WhatsApp/i);
    expect(
      await within(whatsapp).findByText(/still needs its WhatsApp phone number ID/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nothing to set up again/i)).not.toBeInTheDocument();
  });

  it('no grant row at all: the raw channel status alone earns no note', async () => {
    served.connections = [];
    renderWithQuery(<ChannelsPillar luciel={allOff} />);
    await screen.findByRole('switch', { name: /Enable WhatsApp/i });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByText(/nothing to set up again/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/still needs its/i)).not.toBeInTheDocument();
  });
});
