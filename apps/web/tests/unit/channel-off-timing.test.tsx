import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Luciel } from '@luciel/api-client';

/**
 * Round 7 WP-10, item 5 — the channel-off toast said nothing about a conversation
 * already in flight. Arch §3.8.7 rule E.1: an admin disable never severs the
 * channel a conversation is riding on — new conversations stop immediately, the
 * one underway finishes there. The toast says so where the owner just acted.
 * (Exercised on Email, not the widget: decision D9 leaves the widget toggle alone.)
 */
const withEmailOn: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: true, connectionStatus: 'connected' },
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

describe('turning a channel off states the mid-conversation carve-out', () => {
  it('the off toast says new conversations stop now and one underway finishes there', async () => {
    renderWithQuery(<ChannelsPillar luciel={withEmailOn} />);
    fireEvent.click(screen.getByRole('switch', { name: /Enable Email/i }));
    expect(
      await screen.findByText(
        /Email is off\. New conversations on it stop now; a conversation already underway on it finishes there\./,
      ),
    ).toBeInTheDocument();
  });
});
