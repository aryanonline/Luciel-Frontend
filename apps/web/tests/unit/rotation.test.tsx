import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import EmbedPage from '@/app/(app)/dashboard/embed/page';
import { SmsWebhookTokenRotate } from '@/components/config/sms-webhook-token';
import { api } from '@/lib/api';
import type { Connection } from '@luciel/api-client';

/**
 * 2026-09-05 audit F142: the owner can rotate the public embed key and the SMS
 * webhook token from the dashboard, each behind a confirmation that says what
 * stops working, and each mutation shows pending / success / failure.
 */
describe('embed key rotation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('confirms, rotates, and tells the owner to update the snippet', async () => {
    renderWithQuery(<EmbedPage />);
    const before = (await screen.findByText(/data-key=/)).textContent;
    const rotate = vi.spyOn(api.luciel, 'rotateEmbedKey');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate embed key' }));
    expect(await screen.findByText('Rotate your embed key?')).toBeInTheDocument();
    expect(screen.getByText(/stops loading the widget immediately/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }));
    await waitFor(() => expect(rotate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/New embed key issued/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/data-key=/).textContent).not.toEqual(before));
  });

  it('keeps the dialog open and shows the failure when the rotation fails', async () => {
    renderWithQuery(<EmbedPage />);
    await screen.findByText(/data-key=/);
    vi.spyOn(api.luciel, 'rotateEmbedKey').mockRejectedValueOnce(new Error('rotation refused'));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate embed key' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate key' }));
    expect(await screen.findByText(/rotation refused/)).toBeInTheDocument();
    expect(screen.getByText('Rotate your embed key?')).toBeInTheDocument();
    expect(screen.queryByText(/New embed key issued/)).not.toBeInTheDocument();
  });
});

describe('SMS webhook token rotation', () => {
  afterEach(() => vi.restoreAllMocks());

  const connected = {
    connectionId: '55555555-5555-4555-8555-555555555555',
    connectionType: 'sms_sender',
    provider: 'twilio',
    status: 'connected',
    createdAt: '2026-09-01T00:00:00Z',
  } as unknown as Connection;

  it('is offered only for a connected number and rotates behind a confirmation', async () => {
    const { unmount } = renderWithQuery(
      <SmsWebhookTokenRotate connection={{ ...connected, status: 'unconfigured' } as Connection} />,
    );
    expect(screen.queryByRole('button', { name: 'Rotate webhook token' })).not.toBeInTheDocument();
    unmount();

    const rotate = vi.spyOn(api.connections, 'rotateSmsCapability').mockResolvedValue(connected);
    renderWithQuery(<SmsWebhookTokenRotate connection={connected} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate webhook token' }));
    expect(await screen.findByText('Rotate the SMS webhook token?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate token' }));
    await waitFor(() => expect(rotate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Webhook token rotated/)).toBeInTheDocument();
  });
});
