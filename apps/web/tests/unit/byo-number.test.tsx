import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Luciel } from '@luciel/api-client';

/**
 * P0-1 (BYO number): the tenant supplies their OWN Twilio account and their OWN
 * phone number for SMS/Voice; the platform never provisions either
 * (Arch §3.1.4/§3.1.6, Decision #48).
 *
 * The two steps are ordered — you cannot designate one of an account's numbers
 * before the account is on file — so an enabled SMS/Voice channel with nothing
 * connected asks for the Twilio credentials first, and only then for the number.
 * Both are actionable next steps, not errors. Once a number is supplied it sits
 * at "Action needed: complete carrier registration" until the TENANT finishes
 * their own A2P 10DLC registration and triggers Re-verify — the platform never
 * registers on their behalf and never polls (Legal §A2, Arch §3.1.6).
 *
 * Enabling SMS is also a hard gate on the carrier/consent acknowledgment
 * (Legal §A2/§A6).
 */

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
    { id: 'instagram_messenger', enabled: false },
  ],
  tools: [
    { id: 'send_sms', enabled: false },
    { id: 'send_email', enabled: false },
    { id: 'book_appointment', enabled: false },
    { id: 'check_availability', enabled: false },
    { id: 'lookup_record', enabled: false },
    { id: 'schedule_callback', enabled: false },
    { id: 'push_to_crm', enabled: false },
    { id: 'bring_your_own_webhook', enabled: false },
  ],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

const withSmsEnabledNoNumber: Luciel = {
  ...base,
  channels: base.channels.map((c) =>
    c.id === 'sms' ? { ...c, enabled: true, connectionStatus: 'unconfigured' } : c,
  ),
};

const withNumberPending: Luciel = {
  ...base,
  channels: base.channels.map((c) =>
    c.id === 'sms' || c.id === 'voice'
      ? { ...c, enabled: true, connectionStatus: 'pending_carrier_registration' }
      : c,
  ),
};

describe('P0-1: SMS enabled with nothing connected asks for the tenant’s own Twilio account', () => {
  it('renders the action-needed chip and the served Twilio credential form', async () => {
    renderWithQuery(<ChannelsPillar luciel={withSmsEnabledNoNumber} />);
    expect(screen.getByText(/action needed: connect your Twilio account/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /your number stays yours and your carrier costs are billed by Twilio directly/i,
      ),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/Twilio Account SID/i)).toBeInTheDocument();
  });

  it('does not ask which number to use before the Twilio account is on file', () => {
    renderWithQuery(<ChannelsPillar luciel={withSmsEnabledNoNumber} />);
    expect(screen.queryByLabelText(/Business phone number/i)).not.toBeInTheDocument();
  });

  it('does not claim SMS/Voice run on a platform-provisioned number', () => {
    renderWithQuery(<ChannelsPillar luciel={withSmsEnabledNoNumber} />);
    expect(screen.queryByText(/provisions one shared phone number/i)).not.toBeInTheDocument();
    expect(screen.getByText(/your business brings its own phone number/i)).toBeInTheDocument();
  });

  it('does not show the number affordance when neither SMS nor Voice is enabled', () => {
    renderWithQuery(<ChannelsPillar luciel={base} />);
    expect(screen.queryByLabelText(/Business phone number/i)).not.toBeInTheDocument();
  });
});

describe('P0-1: a supplied number sits at "complete carrier registration"', () => {
  it('renders the pending-carrier-registration state and no entry field', () => {
    renderWithQuery(<ChannelsPillar luciel={withNumberPending} />);
    expect(screen.getByText(/action needed: complete carrier registration/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Business phone number/i)).not.toBeInTheDocument();
  });

  it('does not claim the platform is registering the number with the carriers', () => {
    renderWithQuery(<ChannelsPillar luciel={withNumberPending} />);
    expect(screen.queryByText(/being activated with the carriers/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/You complete the Brand and Campaign registration yourself/i),
    ).toBeInTheDocument();
  });

  it('offers a Re-verify trigger, since nothing polls the carrier in the background', () => {
    renderWithQuery(<ChannelsPillar luciel={withNumberPending} />);
    expect(screen.getByRole('button', { name: /Re-verify/i })).toBeInTheDocument();
    expect(screen.getByText(/Nothing checks this in the background/i)).toBeInTheDocument();
  });
});

describe('Legal §A2/§A6: enabling SMS is gated on the carrier/consent acknowledgment', () => {
  it('opens the disclosure instead of enabling SMS straight away', () => {
    renderWithQuery(<ChannelsPillar luciel={base} />);
    fireEvent.click(screen.getByRole('switch', { name: /Enable SMS/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/You register with the carriers, not us/i)).toBeInTheDocument();
    expect(screen.getByText(/You are the sender of record/i)).toBeInTheDocument();
    expect(screen.getByText(/Carrier costs are yours/i)).toBeInTheDocument();
    expect(screen.getByText(/CASL in Canada and, where applicable, the US TCPA/i)).toBeInTheDocument();
  });

  it('keeps the acknowledgment required — confirm is disabled until the box is checked', () => {
    renderWithQuery(<ChannelsPillar luciel={base} />);
    fireEvent.click(screen.getByRole('switch', { name: /Enable SMS/i }));

    const confirm = screen.getByRole('button', { name: /Acknowledge and enable SMS/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirm).not.toBeDisabled();
  });

  it('discloses STOP/HELP handling durably once SMS is on, not only in the modal', () => {
    renderWithQuery(<ChannelsPillar luciel={withSmsEnabledNoNumber} />);
    expect(screen.getByText(/honors STOP and HELP automatically/i)).toBeInTheDocument();
  });
});
