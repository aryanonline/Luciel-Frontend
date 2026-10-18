'use client';

import * as React from 'react';
import { Button, Field, Input, Modal } from '@luciel/ui';
import {
  confirmSmsContactRequest,
  LucielApiError,
  type EscalationContactHealth,
} from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';

/**
 * Per-contact deliverability truth (round 5B item 13; round 7 WP-4b): every
 * configured escalation contact — email AND SMS, and the after-hours contact — with
 * its served confirmation state and the action that moves it.
 *
 *  - Email: the link loop (Resend confirmation / Re-confirm a bouncing address).
 *  - SMS: a 6-digit code texted from the tenant's own number. Until the contact
 *    answers it, every page to that number is COPIED to the owner
 *    (escalation_dispatch `_proven`), and the row says so. "Enter code" calls
 *    POST /admin/luciel/escalation/contacts/confirm-sms (rate-limited — its 429 is
 *    rendered, never swallowed); "Resend code" re-mints through the resend route.
 *
 * Shared by the Escalation pillar (primary/backup) and the Team availability card
 * (the after-hours contact), so both say the same thing about the same number.
 */

type Run = (fn: () => Promise<string>, fallbackError?: string) => Promise<boolean>;

const EMAIL_STATE: Record<string, string> = {
  verified: 'Confirmed',
  pending_confirmation: 'Confirmation sent — waiting for the click',
  unverified: 'Not confirmed yet',
  bouncing: 'Bouncing — mail to this address is failing',
};

const ROLE_LABEL: Record<string, string> = {
  primary: 'primary',
  secondary: 'backup',
  after_hours: 'after hours',
};

/** What a code entry did, in the owner's words (contact_confirmation outcomes). */
const OUTCOME_COPY: Record<string, string> = {
  wrong_code: 'That code is not right. Check the text and try again.',
  locked: 'Too many wrong codes — that code no longer works. Resend a new one.',
  expired: 'That code has expired. Resend a new one, then enter it within 15 minutes.',
  no_pending: 'There is no code waiting for this number. Resend one first.',
};

export const SMS_UNCONFIRMED = 'Unconfirmed — escalations are copied to you until confirmed';

const isSms = (h: EscalationContactHealth) => h.channel === 'sms';

export function ContactHealthList({
  entries,
  label,
  busy,
  run,
  onNotice,
}: {
  entries: EscalationContactHealth[];
  label: string;
  busy: boolean;
  run: Run;
  /** Where a confirmed code is announced (the card's own notice banner). */
  onNotice: (text: string) => void;
}) {
  const { resendContactConfirmation } = useLucielMutations();
  const [codeFor, setCodeFor] = React.useState<string | null>(null);

  if (entries.length === 0) return null;
  return (
    <>
      <ul className="mt-vm-3 space-y-vm-2" aria-label={label}>
        {entries.map((h) => (
          <li
            key={`${h.channel ?? 'email'}:${h.role ?? ''}:${h.address}`}
            className="flex flex-wrap items-center justify-between gap-vm-2 text-vm-0"
          >
            {isSms(h) ? (
              <SmsRow h={h} />
            ) : (
              <span className={h.state === 'bouncing' ? 'text-vm-danger' : undefined}>
                {h.address} — {EMAIL_STATE[h.state] ?? 'Not confirmed yet'}
              </span>
            )}
            {h.state !== 'verified' && (
              <div className="flex flex-wrap gap-vm-2">
                {isSms(h) ? (
                  <>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setCodeFor(h.address)}
                    >
                      Enter code
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy || h.detail === 'sms_channel_not_provisioned'}
                      onClick={() =>
                        void run(async () => {
                          await resendContactConfirmation.mutateAsync(h.address);
                          return `A new code was texted to ${h.address}. It works for 15 minutes.`;
                        }, 'We could not send a new code. If one just went out, wait a few minutes and retry.')
                      }
                    >
                      Resend code
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={busy || resendContactConfirmation.isPending}
                    onClick={() =>
                      void run(async () => {
                        await resendContactConfirmation.mutateAsync(h.address);
                        return `Confirmation email sent to ${h.address}. The link stays valid for 7 days.`;
                      }, 'We could not send the confirmation email. If one just went out, wait a few minutes and retry.')
                    }
                  >
                    {h.state === 'bouncing' ? 'Re-confirm address' : 'Resend confirmation'}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <EnterCodeDialog
        number={codeFor}
        onClose={() => setCodeFor(null)}
        onConfirmed={(text) => {
          setCodeFor(null);
          onNotice(text);
        }}
      />
    </>
  );
}

function SmsRow({ h }: { h: EscalationContactHealth }) {
  const role = h.role ? ROLE_LABEL[h.role] : null;
  const who = `${h.address}${role ? ` (${role})` : ''}`;
  if (h.state === 'verified') return <span>{who} — Confirmed</span>;
  const why =
    h.detail === 'sms_channel_not_provisioned'
      ? 'No code could be sent: connect an SMS number under Configure → Channels first — the code goes out from your own number.'
      : h.state === 'pending_confirmation'
        ? 'A 6-digit code was texted to this number. The contact can text it back, or you can enter it here.'
        : 'No code is waiting — it expired or never went out. Resend one.';
  return (
    <span className="min-w-0">
      <span className="text-vm-warning">
        {who} — {SMS_UNCONFIRMED}
      </span>
      <span className="block text-vm-text-muted">{why}</span>
    </span>
  );
}

/**
 * The code entry — Modal's async contract: pending while the request settles, and
 * every refusal stays in the dialog (a wrong/expired/locked code, a 429, a 422).
 * Field-level validation mirrors the backend's StrictWireModel (exactly six digits).
 */
function EnterCodeDialog({
  number,
  onClose,
  onConfirmed,
}: {
  number: string | null;
  onClose: () => void;
  onConfirmed: (text: string) => void;
}) {
  const { confirmSmsContact } = useLucielMutations();
  const [code, setCode] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (number === null) {
      setCode('');
      setFieldError(undefined);
    }
  }, [number]);

  const submit = () => {
    if (!number) return;
    const parsed = confirmSmsContactRequest.safeParse({ number, code: code.trim() });
    if (!parsed.success) {
      setFieldError('Enter the 6-digit code from the text.');
      return; // synchronous: the dialog stays as it is, the field says why
    }
    setFieldError(undefined);
    return (async () => {
      try {
        const result = await confirmSmsContact.mutateAsync(parsed.data);
        if (result.outcome === 'confirmed' || result.outcome === 'already_confirmed') {
          onConfirmed(
            result.outcome === 'confirmed'
              ? `${number} is confirmed — escalations now go to it directly.`
              : `${number} was already confirmed.`,
          );
          return;
        }
        throw new Error(
          OUTCOME_COPY[result.outcome] ?? `That code was not accepted (${result.outcome}).`,
        );
      } catch (err) {
        if (err instanceof LucielApiError) {
          if (err.code === 'validation_error' && err.message.startsWith('code')) {
            setFieldError('Enter the 6-digit code from the text.');
          }
          if (err.code === 'rate_limited') {
            throw new Error(
              `${err.message || 'Too many code entries.'} Nothing was checked this time.`,
            );
          }
        }
        throw err;
      }
    })();
  };

  return (
    <Modal
      open={number !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Enter the confirmation code"
      description={number ? `The 6-digit code texted to ${number}.` : undefined}
      confirmLabel="Confirm number"
      confirmPendingLabel="Checking…"
      onConfirm={submit}
    >
      <Field id="sms-confirm-code" label="Code" error={fieldError}>
        {(p) => (
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            {...p}
          />
        )}
      </Field>
    </Modal>
  );
}
