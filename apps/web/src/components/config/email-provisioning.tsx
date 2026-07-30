'use client';

import * as React from 'react';
import {
  Banner,
  Button,
  Card,
  CardTitle,
  CardDescription,
  Field,
  Input,
  StatusChip,
} from '@luciel/ui';
import { chipForConnection } from '@luciel/api-client';
import { useEmailProvisioning, useProvisionEmail } from '@/lib/hooks';

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
 * the channels pillar can render it inline beside the Email toggle.
 */

/** UX-only email shape check (client validation is never a security control). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailChannelProvisioning({ emailChannelEnabled }: { emailChannelEnabled: boolean }) {
  const { data: provisioning, isLoading } = useEmailProvisioning();
  const provisionEmail = useProvisionEmail();
  const [emailAddress, setEmailAddress] = React.useState('');
  const emailValid = EMAIL.test(emailAddress.trim());

  const setupOwnDomain = () => {
    if (!emailValid) return;
    provisionEmail.mutate({ mode: 'own_domain', emailAddress: emailAddress.trim() });
    setEmailAddress('');
  };
  const useSubdomain = () => provisionEmail.mutate({ mode: 'vm_subdomain' });

  return (
    <Card>
      <CardTitle>Luciel&apos;s work email</CardTitle>
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

      {isLoading ? (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted">Loading email setup…</p>
      ) : !provisioning ? (
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
                onClick={setupOwnDomain}
                disabled={!emailValid || provisionEmail.isPending}
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
              disabled={provisionEmail.isPending}
              className="mt-vm-3"
            >
              Use a free @vantagemind.ai address
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-vm-4 rounded-vm-card border border-vm-border p-vm-4">
          <div className="flex items-center justify-between gap-vm-3">
            <span className="text-vm-2 font-label">{provisioning.emailAddress}</span>
            {provisioning.status === 'pending_email_routing' ? (
              <StatusChip kind="action_needed" detail="complete email routing" />
            ) : (
              <StatusChip kind={chipForConnection(provisioning.status)} />
            )}
          </div>
          {provisioning.status === 'pending_email_routing' ? (
            <div className="mt-vm-3">
              <p className="text-vm-1 text-vm-text-muted">
                One copy-paste and you&apos;re done: add these records at your domain host. Email
                sent to this address starts reaching Luciel as soon as they publish — until then the
                address isn&apos;t live.
              </p>
              <ul className="mt-vm-3 space-y-vm-2">
                {(provisioning.dnsRecords ?? []).map((r, i) => (
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
    </Card>
  );
}
