'use client';

import * as React from 'react';
import { Banner, Button } from '@luciel/ui';
import type { Connection } from '@luciel/api-client';
import { useCalendlyEventTypes, useUpdateConnectionSettings } from '@/lib/hooks';
import { useActionNotice } from '@/lib/use-action-notice';

/**
 * Which Calendly event type customers book (round 6 WP-H, F055).
 *
 * Calendly has no free-form "book at 3 pm" call: a booking is an invitee completing
 * ONE event type's scheduling link. The OAuth verifier stores the account's first
 * active event type so scheduling works from the first minute; this control lets the
 * owner change it, and says plainly when the account could not be read (a stale
 * token) or has no event type yet — never an empty picker that looks like "none".
 */
export function CalendlyEventTypePicker({ connection }: { connection: Connection }) {
  const types = useCalendlyEventTypes(connection.connectionId);
  const update = useUpdateConnectionSettings();
  const action = useActionNotice();
  const [open, setOpen] = React.useState(false);

  const configUri = connection.nonSecretConfig?.eventTypeUri;
  const configName = connection.nonSecretConfig?.eventTypeName;
  const chosenUri = types.data?.chosenUri ?? (typeof configUri === 'string' ? configUri : null);
  const list = types.data?.eventTypes ?? null;
  const chosen = list?.find((t) => t.uri === chosenUri);
  const chosenName = chosen?.name ?? (typeof configName === 'string' ? configName : null);

  const pick = (uri: string, name: string) => {
    void action.run(async () => {
      await update.mutateAsync({
        connectionId: connection.connectionId,
        req: { eventTypeUri: uri, eventTypeName: name },
      });
      setOpen(false);
      return `Customers now book "${name}".`;
    }, 'We could not change the event type. Nothing was changed — please try again.');
  };

  return (
    <div className="mt-vm-3" data-testid="calendly-event-type">
      <p className="text-vm-0 text-vm-text-muted" role="note">
        {chosenName ? (
          <>
            Customers book <strong className="text-vm-text">{chosenName}</strong>
            {chosen ? ` (${chosen.durationMinutes} min)` : ''}.
          </>
        ) : (
          'No event type is chosen yet, so Luciel cannot book on Calendly until you pick one.'
        )}{' '}
        {list && list.length > 0 && !open && (
          <button
            type="button"
            className="underline"
            onClick={() => setOpen(true)}
            aria-expanded={open}
          >
            {chosenName ? 'Change event type' : 'Choose event type'}
          </button>
        )}
      </p>

      {types.isPending && (
        <p className="mt-vm-1 text-vm-0 text-vm-text-muted" role="status">
          Reading your Calendly event types…
        </p>
      )}
      {types.isError && (
        <p className="mt-vm-1 text-vm-0 text-vm-text-muted" role="note">
          We could not read your Calendly event types just now.{' '}
          <button type="button" className="underline" onClick={() => void types.refetch()}>
            Try again
          </button>
        </p>
      )}
      {types.data && list === null && (
        <p className="mt-vm-1 text-vm-0 text-vm-text-muted" role="note">
          Calendly would not let us read your event types — the sign-in may have expired. Reconnect
          Calendly above and this list comes back.
        </p>
      )}
      {list && list.length === 0 && (
        <p className="mt-vm-1 text-vm-0 text-vm-text-muted" role="note">
          Your Calendly account has no active event type yet. Create one in Calendly, then come back
          here to pick it.
        </p>
      )}

      {open && list && list.length > 0 && (
        <ul className="mt-vm-2 grid gap-vm-2" aria-label="Calendly event types">
          {list.map((t) => (
            <li
              key={t.uri}
              className="flex items-center justify-between gap-vm-3 rounded-vm-card border border-vm-border p-vm-3"
            >
              <div>
                <div className="text-vm-1">{t.name}</div>
                <div className="text-vm-0 text-vm-text-muted">{t.durationMinutes} minutes</div>
              </div>
              {t.uri === chosenUri ? (
                <span className="text-vm-0 text-vm-text-muted">Customers book this</span>
              ) : (
                <Button
                  onClick={() => pick(t.uri, t.name)}
                  disabled={action.busy}
                  aria-label={`Use ${t.name}`}
                >
                  Use this
                </Button>
              )}
            </li>
          ))}
          <li>
            <button type="button" className="text-vm-0 underline" onClick={() => setOpen(false)}>
              Keep it as it is
            </button>
          </li>
        </ul>
      )}

      {action.busy && (
        <p className="mt-vm-2 text-vm-0 text-vm-text-muted" role="status">
          Saving…
        </p>
      )}
      {action.notice && !action.busy && (
        <Banner className="mt-vm-2" tone={action.notice.tone}>
          {action.notice.text}
        </Banner>
      )}
    </div>
  );
}
