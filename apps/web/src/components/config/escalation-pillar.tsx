'use client';

import * as React from 'react';
import {
  Card,
  CardTitle,
  CardDescription,
  Field,
  Input,
  Select,
  Button,
  Banner,
  Toggle,
} from '@luciel/ui';
import type {
  Luciel,
  EscalationContact,
  EscalationSignal,
  NotificationChannel,
  TestSmsWhich,
} from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';
import { useServerDraft } from '@/lib/use-server-draft';
import { useActionNotice } from '@/lib/use-action-notice';

/**
 * Escalation pillar (Vision §3.4, Customer Journey §4.4/§7). The admin sets
 * WHO/HOW, never WHEN. The four signals are FIXED — shown as the doctrine line,
 * never as toggles. Editable: primary/backup contact, the default channel, and
 * per-signal channel + cc-owner-email. All of it drives real delivery routing.
 */
const SIGNALS: { id: EscalationSignal; label: string }[] = [
  { id: 'explicit_human_request', label: 'Lead asks for a human' },
  { id: 'cannot_answer', label: "Luciel can't confidently answer" },
  { id: 'strong_negative_sentiment', label: 'Lead seems frustrated' },
  { id: 'high_value_lead', label: 'High-value lead spotted' },
];

type RoutingRule = NonNullable<EscalationContact['routing']>[number];

/** A cleared field must go back as absent, not as an empty string. */
const orUndefined = (value: string) => (value.trim() === '' ? undefined : value.trim());

/** International format only — the one shape a text can be delivered to (F084). */
const SMS_HINT = 'International format, e.g. +16045551234';

/** Why a test text did not go out, in the owner's words (outbound vocabulary). */
const TEST_SMS_FAILURE: Record<string, string> = {
  channel_not_provisioned:
    'Your Luciel has no SMS number connected yet — add one under Channels before texts can go out.',
  sms_sender_not_operable:
    'Your SMS number is not operable right now — check its status under Channels.',
};

/** Human copy for the server-owned per-address confirmation state (5B #13). */
const HEALTH_COPY: Record<string, string> = {
  verified: 'Confirmed',
  pending_confirmation: 'Confirmation sent — waiting for the click',
  unverified: 'Not confirmed yet',
  bouncing: 'Bouncing — mail to this address is failing',
};

