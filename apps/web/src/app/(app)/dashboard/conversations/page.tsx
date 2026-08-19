'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Card,
  CardTitle,
  Button,
  Banner,
  Textarea,
  PageHeader,
  AssistantText,
  cn,
} from '@luciel/ui';
import type {
  Message,
  AnswerEvidence,
  SendMessageResult,
  MessageDeliveryDetail,
} from '@luciel/api-client';
import { LucielApiError } from '@luciel/api-client';
import { useSearchParams } from 'next/navigation';
import { useConversations, useEscalations } from '@/lib/hooks';
import { sessionChannelLabel } from '@/components/config/labels';
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
 * A failed transcript read, with the tone it deserves. `service_unavailable`
 * (503) is the archived-conversation case: the backend's own message says the
 * transcript is in long-term storage and nothing has been lost, so it renders
 * as a calm info notice with that copy verbatim — not as a danger banner that
 * suggests something broke or disappeared. Every other failure keeps the
 * generic danger treatment.
 */
type TranscriptError = { tone: 'info' | 'danger'; text: string };

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

/**
 * Grounding, paired with an icon + number so colour is never the only signal.
 *
 * Harmony wave 2, item 6b (backend contract: backend_gaps.md §"Harmony wave
 * 2", FE CONTRACT BLOCK, item 1 / backend item 2c): `scoringStatus ===
 * 'not_scored_legacy'` means this row predates real per-message grounding —
 * `groundingScore` on it is `null`, never the old uniform floor constant
 * (0.50) the backend used to fake for these rows. Presenting a legacy row as
 * "Grounded 0.50" states a specific measurement that was never taken. Those
 * rows must read "Not scored (before scoring existed)" instead — an honest
 * "we don't know", distinct from both "Grounded" and "Weakly grounded".
 */
function GroundingBadge({
  score,
  scoringStatus,
}: {
  score: number | null;
  scoringStatus: AnswerEvidence['scoringStatus'];
}) {
  if (scoringStatus === 'not_scored_legacy' || score === null) {
    return (
      <span className="inline-flex items-center gap-vm-1 rounded-vm-pill border border-vm-border bg-vm-bg px-vm-2 py-vm-1 text-vm-0 font-label text-vm-text-muted">
        <span aria-hidden="true">?</span>
        <span>Not scored (before scoring existed)</span>
      </span>
    );
  }
  const grounded = score >= GROUNDING_FLOOR;
  // Plain language for the owner ("Grounded 0.87" is a model-eval score shown
  // to a hairdresser); the real measurement stays one hover away in the title
  // so the number is preserved, not hidden.
  return (
    <span
      className={cn(
        'inline-flex items-center gap-vm-1 rounded-vm-pill border border-vm-border bg-vm-bg px-vm-2 py-vm-1 text-vm-0 font-label',
        grounded ? 'text-vm-success' : 'text-vm-warning',
      )}
      title={`Grounding score ${score.toFixed(2)} — answers below 0.50 are refused or escalated.`}
    >
      <span aria-hidden="true">{grounded ? '✓' : '!'}</span>
      <span>{grounded ? 'Backed by your knowledge' : 'Weakly backed — worth reviewing'}</span>
    </span>
  );
}

/** One name per source, even when several chunks came from the same document. */
const sourceNames = (e: AnswerEvidence) =>
  Array.from(new Set(e.sourceChunks.map((ch) => ch.sourceName)));

/** `'unavailable'` records an evidence fetch that failed, so we can say so. */
type EvidenceState = AnswerEvidence | 'unavailable';

/**
 * Escalation-email deep link (?open=<sessionId>): opens that conversation once
 * its row has loaded. Isolated in a child under <Suspense> because Next requires
 * a suspense boundary around useSearchParams consumers at build time.
 */
function OpenFromQuery({
  ready,
  onOpen,
}: {
  ready: string[];
  onOpen: (sessionId: string) => void;
}) {
  const params = useSearchParams();
  const requested = params.get('open');
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (!opened.current && requested && ready.includes(requested)) {
      opened.current = true;
      onOpen(requested);
    }
  }, [requested, ready, onOpen]);
  return null;
}

