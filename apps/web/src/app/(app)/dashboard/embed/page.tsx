'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardTitle, CardDescription, Button, Banner, Modal } from '@luciel/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLuciel, qk } from '@/lib/hooks';
import { api } from '@/lib/api';
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

/**
 * Legacy execCommand fallback for browsers/environments where
 * `navigator.clipboard` is absent entirely (locked-down machines, some
 * embedded webviews, non-HTTPS contexts). Builds an off-screen textarea,
 * selects its content, and asks the browser to copy the current selection.
 * Returns whether the browser reports the command as having succeeded —
 * `execCommand` itself can return `false` or throw when copying is disabled
 * outright, and both must be treated as a failure, not silently swallowed.
 */
function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Off-screen but still selectable/focusable — some browsers refuse to copy
  // from an element that never entered the layout.
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}

/**
 * Selects the rendered snippet's own text (the <pre><code> block on the
 * page) so a customer who hits total copy failure can still copy by hand
 * with one extra keystroke instead of having to drag-select it themselves.
 */
function selectSnippetNode(node: HTMLPreElement | null) {
  if (!node) return;
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

export default function EmbedPage() {
  const { data: luciel, isPending, isError, refetch } = useLuciel();
  const qc = useQueryClient();
  // 2026-09-05 audit F142: a leaked embed key used to be unfixable short of
  // delete-and-recreate. Rotation mints a new public key; the old one stops
  // loading the widget immediately, so the modal says exactly that.
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [rotated, setRotated] = React.useState(false);
  const rotateKey = async () => {
    // Throws on failure on purpose — the Modal shows it and stays open.
    await api.luciel.rotateEmbedKey();
    await qc.invalidateQueries({ queryKey: qk.luciel });
    setRotateOpen(false);
    setRotated(true);
  };
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const [testing, setTesting] = React.useState(false);
  const snippetRef = React.useRef<HTMLPreElement | null>(null);

  // No key means no snippet — the placeholder used to be copyable and mailable,
  // so an owner could send their web developer a line that can never work
  // (P1-19).
  const embedKey = luciel?.embedKeyPublicId ?? null;
  const snippet = embedKey ? snippetFor(embedKey) : null;

  /**
   * Fallback chain + feedback on EVERY outcome (Harmony wave 2, item 5
   * follow-up). The 1ac6a30 fix only made the SUCCESS state visually
   * unmistakable — it never gave any feedback at all when
   * `navigator.clipboard` is unavailable (locked-down machines,
   * non-HTTPS/http contexts, some embedded webviews) or when
   * `writeText` rejects (denied permission). In both cases the button's
   * text/className never changed, which reads as "nothing happened" on a
   * real click — exactly what was verified live via 3s of DOM polling.
   * This tries the modern Clipboard API first, falls back to a
   * textarea + `document.execCommand('copy')` on absence OR rejection,
   * and on total failure (both paths fail) selects the on-page snippet
   * text so the customer can still copy it with one extra keystroke.
   */
  const copy = async () => {
    if (!snippet) return;
    try {
      if (!navigator.clipboard) throw new Error('clipboard API unavailable');
      await navigator.clipboard.writeText(snippet);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
      return;
    } catch {
      // Fall through to the legacy fallback below.
    }
    if (legacyCopy(snippet)) {
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
      return;
    }
    setCopyState('failed');
    selectSnippetNode(snippetRef.current);
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
            <pre
              ref={snippetRef}
              className="mt-vm-3 overflow-x-auto rounded-vm-control border border-vm-border bg-vm-surface p-vm-3 text-vm-0"
            >
              <code>{snippet}</code>
            </pre>
            {/* Total-failure surface (Harmony wave 2, item 5 follow-up): shown
                only when BOTH the Clipboard API and the execCommand fallback
                failed. `role="status"` is Banner's own built-in live region,
                so this is announced to assistive tech without a second
                aria-live element. The snippet above is also selected
                programmatically at the moment this appears, so "select the
                code above" is one keystroke (Cmd/Ctrl+C) away, not a manual
                drag-select. */}
            {copyState === 'failed' && (
              <Banner tone="danger" className="mt-vm-3">
                Couldn&apos;t copy — select the code above and copy it by hand (it&apos;s already
                selected for you).
              </Banner>
            )}
            <div className="mt-vm-3 flex flex-wrap items-center gap-vm-2">
              {/* Wave 2, item 5: the wave-1 fix (36d4087) swapped in a glyph +
                  text label but kept `variant="primary"` unconditionally, so
                  the button's own background/text color never actually
                  changed — despite the comment above claiming a "color echo"
                  of StatusChip's connected treatment. A same-color button
                  whose only difference is a small glyph plus a five-letter
                  text swap reads as unchanged on a quick glance, which is
                  exactly what "verified live, twice: text stays Copy" was
                  most likely reporting — not a broken state update (confirmed
                  working via direct DOM inspection in a real browser: the text
                  node itself does flip to "Copied" and back), but a signal too
                  weak to register as a visible state change. Switching the
                  variant on `copied` — primary (accent) -> the same
                  bg-vm-surface/text-vm-success/border treatment StatusChip's
                  "connected" chip uses — makes the change unmistakable, using
                  `!` (important) modifiers so this override can never lose a
                  Tailwind cascade-order tie against the variant's own
                  same-specificity utility classes. */}
              {/* Harmony wave 2, item 5 follow-up: feedback on EVERY click
                  outcome, not just clipboard success. `copyState === 'failed'`
                  gets its own (danger-leaning) treatment so a total failure
                  reads as distinctly as the success state does — neither
                  looks like the plain idle button. */}
              <Button
                variant={copyState === 'idle' ? 'primary' : 'secondary'}
                className={
                  copyState === 'copied'
                    ? '!border-vm-success !bg-vm-surface !text-vm-success'
                    : copyState === 'failed'
                      ? '!border-vm-danger !bg-vm-surface !text-vm-danger'
                      : undefined
                }
                onClick={() => void copy()}
              >
                {copyState === 'copied' ? (
                  <>
                    <span aria-hidden="true">✓</span> Copied
                  </>
                ) : copyState === 'failed' ? (
                  <>
                    <span aria-hidden="true">⚠</span> Couldn&apos;t copy
                  </>
                ) : (
                  'Copy'
                )}
              </Button>
              {/* Announced for screen-reader users too — the label swap alone
                  is silent to anyone not looking at the button. `aria-live`
                  is set explicitly rather than relying on role="status"'s
                  implicit mapping, so the announcement is robust across every
                  screen reader/browser pairing, not just the ones that honor
                  the implicit role -> live-region mapping. Covers BOTH
                  outcomes now, not just success — a screen-reader user
                  clicking Copy on a locked-down machine must hear that it
                  failed, not silence. */}
              <span role="status" aria-live="polite" className="sr-only">
                {copyState === 'copied'
                  ? 'Snippet copied to clipboard.'
                  : copyState === 'failed'
                    ? "Couldn't copy the snippet. It has been selected above so you can copy it by hand."
                    : ''}
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
              This is your Luciel, answering from your knowledge. Ask it something a customer would.
            </p>
            <WidgetPreview embedKey={luciel.embedKeyPublicId} />
          </div>
        )}
      </Card>
      {snippet && (
        <Card>
          <CardTitle>Embed key</CardTitle>
          <CardDescription>
            The key in your snippet is public by design, but if it ends up somewhere it should not
            be, you can replace it. The old key stops loading the widget the moment you confirm, so
            update the snippet on your site right after.
          </CardDescription>
          {rotated && (
            <Banner tone="info" className="mt-vm-3">
              New embed key issued. Copy the updated snippet above onto your website — the previous
              key no longer loads the widget.
            </Banner>
          )}
          <Button variant="secondary" className="mt-vm-3" onClick={() => setRotateOpen(true)}>
            Rotate embed key
          </Button>
          <Modal
            open={rotateOpen}
            onOpenChange={setRotateOpen}
            title="Rotate your embed key?"
            description="A new public key is issued right away and your current key stops loading the widget immediately. Your website shows no chat until you paste the updated snippet. Nothing else — conversations, knowledge, connections — changes."
            confirmLabel="Rotate key"
            confirmVariant="danger"
            confirmPendingLabel="Rotating…"
            onConfirm={rotateKey}
          />
        </Card>
      )}
    </div>
  );
}
