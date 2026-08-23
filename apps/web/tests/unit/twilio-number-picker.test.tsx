import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Connection, ConnectionProviders, Luciel } from '@luciel/api-client';

/**
 * The Twilio designate picker (audit round 3, C9 — owner concern #7).
 *
 * The platform already holds credentials able to list the account's numbers
 * (it uses them for webhook auto-config), yet the owner had to TYPE their
 * E.164 by hand. Pinned here:
 *
 *   - with credentials on file and no number yet, the account's own numbers
 *     render as one-tap "Use this number" rows, with manual entry kept as
 *     "enter a different number";
 *   - picking a number designates it through the same startConnection write
 *     as manual entry;
 *   - `numbers: null` (couldn't list) falls back to the manual field alone —
 *     the picker is a convenience and never blocks the designate step.
 */

const ROW_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const startConnection = vi.fn();
const served = vi.hoisted(() => ({
  connections: [] as Connection[],
  numbers: null as { numbers: { phoneNumber: string; friendlyName: string }[] | null } | null,
}));

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
        listTwilioNumbers: async () => served.numbers ?? { numbers: null },
        start: (...args: unknown[]) => Promise.resolve(startConnection(...args)),
      },
    },
  };
});

/** Credentials on file, NO number designated yet → the pick/enter step. */
const credentialedRow = (): Connection => ({
  connectionId: ROW_ID,
  connectionType: 'sms_sender',
  provider: 'twilio',
  displayName: 'Your Twilio account',
  providerAvailable: true,
  status: 'unconfigured',
  createdAt: '2026-05-01T10:00:00Z',
  nonSecretConfig: { accountSid: 'AC00000000000000000000000000000000' },
});

const luciel: Luciel = {
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
      connectionStatus: 'unconfigured',
      smsComplianceAcknowledgedAt: '2026-06-01T10:00:00Z',
    },
    { id: 'voice', enabled: true, connectionStatus: 'unconfigured' },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

beforeEach(() => {
  startConnection.mockReset().mockResolvedValue({ connectionId: ROW_ID });
  served.connections = [credentialedRow()];
  served.numbers = {
    numbers: [
      { phoneNumber: '+15005550006', friendlyName: 'Test line' },
      { phoneNumber: '+15005550007', friendlyName: 'Second test line' },
    ],
  };
});

describe('the designate picker lists the account numbers', () => {
  it('renders one-tap rows plus the manual fallback field', async () => {
    renderWithQuery(<ChannelsPillar luciel={luciel} />);

    expect(await screen.findByText('+15005550006')).toBeInTheDocument();
    expect(screen.getByText('+15005550007')).toBeInTheDocument();
    expect(screen.getByText(/Test line/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Use this number' })).toHaveLength(2);
    // Manual entry survives as the "different number" path.
    expect(screen.getByText(/enter a different number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Business phone number/i)).toBeInTheDocument();
  });

  it('picking a number designates it through the same write as manual entry', async () => {
    renderWithQuery(<ChannelsPillar luciel={luciel} />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Use this number' }))[0]);
    await waitFor(() => expect(startConnection).toHaveBeenCalled());
    expect(startConnection).toHaveBeenCalledWith('sms_sender', 'twilio', {
      phoneNumber: '+15005550006',
    });
  });
});

describe('couldn’t-list falls back to manual entry alone', () => {
  beforeEach(() => {
    served.numbers = { numbers: null };
  });

  it('renders the manual field with no picker rows and no error chrome', async () => {
    renderWithQuery(<ChannelsPillar luciel={luciel} />);

    expect(await screen.findByLabelText(/Business phone number/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this number' })).not.toBeInTheDocument();
    expect(screen.queryByText(/enter a different number/i)).not.toBeInTheDocument();
  });
});
