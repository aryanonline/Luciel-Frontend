'use client';

import * as React from 'react';
import { Banner, Button, CardDescription, Field, Input, StatusChip } from '@luciel/ui';
import { chipForConnection } from '@luciel/api-client';
import { useEmailProvisioning, useProvisionEmail } from '@/lib/hooks';
import { useActionNotice } from '@/lib/use-action-notice';

/**
 * Luciel's work email (Decisions #3 + #4, Arch §3.1.6a). ONE place: the address
 * lives with the Email CHANNEL in Configure — turn the channel on, provision the
 * address right here. It is deliberately NOT on the "Embed & launch" tab any
 * more, which is now only the widget snippet.
 *
 * The model is "Luciel owns a work address," like any new hire getting a company
 * email — not OAuth into a human's personal inbox. Two ways to get one: the
 * business's own domain (guided DNS/MX, "Action needed: complete email routing"
 * until it verifies) or a free @vantagemind.ai address with no DNS at all.
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
  const { busy, notice, run } = useActionNotice();
  const [emailAddress, setEmailAddress] = React.useState('');
  const emailValid = EMAIL.test(emailAddress.trim());

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
      ) : !provisioning.data ? (
        <div className="mt-vm-4 space-y-vm-4">
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
                      onChange={(e) => setEmailAddress(e.target.value)}
                      placeholder="hello@yourbusiness.com"
                    />
                  )}
                </Field>
              </div>
              <Button
                variant="primary"
                onClick={() => void setupOwnDomain()}
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
            <Button
              variant="secondary"
              onClick={useSubdomain}
              disabled={busy}
              className="mt-vm-3"
            >
              Use a free @vantagemind.ai address
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-vm-4 rounded-vm-card border border-vm-border p-vm-4">
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
                sent to this address starts reaching Luciel as soon as they publish — until then the
                address isn&apos;t live.
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
              This is Luciel&apos;s own address: it answers email sent here, and anything it sends
              goes out from here.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
