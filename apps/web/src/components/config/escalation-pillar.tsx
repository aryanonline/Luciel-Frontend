'use client';

import * as React from 'react';
import { Card, CardTitle, CardDescription, Field, Input, Select, Button, Banner } from '@luciel/ui';
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
 * never as toggles. Only contact + per-signal routing channel are editable.
 */
const SIGNALS: { id: EscalationSignal; label: string }[] = [
  { id: 'explicit_human_request', label: 'Lead asks for a human' },
  { id: 'cannot_answer', label: "Luciel can't confidently answer" },
  { id: 'strong_negative_sentiment', label: 'Lead seems frustrated' },
  { id: 'high_value_lead', label: 'High-value lead spotted' },
];

export function EscalationPillar({ luciel }: { luciel: Luciel }) {
  const { updateEscalation } = useLucielMutations();
  const [draft, setDraft] = React.useState<EscalationContact>(luciel.escalation);

  React.useEffect(() => setDraft(luciel.escalation), [luciel.escalation]);

  const routeFor = (signal: EscalationSignal): NotificationChannel =>
    draft.routing?.find((r) => r.signal === signal)?.channel ?? draft.preferredChannel ?? 'email';

  const setRoute = (signal: EscalationSignal, channel: NotificationChannel) => {
    const routing = (draft.routing ?? []).filter((r) => r.signal !== signal);
    routing.push({ signal, channel });
    setDraft({ ...draft, routing });
  };

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
            <div className="w-40">
              <Select
                aria-label={`Channel for ${s.label}`}
                value={routeFor(s.id)}
                onChange={(e) => setRoute(s.id, e.target.value as NotificationChannel)}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </Select>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-vm-4">
        <Button
          variant="primary"
          onClick={() => updateEscalation.mutate(draft)}
          disabled={updateEscalation.isPending}
        >
          {updateEscalation.isPending ? 'Saving…' : 'Save escalation settings'}
        </Button>
      </div>
    </Card>
  );
}
