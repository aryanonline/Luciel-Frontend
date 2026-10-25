import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLucielClient } from '../index';
import { LucielApiError } from '../schemas';

/**
 * A fetch that never got a response (a keep-alive socket the far side had closed, a
 * network blip) is retried ONCE for the idempotent methods. The browser does that by
 * itself for a GET on a reset socket but never for a DELETE or a PUT; both are
 * idempotent by contract here, so one more attempt turns a one-off blip into a served
 * answer instead of "Network request failed." Live walk run 4 (2026-10-25): the sixth
 * source delete in a row never reached the API while the five before it had. A POST is
 * never repeated: it may not be safe.
 */

const BASE_URL = 'https://api.example.com';
const SOURCE_ID = '11111111-1111-4111-8111-111111111111';

function stubFetch(outcomes: Array<'reject' | number>) {
  const calls: RequestInit[] = [];
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ?? {});
    const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if (outcome === 'reject') throw new TypeError('Failed to fetch');
    return new Response(outcome === 204 ? null : JSON.stringify({}), {
      status: outcome,
      headers: outcome === 204 ? {} : { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

const client = () => createLucielClient({ adapter: 'http', baseUrl: BASE_URL });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a request that never got a response', () => {
  it('a DELETE is attempted once more and the second answer is served', async () => {
    const { fetchMock, calls } = stubFetch(['reject', 204]);
    await expect(client().knowledge.deleteSource(SOURCE_ID)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.method)).toEqual(['DELETE', 'DELETE']);
  });

  it('a GET is attempted once more too', async () => {
    const { fetchMock, calls } = stubFetch(['reject', 200]);
    // The second answer's body is what the caller gets: the blip never surfaced.
    await expect(client().luciel.get()).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
  });

  it('a second failure is the honest network error', async () => {
    const { fetchMock } = stubFetch(['reject', 'reject']);
    await expect(client().knowledge.deleteSource(SOURCE_ID)).rejects.toMatchObject({
      code: 'network_error',
      message: 'Network request failed.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a POST is never repeated', async () => {
    const { fetchMock, calls } = stubFetch(['reject', 200]);
    let caught: unknown;
    try {
      await client().knowledge.restoreSource(SOURCE_ID);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LucielApiError);
    expect((caught as LucielApiError).code).toBe('network_error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]?.method).toBe('POST');
  });
});
