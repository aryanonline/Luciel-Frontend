import {
  createWidgetClient,
  type WidgetApiClient,
  type WidgetBootstrap,
} from '@luciel/api-client/widget';
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
  if (boot.renderState === 'paused') {
    shadow.appendChild(document.createElement('div'));
    return;
  }

  const style = document.createElement('style');
  style.textContent = widgetStyles;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'vm-root';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', `${boot.businessName} chat assistant`);

  // Session state for the chat loop.
  let sessionId: string | undefined;
  let renderState: WidgetBootstrap['renderState'] = boot.renderState;

  // Header carries the persistent "AI assistant" label (Arch §3.4.16).
  const header = document.createElement('div');
  header.className = 'vm-header';
  const title = document.createElement('span');
  title.className = 'vm-header-title';
  title.textContent = boot.assistantName;
  const aiLabel = document.createElement('span');
  aiLabel.className = 'vm-ai-label';
  aiLabel.textContent = boot.aiAssistantLabel; // "AI assistant"
  header.append(title, aiLabel);

  const panel = document.createElement('div');
  panel.className = 'vm-panel';

  const body = document.createElement('div');
  body.className = 'vm-body';
  body.setAttribute('aria-label', 'Conversation');
  // Opening message INCLUDES the AI-identity disclosure (Arch §3.4.16).
  const appendMessage = (role: 'visitor' | 'assistant', text: string) => {
    const p = document.createElement('p');
    p.className = 'vm-msg';
    const who = document.createElement('strong');
    who.textContent = role === 'visitor' ? 'You: ' : `${boot.assistantName}: `;
    p.append(who, document.createTextNode(text));
    body.appendChild(p);
    body.scrollTop = body.scrollHeight;
  };
  appendMessage('assistant', boot.openingMessage);

  // Live region so incoming messages are announced to screen readers.
  const live = a11yLiveRegion(boot.openingMessage);
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

  const doSend = async () => {
    const text = input.value.trim();
    if (!text || renderState !== 'active') return;
    appendMessage('visitor', text);
    input.value = '';
    try {
      const res = await client.send(options.embedKey, { sessionId, text });
      sessionId = res.sessionId;
      renderState = res.renderState;
      appendMessage('assistant', res.reply.text);
      live.textContent = res.reply.text; // announce incoming (Arch §5.16)
      // At-cap is server-driven: the widget just renders the graceful reply
      // it receives, then disables further input (Arch §3.4.1b).
      if (renderState === 'at_cap') {
        input.disabled = true;
        send.disabled = true;
      }
    } catch {
      appendMessage('assistant', 'Sorry — something went wrong. Please try again.');
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

  panel.append(header, body, inputRow, footer);
  root.appendChild(panel);
  shadow.appendChild(root);
}
