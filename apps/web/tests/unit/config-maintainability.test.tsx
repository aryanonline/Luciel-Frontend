import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { Acknowledgements } from '@/components/config/acknowledgements';
import { KnowledgeConnections } from '@/components/config/knowledge-connections';
import { EscalationPillar } from '@/components/config/escalation-pillar';
import { EmailChannelProvisioning } from '@/components/config/email-provisioning';
import { ConnectionControl } from '@/components/config/connection-control';
import { ChannelsPillar, numberOutcomePhrase } from '@/components/config/channels-pillar';
import { chipKind, offRowConnectionNote } from '@/components/config/labels';
import type { Connection, ConnectionProviders, KnowledgeSource, Luciel } from '@luciel/api-client';

/**
 * Round 6 WP-D (item 10): everything connected or acknowledged can be changed or
 * taken back from Configure — with the toggle off, without a support ticket — and
 * the copy phrases the served state, never the happy path.
 */
const calls = vi.hoisted(() => ({
  withdrawVoice: 0,
  withdrawSmsAck: 0,
  withdrawAttest: 0,
  disconnect: [] as string[],
  updateEscalation: [] as unknown[],
  submitCredentials: [] as unknown[],
  bindDestination: [] as unknown[],
  updateChannels: [] as unknown[],
  updateTools: 0,
  start: [] as unknown[],
}));

const served = vi.hoisted(() => ({
  connections: [] as Connection[],
  providers: [] as ConnectionProviders[],
  sources: [] as KnowledgeSource[],
  smsStatus: 'pending_carrier_registration' as Connection['status'],
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  const lucielNow = async () => (await actual.api.luciel.get())!;
  return {
    ...actual,
    api: {
      ...actual.api,
      luciel: {
        ...actual.api.luciel,
        withdrawVoiceConsent: async () => {
          calls.withdrawVoice += 1;
          return lucielNow();
        },
        withdrawSmsComplianceAck: async () => {
          calls.withdrawSmsAck += 1;
          return lucielNow();
        },
        updateEscalation: async (contact: unknown) => {
          calls.updateEscalation.push(contact);
          return lucielNow();
        },
        updateChannels: async (channels: Luciel['channels']) => {
          calls.updateChannels.push(channels);
          const base = await lucielNow();
          // The SERVER cascades the send tool off with its channel (F163).
          const emailOff = channels.some((c) => c.id === 'email' && !c.enabled);
          return {
            ...base,
            channels,
            tools: base.tools.map((t) =>
              t.id === 'send_email' && emailOff
                ? { ...t, enabled: false, disabledReason: 'email_channel_disabled' }
                : t,
            ),
          };
        },
        updateTools: async () => {
          calls.updateTools += 1;
          return lucielNow();
        },
      },
      connections: {
        ...actual.api.connections,
        list: async () => served.connections,
        listProviders: async () => served.providers,
        getEmailProvisioning: async () => null,
        disconnect: async (id: string) => {
          calls.disconnect.push(id);
          const c = served.connections.find((x) => x.connectionId === id)!;
          return { connection: c, secretDeleted: true, disabledTools: [], disabledChannels: [] };
        },
        withdrawSmsAttestation: async () => {
          calls.withdrawAttest += 1;
          return served.connections[0];
        },
        submitCredentials: async (id: string, fields: Record<string, string>) => {
          calls.submitCredentials.push({ id, fields });
          return served.connections.find((x) => x.connectionId === id)!;
        },
        bindDestination: async (id: string, destination: string, channel?: string) => {
          calls.bindDestination.push({ id, destination, channel });
          return served.connections.find((x) => x.connectionId === id)!;
        },
        start: async (...args: unknown[]) => {
          calls.start.push(args);
          return { authorizeUrl: null, requiresClientForm: false };
        },
        listTwilioNumbers: async () => ({ numbers: null }),
      },
      knowledge: {
        ...actual.api.knowledge,
        listSources: async () => served.sources,
      },
    },
  };
});

const base: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Aurora',
  websiteUrl: 'acme.example',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: true, connectionStatus: 'connected' },
    {
      id: 'sms',
      enabled: false,
      connectionStatus: 'connected',
      smsComplianceAcknowledgedAt: '2026-08-01T10:00:00Z',
    },
    {
      id: 'voice',
      enabled: true,
      connectionStatus: 'connected',
      voiceConsentAcknowledgedAt: '2026-08-02T10:00:00Z',
    },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [
    { id: 'send_sms', enabled: false },
    { id: 'send_email', enabled: true },
    { id: 'book_appointment', enabled: false },
    { id: 'check_availability', enabled: false },
    { id: 'lookup_record', enabled: false },
    { id: 'schedule_callback', enabled: false },
    { id: 'push_to_crm', enabled: false },
    { id: 'bring_your_own_webhook', enabled: false },
  ],
  escalation: { primaryEmail: 'owner@acme.example', primarySms: '+16045550001' },
  escalationContactHealth: [],
  personality: { preset: 'warm_concierge' },
  leadRetentionDays: null,
  allowedOrigins: null,
  timezone: null,
  teamAvailability: null,
};

