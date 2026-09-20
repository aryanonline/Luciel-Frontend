'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardTitle, CardDescription, Button, Modal, Banner, PageHeader } from '@luciel/ui';
import type { AccountExportResult } from '@luciel/api-client';
import { useLuciel, useLucielMutations } from '@/lib/hooks';
import { api } from '@/lib/api';

/**
 * Manage account — the lifecycle (Vision §6; Arch §3.6). THREE distinct, nested
 * actions, never blurred:
 *  - Pause: reversible freeze; widget renders an empty <div>; no budget accrual;
 *    no grace timer. In-flight conversations finish.
 *  - Delete Luciel: 30-day grace, restorable to ACTIVE (not paused); account
 *    shell survives (you can build a fresh Luciel without re-signing-up).
 *  - Close account: requires the Luciel deleted first; export-first; ends the
 *    login/email/billing.
 * Each carries its correct, distinct confirmation copy.
 *
 * Every action here is irreversible or nearly so, which is exactly why none of
 * them may fail quietly: the modals run their mutation with `mutateAsync` so the
 * dialog owns the pending and failure states, and the two inline buttons carry
 * their own (P0-4, P0-5).
 */
type Dialog = null | 'pause' | 'delete' | 'close' | 'export';

export default function AccountPage() {
  const router = useRouter();
  const { data: luciel } = useLuciel();
  const m = useLucielMutations();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  /**
   * The served export result (round 7 WP-10, item 12): the API answers with the
   * time-limited download link, and the UI used to discard it — email was the only
   * delivery, and a failed request closed the dialog as if it had worked. The link
   * now renders in the dialog on success (the email sentence stays), and a failure
   * stays in the dialog with its reason (Modal's async contract).
   */
  const [exportResult, setExportResult] = React.useState<AccountExportResult | null>(null);

  const close = () => {
    setDialog(null);
    setExportResult(null);
  };
  const isPaused = luciel?.state === 'paused';
  const inGrace = luciel?.state === 'luciel_grace_window';
  /**
   * Closing the account requires the Luciel deleted first (client.ts account.close).
   * Gate on that rather than letting the API reject a confirmed destructive
   * action, and point at the step that unblocks it (P0-5).
   */
  const liveLuciel = Boolean(luciel) && !inGrace;

  /** Inline (non-modal) actions still have to report; the modals report themselves. */
  const runInline = async (action: () => Promise<unknown>, failure: string) => {
    setInlineError(null);
    try {
      await action();
    } catch {
      setInlineError(failure);
    }
  };

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Manage account"
        description="Pause, delete your Luciel, or close your account — three distinct actions, each reversible up to a point."
      />

      {inlineError && <Banner tone="danger">{inlineError}</Banner>}

      {inGrace && (
        <Banner tone="warning">
          Your Luciel is deleted and in its 30-day grace window. You can restore it — it comes back
          fully active, exactly as it was — until the window ends, after which deletion is
          permanent.
          <div className="mt-vm-2">
            <Button
              variant="primary"
              disabled={m.restore.isPending}
              onClick={() =>
                void runInline(
                  () => m.restore.mutateAsync(),
                  'We could not restore your Luciel. It is still deleted — please try again.',
                )
              }
            >
              {m.restore.isPending ? 'Restoring…' : 'Restore my Luciel'}
            </Button>
          </div>
        </Banner>
      )}

      <Card>
        <CardTitle>Pause my Luciel</CardTitle>
        <CardDescription>
          A reversible freeze. The widget renders nothing (no error), channels go quiet, and no
          conversation budget accrues. A conversation in progress finishes; only new ones are held.
          Reactivatable instantly.
        </CardDescription>
        <div className="mt-vm-3">
          {isPaused ? (
            <Button
              variant="primary"
              disabled={m.resume.isPending}
              onClick={() =>
                void runInline(
                  () => m.resume.mutateAsync(),
                  'We could not resume your Luciel. It is still paused — please try again.',
                )
              }
            >
              {m.resume.isPending ? 'Resuming…' : 'Resume my Luciel'}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setDialog('pause')} disabled={inGrace}>
              Pause my Luciel
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>Delete my Luciel</CardTitle>
        <CardDescription>
          Removes the Luciel and everything attached to it — but leaves your account open, so you
          can build a fresh one later without signing up again. 30-day grace window; restorable to
          fully active within it. This is &ldquo;let the employee go but keep the office.&rdquo;
        </CardDescription>
        <div className="mt-vm-3">
          <Button variant="danger" onClick={() => setDialog('delete')} disabled={inGrace}>
            Delete my Luciel
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Close my account</CardTitle>
        <CardDescription>
          Ends the account itself — login, email, and billing. Because it&apos;s the bigger step, it
          can only happen once your Luciel is deleted, so it unlocks after the step above. This is
          &ldquo;close the office entirely.&rdquo;
        </CardDescription>
        <div className="mt-vm-3 flex gap-vm-2">
          <Button variant="secondary" onClick={() => setDialog('export')}>
            Download all my data
          </Button>
          <Button variant="danger" onClick={() => setDialog('close')} disabled={liveLuciel}>
            Close my account
          </Button>
        </div>
        {liveLuciel && (
          <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
            Delete your Luciel first — that&apos;s the step above. Your data stays exportable
            throughout its 30-day grace window.
          </p>
        )}
      </Card>

      {/* Pause confirmation. */}
      <Modal
        open={dialog === 'pause'}
        onOpenChange={close}
        title="Pause your Luciel?"
        description="New conversations are held until you resume; any in-progress conversation finishes. No budget accrues while paused, and no data is touched."
        confirmLabel="Pause"
        confirmPendingLabel="Pausing…"
        onConfirm={async () => {
          await m.pause.mutateAsync();
          close();
        }}
      />

      {/* Delete-Luciel confirmation — distinct from Close. */}
      <Modal
        open={dialog === 'delete'}
        onOpenChange={close}
        title="Delete your Luciel?"
        description="This tears down the Luciel and everything attached to it (knowledge, conversations, leads, connections). Your account stays open. You have 30 days to restore it to fully active; after that it's permanent."
        confirmLabel="Delete Luciel"
        confirmPendingLabel="Deleting…"
        confirmVariant="danger"
        onConfirm={async () => {
          await m.remove.mutateAsync();
          close();
        }}
      />

      {/* Export-first. The dialog stays open on success to show the served link,
          and on failure to show the reason — it never closes as if it had worked. */}
      <Modal
        open={dialog === 'export'}
        onOpenChange={close}
        title="Download all your data"
        description={
          exportResult
            ? undefined
            : "We'll prepare a bundle (conversations, leads, your uploaded files, audit log, and your connection configuration — provider and non-secret config only, never secrets). The download link appears here and is also emailed to you; it works for 7 days, and the data stays exportable through the 30-day grace window."
        }
        confirmLabel={exportResult ? undefined : 'Prepare my export'}
        confirmPendingLabel="Preparing…"
        cancelLabel={exportResult ? 'Done' : 'Cancel'}
        onConfirm={
          exportResult
            ? undefined
            : async () => {
                setExportResult(await api.account.requestExport());
              }
        }
      >
        {exportResult && <ExportReady result={exportResult} />}
      </Modal>

      {/*
        Close-account confirmation. Reachable only once the Luciel is deleted, and
        it offers the export one last time before the account ends — the second
        half of the two-step the card describes.
      */}
      <Modal
        open={dialog === 'close'}
        onOpenChange={close}
        title="Close your account?"
        description="This ends your login, email, and billing. After closure, transcripts and audit log are retained for 1 year, then permanently deleted — the export is how you keep anything beyond that. This can't be undone."
        confirmLabel="Close account"
        confirmPendingLabel="Closing…"
        confirmVariant="danger"
        onConfirm={async () => {
          // The modal above is the confirmation the server requires (F156).
          await api.account.close({ confirmDeleteLuciel: true });
          close();
          router.replace('/');
        }}
      >
        <Banner tone="warning">
          Take your data with you first — once the account closes you cannot request an export.
          <div className="mt-vm-2">
            <Button variant="secondary" onClick={() => setDialog('export')}>
              Download all my data
            </Button>
          </div>
        </Banner>
      </Modal>
    </div>
  );
}

/**
 * The export outcome, from the served result (round 7 WP-10, item 12): the link
 * itself when the server returned one, how long it lives, and that it was also
 * emailed — so a lost email is never the only way to the owner's own data. An
 * older server's bare `{ ok: true }` degrades to the email sentence alone.
 */
function ExportReady({ result }: { result: AccountExportResult }) {
  const days = result.ttlDays;
  const life = days === undefined ? '' : ` It works for ${days} day${days === 1 ? '' : 's'}.`;
  return (
    <div className="space-y-vm-2 text-vm-1" role="status">
      <p className="font-label">Your export is ready.</p>
      {result.downloadUrl ? (
        <p>
          <a
            href={result.downloadUrl}
            className="underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            Download your export
          </a>
          {life}
        </p>
      ) : null}
      <p className="text-vm-text-muted">
        {result.downloadUrl
          ? 'We also emailed this link to you.'
          : `We emailed the download link to you.${life}`}
      </p>
    </div>
  );
}
