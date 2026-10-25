import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import type { ConversationSummary, Message, SendMessageResult } from '@luciel/api-client';
import { LucielApiError } from '@luciel/api-client';
import { sessionChannelLabel } from '@/components/config/labels';

/**
 * Round 7 WP-3b, wired to the dashboard conversation routes:
 *  (4a) `endedAt` on a row disables Take over and withholds the compose box with
 *       the reason; a 409 `session_ended` from the take-over route renders verbatim;
 *  (4b) a human reply's PERSISTED outcome replays on reopen: failed with the served
 *       detail, delivered, queued (widget polling), and "not recorded" for null —
 *       never "delivered" for an unknown; a text reads "awaiting delivery
 *       confirmation" because the carrier receipt is not written to the row;
 *  (4c) `no_recipient_for_channel` and `meta_reconnect_needed` from the send carry
 *       honest copy with the Configure → channel path;
 *  (3d) `countedForBilling: false` labels an unbilled row so the row count never
 *       reads as the billed number.
 */

const list = vi.fn<() => Promise<ConversationSummary[]>>();
const getMessages = vi.fn<(a0: string) => Promise<Message[]>>();
const takeOver = vi.fn<(a0: string) => Promise<ConversationSummary>>();
const sendMessage = vi.fn<(a0: string, a1: string) => Promise<SendMessageResult>>();

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
        takeOver: (sessionId: string) => takeOver(sessionId),
        sendMessage: (sessionId: string, text: string) => sendMessage(sessionId, text),
        listEscalations: async () => [],
        getAnswerEvidence: async () => ({
          messageId: 'x',
          groundingScore: null,
          scoringStatus: 'not_applicable' as const,
          sourceChunks: [],
          attributionStatus: 'attribution_unavailable' as const,
          flaggedByAdmin: false,
        }),
      },
    },
  };
});

const ENDED_ID = '77777777-7777-4777-8777-777777777777';
const LIVE_ID = '88888888-8888-4888-8888-888888888888';
const UNBILLED_ID = '66666666-6666-4666-8666-666666666666';

const conversation = (over: Partial<ConversationSummary>): ConversationSummary => ({
  sessionId: LIVE_ID,
  channel: 'sms',
  mode: 'ai',
  startedAt: '2026-09-05T10:00:00Z',
  lastMessageAt: '2026-09-05T10:01:00Z',
  summary: 'Wants a quote',
  countedForBilling: true,
  ...over,
});

const ended = conversation({
  sessionId: ENDED_ID,
  mode: 'human_controlled',
  endedAt: '2026-09-05T10:30:00Z',
  summary: 'Asked for hours',
});
const unbilled = conversation({
  sessionId: UNBILLED_ID,
  channel: 'email',
  summary: 'Refused at cap',
  countedForBilling: false,
});

const visitor: Message = {
  messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  role: 'lead',
  text: 'can I talk to a person?',
  at: '2026-09-05T10:00:00Z',
};
const humanReply = (over: Partial<Message>): Message => ({
  messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  role: 'human_agent',
  text: 'Sure, this is Sam.',
  at: '2026-09-05T10:02:00Z',
  ...over,
});

const SESSION_ENDED_MESSAGE =
  'This conversation has ended, so there is nothing to take over or reply into (session_ended).';

async function renderPage() {
  const { default: ConversationsPage } = await import('@/app/(app)/dashboard/conversations/page');
  renderWithQuery(<ConversationsPage />);
}

/**
 * The send-time banner (role="status"), as opposed to the per-message outcome
 * line that repeats the same copy under the appended reply (4b) — both are
 * expected, so the banner is picked by its landmark.
 */
async function sendBanner(re: RegExp): Promise<HTMLElement> {
  const matches = await screen.findAllByText(re);
  const banner = matches.map((n) => n.closest('[role="status"]')).find(Boolean);
  if (!banner) throw new Error(`no status banner matched ${re}`);
  return banner as HTMLElement;
}

