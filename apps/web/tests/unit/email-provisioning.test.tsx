import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import EmbedPage from '@/app/(app)/dashboard/embed/page';

/**
 * P0-2 (email provisioning): the admin PROVISIONS the address Luciel sends AND
 * receives on (Arch §3.1.6a, Decision #49). Two LAUNCH options — the business's
 * own domain (with a DNS/MX routing step, "Action needed: complete email routing"
 * until verified) or a zero-DNS VantageMind-subdomain fallback. Own-domain
 * inbound is NOT a deferred limitation, so the old "inbound arrives on a
 * VantageMind subdomain" banner is gone.
 */

describe('P0-2: email provisioning on the embed page', () => {
  it('offers own-domain provisioning and a VantageMind-subdomain fallback', async () => {
    renderWithQuery(<EmbedPage />);
    expect(await screen.findByLabelText(/Email address on your domain/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Use your own domain/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use a VantageMind address/i })).toBeInTheDocument();
  });

  it('no longer claims inbound email only arrives on a VantageMind subdomain', async () => {
    renderWithQuery(<EmbedPage />);
    await screen.findByLabelText(/Email address on your domain/i);
    expect(
      screen.queryByText(/inbound email arrives on a VantageMind subdomain/i),
    ).not.toBeInTheDocument();
  });

  it('shows the "complete email routing" action-needed state after own-domain setup', async () => {
    renderWithQuery(<EmbedPage />);
    const input = await screen.findByLabelText(/Email address on your domain/i);
    fireEvent.change(input, { target: { value: 'hello@yourbusiness.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Set up my domain/i }));
    expect(await screen.findByText(/action needed: complete email routing/i)).toBeInTheDocument();
    expect(screen.getByText('hello@yourbusiness.com')).toBeInTheDocument();
  });
});
