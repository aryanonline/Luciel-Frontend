import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import type { Luciel } from '@luciel/api-client';
import { ChannelsPillar } from '@/components/config/channels-pillar';

/**
 * Dismissing the SMS compliance modal previously said NOTHING — the toggle just
 * snapped back, which the owner read as "it wouldn't let me enable SMS"
 * (live-caught 2026-08-18). Pinned: a dismissal renders a visible notice saying
 * why SMS stayed off; the modal's webhook/consent copy also names the automatic
 * webhook configuration on the voice side.
 */

const luciel: Luciel = {
  instanceId: '33333333-3333-4333-8333-333333333333',
  name: 'L',
  state: 'active',
  embedKeyPublicId: 'vm_live_test',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'sms', enabled: false },
    { id: 'voice', enabled: false },
  ],
  tools: [],
  escalation: {},
  personality: {},
} as unknown as Luciel;

describe('SMS modal dismissal is never silent', () => {
  it('shows why SMS stayed off when the modal is dismissed unconfirmed', async () => {
    renderWithQuery(<ChannelsPillar luciel={luciel} />);
    const smsToggle = await screen.findByRole('switch', { name: /Enable SMS/i });
    fireEvent.click(smsToggle);
    // The hard-gate modal opened instead of enabling.
    expect(await screen.findByText(/carrier registration and consent/i)).toBeInTheDocument();
    // Dismiss without acknowledging.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.getByText(/SMS stays off — enabling it requires the carrier-registration/i),
      ).toBeInTheDocument(),
    );
  });
});
