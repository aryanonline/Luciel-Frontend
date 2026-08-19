import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { EmailChannelProvisioning } from '@/components/config/email-provisioning';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import ConfigurePage from '@/app/(app)/dashboard/configure/page';
import EmbedPage from '@/app/(app)/dashboard/embed/page';
import type { Luciel } from '@luciel/api-client';

/**
 * P0-2 → c22 (owner decision 2026-08-18): email is BYO-mailbox ONLY. The two
 * retired platform paths (own-domain DNS walk, @vantagemind.ai subdomain) are no
 * longer offered anywhere in the panel — the ONLY action is the mailbox connect.
 *
 * It lives in ONE place: with the Email CHANNEL in Configure (Decision #4). The
 * Embed & launch tab is the widget snippet only, so the two can't disagree.
 */

describe('P0-2: Luciel’s work email provisioning', () => {
  it('offers ONLY the mailbox connect — the platform paths are gone', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);
    expect(
      await screen.findByRole('button', { name: /Connect Outlook mailbox/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Email address on your domain/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Use your own domain/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Use a free @vantagemind\.ai address/i }),
    ).not.toBeInTheDocument();
  });

  it('says Luciel is not answering email while the Email channel is off', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled={false} />);
    expect(await screen.findByText(/answering email yet/i)).toBeInTheDocument();
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
  it('the channels pillar renders it expanded — no disclosure — with the Email channel on', async () => {
    renderWithQuery(<ChannelsPillar luciel={luciel} />);
    expect(await screen.findByRole('heading', { name: /work email/i })).toBeVisible();
    expect(screen.queryByText(/works before the channel is on/i)).not.toBeInTheDocument();
  });

  it('still offers setup while the Email channel is off — collapsed behind a disclosure', async () => {
    const emailOff: Luciel = {
      ...luciel,
      channels: luciel.channels.map((c) => (c.id === 'email' ? { ...c, enabled: false } : c)),
    };
    renderWithQuery(<ChannelsPillar luciel={emailOff} />);

    // Provision-first stays reachable (Decision #4): the setup is behind the
    // disclosure, not gone — and the summary says it works before the channel
    // is on, so an owner is not left thinking the toggle comes first.
    const summary = screen.getByText(
      "Set up Luciel's email address (works before the channel is on)",
    );
    expect(summary).toBeVisible();
    expect(await screen.findByText(/answering email yet/i)).not.toBeVisible();

    // Expanding the disclosure reveals the untouched provisioning section.
    const details = summary.closest('details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(screen.getByText(/answering email yet/i)).toBeVisible();
    expect(screen.getByRole('heading', { name: /work email/i })).toBeVisible();
  });

  it('appears exactly once on Configure — the page no longer mounts a second copy', async () => {
    renderWithQuery(<ConfigurePage />);
    expect(await screen.findByRole('heading', { name: /work email/i })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: /work email/i })).toHaveLength(1);
  });
});
