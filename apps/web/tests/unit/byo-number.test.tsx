import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Luciel } from '@luciel/api-client';

/**
 * P0-1 (BYO number): the tenant supplies their OWN phone number for SMS/Voice;
 * the platform never provisions one (Arch §3.1.4/§3.1.6, Decision #48).
 *
 * When SMS or Voice is enabled with no number configured, the pillar shows the
 * "Action needed: add your number" state and an E.164 entry affordance. When a
 * number is supplied (pending_carrier_registration) it shows "being activated
 * with carriers". No number is fabricated by the platform.
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

describe('P0-1: SMS enabled without a number shows the action-needed state', () => {
  it('renders the "add your number" action-needed chip and an E.164 entry field', () => {
    renderWithQuery(<ChannelsPillar luciel={withSmsEnabledNoNumber} />);
    expect(screen.getByText(/action needed: add your number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Business phone number/i)).toBeInTheDocument();
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

describe('P0-1: a supplied number shows "being activated with carriers"', () => {
  it('renders the pending-carrier-registration state and no entry field', () => {
    renderWithQuery(<ChannelsPillar luciel={withNumberPending} />);
    expect(screen.getByText(/being activated with carriers/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Business phone number/i)).not.toBeInTheDocument();
  });
});
