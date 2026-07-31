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

/** A client whose reply the test resolves by hand, to observe the in-flight UI. */
const clientDeferred = () => {
  let release!: (text: string) => void;
  const client: WidgetApiClient = {
    bootstrap: async () => ({
      renderState: 'active',
      businessName: 'Northside Auto',
      assistantName: 'Luciel',
      openingMessage: 'Hi — I am an AI assistant for Northside Auto.',
      aiAssistantLabel: 'AI assistant',
      poweredByVantageMind: true,
    }),
    send: () =>
      new Promise((resolve) => {
        release = (text: string) =>
          resolve({
            sessionId: '00000000-0000-4000-8000-000000000000',
            reply: {
              messageId: '00000000-0000-4000-8000-000000000001',
              role: 'assistant',
              text,
              at: '2026-07-30T00:00:00.000Z',
            },
            renderState: 'active',
          });
      }),
    history: async () => [],
  };
  return { client, release: (text: string) => release(text) };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Mount and return the shadow root, with the panel opened via the launcher. */
const mountOpen = async (client: WidgetApiClient): Promise<ShadowRoot> => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await mountWidget({ embedKey: 'vm_live_demo', host, client });
  const shadow = (host.querySelector('[data-luciel-widget]') as HTMLElement).shadowRoot!;
  (shadow.querySelector('.vm-launcher') as HTMLButtonElement).click();
  return shadow;
};

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
    const shadow = await mountOpen(
      clientReplying('We are **open** until 5pm.\n\n- Oil change\n- Brakes'),
    );
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
    const shadow = await mountOpen(
      clientReplying('<img src=x onerror="alert(1)"> and <script>alert(2)</script>'),
    );
    (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'hi';
    (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();

    const bodyEl = shadow.querySelector('.vm-body') as HTMLElement;
    expect(bodyEl.querySelector('img')).toBeNull();
    expect(bodyEl.querySelector('script')).toBeNull();
    expect(bodyEl.textContent).toContain('<img src=x');
  });

  it('keeps visitor messages as plain text', async () => {
    const shadow = await mountOpen(clientReplying('ok'));
    (shadow.querySelector('.vm-input') as HTMLInputElement).value = '**not bold** <b>x</b>';
    (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();

    const bodyEl = shadow.querySelector('.vm-body') as HTMLElement;
    expect(bodyEl.textContent).toContain('**not bold** <b>x</b>');
    expect(bodyEl.querySelector('b')).toBeNull();
  });

  // --- P0-1: launcher, positioning and bounded growth -----------------------

  it('pins the shadow host bottom-right above host-page content', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({ embedKey: 'vm_live_demo', host, client: clientReplying('ok') });

    const shadowHost = host.querySelector('[data-luciel-widget]') as HTMLElement;
    expect(shadowHost.style.position).toBe('fixed');
    expect(shadowHost.style.bottom).toBe('16px');
    expect(shadowHost.style.right).toBe('16px');
    expect(shadowHost.style.zIndex).toBe('2147483000');
  });

  it('starts closed behind a launcher and toggles the panel with aria-expanded', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({ embedKey: 'vm_live_demo', host, client: clientReplying('ok') });

    const shadow = (host.querySelector('[data-luciel-widget]') as HTMLElement).shadowRoot!;
    const root = shadow.querySelector('.vm-root') as HTMLElement;
    const launcher = shadow.querySelector('.vm-launcher') as HTMLButtonElement;

    expect(launcher).not.toBeNull();
    expect(root.getAttribute('data-open')).toBe('false');
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(launcher.getAttribute('aria-controls')).toBe(
      (shadow.querySelector('.vm-panel') as HTMLElement).id,
    );

    launcher.click();
    expect(root.getAttribute('data-open')).toBe('true');
    expect(launcher.getAttribute('aria-expanded')).toBe('true');

    launcher.click();
    expect(root.getAttribute('data-open')).toBe('false');
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes from the in-panel close button', async () => {
    const shadow = await mountOpen(clientReplying('ok'));
    const root = shadow.querySelector('.vm-root') as HTMLElement;
    expect(root.getAttribute('data-open')).toBe('true');

    (shadow.querySelector('.vm-close') as HTMLButtonElement).click();
    expect(root.getAttribute('data-open')).toBe('false');
  });

  it('keeps the AI-disclosure label in the header when the panel is open', async () => {
    const shadow = await mountOpen(clientReplying('ok'));
    const header = shadow.querySelector('.vm-header') as HTMLElement;
    const label = header.querySelector('.vm-ai-label') as HTMLElement;

    expect(label.textContent).toBe('AI assistant');
    // It must precede the close button so it is never the element pushed out.
    expect(label.compareDocumentPosition(shadow.querySelector('.vm-close')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('bounds the transcript height so a long chat cannot grow the host page', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({ embedKey: 'vm_live_demo', host, client: clientReplying('ok') });

    const css = (
      (host.querySelector('[data-luciel-widget]') as HTMLElement).shadowRoot!.querySelector(
        'style',
      ) as HTMLStyleElement
    ).textContent!;
    expect(css).toContain('max-height: 60vh');
    expect(css).toContain('overflow-y: auto');
    // Full-bleed on phones rather than a card wider than the screen.
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('inset: 0');
  });

  it('renders nothing at all — not even a launcher — when paused', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({
      embedKey: 'vm_live_demo',
      host,
      client: createWidgetClient({ adapter: 'mock', mock: { renderState: 'paused' } }),
    });

    const shadowHost = host.querySelector('[data-luciel-widget]') as HTMLElement;
    expect(shadowHost.shadowRoot!.querySelector('.vm-launcher')).toBeNull();
    expect(shadowHost.style.position).toBe('');
  });

  // --- P1-20: typing indicator and double-send guard ------------------------

  it('shows a typing indicator and locks the input while a reply is in flight', async () => {
    const { client, release } = clientDeferred();
    const shadow = await mountOpen(client);
    const input = shadow.querySelector('.vm-input') as HTMLInputElement;
    const send = shadow.querySelector('.vm-send') as HTMLButtonElement;

    input.value = 'when do you close?';
    send.click();
    await flush();

    expect(shadow.querySelector('[data-vm-typing]')).not.toBeNull();
    expect(input.disabled).toBe(true);
    expect(send.disabled).toBe(true);

    release('We close at 5pm.');
    await flush();

    expect(shadow.querySelector('[data-vm-typing]')).toBeNull();
    expect(input.disabled).toBe(false);
    expect(send.disabled).toBe(false);
    expect((shadow.querySelector('.vm-body') as HTMLElement).textContent).toContain(
      'We close at 5pm.',
    );
  });

  it('ignores a second Enter while the first message is still in flight', async () => {
    const { client, release } = clientDeferred();
    const shadow = await mountOpen(client);
    const input = shadow.querySelector('.vm-input') as HTMLInputElement;

    input.value = 'hello?';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    // Impatient visitor hits Enter again on the slow reply.
    input.value = 'hello?';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    release('Hi!');
    await flush();

    const visitorLines = (shadow.querySelector('.vm-body') as HTMLElement).textContent ?? '';
    expect(visitorLines.match(/hello\?/g)).toHaveLength(1);
  });
});
