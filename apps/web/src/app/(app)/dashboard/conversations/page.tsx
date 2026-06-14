'use client';

import * as React from 'react';
import { Card, CardTitle, Button, StatusChip, Banner } from '@luciel/ui';
import type { Message, AnswerEvidence } from '@luciel/api-client';
import { useConversations } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/hooks';

/**
 * Conversations + answer review (Customer Journey §7; Arch §3.4.12, §3.4.13).
 *  - Live takeover / hand back (human_controlled mode).
 *  - Answer review: the source chunks Luciel used + the grounding score, with a
 *    flag action that corrects at the knowledge root (within this account only).
 */
export default function ConversationsPage() {
  const conversations = useConversations();
  const qc = useQueryClient();
  const [openSession, setOpenSession] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [evidence, setEvidence] = React.useState<AnswerEvidence | null>(null);

  const open = async (sessionId: string) => {
    setOpenSession(sessionId);
    setEvidence(null);
    setMessages(await api.conversations.getMessages(sessionId));
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
      <h1 className="font-heading text-vm-5">Conversations</h1>

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
                  <span className="font-label capitalize text-vm-text-muted">{m.role}: </span>
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
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
