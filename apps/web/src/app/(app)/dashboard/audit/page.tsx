'use client';

import { Card, CardTitle, CardDescription, PageHeader, Banner } from '@luciel/ui';
import type { AuditEvent } from '@luciel/api-client';
import { useAudit } from '@/lib/hooks';
import { api } from '@/lib/api';
import { usePagedTail } from '@/lib/paging';
import { LoadOlder } from '@/components/load-older';

/**
 * Audit log view — read-only (Arch §5.2). The append-only, tamper-evident log is
 * the proof-of-everything record; this surface only reads it.
 */

/**
 * Owner-facing names for the event types the backend actually emits — the
 * `EVENT_TYPES` enumeration in Luciel-Backend/app/audit/events.py (Arch §5.2),
 * mirrored here in full (round 7 WP-10, item 14). The old map named types no
 * writer ever emitted (`instance_paused`, `export_requested`, …) and missed most
 * of the real ones, which then reached the owner de-snaked. The vocabulary stays
 * open — the server may log a type this build has never heard of — so anything
 * unmapped is still de-snaked rather than dropped, never shown as a raw enum.
 */
const EVENT_LABEL: Record<string, string> = {
  // Luciel lifecycle and configuration
  instance_created: 'Luciel created',
  instance_configured: 'Luciel configured',
  lifecycle_transition: 'Luciel lifecycle changed',
  data_retention_hard_delete: 'Data permanently deleted (retention)',
  // Knowledge
  knowledge_source_viewed: 'Knowledge source viewed',
  knowledge_source_edited: 'Knowledge source edited',
  knowledge_source_deleted: 'Knowledge source deleted',
  knowledge_source_restored: 'Knowledge source restored',
  knowledge_source_scope_changed: 'Knowledge source scope changed',
  record_source_cleared: 'Record lookup CSV cleared',
  // Escalation and delivery
  escalation_fired: 'Escalation raised',
  escalation_notification_sent: 'Escalation notification sent',
  escalation_delivery_failed: 'Escalation delivery failed',
  escalation_acked: 'Escalation acknowledged',
  escalation_owner_fallback: 'Escalation fell back to the owner',
  escalation_after_hours_routing: 'Escalation routed after hours',
  escalation_contact_verification_sent: 'Escalation contact confirmation sent',
  escalation_contact_verified: 'Escalation contact confirmed',
  email_contact_bounced: 'Escalation email bounced',
  deferred_abandon_emailed: 'Abandoned follow-up reported by email',
  llm_unavailable_escalation: 'Escalated because the assistant was unavailable',
  llm_fallback_used: 'Fallback model answered',
  // Conversations, takeover and answer review
  human_takeover_started: 'Takeover started',
  human_takeover_ended: 'Takeover ended',
  human_agent_message_sent: 'Reply sent during takeover',
  answer_flagged_by_admin: 'Answer flagged',
  channel_switch_delivery: 'Answer sent on the channel the customer asked for',
  transcript_archived: 'Transcript moved to cold storage',
  transcript_archive_cleanup: 'Archived transcripts removed',
  voice_disclosure_played: 'Voice disclosure played',
  // Leads
  lead_erasure: 'Lead erased',
  lead_pruned: 'Lead permanently deleted',
  lead_archived: 'Lead archived',
  lead_reactivated: 'Lead reactivated',
  lead_merged: 'Leads merged',
  lead_opt_out_recorded: 'Lead opt-out recorded',
  lead_outcome_marked: 'Lead outcome marked',
  crm_record_upserted: 'Lead written to your CRM',
  crm_links_cleared: 'CRM record links cleared',
  crm_push_failure_emailed: 'CRM push failure reported by email',
  // Budget and billing
  budget_exhausted: 'Free conversations used up',
  budget_overage_threshold: 'Pay-as-you-go heads-up',
  billing_checkout_started: 'Checkout started',
  payment_method_added: 'Payment method added',
  payment_method_removed: 'Payment method removed',
  invoice_paid: 'Invoice paid',
  payment_failed: 'Payment failed',
  dunning_state_changed: 'Payment retry status changed',
  billing_closure_settled: 'Final invoice settled at closure',
  billing_period_anchored: 'Billing period anchored',
  billing_notice_sent: 'Billing notice sent',
  lifecycle_notice_sent: 'Account notice sent',
  stripe_customer_deleted: 'Billing profile deleted at purge',
  // Connections
  connection_status_changed: 'Connection status changed',
  connection_settings_updated: 'Connection settings updated',
  connection_secret_cleanup: 'Connection credentials destroyed',
  connection_secret_cleanup_scheduled: 'Connection credentials scheduled for destruction',
  connection_attention_emailed: 'Connection attention email sent',
  destination_claim_rejected: 'Destination already in use elsewhere — refused',
  byo_webhook_circuit_open: 'Your endpoint paused after repeated failures',
  // SMS / Voice number
  voice_consent_ack: 'Voice consent acknowledged',
  voice_consent_withdrawn: 'Voice consent withdrawn',
  sms_compliance_ack_withdrawn: 'SMS carrier acknowledgement withdrawn',
  carrier_registration_attested: 'Carrier registration attested',
  carrier_registration_attestation_withdrawn: 'Carrier registration attestation withdrawn',
  webhook_autoconfig_applied: 'Number webhooks pointed at Luciel',
  webhook_autoconfig_failed: 'Number webhooks could not be set automatically',
  webhook_capability_provisioned: 'Inbound verification token issued',
  inbound_capability_rejected: 'Inbound message failed verification',
  // Data export and closure
  data_export_requested: 'Data export requested',
  data_export_self_serve: 'Data export requested',
  data_export_ready: 'Data export ready',
  data_export_downloaded: 'Data export downloaded',
  account_closure_initiated: 'Account closure started',
  // Widget, channels and safety
  widget_abuse_blocked: 'Widget abuse blocked',
  widget_origin_blocked: 'Widget blocked on an unlisted site',
  channel_abuse_blocked: 'Channel abuse blocked',
  prompt_injection_detected: 'Prompt injection detected',
  content_moderation_event: 'Content moderation event',
  embed_key_rotated: 'Embed key rotated',
  daily_brief_sent: 'Morning brief sent',
  // Sign-in and credentials
  account_created: 'Account created',
  email_verified: 'Email verified',
  verification_resent: 'Verification email re-sent',
  unverified_account_reaped: 'Unverified account removed',
  login_succeeded: 'Signed in',
  login_failed: 'Sign-in failed',
  logout: 'Signed out',
  password_reset_requested: 'Password reset requested',
  password_reset_completed: 'Password reset completed',
};

