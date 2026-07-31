'use client';

import * as React from 'react';
import {
  Card,
  CardTitle,
  CardDescription,
  Select,
  Textarea,
  Button,
  Field,
  Banner,
} from '@luciel/ui';
import type { Luciel, PersonalityConfig, PersonalityPreset } from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';
import { useServerDraft } from '@/lib/use-server-draft';
import { useActionNotice } from '@/lib/use-action-notice';

/**
 * Personality pillar (Vision §3.5, Customer Journey §4.5). 4 named presets +
 * Custom (exposes the four axes) + a single optional 280-char business-context
 * field. NO model selection anywhere (Arch §3.4.3). The AI-identity disclosure
 * cannot be turned off — the admin edits wording, never the fact (Vision §3.5).
 */
const PRESETS: { id: PersonalityPreset; label: string }[] = [
  { id: 'warm_concierge', label: 'Warm Concierge' },
  { id: 'professional_advisor', label: 'Professional Advisor' },
  { id: 'friendly_expert', label: 'Friendly Expert' },
  { id: 'trusted_authority', label: 'Trusted Authority' },
  { id: 'custom', label: 'Custom — set the four axes yourself' },
];

/** A bare 0–1 range announces "0.6" and nothing else; the ends have to be named
 *  for the control to mean anything, in the UI and to a screen reader (P2-10). */
const AXES: { id: 'tone' | 'verbosity' | 'formality' | 'pace'; low: string; high: string }[] = [
  { id: 'tone', low: 'Neutral', high: 'Warm' },
  { id: 'verbosity', low: 'Brief', high: 'Detailed' },
  { id: 'formality', low: 'Casual', high: 'Formal' },
  { id: 'pace', low: 'Measured', high: 'Brisk' },
];

const axisValueText = (pct: number, low: string, high: string) =>
  pct === 50 ? 'Balanced' : pct > 50 ? `${pct}% ${high}` : `${100 - pct}% ${low}`;

export function PersonalityPillar({ luciel }: { luciel: Luciel }) {
  const { updatePersonality } = useLucielMutations();
  const { draft, dirty, edit, discard, saved } = useServerDraft<PersonalityConfig>(
    luciel.personality,
  );
  const { busy, notice, run } = useActionNotice();

  const ctxLen = draft.businessContext?.length ?? 0;

  const save = () =>
    void run(async () => {
      await updatePersonality.mutateAsync(draft);
      saved();
      return 'Saved. Your Luciel sounds like this from its next reply on.';
    }, 'We could not save your personality settings. Nothing was changed — please try again.');

  return (
    <Card>
      <CardTitle>Personality</CardTitle>
      <CardDescription>
        Who your Luciel is — chosen from menus, not written as a manual.
      </CardDescription>

      <Field id="preset" label="Preset">
        {(p) => (
          <Select
            value={draft.preset}
            onChange={(e) => edit({ ...draft, preset: e.target.value as PersonalityPreset })}
            {...p}
          >
            {PRESETS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {draft.preset === 'custom' && (
        <div className="mb-vm-4 grid gap-vm-3 sm:grid-cols-2">
          {AXES.map(({ id, low, high }) => {
            const value = draft.axes?.[id] ?? 0.5;
            const pct = Math.round(value * 100);
            return (
              <div key={id}>
                <label className="mb-vm-1 block text-vm-1 font-label capitalize" htmlFor={`axis-${id}`}>
                  {id}
                </label>
                <input
                  id={`axis-${id}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={value}
                  aria-valuetext={axisValueText(pct, low, high)}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      axes: {
                        tone: 0.5,
                        verbosity: 0.5,
                        formality: 0.5,
                        pace: 0.5,
                        ...draft.axes,
                        [id]: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full"
                />
                <div className="flex justify-between text-vm-0 text-vm-text-muted">
                  <span>{low}</span>
                  <span>{axisValueText(pct, low, high)}</span>
                  <span>{high}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Field
        id="business-context"
        label="Anything specific about your business this Luciel should know?"
        hint={`${ctxLen}/280 characters — optional, tweet-sized.`}
      >
        {(p) => (
          <Textarea
            maxLength={280}
            value={draft.businessContext ?? ''}
            onChange={(e) => edit({ ...draft, businessContext: e.target.value })}
            {...p}
          />
        )}
      </Field>

      {/* AI-identity disclosure is platform-enforced (Vision §3.5, Arch §3.4.16).
          The banner states only what this surface actually offers — wording
          customization has no field here yet, so it is not promised. */}
      <Banner tone="info">
        Your Luciel always introduces itself as an AI assistant for your business, on every channel.
        That disclosure can&apos;t be turned off; the personality settings above shape how it sounds.
        Model selection is handled by the platform — there&apos;s no model to pick.
      </Banner>

      {notice && (
        <Banner className="mt-vm-3" tone={notice.tone}>
          {notice.text}
        </Banner>
      )}

      <div className="mt-vm-4 flex flex-wrap items-center gap-vm-3">
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save personality'}
        </Button>
        {dirty && (
          <>
            <Button variant="ghost" onClick={discard} disabled={busy}>
              Discard changes
            </Button>
            <span className="text-vm-0 text-vm-text-muted">
              Unsaved changes — your Luciel still sounds the way it did before.
            </span>
          </>
        )}
      </div>
    </Card>
  );
}
