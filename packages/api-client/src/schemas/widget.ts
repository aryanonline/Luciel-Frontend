import { z } from 'zod';
import { uuid, isoTimestamp } from './common';

/**
 * DATA-PLANE shapes for the embeddable widget (Arch §1.2, §3.1, §3.4.1b/§3.6.2).
 * These intentionally contain ZERO admin surface. The widget client (built from
 * these) is the only client the widget bundle imports — it must never reach the
 * admin API (Space Instructions §1, §6.3).
 *
 * ASSUMPTION (flagged): the Architecture lists the `/api/v1/chat-widget/*`
 * endpoint FAMILY (§1.2) and the widget behaviors (paused → empty div §3.6.2,
 * at-cap graceful reply §3.4.1b, AI-identity disclosure on first message
 * §3.4.16, "Powered by VantageMind" chrome §3.4.17) but does not pin exact
 * request/response field names for the chat message exchange. These shapes are
 * the minimal honest contract consistent with those behaviors; field names will
 * reconcile against the backend when it lands without changing widget components
 * (the swap-with-zero-changes rule, §7).
 */

/** Server-driven render directive — the widget renders what it is told. */
export const widgetRenderState = z.enum([
  'active', // normal chat
  'paused', // render an empty <div> — no error, no "offline" (Arch §3.6.2)
  'at_cap', // server returns the graceful at-cap reply (Arch §3.4.1b)
]);
export type WidgetRenderState = z.infer<typeof widgetRenderState>;

/** Bootstrap resolved from the host page's embed key (data-key). */
export const widgetBootstrap = z.object({
  renderState: widgetRenderState,
  /** Business display name for the widget header / disclosure. */
  businessName: z.string(),
  /** AI-assistant name used in the opening disclosure (Arch §3.4.16). */
  assistantName: z.string(),
  /**
   * Opening message including the platform-enforced AI-identity disclosure.
   * Wording is admin-shaped but the FACT of AI cannot be removed (Arch §3.4.16).
   */
  openingMessage: z.string(),
  /** Persistent "AI assistant" header label is always shown (Arch §3.4.16). */
  aiAssistantLabel: z.literal('AI assistant'),
  /** "Powered by VantageMind" chrome — present on all accounts (Arch §3.4.17). */
  poweredByVantageMind: z.literal(true),
});
export type WidgetBootstrap = z.infer<typeof widgetBootstrap>;

export const widgetMessage = z.object({
  messageId: uuid,
  role: z.enum(['visitor', 'assistant']),
  text: z.string(),
  at: isoTimestamp,
});
export type WidgetMessage = z.infer<typeof widgetMessage>;

export const widgetSendRequest = z.object({
  sessionId: uuid.optional(), // omitted on first message; server assigns
  text: z.string().min(1),
});
export type WidgetSendRequest = z.infer<typeof widgetSendRequest>;

export const widgetSendResult = z.object({
  sessionId: uuid,
  reply: widgetMessage,
  /** Server may flip render state mid-session (e.g. at_cap, paused). */
  renderState: widgetRenderState,
});
export type WidgetSendResult = z.infer<typeof widgetSendResult>;
