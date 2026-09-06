'use client';

import * as React from 'react';
import { Banner, Button, Modal } from '@luciel/ui';
import type { Connection } from '@luciel/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/hooks';

/**
 * 2026-09-05 audit F142: the per-connection webhook capability token Twilio calls
 * your number's webhooks with is the owner's to rotate — a leaked URL used to be
 * unfixable short of disconnecting Twilio. Rotation re-points the webhooks on the
 * designated number and invalidates the old URL; nothing else changes.
 */
export function SmsWebhookTokenRotate({ connection }: { connection: Connection | undefined }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  if (!connection || connection.status !== 'connected') return null;

  const rotate = async () => {
    setNotice(null);
    // Throws on failure on purpose: the Modal shows the error and stays open.
    const updated = await api.connections.rotateSmsCapability();
    qc.invalidateQueries({ queryKey: qk.connections });
    setOpen(false);
    setNotice(
      updated.statusDetail
        ? `Webhook token rotated. ${updated.statusDetail}`
        : 'Webhook token rotated. Twilio now calls the new URL; the old one no longer works.',
    );
  };

  return (
    <div className="mt-vm-3">
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Rotate webhook token
      </Button>
      {notice && (
        <Banner tone="info" className="mt-vm-2">
          {notice}
        </Banner>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Rotate the SMS webhook token?"
        description="Twilio reaches your Luciel through a webhook URL that carries a private token. Rotating it re-points your number's webhooks at a new URL and invalidates the old one — do this if the URL may have leaked. Texts and calls keep working; nothing else about the connection changes."
        confirmLabel="Rotate token"
        confirmPendingLabel="Rotating…"
        onConfirm={rotate}
      />
    </div>
  );
}
