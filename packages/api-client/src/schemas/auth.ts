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

/** What a successful login resolves to (no raw JWT — see file header). */
export const session = z.object({
  account,
  /** Where the UI should route post-login (Arch §3.7.1a). */
  nextRoute: z.enum(['first_run', 'dashboard', 'verify_wall']),
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

/** Resend is rate-limited to 3 / 15 min (Arch §3.7.1a). */
export const resendVerificationResult = z.object({
  ok: z.boolean(),
  cooldownSecondsRemaining: z.number().int().nonnegative().optional(),
});
export type ResendVerificationResult = z.infer<typeof resendVerificationResult>;
