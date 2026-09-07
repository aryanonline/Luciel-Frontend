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
import type { Luciel, TeamWindow, TeamClosure, NotificationChannel } from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';
import { useServerDraft } from '@/lib/use-server-draft';
import { useActionNotice } from '@/lib/use-action-notice';

/**
 * Team availability (round 6 WP-E, audit F054) — the optional sixth card, and the
 * only one about PEOPLE rather than the Luciel. Luciel is on duty around the clock;
 * this never changes that. It tells customers when a person can follow up (so a
 * Sunday-night hand-off says "tomorrow at 9:00 am" instead of "shortly") and lets
 * an after-hours escalation reach someone else.
 */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_WINDOW = { start: '09:00', end: '17:00' };

/** A short list for environments that cannot enumerate zones (older engines). */
const FALLBACK_ZONES = [
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

function supportedZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones && zones.length > 0) return zones;
  } catch {
    // fall through to the short list
  }
  return FALLBACK_ZONES;
}

function guessZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export type TeamAvailabilityDraft = {
  enabled: boolean;
  timezone: string;
  weekly: TeamWindow[];
  closures: TeamClosure[];
  channel: '' | NotificationChannel;
  contactEmail: string;
  contactSms: string;
  ccOwnerEmail: boolean;
};

export function draftFromServer(luciel: Luciel): TeamAvailabilityDraft {
  const ta = luciel.teamAvailability;
  const esc = ta?.afterHours?.escalation;
  return {
    enabled: ta?.enabled ?? false,
    timezone: luciel.timezone ?? guessZone(),
    weekly: [...(ta?.weekly ?? [])].sort((a, b) => a.day - b.day),
    closures: [...(ta?.closures ?? [])],
    channel: esc?.channel ?? '',
    contactEmail: esc?.contactEmail ?? '',
    contactSms: esc?.contactSms ?? '',
    ccOwnerEmail: esc?.ccOwnerEmail ?? false,
  };
}

/** The wire body the server expects; an unset after-hours rule goes as absent. */
export function requestFromDraft(draft: TeamAvailabilityDraft) {
  const escalation =
    draft.channel === ''
      ? null
      : {
          channel: draft.channel,
          contactEmail: draft.channel === 'email' ? draft.contactEmail.trim() || null : null,
          contactSms: draft.channel === 'sms' ? draft.contactSms.trim() || null : null,
          ccOwnerEmail: draft.ccOwnerEmail,
        };
  return {
    timezone: draft.timezone || null,
    enabled: draft.enabled,
    weekly: draft.weekly,
    closures: draft.closures,
    afterHours: escalation ? { escalation } : null,
  };
}