export function EscalationPillar({ luciel }: { luciel: Luciel }) {
  const { updateEscalation, resendContactConfirmation, sendTestEscalationSms } =
    useLucielMutations();
  const {
    draft,
    dirty,
    edit: setDraft,
    discard,
    saved,
  } = useServerDraft<EscalationContact>(luciel.escalation);
  const { busy, notice, run } = useActionNotice();

  // SMS notifications require the SMS channel enabled (Arch §3.5.1). Offering
  // the SMS route on an account that can't send SMS silently routes a
  // high-value-lead page into nothing — the option stays visible but disabled,
  // with the reason, until the channel is on.
  const smsRoutable = luciel.channels.some((c) => c.id === 'sms' && c.enabled);

  // Server-owned sibling of the escalation blob (5B #13); tolerate its absence
  // so a payload from before the field existed still renders the pillar.
  const contactHealth = luciel.escalationContactHealth ?? [];

  // Saved SMS contacts get the phone-side twin of the email confirmation loop
  // (2026-09-05 audit F084): a test text through the tenant's own number, so the
  // first real hot lead is never the first delivery attempt.
  const savedSms: { which: TestSmsWhich; number: string; label: string }[] = [
    { which: 'primary' as const, number: luciel.escalation.primarySms, label: 'primary SMS' },
    { which: 'secondary' as const, number: luciel.escalation.secondarySms, label: 'backup SMS' },
  ].filter((c): c is { which: TestSmsWhich; number: string; label: string } => Boolean(c.number));
  const sendTestText = (which: TestSmsWhich, number: string) =>
    void run(async () => {
      const result = await sendTestEscalationSms.mutateAsync(which);
      if (!result.delivered) {
        throw new Error(
          TEST_SMS_FAILURE[result.detail ?? ''] ??
            'The test text could not be sent. Check the number and your SMS channel.',
        );
      }
      return `Test text sent to ${number}. If it does not arrive within a minute, check the number and your SMS channel.`;
    }, 'We could not send the test text. Please try again in a minute.');

  const ruleFor = (signal: EscalationSignal): RoutingRule | undefined =>
    draft.routing?.find((r) => r.signal === signal);

  const routeFor = (signal: EscalationSignal): NotificationChannel =>
    ruleFor(signal)?.channel ?? draft.preferredChannel ?? 'email';

  // The backend only honours cc-owner-email from a rule that matches the signal,
  // so editing either half writes the whole rule.
  const setRule = (signal: EscalationSignal, patch: Partial<Omit<RoutingRule, 'signal'>>) => {
    const current: RoutingRule = ruleFor(signal) ?? { signal, channel: routeFor(signal) };
    const routing = (draft.routing ?? []).filter((r) => r.signal !== signal);
    routing.push({ ...current, ...patch });
    setDraft({ ...draft, routing });
  };

  const save = () =>
    void run(async () => {
      await updateEscalation.mutateAsync({
        ...draft,
        primaryEmail: orUndefined(draft.primaryEmail ?? ''),
        primarySms: orUndefined(draft.primarySms ?? ''),
        secondaryEmail: orUndefined(draft.secondaryEmail ?? ''),
        secondarySms: orUndefined(draft.secondarySms ?? ''),
      });
      saved();
      return 'Saved. Escalations route to these contacts from now on.';
    }, 'We could not save your escalation settings. Your existing routing is unchanged — please try again.');

  return (
    <Card>
      <CardTitle>Escalation contact</CardTitle>
      <CardDescription>The human your Luciel reaches when it needs a person.</CardDescription>

      <div className="mt-vm-4 grid gap-vm-3 sm:grid-cols-2">
        <Field id="esc-email" label="Primary email">
          {(p) => (
            <Input
              type="email"
              value={draft.primaryEmail ?? ''}
              onChange={(e) => setDraft({ ...draft, primaryEmail: e.target.value })}
              {...p}
            />
          )}
        </Field>
        <Field id="esc-sms" label="Primary SMS (optional)" hint={SMS_HINT}>
          {(p) => (
            <Input
              type="tel"
              value={draft.primarySms ?? ''}
              onChange={(e) => setDraft({ ...draft, primarySms: e.target.value })}
              {...p}
            />
          )}
        </Field>
        <Field id="esc-email-2" label="Backup email (optional)">
          {(p) => (
            <Input
              type="email"
              value={draft.secondaryEmail ?? ''}
              onChange={(e) => setDraft({ ...draft, secondaryEmail: e.target.value })}
              {...p}
            />
          )}
        </Field>
        <Field id="esc-sms-2" label="Backup SMS (optional)" hint={SMS_HINT}>
          {(p) => (
            <Input
              type="tel"
              value={draft.secondarySms ?? ''}
              onChange={(e) => setDraft({ ...draft, secondarySms: e.target.value })}
              {...p}
            />
          )}
        </Field>
      </div>

      <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
        The backup contact is only used if the primary one on that channel can&apos;t be reached.
      </p>

      {/* Server-owned deliverability truth per email contact (round 5B item 13).
          A hot lead routed to a typo'd or bouncing inbox vanishes silently —
          this is where the owner sees it and restarts the confirmation loop. */}
      {contactHealth.length > 0 && (
        <ul className="mt-vm-3 space-y-vm-2" aria-label="Email contact confirmation status">
          {contactHealth.map((h) => (
            <li
              key={h.address}
              className="flex flex-wrap items-center justify-between gap-vm-2 text-vm-0"
            >
              <span className={h.state === 'bouncing' ? 'text-vm-danger' : undefined}>
                {h.address} — {HEALTH_COPY[h.state] ?? h.state}
              </span>
              {h.state !== 'verified' && (
                <Button
                  variant="secondary"
                  disabled={resendContactConfirmation.isPending}
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
            </li>
          ))}
        </ul>
      )}
      {savedSms.length > 0 && (
        <ul className="mt-vm-3 space-y-vm-2" aria-label="SMS contact test">
          {savedSms.map((c) => (
            <li
              key={c.which}
              className="flex flex-wrap items-center justify-between gap-vm-2 text-vm-0"
            >
              <span>
                {c.number} — {c.label}
              </span>
              <Button
                variant="secondary"
                disabled={sendTestEscalationSms.isPending || dirty}
                onClick={() => sendTestText(c.which, c.number)}
              >
                Send a test text
              </Button>
            </li>
          ))}
        </ul>
      )}
      {contactHealth.some((h) => h.state === 'bouncing') && (
        <Banner tone="warning" className="mt-vm-2">
          Escalations skip a bouncing address and fall back to your account email, so you still
          hear about hot leads — but fix or replace the address to page the right person.
        </Banner>
      )}

      <div className="mt-vm-3 sm:max-w-xs">
        <Field
          id="esc-preferred"
          label="Default channel"
          hint="Used for any signal you haven't routed explicitly below."
        >
          {(p) => (
            <Select
              value={draft.preferredChannel ?? 'email'}
              onChange={(e) =>
                setDraft({ ...draft, preferredChannel: e.target.value as NotificationChannel })
              }
              {...p}
            >
              <option value="email">Email</option>
              <option value="sms" disabled={!smsRoutable}>
                {smsRoutable ? 'SMS' : 'SMS — enable the SMS channel first'}
              </option>
            </Select>
          )}
        </Field>
      </div>

      {/* The doctrine line — fixed signals, not toggles (Vision §3.4). */}
      <Banner tone="info" className="mt-vm-2">
        Luciel will reach you when a lead asks for a real person, when it can&apos;t confidently
        answer, when a lead seems frustrated, or when it spots a high-value lead. You don&apos;t
        configure this — Luciel decides <em>when</em>. You decide <em>who</em> it reaches and{' '}
        <em>how</em>.
      </Banner>

      {/* Per-signal routing: who/how only. */}
      <h4 className="mt-vm-4 text-vm-1 font-label">Routing — who gets paged, on which channel</h4>
      <ul className="mt-vm-2 space-y-vm-2">
        {SIGNALS.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-vm-3">
            <span className="text-vm-1">{s.label}</span>
            <div className="flex items-center gap-vm-3">
              <div className="w-40">
                <Select
                  aria-label={`Channel for ${s.label}`}
                  value={routeFor(s.id)}
                  onChange={(e) =>
                    setRule(s.id, { channel: e.target.value as NotificationChannel })
                  }
                >
                  <option value="email">Email</option>
                  <option value="sms" disabled={!smsRoutable}>
                    {smsRoutable ? 'SMS' : 'SMS — enable the SMS channel first'}
                  </option>
                </Select>
              </div>
              <div className="flex items-center gap-vm-2">
                <Toggle
                  checked={Boolean(ruleFor(s.id)?.ccOwnerEmail)}
                  onChange={(next) => setRule(s.id, { ccOwnerEmail: next })}
                  label={`Also copy the account owner for ${s.label}`}
                />
                <span className="text-vm-0 text-vm-text-muted">cc owner</span>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {notice && (
        <Banner className="mt-vm-3" tone={notice.tone}>
          {notice.text}
        </Banner>
      )}

      <div className="mt-vm-4 flex flex-wrap items-center gap-vm-3">
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save escalation settings'}
        </Button>
        {dirty && (
          <>
            <Button variant="ghost" onClick={discard} disabled={busy}>
              Discard changes
            </Button>
            <span className="text-vm-0 text-vm-text-muted">
              Unsaved changes — escalations still go to the contacts you saved last.
            </span>
          </>
        )}
      </div>
    </Card>
  );
}
