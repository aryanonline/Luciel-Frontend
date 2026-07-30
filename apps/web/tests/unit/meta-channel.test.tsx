import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Luciel } from '@luciel/api-client';

/**
 * ONE Meta connection (contract §2): a single `channel_auth` grant authorizes
 * WhatsApp, Instagram DMs and Messenger, and each channel then names the asset
 * it answers on. Turning a second Meta channel on must never read as the first
 * being disconnected.
 *
 * Meta has no registered OAuth app today (`configured: false`), so the pillar
 * must say so plainly instead of offering a connect button that redirects into a
 * broken consent screen (contract §1).
 */

const base: Luciel = {
  instanceId: '55555555-5555-4555-8555-555555555555',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'voice', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'whatsapp', enabled: true },
    { id: 'instagram_messenger', enabled: true },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

describe('contract §2: WhatsApp and Instagram / Messenger share one Meta connection', () => {
  it('says one sign-in covers all three, and never that one replaces another', async () => {
    renderWithQuery(<ChannelsPillar luciel={base} />);
    expect(
      (await screen.findAllByText(/One Meta sign-in covers WhatsApp, Instagram DMs and Messenger/i))
        .length,
    ).toBeGreaterThan(1);
    expect(screen.queryByText(/replaces the other/i)).not.toBeInTheDocument();
  });
});

describe('contract §1: an unconfigured Meta app renders honest-disabled', () => {
  it('explains it is not available yet instead of offering a connect button', async () => {
    renderWithQuery(<ChannelsPillar luciel={base} />);
    expect(
      (await screen.findAllByText(/Not available yet — Meta app not configured/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Connect Meta/i })).not.toBeInTheDocument();
  });
});
