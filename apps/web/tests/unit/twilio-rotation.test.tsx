import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Connection, ConnectionProviders, ConnectionStatus, Luciel } from '@luciel/api-client';

/**
 * Twilio credential maintainability (Arch §3.8.7 rule B, owner concern #1).
 *
 * The BYO credential form existed only as step one of a fresh connect: once an
 * Account SID was on file there was NO way to re-enter or rotate the Twilio
 * credentials, and an expired credential fell into the wrong affordance ("add
 * your number") because the two-step derivation only knew connected/pending.
 * Pinned here:
 *
 *   - expired/error on the served number status shows the honest chip
 *     ("Reconnect needed: update your Twilio credentials") on BOTH phone rows,
 *     and the panel opens on the credential form with repair copy — never the
 *     number field;
 *   - submitting the repair re-credentials the EXISTING row (reconnect →
 *     submitCredentials), so the number and settings survive;
 *   - a HEALTHY row offers "Update Twilio credentials" (rotation without a
 *     teardown), revealed on demand and cancellable.
 */

const NUMBER = '+14155551234';
const ROW_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const reconnectConnection = vi.fn();
const submitCredentials = vi.fn();
const served = vi.hoisted(() => ({ connections: [] as Connection[] }));

/** The served registry: the one Twilio credential_form option (mock seed shape). */
const CATALOG: ConnectionProviders[] = [
  {
    connectionType: 'sms_sender',
    providers: [
      {
        provider: 'twilio',
        displayName: 'Your Twilio account',
        authKind: 'credential_form',
        helpText: 'Luciel texts and calls from your own business number.',
        configured: true,
        credentialFields: [
          { name: 'accountSid', label: 'Twilio Account SID (AC…)', secret: false, required: true },
          { name: 'authToken', label: 'Twilio Auth Token', secret: true, required: false },
          { name: 'apiKeySid', label: 'API Key SID (SK…)', secret: false, required: false },
          { name: 'apiKeySecret', label: 'API Key Secret', secret: true, required: false },
        ],
        scopeKind: null,
      },
    ],
  },
];

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        list: async () => served.connections,
        listProviders: async (connectionType?: string) =>
          connectionType ? CATALOG.filter((g) => g.connectionType === connectionType) : CATALOG,
        reconnect: (...args: unknown[]) => Promise.resolve(reconnectConnection(...args)),
        submitCredentials: (...args: unknown[]) => Promise.resolve(submitCredentials(...args)),
      },
    },
  };
});

/** The sms_sender row with the customer's account + number already on file. */
const twilioRow = (status: ConnectionStatus): Connection => ({
  connectionId: ROW_ID,
  connectionType: 'sms_sender',
  provider: 'twilio',
  displayName: 'Your Twilio account',
  providerAvailable: true,
  status,
  createdAt: '2026-05-01T10:00:00Z',
  nonSecretConfig: { accountSid: 'AC00000000000000000000000000000000', destination: NUMBER },
});

const lucielWith = (connectionStatus: ConnectionStatus): Luciel => ({
  instanceId: '66666666-6666-4666-8666-666666666666',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    {
      id: 'sms',
      enabled: true,
      connectionStatus,
      smsComplianceAcknowledgedAt: '2026-06-01T10:00:00Z',
    },
    { id: 'voice', enabled: true, connectionStatus },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
});

beforeEach(() => {
  reconnectConnection.mockReset().mockResolvedValue({ requiresClientForm: true });
  submitCredentials.mockReset().mockResolvedValue(twilioRow('connected'));
  served.connections = [twilioRow('expired')];
});

describe('an expired Twilio credential asks for credentials, not a number', () => {
  it('shows the reconnect chip on both phone rows and opens the repair form', async () => {
    renderWithQuery(<ChannelsPillar luciel={lucielWith('expired')} />);

    // One shared credential, one shared state: SMS and Voice both say it.
    expect(
      screen.getAllByText('Reconnect needed: update your Twilio credentials'),
    ).toHaveLength(2);
    expect(
      await screen.findByText(/stopped accepting the saved credentials/i),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/Twilio Account SID/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify and save' })).toBeInTheDocument();
    // The WRONG affordances: the number is on file and is not the problem.
    expect(screen.queryByLabelText(/Business phone number/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/add your number/i)).not.toBeInTheDocument();
  });

  it('re-credentials the EXISTING row: reconnect, then verified credentials', async () => {
    renderWithQuery(<ChannelsPillar luciel={lucielWith('expired')} />);

    fireEvent.change(await screen.findByLabelText(/Twilio Account SID/i), {
      target: { value: 'AC11111111111111111111111111111111' },
    });
    fireEvent.change(screen.getByLabelText(/Twilio Auth Token/i), {
      target: { value: 'new-auth-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }));

    await waitFor(() => expect(submitCredentials).toHaveBeenCalled());
    // Staged on the same row (§3.8.7 B) — never a disconnect + fresh connect.
    expect(reconnectConnection).toHaveBeenCalledWith(ROW_ID);
    expect(submitCredentials).toHaveBeenCalledWith(
      ROW_ID,
      expect.objectContaining({
        accountSid: 'AC11111111111111111111111111111111',
        authToken: 'new-auth-token',
      }),
    );
  });
});

describe('a healthy row offers credential rotation without a teardown', () => {
  beforeEach(() => {
    served.connections = [twilioRow('connected')];
  });

  it('reveals the rotate form on demand and can be cancelled', async () => {
    renderWithQuery(<ChannelsPillar luciel={lucielWith('connected')} />);

    expect(await screen.findByText(NUMBER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Update Twilio credentials/i }));

    expect(await screen.findByText(/Rotating your Twilio credentials/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify and save' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Keep current credentials/i }));
    expect(screen.queryByText(/Rotating your Twilio credentials/i)).not.toBeInTheDocument();
    expect(screen.getByText(NUMBER)).toBeInTheDocument();
  });
});
