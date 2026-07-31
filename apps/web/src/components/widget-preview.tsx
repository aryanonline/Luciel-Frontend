'use client';

import * as React from 'react';
import type { WidgetMessage, WidgetRenderState } from '@luciel/api-client/widget';
import { AssistantText, Button, markdownToPlainText } from '@luciel/ui';
import { createPreviewWidgetClient, type WidgetAdapterKind } from '@/lib/widget-api';

/**
 * In-dashboard "Test it here" preview (Customer Journey §5). This is a React
 * mirror of the widget for the admin to try their Luciel; it uses the SAME
 * data-plane client the real widget uses (@luciel/api-client/widget) against
 * the SAME bootstrap/message endpoints, so what the admin tests here is their
 * own assistant, answering from their own knowledge. It exercises the
 * documented behaviors: AI-identity disclosure on open (Arch §3.4.16),
 * "Powered by VantageMind" chrome (§3.4.17), and the at-cap graceful reply
 * (§3.4.1b). Paused renders nothing (§3.6.2).
 *
 * `adapter` defaults to the deployed one; pass 'mock' only for a canned demo.
 *
 * The shipped embeddable (apps/widget) is the vanilla shadow-DOM bundle; this
 * preview is intentionally a separate React surface for the dashboard.
 */
export function WidgetPreview({
  embedKey,
  adapter,
}: {
  embedKey: string;
  adapter?: WidgetAdapterKind;
}) {
  const client = React.useMemo(() => createPreviewWidgetClient(adapter), [adapter]);
  const [boot, setBoot] = React.useState<{
    assistantName: string;
    aiAssistantLabel: string;
    poweredBy: boolean;
    renderState: WidgetRenderState;
  } | null>(null);
  const [messages, setMessages] = React.useState<WidgetMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const liveRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    client
      .bootstrap(embedKey)
      .then((b) => {
        if (cancelled) return;
        setBoot({
          assistantName: b.assistantName,
          aiAssistantLabel: b.aiAssistantLabel,
          poweredBy: b.poweredByVantageMind,
          renderState: b.renderState,
        });
        if (b.renderState !== 'paused') {
          setMessages([
            {
              messageId: 'open',
              role: 'assistant',
              text: b.openingMessage,
              at: new Date().toISOString(),
            },
          ]);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, embedKey]);

  const send = async () => {
    const text = input.trim();
    // The in-flight guard is what stops a second Enter duplicating the message.
    if (sending || !text) return;
    const visitor: WidgetMessage = {
      messageId: `v-${Date.now()}`,
      role: 'visitor',
      text,
      at: new Date().toISOString(),
    };
    setMessages((m) => [...m, visitor]);
    setInput('');
    setSending(true);
    setSendError(null);
    try {
      const res = await client.send(embedKey, { text: visitor.text });
      setMessages((m) => [...m, res.reply]);
      // Announce the incoming assistant message (a11y live region, Arch §5.16).
      if (liveRef.current) liveRef.current.textContent = markdownToPlainText(res.reply.text);
    } catch {
      // A failed send costs the admin their typed message and the transcript if
      // we swap the whole preview out, so put the text back and stay in place.
      setMessages((m) => m.filter((msg) => msg.messageId !== visitor.messageId));
      setInput(visitor.text);
      setSendError('That message did not go through. Try again in a moment.');
    } finally {
      setSending(false);
    }
  };

  if (failed) {
    return (
      <p className="text-vm-1 text-vm-danger" role="alert">
        We couldn&apos;t reach your Luciel just now. Try again in a moment — this affects the test
        here, not your live widget.
      </p>
    );
  }

  // Paused → render nothing (the real widget renders an empty <div>, §3.6.2).
  if (boot?.renderState === 'paused') {
    return (
      <p className="text-vm-1 text-vm-text-muted">
        This Luciel is paused — on a live site the widget renders nothing (no error, no “offline”).
      </p>
    );
  }

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-vm-card border border-vm-border bg-vm-bg shadow-vm">
      <div className="flex items-center justify-between border-b border-vm-border bg-vm-surface px-vm-4 py-vm-3">
        <span className="font-label">{boot?.assistantName ?? 'Assistant'}</span>
        <span className="rounded-vm-pill border border-vm-border px-vm-2 text-vm-0 text-vm-text-muted">
          {boot?.aiAssistantLabel ?? 'AI assistant'}
        </span>
      </div>
      <div className="max-h-72 space-y-vm-3 overflow-y-auto p-vm-4" aria-label="Conversation">
        {messages.map((m) => (
          <div
            key={m.messageId}
            className={m.role === 'visitor' ? 'text-right text-vm-2' : 'text-vm-2'}
          >
            <div
              className={
                m.role === 'visitor'
                  ? 'inline-block rounded-vm-card bg-vm-accent-weak px-vm-3 py-vm-2 text-left'
                  : 'inline-block rounded-vm-card bg-vm-surface px-vm-3 py-vm-2 text-left'
              }
            >
              {/* Assistant replies carry markdown — the admin reads what the
                  visitor read, not literal `**` (P0-3). */}
              {m.role === 'assistant' ? <AssistantText text={m.text} /> : m.text}
            </div>
          </div>
        ))}
        {/* A slow answer should read as "working on it", not dead air (P1-20). */}
        {sending && (
          <p className="text-vm-1 text-vm-text-muted" role="status">
            {boot?.assistantName ?? 'Assistant'} is typing…
          </p>
        )}
        <div ref={liveRef} role="status" aria-live="polite" className="sr-only" />
      </div>
      {sendError && (
        <p className="border-t border-vm-border px-vm-4 py-vm-2 text-vm-1 text-vm-danger" role="alert">
          {sendError}
        </p>
      )}
      <div className="flex gap-vm-2 border-t border-vm-border p-vm-3">
        <input
          aria-label="Type your message"
          className="min-h-[44px] flex-1 rounded-vm-control border border-vm-border px-vm-3 text-vm-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus"
          placeholder="Type your message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
        />
        <Button variant="primary" onClick={() => void send()} disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
      <div className="border-t border-vm-border px-vm-4 py-vm-2 text-vm-0 text-vm-text-muted">
        {boot?.poweredBy && 'Powered by VantageMind'}
      </div>
    </div>
  );
}
