import { describe, it, expect, beforeEach } from 'vitest';
import { mountWidget } from './mount';
import { createWidgetClient, LucielApiError, type WidgetApiClient } from '@luciel/api-client/widget';

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

  it('fails closed on a renderState this build does not recognize — no active-looking panel', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    // An injected client bypasses the HTTP layer's schema validation, so the
    // mount itself must refuse an unknown directive rather than render a panel
    // whose sends would go nowhere (a dead-but-visible widget on a customer
    // site). Simulates a future/renamed state reaching an old bundle.
    await mountWidget({
      embedKey: 'vm_live_demo',
      host,
      client: createWidgetClient({
        adapter: 'mock',
        mock: { renderState: 'revoked' as unknown as 'paused' },
      }),
    });

    const shadowHost = host.querySelector('[data-luciel-widget]') as HTMLElement;
    expect(shadowHost.shadowRoot!.querySelector('.vm-launcher')).toBeNull();
    expect((shadowHost.shadowRoot!.textContent ?? '').trim()).toBe('');
  });

  it('at_cap still sends — the visitor gets the graceful reply, never a silent void (Arch §3.4.1b)', async () => {
    // A visitor who opens the widget while the free allowance is exhausted must
    // be able to leave their message: the backend captures it + escalates and
    // answers with the canned no-LLM reply. Blocking the send client-side made
    // them type into nothing.
    const shadow = await mountOpen(
      createWidgetClient({ adapter: 'mock', mock: { renderState: 'at_cap' } }),
    );
    const input = shadow.querySelector('.vm-input') as HTMLInputElement;
    const send = shadow.querySelector('.vm-send') as HTMLButtonElement;
    input.value = 'Are you open Saturday?';
    send.click();
    await new Promise((r) => setTimeout(r, 0));

    const text = shadow.textContent ?? '';
    expect(text).toContain("I'm at capacity right now");
    // After the graceful reply the input closes — at-cap is one honest
    // exchange, not an open loop.
    expect(input.disabled).toBe(true);
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

  // --- §3.4.8: explicit end-of-session signal -------------------------------

  /** Stub client issuing a caller-chosen session id, so beacon tests can tell
   *  their own signals apart from earlier mounts still listening on the shared
   *  jsdom window. */
  const clientWithSession = (sessionId: string): WidgetApiClient => ({
    bootstrap: async () => ({
      renderState: 'active',
      businessName: 'Northside Auto',
      assistantName: 'Luciel',
      openingMessage: 'Hi — I am an AI assistant for Northside Auto.',
      aiAssistantLabel: 'AI assistant',
      poweredByVantageMind: true,
    }),
    send: async () => ({
      sessionId,
      reply: {
        messageId: '00000000-0000-4000-8000-000000000001',
        role: 'assistant',
        text: 'ok',
        at: '2026-07-30T00:00:00.000Z',
      },
      renderState: 'active',
    }),
    history: async () => [],
  });

  /** Installs a sendBeacon spy for the duration of `run`, then restores. */
  const withBeaconSpy = async (run: (sent: string[]) => Promise<void>) => {
    const sent: string[] = [];
    const nav = navigator as { sendBeacon?: (url: string) => boolean };
    const original = nav.sendBeacon;
    nav.sendBeacon = (url) => {
      sent.push(url);
      return true;
    };
    try {
      await run(sent);
    } finally {
      nav.sendBeacon = original;
    }
  };

  it('fires the end-of-session beacon once on pagehide (§3.4.8)', async () => {
    const SESSION = '00000000-0000-4000-8000-0000000000e1';
    await withBeaconSpy(async (sent) => {
      const mine = () => sent.filter((url) => url.includes(SESSION));
      const shadow = await mountOpen(clientWithSession(SESSION));

      // No session yet — leaving before the first message signals nothing.
      window.dispatchEvent(new Event('pagehide'));
      expect(mine()).toHaveLength(0);

      (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'hi';
      (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
      await flush();

      window.dispatchEvent(new Event('pagehide'));
      expect(mine()).toEqual([
        `https://api.vantagemind.ai/api/v1/chat-widget/sessions/${SESSION}/end?embedKey=vm_live_demo`,
      ]);

      // Once per session: the endpoint is idempotent, but a second hide on the
      // same session still sends nothing new.
      window.dispatchEvent(new Event('pagehide'));
      expect(mine()).toHaveLength(1);
    });
  });

  it('falls back to visibilitychange→hidden where pagehide never fires', async () => {
    const SESSION = '00000000-0000-4000-8000-0000000000e2';
    await withBeaconSpy(async (sent) => {
      const mine = () => sent.filter((url) => url.includes(SESSION));
      const shadow = await mountOpen(clientWithSession(SESSION));
      (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'hi';
      (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
      await flush();

      // Still visible → not an end signal.
      document.dispatchEvent(new Event('visibilitychange'));
      expect(mine()).toHaveLength(0);

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      try {
        document.dispatchEvent(new Event('visibilitychange'));
        expect(mine()).toHaveLength(1);
      } finally {
        Reflect.deleteProperty(document, 'visibilityState');
      }
    });
  });

  // --- Send-failure honesty: rate limit vs. everything else -----------------

  /** Stub client whose send always rejects with the given error. */
  const clientFailing = (error: unknown): WidgetApiClient => ({
    bootstrap: async () => ({
      renderState: 'active',
      businessName: 'Northside Auto',
      assistantName: 'Luciel',
      openingMessage: 'Hi — I am an AI assistant for Northside Auto.',
      aiAssistantLabel: 'AI assistant',
      poweredByVantageMind: true,
    }),
    send: async () => {
      throw error;
    },
    history: async () => [],
  });

  /** Mounts against a failing client, sends once, and returns the transcript text. */
  const sendAndReadTranscript = async (error: unknown): Promise<string> => {
    const shadow = await mountOpen(clientFailing(error));
    (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'hi';
    (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();
    return (shadow.querySelector('.vm-body') as HTMLElement).textContent ?? '';
  };

  it('a rate limit reads as "one moment", with the server\'s wait when it sent one', async () => {
    const text = await sendAndReadTranscript(
      new LucielApiError({ code: 'rate_limited', message: 'Too many requests.', retryAfterSeconds: 30 }),
    );
    expect(text).toContain('One moment — please try again in 30 seconds.');
    expect(text).not.toContain('something went wrong');

    // Without a server-sent wait, it stays gentle but unspecific.
    document.body.innerHTML = '';
    const noWait = await sendAndReadTranscript(
      new LucielApiError({ code: 'rate_limited', message: 'Too many requests.' }),
    );
    expect(noWait).toContain('One moment — please try again in a few seconds.');
  });

  it('every other failure keeps the generic copy', async () => {
    const text = await sendAndReadTranscript(new Error('network down'));
    expect(text).toContain('Sorry — something went wrong. Please try again.');
    expect(text).not.toContain('One moment');
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
