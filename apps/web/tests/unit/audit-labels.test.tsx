import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import AuditPage from '@/app/(app)/dashboard/audit/page';
import { api } from '@/lib/api';
import type { AuditEvent } from '@luciel/api-client';

/**
 * Round 7 WP-10, item 14 — the audit page labelled event types the backend never
 * emits and missed most of the real ones (`EVENT_TYPES` in
 * Luciel-Backend/app/audit/events.py), which then reached the owner de-snaked.
 * Pinned here: the served types render their owner-facing labels, the served
 * `detail` renders under the label when present, and an unknown future type is
 * still de-snaked rather than dropped or shown raw.
 */
const at = (i: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString();

const served: AuditEvent[] = [
  { eventId: 'e1', eventType: 'lifecycle_transition', at: at(1), detail: 'active → paused' },
  { eventId: 'e2', eventType: 'data_export_ready', at: at(2) },
  { eventId: 'e3', eventType: 'escalation_fired', at: at(3), detail: 'Lead asked for a human' },
  { eventId: 'e4', eventType: 'human_takeover_started', at: at(4) },
  { eventId: 'e5', eventType: 'carrier_registration_attested', at: at(5) },
  { eventId: 'e6', eventType: 'some_future_event_type', at: at(6), detail: 'served words' },
];

afterEach(() => vi.restoreAllMocks());

describe('audit log labels the types the backend emits', () => {
  it('renders owner-facing labels, the served detail, and de-snakes an unknown type', async () => {
    vi.spyOn(api.analytics, 'auditLog').mockResolvedValue(served);
    renderWithQuery(<AuditPage />);

    expect(await screen.findByText('Luciel lifecycle changed')).toBeInTheDocument();
    expect(screen.getByText('Data export ready')).toBeInTheDocument();
    expect(screen.getByText('Escalation raised')).toBeInTheDocument();
    expect(screen.getByText('Takeover started')).toBeInTheDocument();
    expect(screen.getByText('Carrier registration attested')).toBeInTheDocument();
    // Unknown future type: readable, never the raw enum.
    expect(screen.getByText('Some future event type')).toBeInTheDocument();
    expect(screen.queryByText('some_future_event_type')).not.toBeInTheDocument();
    expect(screen.queryByText('lifecycle_transition')).not.toBeInTheDocument();

    // The served detail renders under its label when present — and only then.
    const details = screen.getAllByTestId('audit-detail').map((d) => d.textContent);
    expect(details).toEqual(['active → paused', 'Lead asked for a human', 'served words']);
  });
});