const row = (over: Partial<Connection>): Connection => ({
  connectionId: '11111111-1111-4111-8111-111111111111',
  connectionType: 'sms_sender',
  provider: 'twilio',
  status: 'connected',
  statusDetail: null,
  nonSecretConfig: {},
  lastHealthCheckAt: null,
  ...over,
});

const providers = (
  connectionType: string,
  options: ConnectionProviders['providers'],
): ConnectionProviders => ({ connectionType: connectionType as never, providers: options });

describe('WP-D: labels phrase the served state', () => {
  it('chipKind honours provider availability (F165) and dormant reads as billing (F162)', () => {
    expect(chipKind('connected', false)).toBe('not_available');
    expect(chipKind('connected')).toBe('connected');
    expect(chipKind('expired', true)).toBe('reconnect_needed');
    expect(offRowConnectionNote('dormant')).toMatch(/Billing page/);
  });

  it('phrases the designate outcome from the served status (F159)', () => {
    expect(numberOutcomePhrase('+1', 'connected')).toMatch(/Voice and texting answer on it now/);
    expect(numberOutcomePhrase('+1', 'pending_carrier_registration')).toMatch(
      /texting starts once its carrier registration verifies/,
    );
    expect(numberOutcomePhrase('+1', 'not_operable_hosting_required')).toMatch(
      /isn't in your Twilio account yet/,
    );
    expect(numberOutcomePhrase('+1', 'error', 'Twilio said no')).toBe(
      '+1 is saved. Twilio said no',
    );
  });
});

describe('WP-D: acknowledgements can be withdrawn', () => {
  beforeEach(() => {
    calls.withdrawVoice = 0;
    calls.withdrawSmsAck = 0;
    calls.withdrawAttest = 0;
    served.connections = [
      row({
        nonSecretConfig: {
          destination: '+14155551234',
          accountSid: 'AC0',
          carrier_registration_attested_at: '2026-08-03T10:00:00Z',
        },
      }),
    ];
  });

  it('lists the three acknowledgements and withdraws the voice consent through the client', async () => {
    renderWithQuery(<Acknowledgements luciel={base} />);
    const list = await screen.findByRole('list', { name: 'Your acknowledgements' });
    // The attestation row arrives with the connections read.
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    expect(list).toHaveTextContent('Voice recording and AI-disclosure consent');
    expect(list).toHaveTextContent('Carrier registration attested as approved');
    fireEvent.click(within(list).getAllByRole('button', { name: 'Withdraw' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, withdraw' }));
    await waitFor(() => expect(calls.withdrawVoice).toBe(1));
    expect(await screen.findByText(/Withdrawn\. Phone calls are switched off/)).toBeVisible();
  });

  it('says so plainly when nothing was acknowledged', () => {
    const none: Luciel = {
      ...base,
      channels: base.channels.map((c) => ({ id: c.id, enabled: false })),
    };
    served.connections = [];
    renderWithQuery(<Acknowledgements luciel={none} />);
    expect(screen.getByTestId('acknowledgements-empty')).toBeVisible();
  });
});

describe('WP-D: connected knowledge sources', () => {
  beforeEach(() => {
    calls.disconnect = [];
    served.providers = [
      providers('knowledge_source', [
        {
          provider: 'google_drive',
          displayName: 'Google Drive',
          authKind: 'oauth',
          helpText: '',
          configured: true,
          credentialFields: [],
        },
      ]),
    ];
    served.connections = [
      row({
        connectionId: 'c-crawl',
        connectionType: 'knowledge_source',
        provider: 'website_crawl',
        nonSecretConfig: { crawl_urls: ['https://acme.example/'] },
      }),
      row({
        connectionId: 'c-drive',
        connectionType: 'knowledge_source',
        provider: 'google_drive',
        status: 'expired',
      }),
    ];
    served.sources = [];
  });

  it('lists every knowledge connection with its state and removes a crawl on confirmation', async () => {
    renderWithQuery(<KnowledgeConnections />);
    const list = await screen.findByRole('list', { name: 'Connected sources' });
    expect(list).toHaveTextContent('https://acme.example/');
    expect(list).toHaveTextContent('Google Drive');
    expect(within(list).getByRole('button', { name: 'Reconnect' })).toBeVisible();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove crawl' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove crawl' }));
    await waitFor(() => expect(calls.disconnect).toEqual(['c-crawl']));
    expect(await screen.findByText(/is no longer crawled/)).toBeVisible();
  });
});