beforeEach(() => {
  openParam = null;
  getMessages.mockReset().mockResolvedValue([visitor]);
  takeOver.mockReset();
  sendMessage.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ended sessions (4a)', () => {
  it('shows the row as ended, withholds Take over and the compose box, and says why', async () => {
    openParam = ENDED_ID;
    list.mockReset().mockResolvedValue([ended, conversation({})]);
    await renderPage();
    const row = (await screen.findByText('Asked for hours')).closest('li') as HTMLElement;
    expect(within(row).getByText(/^Ended \d/)).toBeInTheDocument();
    expect(within(row).getByText('Ended — nothing to take over')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Take over|Hand back/ })).toBeNull();
    // The live row keeps its action.
    const live = screen.getByText('Wants a quote').closest('li') as HTMLElement;
    expect(within(live).getByRole('button', { name: 'Take over' })).toBeInTheDocument();

    // Opened: human_controlled would normally show the compose box — not once ended.
    expect(await screen.findByText('can I talk to a person?')).toBeInTheDocument();
    expect(
      screen.getByText(/This conversation ended .* can.t be taken over or replied into/),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Type your reply to the visitor…')).toBeNull();
  });

  it('renders the take-over 409 session_ended verbatim and re-reads the list', async () => {
    list
      .mockReset()
      .mockResolvedValueOnce([conversation({})])
      .mockResolvedValue([conversation({ endedAt: '2026-09-05T10:30:00Z' })]);
    takeOver.mockRejectedValue(
      new LucielApiError({ code: 'conflict', message: SESSION_ENDED_MESSAGE }),
    );
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Take over' }));
    expect(await screen.findByText(SESSION_ENDED_MESSAGE)).toBeInTheDocument();
    // Never the generic "could not take over" for a named state.
    expect(screen.queryByText(/We could not take over/)).toBeNull();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Ended — nothing to take over')).toBeInTheDocument();
  });
});

