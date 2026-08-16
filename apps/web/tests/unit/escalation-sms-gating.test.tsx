import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { EscalationPillar } from '@/components/config/escalation-pillar';
import type { Luciel } from '@luciel/api-client';

/**
 * Arch §3.5.1: SMS as an admin-notification channel requires the SMS channel
 * enabled. Offering the SMS route on an account that cannot send SMS silently
 * routes a page (e.g. "High-value lead spotted") into nothing. The option stays
 * visible — the owner should learn it exists — but disabled, with the reason.
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
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

const withSms: Luciel = {
  ...base,
  channels: base.channels.map((c) =>
    c.id === 'sms' ? { ...c, enabled: true, connectionStatus: 'connected' } : c,
  ),
};

const smsOptions = (): HTMLOptionElement[] =>
  screen
    .getAllByRole('option')
    .filter((o): o is HTMLOptionElement => (o as HTMLOptionElement).value === 'sms');

describe('escalation routing: SMS option gated on the SMS channel (Arch §3.5.1)', () => {
  it('disables every SMS routing option, with the reason, when the SMS channel is off', () => {
    renderWithQuery(<EscalationPillar luciel={base} />);
    const options = smsOptions();
    // Default channel + one per fixed signal.
    expect(options.length).toBeGreaterThanOrEqual(5);
    for (const option of options) {
      expect(option.disabled).toBe(true);
      expect(option.textContent).toContain('enable the SMS channel first');
    }
  });

  it('offers SMS normally once the SMS channel is enabled', () => {
    renderWithQuery(<EscalationPillar luciel={withSms} />);
    for (const option of smsOptions()) {
      expect(option.disabled).toBe(false);
      expect(option.textContent).toBe('SMS');
    }
  });
});
