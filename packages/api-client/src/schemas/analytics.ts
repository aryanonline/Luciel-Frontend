import { z } from 'zod';
import { sessionChannelId } from './luciel';
import { escalationEventSignal } from './conversations';

/**
 * Analytics — aggregates only, tenant-scoped (Arch §3.9). No new PII.
 *
 * Nullable-with-note pattern (server truth, not a page-local widening): a
 * metric the backend cannot honestly state serves `null` plus a plain-language
 * `*Note` string — an honest empty state, never a fabricated 0. Appointments
 * booked and reply time are REAL numbers now (booking_events + transcript turn
 * gaps); their nulls only ever mean "nothing to measure yet this period".
 */
export const analyticsOverview = z.object({
  conversationsThisPeriod: z.number().int().nonnegative(),
  conversationsTotal: z.number().int().nonnegative(),
  leadsThisPeriod: z.number().int().nonnegative(),
  /** Successful bookings made through Luciel this period (real count). */
  appointmentsBooked: z.number().int().nonnegative().nullable(),
  appointmentsBookedNote: z.string().nullable().optional(),
  /** Reply-time distribution: lead message → Luciel's reply, seconds. */
  responseTimeP50Seconds: z.number().nonnegative().nullable(),
  responseTimeP95Seconds: z.number().nonnegative().nullable(),
  responseTimeNote: z.string().nullable().optional(),
  escalationsBySignal: z.array(
    z.object({ signal: escalationEventSignal, count: z.number().int().nonnegative() }),
  ),
  // Session-derived aggregate: old sessions may still carry the legacy
  // combined `instagram_messenger` id, so the mix is read-tolerant of it.
  channelMix: z.array(z.object({ channel: sessionChannelId, fraction: z.number().min(0).max(1) })),
  budgetUtilization: z.number().min(0),
  /** Busiest-times heatmap: [dayOfWeek 0-6][hourOfDay 0-23] -> count. */
  busiestTimes: z.array(z.array(z.number().int().nonnegative())),
  /**
   * Top sources by answer frequency — REAL since the durable retrieval trace
   * (audit round 3, C6/C14). Empty = an honest empty period, not a gap.
   */
  topKnowledgeSources: z
    .array(
      z.object({
        sourceId: z.string(),
        name: z.string(),
        retrievalCount: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  topKnowledgeSourcesNote: z.string().nullable().optional(),
  conversionByChannel: z
    .array(
      z.object({
        channel: sessionChannelId,
        conversations: z.number().int().nonnegative(),
        leads: z.number().int().nonnegative(),
        conversionRate: z.number().min(0),
      }),
    )
    .optional(),
  /**
   * Outcome-based conversion by lead source (first-contact channel) — REAL
   * since leads carry an admin-marked outcome (C14). `source` is served as a
   * plain string ("unknown" covers leads with no session on record).
   */
  conversionBySource: z
    .array(
      z.object({
        source: z.string(),
        leads: z.number().int().nonnegative(),
        converted: z.number().int().nonnegative(),
        conversionRate: z.number().min(0),
      }),
    )
    .optional(),
  conversionBySourceNote: z.string().nullable().optional(),
  conversionByServiceNote: z.string().nullable().optional(),
  /**
   * Whether escalations have anywhere real to go (audit F080): served since the
   * harmony fix but stripped by this schema until round 6 WP-F. `escalationContactBouncing`
   * means a configured email contact is currently suppressed.
   */
  escalationContactConfigured: z.boolean().optional(),
  escalationContactBouncing: z.boolean().optional(),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverview>;

/** Audit log view — read-only (Arch §5.2). */
export const auditEvent = z.object({
  eventId: z.string(),
  eventType: z.string(),
  at: z.string().datetime({ offset: true }),
  detail: z.string().optional(),
  /** Present for owner-initiated actions (e.g. live takeover actor). */
  actorUserId: z.string().uuid().optional(),
});
export type AuditEvent = z.infer<typeof auditEvent>;
