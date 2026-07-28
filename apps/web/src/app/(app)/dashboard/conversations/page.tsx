'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardTitle, Button, StatusChip, Banner, Textarea, PageHeader } from '@luciel/ui';
import type {
  Message,
  AnswerEvidence,
  SendMessageResult,
  MessageDeliveryDetail,
} from '@luciel/api-client';
import { LucielApiError } from '@luciel/api-client';
import { useConversations } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/hooks';

/**
 * Conversations + answer review (Customer Journey §7; Arch §3.4.12, §3.4.13).
 *  - Live takeover / hand back (human_controlled mode), and the compose box the
 *    admin types into while they hold the conversation.
 *  - Answer review: the source chunks Luciel used + the grounding score, with a
 *    flag action that corrects at the knowledge root (within this account only).
 */

/** Server-enforced reply length (Arch §11.5). */
const REPLY_MAX_CHARS = 4000;

const ROLE_LABEL: Record<Message['role'], string> = {
  lead: 'Visitor',
  luciel: 'Luciel',
  human_agent: 'You',
};

type Delivery = { tone: 'info' | 'warning'; text: React.ReactNode };

/**
 * How a reply landed. `delivered: false` is a normal outcome, not a failure —
 * for the widget it is the ONLY outcome, because there is no push transport to
 * a browser we hold no connection to; the reply is persisted and the visitor
 * sees it on their next refresh. `no_recipient` / `channel_not_provisioned` are
 * actionable: the admin needs contact details or a sender connection.
 */
function describeDelivery(result: SendMessageResult): Delivery {
  if (result.delivered) return { tone: 'info', text: 'Sent to the visitor.' };
  const connect = (
    <>
      {' '}
      <Link href="/dashboard/configure" className="text-vm-accent underline">
        Set up a sender
      </Link>{' '}
      so replies can go out.
    </>
  );
  const detail: MessageDeliveryDetail | null | undefined = result.deliveryDetail;
  switch (detail) {
    case 'no_recipient':
      return {
        tone: 'warning',
        text: <>Sent — but we have no contact details for this lead, so there was nowhere to deliver it.{connect}</>,
      };
    case 'channel_not_provisioned':
      return {
        tone: 'warning',
        text: <>Sent — but this channel has no sender connected yet, so it could not go out.{connect}</>,
      };
    case 'unsupported_channel':
      return { tone: 'warning', text: 'Sent and saved — this channel cannot send replies out.' };
    case 'send_failed':
      return {
        tone: 'warning',
        text: 'Sent and saved, but the channel rejected the delivery. Try again in a moment.',
      };
    default:
      return {
        tone: 'info',
        text: 'Sent — the visitor will see this on their next refresh.',
      };
  }
}

