import { describe, it, expect, beforeEach } from 'vitest';
import { mountWidget } from './mount';
import { createWidgetClient } from '@luciel/api-client/widget';

/**
 * Scaffold-level widget behavior checks (Arch §3.4.16/§3.4.17/§3.6.2). These
 * inject a mock client so no network is needed.
 */
describe('widget mount', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts into a shadow DOM with the AI-identity label and powered-by chrome', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({
      embedKey: 'vm_live_demo',
      host,
      client: createWidgetClient({ adapter: 'mock' }),
    });

    const shadowHost = host.querySelector('[data-luciel-widget]') as HTMLElement;
    expect(shadowHost.shadowRoot).toBeTruthy();
    const text = shadowHost.shadowRoot!.textContent ?? '';
    expect(text.toLowerCase()).toContain('ai assistant');
    expect(text).toContain('Powered by VantageMind');
  });

  it('renders an empty <div> when paused — no error text (Arch §3.6.2)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({
      embedKey: 'vm_live_demo',
      host,
      client: createWidgetClient({ adapter: 'mock', mock: { renderState: 'paused' } }),
    });

    const shadowHost = host.querySelector('[data-luciel-widget]') as HTMLElement;
    const text = (shadowHost.shadowRoot!.textContent ?? '').trim();
    expect(text).toBe('');
    expect(text.toLowerCase()).not.toContain('offline');
  });
});
