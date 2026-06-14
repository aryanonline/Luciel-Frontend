import { createLucielClient, type LucielApiClient, type ApiAdapterKind } from '@luciel/api-client';

/**
 * The single place the adapter flag is read (Space Instructions §7). Everything
 * else imports `api` (the LucielApiClient) and is unaware of which adapter backs
 * it — so swapping mock → http is a one-line env change, ZERO component edits.
 *
 * The flag is a NON-secret public value (NEXT_PUBLIC_*). The API base URL is a
 * public URL, not a secret. No secret ever flows through here.
 */
const adapter = (process.env.NEXT_PUBLIC_API_ADAPTER ?? 'mock') as ApiAdapterKind;
const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

export const api: LucielApiClient = createLucielClient({
  adapter,
  baseUrl,
  // Mock scenario can be toggled in development via the same public flag if desired.
  mock: { latencyMs: 150 },
});
