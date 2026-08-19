import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import type { ConversationSummary, EscalationEvent, Message } from '@luciel/api-client';

/**
 * Escalation ↔ conversation correlation (live-caught 2026-08-18): the escalation
 * email references "Conversation #<ref>" and deep-links ?open=<sessionId>, but the
 * page rendered no id anywhere, no escalation badge, and no way to open a row from
 * a link. Pinned here: the #ref renders, escalated rows wear the badge, the filter
 * narrows to them, ?open= auto-opens the transcript, live rows are labeled
 * "In progress — started …" (never a bare 'Conversation'), and an escalations
 * fetch failure degrades to a note without hiding the list.
 */

const list = vi.fn<[], Promise<ConversationSummary[]>>();
const getMessages = vi.fn<[string], Promise<Message[]>>();
const listEscalations = vi.fn<[], Promise<EscalationEvent[]>>();

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

let openParam: string | null = null;

const ESCALATED_ID = '11111111-1111-4111-8111-111111111111';
const QUIET_ID = '22222222-2222-4222-8222-222222222222';

const conversations: ConversationSummary[] = [
  {
    sessionId: ESCALATED_ID,
    channel: 'voice',
    mode: 'ai',
    startedAt: '2026-08-18T02:28:00Z',
    lastMessageAt: '2026-08-18T02:29:00Z',
  },
  {
    sessionId: QUIET_ID,
    channel: 'widget',
    mode: 'ai',
    startedAt: '2026-08-18T01:00:00Z',
    lastMessageAt: '2026-08-18T01:05:00Z',
    summary: 'Asked about store hours.',
  },
];

const escalation: EscalationEvent = {
  escalationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sessionId: ESCALATED_ID,
  leadId: null,
  signal: 'cannot_answer',
  gate: 'outcome',
  firedAt: '2026-08-18T02:29:00Z',
  scoreOrConfidence: 0,
};

async function renderPage() {
  const { default: ConversationsPage } = await import(
    '@/app/(app)/dashboard/conversations/page'
  );
  renderWithQuery(<ConversationsPage />);
}

beforeEach(() => {
  openParam = null;
  list.mockReset().mockResolvedValue(conversations);
  getMessages.mockReset().mockResolvedValue([]);
  listEscalations.mockReset().mockResolvedValue([escalation]);
});

describe('escalation correlation on the conversations page', () => {
  it('renders the #ref and the Escalated badge on the right row', async () => {
    await renderPage();
    expect(await screen.findByText(new RegExp(`#${ESCALATED_ID.slice(0, 8)}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`#${QUIET_ID.slice(0, 8)}`))).toBeInTheDocument();
    expect(screen.getAllByText('Escalated').length).toBeGreaterThanOrEqual(1);
  });

  it('labels a live row "In progress — started …", never a bare Conversation', async () => {
    await renderPage();
    expect(await screen.findByText(/In progress — started/)).toBeInTheDocument();
    expect(screen.queryByText(/^Conversation$/)).not.toBeInTheDocument();
  });

  it('the Escalated filter narrows the list to escalated rows', async () => {
    await renderPage();
    await screen.findByText('Asked about store hours.');
    fireEvent.click(screen.getByRole('button', { name: 'Escalated', pressed: false }));
    await waitFor(() =>
      expect(screen.queryByText('Asked about store hours.')).not.toBeInTheDocument(),
    );
    expect(screen.getByText(new RegExp(`#${ESCALATED_ID.slice(0, 8)}`))).toBeInTheDocument();
  });

  it('?open= auto-opens that conversation transcript', async () => {
    openParam = ESCALATED_ID;
    await renderPage();
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith(ESCALATED_ID));
  });

  it('an escalations fetch failure leaves the list usable with a note', async () => {
    listEscalations.mockRejectedValue(new Error('down'));
    await renderPage();
    expect(await screen.findByText('Asked about store hours.')).toBeInTheDocument();
    expect(
      await screen.findByText(/Escalation badges are unavailable right now/),
    ).toBeInTheDocument();
  });
});
