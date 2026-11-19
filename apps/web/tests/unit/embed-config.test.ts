import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WIDGET_SCRIPT_URL,
  demoSiteUrlFor,
  snippetFor,
  widgetScriptUrl,
} from '@/lib/embed-config';

/**
 * The embed snippet and the local demo-site link (Luciel-Backend's docker-compose.yml
 * builds the dashboard with NEXT_PUBLIC_WIDGET_SCRIPT_URL and NEXT_PUBLIC_DEMO_SITE_URL).
 * A production build passes neither, and an unpassed Docker ARG arrives as ''.
 */
describe('embed config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('points the snippet at the production embed host by default', () => {
    vi.stubEnv('NEXT_PUBLIC_WIDGET_SCRIPT_URL', undefined);
    expect(widgetScriptUrl()).toBe(DEFAULT_WIDGET_SCRIPT_URL);
    expect(snippetFor('vm_live_abc123def456')).toBe(
      '<script src="https://embed.vantagemind.ai/v1/luciel.js" data-key="vm_live_abc123def456"></script>',
    );
  });

  it('treats an empty build argument as unset, never an empty src', () => {
    vi.stubEnv('NEXT_PUBLIC_WIDGET_SCRIPT_URL', '');
    expect(snippetFor('vm_live_abc123def456')).toContain(`src="${DEFAULT_WIDGET_SCRIPT_URL}"`);
  });

  it('uses the local stack script URL when the build names one', () => {
    vi.stubEnv('NEXT_PUBLIC_WIDGET_SCRIPT_URL', 'http://localhost:8080/v1/luciel.js');
    expect(snippetFor('vm_live_abc123def456')).toBe(
      '<script src="http://localhost:8080/v1/luciel.js" data-key="vm_live_abc123def456"></script>',
    );
  });

  it('offers no demo-site link unless the build names a demo site', () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_SITE_URL', undefined);
    expect(demoSiteUrlFor('vm_live_abc123def456')).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_DEMO_SITE_URL', '');
    expect(demoSiteUrlFor('vm_live_abc123def456')).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_DEMO_SITE_URL', 'not a url');
    expect(demoSiteUrlFor('vm_live_abc123def456')).toBeNull();
  });

  it('carries the public embed key to the demo site', () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_SITE_URL', 'http://localhost:8080');
    expect(demoSiteUrlFor('vm_live_abc123def456')).toBe(
      'http://localhost:8080/?key=vm_live_abc123def456',
    );
  });
});
