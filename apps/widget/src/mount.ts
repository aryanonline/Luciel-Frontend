import {
  createWidgetClient,
  LucielApiError,
  type WidgetApiClient,
  type WidgetBootstrap,
  type WidgetRenderState,
} from '@luciel/api-client/widget';
import { markdownToPlainText, markdownToSafeHtml } from '@luciel/ui/markdown';
import { widgetStyles } from './styles';

/**
 * Widget mount logic (Space Instructions §6.3, Arch §3.4.16/§3.4.17/§3.6.2).
 *
 * Responsibilities of this scaffold:
 *  - resolve the embed key from the host script tag's data-key at RUNTIME
 *    (never hardcoded — §3.4);
 *  - refuse to operate over non-HTTPS (§3.5 / §6.3);
 *  - mount into a SHADOW DOM so host-page CSS can't collide;
 *  - render the AI-identity disclosure (opening message + persistent
 *    "AI assistant" header label) and the "Powered by VantageMind" chrome;
 *  - render an EMPTY <div> when paused — no error, no "offline" (§3.6.2) — and
 *    the same when the owner switched the Website chat channel off (round 7
 *    D9), except that the off state keeps polling the bootstrap so the launcher
 *    appears without a reload once the channel is switched back on;
 *  - WCAG AA: keyboard operable, ARIA roles, live-region announcements for
 *    incoming messages, visible focus, respects host prefers-reduced-motion,
 *    does not trap focus.
 *
 * The send/receive loop is live: doSend() posts through the data-plane client,
 * carries the session id for continuity, shows a typing bubble while a reply is
 * in flight, guards against double-send, renders replies as sanitized markdown
 * with a live-region announcement, and honours server-driven render-state
 * changes (at-cap keeps the input disabled). Failures append an in-transcript
 * notice — gentler for a rate limit, generic for everything else.
 */

/** Per-message cap, identical to the API's WidgetSendRequest.text max_length. */
/** Shown once when a send comes back empty: a person has the conversation (§3.4.12). */
export const WIDGET_HUMAN_TAKEOVER_NOTE =
  'A member of the team has this conversation — their reply will appear here.';
/** The business paused its Luciel and this conversation had already ended: the
 *  server held the message. Said plainly — the widget used to show the takeover
 *  note here, claiming a person had a conversation nobody had (2026-09-06 E2E). */
export const WIDGET_PAUSED_NOTE =
  "This chat is unavailable right now — your last message wasn't sent.";

export const WIDGET_TEXT_MAX_CHARS = 4000;
/** The server refused this page's origin (round 6 WP-I): honest, final, no retry. */
export const WIDGET_OFFSITE_NOTE = "This chat isn't available on this website.";
/** The visitor ended the chat from the panel's End chat control (Arch §3.4.8b):
 *  the server closed and summarized it. The next message opens a new one. */
export const WIDGET_ENDED_NOTE = 'This chat has ended. Send a message to start a new one.';
/** The explicit end did not reach the server; the conversation is still open. */
export const WIDGET_END_FAILED_NOTE = "Couldn't end the chat just now — please try again.";

/**
 * The server ends a widget session after this much silence (app/runtime/sessions.py
 * INACTIVITY_TIMEOUT["widget"]). A stored session older than this is not resumed —
 * the server has already closed and summarized it.
 */
export const WIDGET_SESSION_IDLE_MS = 30 * 60 * 1000;
/** Poll cadence for replies a person sends from the dashboard (§3.4.12). The
 *  same closed-panel cadence (and the same backoff) re-checks the bootstrap while
 *  the Website chat channel is switched off (D9): no panel is open, so the
 *  "hidden" interval is the one that applies. */
export const WIDGET_POLL_OPEN_MS = 5_000;
export const WIDGET_POLL_HIDDEN_MS = 20_000;
export const WIDGET_POLL_BACKOFF_MS = 60_000;

/** Render states that mount the launcher. Anything else — paused, channel_off,
 *  or a directive this build does not recognize — renders nothing. */