describe('persisted delivery outcomes on reopen (4b)', () => {
  it('replays failed / delivered / queued / not-recorded from the row, never "delivered" for unknown', async () => {
    openParam = LIVE_ID;
    list.mockReset().mockResolvedValue([conversation({ channel: 'email' })]);
    getMessages.mockResolvedValue([
      visitor,
      humanReply({
        messageId: 'f1',
        text: 'failed one',
        deliveryStatus: 'failed',
        deliveryDetail: 'mailbox_reconnect_needed',
      }),
      humanReply({
        messageId: 'd1',
        text: 'delivered one',
        deliveryStatus: 'delivered',
        deliveredAt: '2026-09-05T10:02:05Z',
      }),
      humanReply({
        messageId: 'q1',
        text: 'queued one',
        deliveryStatus: 'queued',
        deliveryDetail: 'widget_poll_only',
      }),
      humanReply({ messageId: 'u1', text: 'legacy one', deliveryStatus: null }),
    ]);
    await renderPage();
    await screen.findByText('failed one');
    const outcomes = screen.getAllByTestId('delivery-outcome').map((n) => n.textContent ?? '');
    expect(outcomes[0]).toMatch(/Saved, but not sent: your mailbox needs reconnecting/);
    expect(outcomes[1]).toMatch(/^Delivered /);
    expect(outcomes[2]).toMatch(/Sent — the visitor sees this on their next refresh/);
    expect(outcomes[2]).toMatch(/polling, not pushed/);
    expect(outcomes[3]).toBe(
      'Delivery outcome not recorded — this reply was sent before outcomes were kept.',
    );
    // The visitor's own message carries no outcome line.
    expect(outcomes).toHaveLength(4);
  });

  it('a text reads "awaiting delivery confirmation" — the carrier receipt is not on the row', async () => {
    openParam = LIVE_ID;
    list
      .mockReset()
      .mockResolvedValue([conversation({ channel: 'sms', mode: 'human_controlled' })]);
    getMessages.mockResolvedValue([
      visitor,
      humanReply({ deliveryStatus: 'delivered', deliveredAt: '2026-09-05T10:02:05Z' }),
    ]);
    sendMessage.mockResolvedValue({
      message: humanReply({ messageId: 'n1', text: 'new one', deliveryStatus: 'delivered' }),
      delivered: true,
      deliveryDetail: null,
    });
    await renderPage();
    await screen.findByText('Sure, this is Sam.');
    expect(screen.getByTestId('delivery-outcome')).toHaveTextContent(
      'Sent — awaiting delivery confirmation from the carrier.',
    );
    expect(screen.queryByText(/^Delivered/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Type your reply to the visitor…'), {
      target: { value: 'new one' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(LIVE_ID, 'new one'));
    // findAllByText resolves on the FIRST match (the reply already on the row), so on a
    // slow runner the new reply's line was not rendered yet (push CI 2026-10-25): wait
    // for the count itself.
    await waitFor(() =>
      expect(
        screen.getAllByText('Sent — awaiting delivery confirmation from the carrier.').length,
      ).toBeGreaterThanOrEqual(2),
    );
  });
});

describe('new send-time details (4c)', () => {
  it('no_recipient_for_channel: honest copy, never re-routed, with the Configure → channel path', async () => {
    openParam = LIVE_ID;
    list
      .mockReset()
      .mockResolvedValue([conversation({ channel: 'sms', mode: 'human_controlled' })]);
    sendMessage.mockResolvedValue({
      message: humanReply({ deliveryStatus: 'failed', deliveryDetail: 'no_recipient_for_channel' }),
      delivered: false,
      deliveryDetail: 'no_recipient_for_channel',
    });
    await renderPage();
    await screen.findByText('can I talk to a person?');
    fireEvent.change(screen.getByPlaceholderText('Type your reply to the visitor…'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    const sms = sessionChannelLabel('sms');
    const banner = await sendBanner(new RegExp(`we don.t know a ${sms} address for this person`));
    expect(banner).toHaveTextContent(/never re-routed/);
    expect(within(banner).getByRole('link', { name: `Configure → ${sms}` })).toHaveAttribute(
      'href',
      '/dashboard/configure',
    );
    // The appended reply carries the same persisted outcome under it (4b).
    expect(screen.getByTestId('delivery-outcome')).toHaveTextContent(/never re-routed/);
  });

  it('meta_reconnect_needed: reconnect Meta under Configure → channel, not "try again"', async () => {
    openParam = LIVE_ID;
    list
      .mockReset()
      .mockResolvedValue([conversation({ channel: 'instagram', mode: 'human_controlled' })]);
    sendMessage.mockResolvedValue({
      message: humanReply({ deliveryStatus: 'failed', deliveryDetail: 'meta_reconnect_needed' }),
      delivered: false,
      deliveryDetail: 'meta_reconnect_needed',
    });
    await renderPage();
    await screen.findByText('can I talk to a person?');
    fireEvent.change(screen.getByPlaceholderText('Type your reply to the visitor…'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    const banner = await sendBanner(/your Meta connection needs reconnecting/);
    expect(banner).not.toHaveTextContent(/try again/i);
    expect(
      within(banner).getByRole('link', { name: `Configure → ${sessionChannelLabel('instagram')}` }),
    ).toBeInTheDocument();
  });

  it('a reply refused with session_ended renders the server message, never a generic failure', async () => {
    openParam = LIVE_ID;
    list
      .mockReset()
      .mockResolvedValue([conversation({ channel: 'sms', mode: 'human_controlled' })]);
    sendMessage.mockRejectedValue(
      new LucielApiError({ code: 'conflict', message: SESSION_ENDED_MESSAGE }),
    );
    await renderPage();
    await screen.findByText('can I talk to a person?');
    fireEvent.change(screen.getByPlaceholderText('Type your reply to the visitor…'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(await screen.findByText(SESSION_ENDED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('We could not send that reply. Please try again.')).toBeNull();
  });
});

describe('unbilled conversations (3d)', () => {
  it('labels a row the server says was not counted, and only that row', async () => {
    list.mockReset().mockResolvedValue([conversation({}), unbilled]);
    await renderPage();
    const row = (await screen.findByText('Refused at cap')).closest('li') as HTMLElement;
    expect(
      within(row).getByText('not billed — refused at capacity or lost to an outage'),
    ).toBeInTheDocument();
    const billed = screen.getByText('Wants a quote').closest('li') as HTMLElement;
    expect(within(billed).queryByText(/not billed/)).toBeNull();
  });
});
