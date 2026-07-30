'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardTitle, Button, Banner, Textarea, PageHeader, cn } from '@luciel/ui';
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
 *
 * The evidence is not hidden behind a click (Decision #10): every Luciel answer
 * carries its grounding and the knowledge it used inline, with the verbatim text
 * one tap away, so "which knowledge produced this?" is answerable at a glance.
 */

/** Server-enforced reply length (Arch §11.5). */
const REPLY_MAX_CHARS = 4000;

/** Uniform grounding floor (Vision §3.3) — below it, the answer is thinly backed. */
const GROUNDING_FLOOR = 0.5;

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

/** Grounding, paired with an icon + number so colour is never the only signal. */
function GroundingBadge({ score }: { score: number }) {
  const grounded = score >= GROUNDING_FLOOR;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-vm-1 rounded-vm-pill border border-vm-border bg-vm-bg px-vm-2 py-vm-1 text-vm-0 font-label',
        grounded ? 'text-vm-success' : 'text-vm-warning',
      )}
    >
      <span aria-hidden="true">{grounded ? '✓' : '!'}</span>
      <span>
        {grounded ? 'Grounded' : 'Weakly grounded'} {score.toFixed(2)}
      </span>
    </span>
  );
}

/** One name per source, even when several chunks came from the same document. */
const sourceNames = (e: AnswerEvidence) =>
  Array.from(new Set(e.sourceChunks.map((ch) => ch.sourceName)));

/** `'unavailable'` records an evidence fetch that failed, so we can say so. */
type EvidenceState = AnswerEvidence | 'unavailable';

export default function ConversationsPage() {
  const conversations = useConversations();
  const qc = useQueryClient();
  const [openSession, setOpenSession] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [evidence, setEvidence] = React.useState<Record<string, EvidenceState>>({});
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [reply, setReply] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [delivery, setDelivery] = React.useState<Delivery | null>(null);
  const [replyError, setReplyError] = React.useState<string | null>(null);
  /** Which transcript the in-flight fetches belong to, so a fast switch can't cross-fill. */
  const openedSession = React.useRef<string | null>(null);

  const openConversation = conversations.data?.find((c) => c.sessionId === openSession);

  /**
   * Evidence still comes one request per answer — that is the only endpoint —
   * but it is fetched with the transcript rather than on a click, because the
   * whole point of this screen is seeing what backed each answer.
   */
  const loadEvidence = async (sessionId: string, transcript: Message[]) => {
    await Promise.all(
      transcript
        .filter((m) => m.role === 'luciel')
        .map(async (m) => {
          const result = await api.conversations
            .getAnswerEvidence(sessionId, m.messageId)
            .catch((): EvidenceState => 'unavailable');
          if (openedSession.current !== sessionId) return;
          setEvidence((prev) => ({ ...prev, [m.messageId]: result }));
        }),
    );
  };

  const open = async (sessionId: string) => {
    setOpenSession(sessionId);
    openedSession.current = sessionId;
    setEvidence({});
    setExpanded({});
    setDelivery(null);
    setReplyError(null);
    setReply('');
    const transcript = await api.conversations.getMessages(sessionId);
    if (openedSession.current !== sessionId) return;
    setMessages(transcript);
    void loadEvidence(sessionId, transcript);
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

  const flag = async (sessionId: string, messageId: string) => {
    await api.conversations.flagAnswer(sessionId, messageId);
    setEvidence((prev) => {
      const current = prev[messageId];
      if (!current || current === 'unavailable') return prev;
      return { ...prev, [messageId]: { ...current, flaggedByAdmin: true } };
    });
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
              {messages.map((m) => {
                const answer = m.role === 'luciel' ? evidence[m.messageId] : undefined;
                const isOpen = Boolean(expanded[m.messageId]);
                return (
                  <div key={m.messageId} className="text-vm-1">
                    <div>
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
                    </div>

                    {/* Evidence sits under the answer it belongs to (Decision #10). */}
                    {m.role === 'luciel' && (
                      <div className="mt-vm-2 rounded-vm-card border border-vm-border bg-vm-surface p-vm-3">
                        {!answer ? (
                          <p className="text-vm-0 text-vm-text-muted" role="status">
                            Loading the knowledge this answer used…
                          </p>
                        ) : answer === 'unavailable' ? (
                          <p className="text-vm-0 text-vm-text-muted">
                            We could not load the evidence for this answer right now.
                          </p>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-vm-2">
                              <span className="text-vm-0 text-vm-text-muted">
                                {answer.sourceChunks.length > 0 ? (
                                  <>
                                    <span className="font-label">Knowledge used: </span>
                                    {sourceNames(answer).join(', ')}
                                  </>
                                ) : (
                                  'No knowledge source backed this answer.'
                                )}
                              </span>
                              <GroundingBadge score={answer.groundingScore} />
                            </div>

                            {answer.sourceChunks.length > 0 && (
                              <>
                                <Button
                                  variant="ghost"
                                  className="mt-vm-2"
                                  aria-expanded={isOpen}
                                  onClick={() =>
                                    setExpanded((prev) => ({ ...prev, [m.messageId]: !isOpen }))
                                  }
                                >
                                  {isOpen ? 'Hide the exact text' : 'Show the exact text'}
                                </Button>
                                {isOpen && (
                                  <ul className="mt-vm-2 space-y-vm-2 text-vm-0">
                                    {answer.sourceChunks.map((ch, i) => (
                                      <li
                                        key={i}
                                        className="rounded-vm-control border border-vm-border bg-vm-bg p-vm-2"
                                      >
                                        <div className="font-label">{ch.sourceName}</div>
                                        <div className="whitespace-pre-wrap text-vm-text-muted">
                                          {ch.text}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            )}

                            {answer.flaggedByAdmin ? (
                              <Banner tone="info" className="mt-vm-2">
                                Flagged. Fix the source in your knowledge base to correct future
                                answers — the fix stays within your account.
                              </Banner>
                            ) : (
                              <Button
                                variant="ghost"
                                className="mt-vm-2"
                                onClick={() => flag(openSession, m.messageId)}
                              >
                                Flag this answer
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

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