const isRenderable = (state: WidgetRenderState): boolean =>
  state === 'active' || state === 'at_cap';

const storageKey = (embedKey: string) => `luciel:session:${embedKey}`;

interface StoredSession {
  sessionId: string;
  lastActivity: number;
}

/** sessionStorage is per-tab: a visit that spans pages stays ONE conversation. */
const readStoredSession = (embedKey: string): StoredSession | undefined => {
  try {
    const raw = sessionStorage.getItem(storageKey(embedKey));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.sessionId !== 'string' || typeof parsed.lastActivity !== 'number') {
      return undefined;
    }
    if (Date.now() - parsed.lastActivity > WIDGET_SESSION_IDLE_MS) {
      sessionStorage.removeItem(storageKey(embedKey));
      return undefined;
    }
    return { sessionId: parsed.sessionId, lastActivity: parsed.lastActivity };
  } catch {
    return undefined;
  }
};

const writeStoredSession = (embedKey: string, sessionId: string) => {
  try {
    const value: StoredSession = { sessionId, lastActivity: Date.now() };
    sessionStorage.setItem(storageKey(embedKey), JSON.stringify(value));
  } catch {
    // Storage blocked (private mode, quota): the session still works for this page.
  }
};

const clearStoredSession = (embedKey: string) => {
  try {
    sessionStorage.removeItem(storageKey(embedKey));
  } catch {
    // nothing to clear
  }
};

export interface MountOptions {
  embedKey: string;
  host: HTMLElement;
  client?: WidgetApiClient;
}

const a11yLiveRegion = (text: string) => {
  const region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.style.position = 'absolute';
  region.style.width = '1px';
  region.style.height = '1px';
  region.style.overflow = 'hidden';
  region.style.clip = 'rect(0 0 0 0)';
  region.textContent = text;
  return region;
};

