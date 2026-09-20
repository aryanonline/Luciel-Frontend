import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import ConfigurePage from '@/app/(app)/dashboard/configure/page';
import type { Luciel } from '@luciel/api-client';

/**
 * Round 7 WP-10, item 4 — the grace-window Luciel that looked editable.
 *
 * The configure page special-cased only `luciel_hard_deleted`; a Luciel in its
 * 30-day grace window rendered all six editable pillars, and every write came
 * back with the backend's conflict ("Configuration cannot be changed while the
 * Luciel is luciel_grace_window"). Pinned here: the grace window renders no
 * pillars and points at the restore action, which lives on the Account page.
 */

const served = vi.hoisted(() => ({ state: null as Luciel['state'] | null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      luciel: {
        ...actual.api.luciel,
        get: async () => {
          const luciel = await actual.api.luciel.get();
          return served.state && luciel ? { ...luciel, state: served.state } : luciel;
        },
      },
    },
  };
});

beforeEach(() => {
  served.state = null;
});

describe('configure page in the 30-day grace window', () => {
  it('renders no editable pillars and points at Restore on the Account page', async () => {
    served.state = 'luciel_grace_window';
    renderWithQuery(<ConfigurePage />);
    expect(
      await screen.findByText(/in its 30-day restore window, so its configuration cannot be edited/i),
    ).toBeInTheDocument();
    const restore = screen.getByRole('link', { name: /Restore it from the Account page/i });
    expect(restore).toHaveAttribute('href', '/dashboard/account');
    expect(screen.queryByText(/Channels your Luciel uses/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tools your Luciel can use/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Escalation contact/i)).not.toBeInTheDocument();
    // Not the hard-deleted copy either: this one can still come back.
    expect(screen.queryByText(/restore window has passed/i)).not.toBeInTheDocument();
  });

  it('still renders the pillars for an active Luciel', async () => {
    renderWithQuery(<ConfigurePage />);
    expect(await screen.findByText(/Channels your Luciel uses/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be edited/i)).not.toBeInTheDocument();
  });
});
