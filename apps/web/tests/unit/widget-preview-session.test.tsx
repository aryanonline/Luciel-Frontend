import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WidgetPreview } from '@/components/widget-preview';

/**
 * #3 (live-caught on the 2026-08-23 dev walkthrough): the dashboard's "Test it
 * here" preview sent every message WITHOUT a sessionId, so each message opened
 * a NEW session — three "conversations" for one chat, no continuity, and every
 * message consuming a billed conversation. The preview must thread the
 * server-assigned sessionId exactly as the shipped widget does
 * (apps/widget/src/mount.ts): omitted on the first send, echoed on every later
 * one.
 */

const bootstrap = vi.fn();
const send = vi.fn();

vi.mock('@/lib/widget-api', () => ({
  createPreviewWidgetClient: () => ({
    bootstrap: (...args: unknown[]) => bootstrap(...args),
    send: (...args: unknown[]) => send(...args),
  }),
}));

const SESSION_ID = '99999999-9999-4999-8999-999999999999';

function reply(text: string) {
  return {
    sessionId: SESSION_ID,
    reply: {
      messageId: `r-${text}`,
      role: 'assistant',
      text,
      at: '2026-08-23T10:00:00Z',
    },
    renderState: 'active',
  };
}

beforeEach(() => {
  bootstrap.mockReset().mockResolvedValue({
    assistantName: 'Aurora',
    aiAssistantLabel: 'AI assistant',
    poweredByVantageMind: true,
    renderState: 'active',
    openingMessage: "Hi! I'm an AI assistant. How can I help?",
  });
  send.mockReset();
});

async function typeAndSend(text: string) {
  fireEvent.change(screen.getByLabelText('Type your message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /Send/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Send/i })).toBeEnabled());
}

describe('#3: the preview threads ONE session across messages', () => {
  it('omits sessionId on the first send and echoes the server-assigned id on the next', async () => {
    send.mockResolvedValueOnce(reply('First answer')).mockResolvedValueOnce(reply('Second answer'));
    render(<WidgetPreview embedKey="vm_live_test123456" />);
    await screen.findByText("Hi! I'm an AI assistant. How can I help?");

    await typeAndSend('What are your hours?');
    expect(send).toHaveBeenNthCalledWith(1, 'vm_live_test123456', {
      sessionId: undefined,
      text: 'What are your hours?',
    });

    await typeAndSend('And your prices?');
    expect(send).toHaveBeenNthCalledWith(2, 'vm_live_test123456', {
      sessionId: SESSION_ID,
      text: 'And your prices?',
    });
  });

  it('a failed send does not lose the thread: the next attempt still carries the session', async () => {
    send
      .mockResolvedValueOnce(reply('First answer'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(reply('Third answer'));
    render(<WidgetPreview embedKey="vm_live_test123456" />);
    await screen.findByText("Hi! I'm an AI assistant. How can I help?");

    await typeAndSend('What are your hours?');
    await typeAndSend('And your prices?');
    expect(
      await screen.findByText(/That message did not go through/),
    ).toBeInTheDocument();

    await typeAndSend('And your prices?');
    expect(send).toHaveBeenNthCalledWith(3, 'vm_live_test123456', {
      sessionId: SESSION_ID,
      text: 'And your prices?',
    });
  });
});
