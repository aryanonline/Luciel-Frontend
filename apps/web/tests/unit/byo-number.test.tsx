import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
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
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
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

// Arch §3.1.4 operability probe: the designated number is NOT hosted in the
// tenant's own Twilio account. Previously this state degraded to a bare `error`
// on the wire and the owner lost the actionable guidance.
const withNumberNotHosted: Luciel = {
  ...base,
  channels: base.channels.map((c) =>
    c.id === 'sms' || c.id === 'voice'
      ? { ...c, enabled: true, connectionStatus: 'not_operable_hosting_required' }
      : c,
  ),
};

/** The <li> hosting a channel row, located from its enable toggle. */
const channelRow = (name: RegExp): HTMLElement => {
  const row = screen.getByRole('switch', { name }).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
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

  it('renders the phone panel INSIDE the SMS row, not after the channel list', () => {
    renderWithQuery(<ChannelsPillar luciel={withSmsEnabledNoNumber} />);
    // The owner-reported defect: the number setup rendered "way below" the SMS
    // toggle, as a sibling after the whole <ul>. It belongs inside the row.
    const smsRow = channelRow(/Enable SMS/i);
    expect(within(smsRow).getByText(/Your business phone number/i)).toBeInTheDocument();
    expect(
      within(smsRow).getByText(/action needed: connect your Twilio account/i),
    ).toBeInTheDocument();
  });

  it('hosts the panel on the Voice row when SMS is off and Voice is on', () => {
    const voiceOnly: Luciel = {
      ...base,
      channels: base.channels.map((c) => (c.id === 'voice' ? { ...c, enabled: true } : c)),
    };
    renderWithQuery(<ChannelsPillar luciel={voiceOnly} />);
    const voiceRow = channelRow(/Enable Voice/i);
    expect(within(voiceRow).getByText(/Your business phone number/i)).toBeInTheDocument();
    // No second enabled phone row exists, so no cross-reference note renders.
    expect(screen.queryByText(/share one business number/i)).not.toBeInTheDocument();
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
  it('renders the pending chip on BOTH enabled rows and no entry field', () => {
    renderWithQuery(<ChannelsPillar luciel={withNumberPending} />);
    // One shared number, one shared state: each enabled phone row carries the
    // honest chip beside its own toggle.
    expect(screen.getAllByText(/action needed: complete carrier registration/i)).toHaveLength(2);
    expect(
      within(channelRow(/Enable Voice/i)).getByText(
        /action needed: complete carrier registration/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Business phone number/i)).not.toBeInTheDocument();
  });

  it('points the Voice row at the SMS row that hosts the shared panel', () => {
    renderWithQuery(<ChannelsPillar luciel={withNumberPending} />);
    const voiceRow = channelRow(/Enable Voice/i);
    const note = within(voiceRow).getByRole('note');
    expect(note).toHaveTextContent(
      /SMS and Voice share one business number — set it up under SMS\./,
    );
    // The panel itself renders once, inside the SMS row.
    expect(
      within(channelRow(/Enable SMS/i)).getByText(/Your business phone number/i),
    ).toBeInTheDocument();
    expect(within(voiceRow).queryByText(/Your business phone number/i)).not.toBeInTheDocument();
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

describe('Arch §3.1.4: a number not hosted in the tenant’s Twilio account is named, not "error"', () => {
  it('renders the specific hosting guidance chip on both enabled phone rows', () => {
    renderWithQuery(<ChannelsPillar luciel={withNumberNotHosted} />);
    expect(
      screen.getAllByText(/action needed: this number isn't in your Twilio account yet/i),
    ).toHaveLength(2);
    // Never the generic trouble copy, and never a false Connected.
    expect(screen.queryByText(/is having trouble/i)).not.toBeInTheDocument();
    const smsRow = channelRow(/Enable SMS/i);
    expect(within(smsRow).queryByText(/^Connected$/)).not.toBeInTheDocument();
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
    expect(
      screen.getByText(/CASL in Canada and, where applicable, the US TCPA/i),
    ).toBeInTheDocument();
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
