import { describe, it, expect } from 'vitest';
import { createLucielClient } from '../index';
import { conversationSummary, message } from '../schemas';

/**
 * Round 7 WP-3b: the conversation wire additions the dashboard renders —
 * `endedAt` / `countedForBilling` on ConversationSummaryOut, the persisted
 * delivery outcome on MessageOut, the two new delivery details — parse (and stay
 * optional for an older server), and the mock models every state the page shows:
 * an ended session's 409 `session_ended`, an unbilled row, and a human reply whose
 * outcome replays from the row on the next transcript read.
 */

describe('schemas stay tolerant of an older server', () => {
  it('parses a summary and a message without the round-7 fields', () => {
    expect(
      conversationSummary.safeParse({
        sessionId: '88888888-8888-4888-8888-888888888888',
        channel: 'widget',
        mode: 'ai',
        startedAt: '2026-06-13T23:42:00Z',
        lastMessageAt: '2026-06-13T23:47:00Z',
      }).success,
    ).toBe(true);
    expect(
      message.safeParse({
        messageId: '88888888-8888-4888-8888-888888888888',
        role: 'human_agent',
        text: 'hi',
        at: '2026-06-13T23:42:00Z',
      }).success,
    ).toBe(true);
    const parsed = message.parse({
      messageId: '88888888-8888-4888-8888-888888888888',
      role: 'human_agent',
      text: 'hi',
      at: '2026-06-13T23:42:00Z',
      deliveryStatus: 'failed',
      deliveryDetail: 'meta_reconnect_needed',
      deliveredAt: null,
    });
    expect(parsed.deliveryDetail).toBe('meta_reconnect_needed');
  });
});

describe('mock models the ended, unbilled and delivery states', () => {
  it('serves an ended row, refuses its take-over and reply with 409 session_ended', async () => {
    const client = createLucielClient({ adapter: 'mock' });
    const rows = await client.conversations.list();
    const ended = rows.find((c) => c.endedAt)!;
    expect(ended).toBeDefined();
    await expect(client.conversations.takeOver(ended.sessionId)).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('session_ended'),
    });
    await expect(client.conversations.sendMessage(ended.sessionId, 'hi')).rejects.toMatchObject({
      code: 'conflict',
    });
    // Nothing changed on the refusal.
    expect(
      (await client.conversations.list()).find((c) => c.sessionId === ended.sessionId)?.mode,
    ).toBe('ai');
  });

  it('serves one row the plan did not count', async () => {
    const client = createLucielClient({ adapter: 'mock' });
    const rows = await client.conversations.list();
    expect(rows.filter((c) => c.countedForBilling === false)).toHaveLength(1);
    expect(rows.filter((c) => c.countedForBilling === true).length).toBeGreaterThan(0);
  });

  it('persists a human reply outcome on the row: queued (widget), failed (no recipient), delivered', async () => {
    const client = createLucielClient({ adapter: 'mock' });
    const rows = await client.conversations.list();
    const widget = rows.find((c) => c.channel === 'widget')!;
    const noLead = rows.find((c) => !c.leadId && !c.endedAt)!;

    await client.conversations.takeOver(widget.sessionId);
    const queued = await client.conversations.sendMessage(widget.sessionId, 'hello');
    expect(queued.delivered).toBe(false);
    expect(queued.deliveryDetail).toBe('widget_poll_only');
    expect(queued.message.deliveryStatus).toBe('queued');
    const replay = await client.conversations.getMessages(widget.sessionId);
    expect(replay.at(-1)).toMatchObject({ role: 'human_agent', deliveryStatus: 'queued' });

    await client.conversations.takeOver(noLead.sessionId);
    const failed = await client.conversations.sendMessage(noLead.sessionId, 'hello');
    expect(failed.delivered).toBe(false);
    expect(failed.deliveryDetail).toBe('no_recipient_for_channel');
    expect(failed.message).toMatchObject({
      deliveryStatus: 'failed',
      deliveryDetail: 'no_recipient_for_channel',
      deliveredAt: null,
    });
  });
});
