import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import type { ConversationSummary, Message } from '@luciel/api-client';

/**
 * Archived-transcript honesty (backend 503 → 'service_unavailable'): a
 * conversation older than 90 days lives in cold storage, and a failed archive
 * read means "in long-term storage, nothing lost, retry shortly" — the
 * backend says exactly that in its 503 body. The page must show that message
 * verbatim in a calm info banner, not downgrade a known recoverable state to
 * the generic danger "We could not load this conversation." That copy stays
 * for every other failure.
 *
 * Mocks `api.conversations` directly (test-level API mock, mirrors
 * evidence-scoring-attribution.test.tsx) so getMessages can reject with the
 * exact error shape each scenario needs.
 */

const list = vi.fn<[], Promise<ConversationSummary[]>>();
const getMessages = vi.fn<[string], Promise<Message[]>>();

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
        listEscalations: () => Promise.resolve([]),
      },
    },
  };
});

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const conversation: ConversationSummary = {
  sessionId: SESSION_ID,
  channel: 'widget',
  mode: 'autopilot',
  startedAt: '2026-05-01T10:00:00Z',
  lastMessageAt: '2026-05-01T10:05:00Z',
};

const ARCHIVE_MESSAGE =
  'This conversation is in long-term storage and could not be loaded right now. ' +
  'Nothing has been lost; please try again shortly.';

/**
 * The page's `instanceof LucielApiError` check only passes when the error was
 * built from the SAME module instance the page imports — and `vi.resetModules()`
 * gives each test a fresh registry, so the class must be pulled dynamically
 * here rather than through a top-level import evaluated before the reset.
 */
async function archiveUnavailableError() {
  const { LucielApiError } = await import('@luciel/api-client');
  return new LucielApiError({ code: 'service_unavailable', message: ARCHIVE_MESSAGE });
}

/** Opens the one seeded conversation row, the same click path a real admin uses. */
async function openConversation() {
  const { default: ConversationsPage } = await import('@/app/(app)/dashboard/conversations/page');
  renderWithQuery(<ConversationsPage />);
  const row = await screen.findByRole('button', { name: /widget/i });
  fireEvent.click(row);
}

beforeEach(() => {
  vi.resetModules();
  list.mockResolvedValue([conversation]);
  getMessages.mockReset();
  list.mockClear();
});

describe('archived transcript (503 → service_unavailable)', () => {
  it("shows the backend's own message in a calm info banner, not the generic danger copy", async () => {
    getMessages.mockRejectedValue(await archiveUnavailableError());
    await openConversation();

    const notice = await screen.findByText(ARCHIVE_MESSAGE);
    expect(notice).toBeInTheDocument();
    expect(screen.queryByText(/We could not load this conversation/)).not.toBeInTheDocument();
    // Nothing has been lost, so the banner must not carry the danger treatment.
    expect(notice.closest('[role="status"]')?.className).not.toContain('text-vm-danger');
    // Retrying still has to be one click away.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the generic danger copy for any other failure', async () => {
    getMessages.mockRejectedValue(new Error('boom'));
    await openConversation();

    const notice = await screen.findByText(/We could not load this conversation/);
    expect(notice).toBeInTheDocument();
    expect(notice.closest('[role="status"]')?.className).toContain('text-vm-danger');
  });
});
