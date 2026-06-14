import { LucielApiError, type ApiErrorCode } from '../schemas';

/**
 * Minimal fetch transport used by the httpAdapter. Centralizes:
 *  - credentials: 'include' so the httpOnly session cookie is sent
 *    (the JWT is NEVER read from JS — Space Instructions §3.3).
 *  - mapping HTTP status → typed LucielApiError (notably 401 → 'unauthorized'
 *    so callers route to login cleanly on a mid-session expiry, Arch §3.7.1a).
 *
 * No token is attached here from JS storage — the cookie carries it. If the
 * backend instead returns the token in the body, the in-memory holder (set by
 * the app at login) would attach an Authorization header; that path is left as
 * a documented extension point rather than a localStorage read.
 */

const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  401: 'unauthorized',
  402: 'payment_required',
  403: 'unauthorized',
  404: 'not_found',
  409: 'conflict',
  422: 'validation_error',
  429: 'rate_limited',
};

export interface TransportOptions {
  baseUrl: string;
  /** Optional in-memory bearer token (used ONLY if backend returns body token). */
  getBearerToken?: () => string | undefined;
}

export function createTransport(opts: TransportOptions) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const token = opts.getBearerToken?.();
      if (token) headers['authorization'] = `Bearer ${token}`;
      res = await fetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        // Carry the httpOnly session cookie; never touch localStorage.
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new LucielApiError({ code: 'network_error', message: 'Network request failed.' });
    }

    if (!res.ok) {
      const code = STATUS_TO_CODE[res.status] ?? 'server_error';
      let message = res.statusText || 'Request failed.';
      let retryAfterSeconds: number | undefined;
      try {
        const data = (await res.json()) as { message?: string; retryAfterSeconds?: number };
        if (data.message) message = data.message;
        retryAfterSeconds = data.retryAfterSeconds;
      } catch {
        /* non-JSON error body — keep status text */
      }
      throw new LucielApiError({ code, message, retryAfterSeconds });
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    del: <T>(path: string) => request<T>('DELETE', path),
  };
}

export type Transport = ReturnType<typeof createTransport>;
