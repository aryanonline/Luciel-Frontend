import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import EmbedPage from '@/app/(app)/dashboard/embed/page';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import { api } from '@/lib/api';
import { WIDGET_OFF_COPY } from '@/lib/widget-channel';
import type { Luciel } from '@luciel/api-client';

/**
 * Owner decision D9 (round 7) — the Website chat toggle is honoured: with it off the
 * widget bootstrap answers renderState `channel_off` and the widget renders nothing
 * on the owner's site; a conversation already open finishes. Pinned here, on the
 * dashboard side: the channel row says exactly that while off; turning it off says
 * it in the toast; and the Embed page shows the off state instead of presenting the
 * snippet (and a test chat) as if live.
 */

const withWidget = (enabled: boolean): Luciel => ({
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  embedKeyPublicId: 'vm_live_abc123',
  channels: [
    { id: 'widget', enabled },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'voice', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: { primaryEmail: 'sales@acme.example', preferredChannel: 'email' },
  escalationContactHealth: [],
  personality: { preset: 'warm_concierge' },
  leadRetentionDays: null,
});

afterEach(() => vi.restoreAllMocks());

describe('Configure: the Website chat row', () => {
  it('states the off behaviour on the row while off', () => {
    renderWithQuery(<ChannelsPillar luciel={withWidget(false)} />);
    expect(screen.getByTestId('widget-off-note')).toHaveTextContent(
      'Off — the widget renders nothing on your site; conversations already open finish',
    );
  });

  it('says nothing of the kind while on', () => {
    renderWithQuery(<ChannelsPillar luciel={withWidget(true)} />);
    expect(screen.queryByTestId('widget-off-note')).not.toBeInTheDocument();
  });

  it('turning it off says the widget renders nothing, not "new conversations stop"', async () => {
    vi.spyOn(api.luciel, 'updateChannels').mockResolvedValue(withWidget(false));
    renderWithQuery(<ChannelsPillar luciel={withWidget(true)} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Website chat widget' }));
    expect(
      await screen.findByText(
        'Website chat widget is off — the widget renders nothing on your site; conversations already open finish.',
      ),
    ).toBeInTheDocument();
  });
});

describe('Embed page', () => {
  it('shows the off state instead of the snippet as if live', async () => {
    vi.spyOn(api.luciel, 'get').mockResolvedValue(withWidget(false));
    renderWithQuery(<EmbedPage />);

    expect(await screen.findByTestId('embed-widget-off')).toHaveTextContent(WIDGET_OFF_COPY);
    expect(
      screen.getByText('Website chat is switched off, so nothing shows on your site right now.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Turn it on under Configure/ })).toHaveAttribute(
      'href',
      '/dashboard/configure',
    );
    // The snippet is tucked behind a disclosure that says it renders nothing yet,
    // and there is no live test chat to open.
    const disclosure = screen
      .getByText(/Show the snippet anyway/)
      .closest('details') as HTMLElement;
    expect(disclosure).not.toHaveAttribute('open');
    expect(within(disclosure).getByText(/vm_live_abc123/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test it here' })).not.toBeInTheDocument();
  });

  it('a live widget shows the snippet and the test as before', async () => {
    vi.spyOn(api.luciel, 'get').mockResolvedValue(withWidget(true));
    renderWithQuery(<EmbedPage />);
    expect(await screen.findByText(/vm_live_abc123/)).toBeInTheDocument();
    expect(screen.queryByTestId('embed-widget-off')).not.toBeInTheDocument();
    expect(screen.queryByText(/Show the snippet anyway/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test it here' })).toBeInTheDocument();
  });
});
