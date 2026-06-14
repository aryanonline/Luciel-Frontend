import {
  createLucielClient,
  type LucielApiClient,
  type ApiAdapterKind,
  type MockScenario,
} from '@luciel/api-client';

/**
 * The single place the adapter flag is read (Space Instructions §7). Everything
 * else imports `api` (the LucielApiClient) and is unaware of which adapter backs
 * it — so swapping mock → http is a one-line env change, ZERO component edits.
 *
 * The flags are NON-secret public values (NEXT_PUBLIC_*). The API base URL is a
 * public URL, not a secret. No secret ever flows through here.
 *
 * NEXT_PUBLIC_MOCK_SCENARIO lets you exercise different documented states when
 * running on the mock — try the whole journey from a fresh account, or jump to
 * at-cap / payg / paused / grace to see those surfaces (Space Instructions §7):
 *   verified (default) | fresh | unverified | at_cap | payg | paused | grace
 */
const adapter = (process.env.NEXT_PUBLIC_API_ADAPTER ?? 'mock') as ApiAdapterKind;
const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const scenario = (process.env.NEXT_PUBLIC_MOCK_SCENARIO ?? 'verified') as MockScenario;

export const api: LucielApiClient = createLucielClient({
  adapter,
  baseUrl,
  mock: { latencyMs: 150, scenario },
});
