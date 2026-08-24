import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { Connection, ProviderGroup } from '@luciel/api-client';

/**
 * #4 (live-caught on the 2026-08-23 dev walkthrough): Configure's "Switch
 * account or provider" used the old switch endpoint, which DISCONNECTED the
 * live connection first — abandoning the new provider's consent screen left
 * the tool dead until a manual reconnect. The switch path now rides the same
 * proven-before-cutover SWAP (Arch §3.8.7 B, Decision #39) Overview's "Change
 * connected account" uses: the replacement is staged, the current connection
 * keeps serving until the replacement verifies, and backing out changes
 * nothing.
 */

const authorizeOrExplain = vi.fn<(start: unknown) => string | null>(() => null);

vi.mock('@/lib/oauth-connect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oauth-connect')>();
  return { ...actual, authorizeOrExplain: (start: unknown) => authorizeOrExplain(start) };
});

const listProviders = vi.fn<[], Promise<ProviderGroup[]>>();
const swap = vi.fn();
const switchAccount = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        listProviders: () => listProviders(),
        swap: (...args: unknown[]) => swap(...args),
        switchAccount: (...args: unknown[]) => switchAccount(...args),
      },
    },
  };
});

const CONNECTION_ID = '77777777-7777-4777-8777-777777777777';

const connectedWebhook: Connection = {
  connectionId: CONNECTION_ID,
  connectionType: 'crm',
  provider: 'custom_webhook',
  status: 'connected',
};

const crmProviders: ProviderGroup[] = [
  {
    connectionType: 'crm',
    providers: [
      {
        provider: 'custom_webhook',
        displayName: 'Custom webhook',
        authKind: 'credential_form',
        helpText: 'Send each captured lead to your own endpoint.',
        configured: true,
        credentialFields: [{ name: 'url', label: 'Webhook URL', secret: false, required: true }],
      },
      {
        provider: 'salesforce',
        displayName: 'Salesforce',
        authKind: 'oauth',
        helpText: 'Keep Salesforce Leads current as facts surface.',
        configured: true,
      },
    ],
  },
];

beforeEach(() => {
  authorizeOrExplain.mockClear();
  authorizeOrExplain.mockReturnValue(null);
  listProviders.mockReset().mockResolvedValue(crmProviders);
  swap.mockReset();
  switchAccount.mockReset();
});

describe('#4: "Switch account or provider" stages a swap, never disconnect-first', () => {
  it('states the current connection stays live before any provider is chosen', async () => {
    renderWithQuery(
      <ConnectionControl connectionType="crm" label="your CRM" connection={connectedWebhook} />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Switch account or provider/i }),
    );
    expect(
      await screen.findByText(
        /Your current connection stays live until the new one is verified — backing out of the sign-in changes nothing\./i,
      ),
    ).toBeInTheDocument();
  });

  it('switching to another provider calls swap on the held connection — switchAccount is never called', async () => {
    swap.mockResolvedValue({
      authorizeUrl: 'https://login.salesforce.com/oauth/authorize?state=abc',
    });
    renderWithQuery(
      <ConnectionControl connectionType="crm" label="your CRM" connection={connectedWebhook} />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Switch account or provider/i }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /Switch to Salesforce/i }));

    await waitFor(() => expect(swap).toHaveBeenCalledTimes(1));
    expect(swap).toHaveBeenCalledWith(CONNECTION_ID, 'salesforce');
    // The disconnect-first endpoint must never fire from this path (#4).
    expect(switchAccount).not.toHaveBeenCalled();
    // The consent handoff carries the HELD connection id, so the callback
    // completes the staged swap on the same row.
    await waitFor(() => expect(authorizeOrExplain).toHaveBeenCalledTimes(1));
    expect(authorizeOrExplain).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'salesforce',
        connectionId: CONNECTION_ID,
        callbackKind: 'connection',
      }),
    );
  });

  it('"Keep the current one" backs out without touching any endpoint', async () => {
    renderWithQuery(
      <ConnectionControl connectionType="crm" label="your CRM" connection={connectedWebhook} />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Switch account or provider/i }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /Keep the current one/i }));
    expect(
      screen.queryByText(/Your current connection stays live until the new one is verified/i),
    ).not.toBeInTheDocument();
    expect(swap).not.toHaveBeenCalled();
    expect(switchAccount).not.toHaveBeenCalled();
  });
});
