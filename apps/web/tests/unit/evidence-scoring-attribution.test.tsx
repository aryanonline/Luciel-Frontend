import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import type { AnswerEvidence, ConversationSummary, Message } from '@luciel/api-client';

/**
 * Harmony wave 2, item 6b (backend_gaps.md §"Harmony wave 2", FE CONTRACT
 * BLOCK items 1–2; backend items 2a/2c).
 *
 * Two backend enums replace booleans that never shipped:
 *  - `scoringStatus: 'scored' | 'not_scored_legacy'` — legacy rows carry
 *    `groundingScore: null`, never the old 0.50 floor. Must render "Not
 *    scored (before scoring existed)", never a number, never "Grounded 0.50".
 *  - `attributionStatus: 'has_sources' | 'no_sources_retrieved' |
 *    'attribution_unavailable'` — a 3-state enum. `no_sources_retrieved` is
 *    the ONLY state where "No knowledge source backed this answer" is a true
 *    claim; `attribution_unavailable` carries an equally empty
 *    `sourceChunks` but must render "Source attribution isn't available
 *    yet" — the live item-2a bug was a verbatim KB-backed 0.36-scored reply
 *    falsely shown as sourceless because the UI keyed off
 *    `sourceChunks.length` alone.
 *
 * Mocks `api.conversations` directly (test-level API mock, mirrors
 * meta-channel.test.tsx) so each scenario can pin the exact evidence shape
 * the real component receives — the shared mock-admin adapter only returns
 * one fixed shape and can't drive these branches.
 */

const list = vi.fn<[], Promise<ConversationSummary[]>>();
const getMessages = vi.fn<[string], Promise<Message[]>>();
const getAnswerEvidence = vi.fn<[string, string], Promise<AnswerEvidence>>();

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
        getAnswerEvidence: (sessionId: string, messageId: string) =>
          getAnswerEvidence(sessionId, messageId),
        listEscalations: () => Promise.resolve([]),
      },
    },
  };
});

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

const conversation: ConversationSummary = {
  sessionId: SESSION_ID,
  channel: 'widget',
  mode: 'autopilot',
  startedAt: '2026-08-01T10:00:00Z',
  lastMessageAt: '2026-08-01T10:05:00Z',
};

const lucielMessage: Message = {
  messageId: MESSAGE_ID,
  role: 'luciel',
  text: 'Our starter engagement is $899.',
  at: '2026-08-01T10:05:00Z',
};

function evidence(overrides: Partial<AnswerEvidence>): AnswerEvidence {
  return {
    messageId: MESSAGE_ID,
    groundingScore: 0.82,
    scoringStatus: 'scored',
    sourceChunks: [{ sourceId: 'src-1', sourceName: 'Services brochure.pdf', text: 'x' }],
    attributionStatus: 'has_sources',
    flaggedByAdmin: false,
    ...overrides,
  };
}

/** Opens the one seeded conversation row, the same click path a real admin uses. */
async function openConversation() {
  const { default: ConversationsPage } = await import('@/app/(app)/dashboard/conversations/page');
  renderWithQuery(<ConversationsPage />);
  const row = await screen.findByRole('button', { name: /widget/i });
  fireEvent.click(row);
  await waitFor(() => expect(getAnswerEvidence).toHaveBeenCalled());
}

beforeEach(() => {
  vi.resetModules();
  list.mockResolvedValue([conversation]);
  getMessages.mockResolvedValue([lucielMessage]);
  getAnswerEvidence.mockReset();
  list.mockClear();
  getMessages.mockClear();
});

describe('Harmony wave 2, item 6b: scoringStatus', () => {
  it('renders the plain-language badge with the real number preserved in the tooltip', async () => {
    getAnswerEvidence.mockResolvedValue(evidence({ scoringStatus: 'scored', groundingScore: 0.82 }));
    await openConversation();
    // Owner-facing copy is plain language, not a raw model-eval score…
    const badge = await screen.findByText('Backed by your knowledge');
    // …but the real measurement is preserved one hover away, never fabricated.
    expect(badge.closest('span[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('0.82'),
    );
    expect(screen.queryByText(/Not scored/)).not.toBeInTheDocument();
  });

  it('renders "Not scored (before scoring existed)" for scoringStatus: not_scored_legacy, never a number or a backed badge', async () => {
    getAnswerEvidence.mockResolvedValue(
      evidence({ scoringStatus: 'not_scored_legacy', groundingScore: null }),
    );
    await openConversation();
    expect(await screen.findByText('Not scored (before scoring existed)')).toBeInTheDocument();
    expect(screen.queryByText(/0\.50/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Backed by your knowledge/)).not.toBeInTheDocument();
  });
});

describe('Harmony wave 2, item 6b: attributionStatus', () => {
  it('renders real source names for attributionStatus: has_sources', async () => {
    getAnswerEvidence.mockResolvedValue(
      evidence({
        attributionStatus: 'has_sources',
        sourceChunks: [{ sourceId: 'src-1', sourceName: 'Services brochure.pdf', text: 'x' }],
      }),
    );
    await openConversation();
    expect(await screen.findByText(/Services brochure\.pdf/)).toBeInTheDocument();
    expect(screen.queryByText(/No knowledge source backed this answer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Source attribution isn't available yet/)).not.toBeInTheDocument();
  });

  it('renders "No knowledge source backed this answer" ONLY for attributionStatus: no_sources_retrieved (honest empty retrieval)', async () => {
    getAnswerEvidence.mockResolvedValue(
      evidence({ attributionStatus: 'no_sources_retrieved', sourceChunks: [] }),
    );
    await openConversation();
    expect(await screen.findByText(/No knowledge source backed this answer/)).toBeInTheDocument();
    expect(screen.queryByText(/Source attribution isn't available yet/)).not.toBeInTheDocument();
  });

  it('renders "Source attribution isn\'t available yet" for attributionStatus: attribution_unavailable, NEVER the false "no source" claim (item-2a bug)', async () => {
    getAnswerEvidence.mockResolvedValue(
      evidence({ attributionStatus: 'attribution_unavailable', sourceChunks: [] }),
    );
    await openConversation();
    expect(await screen.findByText(/Source attribution isn't available yet/)).toBeInTheDocument();
    expect(screen.queryByText(/No knowledge source backed this answer/)).not.toBeInTheDocument();
  });

  it('does not decide the copy from sourceChunks.length alone: attribution_unavailable and no_sources_retrieved both carry an empty array but render different copy', async () => {
    getAnswerEvidence.mockResolvedValue(
      evidence({ attributionStatus: 'attribution_unavailable', sourceChunks: [] }),
    );
    await openConversation();
    // Regression guard for the live bug: a KB-backed, scored-0.36 reply with
    // attribution_unavailable must never show the honest-empty-retrieval copy.
    expect(screen.queryByText(/No knowledge source backed this answer/)).not.toBeInTheDocument();
  });
});
