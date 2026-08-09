import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { EmailChannelProvisioning } from '@/components/config/email-provisioning';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import ConfigurePage from '@/app/(app)/dashboard/configure/page';
import EmbedPage from '@/app/(app)/dashboard/embed/page';
import type { Luciel } from '@luciel/api-client';

/**
 * P0-2 (email provisioning): the admin PROVISIONS the address Luciel sends AND
 * receives on (Arch §3.1.6a, Decision #49). Two LAUNCH options — the business's
 * own domain (with a DNS/MX routing step, "Action needed: complete email routing"
 * until verified) or a zero-DNS @vantagemind.ai fallback.
 *
 * It lives in ONE place: with the Email CHANNEL in Configure (Decision #4). The
 * Embed & launch tab is the widget snippet only, so the two can't disagree.
 */

describe('P0-2: Luciel’s work email provisioning', () => {
  it('offers own-domain provisioning and a free @vantagemind.ai fallback', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);
    expect(await screen.findByLabelText(/Email address on your domain/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Use your own domain/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Use a free @vantagemind\.ai address/i }),
    ).toBeInTheDocument();
  });

  it('says Luciel is not answering email while the Email channel is off', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled={false} />);
    expect(await screen.findByText(/answering email yet/i)).toBeInTheDocument();
  });

  it('shows the "complete email routing" action-needed state after own-domain setup', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);
    const input = await screen.findByLabelText(/Email address on your domain/i);
    fireEvent.change(input, { target: { value: 'hello@yourbusiness.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Set up my domain/i }));
    expect(await screen.findByText(/action needed: complete email routing/i)).toBeInTheDocument();
    expect(screen.getByText('hello@yourbusiness.com')).toBeInTheDocument();
  });

  it('is no longer duplicated on the Embed & launch tab', async () => {
    renderWithQuery(<EmbedPage />);
    await screen.findByRole('heading', { name: /Embed & launch/i });
    expect(screen.queryByLabelText(/Email address on your domain/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /work email/i })).not.toBeInTheDocument();
  });
});

/**
 * Placement (Decision #4): the address is set up WITH the Email channel, so the
 * channels pillar owns it and the Configure page must not also mount it. Guards
 * the double-render these two call sites drifted into.
 */
const luciel: Luciel = {
  instanceId: '55555555-5555-4555-8555-555555555555',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: true },
    { id: 'sms', enabled: false },
    { id: 'voice', enabled: false },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [{ id: 'send_email', enabled: false }],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

describe('P0-2: work-email provisioning sits inside the Channels pillar', () => {
  it('the channels pillar renders it with the Email channel', async () => {
    renderWithQuery(<ChannelsPillar luciel={luciel} />);
    expect(await screen.findByRole('heading', { name: /work email/i })).toBeInTheDocument();
  });

  it('still offers setup while the Email channel is off, so the address can come first', async () => {
    const emailOff: Luciel = {
      ...luciel,
      channels: luciel.channels.map((c) => (c.id === 'email' ? { ...c, enabled: false } : c)),
    };
    renderWithQuery(<ChannelsPillar luciel={emailOff} />);
    expect(await screen.findByText(/answering email yet/i)).toBeInTheDocument();
  });

  it('appears exactly once on Configure — the page no longer mounts a second copy', async () => {
    renderWithQuery(<ConfigurePage />);
    expect(await screen.findByRole('heading', { name: /work email/i })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: /work email/i })).toHaveLength(1);
  });
});
