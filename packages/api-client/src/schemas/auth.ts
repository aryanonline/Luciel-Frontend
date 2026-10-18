import { z } from 'zod';
import { uuid, isoTimestamp } from './common';

/**
 * Auth & account-lifecycle shapes. Source: Arch §3.7.1a (account state machine,
 * link TTL/single-use/rate-limit, reset → global revocation) and §3.7.2.
 *
 * NOTE on the session token: the JWT itself is NOT modeled in these response
 * shapes on purpose. The frontend's job is to *carry* the session, not hold the
 * raw token in JS state (Space Instructions §3.3). Login responses therefore
 * return only the account/session-context the UI needs; the JWT is delivered via
 * httpOnly Secure SameSite cookie (preferred) or held in memory by the adapter,
 * never in localStorage. ASSUMPTION (flagged): the docs specify the cookie-vs-
 * body choice as a backend contract dependency; the mock models the cookie path.
 */

/** Account states — Arch §3.7.1a (verbatim enum). */
export const accountState = z.enum([
  'unverified',
  'verified',
  'paused', // (account-level lifecycle states per §3.6 — modeled for completeness)
  'pending_deletion',
  'closed',
]);
export type AccountState = z.infer<typeof accountState>;

export const account = z.object({
  adminId: uuid,
  userId: uuid,
  email: z.string().email(),
  state: accountState,
  createdAt: isoTimestamp,
  /** True once email-verification has completed (gate to dashboard, §3.7.1a). */
  emailVerified: z.boolean(),
  /** Whether the owner has ever completed first login (routes to first-run). */
  hasCompletedFirstRun: z.boolean(),
  /** Whether a Luciel currently exists for this account (account: empty vs not). */
  hasLuciel: z.boolean(),
});
export type Account = z.infer<typeof account>;

/**
 * POST /admin/account/export (Arch §3.6.6 / §5.10; round 7 WP-10, item 12). The
 * bundle is built and stored, and the time-limited link comes back in the body AS
 * WELL AS by email — so an email that never arrives is not the owner's only path
 * to their own data. `ttlDays` is the link's life. Both are optional on the wire
 * so an older server's bare `{ ok: true }` still parses; the UI then falls back
 * to the email sentence alone. The HTTP adapter normalises the endpoint's
 * snake_case spelling (`download_url`, `ttl_days`) to this shape.
 */
export const accountExportResult = z.object({
  ok: z.boolean().default(true),
  downloadUrl: z.string().url().optional(),
  ttlDays: z.number().int().positive().optional(),
  /**
   * What happened to the email carrying the same link (round 7 WP-5, item 4 —
   * account.py `ExportResult.email_outcome`, served as `emailOutcome`):
   * `sent` | `recorded` (mock/CI: nothing left the platform) | `no_sender` (no
   * platform sender identity bound — the link went nowhere) | `failed:<reason>`.
   * Optional so an older server's response still parses; the UI then says no
   * more than it knows. Read it with `exportEmailOutcome`.
   */
  emailOutcome: z.string().optional(),
});
export type AccountExportResult = z.infer<typeof accountExportResult>;

/** The export email's outcome, parsed from the served word (see `accountExportResult`). */
export type ExportEmailOutcome =
  | { kind: 'sent' }
  | { kind: 'recorded' }
  | { kind: 'no_sender' }
  | { kind: 'failed'; reason: string | null }
  | { kind: 'unknown' };

export function exportEmailOutcome(raw: string | undefined | null): ExportEmailOutcome {
  if (raw === 'sent' || raw === 'recorded' || raw === 'no_sender') return { kind: raw };
  if (typeof raw === 'string' && raw.startsWith('failed')) {
    const reason = raw.slice('failed'.length).replace(/^:/, '').trim();
    return { kind: 'failed', reason: reason && reason !== 'unknown' ? reason : null };
  }
  return { kind: 'unknown' };
}

/**
 * GET /api/v1/admin/account (round 7 WP-5 / owner decision D5; schemas_api/account.py
 * `AccountStatusOut`) — the one read a CLOSED account may make. For an open account
 * both instants are null and `canReopen` is false.
 */
export const accountStatus = z.object({
  state: accountState,
  /** When the owner closed the account. */
  closedAt: isoTimestamp.nullable().optional(),
  /** The last moment to reopen or re-request the export (closure + 30 days). */
  reopenUntil: isoTimestamp.nullable().optional(),
  /** True only while the account is closed AND inside that window. */
  canReopen: z.boolean().default(false),
  /** Whether reopening brings the Luciel back from its grace window. */
  lucielRestoredOnReopen: z.boolean().default(false),
});
export type AccountStatus = z.infer<typeof accountStatus>;

