import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The CSP keeps `upgrade-insecure-requests` for every https (or default) API origin and
 * leaves it out only for a plain-http API — the local Docker stack's
 * http://localhost:8000, which Safari would otherwise rewrite to https. The middleware reads
 * the API origin when the module loads, so each case imports it afresh.
 */
async function cspFor(apiOrigin: string | undefined): Promise<string> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', apiOrigin);
  const { middleware } = await import('@/middleware');
  const response = middleware(new NextRequest('http://localhost:3000/'));
  return response.headers.get('Content-Security-Policy') ?? '';
}

describe('CSP upgrade-insecure-requests', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is kept for the default API origin', async () => {
    const csp = await cspFor(undefined);
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://api.vantagemind.ai');
  });

  it('is kept for an https API origin', async () => {
    const csp = await cspFor('https://api.example.com');
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('is left out for a plain-http API origin (the local stack)', async () => {
    const csp = await cspFor('http://localhost:8000');
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(csp).toContain('http://localhost:8000');
  });
});