describe('WP-D: escalation contacts have their own Remove', () => {
  beforeEach(() => {
    calls.updateEscalation = [];
  });

  it('removes one saved contact and keeps the others', async () => {
    renderWithQuery(<EscalationPillar luciel={base} />);
    const list = await screen.findByRole('list', { name: 'Saved escalation contacts' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    fireEvent.click(within(items[1]).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.updateEscalation).toHaveLength(1));
    expect(calls.updateEscalation[0]).toEqual({
      primaryEmail: 'owner@acme.example',
      primarySms: undefined,
    });
    expect(await screen.findByText(/Primary SMS removed/)).toBeVisible();
  });
});

describe('WP-D: the mailbox can be switched or disconnected', () => {
  beforeEach(() => {
    calls.disconnect = [];
    served.providers = [
      providers('email_sender', [
        {
          provider: 'outlook',
          displayName: 'Outlook',
          authKind: 'oauth',
          helpText: '',
          configured: true,
          credentialFields: [],
        },
      ]),
    ];
    served.connections = [
      row({
        connectionId: 'c-mail',
        connectionType: 'email_sender',
        provider: 'outlook',
        nonSecretConfig: { address: 'hello@acme.example' },
      }),
    ];
  });

  it('offers Switch mailbox and Disconnect mailbox on the live mailbox', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);
    expect(await screen.findByText('hello@acme.example')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Switch mailbox' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect mailbox' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect mailbox' }));
    await waitFor(() => expect(calls.disconnect).toEqual(['c-mail']));
    expect(await screen.findByText(/The mailbox is disconnected/)).toBeVisible();
  });
});

describe('WP-D: a connection can be edited in place', () => {
  beforeEach(() => {
    calls.submitCredentials = [];
    calls.bindDestination = [];
  });

  it('edits a webhook endpoint with the secret left blank to keep it', async () => {
    served.providers = [
      providers('outbound_webhook', [
        {
          provider: 'custom_webhook',
          displayName: 'Your endpoint',
          authKind: 'credential_form',
          helpText: '',
          configured: true,
          credentialFields: [
            { name: 'url', label: 'Endpoint URL', secret: false },
            { name: 'auth_header', label: 'Authorization header', secret: true },
          ],
        },
      ]),
    ];
    const conn = row({
      connectionId: 'c-hook',
      connectionType: 'outbound_webhook',
      provider: 'custom_webhook',
      nonSecretConfig: { url: 'https://old.example/hook' },
    });
    served.connections = [conn];
    renderWithQuery(
      <ConnectionControl
        connectionType="outbound_webhook"
        label="your endpoint"
        connection={conn}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    const url = screen.getByLabelText('Endpoint URL') as HTMLInputElement;
    expect(url.value).toBe('https://old.example/hook');
    fireEvent.change(url, { target: { value: 'https://new.example/hook' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(calls.submitCredentials).toHaveLength(1));
    expect(calls.submitCredentials[0]).toEqual({
      id: 'c-hook',
      fields: { url: 'https://new.example/hook' },
    });
    expect(await screen.findByText(/details updated/)).toBeVisible();
  });

  it('changes a bound Meta destination without a disconnect', async () => {
    served.providers = [
      providers('channel_auth', [
        {
          provider: 'meta',
          displayName: 'Meta',
          authKind: 'oauth',
          helpText: '',
          configured: true,
          credentialFields: [],
        },
      ]),
    ];
    const conn = row({
      connectionId: 'c-meta',
      connectionType: 'channel_auth',
      provider: 'meta',
      nonSecretConfig: { destinations: { whatsapp: '1234567890' } },
    });
    served.connections = [conn];
    renderWithQuery(
      <ConnectionControl
        connectionType="channel_auth"
        label="WhatsApp"
        connection={conn}
        provider="meta"
        destinationField={{ label: 'WhatsApp phone number id', hint: '', channels: ['whatsapp'] }}
      />,
    );
    expect(await screen.findByText('1234567890')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Change id' }));
    fireEvent.change(screen.getByLabelText('WhatsApp phone number id'), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.bindDestination).toHaveLength(1));
    expect(calls.bindDestination[0]).toEqual({
      id: 'c-meta',
      destination: '9876543210',
      channel: 'whatsapp',
    });
  });
});

describe('WP-D: the channel→tool cascade is the server’s (F163)', () => {
  beforeEach(() => {
    calls.updateChannels = [];
    calls.updateTools = 0;
    served.connections = [];
    served.providers = [];
  });

  it('turning Email off issues one write and reports what the server switched off', async () => {
    renderWithQuery(<ChannelsPillar luciel={base} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable Email' }));
    await waitFor(() => expect(calls.updateChannels).toHaveLength(1));
    expect(calls.updateTools).toBe(0);
    expect(
      await screen.findByText('Email is off, and Send email was switched off with it.'),
    ).toBeVisible();
  });
});
