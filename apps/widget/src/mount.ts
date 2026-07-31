import {
  createWidgetClient,
  type WidgetApiClient,
  type WidgetBootstrap,
} from '@luciel/api-client/widget';
import { markdownToPlainText, markdownToSafeHtml } from './markdown';
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
 *  - render an EMPTY <div> when paused — no error, no "offline" (§3.6.2);
 *  - WCAG AA: keyboard operable, ARIA roles, live-region announcements for
 *    incoming messages, visible focus, respects host prefers-reduced-motion,
 *    does not trap focus.
 *
 * The actual send/receive chat loop is a placeholder; the full conversation UX
 * lands in the widget milestone. This is the structural shell with the
 * non-negotiable disclosures and the data-plane-only client wired in.
 */

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

  let boot: WidgetBootstrap;
  try {
    boot = await client.bootstrap(options.embedKey);
  } catch {
    // Fail closed and quiet on the host page; never render a broken UI.
    return;
  }

  // Shadow DOM isolation.
  const shadowHost = document.createElement('div');
  shadowHost.setAttribute('data-luciel-widget', '');
  const shadow = shadowHost.attachShadow({ mode: 'open' });
  options.host.appendChild(shadowHost);

  // Paused → render an EMPTY <div>. No error, no "offline" (Arch §3.6.2).
  // Checked before positioning so a paused Luciel leaves no floating chrome.
  if (boot.renderState === 'paused') {
    shadow.appendChild(document.createElement('div'));
    return;
  }

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

  // Session state for the chat loop.
  let sessionId: string | undefined;
  let renderState: WidgetBootstrap['renderState'] = boot.renderState;

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
  const appendMessage = (role: 'visitor' | 'assistant', text: string) => {
    const msg = document.createElement('div');
    msg.className = 'vm-msg';
    const who = document.createElement('strong');
    who.textContent = role === 'visitor' ? 'You: ' : `${boot.assistantName}: `;
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
  };
  appendMessage('assistant', boot.openingMessage);

  // Live region so incoming messages are announced to screen readers. It carries
  // markdown-stripped PROSE — the formatting is visual only.
  const live = a11yLiveRegion(markdownToPlainText(boot.openingMessage));
  body.appendChild(live);

  // Input row + working send loop.
  const inputRow = document.createElement('div');
  inputRow.className = 'vm-input-row';
  const input = document.createElement('input');
  input.className = 'vm-input';
  input.setAttribute('aria-label', 'Type your message');
  input.placeholder = 'Type your message…';
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
    const text = input.value.trim();
    // The in-flight guard is what stops a second Enter duplicating the message.
    if (sending || !text || renderState !== 'active') return;
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
      appendMessage('assistant', res.reply.text);
      live.textContent = markdownToPlainText(res.reply.text); // announce incoming (Arch §5.16)
    } catch {
      appendMessage('assistant', 'Sorry — something went wrong. Please try again.');
    } finally {
      typing.remove();
      sending = false;
      // At-cap is server-driven: the widget just renders the graceful reply
      // it receives, then leaves the input disabled (Arch §3.4.1b).
      const atCap = renderState === 'at_cap';
      input.disabled = atCap;
      send.disabled = atCap;
      if (!atCap) input.focus();
    }
  };
  send.addEventListener('click', () => void doSend());
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void doSend();
  });

  // "Powered by VantageMind" chrome — present on all accounts (Arch §3.4.17).
  const footer = document.createElement('div');
  footer.className = 'vm-footer';
  footer.textContent = boot.poweredByVantageMind ? 'Powered by VantageMind' : '';

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
    launcher.setAttribute(
      'aria-label',
      open ? 'Close chat' : `Chat with ${boot.businessName}`,
    );
    if (open && !input.disabled) input.focus();
    else if (!open) launcher.focus();
  };

  launcher.addEventListener('click', () => {
    setOpen(root.getAttribute('data-open') !== 'true');
  });
  closeButton.addEventListener('click', () => setOpen(false));
  // Escape closes the panel, but must not fight the host page when closed.
  root.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && root.getAttribute('data-open') === 'true') {
      setOpen(false);
    }
  });

  panel.append(header, body, inputRow, footer);
  root.append(panel, launcher);
  shadow.appendChild(root);
}
