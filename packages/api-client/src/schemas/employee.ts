import { z } from 'zod';
import { isoTimestamp } from './common';

/**
 * The employee's status (round 6 WP-F) — what Luciel can do right now, needs from
 * the owner, and did yesterday/today. Derived server-side from rows that already
 * exist; nothing here is narrated by a model. `onDuty` is a constant: Luciel has no
 * hours. `teamReachableNow` is null until the owner describes their team (WP-E) and
 * then speaks about PEOPLE, never about Luciel.
 */
export const capabilityState = z.enum(['ready', 'attention', 'off', 'unavailable']);
export type CapabilityState = z.infer<typeof capabilityState>;

export const employeeCapability = z.object({
  id: z.string(),
  kind: z.enum(['channel', 'tool', 'knowledge', 'escalation', 'budget']),
  label: z.string(),
  state: capabilityState,
  detail: z.string().nullable().optional(),
});
export type EmployeeCapability = z.infer<typeof employeeCapability>;

export const employeeNeed = z.object({
  code: z.string(),
  severity: z.enum(['attention', 'info']),
  title: z.string(),
  detail: z.string(),
  href: z.string(),
});
export type EmployeeNeed = z.infer<typeof employeeNeed>;

export const dayCounts = z.object({
  date: z.string(),
  conversations: z.number().int().nonnegative(),
  byChannel: z.record(z.string(), z.number().int().nonnegative()).default({}),
  leads: z.number().int().nonnegative(),
  leadsToCrm: z.number().int().nonnegative(),
  escalations: z.number().int().nonnegative(),
  escalationsReached: z.number().int().nonnegative(),
  bookings: z.number().int().nonnegative(),
  callbacksScheduled: z.number().int().nonnegative(),
  humanTakeovers: z.number().int().nonnegative(),
});
export type DayCounts = z.infer<typeof dayCounts>;

export const employeeStatus = z.object({
  assistantName: z.string(),
  businessShortName: z.string().nullable().optional(),
  onDuty: z.string(),
  conversationsUsed: z.number().int().nonnegative(),
  freeAllowance: z.number().int().nonnegative(),
  freeRemaining: z.number().int().nonnegative(),
  billedBlocks: z.number().int().nonnegative(),
  billable: z.boolean(),
  periodResetsAt: isoTimestamp,
  timezone: z.string().nullable().optional(),
  teamReachableNow: z.boolean().nullable().optional(),
  nextReachable: z.string().nullable().optional(),
  capabilities: z.array(employeeCapability),
  needs: z.array(employeeNeed),
  yesterday: dayCounts,
  today: dayCounts,
  dailyBriefEnabled: z.boolean(),
});
export type EmployeeStatus = z.infer<typeof employeeStatus>;
