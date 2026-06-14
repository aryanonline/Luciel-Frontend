/**
 * CONTROL-PLANE entrypoint (marketing + admin dashboard). This is the ONLY
 * module admin UI imports for server data. It deliberately does NOT re-export
 * the widget client — the widget imports '@luciel/api-client/widget' instead,
 * keeping the two planes' code apart (Space Instructions §1, §6.3, §7).
 */

// Types (derived from Zod schemas — the single shape definition).
export * from './schemas';

// The interface UI codes against.
export type { LucielApiClient } from './client';

// The selector + adapter options.
export { createLucielClient, type ApiAdapterKind, type CreateClientConfig } from './factory';
export type { MockScenario, MockAdminOptions } from './adapters/mock-admin';

// Helpers.
export { chipForConnection } from './chips';
export { LucielApiError } from './schemas';
