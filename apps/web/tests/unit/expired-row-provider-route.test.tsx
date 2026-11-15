import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery, seededQueryClient } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import { qk } from '@/lib/hooks';
import type { Connection, ConnectionProviders, ConnectionStatus } from '@luciel/api-client';

/**
 * A saved CRM row whose sign-in needs renewing, with more than one CRM on offer.
 *
 * Once the provider registry had loaded, an expired HubSpot row offered "Connect
 * HubSpot", "Connect Salesforce" and "Connect Custom webhook", and every one of them
 * ran `reconnect` on the HubSpot row: "Connect Salesforce" sent the owner to HubSpot's
 * consent screen under Salesforce's name, and the webhook's details were sent to the
 * HubSpot row. The row's own provider now reads "Reconnect HubSpot" and reconnects it;
 * any other provider reads "Switch to …" and is staged by the swap that "Switch account
 * or provider" uses, so the row moves to it only once the new sign-in verifies.
 */

const authorizeOrExplain = vi.fn<(start: unknown) => string | null>(() => null);

vi.mock('@/lib/oauth-connect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oauth-connect')>();
  return { ...actual, authorizeOrExplain: (start: unknown) => authorizeOrExplain(start) };
});

const reconnect = vi.fn();
const swap = vi.fn();
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
        reconnect: (...args: unknown[]) => reconnect(...args),
        swap: (...args: unknown[]) => swap(...args),
        start: (...args: unknown[]) => start(...args),
        submitCredentials: (...args: unknown[]) => submitCredentials(...args),
      },
    },
  };
});

const HELD_ID = '55555555-5555-4555-8555-555555555555';

const hubspotRow = (status: ConnectionStatus): Connection => ({
  connectionId: HELD_ID,
  connectionType: 'crm',
  provider: 'hubspot',
  displayName: 'HubSpot',
  providerAvailable: true,
  status,
  createdAt: '2026-02-01T10:05:00Z',
});

const crmRegistry: ConnectionProviders[] = [
  {
    connectionType: 'crm',
    providers: [
      {
        provider: 'hubspot',
        displayName: 'HubSpot',
        authKind: 'oauth',
        helpText: 'Write captured leads into your HubSpot contacts.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
      {
        provider: 'salesforce',
        displayName: 'Salesforce',
        authKind: 'oauth',
        helpText: 'Write captured leads into your Salesforce org.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
      {
        provider: 'custom_webhook',
        displayName: 'Custom webhook',
        authKind: 'credential_form',
        helpText: 'Post captured leads to your own endpoint instead of a CRM.',
        configured: true,
        credentialFields: [{ name: 'url', label: 'Webhook URL', secret: false, required: true }],
        scopeKind: null,
      },
    ],
  },
];

/** The control with the CRM registry already served: the first render is the settled row. */
const renderRow = (status: ConnectionStatus) =>
  renderWithQuery(
    <ConnectionControl connectionType="crm" label="your CRM" connection={hubspotRow(status)} />,
    seededQueryClient([[qk.connectionProviders('crm'), crmRegistry]]),
  );

const buttonNames = () => screen.getAllByRole('button').map((button) => button.textContent);

beforeEach(() => {
  authorizeOrExplain.mockClear();
  authorizeOrExplain.mockReturnValue(null);
  reconnect.mockReset();
  swap.mockReset();
  start.mockReset();
  submitCredentials.mockReset();
});

describe('a saved row that needs a reconnect keeps its own provider', () => {
  it.each(['expired', 'error'] as const)(
    '%s: Reconnect for its own provider, Switch for the others, never a Connect',
    (status) => {
      renderRow(status);
      expect(buttonNames()).toEqual([
        'Reconnect HubSpot',
        'Switch to Salesforce',
        'Switch to Custom webhook',
      ]);
    },
  );

  it('"Reconnect HubSpot" re-authorizes the saved row on HubSpot', async () => {
    reconnect.mockResolvedValue({
      authorizeUrl: `https://accounts.example.com/oauth/authorize?provider=hubspot&connection_id=${HELD_ID}`,
    });
    renderRow('expired');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect HubSpot' }));

    await waitFor(() => expect(authorizeOrExplain).toHaveBeenCalledTimes(1));
    expect(reconnect).toHaveBeenCalledWith(HELD_ID);
    expect(swap).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(authorizeOrExplain).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'hubspot',
        label: 'HubSpot',
        connectionId: HELD_ID,
        callbackKind: 'connection',
      }),
    );
    // The flow has settled: the row's actions are offered again.
    expect(await screen.findByRole('button', { name: 'Reconnect HubSpot' })).toBeEnabled();
  });

  it('"Switch to Salesforce" stages a swap to Salesforce on the held row, never a HubSpot reconnect', async () => {
    swap.mockResolvedValue({
      authorizeUrl: `https://accounts.example.com/oauth/authorize?provider=salesforce&connection_id=${HELD_ID}`,
    });
    renderRow('expired');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Salesforce' }));

    await waitFor(() => expect(authorizeOrExplain).toHaveBeenCalledTimes(1));
    expect(swap).toHaveBeenCalledWith(HELD_ID, 'salesforce');
    expect(reconnect).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    // The consent screen and the name it is shown under are the same provider's.
    expect(authorizeOrExplain).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'salesforce',
        label: 'Salesforce',
        connectionId: HELD_ID,
        authorizeUrl: expect.stringContaining('provider=salesforce'),
      }),
    );
    // An expired row is not serving, so nothing claims it stays live meanwhile.
    expect(screen.queryByTestId('swap-reassurance')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Switch to Salesforce' })).toBeEnabled();
  });

  it('"Switch to Custom webhook" sends the endpoint to the staged swap, not to the HubSpot row', async () => {
    swap.mockResolvedValue({ requiresClientForm: true });
    submitCredentials.mockResolvedValue({
      ...hubspotRow('connected'),
      provider: 'custom_webhook',
      displayName: 'Custom webhook',
    });
    renderRow('expired');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Custom webhook' }));
    fireEvent.change(screen.getByLabelText(/Webhook URL/), {
      target: { value: 'https://hooks.example.com/leads' },
    });
    // The provider's own button above the form, then the form's submit, which names the
    // same switch.
    const [, submit] = screen.getAllByRole('button', { name: 'Switch to Custom webhook' });
    fireEvent.click(submit!);

    expect(
      await screen.findByText(
        'Custom webhook is connected. Your details are stored in the secrets vault.',
      ),
    ).toBeInTheDocument();
    expect(swap).toHaveBeenCalledWith(HELD_ID, 'custom_webhook');
    expect(submitCredentials).toHaveBeenCalledWith(HELD_ID, {
      url: 'https://hooks.example.com/leads',
    });
    expect(reconnect).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
