import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import AuditPage from '@/app/(app)/dashboard/audit/page';
import AnalyticsPage from '@/app/(app)/dashboard/analytics/page';
import { api } from '@/lib/api';
import { cardExpiryWarning, cardExpiresAt } from '@/lib/card-expiry';
import type { AuditEvent } from '@luciel/api-client';

/**
 * 2026-09-05 audit WP8:
 *  - the audit log loads older pages on request (F170) and never pretends the
 *    first page is the whole record;
 *  - the card-expiry heads-up is computed from the served card (F177);
 *  - the analytics "% of the free 50" is capped and labelled once past the cap.
 */

const event = (i: number): AuditEvent => ({
  eventId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  eventType: 'instance_configured',
  at: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
});

describe('audit log paging (F170)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers older entries only when the first page is full, then appends them', async () => {
    const first = Array.from({ length: 200 }, (_, i) => event(i));
    const older = Array.from({ length: 3 }, (_, i) => event(200 + i));
    const spy = vi
      .spyOn(api.analytics, 'auditLog')
      .mockImplementation(async (opts) => (opts?.offset ? older : first));
    renderWithQuery(<AuditPage />);
    const button = await screen.findByRole('button', { name: 'Load older entries' });
    expect(screen.getAllByText('Luciel configured')).toHaveLength(200);
    fireEvent.click(button);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ limit: 200, offset: 200 }));
    await waitFor(() => expect(screen.getAllByText('Luciel configured')).toHaveLength(203));
    // A short page means the record is exhausted: the control goes away.
    expect(screen.queryByRole('button', { name: 'Load older entries' })).not.toBeInTheDocument();
  });

  it('does not offer older entries for a short first page', async () => {
    vi.spyOn(api.analytics, 'auditLog').mockResolvedValue([event(1), event(2)]);
    renderWithQuery(<AuditPage />);
    await screen.findAllByText('Luciel configured');
    expect(screen.queryByRole('button', { name: 'Load older entries' })).not.toBeInTheDocument();
  });
});

describe('card expiry heads-up (F177)', () => {
  const pm = { brand: 'visa', last4: '4242', expMonth: 9, expYear: 2026 };

  it('is quiet far from expiry, warns inside 45 days, and says so once expired', () => {
    expect(cardExpiryWarning(pm, new Date(Date.UTC(2026, 5, 1)))).toBeNull();
    const warn = cardExpiryWarning(pm, new Date(Date.UTC(2026, 8, 1)));
    expect(warn).toMatch(/VISA ending 4242 expires 09\/2026 \(\d+ days from now\)/);
    const expired = cardExpiryWarning(pm, new Date(Date.UTC(2026, 9, 2)));
    expect(expired).toMatch(/expired 09\/2026/);
    expect(cardExpiryWarning(undefined)).toBeNull();
    expect(cardExpiresAt(2, 2028).toISOString().slice(0, 10)).toBe('2028-02-29');
  });
});

describe('analytics free-50 percentage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is capped at 100% and labelled once past the free allowance', async () => {
    const base = await api.analytics.overview();
    vi.spyOn(api.analytics, 'overview').mockResolvedValue({ ...base, budgetUtilization: 1.4 });
    renderWithQuery(<AnalyticsPage />);
    expect(
      await screen.findByText(
        /100% of the free 50 used this period \(past the free 50 — pay-as-you-go\)/,
      ),
    ).toBeInTheDocument();
  });
});
