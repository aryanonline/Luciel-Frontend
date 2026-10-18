import { z } from 'zod';

/**
 * Shared primitives. Types derive from Zod schemas (Space Instructions §7):
 * the schema is the single definition of shape, reused to type the client and
 * reusable as React Hook Form validators.
 */

export const uuid = z.string().uuid();
export const isoTimestamp = z.string().datetime({ offset: true });

/**
 * The uniform connection-state chip vocabulary the UI must surface (Space
 * Instructions §4, Arch §3.8.1, §3.8.4). The dashboard shows exactly three
 * chips to the admin: Connected / Action needed / Reconnect needed. The raw
 * `status` enum below maps onto those three chips (see chipForConnection()).
 */
export const connectionStatus = z.enum([
  'unconfigured', // -> "Action needed: connect [X]"
  'connected', // -> "Connected"
  'error', // -> "Action needed: [X] is having trouble"
  'expired', // -> "Reconnect needed"
  'revoked', // not shown to broker; lifecycle teardown
  // Handed back by the admin via POST /connections/{id}/disconnect: the stored
  // credential is destroyed but the row is still listed and RECONNECTABLE, which
  // is what separates it from terminal `revoked` and from never-connected
  // `unconfigured` (contract §1).
  'not_connected',
  'dormant', // downgrade grace; restored on re-upgrade
  // SMS/Voice number supplied but the tenant's own A2P 10DLC Brand+Campaign
  // registration is not yet verified — NOT live; shown as "Action needed:
  // complete carrier registration" (Legal §A2, Arch §3.1.6). The platform never
  // registers on the tenant's behalf, so this state clears only when the tenant
  // triggers re-verify after completing registration themselves.
  'pending_carrier_registration',
  // Own-domain email address chosen but inbound DNS/MX routing not yet verified —
  // NOT live; shown as "Action needed: complete email routing" (Arch §3.1.6a).
  'pending_email_routing',
  // The designated SMS/Voice number is NOT hosted in the tenant's own Twilio
  // account (Arch §3.1.4 BYO operability probe) — distinct from a pending
  // carrier registration: the number itself needs hosting/porting before any
  // registration can matter. Previously degraded to `error` on the wire, which
  // hid the actionable "this number isn't in your Twilio account" guidance.
  'not_operable_hosting_required',
]);
export type ConnectionStatus = z.infer<typeof connectionStatus>;

/**
 * The customer-facing chips (Arch §3.8.1). `not_available` (Harmony wave 2,
 * item 6a) is distinct from `action_needed`: it is the non-actionable
 * counterpart shown when the served provider registry doesn't hold this
 * provider at all, so there is nothing the owner can click to fix it.
 */
export type ConnectionChip = 'connected' | 'action_needed' | 'reconnect_needed' | 'not_available';

/**
 * Structured API error envelope. Models the states the UI must handle
 * (Space Instructions §7): notably `unauthorized` (401 mid-session →
 * route to login cleanly, Arch §3.7.1a) and `verification_required`
 * (unverified account hitting a gated route → verify wall).
 */
export const apiErrorCode = z.enum([
  'unauthorized', // 401 — session invalid/expired/revoked; route to login
  'verification_required', // account unverified; route to verify wall
  'rate_limited', // e.g. resend cooldown (3 / 15 min, Arch §3.7.1a)
  'not_found',
  'conflict', // e.g. booking slot taken (two-step read-before-write)
  'validation_error',
  'at_cap', // free 50 reached, no payment method (Arch §3.4.1b)
  'payment_required',
  // 503 — the data exists but its backing store cannot serve it right now
  // (e.g. an archived conversation whose cold-storage read failed). Distinct
  // from `server_error` so the UI can pass through the backend's honest
  // "nothing has been lost; try again shortly" instead of a generic failure.
  'service_unavailable',
  'server_error',
  'network_error',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCode>;

export const apiError = z.object({
  code: apiErrorCode,
  message: z.string(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  /**
   * The backend's TYPED REFUSAL word (round 7 WP-5 / owner decision D5; the wire
   * body's optional `code` key — app/api/errors.py). It tells a refusal apart from
   * its status-mates: a 403 `account_closed` is not an expired session, so the UI
   * must render the reduced closed-account page instead of bouncing to login.
   * Absent on every refusal that carries no such word.
   */
  reason: z.string().optional(),
  /**
   * Code-shaped values that ride a typed refusal (instants, counts, state names) —
   * e.g. `{ closedAt, reopenUntil }` on `account_closed`. Never display copy.
   */
  detail: z.record(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof apiError>;

/** Thrown by adapters so callers (TanStack Query) get a typed error. */
export class LucielApiError extends Error {
  readonly code: ApiErrorCode;
  readonly retryAfterSeconds?: number;
  /** The wire body's typed-refusal word, when the server sent one (see `apiError`). */
  readonly reason?: string;
  readonly detail?: Record<string, unknown>;
  constructor(err: ApiError) {
    super(err.message);
    this.name = 'LucielApiError';
    this.code = err.code;
    this.retryAfterSeconds = err.retryAfterSeconds;
    if (err.reason !== undefined) this.reason = err.reason;
    if (err.detail !== undefined) this.detail = err.detail;
  }
}
