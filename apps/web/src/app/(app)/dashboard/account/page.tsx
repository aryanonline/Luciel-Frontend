'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardTitle, CardDescription, Button, Modal, Banner, PageHeader } from '@luciel/ui';
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
 */
type Dialog = null | 'pause' | 'delete' | 'close' | 'export';

export default function AccountPage() {
  const router = useRouter();
  const { data: luciel } = useLuciel();
  const m = useLucielMutations();
  const [dialog, setDialog] = React.useState<Dialog>(null);

  const close = () => setDialog(null);
  const isPaused = luciel?.state === 'paused';
  const inGrace = luciel?.state === 'luciel_grace_window';

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Manage account"
        description="Pause, delete your Luciel, or close your account — three distinct actions, each reversible up to a point."
      />

      {inGrace && (
        <Banner tone="warning">
          Your Luciel is deleted and in its 30-day grace window. You can restore it — it comes back
          fully active, exactly as it was — until the window ends, after which deletion is
          permanent.
          <div className="mt-vm-2">
            <Button variant="primary" onClick={() => m.restore.mutate()}>
              Restore my Luciel
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
            <Button variant="primary" onClick={() => m.resume.mutate()}>
              Resume my Luciel
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
          can only happen once the Luciel is deleted; choosing this deletes the Luciel first (with
          an export), then closes. This is &ldquo;close the office entirely.&rdquo;
        </CardDescription>
        <div className="mt-vm-3 flex gap-vm-2">
          <Button variant="secondary" onClick={() => setDialog('export')}>
            Download all my data
          </Button>
          <Button variant="danger" onClick={() => setDialog('close')}>
            Close my account
          </Button>
        </div>
      </Card>

      {/* Pause confirmation. */}
      <Modal
        open={dialog === 'pause'}
        onOpenChange={close}
        title="Pause your Luciel?"
        description="New conversations are held until you resume; any in-progress conversation finishes. No budget accrues while paused, and no data is touched."
        confirmLabel="Pause"
        onConfirm={() => {
          m.pause.mutate();
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
        confirmVariant="danger"
        onConfirm={() => {
          m.remove.mutate();
          close();
        }}
      />

      {/* Export-first. */}
      <Modal
        open={dialog === 'export'}
        onOpenChange={close}
        title="Download all your data"
        description="We'll prepare a bundle (conversations, leads, your uploaded files, audit log, and your connection configuration — provider and non-secret config only, never secrets). You'll get an email with a download link that works for 7 days; the data stays exportable through the 30-day grace window."
        confirmLabel="Prepare my export"
        onConfirm={async () => {
          await api.account.requestExport();
          close();
        }}
      />

      {/* Close-account confirmation — nested (deletes Luciel first). */}
      <Modal
        open={dialog === 'close'}
        onOpenChange={close}
        title="Close your account?"
        description="This ends your login, email, and billing. Your Luciel is deleted first (export offered above). After closure, transcripts and audit log are retained for 1 year, then permanently deleted — the export is how you keep anything beyond that. This can't be undone."
        confirmLabel="Close account"
        confirmVariant="danger"
        onConfirm={async () => {
          await api.account.close();
          close();
          router.replace('/');
        }}
      />
    </div>
  );
}
