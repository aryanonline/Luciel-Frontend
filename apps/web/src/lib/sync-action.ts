import { isSyncStillRunning } from '@luciel/api-client';

/** Said by surfaces that do not sit on the source's row, while its sync runs on. */
export const SYNC_STARTED_NOTICE =
  'Syncing — this can take a few minutes. Connected sources shows when it finishes.';

export interface SyncOutcome {
  tone: 'info' | 'danger';
  text: string;
  /** What a failure threw (absent on a success or on the poll's give-up). */
  error?: unknown;
}

export interface SyncUntilAnswered<R> {
  /** Starts the sync, handing the adapter its 202 callback. Settles with the final outcome. */
  start: (onStarted: () => void) => Promise<R>;
  /** The POST answered 202. The caller's pending state ends here. */
  onStarted?: () => void;
  /** The success copy, whenever the sync finishes. */
  success: (result: R) => string;
  /** Re-reads what the sync changed. It runs on every outcome, fast or not. */
  refresh: () => unknown;
  /** How a sync that already answered 202 reports how it ended. */
  report: (outcome: SyncOutcome) => void;
  /** The text of a failure (default: the error's own message, else `fallbackError`). */
  describe?: (err: unknown) => string;
  fallbackError?: string;
}

/**
 * Nobody is held behind a 202 (round 7 — the asynchronous crawl): the returned promise
 * answers as soon as the POST does.
 *
 *  - It finished inside the server's wait: resolves with the success copy, or rejects
 *    with the failure, exactly as a synchronous call would.
 *  - It answered 202: `onStarted` runs and it resolves with '' (nothing to say yet). The
 *    served `syncJob` carries the pending state, and `report` gets the outcome later.
 *
 * Only the poll's own give-up counts as "still running". A real 503 is a failure.
 */
export function syncUntilAnswered<R>(flow: SyncUntilAnswered<R>): Promise<string> {
  const describe =
    flow.describe ??
    ((err: unknown) =>
      err instanceof Error && err.message
        ? err.message
        : (flow.fallbackError ?? 'That did not work. Please try again.'));
  return new Promise<string>((resolve, reject) => {
    let started = false;
    const outcome = flow
      .start(() => {
        if (started) return;
        started = true;
        flow.onStarted?.();
        resolve('');
      })
      .then(
        (result): SyncOutcome => ({ tone: 'info', text: flow.success(result) }),
        (err: unknown): SyncOutcome =>
          isSyncStillRunning(err)
            ? { tone: 'info', text: err.message }
            : { tone: 'danger', text: describe(err), error: err },
      );
    void outcome.then(async (settled) => {
      try {
        await flow.refresh();
      } catch {
        /* a failed re-read is not the sync's outcome */
      }
      if (started) flow.report(settled);
      else if (settled.tone === 'danger') reject(settled.error);
      else resolve(settled.text);
    });
  });
}
