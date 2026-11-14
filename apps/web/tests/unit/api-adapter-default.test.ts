import { afterEach, describe, expect, it, vi } from 'vitest';

// P2-15: the mock adapter is opt-in, never the production fallback. A Docker build
// without the NEXT_PUBLIC_API_ADAPTER build argument passes an EMPTY string to
// `next build`; with `??` that empty string reached createLucielClient, which treats
// anything but 'http' as the mock, so the image silently served invented data. An
// empty flag must count as unset.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadApiModule() {
  vi.resetModules();
  return import('@/lib/api');
}

describe('web API adapter default (P2-15)', () => {
  it('an empty flag in a production build selects HTTP, not the mock', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_ADAPTER', '');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test');
    const mod = await loadApiModule();
    expect(mod.isHttpAdapter).toBe(true);
  });

  it('an empty flag in a production build with no API origin fails instead of mocking', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_ADAPTER', '');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    await expect(loadApiModule()).rejects.toThrow(/baseUrl is required/);
  });

  it('an explicit mock flag still selects the mock', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_ADAPTER', 'mock');
    const mod = await loadApiModule();
    expect(mod.isHttpAdapter).toBe(false);
  });

  it('an empty flag outside production keeps the dev-server mock default', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_API_ADAPTER', '');
    const mod = await loadApiModule();
    expect(mod.isHttpAdapter).toBe(false);
  });
});