export default function ConversationsPage() {
  const conversations = useConversations();
  const qc = useQueryClient();
  const [openSession, setOpenSession] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [evidence, setEvidence] = React.useState<AnswerEvidence | null>(null);
  const [reply, setReply] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [delivery, setDelivery] = React.useState<Delivery | null>(null);
  const [replyError, setReplyError] = React.useState<string | null>(null);

  const openConversation = conversations.data?.find((c) => c.sessionId === openSession);

  const open = async (sessionId: string) => {
    setOpenSession(sessionId);
    setEvidence(null);
    setDelivery(null);
    setReplyError(null);
    setReply('');
    setMessages(await api.conversations.getMessages(sessionId));
  };

  const send = async () => {
    if (!openSession) return;
    const text = reply.trim();
    if (!text || text.length > REPLY_MAX_CHARS) return;
    setSending(true);
    setReplyError(null);
    setDelivery(null);
    try {
      const result = await api.conversations.sendMessage(openSession, text);
      // Append optimistically; a later fetch returns it in the same order.
      setMessages((prev) => [...prev, result.message]);
      setDelivery(describeDelivery(result));
      setReply('');
      qc.invalidateQueries({ queryKey: qk.conversations });
    } catch (err) {
      setReplyError(
        err instanceof LucielApiError && err.code === 'validation_error'
          ? err.message
          : 'We could not send that reply. Please try again.',
      );
    } finally {
      setSending(false);
    }
  };

  const takeOver = async (sessionId: string) => {
    await api.conversations.takeOver(sessionId);
    qc.invalidateQueries({ queryKey: qk.conversations });
  };
  const handBack = async (sessionId: string) => {
    await api.conversations.handBack(sessionId);
    qc.invalidateQueries({ queryKey: qk.conversations });
  };

  const reviewAnswer = async (sessionId: string, messageId: string) => {
    setEvidence(await api.conversations.getAnswerEvidence(sessionId, messageId));
  };
  const flag = async (sessionId: string, messageId: string) => {
    await api.conversations.flagAnswer(sessionId, messageId);
    if (evidence) setEvidence({ ...evidence, flaggedByAdmin: true });
  };

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Conversations"
        description="Review what your Luciel said, take over live when needed, and check the evidence behind any answer."
      />

      <div className="grid gap-vm-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Recent</CardTitle>
          <ul className="mt-vm-3 divide-y divide-vm-border">
            {conversations.data?.map((c) => (
              <li key={c.sessionId} className="py-vm-3">
                <div className="flex items-center justify-between gap-vm-3">
                  <button
                    className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus"
                    onClick={() => open(c.sessionId)}
                  >
                    <div className="truncate text-vm-2">{c.summary ?? 'Conversation'}</div>
                    <div className="text-vm-0 text-vm-text-muted">
                      {c.channel} · {new Date(c.startedAt).toLocaleString()}
                    </div>
                  </button>
                  {c.mode === 'human_controlled' ? (
                    <Button variant="secondary" onClick={() => handBack(c.sessionId)}>
                      Hand back
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => takeOver(c.sessionId)}>
                      Take over
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>{openSession ? 'Transcript' : 'Select a conversation'}</CardTitle>
          {openSession && (
            <div className="mt-vm-3 space-y-vm-3">
              {messages.map((m) => (
                <div key={m.messageId} className="text-vm-1">
                  <span
                    className={
                      m.role === 'human_agent'
                        ? 'font-label text-vm-accent'
                        : 'font-label text-vm-text-muted'
                    }
                  >
                    {ROLE_LABEL[m.role]}:{' '}
                  </span>
                  <span>{m.text}</span>
                  {m.role === 'luciel' && (
                    <Button
                      variant="ghost"
                      className="ml-vm-2 align-baseline"
                      onClick={() => reviewAnswer(openSession, m.messageId)}
                    >
                      Review answer
                    </Button>
                  )}
                </div>
              ))}

              {evidence && (
                <div className="mt-vm-3 rounded-vm-card border border-vm-border bg-vm-surface p-vm-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-vm-1 font-label">Answer evidence</h4>
                    <StatusChip
                      kind={evidence.groundingScore >= 0.5 ? 'connected' : 'reconnect_needed'}
                      detail={`grounding ${evidence.groundingScore.toFixed(2)}`}
                    />
                  </div>
                  <ul className="mt-vm-2 space-y-vm-2 text-vm-0">
                    {evidence.sourceChunks.map((ch, i) => (
                      <li
                        key={i}
                        className="rounded-vm-control border border-vm-border bg-vm-bg p-vm-2"
                      >
                        <div className="font-label">{ch.sourceName}</div>
                        <div className="text-vm-text-muted">{ch.text}</div>
                      </li>
                    ))}
                  </ul>
                  {evidence.flaggedByAdmin ? (
                    <Banner tone="info" className="mt-vm-2">
                      Flagged. Fix the source in your knowledge base to correct future answers — the
                      fix stays within your account.
                    </Banner>
                  ) : (
                    <Button
                      variant="ghost"
                      className="mt-vm-2"
                      onClick={() => flag(openSession, evidence.messageId)}
                    >
                      Flag this answer
                    </Button>
                  )}
                </div>
              )}

              {/* Compose — only while this admin holds the conversation (§3.4.12). */}
              {openConversation?.mode === 'human_controlled' && (
                <div className="mt-vm-4 border-t border-vm-border pt-vm-3">
                  <label htmlFor="reply" className="text-vm-1 font-label">
                    You are replying as yourself — Luciel is not answering this conversation.
                  </label>
                  <Textarea
                    id="reply"
                    className="mt-vm-2"
                    value={reply}
                    maxLength={REPLY_MAX_CHARS}
                    placeholder="Type your reply to the visitor…"
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <div className="mt-vm-2 flex items-center justify-between gap-vm-3">
                    <span className="text-vm-0 text-vm-text-muted">
                      {reply.length}/{REPLY_MAX_CHARS}
                    </span>
                    <Button
                      variant="primary"
                      disabled={sending || reply.trim().length === 0}
                      onClick={() => void send()}
                    >
                      {sending ? 'Sending…' : 'Send reply'}
                    </Button>
                  </div>
                  {delivery && (
                    <Banner tone={delivery.tone} className="mt-vm-2">
                      {delivery.text}
                    </Banner>
                  )}
                  {replyError && (
                    <Banner tone="danger" className="mt-vm-2">
                      {replyError}
                    </Banner>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