const eventLabel = (type: string) =>
  EVENT_LABEL[type] ?? type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const auditKey = (e: AuditEvent) => e.eventId;
const fetchOlderAudit = (opts: { limit?: number; offset?: number }) => api.analytics.auditLog(opts);

export default function AuditPage() {
  const { data: firstPage, isPending, isError, refetch } = useAudit();
  // 2026-09-05 audit F170: the log is paged server-side; older entries load on
  // request instead of the first 200 rows silently standing in for the record.
  const older = usePagedTail(firstPage, fetchOlderAudit, auditKey);
  const data = firstPage ? [...firstPage, ...older.extra] : firstPage;

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Audit log"
        description="A read-only, append-only record of every meaningful change to your account."
      />
      <Card>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Read-only. Every meaningful change is recorded here.</CardDescription>
        {/* An empty <ul> was how this page rendered both "still loading" and "we
            could not read the log" — and for a proof-of-everything record,
            silently showing nothing is the one thing it must not do (P1-14). */}
        {isPending ? (
          <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
            Loading your activity…
          </p>
        ) : isError ? (
          <Banner tone="danger" className="mt-vm-3">
            We could not load your audit log. This is a read failure on our side — nothing has been
            removed from the record.{' '}
            <button className="underline" onClick={() => void refetch()}>
              Try again
            </button>
          </Banner>
        ) : !data?.length ? (
          <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
            Nothing recorded yet. Changes to your Luciel, your connections, and your account will
            appear here.
          </p>
        ) : (
          <ul className="mt-vm-3 divide-y divide-vm-border">
            {data.map((e) => (
              <li
                key={e.eventId}
                className="flex items-start justify-between gap-vm-3 py-vm-2 text-vm-1"
              >
                <div>
                  <div className="font-label">{eventLabel(e.eventType)}</div>
                  {/* The served detail, when the backend attaches one (it is starting
                      to): the row's own words, rendered as-is under the label. */}
                  {e.detail && (
                    <div className="text-vm-0 text-vm-text-muted" data-testid="audit-detail">
                      {e.detail}
                    </div>
                  )}
                </div>
                <time className="shrink-0 text-vm-0 text-vm-text-muted">
                  {new Date(e.at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
        <LoadOlder label="Load older entries" tail={older} />
      </Card>
    </div>
  );
}
