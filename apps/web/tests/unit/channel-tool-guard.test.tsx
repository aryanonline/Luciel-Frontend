import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ToolsPillar } from '@/components/config/tools-pillar';
import type { Luciel } from '@luciel/api-client';

/**
 * Axis5-F02: Channel-guard invariants for send tools (Arch §3.3 / Decision §43).
 *
 * send_sms requires the SMS channel enabled.
 * send_email requires the Email channel enabled.
 * The toggle must be DISABLED (not just no-op) when the channel is off.
 */

/** Base Luciel with SMS channel explicitly disabled. */
const lucielSmsChannelOff: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'sms', enabled: false },
    { id: 'email', enabled: true },
    { id: 'voice', enabled: false },
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

/** Base Luciel with Email channel disabled. */
const lucielEmailChannelOff: Luciel = {
  ...lucielSmsChannelOff,
  channels: lucielSmsChannelOff.channels.map((c) =>
    c.id === 'email' ? { ...c, enabled: false } : c.id === 'sms' ? { ...c, enabled: true } : c,
  ),
};

/** Luciel with both SMS and Email channels enabled. */
const lucielBothChannelsOn: Luciel = {
  ...lucielSmsChannelOff,
  channels: lucielSmsChannelOff.channels.map((c) =>
    c.id === 'sms' || c.id === 'email' ? { ...c, enabled: true } : c,
  ),
};

describe('Axis5-F02: send_sms tool blocked when SMS channel is off', () => {
  it('the Send SMS toggle is disabled when the SMS channel is off', () => {
    renderWithQuery(<ToolsPillar luciel={lucielSmsChannelOff} />);
    const toggle = screen.getByRole('switch', { name: /Enable Send SMS/i });
    expect(toggle).toBeDisabled();
  });

  it('shows the explanatory copy when SMS channel is off', () => {
    renderWithQuery(<ToolsPillar luciel={lucielSmsChannelOff} />);
    expect(
      screen.getByText(/Enable the SMS channel to use Send SMS/i),
    ).toBeInTheDocument();
  });

  it('the Send SMS toggle is NOT disabled when the SMS channel is on', () => {
    renderWithQuery(<ToolsPillar luciel={lucielBothChannelsOn} />);
    const toggle = screen.getByRole('switch', { name: /Enable Send SMS/i });
    expect(toggle).not.toBeDisabled();
  });
});

describe('Axis5-F02: send_email tool blocked when Email channel is off', () => {
  it('the Send email toggle is disabled when the Email channel is off', () => {
    renderWithQuery(<ToolsPillar luciel={lucielEmailChannelOff} />);
    const toggle = screen.getByRole('switch', { name: /Enable Send email/i });
    expect(toggle).toBeDisabled();
  });

  it('shows the explanatory copy when Email channel is off', () => {
    renderWithQuery(<ToolsPillar luciel={lucielEmailChannelOff} />);
    expect(
      screen.getByText(/Enable the Email channel to use Send email/i),
    ).toBeInTheDocument();
  });

  it('the Send email toggle is NOT disabled when the Email channel is on', () => {
    renderWithQuery(<ToolsPillar luciel={lucielBothChannelsOn} />);
    const toggle = screen.getByRole('switch', { name: /Enable Send email/i });
    expect(toggle).not.toBeDisabled();
  });
});

describe('Axis5-F02: tools without a channel dependency are never blocked', () => {
  it('book_appointment toggle is enabled regardless of channel state', () => {
    renderWithQuery(<ToolsPillar luciel={lucielSmsChannelOff} />);
    const toggle = screen.getByRole('switch', { name: /Enable Book an appointment/i });
    expect(toggle).not.toBeDisabled();
  });
});
