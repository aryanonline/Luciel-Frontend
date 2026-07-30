import { describe, it, expect, beforeEach } from 'vitest';
import { mountWidget } from './mount';
import { createWidgetClient, type WidgetApiClient } from '@luciel/api-client/widget';

/** Stub client so a reply with markdown in it can be asserted on. */
const clientReplying = (replyText: string): WidgetApiClient => ({
  bootstrap: async () => ({
    renderState: 'active',
    businessName: 'Northside Auto',
    assistantName: 'Luciel',
    openingMessage: 'Hi — I am an AI assistant for Northside Auto.',
    aiAssistantLabel: 'AI assistant',
    poweredByVantageMind: true,
  }),
  send: async () => ({
    sessionId: '00000000-0000-4000-8000-000000000000',
    reply: {
      messageId: '00000000-0000-4000-8000-000000000001',
      role: 'assistant',
      text: replyText,
      at: '2026-07-30T00:00:00.000Z',
    },
    renderState: 'active',
  }),
  history: async () => [],
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it('formats an assistant reply as markdown and keeps the live region plain prose', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({
      embedKey: 'vm_live_demo',
      host,
      client: clientReplying('We are **open** until 5pm.\n\n- Oil change\n- Brakes'),
    });

    const shadow = (host.querySelector('[data-luciel-widget]') as HTMLElement).shadowRoot!;
    (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'when do you close?';
    (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();

    const bodyEl = shadow.querySelector('.vm-body') as HTMLElement;
    expect(bodyEl.innerHTML).toContain('<strong>open</strong>');
    expect(bodyEl.querySelectorAll('li')).toHaveLength(2);
    // The visitor sees no raw markers.
    expect(bodyEl.textContent).not.toContain('**');

    const live = shadow.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toBe('We are open until 5pm.\nOil change\nBrakes');
  });

  it('never renders markup from the reply text (XSS guard)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({
      embedKey: 'vm_live_demo',
      host,
      client: clientReplying('<img src=x onerror="alert(1)"> and <script>alert(2)</script>'),
    });

    const shadow = (host.querySelector('[data-luciel-widget]') as HTMLElement).shadowRoot!;
    (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'hi';
    (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();

    const bodyEl = shadow.querySelector('.vm-body') as HTMLElement;
    expect(bodyEl.querySelector('img')).toBeNull();
    expect(bodyEl.querySelector('script')).toBeNull();
    expect(bodyEl.textContent).toContain('<img src=x');
  });

  it('keeps visitor messages as plain text', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({
      embedKey: 'vm_live_demo',
      host,
      client: clientReplying('ok'),
    });

    const shadow = (host.querySelector('[data-luciel-widget]') as HTMLElement).shadowRoot!;
    (shadow.querySelector('.vm-input') as HTMLInputElement).value = '**not bold** <b>x</b>';
    (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();

    const bodyEl = shadow.querySelector('.vm-body') as HTMLElement;
    expect(bodyEl.textContent).toContain('**not bold** <b>x</b>');
    expect(bodyEl.querySelector('b')).toBeNull();
  });
});
