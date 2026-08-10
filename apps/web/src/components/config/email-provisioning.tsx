'use client';

import * as React from 'react';
import { Banner, Button, CardDescription, Field, Input, StatusChip } from '@luciel/ui';
import { chipForConnection, LucielApiError } from '@luciel/api-client';
import {
  useConnectionLifecycle,
  useConnectionProviders,
  useConnections,
  useEmailProvisioning,
  useProvisionEmail,
  useSwapConnection,
  type StartedConnectFlow,
} from '@/lib/hooks';
import { authorizeOrExplain } from '@/lib/oauth-connect';
import { useActionNotice, type ActionNotice } from '@/lib/use-action-notice';

/**
 * Luciel's work email (Decisions #3 + #4, Arch §3.1.6a). ONE place: the address
 * lives with the Email CHANNEL in Configure — turn the channel on, provision the
 * address right here. It is deliberately NOT on the "Embed & launch" tab any
 * more, which is now only the widget snippet.
 *
 * The model is "Luciel owns a work address," like any new hire getting a company
 * email — not OAuth into a human's personal inbox. Two platform ways to get one:
 * the business's own domain (guided DNS/MX, "Action needed: complete email
 * routing" until it verifies) or a free @vantagemind.ai address with no DNS at
 * all.
 *
 * The THIRD path is BYO (§3.1.6a, owner decision 2026-08-10 Outlook-first): the
 * business connects its own Outlook mailbox as the sender — replies come from
 * their own address and sent mail lands in their own Sent folder. Doctrine:
 * connect, verify, bind, then live — it never silently replaces a working
 * sender, so a provisioned address keeps working until the mailbox round-trip
 * completes (staged swap, Arch §3.8.7 B).
 *
 * Self-contained on purpose: it takes only whether the Email channel is on, so
 * the channels pillar can render it inline beside the Email toggle. It renders a
 * bordered section rather than a Card, because its only call site is already
 * inside the channels Card and a Card nested in a Card reads as a stray panel
 * (P2-9).
 */

/** UX-only email shape check (client validation is never a security control). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailChannelProvisioning({ emailChannelEnabled }: { emailChannelEnabled: boolean }) {
  const provisioning = useEmailProvisioning();
  const provisionEmail = useProvisionEmail();
  // The BYO mailbox rides the ONE email_sender connection (§3.1.6a): the row
  // decides whether connecting is a fresh connect or a staged swap, and the
  // served registry decides whether the sign-in can be offered at all.
  const connections = useConnections();
  const providers = useConnectionProviders('email_sender');
  const swap = useSwapConnection();
  const { connect, reconnect } = useConnectionLifecycle();
  const { busy, notice, run } = useActionNotice();
  const [mailboxNotice, setMailboxNotice] = React.useState<ActionNotice | null>(null);
  const [emailAddress, setEmailAddress] = React.useState('');
  const emailValid = EMAIL.test(emailAddress.trim());

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

  /** The typed address is only cleared once the write is confirmed (P2-9). */
  const setupOwnDomain = async () => {
    if (!emailValid) return;
    const address = emailAddress.trim();
    const ok = await run(async () => {
      await provisionEmail.mutateAsync({ mode: 'own_domain', emailAddress: address });
      return `${address} is set up. Add the records below at your domain host to make it live.`;
    }, 'We could not set that address up. Nothing was changed — please check it and try again.');
    if (ok) setEmailAddress('');
  };

  const useSubdomain = () =>
    void run(async () => {
      const result = await provisionEmail.mutateAsync({ mode: 'vm_subdomain' });
      return `${result.emailAddress} is Luciel's work address — nothing to change at your domain host.`;
    }, 'We could not create that address just now. Nothing was changed — please try again.');

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

  const platformSetup = (
    <PlatformAddressSetup
      emailAddress={emailAddress}
      onEmailAddressChange={setEmailAddress}
      emailValid={emailValid}
      busy={busy}
      onSetupOwnDomain={() => void setupOwnDomain()}
      onUseSubdomain={useSubdomain}
    />
  );

  const mailboxPanel = (
    <div className="rounded-vm-card border border-vm-border p-vm-4">
      <h3 className="text-vm-2 font-label">Or connect your own work mailbox</h3>
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
            Not available yet — the mailbox sign-in is not switched on at our end. We&apos;ll
            switch this on as soon as it&apos;s ready — there is nothing for you to do.
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
              : 'An alternative to a platform address: Luciel sends and receives on the mailbox you already use, and you can switch between the two here.'}
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
              disabled={mailboxBusy || busy || !connections.isSuccess}
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
          The Email channel is off, so Luciel isn&apos;t answering email yet. Set the address up here
          and turn the Email channel on above.
        </Banner>
      )}

      {busy && (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
          Saving…
        </p>
      )}
      {notice && !busy && (
        <Banner className="mt-vm-3" tone={notice.tone}>
          {notice.text}
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
        /* BYO mailbox is the sender (§3.1.6a). The platform paths stay reachable
           below as the way back — provisioning one of those modes again makes it
           the sender in place of the mailbox. */
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
          {mailboxNotice && (
            <Banner className="mt-vm-3" tone={mailboxNotice.tone}>
              {mailboxNotice.text}
            </Banner>
          )}
          <details className="mt-vm-4">
            <summary className="cursor-pointer text-vm-1 text-vm-text-muted underline underline-offset-2">
              Switch back to a platform address
            </summary>
            <div className="mt-vm-3">
              <p className="text-vm-1 text-vm-text-muted">
                Setting up a platform address below makes it Luciel&apos;s sender again, in place of
                your mailbox.
              </p>
              <div className="mt-vm-3">{platformSetup}</div>
            </div>
          </details>
        </div>
      ) : (
        <div className="mt-vm-4 space-y-vm-4">
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
                    One copy-paste and you&apos;re done: add these records at your domain host. Email
                    sent to this address starts reaching Luciel as soon as they publish — until then
                    the address isn&apos;t live.
                  </p>
                  <ul className="mt-vm-3 space-y-vm-2">
                    {(provisioning.data.dnsRecords ?? []).map((r, i) => (
                      <li
                        key={i}
                        className="rounded-vm-control border border-vm-border bg-vm-surface p-vm-3 text-vm-0"
                      >
                        <span className="font-label">{r.type}</span> {r.host} → <code>{r.value}</code>
                        {r.priority !== undefined ? ` (priority ${r.priority})` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
                  This is Luciel&apos;s own address: it answers email sent here, and anything it
                  sends goes out from here.
                </p>
              )}
            </div>
          ) : (
            platformSetup
          )}
          {mailboxPanel}
        </div>
      )}
    </section>
  );
}

