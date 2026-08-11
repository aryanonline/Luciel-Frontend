import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { EmailChannelProvisioning } from '@/components/config/email-provisioning';
import type {
  Connection,
  ConnectionProviders,
  ConnectionStatus,
  EmailProvisioning,
  ProviderOption,
} from '@luciel/api-client';

/**
 * BYO email sender (Arch §3.1.6a, owner decision 2026-08-10 Outlook-first): the
 * business connects its OWN Outlook mailbox as the address Luciel answers from.
 * Doctrine: connect, verify, bind, then live — it never silently replaces a
 * working sender.
 *
 * What the email panel owes the owner: the mailbox offered as a third path
 * beside the two platform modes, honestly disabled when the platform holds no
 * OAuth client (contract §1), a STAGED swap when a sender already exists (the
 * current address keeps working until the mailbox verifies), a fresh connect
 * only when no sender row exists at all, and — once live — the mailbox address
 * with an honest chip, with Reconnect offered when the grant expires.
 */

const startConnection = vi.fn();
const swapConnection = vi.fn();
const reconnectConnection = vi.fn();
const catalog = vi.fn<[string | undefined], ConnectionProviders[]>();
/** Connection rows + provisioning served to the panel, set per test. */
const served = vi.hoisted(() => ({
  connections: [] as Connection[],
  provisioning: null as EmailProvisioning | null,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        list: async () => served.connections,
        listProviders: (connectionType?: string) => Promise.resolve(catalog(connectionType)),
        start: (...args: unknown[]) => Promise.resolve(startConnection(...args)),
        swap: (...args: unknown[]) => Promise.resolve(swapConnection(...args)),
        reconnect: (...args: unknown[]) => Promise.resolve(reconnectConnection(...args)),
        getEmailProvisioning: async () => served.provisioning,
      },
    },
  };
});

const oauth = (provider: string, displayName: string, configured: boolean): ProviderOption => ({
  provider,
  displayName,
  authKind: 'oauth',
  helpText: `${displayName} help text.`,
  configured,
  credentialFields: [],
  scopeKind: null,
});

/** The served catalog: the email_sender group carries the one Outlook option. */
function serve({ outlook }: { outlook: boolean }) {
  catalog.mockImplementation((connectionType) => {
    const groups: ConnectionProviders[] = [
      { connectionType: 'email_sender', providers: [oauth('outlook', 'Outlook mailbox', outlook)] },
    ];
    return connectionType ? groups.filter((g) => g.connectionType === connectionType) : groups;
  });
}

const SES_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OUTLOOK_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MAILBOX = 'you@your-company.example';

/** A provisioned platform sender — the row a staged swap must not disturb. */
const sesRow = (): Connection => ({
  connectionId: SES_ID,
  connectionType: 'email_sender',
  provider: 'ses',
  displayName: 'Amazon SES',
  providerAvailable: true,
  status: 'connected',
  createdAt: '2026-02-01T10:20:00Z',
});

const outlookRow = (status: ConnectionStatus): Connection => ({
  connectionId: OUTLOOK_ID,
  connectionType: 'email_sender',
  provider: 'outlook',
  displayName: 'Outlook mailbox',
  providerAvailable: true,
  status,
  createdAt: '2026-08-09T10:00:00Z',
  nonSecretConfig: { address: MAILBOX, destination: MAILBOX, mode: 'byo_mailbox' },
});

const byoProvisioning = (status: ConnectionStatus = 'connected'): EmailProvisioning => ({
  mode: 'byo_mailbox',
  emailAddress: MAILBOX,
  status,
  dnsRecords: null,
});

const authorizeUrl = (state: string) =>
  `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&state=${state}`;

/** What oauth-connect stashed when it accepted the URL and began navigating. */
const stashedLaunch = () => {
  const raw = sessionStorage.getItem('luciel.pendingOauthConnection');
  return raw
    ? (JSON.parse(raw) as {
        provider: string;
        connectionId: string;
        callbackKind: string;
        state?: string;
      })
    : null;
};

const findConnectButton = async () => {
  const button = await screen.findByRole('button', { name: 'Connect Outlook mailbox' });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

beforeEach(() => {
  startConnection.mockReset();
  swapConnection.mockReset();
  reconnectConnection.mockReset();
  catalog.mockReset();
  served.connections = [];
  served.provisioning = null;
  sessionStorage.clear();
});

describe('§3.1.6a: the mailbox is offered as a third path when configured', () => {
  it('renders the connect option, its served name, and the platform paths beside it', async () => {
    serve({ outlook: true });
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);

    expect(
      await screen.findByRole('heading', { name: /Connect your own work mailbox/i }),
    ).toBeInTheDocument();
    expect(await findConnectButton()).toBeInTheDocument();
    expect(screen.getByText('Outlook mailbox help text.')).toBeInTheDocument();
    // Coexistence: the mailbox joins the two platform modes, replacing neither.
    expect(screen.getByRole('heading', { name: /Use your own domain/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Use a free @vantagemind\.ai address/i }),
    ).toBeInTheDocument();
  });
});

