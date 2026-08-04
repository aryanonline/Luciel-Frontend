'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardTitle, CardDescription, Button, Banner } from '@luciel/ui';
import { useLuciel } from '@/lib/hooks';
import { WidgetPreview } from '@/components/widget-preview';

/**
 * Embed + launch (Customer Journey §5). One-line embed script with the embed
 * key; Copy, "Email this to my web person", and "Test it here" actions. The
 * embed key is the Luciel's own public key — it is the only key the widget
 * legitimately carries, injected via data-key (Space Instructions §3.4).
 *
 * This tab is ONLY the widget (Decision #4): Luciel's own work-email address is
 * provisioned with the Email CHANNEL in Configure, one place, so the two surfaces
 * can't disagree.
 */

const snippetFor = (embedKey: string) =>
  `<script src="https://embed.vantagemind.ai/v1/luciel.js" data-key="${embedKey}"></script>`;

export default function EmbedPage() {
  const { data: luciel, isPending, isError, refetch } = useLuciel();
  const [copied, setCopied] = React.useState(false);
  const [copyFailed, setCopyFailed] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  // No key means no snippet — the placeholder used to be copyable and mailable,
  // so an owner could send their web developer a line that can never work
  // (P1-19).
  const embedKey = luciel?.embedKeyPublicId ?? null;
  const snippet = embedKey ? snippetFor(embedKey) : null;

  const copy = async () => {
    if (!snippet) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  const mailto = snippet
    ? `mailto:?subject=${encodeURIComponent('Add this to our website')}&body=${encodeURIComponent(
        `Hi — please add this one line just before </body> on our site:\n\n${snippet}\n\nThanks!`,
      )}`
    : null;

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

        {isPending ? (
          <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
            Loading your embed snippet…
          </p>
        ) : isError ? (
          <Banner tone="danger" className="mt-vm-3">
            We could not load your embed key, so the snippet is not shown rather than shown wrong.
            Your Luciel is unaffected.{' '}
            <button className="underline" onClick={() => void refetch()}>
              Try again
            </button>
          </Banner>
        ) : !snippet ? (
          <Banner tone="info" className="mt-vm-3">
            You don&apos;t have a Luciel yet, so there is nothing to embed.{' '}
            <Link href="/first-run" className="underline">
              Create one
            </Link>
            .
          </Banner>
        ) : (
          <>
            <pre className="mt-vm-3 overflow-x-auto rounded-vm-control border border-vm-border bg-vm-surface p-vm-3 text-vm-0">
              <code>{snippet}</code>
            </pre>
            {copyFailed && (
              <Banner tone="warning" className="mt-vm-3">
                Your browser blocked the copy. Select the line above and copy it by hand.
              </Banner>
            )}
            <div className="mt-vm-3 flex flex-wrap items-center gap-vm-2">
              <Button variant="primary" onClick={() => void copy()}>
                {/* Glyph + color echo the StatusChip "connected" treatment
                    (StatusChip.tsx) so "copied" reads as more than a label
                    swap — a visible state change, not just different text in
                    the same button (Harmony fix FE-H#11). */}
                {copied ? (
                  <>
                    <span aria-hidden="true">✓</span> Copied
                  </>
                ) : (
                  'Copy'
                )}
              </Button>
              {/* Announced for screen-reader users too — the label swap alone
                  is silent to anyone not looking at the button. */}
              <span role="status" className="sr-only">
                {copied ? 'Snippet copied to clipboard.' : ''}
              </span>
              {mailto && (
                <Button asChild variant="secondary">
                  <a href={mailto}>Email this to my web person</a>
                </Button>
              )}
              <Button variant="ghost" onClick={() => setTesting((t) => !t)}>
                {testing ? 'Close test' : 'Test it here'}
              </Button>
            </div>
          </>
        )}

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
    </div>
  );
}