/**
 * The two PLATFORM address paths (Decision #49): the business's own domain, or
 * the zero-DNS @vantagemind.ai fallback. Extracted so the BYO-mailbox state can
 * keep offering them as the way back to a platform address.
 */
function PlatformAddressSetup({
  emailAddress,
  onEmailAddressChange,
  emailValid,
  busy,
  onSetupOwnDomain,
  onUseSubdomain,
}: {
  emailAddress: string;
  onEmailAddressChange: (value: string) => void;
  emailValid: boolean;
  busy: boolean;
  onSetupOwnDomain: () => void;
  onUseSubdomain: () => void;
}) {
  return (
    <div className="space-y-vm-4">
      <div className="rounded-vm-card border border-vm-border p-vm-4">
        <h3 className="text-vm-2 font-label">Use your own domain</h3>
        <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
          Pick the address you want Luciel to work from, e.g. hello@yourbusiness.com. We show you
          the exact records to add at your domain host, and it goes live once they publish.
        </p>
        <div className="mt-vm-3 flex items-end gap-vm-2">
          <div className="flex-1">
            <Field
              id="own-domain-email"
              label="Email address on your domain"
              hint="e.g. hello@yourbusiness.com"
              error={
                emailAddress.length > 0 && !emailValid
                  ? 'Enter a valid email address, e.g. hello@yourbusiness.com.'
                  : undefined
              }
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  type="email"
                  inputMode="email"
                  value={emailAddress}
                  onChange={(e) => onEmailAddressChange(e.target.value)}
                  placeholder="hello@yourbusiness.com"
                />
              )}
            </Field>
          </div>
          <Button
            variant="primary"
            onClick={onSetupOwnDomain}
            disabled={!emailValid || busy}
            className="mb-vm-4"
          >
            Set up my domain
          </Button>
        </div>
      </div>

      <div className="rounded-vm-card border border-vm-border p-vm-4">
        <h3 className="text-vm-2 font-label">Or use a free @vantagemind.ai address</h3>
        <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
          Luciel gets an address on vantagemind.ai straight away — nothing to change at your
          domain host. You can move it to your own domain later.
        </p>
        <Button variant="secondary" onClick={onUseSubdomain} disabled={busy} className="mt-vm-3">
          Use a free @vantagemind.ai address
        </Button>
      </div>
    </div>
  );
}
