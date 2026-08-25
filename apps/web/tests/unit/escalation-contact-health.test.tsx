import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { EscalationPillar } from '@/components/config/escalation-pillar';
import type { Luciel } from '@luciel/api-client';

/**
 * Round 5B item 13 — the owner-side half of contact verification. A hot lead
 * routed to a typo'd or bouncing inbox vanishes silently; the pillar must show
 * each email contact's server-owned confirmation state and offer the re-send,
 * or the loop is only ever restarted by editing the contact.
 */

const resendApi = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      luciel: {
        ...actual.api.luciel,
        resendContactConfirmation: (...args: unknown[]) => Promise.resolve(resendApi(...args)),
      },
    },
  };
});

const withHealth: Luciel = {
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
  escalation: {
    primaryEmail: 'sales@acme.example',
    secondaryEmail: 'backup@acme.example',
    preferredChannel: 'email',
  },
  escalationContactHealth: [
    {
      address: 'sales@acme.example',
      state: 'pending_confirmation',
      verifiedAt: null,
      lastBouncedAt: null,
    },
    {
      address: 'backup@acme.example',
      state: 'bouncing',
      verifiedAt: null,
      lastBouncedAt: '2026-08-20T10:00:00Z',
    },
  ],
  personality: { preset: 'warm_concierge' },
  leadRetentionDays: null,
};

const verified: Luciel = {
  ...withHealth,
  escalation: { primaryEmail: 'sales@acme.example', preferredChannel: 'email' },
  escalationContactHealth: [
    {
      address: 'sales@acme.example',
      state: 'verified',
      verifiedAt: '2026-08-01T09:00:00Z',
      lastBouncedAt: null,
    },
  ],
};

beforeEach(() => {
  resendApi.mockReset();
  resendApi.mockReturnValue(withHealth);
});

describe('escalation contact health (round 5B item 13)', () => {
  it('shows each contact state and warns loudly about a bouncing address', () => {
    renderWithQuery(<EscalationPillar luciel={withHealth} />);

    expect(screen.getByText(/sales@acme\.example — Confirmation sent/)).toBeInTheDocument();
    expect(screen.getByText(/backup@acme\.example — Bouncing/)).toBeInTheDocument();
    // The consequence is spelled out, not implied.
    expect(screen.getByText(/escalations skip a bouncing address/i)).toBeInTheDocument();
  });

  it('offers the re-send for unconfirmed contacts and reports the outcome', async () => {
    renderWithQuery(<EscalationPillar luciel={withHealth} />);

    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation' }));
    await waitFor(() => expect(resendApi).toHaveBeenCalledWith('sales@acme.example'));
    expect(await screen.findByText(/confirmation email sent to sales@acme\.example/i)).toBeInTheDocument();
  });

  it('a verified contact gets no button and no warning — nothing to fix', () => {
    renderWithQuery(<EscalationPillar luciel={verified} />);

    expect(screen.getByText(/sales@acme\.example — Confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirmation/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/escalations skip a bouncing address/i)).not.toBeInTheDocument();
  });

  it('a refused re-send surfaces the server reason instead of pretending the mail left', async () => {
    // The 5-minute cooldown answers a typed message; the owner must see it.
    resendApi.mockImplementation(() => {
      throw new Error('A confirmation was sent moments ago - give it a few minutes, then retry.');
    });
    renderWithQuery(<EscalationPillar luciel={withHealth} />);

    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation' }));
    expect(
      await screen.findByText(/a confirmation was sent moments ago/i),
    ).toBeInTheDocument();
  });
});
