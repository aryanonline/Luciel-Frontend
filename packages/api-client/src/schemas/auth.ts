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