export async function mountWidget(options: MountOptions): Promise<void> {
  // Refuse non-HTTPS (Space Instructions §3.5, §6.3).
  if (
    typeof location !== 'undefined' &&
    location.protocol !== 'https:' &&
    location.hostname !== 'localhost'
  ) {
    // eslint-disable-next-line no-console
    console.warn('[Luciel] Refusing to run over a non-HTTPS connection.');
    return;
  }

  const client =
    options.client ??
    createWidgetClient({
      adapter: __WIDGET_ADAPTER__,
      baseUrl: __WIDGET_API_BASE_URL__,
    });

  // Read the tab's stored session BEFORE bootstrapping: a paused Luciel holds new
  // conversations but keeps serving one in progress, and only the session id
  // tells the server which this is (2026-09-06 E2E walk, E2E-9).
  const stored = readStoredSession(options.embedKey);
  let boot: WidgetBootstrap;
  try {
    boot = await client.bootstrap(options.embedKey, stored?.sessionId);
  } catch (err) {
    // Fail closed and quiet on the host page; never render a broken UI. The one
    // refusal worth a word: this page is not on the owner's allowed list (round 6
    // WP-I) — said in the console, where the site's developer will look, and
    // never as chrome a visitor would read as a broken chat.
    if (err instanceof LucielApiError && err.code === 'unauthorized') {
      // eslint-disable-next-line no-console
      console.warn(
        '[Luciel] This website is not on the allowed list for this chat key. Add it under Embed & launch in the dashboard.',
      );
    }
    return;
  }

  // Shadow DOM isolation.
  const shadowHost = document.createElement('div');
  shadowHost.setAttribute('data-luciel-widget', '');
  const shadow = shadowHost.attachShadow({ mode: 'open' });
  options.host.appendChild(shadowHost);

  /**
   * Build the launcher + panel for a bootstrap that said to render. Called once
   * for an active/at_cap bootstrap, or later by the channel-off poll once the
   * owner switches Website chat back on (D9) — in which case the launcher
   * appears on the page the visitor is already looking at, with no reload.
   */
  const mountPanel = async (
    boot: WidgetBootstrap,
    stored: StoredSession | undefined,
  ): Promise<void> => {
    // The empty off/paused render, when there was one, gives way to the panel.
    shadow.replaceChildren();

    // Pin the host out of the page's normal flow (P0-1). Set inline rather than
    // through `:host`, because a host page's own rules outrank a `:host` rule for
    // this element and an embed a customer's CSS can un-pin is a broken embed.
    shadowHost.style.position = 'fixed';
    shadowHost.style.bottom = '16px';
    shadowHost.style.right = '16px';
    shadowHost.style.zIndex = '2147483000';

    const style = document.createElement('style');
    style.textContent = widgetStyles;
    shadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'vm-root';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', `${boot.businessName} chat assistant`);
    root.setAttribute('data-open', 'false');

    // Session state for the chat loop. The session id is restored from this tab's
    // sessionStorage so a visit that spans several pages is ONE conversation — one
    // billed session, one transcript (Arch §3.4.8; 2026-09-05 audit F049: the widget
    // used to end the session on every tab-hide and navigation, and each new page
    // started a fresh billed conversation with no memory of the last one).
    //
    // No page leave ends the session from here: a page leave is indistinguishable
    // from a navigation, and the server closes the session deterministically by
    // inactivity (30 minutes) and summarizes it then. A stored session older than
    // that window is not resumed. The ONE end signal this panel sends is the
    // visitor's own, explicit, confirmed "End chat" (Arch §3.4.8b, doEnd below) —
    // never pagehide, visibilitychange, beforeunload, or the close button.
    let sessionId: string | undefined = stored?.sessionId;
    let renderState: WidgetBootstrap['renderState'] = boot.renderState;
    // Every transcript row the panel has rendered (or deliberately skipped), so a
    // poll never repeats a message. Visitor rows the widget itself sent have no
    // known id until they come back from history; they are skipped on poll and
    // rendered only on a restore.
    const seenIds = new Set<string>();

    // Header carries the persistent "AI assistant" label (Arch §3.4.16) and the
    // close affordance. The label sits before the close button so it stays
    // visible whenever the panel is open.
    const header = document.createElement('div');
    header.className = 'vm-header';
    const title = document.createElement('span');
    title.className = 'vm-header-title';
    title.textContent = boot.assistantName;
    const aiLabel = document.createElement('span');
    aiLabel.className = 'vm-ai-label';
    aiLabel.textContent = boot.aiAssistantLabel; // "AI assistant"
    const closeButton = document.createElement('button');
    closeButton.className = 'vm-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close chat');
    closeButton.textContent = '✕';
    header.append(title, aiLabel, closeButton);

    const panel = document.createElement('div');
    panel.className = 'vm-panel';
    panel.id = 'vm-panel';

    const body = document.createElement('div');
    body.className = 'vm-body';
    body.setAttribute('aria-label', 'Conversation');
    // Opening message INCLUDES the AI-identity disclosure (Arch §3.4.16).
    const appendMessage = (role: 'visitor' | 'assistant' | 'human', text: string) => {
      const msg = document.createElement('div');
      msg.className = 'vm-msg';
      const who = document.createElement('strong');
      // A person's reply is labelled as the team (E2E-11): the visitor was just told
      // a team member has the conversation, and their words are not the AI's.
      who.textContent =
        role === 'visitor' ? 'You: ' : role === 'human' ? 'Team: ' : `${boot.assistantName}: `;
      msg.appendChild(who);
      if (role === 'assistant') {
        // Assistant replies carry markdown; render it so the visitor doesn't read
        // literal `**`/`-` markers. The HTML is sanitized by construction in
        // markdownToSafeHtml (escape-first + tag whitelist) — never raw model
        // output. Visitor text stays a plain text node.
        const template = document.createElement('template');
        template.innerHTML = markdownToSafeHtml(text);
        msg.appendChild(template.content);
      } else {
        msg.appendChild(document.createTextNode(text));
      }
      body.appendChild(msg);
      body.scrollTop = body.scrollHeight;
      return msg;
    };
    const greeting = appendMessage('assistant', boot.openingMessage);

    // Live region so incoming messages are announced to screen readers. It carries
    // markdown-stripped PROSE — the formatting is visual only.
    const live = a11yLiveRegion(markdownToPlainText(boot.openingMessage));
    body.appendChild(live);

    /** An in-transcript notice (italic, not a bubble), announced to screen readers. */
    const appendNote = (text: string) => {
      const note = document.createElement('div');
      note.className = 'vm-msg vm-note';
      note.textContent = text;
      body.appendChild(note);
      body.scrollTop = body.scrollHeight;
      live.textContent = text;
    };

    // §3.4.12: an EMPTY reply means a person holds this conversation — their answer
    // arrives through the poll. Say so once, in the transcript; never render a blank
    // bubble and never invent a bot line for them (2026-09-05 audit F145).
    let humanNoteShown = false;
    const noteHumanHasConversation = () => {
      if (humanNoteShown) return;
      humanNoteShown = true;
      appendNote(WIDGET_HUMAN_TAKEOVER_NOTE);
    };

    // The server persists the opening greeting as the session's first row. The
    // panel already shows it (the static opener has no id), so the first poll of a
    // new session must recognise that row instead of appending it under the reply
    // (2026-09-06 E2E walk, E2E-10).
    let serverGreetingSeen = false;

    /**
     * Bring the transcript up to date from the server (§3.4.12: a takeover reply
     * reaches the visitor on the next poll). `restoring` renders the visitor's own
     * earlier turns too — that is the page-to-page continuity; a routine poll only
     * appends what someone else said.
     */
    const syncHistory = async (restoring: boolean): Promise<boolean> => {
      if (!sessionId) return false;
      const rows = await client.history(options.embedKey, sessionId);
      let appended = false;
      for (const row of rows) {
        if (seenIds.has(row.messageId)) continue;
        seenIds.add(row.messageId);
        if (
          !restoring &&
          !serverGreetingSeen &&
          row.role === 'assistant' &&
          row.text.trim() === boot.openingMessage.trim()
        ) {
          serverGreetingSeen = true;
          continue;
        }
        if (row.role === 'visitor' && !restoring) continue;
        if (!row.text.trim()) continue; // nothing to show — never a blank bubble
        appendMessage(row.role, row.text);
        if (row.role !== 'visitor') live.textContent = markdownToPlainText(row.text);
        appended = true;
      }
      return appended;
    };

    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let pollFailures = 0;
    const pollDelay = () => {
      if (pollFailures >= 3) return WIDGET_POLL_BACKOFF_MS;
      const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      const open = root.getAttribute('data-open') === 'true';
      return visible && open ? WIDGET_POLL_OPEN_MS : WIDGET_POLL_HIDDEN_MS;
    };
    const schedulePoll = () => {
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      if (!sessionId) return;
      pollTimer = setTimeout(async () => {
        pollTimer = undefined;
        if (!sending) {
          try {
            await syncHistory(false);
            pollFailures = 0;
          } catch {
            pollFailures += 1;
          }
        }
        schedulePoll();
      }, pollDelay());
    };

    if (sessionId) {
      // Same tab, new page: replay what was said so far, then keep listening. A
      // history the server no longer serves (the session closed, the key rotated)
      // means a fresh start — never a half-restored transcript.
      try {
        const replayed = await syncHistory(true);
        // The server's transcript already holds the greeting that opened this
        // conversation; keeping the static one too showed the visitor two
        // greetings on every page after the first (2026-09-06 E2E walk).
        if (replayed) greeting.remove();
        schedulePoll();
      } catch {
        clearStoredSession(options.embedKey);
        sessionId = undefined;
      }
    }

    // Input row + working send loop.
    const inputRow = document.createElement('div');
    inputRow.className = 'vm-input-row';
    const input = document.createElement('input');
    input.className = 'vm-input';
    input.setAttribute('aria-label', 'Type your message');
    input.placeholder = 'Type your message…';
    // Mirrors the server's per-message cap (WidgetSendRequest.text max 4000 chars):
    // the browser stops the visitor at the limit instead of the API refusing a
    // pasted essay with a 422 the widget would have to explain (2026-09-05 audit).
    input.maxLength = WIDGET_TEXT_MAX_CHARS;
    const send = document.createElement('button');
    send.className = 'vm-send';
    send.type = 'button';
    send.textContent = 'Send';
    inputRow.append(input, send);

    // Typing bubble shown between the visitor's message and the reply, so a slow
    // answer reads as "working on it" rather than dead air (P1-20).
    const showTyping = () => {
      const typing = document.createElement('div');
      typing.className = 'vm-typing';
      typing.setAttribute('data-vm-typing', '');
      typing.setAttribute('aria-label', `${boot.assistantName} is typing`);
      for (let i = 0; i < 3; i += 1) typing.appendChild(document.createElement('span'));
      body.appendChild(typing);
      body.scrollTop = body.scrollHeight;
      return typing;
    };

    let sending = false;
    const doSend = async () => {
      const text = input.value.trim().slice(0, WIDGET_TEXT_MAX_CHARS);
      // The in-flight guard is what stops a second Enter duplicating the message.
      // at_cap still SENDS: the backend answers with the graceful no-LLM at-cap
      // reply and captures the message (Arch §3.4.1b — "no conversation is
      // silently dropped"). Blocking the send here made a visitor who arrived
      // during at-cap type into a void. Only paused/unknown states refuse.
      if (sending || !text || !isRenderable(renderState)) return;
      sending = true;
      input.disabled = true;
      send.disabled = true;
      appendMessage('visitor', text);
      input.value = '';
      const typing = showTyping();
      try {
        const res = await client.send(options.embedKey, { sessionId, text });
        sessionId = res.sessionId;
        renderState = res.renderState;
        writeStoredSession(options.embedKey, sessionId);
        seenIds.add(res.reply.messageId);
        syncEndControl(); // there is now a conversation the visitor can end
        if (renderState === 'paused' || renderState === 'channel_off') {
          // The business paused its Luciel — or switched Website chat off (D9) —
          // and this conversation had already ended (§3.6.2 holds NEW
          // conversations): the server held the message. Say so — never the
          // takeover note, which claimed a person had it (E2E-8).
          appendNote(WIDGET_PAUSED_NOTE);
        } else if (res.reply.text.trim()) {
          appendMessage('assistant', res.reply.text);
          live.textContent = markdownToPlainText(res.reply.text); // announce incoming (Arch §5.16)
        } else {
          noteHumanHasConversation();
          live.textContent = WIDGET_HUMAN_TAKEOVER_NOTE;
        }
        schedulePoll();
      } catch (err) {
        // A 429 means Luciel is catching its breath, not that something broke —
        // the HTTP transport surfaces it as a typed LucielApiError, so say so
        // honestly (with the server's wait when it sent one) instead of the
        // generic failure line, which stays for everything else.
        if (err instanceof LucielApiError && err.code === 'rate_limited') {
          const wait = err.retryAfterSeconds;
          appendMessage(
            'assistant',
            wait && wait > 1
              ? `One moment — please try again in ${wait} seconds.`
              : 'One moment — please try again in a few seconds.',
          );
        } else if (err instanceof LucielApiError && err.code === 'unauthorized') {
          // The owner narrowed the allowed websites while this panel was open (round 6
          // WP-I): say so plainly and stop sending — a retry cannot succeed.
          appendMessage('assistant', WIDGET_OFFSITE_NOTE);
          live.textContent = WIDGET_OFFSITE_NOTE;
          renderState = 'paused';
        } else {
          appendMessage('assistant', 'Sorry — something went wrong. Please try again.');
        }
      } finally {
        typing.remove();
        sending = false;
        // At-cap is server-driven: the widget just renders the graceful reply
        // it receives, then leaves the input disabled (Arch §3.4.1b). A pause or
        // a switched-off channel that reached this panel closes the input the
        // same way (E2E-8, D9): only 'active' keeps the composer open.
        const closed = renderState !== 'active';
        input.disabled = closed;
        send.disabled = closed;
        if (!closed) input.focus();
      }
    };
    send.addEventListener('click', () => void doSend());
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void doSend();
    });

    // "Powered by VantageMind" chrome — present on all accounts (Arch §3.4.17) —
    // beside the one control that ends a conversation on purpose.
    const footer = document.createElement('div');
    footer.className = 'vm-footer';
    const poweredBy = document.createElement('span');
    poweredBy.className = 'vm-powered';
    poweredBy.textContent = boot.poweredByVantageMind ? 'Powered by VantageMind' : '';
    const endButton = document.createElement('button');
    endButton.className = 'vm-end';
    endButton.type = 'button';
    endButton.textContent = 'End chat';
    footer.append(poweredBy, endButton);

    // The explicit end signal (Arch §3.4.8b). Owner-settled: the widget relies on
    // inactivity, and the server accepts an explicit end — so the ONLY thing that
    // sends it is the visitor pressing "End chat" and then confirming. Nothing in
    // this file listens to pagehide / visibilitychange / beforeunload for it
    // (2026-09-05 audit F049: that split one visit into several billed
    // conversations). The confirm step is a strip above the composer, not a
    // modal: it keeps the transcript, the disclosure and the panel exactly where
    // they are.
    const confirm = document.createElement('div');
    confirm.className = 'vm-confirm';
    confirm.setAttribute('role', 'group');
    confirm.setAttribute('aria-label', 'End this chat?');
    confirm.hidden = true;
    const confirmText = document.createElement('span');
    confirmText.className = 'vm-confirm-text';
    confirmText.textContent = 'End this chat?';
    const confirmEnd = document.createElement('button');
    confirmEnd.className = 'vm-confirm-end';
    confirmEnd.type = 'button';
    confirmEnd.textContent = 'End chat';
    const confirmKeep = document.createElement('button');
    confirmKeep.className = 'vm-confirm-keep';
    confirmKeep.type = 'button';
    confirmKeep.textContent = 'Keep chatting';
    confirm.append(confirmText, confirmEnd, confirmKeep);

    // The End chat control exists only while there is a conversation to end, and
    // steps aside while its own confirm strip is up.
    const syncEndControl = () => {
      endButton.hidden = !confirm.hidden || !sessionId;
    };
    const showConfirm = (show: boolean) => {
      confirm.hidden = !show;
      syncEndControl();
    };
    syncEndControl();

    endButton.addEventListener('click', () => {
      showConfirm(true);
      // The safe answer takes focus; ending is one deliberate Tab + Enter away.
      confirmKeep.focus();
    });
    confirmKeep.addEventListener('click', () => {
      showConfirm(false);
      endButton.focus();
    });

    let ending = false;
    const doEnd = async () => {
      const ended = sessionId;
      // The in-flight guard: a double-click sends exactly one end signal.
      if (ending || !ended) return;
      ending = true;
      confirmEnd.disabled = true;
      confirmKeep.disabled = true;
      confirmEnd.textContent = 'Ending…';
      let failed = false;
      try {
        await client.endSession(options.embedKey, ended);
      } catch {
        failed = true;
      } finally {
        ending = false;
        confirmEnd.disabled = false;
        confirmKeep.disabled = false;
        confirmEnd.textContent = 'End chat';
      }
      if (failed) {
        // The conversation is still open on the server: keep everything — the
        // session, the poll, the control — and say so where the visitor is looking.
        showConfirm(false);
        appendNote(WIDGET_END_FAILED_NOTE);
        endButton.focus();
        return;
      }
      // Ended on the server (closed + summarized, §3.4.7). This tab forgets the
      // session so the next message opens a NEW conversation — the one case where
      // a second billed session is exactly what the visitor asked for.
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      pollTimer = undefined;
      pollFailures = 0;
      clearStoredSession(options.embedKey);
      sessionId = undefined;
      seenIds.clear();
      serverGreetingSeen = false;
      humanNoteShown = false;
      showConfirm(false); // and the End chat control goes with the session
      appendNote(WIDGET_ENDED_NOTE);
      // The panel stays open, the disclosure stays in its header; the composer
      // reopens unless the server had closed it (at-cap / paused / channel off).
      const closed = renderState !== 'active';
      input.disabled = closed;
      send.disabled = closed;
      if (!closed) input.focus();
      else closeButton.focus();
    };
    confirmEnd.addEventListener('click', () => void doEnd());

    // Circular launcher — closed by default, so the embed never rearranges the
    // customer's page (P0-1).
    const launcher = document.createElement('button');
    launcher.className = 'vm-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', panel.id);
    launcher.setAttribute('aria-label', `Chat with ${boot.businessName}`);
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M12 3C6.94 3 3 6.36 3 10.5c0 2.3 1.23 4.35 3.18 5.72V21l3.4-2.05c.78.17 1.6.26 2.42.26 5.06 0 9-3.36 9-7.5S17.06 3 12 3z"/>' +
      '</svg>';

    const setOpen = (open: boolean) => {
      root.setAttribute('data-open', String(open));
      launcher.setAttribute('aria-expanded', String(open));
      launcher.setAttribute('aria-label', open ? 'Close chat' : `Chat with ${boot.businessName}`);
      if (open && !input.disabled) input.focus();
      else if (!open) launcher.focus();
      // Cadence follows the panel: fast while the visitor is looking, slow otherwise.
      schedulePoll();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => schedulePoll());
    }

    launcher.addEventListener('click', () => {
      setOpen(root.getAttribute('data-open') !== 'true');
    });
    // Closing the panel ends nothing (F049): the conversation stays open for the
    // visitor to come back to, and the server closes it by inactivity.
    closeButton.addEventListener('click', () => setOpen(false));
    // Escape closes the panel, but must not fight the host page when closed. With
    // the end-chat confirm up, Escape answers THAT first ("keep chatting").
    root.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key !== 'Escape' || root.getAttribute('data-open') !== 'true') {
        return;
      }
      if (!confirm.hidden && !ending) {
        showConfirm(false);
        endButton.focus();
        return;
      }
      setOpen(false);
    });

    panel.append(header, body, confirm, inputRow, footer);
    root.append(panel, launcher);
    shadow.appendChild(root);
  };

  if (isRenderable(boot.renderState)) {
    await mountPanel(boot, stored);
    return;
  }

  // Paused → render an EMPTY <div>. No error, no "offline" (Arch §3.6.2).
  // Decided before positioning so a paused Luciel leaves no floating chrome.
  // Any state this build does not recognize gets the SAME empty render: the
  // HTTP client already fails closed on schema violations, but an injected
  // client (options.client) bypasses that, and an unknown directive must never
  // produce an active-looking panel whose sends go nowhere.
  shadow.appendChild(document.createElement('div'));
  if (boot.renderState !== 'channel_off') return;

  // Website chat switched OFF (round 7 D9): the same nothing as paused, but the
  // owner can switch it back on at any moment and a visitor who is already on
  // the page should see the launcher appear without reloading. Re-check the
  // bootstrap on the closed-panel cadence, backing off after repeated failures
  // exactly as the history poll does; stop for good on an origin refusal (a
  // retry cannot succeed) or once the server says paused (today's no-poll
  // state). Nothing here is visible to the visitor until the server says so.
  let offFailures = 0;
  const waitForChannel = () => {
    setTimeout(
      async () => {
        // Re-read the tab's session each time: it may have expired meanwhile.
        const again = readStoredSession(options.embedKey);
        let next: WidgetBootstrap;
        try {
          next = await client.bootstrap(options.embedKey, again?.sessionId);
          offFailures = 0;
        } catch (err) {
          if (err instanceof LucielApiError && err.code === 'unauthorized') return;
          offFailures += 1;
          waitForChannel();
          return;
        }
        if (isRenderable(next.renderState)) {
          await mountPanel(next, again);
          return;
        }
        if (next.renderState === 'channel_off') waitForChannel();
      },
      offFailures >= 3 ? WIDGET_POLL_BACKOFF_MS : WIDGET_POLL_HIDDEN_MS,
    );
  };
  waitForChannel();
}
