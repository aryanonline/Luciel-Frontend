import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  mountWidget,
  WIDGET_END_FAILED_NOTE,
  WIDGET_ENDED_NOTE,
  WIDGET_HUMAN_TAKEOVER_NOTE,
  WIDGET_OFFSITE_NOTE,
  WIDGET_PAUSED_NOTE,
  WIDGET_POLL_HIDDEN_MS,
  WIDGET_POLL_OPEN_MS,
  WIDGET_TEXT_MAX_CHARS,
} from './mount';
import {
  createWidgetClient,
  LucielApiError,
  type WidgetApiClient,
  type WidgetRenderState,
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
  endSession: async () => {},
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
    endSession: async () => {},
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
    endSession: async () => {},
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
    endSession: async () => {},
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

  it('renders nothing when the server refuses this page origin at bootstrap', async () => {
    // Round 6 WP-I: a page outside the owner's allowed list gets no chrome at all —
    // a word in the console for the site's developer, never a broken chat.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refusing: WidgetApiClient = {
      ...clientReplying('x'),
      bootstrap: async () => {
        throw new LucielApiError({
          code: 'unauthorized',
          message: "This chat isn't available on this website.",
        });
      },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountWidget({ embedKey: 'vm_live_test', host, client: refusing });
    expect(host.querySelector('[data-luciel-widget]')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not on the allowed list'));
    warn.mockRestore();
  });

  it('says the chat is unavailable here when a send is refused off-site, and stops', async () => {
    const refusing: WidgetApiClient = {
      ...clientReplying('x'),
      send: async () => {
        throw new LucielApiError({
          code: 'unauthorized',
          message: "This chat isn't available on this website.",
        });
      },
    };
    const shadow = await mountOpen(refusing);
    const input = shadow.querySelector('.vm-input') as HTMLInputElement;
    input.value = 'hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    await flush();
    expect(shadow.querySelector('.vm-body')?.textContent).toContain(WIDGET_OFFSITE_NOTE);
    expect(input.disabled).toBe(true);
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

  // --- Round 7 D9: the Website chat channel can be switched off ---------------

  /** A client whose successive bootstraps walk through `states` (the last one
   *  repeats), counting calls so a test can see the off-state poll happen. */
  const clientSwitching = (states: WidgetRenderState[]) => {
    const calls: Array<string | undefined> = [];
    const client: WidgetApiClient = {
      ...clientReplying('ok'),
      bootstrap: async (_key, sessionId) => {
        calls.push(sessionId);
        const state = states[Math.min(calls.length, states.length) - 1] ?? 'active';
        return {
          renderState: state,
          businessName: 'Northside Auto',
          assistantName: 'Luciel',
          openingMessage:
            state === 'channel_off' || state === 'paused'
              ? ''
              : 'Hi — I am an AI assistant for Northside Auto.',
          aiAssistantLabel: 'AI assistant',
          poweredByVantageMind: true,
        };
      },
    };
    return { client, calls };
  };

  it('renders nothing when the Website chat channel is off — no launcher, no copy, no chrome (D9)', async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.clear();
      const { client } = clientSwitching(['channel_off']);
      const host = document.createElement('div');
      document.body.appendChild(host);
      await mountWidget({ embedKey: 'vm_live_demo', host, client });

      const shadowHost = host.querySelector('[data-luciel-widget]') as HTMLElement;
      expect(shadowHost.shadowRoot!.querySelector('.vm-launcher')).toBeNull();
      expect((shadowHost.shadowRoot!.textContent ?? '').trim()).toBe('');
      expect((shadowHost.shadowRoot!.textContent ?? '').toLowerCase()).not.toContain('offline');
      // Exactly like paused today: not even pinned — no floating chrome at all.
      expect(shadowHost.style.position).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls the bootstrap while the channel is off and shows the launcher once it is on again — no reload (D9)', async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.clear();
      const { client, calls } = clientSwitching(['channel_off', 'channel_off', 'active']);
      const host = document.createElement('div');
      document.body.appendChild(host);
      await mountWidget({ embedKey: 'vm_live_demo', host, client });
      const shadow = (host.querySelector('[data-luciel-widget]') as HTMLElement).shadowRoot!;
      expect(calls).toHaveLength(1);

      // Still off after one closed-panel interval: still nothing, still polling.
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_HIDDEN_MS + 50);
      expect(calls).toHaveLength(2);
      expect(shadow.querySelector('.vm-launcher')).toBeNull();

      // The owner switches Website chat back on: the next poll mounts the launcher
      // into the page the visitor is already on.
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_HIDDEN_MS + 50);
      expect(calls).toHaveLength(3);
      const launcher = shadow.querySelector('.vm-launcher') as HTMLButtonElement;
      expect(launcher).not.toBeNull();
      expect((host.querySelector('[data-luciel-widget]') as HTMLElement).style.position).toBe(
        'fixed',
      );
      // The empty off-render is gone — the shadow root holds the styles + panel only.
      const emptyDivs = Array.from(shadow.children).filter(
        (el) => el.tagName === 'DIV' && el.childNodes.length === 0,
      );
      expect(emptyDivs).toHaveLength(0);

      // Once mounted, the bootstrap is not polled any more (no session → no history
      // poll either): nothing keeps hammering the data plane.
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_HIDDEN_MS * 2);
      expect(calls).toHaveLength(3);

      // And the mounted panel is a real one: opening it shows the disclosure.
      launcher.click();
      expect((shadow.querySelector('.vm-ai-label') as HTMLElement).textContent).toBe(
        'AI assistant',
      );
      expect(shadow.querySelector('.vm-body')?.textContent).toContain(
        'Hi — I am an AI assistant for Northside Auto.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("the off-state poll stops once the server says paused (today's no-poll state) (D9)", async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.clear();
      const { client, calls } = clientSwitching(['channel_off', 'paused']);
      const host = document.createElement('div');
      document.body.appendChild(host);
      await mountWidget({ embedKey: 'vm_live_demo', host, client });
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_HIDDEN_MS + 50);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_HIDDEN_MS * 3);
      expect(calls).toHaveLength(2);
      const shadow = (host.querySelector('[data-luciel-widget]') as HTMLElement).shadowRoot!;
      expect(shadow.querySelector('.vm-launcher')).toBeNull();
      expect((shadow.textContent ?? '').trim()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a switched-off channel that reaches an open panel says the message was not sent and closes the composer (D9)', async () => {
    // The visitor's session expired, the owner switched Website chat off, and the
    // visitor types again: the server holds the message and answers channel_off.
    // Same honest line as a pause — never the takeover note.
    sessionStorage.clear();
    const client: WidgetApiClient = {
      ...clientReplying('x'),
      send: async () => ({
        sessionId: '00000000-0000-4000-8000-0000000000e7',
        reply: {
          messageId: '00000000-0000-4000-8000-0000000000c2',
          role: 'assistant',
          text: '',
          at: '2026-07-30T00:00:00.000Z',
        },
        renderState: 'channel_off',
      }),
    };
    const shadow = await mountOpen(client);
    (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'anyone there?';
    (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();
    const transcript = (shadow.querySelector('.vm-body') as HTMLElement).textContent ?? '';
    expect(transcript).toContain(WIDGET_PAUSED_NOTE);
    expect(transcript).not.toContain(WIDGET_HUMAN_TAKEOVER_NOTE);
    // No blank bubble for the empty reply.
    const blank = Array.from(shadow.querySelectorAll('.vm-msg')).filter(
      (m) => (m.textContent ?? '').trim() === 'Luciel:',
    );
    expect(blank).toHaveLength(0);
    expect((shadow.querySelector('.vm-input') as HTMLInputElement).disabled).toBe(true);
    expect((shadow.querySelector('.vm-send') as HTMLButtonElement).disabled).toBe(true);
    // The disclosure is still in the header of the open panel.
    expect((shadow.querySelector('.vm-ai-label') as HTMLElement).textContent).toBe('AI assistant');
  });

  // --- Arch §3.4.8b: the explicit end is the visitor's End chat, never a page leave --

  /** A session-issuing client that records every end signal (and can refuse them). */
  const clientEnding = (sessionId: string, opts: { fail?: boolean } = {}) => {
    const ends: Array<[string, string]> = [];
    const sends: Array<{ sessionId?: string }> = [];
    const base = clientWithSession(sessionId);
    const client: WidgetApiClient = {
      ...base,
      send: async (key, req) => {
        sends.push(req);
        return base.send(key, req);
      },
      endSession: async (key, id) => {
        ends.push([key, id]);
        if (opts.fail) throw new LucielApiError({ code: 'network_error', message: 'offline' });
      },
    };
    return { client, ends, sends };
  };

  const sendOnce = async (shadow: ShadowRoot, text: string) => {
    (shadow.querySelector('.vm-input') as HTMLInputElement).value = text;
    (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
    await flush();
  };

  it('a page leave, a tab hide, or closing the panel sends NO end signal — not a beacon, not a call (F049)', async () => {
    const SESSION = '00000000-0000-4000-8000-0000000000f1';
    sessionStorage.clear();
    const { client, ends } = clientEnding(SESSION);
    await withBeaconSpy(async (sent) => {
      const shadow = await mountOpen(client);
      await sendOnce(shadow, 'hi');

      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('beforeunload'));
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      try {
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        Reflect.deleteProperty(document, 'visibilityState');
      }
      // Closing the panel — by its button and by Escape — is not an end either.
      (shadow.querySelector('.vm-close') as HTMLButtonElement).click();
      (shadow.querySelector('.vm-launcher') as HTMLButtonElement).click();
      (shadow.querySelector('.vm-root') as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await flush();

      expect(ends).toHaveLength(0);
      expect(sent.filter((url) => url.includes(SESSION))).toHaveLength(0);
    });
    // The conversation is still this tab's to come back to.
    const remembered = JSON.parse(sessionStorage.getItem('luciel:session:vm_live_demo') ?? '{}');
    expect(remembered.sessionId).toBe(SESSION);
  });

  it('End chat asks first; only the confirmed action sends exactly one end signal, and never a beacon', async () => {
    const SESSION = '00000000-0000-4000-8000-0000000000f2';
    sessionStorage.clear();
    const { client, ends, sends } = clientEnding(SESSION);
    await withBeaconSpy(async (sent) => {
      const shadow = await mountOpen(client);
      const endButton = shadow.querySelector('.vm-end') as HTMLButtonElement;
      const confirm = shadow.querySelector('.vm-confirm') as HTMLElement;
      // Nothing to end yet: the control is not offered.
      expect(endButton.hidden).toBe(true);
      await sendOnce(shadow, 'hi');
      expect(endButton.hidden).toBe(false);
      expect(confirm.hidden).toBe(true);

      // Pressing End chat only ASKS.
      endButton.click();
      expect(confirm.hidden).toBe(false);
      expect(confirm.textContent).toContain('End this chat?');
      expect(ends).toHaveLength(0);

      // Keep chatting: nothing sent, control back.
      (shadow.querySelector('.vm-confirm-keep') as HTMLButtonElement).click();
      expect(confirm.hidden).toBe(true);
      expect(endButton.hidden).toBe(false);
      expect(ends).toHaveLength(0);

      // Escape with the strip up answers it, not the panel.
      endButton.click();
      (shadow.querySelector('.vm-root') as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      expect(confirm.hidden).toBe(true);
      expect((shadow.querySelector('.vm-root') as HTMLElement).getAttribute('data-open')).toBe(
        'true',
      );
      expect(ends).toHaveLength(0);

      // Confirm — twice, impatiently. Exactly ONE end signal, for THIS session.
      endButton.click();
      const confirmEnd = shadow.querySelector('.vm-confirm-end') as HTMLButtonElement;
      confirmEnd.click();
      expect(confirmEnd.disabled).toBe(true); // pending state while it settles
      expect(confirmEnd.textContent).toBe('Ending…');
      confirmEnd.click();
      await flush();
      expect(ends).toEqual([['vm_live_demo', SESSION]]);
      expect(sent).toHaveLength(0);

      // Afterwards: the panel is still open, the disclosure still in its header,
      // the visitor told plainly, the control gone with the session.
      const root = shadow.querySelector('.vm-root') as HTMLElement;
      expect(root.getAttribute('data-open')).toBe('true');
      expect((shadow.querySelector('.vm-ai-label') as HTMLElement).textContent).toBe(
        'AI assistant',
      );
      expect(shadow.querySelector('.vm-body')?.textContent).toContain(WIDGET_ENDED_NOTE);
      expect(confirm.hidden).toBe(true);
      expect(endButton.hidden).toBe(true);
      expect(sessionStorage.getItem('luciel:session:vm_live_demo')).toBeNull();
      expect((shadow.querySelector('.vm-input') as HTMLInputElement).disabled).toBe(false);

      // The next message opens a NEW conversation: no session id travels with it.
      await sendOnce(shadow, 'one more thing');
      expect(sends.map((s) => s.sessionId)).toEqual([undefined, undefined]);
      expect(endButton.hidden).toBe(false); // and that one can be ended in turn
      expect(ends).toHaveLength(1);
    });
  });

  it('a restored session offers End chat straight away', async () => {
    const SESSION = '00000000-0000-4000-8000-0000000000f3';
    sessionStorage.clear();
    sessionStorage.setItem(
      'luciel:session:vm_live_demo',
      JSON.stringify({ sessionId: SESSION, lastActivity: Date.now() }),
    );
    const { client } = clientEnding(SESSION);
    const shadow = await mountOpen(client);
    expect((shadow.querySelector('.vm-end') as HTMLButtonElement).hidden).toBe(false);
  });

  it('a failed end keeps the conversation, says so, and lets the visitor try again', async () => {
    const SESSION = '00000000-0000-4000-8000-0000000000f4';
    sessionStorage.clear();
    const { client, ends, sends } = clientEnding(SESSION, { fail: true });
    const shadow = await mountOpen(client);
    await sendOnce(shadow, 'hi');
    (shadow.querySelector('.vm-end') as HTMLButtonElement).click();
    (shadow.querySelector('.vm-confirm-end') as HTMLButtonElement).click();
    await flush();

    expect(ends).toHaveLength(1);
    const transcript = shadow.querySelector('.vm-body')?.textContent ?? '';
    expect(transcript).toContain(WIDGET_END_FAILED_NOTE);
    expect(transcript).not.toContain(WIDGET_ENDED_NOTE);
    // Session kept, control back, confirm strip down and re-enabled.
    const remembered = JSON.parse(sessionStorage.getItem('luciel:session:vm_live_demo') ?? '{}');
    expect(remembered.sessionId).toBe(SESSION);
    expect((shadow.querySelector('.vm-end') as HTMLButtonElement).hidden).toBe(false);
    expect((shadow.querySelector('.vm-confirm') as HTMLElement).hidden).toBe(true);
    expect((shadow.querySelector('.vm-confirm-end') as HTMLButtonElement).disabled).toBe(false);
    expect((shadow.querySelector('.vm-confirm-end') as HTMLButtonElement).textContent).toBe(
      'End chat',
    );
    // The SAME conversation continues.
    await sendOnce(shadow, 'still here?');
    expect(sends[1]?.sessionId).toBe(SESSION);
  });

  it('a confirmed end stops the history poll', async () => {
    vi.useFakeTimers();
    try {
      const SESSION = '00000000-0000-4000-8000-0000000000f5';
      sessionStorage.clear();
      let historyCalls = 0;
      const { client } = clientEnding(SESSION);
      const polling: WidgetApiClient = {
        ...client,
        history: async () => {
          historyCalls += 1;
          return [];
        },
      };
      const shadow = await mountOpen(polling);
      (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'hi';
      (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_OPEN_MS + 50);
      expect(historyCalls).toBe(1);

      (shadow.querySelector('.vm-end') as HTMLButtonElement).click();
      (shadow.querySelector('.vm-confirm-end') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_OPEN_MS * 3);
      expect(historyCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // --- Human takeover copy: "Team:", the note, and never a blank bubble ----------

  /** The rows a history poll might serve for a session a person has taken over.
   *  The server persists a takeover reply BEFORE it tries to deliver it and the
   *  widget poll reads persisted rows only (chat_widget.get_history); on the widget
   *  channel the row is 'queued' for the next poll. The one way a reply could
   *  still reach the visitor as nothing is an empty text — this guards that. */
  const takeoverRows = (visitorText: string) => [
    {
      messageId: '00000000-0000-4000-8000-0000000000b1',
      role: 'visitor' as const,
      text: visitorText,
      at: '2026-07-30T00:00:00.000Z',
    },
    {
      // A reply with nothing in it must never render as "Team:" and a blank.
      messageId: '00000000-0000-4000-8000-0000000000b2',
      role: 'human' as const,
      text: '   ',
      at: '2026-07-30T00:00:05.000Z',
    },
    {
      messageId: '00000000-0000-4000-8000-0000000000b3',
      role: 'human' as const,
      text: 'Hi, this is Sam — happy to help.',
      at: '2026-07-30T00:00:06.000Z',
    },
  ];

  const teamBubbles = (shadow: ShadowRoot) =>
    Array.from(shadow.querySelectorAll('.vm-msg')).filter((m) =>
      (m.textContent ?? '').startsWith('Team:'),
    );

  it('a human turn renders as "Team:" and an empty-text human row never reaches the visitor as a blank bubble (poll)', async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.clear();
      const SESSION = '00000000-0000-4000-8000-0000000000f6';
      let served: ReturnType<typeof takeoverRows> = [];
      const base = clientWithSession(SESSION);
      const client: WidgetApiClient = {
        ...base,
        // The takeover: the send comes back EMPTY (a person holds it).
        send: async (key, req) => {
          const res = await base.send(key, req);
          return { ...res, reply: { ...res.reply, text: '' } };
        },
        history: async () => served,
      };
      const shadow = await mountOpen(client);
      (shadow.querySelector('.vm-input') as HTMLInputElement).value = 'can I talk to a person?';
      (shadow.querySelector('.vm-send') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(0);
      // The empty reply is explained once, never shown as a blank line.
      const notes = Array.from(shadow.querySelectorAll('.vm-note')).map((n) => n.textContent);
      expect(notes).toEqual([WIDGET_HUMAN_TAKEOVER_NOTE]);

      served = takeoverRows('can I talk to a person?');
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_OPEN_MS + 50);

      const team = teamBubbles(shadow);
      expect(team).toHaveLength(1);
      expect(team[0]?.textContent).toBe('Team: Hi, this is Sam — happy to help.');
      // No bubble anywhere whose whole content is a label and nothing else.
      const blank = Array.from(shadow.querySelectorAll('.vm-msg')).filter((m) =>
        /^(Team|You|Luciel):\s*$/.test((m.textContent ?? '').trim()),
      );
      expect(blank).toHaveLength(0);
      // A person's words are never put under the AI assistant's name.
      expect(team[0]?.textContent).not.toContain('Luciel:');
      // The next poll does not render the skipped empty row either.
      await vi.advanceTimersByTimeAsync(WIDGET_POLL_OPEN_MS + 50);
      expect(teamBubbles(shadow)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the same holds on a page-to-page restore of a taken-over conversation', async () => {
    sessionStorage.clear();
    const SESSION = '00000000-0000-4000-8000-0000000000f7';
    sessionStorage.setItem(
      'luciel:session:vm_live_demo',
      JSON.stringify({ sessionId: SESSION, lastActivity: Date.now() }),
    );
    const client: WidgetApiClient = {
      ...clientWithSession(SESSION),
      history: async () => takeoverRows('can I talk to a person?'),
    };
    const shadow = await mountOpen(client);
    const transcript = (shadow.querySelector('.vm-body') as HTMLElement).textContent ?? '';
    expect(transcript).toContain('You: can I talk to a person?');
    const team = teamBubbles(shadow);
    expect(team).toHaveLength(1);
    expect(team[0]?.textContent).toBe('Team: Hi, this is Sam — happy to help.');
    const blank = Array.from(shadow.querySelectorAll('.vm-msg')).filter((m) =>
      /^(Team|You|Luciel):\s*$/.test((m.textContent ?? '').trim()),
    );
    expect(blank).toHaveLength(0);
  });

  // --- Arch §3.4.16: the AI disclosure is visible whenever the panel is open ------

  /** The header label is the invariant: present, "AI assistant", and placed before
   *  the close button so it can never be the element squeezed out. */
  const expectDisclosure = (shadow: ShadowRoot) => {
    const root = shadow.querySelector('.vm-root') as HTMLElement;
    expect(root.getAttribute('data-open')).toBe('true');
    const header = shadow.querySelector('.vm-header') as HTMLElement;
    const label = header.querySelector('.vm-ai-label') as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe('AI assistant');
    expect(label.compareDocumentPosition(shadow.querySelector('.vm-close')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  };

  it('the disclosure survives the whole end-chat flow: ask, keep chatting, end, and the next conversation', async () => {
    const SESSION = '00000000-0000-4000-8000-0000000000f8';
    sessionStorage.clear();
    const { client } = clientEnding(SESSION);
    const shadow = await mountOpen(client);
    expectDisclosure(shadow);
    await sendOnce(shadow, 'hi');
    expectDisclosure(shadow);

    // Confirm strip up: the header is untouched (it is a strip, not a modal).
    (shadow.querySelector('.vm-end') as HTMLButtonElement).click();
    expectDisclosure(shadow);
    (shadow.querySelector('.vm-confirm-keep') as HTMLButtonElement).click();
    expectDisclosure(shadow);

    // Ended: panel still open, disclosure still there, opening disclosure bubble
    // still in the transcript the visitor can read back.
    (shadow.querySelector('.vm-end') as HTMLButtonElement).click();
    (shadow.querySelector('.vm-confirm-end') as HTMLButtonElement).click();
    await flush();
    expect(shadow.querySelector('.vm-body')?.textContent).toContain(WIDGET_ENDED_NOTE);
    expectDisclosure(shadow);
    expect(shadow.querySelector('.vm-body')?.textContent).toContain(
      'Hi — I am an AI assistant for Northside Auto.',
    );

    // The next conversation in the same panel carries it too.
    await sendOnce(shadow, 'a new question');
    expectDisclosure(shadow);
  });

  it('the disclosure is there the moment the channel-off → on transition mounts the panel (D9)', async () => {
    vi.useFakeTimers();
    try {
      sessionStorage.clear();
      const { client } = clientSwitching(['channel_off', 'active']);
      const host = document.createElement('div');
      document.body.appendChild(host);
      await mountWidget({ embedKey: 'vm_live_demo', host, client });
      const shadow = (host.querySelector('[data-luciel-widget]') as HTMLElement).shadowRoot!;
      // Off: no disclosure because there is NO chrome at all — nothing to disclose
      // for, and nothing a visitor could mistake for a chat.
      expect(shadow.querySelector('.vm-ai-label')).toBeNull();
      expect((shadow.textContent ?? '').trim()).toBe('');

      await vi.advanceTimersByTimeAsync(WIDGET_POLL_HIDDEN_MS + 50);
      (shadow.querySelector('.vm-launcher') as HTMLButtonElement).click();
      expectDisclosure(shadow);
      // And the opening message states the fact of AI (Arch §3.4.16).
      expect((shadow.querySelector('.vm-body')?.textContent ?? '').toLowerCase()).toContain(
        'ai assistant',
      );
      expect(shadow.textContent).toContain('Powered by VantageMind');
    } finally {
      vi.useRealTimers();
    }
  });
});
