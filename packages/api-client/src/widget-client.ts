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
  /** Resolve embed key → render state + opening disclosure (Arch §3.4.16/§3.6.2).
   *  `sessionId` is the session this tab already holds, when it has one: a paused
   *  Luciel still serves a conversation in progress (2026-09-06 E2E walk). */
  bootstrap(embedKey: string, sessionId?: string): Promise<WidgetBootstrap>;
  /** Send a visitor message; server returns the reply + current render state. */
  send(embedKey: string, req: WidgetSendRequest): Promise<WidgetSendResult>;
  /** Fetch history for an existing session (e.g. reopened widget). */
  history(embedKey: string, sessionId: string): Promise<WidgetMessage[]>;
  /**
   * The explicit end-of-conversation signal (Arch §3.4.8b): the server closes
   * and summarizes THIS session now instead of waiting for the inactivity
   * sweep. Idempotent on the server (an ended or unknown session acks 204).
   *
   * Call it ONLY from an explicit visitor action — the widget's "End chat"
   * control after its confirm step — never from pagehide / visibilitychange /
   * a close button: the 2026-09-05 audit (F049) found that a per-navigation end
   * signal split one visit into several billed conversations. The widget relies
   * on inactivity for everything that is not an explicit end.
   */
  endSession(embedKey: string, sessionId: string): Promise<void>;
}