export default function ConversationsPage() {
  const conversations = useConversations();
  // Escalation badges ride a separate query: its failure degrades to a note and
  // must never hide the conversations list itself.
  const escalations = useEscalations();
  const escalatedSessions = React.useMemo(
    () => new Set((escalations.data ?? []).map((e) => e.sessionId)),
    [escalations.data],
  );
  const [listFilter, setListFilter] = React.useState<'all' | 'escalated'>('all');
  const qc = useQueryClient();
  const [openSession, setOpenSession] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [evidence, setEvidence] = React.useState<Record<string, EvidenceState>>({});
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [reply, setReply] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [delivery, setDelivery] = React.useState<Delivery | null>(null);
  const [replyError, setReplyError] = React.useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = React.useState(false);
  const [transcriptError, setTranscriptError] = React.useState<TranscriptError | null>(null);
  /** Session whose take-over / hand-back is in flight, so only that row disables. */
  const [modeBusy, setModeBusy] = React.useState<string | null>(null);
  const [modeError, setModeError] = React.useState<string | null>(null);
  const [flagBusy, setFlagBusy] = React.useState<string | null>(null);
  const [flagError, setFlagError] = React.useState<Record<string, string>>({});
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
    setFlagError({});
    setReply('');
    setMessages([]);
    setTranscriptError(null);
    setTranscriptLoading(true);
    try {
      const transcript = await api.conversations.getMessages(sessionId);
      if (openedSession.current !== sessionId) return;
      setMessages(transcript);
      void loadEvidence(sessionId, transcript);
    } catch (err) {
      if (openedSession.current !== sessionId) return;
      setTranscriptError(
        err instanceof LucielApiError && err.code === 'service_unavailable'
          ? { tone: 'info', text: err.message }
          : { tone: 'danger', text: 'We could not load this conversation. Please try again.' },
      );
    } finally {
      if (openedSession.current === sessionId) setTranscriptLoading(false);
    }
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

  /**
   * Take-over and hand-back change who is answering a live visitor, so a failure
   * that looks like a success is the worst outcome on this screen: the admin
   * would type into a conversation Luciel still owns. Both report.
   */
  const setMode = async (sessionId: string, next: 'take_over' | 'hand_back') => {
    if (modeBusy) return;
    setModeBusy(sessionId);
    setModeError(null);
    try {
      if (next === 'take_over') await api.conversations.takeOver(sessionId);
      else await api.conversations.handBack(sessionId);
      qc.invalidateQueries({ queryKey: qk.conversations });
    } catch {
      setModeError(
        next === 'take_over'
          ? 'We could not take over that conversation. Luciel is still answering it.'
          : 'We could not hand that conversation back. You are still holding it.',
      );
    } finally {
      setModeBusy(null);
    }
  };

  const flag = async (sessionId: string, messageId: string) => {
    setFlagBusy(messageId);
    setFlagError((prev) => {
      const { [messageId]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      await api.conversations.flagAnswer(sessionId, messageId);
      setEvidence((prev) => {
        const current = prev[messageId];
        if (!current || current === 'unavailable') return prev;
        return { ...prev, [messageId]: { ...current, flaggedByAdmin: true } };
      });
    } catch {
      setFlagError((prev) => ({
        ...prev,
        [messageId]: 'We could not flag that answer. Please try again.',
      }));
    } finally {
      setFlagBusy(null);
    }
  };

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Conversations"
        description="Review what your Luciel said, take over live when needed, and check the evidence behind any answer."
      />

      <React.Suspense fallback={null}>
        <OpenFromQuery
          ready={(conversations.data ?? []).map((c) => c.sessionId)}
          onOpen={(id) => void open(id)}
        />
      </React.Suspense>

      <div className="grid gap-vm-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Recent</CardTitle>
          <div className="mt-vm-2 flex items-center gap-vm-2" role="group" aria-label="Filter conversations">
            <Button
              variant={listFilter === 'all' ? 'primary' : 'secondary'}
              aria-pressed={listFilter === 'all'}
              onClick={() => setListFilter('all')}
            >
              All
            </Button>
            <Button
              variant={listFilter === 'escalated' ? 'primary' : 'secondary'}
              aria-pressed={listFilter === 'escalated'}
              onClick={() => setListFilter('escalated')}
            >
              Escalated
            </Button>
            {escalations.isError && (
              <span className="text-vm-0 text-vm-text-muted">
                Escalation badges are unavailable right now.
              </span>
            )}
          </div>
          {modeError && (
            <Banner tone="danger" className="mt-vm-3">
              {modeError}
            </Banner>
          )}
          {/* Loading, failure and "genuinely none yet" read differently (P1-6). */}
          {conversations.isPending ? (
            <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
              Loading conversations…
            </p>
          ) : conversations.isError ? (
            <Banner tone="danger" className="mt-vm-3">
              We could not load your conversations.{' '}
              <button className="underline" onClick={() => void conversations.refetch()}>
                Try again
              </button>
            </Banner>
          ) : (conversations.data?.length ?? 0) === 0 ? (
            <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
              No conversations yet. They appear here as soon as a visitor talks to your Luciel.
            </p>
          ) : (conversations.data ?? []).filter(
              (c) => listFilter === 'all' || escalatedSessions.has(c.sessionId),
            ).length === 0 ? (
            <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
              No escalated conversations in this list.
            </p>
          ) : (
            <ul className="mt-vm-3 divide-y divide-vm-border">
              {(conversations.data ?? [])
                .filter((c) => listFilter === 'all' || escalatedSessions.has(c.sessionId))
                .map((c) => {
                const busy = modeBusy === c.sessionId;
                const held = c.mode === 'human_controlled';
                return (
                  <li key={c.sessionId} className="py-vm-3">
                    <div className="flex items-center justify-between gap-vm-3">
                      <button
                        className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vm-focus"
                        onClick={() => void open(c.sessionId)}
                      >
                        <div className="truncate text-vm-2">
                          {c.summary ??
                            `In progress — started ${new Date(c.startedAt).toLocaleTimeString()}`}
                        </div>
                        {/* Human channel label, never the raw wire id — and
                            read-tolerant of old sessions still carrying the
                            retired combined `instagram_messenger` id. The #ref
                            matches the escalation email's "Conversation #". */}
                        <div className="text-vm-0 text-vm-text-muted">
                          {sessionChannelLabel(c.channel)} · {new Date(c.startedAt).toLocaleString()}{' '}
                          · #{c.sessionId.slice(0, 8)}
                          {escalatedSessions.has(c.sessionId) && (
                            <span className="ml-vm-2 inline-flex items-center rounded-vm-pill border border-vm-border px-vm-2 py-vm-1 font-label text-vm-warning">
                              Escalated
                            </span>
                          )}
                        </div>
                      </button>
                      <Button
                        variant="secondary"
                        disabled={modeBusy !== null}
                        onClick={() => void setMode(c.sessionId, held ? 'hand_back' : 'take_over')}
                      >
                        {busy
                          ? held
                            ? 'Handing back…'
                            : 'Taking over…'
                          : held
                            ? 'Hand back'
                            : 'Take over'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{openSession ? 'Transcript' : 'Select a conversation'}</CardTitle>
          {openSession && (
            <div className="mt-vm-3 space-y-vm-3">
              {transcriptLoading && (
                <p className="text-vm-1 text-vm-text-muted" role="status">
                  Loading the transcript…
                </p>
              )}
              {transcriptError && (
                <Banner tone={transcriptError.tone}>
                  {transcriptError.text}{' '}
                  <button className="underline" onClick={() => void open(openSession)}>
                    Try again
                  </button>
                </Banner>
              )}
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
                      {/* Luciel's answers carry markdown; the owner reads the same
                          rendering the visitor got, never literal `**` (P0-3).
                          Visitor and human-agent text stays a plain text node. */}
                      {m.role === 'luciel' ? (
                        <AssistantText text={m.text} className="inline-block align-top" />
                      ) : (
                        <span>{m.text}</span>
                      )}
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
                                {/* Harmony wave 2, item 6b (backend_gaps.md §"Harmony wave 2",
                                    FE CONTRACT BLOCK, item 2 / backend item 2a): NEVER decide
                                    this copy from `sourceChunks.length` alone — both
                                    `no_sources_retrieved` and `attribution_unavailable` carry
                                    an empty array, but only the former is an honest "no
                                    source" claim. Branch on `attributionStatus` first. */}
                                {answer.attributionStatus === 'has_sources' ? (
                                  <>
                                    <span className="font-label">Knowledge used: </span>
                                    {sourceNames(answer).join(', ')}
                                  </>
                                ) : answer.attributionStatus === 'attribution_unavailable' ? (
                                  "Source attribution isn't available yet."
                                ) : (
                                  'No knowledge source backed this answer.'
                                )}
                              </span>
                              <GroundingBadge
                                score={answer.groundingScore}
                                scoringStatus={answer.scoringStatus}
                              />
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
                              <>
                                <Button
                                  variant="ghost"
                                  className="mt-vm-2"
                                  disabled={flagBusy === m.messageId}
                                  onClick={() => void flag(openSession, m.messageId)}
                                >
                                  {flagBusy === m.messageId ? 'Flagging…' : 'Flag this answer'}
                                </Button>
                                {flagError[m.messageId] && (
                                  <Banner tone="danger" className="mt-vm-2">
                                    {flagError[m.messageId]}
                                  </Banner>
                                )}
                              </>
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
