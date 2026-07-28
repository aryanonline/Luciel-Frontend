import { LucielApiError, type ApiErrorCode } from '../schemas';

/**
 * Minimal fetch transport used by the httpAdapter. Centralizes:
 *  - credentials: 'include' (default) so the httpOnly session cookie is sent
 *    (the JWT is NEVER read from JS — Space Instructions §3.3). The widget
 *    data-plane opts out with credentials: 'omit' — see TransportOptions.
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
  /**
   * Cookie mode. Defaults to 'include' for the credentialed admin plane.
   * The widget data-plane MUST use 'omit': that plane answers with
   * `Access-Control-Allow-Origin: *` and authenticates via embedKey in the
   * body, and browsers reject a wildcard ACAO on a credentialed request — the
   * preflight fails and the widget renders nothing.
   */
  credentials?: 'include' | 'omit';
}

/** A file body streamed straight to the browser rather than parsed as JSON. */
export interface TransportFile {
  blob: Blob;
  /** Server-chosen name from Content-Disposition, when it sent one. */
  filename?: string;
}

const FILENAME = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i;

function filenameFrom(contentDisposition: string | null): string | undefined {
  const name = contentDisposition ? FILENAME.exec(contentDisposition)?.[1] : undefined;
  // Strip any path segments — the header is server-controlled but this value
  // reaches a download anchor, so it must stay a bare filename.
  return name ? name.trim().split(/[\\/]/).pop() || undefined : undefined;
}

export function createTransport(opts: TransportOptions) {
  const credentials = opts.credentials ?? 'include';

  function authHeaders(): Record<string, string> {
    const token = opts.getBearerToken?.();
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async function failure(res: Response): Promise<never> {
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

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    const form = body instanceof FormData ? body : null;
    try {
      // For multipart the browser must set content-type itself so the boundary
      // is included; setting it by hand produces an unparseable body.
      const headers: Record<string, string> = form
        ? authHeaders()
        : { 'content-type': 'application/json', ...authHeaders() };
      res = await fetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        // Carry the httpOnly session cookie; never touch localStorage.
        credentials,
        body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
    } catch {
      throw new LucielApiError({ code: 'network_error', message: 'Network request failed.' });
    }

    if (!res.ok) await failure(res);

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** GET a downloadable body (CSV/JSON export) without JSON-parsing it. */
  async function requestFile(path: string): Promise<TransportFile> {
    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}${path}`, {
        method: 'GET',
        headers: authHeaders(),
        credentials,
      });
    } catch {
      throw new LucielApiError({ code: 'network_error', message: 'Network request failed.' });
    }
    if (!res.ok) await failure(res);
    return {
      blob: await res.blob(),
      filename: filenameFrom(res.headers.get('content-disposition')),
    };
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    getFile: (path: string) => requestFile(path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    postForm: <T>(path: string, form: FormData) => request<T>('POST', path, form),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    del: <T>(path: string) => request<T>('DELETE', path),
  };
}

export type Transport = ReturnType<typeof createTransport>;
