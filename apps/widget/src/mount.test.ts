import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  mountWidget,
  WIDGET_HUMAN_TAKEOVER_NOTE,
  WIDGET_POLL_OPEN_MS,
  WIDGET_TEXT_MAX_CHARS,
} from './mount';
import {
  createWidgetClient,
  LucielApiError,
  type WidgetApiClient,
} from '@luciel/api-client/widget';

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

  it('keeps the session across a page navigation and restores the transcript (F049)', async () => {
    // 2026-09-05 audit: a visit that spans pages is ONE conversation. Leaving the
    // page ends nothing (the server closes by inactivity); the next page's widget
    // resumes the same session from this tab's storage and replays what was said.
    const SESSION = '00000000-0000-4000-8000-0000000000e1';
    sessionStorage.clear();
    await withBeaconSpy(async (sent) => {
      const shadow = await mountOpen(clientWithSession(SESSION));
      (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'hi';
      (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
      await flush();

      window.dispatchEvent(new Event('pagehide'));
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      try {
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        Reflect.deleteProperty(document, 'visibilityState');
      }
      expect(sent.filter((url) => url.includes(SESSION))).toHaveLength(0);
    });
    const remembered = JSON.parse(sessionStorage.getItem('luciel:session:vm_live_demo') ?? '{}');
    expect(remembered.sessionId).toBe(SESSION);

    // "Next page": a fresh mount against a client that serves the history.
    document.body.innerHTML = '';
    const sends: Array<{ sessionId?: string }> = [];
    const client: WidgetApiClient = {
      ...clientWithSession(SESSION),
      history: async () => [
        {
          messageId: '00000000-0000-4000-8000-0000000000a1',
          role: 'visitor',
          text: 'hi',
          at: '2026-07-30T00:00:00.000Z',
        },
        {
          messageId: '00000000-0000-4000-8000-0000000000a2',
          role: 'assistant',
          text: 'Hello again',
          at: '2026-07-30T00:00:01.000Z',
        },
      ],
      send: async (_key, req) => {
        sends.push(req);
        return {
          sessionId: SESSION,
          reply: {
            messageId: '00000000-0000-4000-8000-0000000000a3',
            role: 'assistant',
            text: 'still here',
            at: '2026-07-30T00:00:02.000Z',
          },
          renderState: 'active',
        };
      },
    };
    const shadow2 = await mountOpen(client);
    const transcript = (shadow2.querySelector('.vm-body') as HTMLElement).textContent ?? '';
    expect(transcript).toContain('You: hi');
    expect(transcript).toContain('Hello again');
    (shadow2.querySelector('.vm-input') as HTMLInputElement).value = 'one more';
    (shadow2.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();
    expect(sends[0]?.sessionId).toBe(SESSION); // the SAME conversation continues
  });

  it('shows the greeting ONCE after a page-to-page restore (the server transcript carries it)', async () => {
    // 2026-09-06 E2E walk: the static greeting plus the replayed greeting row
    // gave the visitor two identical openers on every page after the first.
    const SESSION = '00000000-0000-4000-8000-0000000000e3';
    sessionStorage.clear();
    sessionStorage.setItem(
      'luciel:session:vm_live_demo',
      JSON.stringify({ sessionId: SESSION, lastActivity: Date.now() }),
    );
    const OPENER = 'Hi — I am an AI assistant for Northside Auto.';
    const client: WidgetApiClient = {
      ...clientWithSession(SESSION),
      history: async () => [
        {
          messageId: '00000000-0000-4000-8000-0000000000b1',
          role: 'assistant',
          text: OPENER,
          at: '2026-07-30T00:00:00.000Z',
        },
        {
          messageId: '00000000-0000-4000-8000-0000000000b2',
          role: 'visitor',
          text: 'what are your hours?',
          at: '2026-07-30T00:00:01.000Z',
        },
        {
          messageId: '00000000-0000-4000-8000-0000000000b3',
          role: 'assistant',
          text: 'We open at nine.',
          at: '2026-07-30T00:00:02.000Z',
        },
      ],
    };
    const shadow = await mountOpen(client);
    const transcript = (shadow.querySelector('.vm-body') as HTMLElement).textContent ?? '';
    expect(transcript.split(OPENER).length - 1).toBe(1);
    expect(transcript).toContain('You: what are your hours?');
    expect(transcript).toContain('We open at nine.');
  });

  it('boots with the stored session id so a paused Luciel keeps serving a conversation in progress (E2E-9)', async () => {
    const SESSION = '00000000-0000-4000-8000-0000000000e4';
    sessionStorage.clear();
    sessionStorage.setItem(
      'luciel:session:vm_live_demo',
      JSON.stringify({ sessionId: SESSION, lastActivity: Date.now() }),
    );
    const bootstrapArgs: Array<[string, string | undefined]> = [];
    const base = clientWithSession(SESSION);
    const client: WidgetApiClient = {
      ...base,
      bootstrap: async (embedKey, sessionId) => {
        bootstrapArgs.push([embedKey, sessionId]);
        return base.bootstrap(embedKey);
      },
    };
    await mountOpen(client);
    expect(bootstrapArgs).toEqual([['vm_live_demo', SESSION]]);
  });

  it('a pause that reaches the panel says the message was not sent — never the takeover note (E2E-8)', async () => {
    sessionStorage.clear();
    const client: WidgetApiClient = {
      ...clientWithSession('00000000-0000-4000-8000-0000000000e5'),
      send: async () => ({
        sessionId: '00000000-0000-4000-8000-0000000000e5',
        reply: {
          messageId: '00000000-0000-4000-8000-0000000000c1',
          role: 'assistant',
          text: '',
          at: '2026-07-30T00:00:00.000Z',
        },
        renderState: 'paused',
      }),
    };
    const shadow = await mountOpen(client);
    (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'are you still there?';
    (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();
    const transcript = (shadow.querySelector('.vm-body') as HTMLElement).textContent ?? '';
    expect(transcript).toContain("your last message wasn't sent");
    expect(transcript).not.toContain('A member of the team has this conversation');
    expect((shadow.querySelector('.vm-input') as HTMLInputElement).disabled).toBe(true);
    expect((shadow.querySelector('.vm-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not resume a stored session older than the server inactivity window', async () => {
    const SESSION = '00000000-0000-4000-8000-0000000000e2';
    sessionStorage.setItem(
      'luciel:session:vm_live_demo',
      JSON.stringify({ sessionId: SESSION, lastActivity: Date.now() - 31 * 60 * 1000 }),
    );
    let historyCalls = 0;
    const client: WidgetApiClient = {
      ...clientWithSession(SESSION),
      history: async () => {
        historyCalls += 1;
        return [];
      },
    };
    await mountOpen(client);
    expect(historyCalls).toBe(0);
    expect(sessionStorage.getItem('luciel:session:vm_live_demo')).toBeNull();
  });

  it('the first poll of a new session does not append the server greeting row under the reply (E2E-10)', async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.clear();
      const SESSION = '00000000-0000-4000-8000-0000000000e6';
      const OPENER = 'Hi — I am an AI assistant for Northside Auto.';
      const base = clientWithSession(SESSION);
      const client: WidgetApiClient = {
        ...base,
        send: async (key, req) => {
          const res = await base.send(key, req);
          return { ...res, reply: { ...res.reply, text: 'Hello from Northside Auto' } };
        },
        history: async () => [
          {
            messageId: '00000000-0000-4000-8000-0000000000d0',
            role: 'assistant',
            text: OPENER,
            at: '2026-07-30T00:00:00.000Z',
          },
          {
            messageId: '00000000-0000-4000-8000-0000000000d1',
            role: 'visitor',
            text: 'what are your hours?',
            at: '2026-07-30T00:00:01.000Z',
          },
          {
            messageId: '00000000-0000-4000-8000-000000000001', // the reply the send returned
            role: 'assistant',
            text: 'Hello from Northside Auto',
            at: '2026-07-30T00:00:02.000Z',
          },
        ],
      };
      const shadow = await mountOpen(client);
      (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'what are your hours?';
      (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_OPEN_MS + 50);
      const bubbles = (needle: string) =>
        Array.from(shadow.querySelectorAll('.vm-msg')).filter((m) =>
          (m.textContent ?? '').includes(needle),
        ).length;
      expect(bubbles(OPENER)).toBe(1);
      expect(bubbles('what are your hours?')).toBe(1);
      expect(bubbles('Hello from Northside Auto')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls history while open and shows a reply a person sent from the dashboard (F063)', async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.clear();
      const SESSION = '00000000-0000-4000-8000-0000000000e3';
      let served: Array<{
        messageId: string;
        role: 'visitor' | 'assistant' | 'human';
        text: string;
        at: string;
      }> = [];
      const client: WidgetApiClient = {
        ...clientWithSession(SESSION),
        history: async () => served,
      };
      const shadow = await mountOpen(client);
      (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'can I talk to a person?';
      (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(0);

      // The owner takes over and answers from the dashboard: it lands in history.
      served = [
        {
          messageId: '00000000-0000-4000-8000-0000000000b1',
          role: 'visitor',
          text: 'can I talk to a person?',
          at: '2026-07-30T00:00:00.000Z',
        },
        {
          messageId: '00000000-0000-4000-8000-0000000000b2',
          role: 'human',
          text: 'Hi, this is Sam from the team — how can I help?',
          at: '2026-07-30T00:00:05.000Z',
        },
      ];
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_OPEN_MS + 50);
      // A person's words carry the team label, never the AI assistant's name (E2E-11).
      const samBubble = Array.from(shadow.querySelectorAll('.vm-msg')).find((m) =>
        (m.textContent ?? '').includes('this is Sam from the team'),
      );
      expect(samBubble?.textContent?.startsWith('Team: ')).toBe(true);
      expect(samBubble?.textContent).not.toContain('Luciel:');
      // Count transcript bubbles, not textContent: the screen-reader live region
      // deliberately repeats the latest reply as plain prose.
      const bubbles = (needle: string) =>
        Array.from(shadow.querySelectorAll('.vm-msg')).filter((m) =>
          (m.textContent ?? '').includes(needle),
        ).length;
      expect(bubbles('this is Sam from the team')).toBe(1);
      // The visitor's own turn is not rendered twice by the poll.
      expect(bubbles('can I talk to a person?')).toBe(1);
      // And the next poll does not repeat the reply.
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_OPEN_MS + 50);
      expect(bubbles('this is Sam from the team')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // --- Takeover honesty: an empty reply is a person, not a bot line (F145) -------

  it('shows the team-has-this note once on an empty reply and never a blank bubble', async () => {
    let calls = 0;
    const client: WidgetApiClient = {
      ...clientReplying(''),
      send: async () => {
        calls += 1;
        return {
          sessionId: '00000000-0000-4000-8000-000000000000',
          reply: {
            messageId: `00000000-0000-4000-8000-00000000000${calls}`,
            role: 'assistant',
            text: '',
            at: '2026-07-30T00:00:00.000Z',
          },
          renderState: 'active',
        };
      },
    };
    const shadow = await mountOpen(client);
    const sendOnce = async (text: string) => {
      (shadow.querySelector('.vm-input') as HTMLInputElement).value = text;
      (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
      await flush();
    };
    await sendOnce('can I talk to a person?');
    await sendOnce('hello?');

    const bubbles = Array.from(shadow.querySelectorAll('.vm-msg'));
    const notes = bubbles.filter((m) => m.classList.contains('vm-note'));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe(WIDGET_HUMAN_TAKEOVER_NOTE);
    // No blank "Luciel:" bubble, and no fabricated at-cap / passed-along line.
    const blank = bubbles.filter((m) => (m.textContent ?? '').trim() === 'Luciel:');
    expect(blank).toHaveLength(0);
    const transcript = (shadow.querySelector('.vm-body') as HTMLElement).textContent ?? '';
    expect(transcript).not.toMatch(/passed that along|capacity/i);
    // The composer stays open: the visitor can keep talking to the person.
    expect((shadow.querySelector('.vm-input') as HTMLInputElement).disabled).toBe(false);
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
      new LucielApiError({
        code: 'rate_limited',
        message: 'Too many requests.',
        retryAfterSeconds: 30,
      }),
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

  it("caps the composer at the server's 4000-character message limit", async () => {
    const shadow = await mountOpen(clientReplying('ok'));
    const input = shadow.querySelector('.vm-input') as HTMLInputElement;
    expect(WIDGET_TEXT_MAX_CHARS).toBe(4000);
    expect(input.maxLength).toBe(4000);
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
