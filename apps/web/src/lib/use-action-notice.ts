'use client';

import * as React from 'react';

export type ActionNotice = { tone: 'info' | 'danger'; text: string };

/**
 * The pending/success/failure surface every mutation owes the admin, factored
 * out of the knowledge pillar so the other config surfaces report the same way
 * (P1-3). A save that reports nothing is indistinguishable from one that did
 * not happen.
 */
export function useActionNotice() {
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<ActionNotice | null>(null);

  /** Resolves true when the action succeeded, so callers can clear state only then. */
  const run = React.useCallback(
    async (fn: () => Promise<string>, fallbackError = 'That did not work. Please try again.') => {
      setBusy(true);
      setNotice(null);
      try {
        setNotice({ tone: 'info', text: await fn() });
        return true;
      } catch (err) {
        setNotice({
          tone: 'danger',
          text: err instanceof Error && err.message ? err.message : fallbackError,
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { busy, notice, setNotice, run };
}
