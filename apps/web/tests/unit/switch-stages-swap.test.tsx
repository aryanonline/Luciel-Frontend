import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery, seededQueryClient } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import { qk } from '@/lib/hooks';
import type { Connection, ConnectionProviders } from '@luciel/api-client';

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
  createdAt: '2026-08-01T10:00:00Z',
};

const crmProviders: ConnectionProviders[] = [
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
        scopeKind: null,
      },
      {
        provider: 'salesforce',
        displayName: 'Salesforce',
        authKind: 'oauth',
        helpText: 'Keep Salesforce Leads current as facts surface.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
    ],
  },
];

beforeEach(() => {
  authorizeOrExplain.mockClear();
  authorizeOrExplain.mockReturnValue(null);
  swap.mockReset();
  switchAccount.mockReset();
});

/**
 * The control with the CRM registry already served. The button names the provider
 * choice only once the registry is in, and the test used to wait for that read: on a
 * loaded machine the wait ran out with the button still reading "Switch account"
 * (2026-11-14), for a reason nobody reproduced. With the registry seeded the first
 * render names the choice, so no wait is left to run out.
 */
function renderControl() {
  renderWithQuery(
    <ConnectionControl connectionType="crm" label="your CRM" connection={connectedWebhook} />,
    seededQueryClient([[qk.connectionProviders('crm'), crmProviders]]),
  );
}

function openSwitch() {
  fireEvent.click(screen.getByRole('button', { name: 'Switch account or provider' }));
}

describe('#4: "Switch account or provider" stages a swap, never disconnect-first', () => {
  it('states the current connection stays live before any provider is chosen', async () => {
    renderControl();
    openSwitch();
    expect(
      screen.getByText(
        /Your current connection stays live until the new one is verified — backing out of the sign-in changes nothing\./i,
      ),
    ).toBeInTheDocument();
  });

  it('switching to another provider calls swap on the held connection — switchAccount is never called', async () => {
    swap.mockResolvedValue({
      authorizeUrl: 'https://login.salesforce.com/oauth/authorize?state=abc',
    });
    renderControl();
    openSwitch();
    fireEvent.click(screen.getByRole('button', { name: /Switch to Salesforce/i }));

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
    // The swap has settled: the live row offers its actions again.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Switch account or provider' })).toBeEnabled(),
    );
  });

  it('"Keep the current one" backs out without touching any endpoint', async () => {
    renderControl();
    openSwitch();
    fireEvent.click(screen.getByRole('button', { name: /Keep the current one/i }));
    expect(
      screen.queryByText(/Your current connection stays live until the new one is verified/i),
    ).not.toBeInTheDocument();
    expect(swap).not.toHaveBeenCalled();
    expect(switchAccount).not.toHaveBeenCalled();
  });
});
