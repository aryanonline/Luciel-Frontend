import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { EmailChannelProvisioning } from '@/components/config/email-provisioning';
import type { ConnectionProviders, EmailProvisioning } from '@luciel/api-client';

/**
 * Email routing re-verify (§3.1.6a, round 5 item 2). A legacy own-domain
 * address sits at `pending_email_routing` until its MX record resolves, and
 * nothing polls DNS in the background — so the pending card must offer the
 * on-demand probe (mirroring the SMS Re-verify), with pending, success and
 * error each visible. Without the button that status was a dead end.
 */

const reverifyEmailApi = vi.fn();
const served = vi.hoisted(() => ({
  provisioning: null as EmailProvisioning | null,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  const catalog: ConnectionProviders[] = [
    {
      connectionType: 'email_sender',
      providers: [
        {
          provider: 'outlook',
          displayName: 'Outlook mailbox',
          authKind: 'oauth',
          helpText: 'Outlook mailbox help text.',
          configured: true,
          credentialFields: [],
          scopeKind: null,
        },
      ],
    },
  ];
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        list: async () => [],
        listProviders: async () => catalog,
        getEmailProvisioning: async () => served.provisioning,
        reverifyEmail: (...args: unknown[]) => Promise.resolve(reverifyEmailApi(...args)),
      },
    },
  };
});

const pendingOwnDomain = (): EmailProvisioning => ({
  mode: 'own_domain',
  emailAddress: 'hello@yourbusiness.com',
  status: 'pending_email_routing',
  dnsRecords: [
    { type: 'MX', host: 'yourbusiness.com', value: 'inbound.vantagemind.ai', priority: 10 },
  ],
});

beforeEach(() => {
  reverifyEmailApi.mockReset();
  served.provisioning = pendingOwnDomain();
});

describe('§3.1.6a: pending email routing offers the on-demand re-verify', () => {
  it('renders the Re-verify button on the pending_email_routing card', async () => {
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);
    expect(await screen.findByText(/action needed: complete email routing/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Re-verify email routing' }),
    ).toBeInTheDocument();
  });

  it('clicking calls the endpoint and reports a still-pending probe honestly', async () => {
    reverifyEmailApi.mockReturnValue({ status: 'pending_email_routing', statusDetail: null });
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);

    fireEvent.click(await screen.findByRole('button', { name: 'Re-verify email routing' }));
    await waitFor(() => expect(reverifyEmailApi).toHaveBeenCalledTimes(1));
    // Not yet routed = not connected: the card says so instead of going quiet.
    expect(
      await screen.findByText(/Still pending — your domain doesn't route here yet/i),
    ).toBeInTheDocument();
  });

  it('keeps a failed probe visible — nothing pretends the check ran', async () => {
    reverifyEmailApi.mockImplementation(() => {
      throw new Error('network down');
    });
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);

    fireEvent.click(await screen.findByRole('button', { name: 'Re-verify email routing' }));
    expect(
      await screen.findByText(/We couldn't check your email routing just now/i),
    ).toBeInTheDocument();
  });
});
