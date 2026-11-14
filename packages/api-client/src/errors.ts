import type { ApiError, ApiErrorCode } from './schemas/common';

/**
 * Thrown by adapters so callers (TanStack Query) get a typed error. It lives outside the
 * schemas, which re-export it, so the widget's transport can throw it without importing
 * the control-plane schemas or classic zod (see `schemas/widget.ts`).
 */
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
