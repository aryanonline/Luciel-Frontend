import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLucielClient } from '../index';
import { LucielApiError } from '../schemas';

/**
 * HTTP status → typed error-code mapping. The case that earns its own file is
 * 503 → 'service_unavailable': the backend uses it for a conversation whose
 * cold-storage archive read failed, and its body message ("nothing has been
 * lost; try again shortly") is the honest copy the UI must be able to show
 * verbatim. Folding 503 into the generic 'server_error' would throw that
 * message away and downgrade a known, recoverable state to "something broke".
 */

const BASE_URL = 'https://api.example.com';

const ARCHIVE_MESSAGE =
  'This conversation is in long-term storage and could not be loaded right now. ' +
  'Nothing has been lost; please try again shortly.';

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function failingGet(): Promise<LucielApiError> {
  try {
    await createLucielClient({ adapter: 'http', baseUrl: BASE_URL }).luciel.get();
  } catch (err) {
    expect(err).toBeInstanceOf(LucielApiError);
    return err as LucielApiError;
  }
  throw new Error('expected the request to reject');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transport status → error-code mapping', () => {
  it("maps 503 to 'service_unavailable' and passes the backend's message through", async () => {
    stubFetch(503, { message: ARCHIVE_MESSAGE });
    const err = await failingGet();

    expect(err.code).toBe('service_unavailable');
    expect(err.message).toBe(ARCHIVE_MESSAGE);
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it("keeps an unmapped 5xx on the generic 'server_error' fallback", async () => {
    stubFetch(500, { message: 'Internal error.' });
    const err = await failingGet();

    expect(err.code).toBe('server_error');
  });

  it("maps 429 to 'rate_limited' with retryAfterSeconds from the body", async () => {
    stubFetch(429, { message: 'Too many requests.', retryAfterSeconds: 30 });
    const err = await failingGet();

    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(30);
  });
});
