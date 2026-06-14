'use client';

import * as React from 'react';
import {
  createWidgetClient,
  type WidgetMessage,
  type WidgetRenderState,
} from '@luciel/api-client/widget';
import { Button } from '@luciel/ui';

/**
 * In-dashboard "Test it here" preview (Customer Journey §5). This is a React
 * mirror of the widget for the admin to try their Luciel; it uses the SAME
 * data-plane client the real widget uses (@luciel/api-client/widget), so it
 * exercises the documented behaviors: AI-identity disclosure on open
 * (Arch §3.4.16), "Powered by VantageMind" chrome (§3.4.17), and the at-cap
 * graceful reply (§3.4.1b). Paused renders nothing (§3.6.2).
 *
 * The shipped embeddable (apps/widget) is the vanilla shadow-DOM bundle; this
 * preview is intentionally a separate React surface for the dashboard.
 */
export function WidgetPreview({ embedKey }: { embedKey: string }) {
  const client = React.useMemo(() => createWidgetClient({ adapter: 'mock' }), []);
  const [boot, setBoot] = React.useState<{
    assistantName: string;
    aiAssistantLabel: string;
    poweredBy: boolean;
    renderState: WidgetRenderState;
  } | null>(null);
  const [messages, setMessages] = React.useState<WidgetMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const liveRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    client.bootstrap(embedKey).then((b) => {
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
    });
  }, [client, embedKey]);

  const send = async () => {
    if (!input.trim()) return;
    const visitor: WidgetMessage = {
      messageId: `v-${Date.now()}`,
      role: 'visitor',
      text: input,
      at: new Date().toISOString(),
    };
    setMessages((m) => [...m, visitor]);
    setInput('');
    setSending(true);
    const res = await client.send(embedKey, { text: visitor.text });
    setMessages((m) => [...m, res.reply]);
    setSending(false);
    // Announce the incoming assistant message (a11y live region, Arch §5.16).
    if (liveRef.current) liveRef.current.textContent = res.reply.text;
  };

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
          <p
            key={m.messageId}
            className={m.role === 'visitor' ? 'text-right text-vm-2' : 'text-vm-2'}
          >
            <span
              className={
                m.role === 'visitor'
                  ? 'inline-block rounded-vm-card bg-vm-accent-weak px-vm-3 py-vm-2'
                  : 'inline-block rounded-vm-card bg-vm-surface px-vm-3 py-vm-2'
              }
            >
              {m.text}
            </span>
          </p>
        ))}
        <div ref={liveRef} role="status" aria-live="polite" className="sr-only" />
      </div>
      <div className="flex gap-vm-2 border-t border-vm-border p-vm-3">
        <input
          aria-label="Type your message"
          className="min-h-[44px] flex-1 rounded-vm-control border border-vm-border px-vm-3 text-vm-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus"
          placeholder="Type your message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <Button variant="primary" onClick={send} disabled={sending}>
          Send
        </Button>
      </div>
      <div className="border-t border-vm-border px-vm-4 py-vm-2 text-vm-0 text-vm-text-muted">
        {boot?.poweredBy && 'Powered by VantageMind'}
      </div>
    </div>
  );
}