describe('§3.1.6a: connecting is a staged swap with a sender, a fresh connect without one', () => {
  it('uses swap when an email_sender row exists, says the current address keeps working, and launches the Microsoft consent URL', async () => {
    serve({ outlook: true });
    served.connections = [sesRow()];
    served.provisioning = {
      mode: 'vm_subdomain',
      emailAddress: 'sarahchen.reply.vantagemind.ai',
      status: 'connected',
    };
    swapConnection.mockReturnValue({ authorizeUrl: authorizeUrl('ms-state-1') });
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);

    // Staged-swap reassurance (never silently replaces a working sender).
    expect(
      await screen.findByText('Your current address keeps working until the mailbox is connected.'),
    ).toBeInTheDocument();

    fireEvent.click(await findConnectButton());
    await waitFor(() => expect(swapConnection).toHaveBeenCalledWith(SES_ID, 'outlook'));
    expect(startConnection).not.toHaveBeenCalled();

    // The launch went through oauth-connect: the pending stash carries the id
    // the callback completes, the generic connection route, and the state read
    // off the accepted login.microsoftonline.com URL.
    await waitFor(() =>
      expect(stashedLaunch()).toMatchObject({
        provider: 'outlook',
        connectionId: SES_ID,
        callbackKind: 'connection',
        state: 'ms-state-1',
      }),
    );
    expect(screen.queryByText(/could not start a secure sign-in/i)).not.toBeInTheDocument();
  });

  it('uses a fresh connect when no email_sender row exists at all', async () => {
    serve({ outlook: true });
    startConnection.mockImplementation(() => {
      // The backend creates the row on start; the hook re-reads the list to
      // resolve the id the OAuth callback will need.
      served.connections = [outlookRow('unconfigured')];
      return { authorizeUrl: authorizeUrl('ms-state-2') };
    });
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);

    fireEvent.click(await findConnectButton());
    await waitFor(() => expect(startConnection).toHaveBeenCalledWith('email_sender', 'outlook'));
    expect(swapConnection).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(stashedLaunch()).toMatchObject({
        provider: 'outlook',
        connectionId: OUTLOOK_ID,
        callbackKind: 'connection',
        state: 'ms-state-2',
      }),
    );
  });
});

describe('contract §1: honest when the platform cannot start the sign-in', () => {
  it('renders the option honest-disabled — no connect button — when the registry says configured: false', async () => {
    serve({ outlook: false });
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);

    expect(
      await screen.findByText(/Not available yet — the mailbox sign-in is not switched on/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Outlook mailbox — Outlook mailbox help text\./i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect Outlook mailbox' }),
    ).not.toBeInTheDocument();
  });

  it('surfaces an "Action needed:" start answer as the message, without redirecting', async () => {
    serve({ outlook: true });
    served.connections = [sesRow()];
    swapConnection.mockReturnValue({
      authorizeUrl: null,
      statusDetail: 'Action needed: Outlook mailbox is not available yet.',
    });
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);

    fireEvent.click(await findConnectButton());
    expect(
      await screen.findByText('Action needed: Outlook mailbox is not available yet.'),
    ).toBeInTheDocument();
    // No launch happened: nothing was stashed for a callback to complete.
    expect(stashedLaunch()).toBeNull();
  });
});

describe('§3.1.6a: the live mailbox state is honest about address and health', () => {
  it('shows the mailbox address with a Connected chip, and keeps the platform paths as the way back', async () => {
    serve({ outlook: true });
    served.connections = [outlookRow('connected')];
    served.provisioning = byoProvisioning('connected');
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);

    expect(await screen.findByText(MAILBOX)).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    // Switching back is just provisioning a platform mode again.
    expect(screen.getByText(/Switch back to a platform address/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect Outlook mailbox' }),
    ).not.toBeInTheDocument();
  });

  it('offers Reconnect when the grant expires, and launches the consent screen again', async () => {
    serve({ outlook: true });
    served.connections = [
      {
        ...outlookRow('expired'),
        statusDetail: 'Sign-in expired — reconnect the mailbox in the dashboard.',
      },
    ];
    served.provisioning = byoProvisioning('expired');
    reconnectConnection.mockReturnValue({ authorizeUrl: authorizeUrl('ms-state-3') });
    renderWithQuery(<EmailChannelProvisioning emailChannelEnabled />);

    expect(await screen.findByText('Reconnect needed')).toBeInTheDocument();
    expect(
      screen.getByText('Sign-in expired — reconnect the mailbox in the dashboard.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Outlook mailbox' }));
    await waitFor(() => expect(reconnectConnection).toHaveBeenCalledWith(OUTLOOK_ID));
    await waitFor(() =>
      expect(stashedLaunch()).toMatchObject({
        provider: 'outlook',
        connectionId: OUTLOOK_ID,
        callbackKind: 'connection',
        state: 'ms-state-3',
      }),
    );
  });
});