export function TeamAvailabilityPillar({ luciel }: { luciel: Luciel }) {
  const { updateTeamAvailability } = useLucielMutations();
  // Memoised on the two served fields: a fresh object every render would make the
  // draft hook resync on every paint.
  const server = React.useMemo(
    () => draftFromServer(luciel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [luciel.teamAvailability, luciel.timezone],
  );
  const { draft, dirty, edit, discard, saved } = useServerDraft<TeamAvailabilityDraft>(server);
  const { busy, notice, run } = useActionNotice();
  const zones = React.useMemo(() => {
    const list = supportedZones();
    return list.includes(draft.timezone) ? list : [draft.timezone, ...list];
  }, [draft.timezone]);

  const windowFor = (day: number) => draft.weekly.find((w) => w.day === day);
  const setDay = (day: number, next: TeamWindow | null) =>
    edit({
      ...draft,
      weekly: [...draft.weekly.filter((w) => w.day !== day), ...(next ? [next] : [])].sort(
        (a, b) => a.day - b.day,
      ),
    });

  const save = () =>
    void run(async () => {
      await updateTeamAvailability.mutateAsync(requestFromDraft(draft));
      saved();
      return draft.enabled
        ? 'Saved. Luciel keeps answering around the clock; when nobody on your team is reachable, a hand-off now says when a person will follow up.'
        : 'Saved. Hand-offs use the general wording again, and escalations go to your usual contacts.';
    }, 'We could not save your team availability. Nothing was changed — please try again.');

  return (
    <Card>
      <CardTitle>Team availability (optional)</CardTitle>
      <CardDescription>
        {luciel.name} answers customers around the clock — this never changes that. It tells
        customers when a person can follow up, and lets an escalation reach someone else after
        hours.
      </CardDescription>

      <div className="mb-vm-4 flex items-center gap-vm-3">
        <Toggle
          id="team-availability-enabled"
          checked={draft.enabled}
          onChange={(next) => edit({ ...draft, enabled: next })}
          label="Tell customers when your team is reachable"
        />
        <label htmlFor="team-availability-enabled" className="text-vm-1">
          Tell customers when your team is reachable
        </label>
      </div>

      {!draft.enabled && (
        <p className="mb-vm-4 text-vm-1 text-vm-text-muted" data-testid="team-availability-off">
          Off. Hand-offs say someone will follow up shortly, and escalations go to your usual
          contacts at any hour. Your hours are remembered if you turn this on later.
        </p>
      )}

      {draft.enabled && (
        <>
          <Field
            id="team-timezone"
            label="Your timezone"
            hint="Hours below are read in this zone; the morning brief uses it too."
          >
            {(p) => (
              <Select
                value={draft.timezone}
                onChange={(e) => edit({ ...draft, timezone: e.target.value })}
                {...p}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <fieldset className="mb-vm-4">
            <legend className="mb-vm-2 text-vm-1 font-label">When a person is reachable</legend>
            <ul className="grid gap-vm-2" aria-label="Weekly hours">
              {DAYS.map((name, day) => {
                const w = windowFor(day);
                return (
                  <li key={name} className="flex flex-wrap items-center gap-vm-3">
                    <label className="flex w-36 items-center gap-vm-2 text-vm-1">
                      <input
                        type="checkbox"
                        checked={Boolean(w)}
                        onChange={(e) =>
                          setDay(day, e.target.checked ? { day, ...DEFAULT_WINDOW } : null)
                        }
                        aria-label={`${name} reachable`}
                      />
                      {name}
                    </label>
                    {w && (
                      <>
                        <label className="flex items-center gap-vm-1 text-vm-0 text-vm-text-muted">
                          from
                          <Input
                            type="time"
                            value={w.start}
                            aria-label={`${name} from`}
                            className="w-32"
                            onChange={(e) => setDay(day, { ...w, start: e.target.value })}
                          />
                        </label>
                        <label className="flex items-center gap-vm-1 text-vm-0 text-vm-text-muted">
                          to
                          <Input
                            type="time"
                            value={w.end}
                            aria-label={`${name} to`}
                            className="w-32"
                            onChange={(e) => setDay(day, { ...w, end: e.target.value })}
                          />
                        </label>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
              An end time before the start (22:00 to 06:00) runs past midnight.
            </p>
          </fieldset>

          <fieldset className="mb-vm-4">
            <legend className="mb-vm-2 text-vm-1 font-label">Closures</legend>
            {draft.closures.length === 0 ? (
              <p className="mb-vm-2 text-vm-0 text-vm-text-muted">
                No closures listed. Add holidays or days off so the follow-up promise stays honest.
              </p>
            ) : (
              <ul className="mb-vm-2 grid gap-vm-2" aria-label="Closures">
                {draft.closures.map((c, i) => (
                  <li key={`${c.date}-${i}`} className="flex flex-wrap items-center gap-vm-2">
                    <Input
                      type="date"
                      value={c.date}
                      aria-label={`Closure ${i + 1} date`}
                      className="w-44"
                      onChange={(e) =>
                        edit({
                          ...draft,
                          closures: draft.closures.map((x, j) =>
                            j === i ? { ...x, date: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      value={c.label ?? ''}
                      placeholder="Label (optional)"
                      aria-label={`Closure ${i + 1} label`}
                      className="w-48"
                      onChange={(e) =>
                        edit({
                          ...draft,
                          closures: draft.closures.map((x, j) =>
                            j === i ? { ...x, label: e.target.value || null } : x,
                          ),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      onClick={() =>
                        edit({ ...draft, closures: draft.closures.filter((_, j) => j !== i) })
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                edit({ ...draft, closures: [...draft.closures, { date: '', label: null }] })
              }
            >
              Add a closure
            </Button>
          </fieldset>

          <fieldset className="mb-vm-4">
            <legend className="mb-vm-2 text-vm-1 font-label">After hours</legend>
            <p className="mb-vm-2 text-vm-0 text-vm-text-muted">
              While nobody above is reachable, an escalation can go to a different person. Leave it
              off to keep your usual contacts at every hour.
            </p>
            <Field id="after-hours-channel" label="Reach the after-hours contact by">
              {(p) => (
                <Select
                  value={draft.channel}
                  onChange={(e) =>
                    edit({ ...draft, channel: e.target.value as TeamAvailabilityDraft['channel'] })
                  }
                  {...p}
                >
                  <option value="">Nobody different — use the usual contacts</option>
                  <option value="email">Email</option>
                  <option value="sms">Text message</option>
                </Select>
              )}
            </Field>
            {draft.channel === 'email' && (
              <Field id="after-hours-email" label="After-hours email">
                {(p) => (
                  <Input
                    type="email"
                    value={draft.contactEmail}
                    onChange={(e) => edit({ ...draft, contactEmail: e.target.value })}
                    {...p}
                  />
                )}
              </Field>
            )}
            {draft.channel === 'sms' && (
              <Field
                id="after-hours-sms"
                label="After-hours number"
                hint="International format, e.g. +16045551234"
              >
                {(p) => (
                  <Input
                    type="tel"
                    value={draft.contactSms}
                    onChange={(e) => edit({ ...draft, contactSms: e.target.value })}
                    {...p}
                  />
                )}
              </Field>
            )}
            {draft.channel !== '' && (
              <label className="flex items-center gap-vm-2 text-vm-1">
                <input
                  type="checkbox"
                  checked={draft.ccOwnerEmail}
                  onChange={(e) => edit({ ...draft, ccOwnerEmail: e.target.checked })}
                />
                Also email the account owner
              </label>
            )}
          </fieldset>
        </>
      )}

      {notice && (
        <div className="mb-vm-3">
          <Banner tone={notice.tone}>{notice.text}</Banner>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-vm-3">
        <Button variant="primary" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : 'Save team availability'}
        </Button>
        {dirty && !busy && (
          <Button variant="ghost" onClick={discard}>
            Discard changes
          </Button>
        )}
      </div>
    </Card>
  );
}
