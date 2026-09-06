import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { ProviderGroup } from '@luciel/api-client';

/**
 * BYO outbound webhook end-to-end (audit round 3, Phase 5).
 *
 * The frontend had NO outbound_webhook registry group, so "Connect your
 * endpoint" rendered with no URL field and the mock redirected a WEBHOOK
 * "connection" to an OAuth consent screen. Pinned here: the served
 * credential-form group renders the URL + Authorization-header fields, and
 * the submit stores them against the row the start created — no sign-in
 * anywhere in the flow.
 */

const listProviders = vi.fn<() => Promise<ProviderGroup[]>>();
const start = vi.fn();
const submitCredentials = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        listProviders: () => listProviders(),
        // The lifecycle resolves the row id from list() after start — serve the
        // started row once start has run, like the real adapter would.
        list: async () =>
          start.mock.calls.length > 0
            ? [
                {
                  connectionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                  connectionType: 'outbound_webhook',
                  provider: 'outbound_webhook',
                  displayName: 'Outbound webhook',
                  providerAvailable: true,
                  status: 'unconfigured',
                  createdAt: '2026-08-01T10:00:00Z',
                },
              ]
            : [],
        start: (...args: unknown[]) => Promise.resolve(start(...args)),
        submitCredentials: (...args: unknown[]) => Promise.resolve(submitCredentials(...args)),
      },
    },
  };
});

const GROUP: ProviderGroup[] = [
  {
    connectionType: 'outbound_webhook',
    providers: [
      {
        provider: 'outbound_webhook',
        displayName: 'Outbound webhook',
        authKind: 'credential_form',
        helpText: 'Send structured events to a URL you control.',
        configured: true,
        credentialFields: [
          { name: 'url', label: 'Webhook URL', secret: false, required: true },
          { name: 'auth_header', label: 'Authorization header', secret: true, required: false },
        ],
      },
    ],
  },
];

beforeEach(() => {
  listProviders.mockReset().mockResolvedValue(GROUP);
  start.mockReset().mockResolvedValue({
    requiresClientForm: true,
    connectionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  });
  submitCredentials.mockReset().mockResolvedValue({});
});

describe('the endpoint registration is a credential form, never a sign-in', () => {
  it('renders the URL + auth header fields and submits them to the started row', async () => {
    renderWithQuery(<ConnectionControl connectionType="outbound_webhook" label="your endpoint" />);

    const url = await screen.findByLabelText(/Webhook URL/i);
    fireEvent.change(url, { target: { value: 'https://hooks.example.com/luciel' } });
    fireEvent.change(screen.getByLabelText(/Authorization header/i), {
      target: { value: 'Bearer shh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect your endpoint' }));

    await waitFor(() => expect(submitCredentials).toHaveBeenCalled());
    expect(start).toHaveBeenCalledWith('outbound_webhook', 'outbound_webhook');
    expect(submitCredentials).toHaveBeenCalledWith('dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      url: 'https://hooks.example.com/luciel',
      auth_header: 'Bearer shh',
    });
  });

  it('keeps the button held until the required URL is present', async () => {
    renderWithQuery(<ConnectionControl connectionType="outbound_webhook" label="your endpoint" />);

    const button = await screen.findByRole('button', { name: 'Connect your endpoint' });
    expect(button).toBeDisabled();
  });
});
