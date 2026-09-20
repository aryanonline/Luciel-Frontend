import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { Connection, ConnectionProviders } from '@luciel/api-client';

/**
 * Round 7 WP-10, item 9 — the proven-before-cutover reassurance rendered only in
 * the multi-provider branch. A pinned surface (Meta for WhatsApp) or a
 * single-provider type (a webhook) switched with no word that the current
 * connection keeps serving until the replacement verifies (Arch §3.8.7 B).
 * Pinned here for both shapes, and that "Keep the current one" withdraws it.
 */

const listProviders = vi.fn<(t?: string) => Promise<ConnectionProviders[]>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        listProviders: (t?: string) => listProviders(t),
      },
    },
  };
});

const REASSURANCE = /Your current connection stays live until the new one is verified/i;

const metaRegistry: ConnectionProviders[] = [
  {
    connectionType: 'channel_auth',
    providers: [
      {
        provider: 'meta',
        displayName: 'Meta',
        authKind: 'oauth',
        helpText: 'Sign in with Facebook.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
    ],
  },
];

const webhookRegistry: ConnectionProviders[] = [
  {
    connectionType: 'outbound_webhook',
    providers: [
      {
        provider: 'outbound_webhook',
        displayName: 'Your endpoint',
        authKind: 'credential_form',
        helpText: 'An https endpoint you run.',
        configured: true,
        credentialFields: [{ name: 'url', label: 'Endpoint URL', secret: false, required: true }],
        scopeKind: null,
      },
    ],
  },
];

const connectedMeta: Connection = {
  connectionId: '77777777-7777-4777-8777-777777777777',
  connectionType: 'channel_auth',
  provider: 'meta',
  displayName: 'Meta',
  providerAvailable: true,
  status: 'connected',
  createdAt: '2026-02-01T10:00:00Z',
  nonSecretConfig: { destinations: { whatsapp: '104857600000001' } },
};

const connectedWebhook: Connection = {
  connectionId: '88888888-8888-4888-8888-888888888888',
  connectionType: 'outbound_webhook',
  provider: 'outbound_webhook',
  displayName: 'Your endpoint',
  providerAvailable: true,
  status: 'connected',
  createdAt: '2026-02-01T10:00:00Z',
  nonSecretConfig: { url: 'https://hooks.example.com/luciel' },
};

beforeEach(() => {
  listProviders.mockReset();
});

describe('swap reassurance renders for pinned and single-provider surfaces', () => {
  it('a pinned Meta surface says the current connection keeps serving while switching', async () => {
    listProviders.mockResolvedValue(metaRegistry);
    renderWithQuery(
      <ConnectionControl
        connectionType="channel_auth"
        label="WhatsApp"
        provider="meta"
        connection={connectedMeta}
        destinationField={{ label: 'WhatsApp phone number ID', hint: '', channels: ['whatsapp'] }}
      />,
    );
    expect(screen.queryByText(REASSURANCE)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Switch account' }));
    expect(await screen.findByText(REASSURANCE)).toBeInTheDocument();
    // Backing out withdraws it.
    fireEvent.click(screen.getByRole('button', { name: /Keep the current one/i }));
    expect(screen.queryByText(REASSURANCE)).not.toBeInTheDocument();
  });

  it('a single-provider webhook says it too', async () => {
    listProviders.mockResolvedValue(webhookRegistry);
    renderWithQuery(
      <ConnectionControl
        connectionType="outbound_webhook"
        label="your endpoint"
        connection={connectedWebhook}
        fallbackProvider="outbound_webhook"
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Switch account' }));
    expect(await screen.findByText(REASSURANCE)).toBeInTheDocument();
  });
});
