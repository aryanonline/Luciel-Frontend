import type { LucielApiClient } from './client';
import { createMockAdminClient, type MockAdminOptions } from './adapters/mock-admin';
import { createHttpAdminClient } from './adapters/http-admin';

/**
 * THE adapter selector for the admin client. ONE flag chooses the adapter
 * (Space Instructions §7). The flag value is read by the app and passed in here;
 * this package does not read process.env directly so it stays framework-neutral
 * and bundler-safe (no accidental secret inlining).
 *
 * Swapping 'mock' → 'http' must require ZERO component changes — components
 * depend only on LucielApiClient, never on which adapter produced it.
 */
export type ApiAdapterKind = 'mock' | 'http';

export interface CreateClientConfig {
  adapter: ApiAdapterKind;
  /** Required when adapter = 'http'. A PUBLIC URL — never a secret. */
  baseUrl?: string;
  /** Mock-only options (scenario, latency). Ignored for http. */
  mock?: MockAdminOptions;
  /** Optional in-memory bearer accessor (only if backend returns body token). */
  getBearerToken?: () => string | undefined;
}

export function createLucielClient(config: CreateClientConfig): LucielApiClient {
  if (config.adapter === 'http') {
    if (!config.baseUrl) {
      throw new Error('createLucielClient: baseUrl is required when adapter="http".');
    }
    return createHttpAdminClient({
      baseUrl: config.baseUrl,
      getBearerToken: config.getBearerToken,
    });
  }
  return createMockAdminClient(config.mock);
}
