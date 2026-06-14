import type {
  WidgetBootstrap,
  WidgetSendRequest,
  WidgetSendResult,
  WidgetMessage,
} from './schemas';

/**
 * THE data-plane widget API client interface. The widget bundle imports ONLY
 * this — it has NO admin surface and cannot reach the control plane
 * (Space Instructions §1, §6.3). Mirrors the documented `/api/v1/chat-widget/*`
 * family (Arch §1.2).
 *
 * Auth subject is the embed key (resolved from the host page's data-key at
 * runtime, never hardcoded — §3.4). The widget refuses to operate over non-HTTPS
 * (enforced in the widget entry, not here).
 */
export interface WidgetApiClient {
  /** Resolve embed key → render state + opening disclosure (Arch §3.4.16/§3.6.2). */
  bootstrap(embedKey: string): Promise<WidgetBootstrap>;
  /** Send a visitor message; server returns the reply + current render state. */
  send(embedKey: string, req: WidgetSendRequest): Promise<WidgetSendResult>;
  /** Fetch history for an existing session (e.g. reopened widget). */
  history(embedKey: string, sessionId: string): Promise<WidgetMessage[]>;
}
