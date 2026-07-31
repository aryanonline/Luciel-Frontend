import {
  createWidgetClient,
  type CreateWidgetClientConfig,
  type WidgetApiClient,
} from '@luciel/api-client/widget';

/**
 * Data-plane (widget) client used by the in-dashboard "Test it here" preview.
 * It reads the SAME public adapter flags as lib/api.ts but lives in its own
 * module so nothing that renders the preview has to pull in the admin client
 * (Space Instructions §1, §6.3).
 *
 * The flags are NON-secret public values; the API base URL is a public URL.
 */
export type WidgetAdapterKind = CreateWidgetClientConfig['adapter'];

// Same default as lib/api.ts: the mock is opt-in, never the production
// fallback (P2-15).
const envAdapter = (process.env.NEXT_PUBLIC_API_ADAPTER ??
  (process.env.NODE_ENV === 'production' ? 'http' : 'mock')) as WidgetAdapterKind;
const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

/** Defaults to the deployed adapter; pass 'mock' for a canned demo surface. */
export function createPreviewWidgetClient(
  adapter: WidgetAdapterKind = envAdapter,
): WidgetApiClient {
  return createWidgetClient({ adapter, baseUrl, mock: { latencyMs: 150 } });
}
