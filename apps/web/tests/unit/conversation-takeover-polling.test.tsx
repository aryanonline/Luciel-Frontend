import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import type { ConversationSummary, EscalationEvent, Message } from '@luciel/api-client';

/**
 * 2026-09-05 audit F147: while a person holds a conversation the visitor keeps
 * typing, and the owner used to see nothing new until they refreshed. The open
 * transcript now polls every 5 s while the conversation is human-controlled —
 * polling, never a push claim — and stays quiet while Luciel has it.
 */

const list = vi.fn<[], Promise<ConversationSummary[]>>();
const getMessages = vi.fn<[string], Promise<Message[]>>();
const listEscalations = vi.fn<[], Promise<EscalationEvent[]>>();

let openParam: string | null = null;

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useSearchParams: () => new URLSearchParams(openParam ? { open: openParam } : {}),
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      conversations: {
        ...actual.api.conversations,
        list: () => list(),
        getMessages: (sessionId: string) => getMessages(sessionId),
        listEscalations: () => listEscalations(),
      },
    },
  };
});

const HELD_ID = '33333333-3333-4333-8333-333333333333';
const QUIET_ID = '44444444-4444-4444-8444-444444444444';

const conversation = (sessionId: string, mode: 'ai' | 'human_controlled'): ConversationSummary => ({
  sessionId,
  channel: 'widget',
  mode,
  startedAt: '2026-09-05T10:00:00Z',
  lastMessageAt: '2026-09-05T10:01:00Z',
  summary: 'Wants a quote',
});

const first: Message = {
  messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  role: 'lead',
  text: 'can I talk to a person?',
  at: '2026-09-05T10:00:00Z',
};
const second: Message = {
  messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  role: 'lead',
  text: 'still there? my number is on file',
  at: '2026-09-05T10:01:00Z',
};

async function renderPage() {
  const { default: ConversationsPage } = await import('@/app/(app)/dashboard/conversations/page');
  renderWithQuery(<ConversationsPage />);
}

beforeEach(() => {
  // Only intervals are faked: testing-library's waitFor keeps its real timers.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  getMessages.mockReset().mockResolvedValue([first]);
  listEscalations.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('transcript polling during a human takeover', () => {
  it('polls the open transcript while a person holds the conversation', async () => {
    openParam = HELD_ID;
    list.mockReset().mockResolvedValue([conversation(HELD_ID, 'human_controlled')]);
    await renderPage();
    expect(await screen.findByText('can I talk to a person?')).toBeInTheDocument();
    expect(getMessages).toHaveBeenCalledTimes(1);

    getMessages.mockResolvedValue([first, second]);
    vi.advanceTimersByTime(5000);
    expect(await screen.findByText('still there? my number is on file')).toBeInTheDocument();
    expect(getMessages).toHaveBeenCalledTimes(2);
  });

  it('stays quiet while Luciel has the conversation', async () => {
    openParam = QUIET_ID;
    list.mockReset().mockResolvedValue([conversation(QUIET_ID, 'ai')]);
    await renderPage();
    expect(await screen.findByText('can I talk to a person?')).toBeInTheDocument();

    vi.advanceTimersByTime(15000);
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1));
  });
});
