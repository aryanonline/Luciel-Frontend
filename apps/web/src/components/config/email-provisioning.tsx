'use client';

import * as React from 'react';
import { Banner, Button, CardDescription, StatusChip, Modal } from '@luciel/ui';
import { chipForConnection, LucielApiError } from '@luciel/api-client';
import {
  useConnectionLifecycle,
  useConnectionProviders,
  useConnections,
  useEmailProvisioning,
  useReverifyEmail,
  useSwapConnection,
  type StartedConnectFlow,
} from '@/lib/hooks';
import { authorizeOrExplain } from '@/lib/oauth-connect';
import { type ActionNotice } from '@/lib/use-action-notice';

/**
 * Luciel's work email (Decisions #3 + #4, Arch §3.1.6a). ONE place: the address
 * lives with the Email CHANNEL in Configure — turn the channel on, provision the
 * address right here. It is deliberately NOT on the "Embed & launch" tab any
 * more, which is now only the widget snippet.
 *
 * Email is BYO-mailbox ONLY (owner decision 2026-08-18: "the other methods seem
 * like a chore"): the business connects its own Outlook mailbox as the sender —
 * replies come from their own address and sent mail lands in their own Sent
 * folder. Doctrine: connect, verify, bind, then live — it never silently
 * replaces a working sender (staged swap, Arch §3.8.7 B). The retired platform
 * paths (own-domain DNS walk, @vantagemind.ai subdomain) are no longer offered;
 * a tenant still on one sees their address as a read-only legacy card beside
 * the mailbox connect, which is also their upgrade path.
 *
 * Self-contained on purpose: it takes only whether the Email channel is on, so
 * the channels pillar can render it inline beside the Email toggle. It renders a
 * bordered section rather than a Card, because its only call site is already
 * inside the channels Card and a Card nested in a Card reads as a stray panel
 * (P2-9).
 */

