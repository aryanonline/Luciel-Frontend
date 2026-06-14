import type { WidgetApiClient } from '../widget-client';
import type { WidgetBootstrap } from '../schemas';
import { createTransport } from './transport';

/**
 * Widget adapters — data-plane only, zero admin surface (Space Instructions
 * §1, §6.3). Both implement the SAME WidgetApiClient interface; swap requires no
 * widget component changes (§7).
 */

const DISCLOSURE = (business: string, assistant: string) =>
  `Hi — I'm ${assistant}, the AI assistant for ${business}. I can help answer questions, book, or connect you to a person.`;

export interface MockWidgetOptions {
  /** Force a render state to exercise paused / at-cap behavior. */
  renderState?: WidgetBootstrap['renderState'];
  latencyMs?: number;
}

export function createMockWidgetClient(options: MockWidgetOptions = {}): WidgetApiClient {
  const latency = options.latencyMs ?? 0;
  const delay = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());
  const businessName = 'Sarah Chen';
  const assistantName = "Sarah's assistant";

  return {
    async bootstrap() {
      await delay();
      return {
        renderState: options.renderState ?? 'active',
        businessName,
        assistantName,
        openingMessage: DISCLOSURE(businessName, assistantName),
        aiAssistantLabel: 'AI assistant',
        poweredByVantageMind: true,
      };
    },
    async send(_embedKey, _req) {
      await delay();
      const renderState = options.renderState ?? 'active';
      // Model the at-cap graceful, no-LLM reply (Arch §3.4.1b).
      const text =
        renderState === 'at_cap'
          ? "I'm at capacity right now, but I've passed your message along and someone will be in touch."
          : 'Thanks — yes, there are openings this month. Would you like to book an intro call?';
      return {
        sessionId: '00000000-0000-4000-8000-000000000001',
        reply: { messageId: 'r1', role: 'assistant', text, at: new Date().toISOString() },
        renderState,
      };
    },
    async history() {
      await delay();
      return [];
    },
  };
}

export function createHttpWidgetClient(baseUrl: string): WidgetApiClient {
  const t = createTransport({ baseUrl });
  return {
    bootstrap: (embedKey) => t.post('/api/v1/chat-widget/bootstrap', { embedKey }),
    send: (embedKey, req) => t.post('/api/v1/chat-widget/messages', { embedKey, ...req }),
    history: (embedKey, sessionId) =>
      t.get(`/api/v1/chat-widget/sessions/${sessionId}?embedKey=${encodeURIComponent(embedKey)}`),
  };
}
