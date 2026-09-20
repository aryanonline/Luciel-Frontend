import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Connection, Luciel } from '@luciel/api-client';

/**
 * Round 7 WP-10, item 6 — WhatsApp had no prerequisite note while Instagram did.
 * The WhatsApp Business API refuses a number that is still active on the consumer
 * WhatsApp app until it is migrated off it (Arch §3.1.4). The row says so before
 * the sign-in, and stops saying it once the grant is connected — a prerequisite
 * met is not news.
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

const withWhatsApp: Luciel = {
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
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

const PREREQ = /already active on the consumer WhatsApp app cannot be used until it is migrated off/i;

beforeEach(() => {
  served.connections = null;
});

describe('WhatsApp row states its number prerequisite before the sign-in', () => {
  it('shows the consumer-app migration prerequisite while not connected', async () => {
    served.connections = [];
    renderWithQuery(<ChannelsPillar luciel={withWhatsApp} />);
    expect(await screen.findByText(PREREQ)).toBeInTheDocument();
  });

  it('stops showing it once the Meta grant is connected', async () => {
    served.connections = [
      {
        connectionId: '66666666-6666-4666-8666-666666666666',
        connectionType: 'channel_auth',
        provider: 'meta',
        displayName: 'Meta',
        providerAvailable: true,
        status: 'connected',
        createdAt: '2026-02-01T10:00:00Z',
        nonSecretConfig: { destinations: { whatsapp: '104857600000001' } },
      },
    ];
    renderWithQuery(<ChannelsPillar luciel={withWhatsApp} />);
    expect(await screen.findByText(/Answering on/i)).toBeInTheDocument();
    expect(screen.queryByText(PREREQ)).not.toBeInTheDocument();
  });
});
