import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { EmailChannelProvisioning } from '@/components/config/email-provisioning';
import EmbedPage from '@/app/(app)/dashboard/embed/page';

/**
 * P0-2 (email provisioning): the admin PROVISIONS the address Luciel sends AND
 * receives on (Arch §3.1.6a, Decision #49). Two LAUNCH options — the business's
 * own domain (with a DNS/MX routing step, "Action needed: complete email routing"
 * until verified) or a zero-DNS @vantagemind.ai fallback.
 *
 * It lives in ONE place: with the Email CHANNEL in Configure (Decision #4). The
 * Embed & launch tab is the widget snippet only, so the two can't disagree.
 */

describe('P0-2: Luciel’s work email provisioning', () => {
  it('offers own-domain provisioning and a free @vantagemind.ai fallback', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);
    expect(await screen.findByLabelText(/Email address on your domain/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Use your own domain/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Use a free @vantagemind\.ai address/i }),
    ).toBeInTheDocument();
  });

  it('says Luciel is not answering email while the Email channel is off', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled={false} />);
    expect(await screen.findByText(/answering email yet/i)).toBeInTheDocument();
  });

  it('shows the "complete email routing" action-needed state after own-domain setup', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);
    const input = await screen.findByLabelText(/Email address on your domain/i);
    fireEvent.change(input, { target: { value: 'hello@yourbusiness.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Set up my domain/i }));
    expect(await screen.findByText(/action needed: complete email routing/i)).toBeInTheDocument();
    expect(screen.getByText('hello@yourbusiness.com')).toBeInTheDocument();
  });

  it('is no longer duplicated on the Embed & launch tab', async () => {
    renderWithQuery(<EmbedPage />);
    await screen.findByRole('heading', { name: /Embed & launch/i });
    expect(screen.queryByLabelText(/Email address on your domain/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /work email/i })).not.toBeInTheDocument();
  });
});
