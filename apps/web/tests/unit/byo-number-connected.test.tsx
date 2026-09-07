import { describe, it, expect, beforeAll } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import { api } from '@/lib/api';
import type { Luciel } from '@luciel/api-client';

/**
 * P0-1 (BYO number), the live end of the flow: once the tenant's own number is
 * designated and its carrier registration verified, the number block must read
 * back the number that is on file (Arch §3.1.4/§3.1.6, Decision #48). Asking
 * "which of its numbers Luciel uses" against an empty field on a connected
 * number contradicts the Connected chip beside it. Changing the number is the
 * same field, revealed on demand.
 */

const NUMBER = '+14155551234';

const connected: Luciel = {
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
      connectionStatus: 'connected',
      smsComplianceAcknowledgedAt: '2026-06-01T10:00:00Z',
    },
    { id: 'voice', enabled: true, connectionStatus: 'connected' },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

// Drive the mock through the real two-step BYO flow so the connection row holds
// the destination the UI reads — the same shape the http adapter returns.
beforeAll(async () => {
  await api.connections.start('sms_sender', 'twilio', { phoneNumber: NUMBER });
  await api.connections.reverifySms();
});

describe('P0-1: a connected BYO number is shown back, not asked for again', () => {
  it('reads out the designated number instead of an empty designation prompt', async () => {
    renderWithQuery(<ChannelsPillar luciel={connected} />);

    expect(await screen.findByText(NUMBER)).toBeInTheDocument();
    expect(screen.getByText(/Luciel texts and calls from/i)).toBeInTheDocument();
    expect(screen.queryByText(/Tell us which of its numbers Luciel uses/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Business phone number/i)).not.toBeInTheDocument();
  });

  it('keeps a Connected chip on BOTH rows and the durable A2P/consent disclosure', async () => {
    renderWithQuery(<ChannelsPillar luciel={connected} />);

    expect(await screen.findByText(NUMBER)).toBeInTheDocument();
    // One shared number, one shared state: the SMS row and the Voice row each
    // carry the honest chip beside their own toggle.
    expect(screen.getAllByText('Connected')).toHaveLength(2);
    expect(screen.getByText(/honors STOP and HELP automatically/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Re-verify/i })).not.toBeInTheDocument();
  });

  it('reveals the entry field only when the owner asks to change the number', async () => {
    renderWithQuery(<ChannelsPillar luciel={connected} />);

    await screen.findByText(NUMBER);
    fireEvent.click(screen.getByRole('button', { name: /Change number/i }));
    expect(screen.getByLabelText(/Business phone number/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Keep this number/i }));
    expect(screen.queryByLabelText(/Business phone number/i)).not.toBeInTheDocument();
    expect(screen.getByText(NUMBER)).toBeInTheDocument();
  });
});