/** POST /api/v1/admin/account/reopen (schemas_api/account.py `ReopenResult`). */
export const reopenResult = z.object({
  state: accountState,
  /** The Luciel came back from its grace window (active, or paused if it was paused). */
  lucielRestored: z.boolean().default(false),
  lucielState: z.string().nullable().optional(),
  /** `payg_enabled` | `free_cap` — the billing arrangement the account resumes on. */
  billingState: z.string(),
});
export type ReopenResult = z.infer<typeof reopenResult>;

/** The typed-refusal word every admin route answers a closed account with (D5). */
export const ACCOUNT_CLOSED = 'account_closed';

/** What an `account_closed` refusal carries (errors.py `account_closed`). */
export interface AccountClosedDetail {
  closedAt: string | null;
  reopenUntil: string | null;
}

/**
 * The closure an error reports, or null when the error is anything else. A 403
 * that names `account_closed` is NOT an expired session: the owner signed in fine
 * and must see the reduced closed-account page, never be bounced to /login.
 */
export function accountClosedDetail(error: unknown): AccountClosedDetail | null {
  if (
    !error ||
    typeof error !== 'object' ||
    (error as { reason?: unknown }).reason !== ACCOUNT_CLOSED
  ) {
    return null;
  }
  const detail = (error as { detail?: Record<string, unknown> }).detail ?? {};
  const instant = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return { closedAt: instant(detail.closedAt), reopenUntil: instant(detail.reopenUntil) };
}

/**
 * An account-level notice the dashboard must surface on next login (Legal §A5,
 * §A10, §B10). §A5 is the binding case: a REDUCTION to the free starter
 * allowance must be delivered both by email and "as an in-dashboard
 * notification visible on next login", with at least 30 days' lead time,
 * because a registered email address may have gone stale.
 */
export const accountNoticeKind = z.enum([
  'allowance_reduction', // Legal §A5 — 30 days' notice before the change takes effect
  'price_change', // Legal §A10 — PAYG rate increase / capacity reduction
  'terms_change', // Legal §A10 / §B10 — material change to Terms or Privacy
  'model_updated', // §3.4.3 — the provider retired a model and the platform swapped it
]);
export type AccountNoticeKind = z.infer<typeof accountNoticeKind>;

export const accountNotice = z.object({
  /** Stable id so a dismissal targets one notice and never hides a later one. */
  noticeId: z.string().min(1),
  kind: accountNoticeKind,
  title: z.string().min(1),
  body: z.string().min(1),
  /** When the change takes effect — the server owns the lead-time arithmetic. */
  effectiveAt: isoTimestamp.optional(),
  /** In-app destination for the detail, e.g. /legal/terms. */
  learnMoreHref: z.string().optional(),
});
export type AccountNotice = z.infer<typeof accountNotice>;

/** What a successful login resolves to (no raw JWT — see file header). */
export const session = z.object({
  account,
  /** Where the UI should route post-login (Arch §3.7.1a). */
  nextRoute: z.enum(['first_run', 'dashboard', 'verify_wall']),
  /**
   * Notices to render in the dashboard shell. Optional and defaulted to empty:
   * BACKEND DEPENDENCY — until `/api/v1/auth/me` carries this field, no notice
   * renders and nothing breaks.
   */
  notices: z.array(accountNotice).optional(),
});
export type Session = z.infer<typeof session>;

// --- Request shapes (also reusable as RHF + Zod validators) -------------------

export const signupRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** Invisible captcha token (Customer Journey Phase 2). */
  captchaToken: z.string().min(1),
});
export type SignupRequest = z.infer<typeof signupRequest>;

export const loginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const forgotPasswordRequest = z.object({ email: z.string().email() });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequest>;

export const resetPasswordRequest = z.object({
  /** Single-use, 1h TTL reset token from the emailed link (Arch §3.7.1a). */
  token: z.string().min(1),
  newPassword: z.string().min(1),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequest>;

export const verifyEmailRequest = z.object({
  /** Single-use, 24h TTL verification token (Arch §3.7.1a). */
  token: z.string().min(1),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequest>;

/**
 * True when the platform intended to put mail on the wire and it did not get
 * there. The UI then offers a resend + a support path instead of telling the
 * customer to check their inbox. The provider error is never on the wire, and
 * forgot-password carries no such signal on purpose (non-enumeration, §3.7.1a).
 */
const emailDeliveryDegraded = z.boolean().optional();

export const signupResult = z.object({
  account,
  emailDeliveryDegraded,
});
export type SignupResult = z.infer<typeof signupResult>;

/** Resend is rate-limited to 3 / 15 min (Arch §3.7.1a). */
export const resendVerificationResult = z.object({
  ok: z.boolean(),
  cooldownSecondsRemaining: z.number().int().nonnegative().optional(),
  emailDeliveryDegraded,
});
export type ResendVerificationResult = z.infer<typeof resendVerificationResult>;
