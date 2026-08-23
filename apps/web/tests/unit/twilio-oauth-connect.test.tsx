import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import type { Luciel } from '@luciel/api-client';

/**
 * One-click Twilio connect (audit round 3, C10 — owner concern #7: why type an
 * Account SID when a Connect button should do it). The registry serves twilio
 * as OAuth-primary; the click starts the flow and hands the browser to the
 * consent screen through the shared authorizeOrExplain machinery. An
 * environment whose backend answers `requiresClientForm` (no platform OAuth
 * app) degrades to the API-key form — never a dead button.
 */

const authorizeOrExplain = vi.fn<(start: unknown) => string | null>(() => null);

vi.mock('@/lib/oauth-connect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oauth-connect')>();
  return { ...actual, authorizeOrExplain: (start: unknown) => authorizeOrExplain(start) };
});

const start = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        start: (...args: unknown[]) => start(...args),
      },
    },
  };
});

const withSmsEnabled: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: true, connectionStatus: 'unconfigured' },
    { id: 'voice', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

beforeEach(() => {
  authorizeOrExplain.mockClear();
  authorizeOrExplain.mockReturnValue(null);
  start.mockReset();
});

describe('C10: one-click Twilio OAuth connect', () => {
  it('starts the flow and hands the browser off via authorizeOrExplain', async () => {
    start.mockResolvedValue({
      authorizeUrl: 'https://accounts.example.com/oauth/authorize?state=abc',
    });
    renderWithQuery(<ChannelsPillar luciel={withSmsEnabled} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Connect Twilio$/i }));
    await waitFor(() => expect(authorizeOrExplain).toHaveBeenCalledTimes(1));
    expect(authorizeOrExplain).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'twilio',
        callbackKind: 'connection',
        authorizeUrl: 'https://accounts.example.com/oauth/authorize?state=abc',
      }),
    );
  });

  it('degrades to the API-key form when the backend answers requiresClientForm', async () => {
    start.mockResolvedValue({ requiresClientForm: true });
    renderWithQuery(<ChannelsPillar luciel={withSmsEnabled} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Connect Twilio$/i }));
    // The honest degrade IS the form — no redirect was attempted.
    expect(await screen.findByLabelText(/Twilio Account SID/i)).toBeInTheDocument();
    expect(authorizeOrExplain).not.toHaveBeenCalled();
  });

  it('surfaces the explain message when the sign-in cannot start', async () => {
    start.mockResolvedValue({ authorizeUrl: 'https://evil.example.com/authorize' });
    authorizeOrExplain.mockReturnValue(
      'We could not start a secure sign-in for Your Twilio account. Please try again.',
    );
    renderWithQuery(<ChannelsPillar luciel={withSmsEnabled} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Connect Twilio$/i }));
    expect(
      await screen.findByText(/We could not start a secure sign-in/),
    ).toBeInTheDocument();
  });
});
