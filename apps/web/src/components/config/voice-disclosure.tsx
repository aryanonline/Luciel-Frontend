'use client';

import * as React from 'react';
import { Banner, Button, Field, Textarea } from '@luciel/ui';
import { LucielApiError, VOICE_DISCLOSURE_INTRO_MAX, type Luciel } from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';
import { useActionNotice } from '@/lib/use-action-notice';

/**
 * What callers hear first (round 7, settled voice-disclosure contract). The owner may
 * add an optional opening line (`personality.voiceDisclosureIntro`, plain text, at
 * most 200 characters, empty = none); the platform ALWAYS follows it with the
 * AI-identity and recording facts, which no setting removes (§3.1.2,
 * channels/voice_adapter.py `build_disclosure`). The served read-only
 * `voiceDisclosurePreview` is shown word for word — the page never composes the
 * sentence itself.
 *
 * A server that does not serve the preview does not accept the intro either (its
 * personality PUT is strict), so the field is not offered there; the invariant copy
 * still says what every caller hears.
 */
export const VOICE_DISCLOSURE_INVARIANT =
  'Every call starts with this notice. Your opening line comes first; the AI-identity and recording notice always follows it, and you cannot remove or reword it.';

const isIntroError = (err: unknown) =>
  err instanceof LucielApiError &&
  err.code === 'validation_error' &&
  /voice_?disclosure_?intro/i.test(err.message);

export function VoiceDisclosure({ luciel }: { luciel: Luciel }) {
  const { updatePersonality } = useLucielMutations();
  const { busy, notice, run } = useActionNotice();
  const served = luciel.personality.voiceDisclosureIntro ?? '';
  const preview = luciel.personality.voiceDisclosurePreview;
  const supported = typeof preview === 'string' && preview.length > 0;
  const [intro, setIntro] = React.useState(served);
  const [fieldError, setFieldError] = React.useState<string | undefined>(undefined);

  // A save (or another tab) moved the served value: follow it.
  React.useEffect(() => {
    setIntro(served);
  }, [served]);

  const length = intro.length;
  const over = length > VOICE_DISCLOSURE_INTRO_MAX;
  const dirty = intro.trim() !== served.trim();

  const save = () => {
    if (over) {
      setFieldError(`Keep it to ${VOICE_DISCLOSURE_INTRO_MAX} characters or fewer.`);
      return;
    }
    setFieldError(undefined);
    void run(async () => {
      try {
        await updatePersonality.mutateAsync({
          ...luciel.personality,
          voiceDisclosureIntro: intro.trim(),
        });
      } catch (err) {
        // A 422 about the intro belongs on the field, in the server's words.
        if (isIntroError(err)) {
          const message = (err as Error).message.replace(
            /^[^:]*voice_?disclosure_?intro[^:]*:\s*/i,
            '',
          );
          setFieldError(message || 'That opening line was not accepted.');
          throw new Error('Your opening line was not saved — see the field above.');
        }
        throw err;
      }
      return intro.trim()
        ? 'Saved. Callers hear your opening line first, then the notice below.'
        : 'Saved. Callers hear the notice below with no opening line.';
    }, 'We could not save your opening line. What callers hear is unchanged — please try again.');
  };

  return (
    <section className="mt-vm-3 space-y-vm-2" aria-labelledby="voice-disclosure-heading">
      <h4 id="voice-disclosure-heading" className="text-vm-1 font-label">
        What callers hear first
      </h4>
      {supported ? (
        <>
          <Field
            id="voice-disclosure-intro"
            label="Your opening line (optional)"
            hint="Plain text, e.g. “Thanks for calling Sarah Chen Realty.” Leave it empty for none."
            error={fieldError}
          >
            {(p) => (
              <Textarea
                value={intro}
                onChange={(e) => {
                  setIntro(e.target.value);
                  if (fieldError) setFieldError(undefined);
                }}
                rows={2}
                {...p}
              />
            )}
          </Field>
          <p
            className={`-mt-vm-3 text-vm-0 ${over ? 'text-vm-danger' : 'text-vm-text-muted'}`}
            aria-live="polite"
            data-testid="voice-intro-count"
          >
            {length} / {VOICE_DISCLOSURE_INTRO_MAX} characters
          </p>
          <div className="flex flex-wrap items-center gap-vm-2">
            <Button variant="secondary" disabled={busy || !dirty || over} onClick={save}>
              {busy ? 'Saving…' : 'Save opening line'}
            </Button>
            {dirty && !busy && (
              <Button
                variant="ghost"
                onClick={() => {
                  setIntro(served);
                  setFieldError(undefined);
                }}
              >
                Discard
              </Button>
            )}
          </div>
          {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
          <div>
            <p className="text-vm-0 text-vm-text-muted">Callers hear, word for word:</p>
            <blockquote
              className="mt-vm-1 rounded-vm-control border border-vm-border bg-vm-surface p-vm-3 text-vm-1"
              data-testid="voice-disclosure-preview"
            >
              {preview}
            </blockquote>
            {dirty && (
              <p className="mt-vm-1 text-vm-0 text-vm-text-muted">
                This is what callers hear now; it changes once you save.
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="text-vm-0 text-vm-text-muted" data-testid="voice-disclosure-unsupported">
          Callers always hear that they are speaking with an AI assistant and that the call may be
          recorded and transcribed. A custom opening line is not available on this server yet.
        </p>
      )}
      <p className="text-vm-0 text-vm-text-muted">{VOICE_DISCLOSURE_INVARIANT}</p>
    </section>
  );
}
