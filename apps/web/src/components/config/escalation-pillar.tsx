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
} from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';

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

export function EscalationPillar({ luciel }: { luciel: Luciel }) {
  const { updateEscalation } = useLucielMutations();
  const [draft, setDraft] = React.useState<EscalationContact>(luciel.escalation);

  React.useEffect(() => setDraft(luciel.escalation), [luciel.escalation]);

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
    updateEscalation.mutate({
      ...draft,
      primaryEmail: orUndefined(draft.primaryEmail ?? ''),
      primarySms: orUndefined(draft.primarySms ?? ''),
      secondaryEmail: orUndefined(draft.secondaryEmail ?? ''),
      secondarySms: orUndefined(draft.secondarySms ?? ''),
    });

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
        <Field id="esc-sms" label="Primary SMS (optional)">
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
        <Field id="esc-sms-2" label="Backup SMS (optional)">
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
              <option value="sms">SMS</option>
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
                  <option value="sms">SMS</option>
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

      <div className="mt-vm-4">
        <Button variant="primary" onClick={save} disabled={updateEscalation.isPending}>
          {updateEscalation.isPending ? 'Saving…' : 'Save escalation settings'}
        </Button>
      </div>
    </Card>
  );
}
