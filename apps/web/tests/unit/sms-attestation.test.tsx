import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import { api } from '@/lib/api';
import type { Luciel } from '@luciel/api-client';

/**
 * Carrier-registration attestation (round 5B item 10, Legal §A2). The platform
 * cannot read A2P 10DLC campaign approval with the deployment's auth, so the
 * honest exit from `pending_carrier_registration` is the OWNER's attestation:
 * texting turns on on their word, stated plainly, behind the Modal's
 * async-confirm contract. Senders whose recipients aren't US-carrier-bound
 * (e.g. Canada-only) may attest that 10DLC does not apply to them.
 */

const NUMBER = '+14165550111';

const base: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'voice', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

const withNumberPending: Luciel = {
  ...base,
  channels: base.channels.map((c) =>
    c.id === 'sms' || c.id === 'voice'
      ? {
          ...c,
          enabled: true,
          connectionStatus: 'pending_carrier_registration',
          ...(c.id === 'sms' ? { smsComplianceAcknowledgedAt: '2026-06-01T10:00:00Z' } : {}),
        }
      : c,
  ),
};

const connected: Luciel = {
  ...base,
  channels: base.channels.map((c) =>
    c.id === 'sms' || c.id === 'voice'
      ? {
          ...c,
          enabled: true,
          connectionStatus: 'connected',
          ...(c.id === 'sms' ? { smsComplianceAcknowledgedAt: '2026-06-01T10:00:00Z' } : {}),
        }
      : c,
  ),
};

const openAttestModal = async () => {
  fireEvent.click(
    await screen.findByRole('button', { name: /My carrier registration is approved/i }),
  );
  return await screen.findByRole('dialog');
};

describe('round 5B: the pending panel offers the owner-attestation exit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the attestation button beside Re-verify while pending', () => {
    renderWithQuery(<ChannelsPillar luciel={withNumberPending} />);
    expect(
      screen.getByRole('button', { name: /My carrier registration is approved/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Re-verify$/i })).toBeInTheDocument();
  });

  it('states plainly whose word texting turns on — the modal copy owns the honesty', async () => {
    renderWithQuery(<ChannelsPillar luciel={withNumberPending} />);
    const dialog = await openAttestModal();

    // The owner's attestation, never a platform verification.
    expect(dialog).toHaveTextContent(/This is your attestation, as the owner/i);
    expect(dialog).toHaveTextContent(/VantageMind cannot verify campaign approval on your behalf/i);
    expect(dialog).toHaveTextContent(/texting turns on on your word/i);
    // Non-US-carrier senders (e.g. Canada-only) may attest 10DLC does not apply.
    expect(dialog).toHaveTextContent(/Canadian numbers only/i);
    expect(dialog).toHaveTextContent(/may not apply/i);
  });

  it('confirm fires the attestation API through the async-modal contract', async () => {
    // Drive the mock to a real pending row first, so the attestation is
    // accepted rather than refused as not-ready (422).
    await api.connections.start('sms_sender', 'twilio', { phoneNumber: NUMBER });
    const attest = vi.spyOn(api.connections, 'attestSmsRegistration');

    renderWithQuery(<ChannelsPillar luciel={withNumberPending} />);
    await openAttestModal();
    fireEvent.click(screen.getByRole('button', { name: /I attest — turn on texting/i }));

    await waitFor(() => expect(attest).toHaveBeenCalledTimes(1));
    // Success closes the dialog; a failed write would keep it open instead.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('renders plain Connected chips on both rows once the refetched status is connected', async () => {
    // The attested mock row is connected; the served channel state follows.
    const result = await api.connections.attestSmsRegistration();
    expect(result.status).toBe('connected');
    expect(result.statusDetail).toMatch(/^Texting is enabled on your attestation/);

    renderWithQuery(<ChannelsPillar luciel={connected} />);
    expect(await screen.findByText(NUMBER)).toBeInTheDocument();
    // The voice/SMS chip split collapses: no pending copy, two Connected chips.
    expect(screen.getAllByText('Connected')).toHaveLength(2);
    expect(screen.queryByText(/complete carrier registration/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/texting waits on carrier registration/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /My carrier registration is approved/i }),
    ).not.toBeInTheDocument();
  });
});
