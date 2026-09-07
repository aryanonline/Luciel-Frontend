'use client';

import * as React from 'react';

/**
 * A form draft seeded from the server that survives background refetches.
 *
 * A plain `useEffect(() => setDraft(server), [server])` throws away whatever the
 * admin had typed the instant a refetch lands — on window focus, after any
 * unrelated invalidation (P1-2). Unsaved edits win until they are saved or
 * explicitly discarded; an untouched draft still tracks the server.
 */
export function useServerDraft<T>(server: T) {
  const [draft, setDraft] = React.useState<T>(server);
  const [dirty, setDirty] = React.useState(false);
  // Read through a ref so the resync effect depends only on the server value.
  const dirtyRef = React.useRef(false);
  dirtyRef.current = dirty;

  React.useEffect(() => {
    if (dirtyRef.current) return;
    setDraft(server);
  }, [server]);

  const edit = React.useCallback((next: T) => {
    setDirty(true);
    setDraft(next);
  }, []);

  const discard = React.useCallback(() => {
    setDirty(false);
    setDraft(server);
  }, [server]);

  /** Call once a save is confirmed: the draft is now the server's own value. */
  const saved = React.useCallback(() => setDirty(false), []);

  return { draft, dirty, edit, discard, saved };
}
