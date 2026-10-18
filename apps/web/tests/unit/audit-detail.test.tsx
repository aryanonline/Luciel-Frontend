import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import AuditPage from '@/app/(app)/dashboard/audit/page';
import { api } from '@/lib/api';
import type { AuditEvent } from '@luciel/api-client';

/**
 * Round 7 WP-5 item 6 — the audit log's served `detail`.
 *
 * GET /api/v1/admin/usage/audit-log rows are `{eventId, eventType, at, detail,
 * actorUserId}` where `detail` is rendered server-side by admin/usage.py
 * `audit_detail` from code-shaped payload values (from → to, a data class + count +
 * policy, a billing move) and is `null` for event types it has no renderer for. The
 * payloads below are the exact strings the backend contract test pins
 * (tests/contract/test_usage_audit_detail.py), plus the round-7 types this build
 * now labels. Pinned: each detail renders verbatim under its label; a null detail
 * renders nothing (not "null", not an empty line); the new types are labelled.
 */
const at = (i: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString();

// Exactly the wire shape: detail and actorUserId are null when absent.
const served = [
  ['lifecycle_transition', 'active → luciel_grace_window'],
  ['lifecycle_transition', 'luciel_grace_window → luciel_hard_deleted (grace_window_expiry)'],
  ['data_retention_hard_delete', 'session_summary: 12 deleted (age_based_sweep:365d)'],
  ['data_retention_hard_delete', 'lead_record (luciel_hard_delete_cascade)'],
  ['dunning_state_changed', 'none → retrying (payment_failed)'],
  ['payment_method_added', 'visa card added'],
  ['payment_method_removed', 'card removed (admin_removed)'],
  ['connection_status_changed', 'connected → expired'],
  ['connection_status_changed', 'deferred_abandoned: schedule_callback on email_sender'],
  ['account_reopened', 'Luciel restored (active)'],
  [
    'billing_period_anchored',
    'period anchor 2026-10-01T00:00:00+00:00 → 2026-10-14T00:00:00+00:00',
  ],
  ['login_succeeded', null],
].map(([eventType, detail], i) => ({
  eventId: `e${i}`,
  eventType,
  at: at(i),
  detail,
  actorUserId: null,
})) as AuditEvent[];

afterEach(() => vi.restoreAllMocks());

describe('audit log renders the served detail', () => {
  it('renders every served detail verbatim under its label', async () => {
    vi.spyOn(api.analytics, 'auditLog').mockResolvedValue(served);
    renderWithQuery(<AuditPage />);
    await screen.findAllByText('Luciel lifecycle changed');

    const details = screen.getAllByTestId('audit-detail').map((d) => d.textContent);
    expect(details).toEqual(served.filter((e) => e.detail).map((e) => e.detail));

    // The detail sits in the same row as its label.
    const reopenedRow = screen.getByText('Account reopened').closest('li') as HTMLElement;
    expect(within(reopenedRow).getByText('Luciel restored (active)')).toBeInTheDocument();
    const retention = screen.getAllByText('Data permanently deleted (retention)');
    expect(
      within(retention[0]?.closest('li') as HTMLElement).getByText(
        'session_summary: 12 deleted (age_based_sweep:365d)',
      ),
    ).toBeInTheDocument();
  });

  it('a null detail renders no detail line at all', async () => {
    vi.spyOn(api.analytics, 'auditLog').mockResolvedValue(served);
    renderWithQuery(<AuditPage />);
    const row = (await screen.findByText('Signed in')).closest('li') as HTMLElement;
    expect(within(row).queryByTestId('audit-detail')).not.toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('labels the round-7 event types instead of de-snaking them', async () => {
    const types = [
      'account_reopened',
      'billing_portal_session_created',
      'billing_meter_unbound',
      'crm_backfill_run',
      'crm_portal_shared',
      'escalation_contact_code_rejected',
      'knowledge_pause_notice_emailed',
      'lead_edited',
      'lead_identifier_rehomed',
    ];
    vi.spyOn(api.analytics, 'auditLog').mockResolvedValue(
      types.map((eventType, i) => ({ eventId: `t${i}`, eventType, at: at(i), detail: null })),
    );
    renderWithQuery(<AuditPage />);
    expect(await screen.findByText('Account reopened')).toBeInTheDocument();
    for (const label of [
      'Card update started',
      'Usage could not be reported for billing',
      'Earlier leads sent to your CRM',
      'CRM account is also connected to another account',
      'Escalation contact code refused',
      'Knowledge source pause notice emailed',
      'Lead details corrected',
      'Lead contact detail moved to its proven owner',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
