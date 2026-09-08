import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { PersonalityPillar } from '@/components/config/personality-pillar';
import type { Luciel, PersonalityConfig } from '@luciel/api-client';

/**
 * Round 6 WP-G (F102): the owner's own hot-lead phrases live on the personality pillar
 * as chips — added, removed, deduped, and saved through the same full-replace PUT.
 * They are the one admin input to the fixed high-value-lead signal; there is still no
 * signal toggle and no model field.
 */

const updatePersonality = vi.fn<(c: PersonalityConfig) => Promise<Luciel>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      luciel: {
        ...actual.api.luciel,
        updatePersonality: (c: PersonalityConfig) => updatePersonality(c),
      },
    },
  };
});

const luciel: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Aurora',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [{ id: 'widget', enabled: true }],
  tools: [],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge', highValueSignals: ['wedding season'] },
};

beforeEach(() => {
  updatePersonality.mockReset().mockImplementation(async (c) => ({ ...luciel, personality: c }));
});

describe('hot-lead phrases (round 6 WP-G)', () => {
  it('lists the saved phrases and adds a new one on Enter, deduped and trimmed', async () => {
    renderWithQuery(<PersonalityPillar luciel={luciel} />);
    expect(screen.getByRole('list', { name: /Hot-lead phrases/i })).toHaveTextContent(
      'wedding season',
    );
    const input = screen.getByLabelText(/Phrases that mean a hot lead/i);
    fireEvent.change(input, { target: { value: '  fleet   of trucks ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('fleet of trucks')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'WEDDING SEASON' } });
    fireEvent.click(screen.getByRole('button', { name: /Add phrase/i }));
    expect(screen.getAllByText(/wedding season/i)).toHaveLength(1);
    expect(screen.getByText('2/20', { exact: false })).toBeInTheDocument();
  });

  it('removes a phrase and saves the full list through the pillar PUT', async () => {
    renderWithQuery(<PersonalityPillar luciel={luciel} />);
    const input = screen.getByLabelText(/Phrases that mean a hot lead/i);
    fireEvent.change(input, { target: { value: 'fleet of trucks' } });
    fireEvent.click(screen.getByRole('button', { name: /Add phrase/i }));
    fireEvent.click(screen.getByRole('button', { name: /Remove phrase wedding season/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save personality/i }));
    await waitFor(() =>
      expect(updatePersonality).toHaveBeenCalledWith({
        preset: 'warm_concierge',
        highValueSignals: ['fleet of trucks'],
      }),
    );
    await screen.findByText(/Saved\./);
  });
});
