'use client';

import * as React from 'react';
import { Card, CardTitle, CardDescription, Banner, Button, Modal } from '@luciel/ui';
import type { Luciel } from '@luciel/api-client';
import { useConnections, useConnectionLifecycle, useLucielMutations } from '@/lib/hooks';
import { useActionNotice } from '@/lib/use-action-notice';

/**
 * Your acknowledgements (round 6 WP-D): every consent the owner gave is listed
 * with when they gave it and can be withdrawn. Withdrawing is honest about the
 * consequence — the channel that depended on it goes off in the same write and
 * asks for the acknowledgement again when re-enabled.
 */

type Row = {
  id: 'voice_consent' | 'sms_compliance' | 'carrier_attestation';
  title: string;
  at: string;
  consequence: string;
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

export function Acknowledgements({ luciel }: { luciel: Luciel }) {
  const connections = useConnections();
  const { withdrawVoiceConsent, withdrawSmsComplianceAck } = useLucielMutations();
  const { withdrawSmsAttestation } = useConnectionLifecycle();
  const { notice, run } = useActionNotice();
  const [confirming, setConfirming] = React.useState<Row | null>(null);

  const voice = luciel.channels.find((c) => c.id === 'voice');
  const sms = luciel.channels.find((c) => c.id === 'sms');
  const smsRow = (connections.data ?? []).find(
    (c) => c.connectionType === 'sms_sender' && c.status !== 'revoked',
  );
  const attestedAt = smsRow?.nonSecretConfig?.carrier_registration_attested_at;

  const rows: Row[] = [];
  if (voice?.voiceConsentAcknowledgedAt) {
    rows.push({
      id: 'voice_consent',
      title: 'Voice recording and AI-disclosure consent',
      at: voice.voiceConsentAcknowledgedAt,
      consequence:
        'Phone calls are switched off with it. Turning Voice back on asks for this consent again.',
    });
  }
  if (sms?.smsComplianceAcknowledgedAt) {
    rows.push({
      id: 'sms_compliance',
      title: 'Carrier registration, sender-of-record and STOP/HELP responsibility',
      at: sms.smsComplianceAcknowledgedAt,
      consequence:
        'Texting is switched off with it, and Send SMS goes off too. Turning SMS back on asks for this acknowledgement again.',
    });
  }
  if (typeof attestedAt === 'string' && attestedAt) {
    rows.push({
      id: 'carrier_attestation',
      title: 'Carrier registration attested as approved',
      at: attestedAt,
      consequence:
        'Texting goes back behind the carrier-registration gate until you attest again. Calls, your number and your Twilio account are untouched.',
    });
  }

  const withdraw = (row: Row) =>
    run(async () => {
      if (row.id === 'voice_consent') await withdrawVoiceConsent.mutateAsync();
      else if (row.id === 'sms_compliance') await withdrawSmsComplianceAck.mutateAsync();
      else await withdrawSmsAttestation.mutateAsync();
      return `Withdrawn. ${row.consequence}`;
    }, 'We could not withdraw that acknowledgement. Nothing was changed — please try again.');

  return (
    <Card>
      <CardTitle>Your acknowledgements</CardTitle>
      <CardDescription>
        What you have agreed to, and when. Each one can be withdrawn; the channel that depends on it
        is switched off in the same step.
      </CardDescription>
      {rows.length === 0 ? (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted" data-testid="acknowledgements-empty">
          Nothing acknowledged yet — Voice and SMS ask for their acknowledgements when you turn them
          on.
        </p>
      ) : (
        <ul className="mt-vm-3 divide-y divide-vm-border" aria-label="Your acknowledgements">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-vm-3 py-vm-3 text-vm-1"
            >
              <span>
                {row.title}
                <span className="text-vm-text-muted"> — given {when(row.at)}</span>
              </span>
              <Button variant="ghost" onClick={() => setConfirming(row)}>
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <Banner tone={notice.tone} className="mt-vm-3">
          {notice.text}
        </Banner>
      )}
      <Modal
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming ? `Withdraw: ${confirming.title}?` : 'Withdraw?'}
        description={confirming?.consequence ?? ''}
        confirmLabel="Yes, withdraw"
        confirmPendingLabel="Withdrawing…"
        confirmVariant="danger"
        onConfirm={async () => {
          if (!confirming) return;
          const ok = await withdraw(confirming);
          if (ok) setConfirming(null);
        }}
      >
        <p className="text-vm-1">
          This is recorded under your account, like the acknowledgement was.
        </p>
      </Modal>
    </Card>
  );
}
