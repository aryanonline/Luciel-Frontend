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

const AXES = ['tone', 'verbosity', 'formality', 'pace'] as const;

export function PersonalityPillar({ luciel }: { luciel: Luciel }) {
  const { updatePersonality } = useLucielMutations();
  const [draft, setDraft] = React.useState<PersonalityConfig>(luciel.personality);

  React.useEffect(() => setDraft(luciel.personality), [luciel.personality]);

  const ctxLen = draft.businessContext?.length ?? 0;

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
            onChange={(e) => setDraft({ ...draft, preset: e.target.value as PersonalityPreset })}
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
          {AXES.map((axis) => (
            <div key={axis}>
              <label
                className="mb-vm-1 block text-vm-1 font-label capitalize"
                htmlFor={`axis-${axis}`}
              >
                {axis}
              </label>
              <input
                id={`axis-${axis}`}
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={draft.axes?.[axis] ?? 0.5}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    axes: {
                      tone: 0.5,
                      verbosity: 0.5,
                      formality: 0.5,
                      pace: 0.5,
                      ...draft.axes,
                      [axis]: Number(e.target.value),
                    },
                  })
                }
                className="w-full"
              />
            </div>
          ))}
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
            onChange={(e) => setDraft({ ...draft, businessContext: e.target.value })}
            {...p}
          />
        )}
      </Field>

      {/* AI-identity disclosure is platform-enforced (Vision §3.5, Arch §3.4.16). */}
      <Banner tone="info">
        Your Luciel always introduces itself as an AI assistant for your business. You can word this
        in your brand voice, but it can&apos;t be turned off. Model selection is handled by the
        platform — there&apos;s no model to pick.
      </Banner>

      <div className="mt-vm-4">
        <Button
          variant="primary"
          onClick={() => updatePersonality.mutate(draft)}
          disabled={updatePersonality.isPending}
        >
          {updatePersonality.isPending ? 'Saving…' : 'Save personality'}
        </Button>
      </div>
    </Card>
  );
}