export function EmailChannelProvisioning({
  emailChannelEnabled,
}: {
  emailChannelEnabled: boolean;
}) {
  const provisioning = useEmailProvisioning();
  // The BYO mailbox rides the ONE email_sender connection (§3.1.6a): the row
  // decides whether connecting is a fresh connect or a staged swap, and the
  // served registry decides whether the sign-in can be offered at all.
  const connections = useConnections();
  const providers = useConnectionProviders('email_sender');
  const swap = useSwapConnection();
  const { connect, reconnect, disconnect } = useConnectionLifecycle();
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);
  // Legacy own-domain routing (§3.1.6a): nothing polls DNS in the background,
  // so the pending card offers the on-demand MX re-probe explicitly.
  const reverifyEmail = useReverifyEmail();
  const [mailboxNotice, setMailboxNotice] = React.useState<ActionNotice | null>(null);

  const senderRow = connections.data?.find((c) => c.connectionType === 'email_sender');
  const outlookOption = providers.data
    ?.find((group) => group.connectionType === 'email_sender')
    ?.providers.find((option) => option.provider === 'outlook');
  // Served displayName, never the raw slug; the fallback stays human-readable.
  const outlookName = outlookOption?.displayName ?? 'Outlook mailbox';
  // A loading registry is UNKNOWN, not unavailable — only a settled read may
  // call the mailbox honest-disabled (apps/web guide: no false "not available").
  const outlookUnavailable = providers.isSuccess && outlookOption?.configured !== true;

  const rowIsMailbox = senderRow?.provider === 'outlook';
  /**
   * The mailbox IS the sender: either the provisioning read says so, or the
   * connection row already holds an outlook grant worth showing as the current
   * state (connected, or re-authorizable). A row merely mid-connect
   * (unconfigured/not_connected) is not shown as the sender — cutover only
   * happens on success.
   */
  const mailboxLive =
    provisioning.data?.mode === 'byo_mailbox' ||
    (rowIsMailbox &&
      (senderRow?.status === 'connected' ||
        senderRow?.status === 'expired' ||
        senderRow?.status === 'error'));
  const mailboxAddress =
    (provisioning.data?.mode === 'byo_mailbox' ? provisioning.data.emailAddress : undefined) ??
    (typeof senderRow?.nonSecretConfig?.address === 'string'
      ? senderRow.nonSecretConfig.address
      : undefined);
  const mailboxStatus =
    (rowIsMailbox ? senderRow?.status : undefined) ?? provisioning.data?.status ?? 'unconfigured';
  const needsReconnect = mailboxStatus === 'expired' || mailboxStatus === 'error';
  const mailboxBusy = swap.isPending || connect.isPending || reconnect.isPending;

  /**
   * The browser half of the mailbox OAuth (same shape as connection-control's
   * runFlow): start the flow, then either navigate to the provider's consent
   * screen or surface the honest reason we deliberately did not.
   */
  const launchMailboxFlow = async (flow: Promise<StartedConnectFlow>) => {
    setMailboxNotice(null);
    try {
      const start = await flow;
      const explanation = authorizeOrExplain({
        ...start,
        provider: 'outlook',
        label: outlookName,
        callbackKind: 'connection',
      });
      if (explanation) setMailboxNotice({ tone: 'danger', text: explanation });
    } catch (err) {
      setMailboxNotice({
        tone: 'danger',
        text:
          err instanceof LucielApiError
            ? err.message
            : `We could not start the ${outlookName} sign-in. Your current address is untouched — please try again.`,
      });
    }
  };

  // An existing sender row means a working (or at least provisioned) address:
  // that transition is a STAGED SWAP — the current sender keeps working until
  // the mailbox verifies (§3.1.6a). Only a tenant with no email_sender row at
  // all starts a fresh connect.
  const connectMailbox = () =>
    launchMailboxFlow(
      senderRow
        ? swap
            .mutateAsync({ connectionId: senderRow.connectionId, provider: 'outlook' })
            .then((start) => ({ ...start, connectionId: senderRow.connectionId }))
        : connect.mutateAsync({ connectionType: 'email_sender', provider: 'outlook' }),
    );

  const reconnectMailbox = () => {
    if (!senderRow) return;
    void launchMailboxFlow(reconnect.mutateAsync({ connectionId: senderRow.connectionId }));
  };

  const mailboxPanel = (
    <div className="rounded-vm-card border border-vm-border p-vm-4">
      <h3 className="text-vm-2 font-label">Connect your own work mailbox</h3>
      <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
        Replies come from your own address and land in your own Sent folder — the most professional
        setup, one sign-in.
      </p>
      {providers.isPending ? (
        <p className="mt-vm-2 text-vm-1 text-vm-text-muted" role="status">
          Checking whether a mailbox sign-in is available…
        </p>
      ) : providers.isError ? (
        <Banner tone="warning" className="mt-vm-3">
          We could not load the mailbox option just now. Reload the page to try again.
        </Banner>
      ) : outlookUnavailable ? (
        /* Honest-disabled (contract §1, same treatment as connection-control):
           no platform OAuth client, so there is no connect button to press. */
        <div className="mt-vm-2">
          <p className="text-vm-1">
            Not available yet — the mailbox sign-in is not switched on at our end. We&apos;ll switch
            this on as soon as it&apos;s ready — there is nothing for you to do.
          </p>
          {outlookOption && (
            <ul className="mt-vm-2 grid gap-vm-1 text-vm-0 text-vm-text-muted">
              <li>
                {outlookOption.displayName} — {outlookOption.helpText}
              </li>
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-vm-1">
          <p className="text-vm-1 text-vm-text-muted">
            {outlookOption?.helpText ??
              'Connect the work mailbox Luciel answers from — replies come from your own address.'}
          </p>
          <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
            {senderRow
              ? /* Staged swap (§3.1.6a): never silently replaces a working sender. */
                'Your current address keeps working until the mailbox is connected.'
              : 'Luciel sends and receives on the mailbox you already use — one sign-in, nothing to configure at a domain host.'}
          </p>
          {connections.isError ? (
            <Banner tone="warning" className="mt-vm-3">
              We could not check your current email setup just now, so connecting a mailbox is
              paused. Reload the page to try again.
            </Banner>
          ) : (
            <Button
              variant="secondary"
              className="mt-vm-3"
              onClick={() => void connectMailbox()}
              disabled={mailboxBusy || !connections.isSuccess}
            >
              {mailboxBusy ? 'Opening sign-in…' : `Connect ${outlookName}`}
            </Button>
          )}
        </div>
      )}
      {mailboxNotice && (
        <Banner className="mt-vm-3" tone={mailboxNotice.tone}>
          {mailboxNotice.text}
        </Banner>
      )}
    </div>
  );

  return (
    <section
      aria-labelledby="luciel-work-email"
      className="rounded-vm-card border border-vm-border p-vm-4"
    >
      <h3 id="luciel-work-email" className="text-vm-2 font-heading">
        Luciel&apos;s work email
      </h3>
      <CardDescription>
        Connect Luciel to its work email — just like giving a new hire a company address. People who
        email it get answered by Luciel; your own inbox stays yours.
      </CardDescription>

      {!emailChannelEnabled && (
        <Banner tone="info" className="mt-vm-3">
          The Email channel is off, so Luciel isn&apos;t answering email yet. Connect the mailbox
          here and turn the Email channel on above.
        </Banner>
      )}

      {provisioning.isPending ? (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
          Loading email setup…
        </p>
      ) : provisioning.isError ? (
        /* Offering to provision an address we could not read the status of would
           risk a second one; say the read failed instead (P2-9). */
        <Banner tone="danger" className="mt-vm-3">
          We could not check whether Luciel already has a work address, so the setup options are
          hidden rather than shown wrong.{' '}
          <button className="underline" onClick={() => void provisioning.refetch()}>
            Try again
          </button>
        </Banner>
      ) : mailboxLive ? (
        /* BYO mailbox is the sender (§3.1.6a) — the only offered state. */
        <div className="mt-vm-4 rounded-vm-card border border-vm-border p-vm-4">
          <div className="flex items-center justify-between gap-vm-3">
            <span className="text-vm-2 font-label">{mailboxAddress ?? outlookName}</span>
            <StatusChip kind={chipForConnection(mailboxStatus)} />
          </div>
          {needsReconnect ? (
            <div className="mt-vm-3">
              <p className="text-vm-1 text-vm-text-muted">
                {senderRow?.statusDetail ??
                  `The ${outlookName} sign-in needs to be renewed. Reconnect it and Luciel keeps answering from this address.`}
              </p>
              <Button
                variant="secondary"
                className="mt-vm-3"
                onClick={reconnectMailbox}
                disabled={mailboxBusy || !senderRow}
              >
                {mailboxBusy ? 'Opening sign-in…' : `Reconnect ${outlookName}`}
              </Button>
            </div>
          ) : (
            <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
              This is your own work mailbox: Luciel answers email sent here, replies come from this
              address, and sent mail lands in your own Sent folder.
            </p>
          )}
          {/* Round 6 WP-D: the mailbox can be switched (staged, the current one keeps
              working until the new one verifies) or disconnected from here. */}
          <div className="mt-vm-3 flex flex-wrap items-center gap-vm-2">
            <Button
              variant="ghost"
              onClick={() => void connectMailbox()}
              disabled={mailboxBusy || !senderRow}
            >
              {mailboxBusy ? 'Opening sign-in…' : 'Switch mailbox'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDisconnectOpen(true)}
              disabled={mailboxBusy || disconnect.isPending || !senderRow}
            >
              Disconnect mailbox
            </Button>
          </div>
          <Modal
            open={disconnectOpen}
            onOpenChange={setDisconnectOpen}
            title="Disconnect this mailbox?"
            description="We delete the saved sign-in and stop answering mail sent to it. The Email channel switches off until you connect a mailbox again."
            confirmLabel="Disconnect mailbox"
            confirmPendingLabel="Disconnecting…"
            confirmVariant="danger"
            onConfirm={async () => {
              if (!senderRow) return;
              await disconnect.mutateAsync({ connectionId: senderRow.connectionId });
              setMailboxNotice({
                tone: 'info',
                text: 'The mailbox is disconnected and its saved sign-in was deleted. Email is off until you connect a mailbox again.',
              });
              setDisconnectOpen(false);
            }}
          >
            <p className="text-vm-1">Nothing about your leads or conversation history changes.</p>
          </Modal>
          {mailboxNotice && (
            <Banner className="mt-vm-3" tone={mailboxNotice.tone}>
              {mailboxNotice.text}
            </Banner>
          )}
        </div>
      ) : (
        <div className="mt-vm-4 space-y-vm-4">
          {mailboxPanel}
          {provisioning.data ? (
            <div className="rounded-vm-card border border-vm-border p-vm-4">
              <div className="flex items-center justify-between gap-vm-3">
                <span className="text-vm-2 font-label">{provisioning.data.emailAddress}</span>
                {provisioning.data.status === 'pending_email_routing' ? (
                  <StatusChip kind="action_needed" detail="complete email routing" />
                ) : (
                  <StatusChip kind={chipForConnection(provisioning.data.status)} />
                )}
              </div>
              {provisioning.data.status === 'pending_email_routing' ? (
                <div className="mt-vm-3">
                  <p className="text-vm-1 text-vm-text-muted">
                    One copy-paste and you&apos;re done: add these records at your domain host.
                    Email sent to this address starts reaching Luciel as soon as they publish —
                    until then the address isn&apos;t live.
                  </p>
                  <ul className="mt-vm-3 space-y-vm-2">
                    {(provisioning.data.dnsRecords ?? []).map((r, i) => (
                      <li
                        key={i}
                        className="rounded-vm-control border border-vm-border bg-vm-surface p-vm-3 text-vm-0"
                      >
                        {/* Labeled fields, not a bare "MX host → value" row: the
                            owner is pasting these into their domain host's form,
                            which asks for exactly these field names. */}
                        <span className="font-label">Record type: {r.type}</span>
                        <div className="mt-vm-1">
                          Name/host: <code>{r.host}</code>
                        </div>
                        <div className="mt-vm-1">
                          Value: <code>{r.value}</code>
                        </div>
                        {r.priority !== undefined && (
                          <div className="mt-vm-1">Priority: {r.priority}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {/* Nothing polls DNS in the background (mirrors the SMS
                      Re-verify): once the records are published, this is the
                      only exit from pending_email_routing. Pending, success and
                      failure are each visible — a probe that did not pass can
                      never read as one that did. */}
                  <div className="mt-vm-3">
                    <Button
                      variant="secondary"
                      onClick={() => reverifyEmail.mutate()}
                      disabled={reverifyEmail.isPending}
                    >
                      {reverifyEmail.isPending ? 'Re-verifying…' : 'Re-verify email routing'}
                    </Button>
                  </div>
                  {reverifyEmail.isSuccess &&
                    reverifyEmail.data?.status === 'pending_email_routing' && (
                      <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
                        Still pending — your domain doesn&apos;t route here yet. DNS changes can
                        take a while to publish; nothing was changed, try again once your records
                        are live.
                      </p>
                    )}
                  {reverifyEmail.isError && (
                    <p className="mt-vm-2 text-vm-1 text-vm-danger">
                      We couldn&apos;t check your email routing just now. Your address is unchanged
                      — please try again in a moment.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
                  This is Luciel&apos;s current address: it answers email sent here, and anything it
                  sends goes out from here. Connecting your own mailbox above moves Luciel onto it —
                  your address keeps working until the mailbox verifies.
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
