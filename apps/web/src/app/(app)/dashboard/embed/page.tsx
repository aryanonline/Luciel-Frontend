'use client';

import * as React from 'react';
import {
  Card,
  CardTitle,
  CardDescription,
  Button,
  Banner,
  Field,
  Input,
  StatusChip,
} from '@luciel/ui';
import { chipForConnection } from '@luciel/api-client';
import { useLuciel, useEmailProvisioning, useProvisionEmail } from '@/lib/hooks';
import { WidgetPreview } from '@/components/widget-preview';

/**
 * Embed + launch (Customer Journey §5). One-line embed script with the embed
 * key; Copy, "Email this to my web person", and "Test it here" actions. The
 * embed key is the Luciel's own public key — it is the only key the widget
 * legitimately carries, injected via data-key (Space Instructions §3.4).
 *
 * Email provisioning (Arch §3.1.6a, Decision #49): the admin PROVISIONS the
 * address Luciel sends AND receives on. Two LAUNCH options — the business's own
 * domain (with a walked-through DNS/MX routing step, "Action needed: complete
 * email routing" until verified) or a zero-DNS VantageMind-subdomain fallback.
 * Own-domain inbound is NOT a deferred limitation.
 */

/** UX-only email shape check (client validation is never a security control). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailProvisioningCard() {
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
      <CardTitle>Email address for your Luciel</CardTitle>
      <CardDescription>
        Your Luciel sends and receives email on the address you provision here. Use your own domain,
        or start on a VantageMind address with no DNS setup.
      </CardDescription>

      {isLoading ? (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted">Loading email setup…</p>
      ) : !provisioning ? (
        <div className="mt-vm-4 space-y-vm-4">
          <div className="rounded-vm-card border border-vm-border p-vm-4">
            <h3 className="text-vm-2 font-label">Use your own domain</h3>
            <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
              Enter the address you want Luciel to use. We&apos;ll show you the DNS records to add so
              inbound email routes to Luciel. It goes live once routing is verified.
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
            <h3 className="text-vm-2 font-label">Or use a VantageMind address</h3>
            <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
              Start immediately on a VantageMind subdomain address — no DNS changes needed. You can
              move to your own domain later.
            </p>
            <Button
              variant="secondary"
              onClick={useSubdomain}
              disabled={provisionEmail.isPending}
              className="mt-vm-3"
            >
              Use a VantageMind address
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
                Add these DNS records at your domain host. Inbound email starts routing to Luciel
                once they verify — until then this address is not live.
              </p>
              <ul className="mt-vm-3 space-y-vm-2">
                {(provisioning.dnsRecords ?? []).map((r, i) => (
                  <li
                    key={i}
                    className="rounded-vm-control border border-vm-border bg-vm-surface p-vm-3 text-vm-0"
                  >
                    <span className="font-label">{r.type}</span> {r.host} →{' '}
                    <code>{r.value}</code>
                    {r.priority !== undefined ? ` (priority ${r.priority})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
              Your Luciel sends and receives on this address.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export default function EmbedPage() {
  const { data: luciel } = useLuciel();
  const [copied, setCopied] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  const embedKey = luciel?.embedKeyPublicId ?? 'vm_live_…';
  const snippet = `<script src="https://embed.vantagemind.ai/v1/luciel.js" data-key="${embedKey}"></script>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const mailto = `mailto:?subject=${encodeURIComponent('Add this to our website')}&body=${encodeURIComponent(
    `Hi — please add this one line just before </body> on our site:\n\n${snippet}\n\nThanks!`,
  )}`;

  return (
    <div className="space-y-vm-5">
      <div>
        <h1 className="font-heading text-vm-5">Embed &amp; launch</h1>
        <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
          Your Luciel is ready. Add this one line to your website.
        </p>
      </div>

      <Card>
        <CardTitle>Your embed snippet</CardTitle>
        <CardDescription>Paste it just before the closing &lt;/body&gt; tag.</CardDescription>
        <pre className="mt-vm-3 overflow-x-auto rounded-vm-control border border-vm-border bg-vm-surface p-vm-3 text-vm-0">
          <code>{snippet}</code>
        </pre>
        <div className="mt-vm-3 flex flex-wrap gap-vm-2">
          <Button variant="primary" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button asChild variant="secondary">
            <a href={mailto}>Email this to my web person</a>
          </Button>
          <Button
            variant="ghost"
            onClick={() => setTesting((t) => !t)}
            disabled={!luciel?.embedKeyPublicId}
          >
            {testing ? 'Close test' : 'Test it here'}
          </Button>
        </div>

        {/* The test runs against THIS Luciel's embed key, signed in, so what the
            admin tries here is the same assistant their visitors get (CJ §5). */}
        {testing && luciel?.embedKeyPublicId && (
          <div className="mt-vm-4">
            <p className="mb-vm-3 text-vm-1 text-vm-text-muted">
              This is your Luciel, answering from your knowledge. Ask it something a customer
              would.
            </p>
            <WidgetPreview embedKey={luciel.embedKeyPublicId} />
          </div>
        )}
      </Card>

      <EmailProvisioningCard />

      <Banner tone="info">
        Outbound email is sent on your behalf so replies look native. Inbound email routes to your
        Luciel on the address you provision above.
      </Banner>
    </div>
  );
}
