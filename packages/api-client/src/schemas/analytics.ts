import { z } from 'zod';
import { channelId } from './luciel';
import { escalationEventSignal } from './conversations';

/**
 * Analytics — aggregates only, tenant-scoped (Arch §3.9). No new PII.
 */
export const analyticsOverview = z.object({
  conversationsThisPeriod: z.number().int().nonnegative(),
  conversationsTotal: z.number().int().nonnegative(),
  leadsThisPeriod: z.number().int().nonnegative(),
  appointmentsBooked: z.number().int().nonnegative(),
  /** Response-time distribution (escalation → admin first response). */
  responseTimeP50Seconds: z.number().nonnegative(),
  responseTimeP95Seconds: z.number().nonnegative(),
  escalationsBySignal: z.array(
    z.object({ signal: escalationEventSignal, count: z.number().int().nonnegative() }),
  ),
  channelMix: z.array(z.object({ channel: channelId, fraction: z.number().min(0).max(1) })),
  budgetUtilization: z.number().min(0),
  /** Busiest-times heatmap: [dayOfWeek 0-6][hourOfDay 0-23] -> count. */
  busiestTimes: z.array(z.array(z.number().int().nonnegative())),
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
