'use client';

import * as React from 'react';
import { Card, CardTitle, CardDescription, Button, Banner } from '@luciel/ui';
import { useLuciel } from '@/lib/hooks';

/**
 * Embed + launch (Customer Journey §5). One-line embed script with the embed
 * key; Copy, "Email this to my web person", and "Test it here" actions. The
 * embed key is the Luciel's own public key — it is the only key the widget
 * legitimately carries, injected via data-key (Space Instructions §3.4).
 */
export default function EmbedPage() {
  const { data: luciel } = useLuciel();
  const [copied, setCopied] = React.useState(false);

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
          <Button asChild variant="ghost">
            <a href="/embed-preview" target="_blank" rel="noopener noreferrer">
              Test it here
            </a>
          </Button>
        </div>
      </Card>

      <Banner tone="info">
        At launch, inbound email arrives on a VantageMind subdomain, not your own domain. Outbound
        email is sent on your behalf so replies look native.
      </Banner>
    </div>
  );
}
