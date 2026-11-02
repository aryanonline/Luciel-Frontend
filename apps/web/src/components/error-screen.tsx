'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Card, Logo } from '@luciel/ui';
import { CRASH_COPY, CRASH_SCREEN_EVENT, isChunkLoadError, reloadOnce } from '@/lib/chunk-reload';

/**
 * When Reload was last used on a boundary, keyed by that boundary's reset (it survives
 * the remount a repeat failure causes; this component's own state does not). Held in
 * memory, so a page load forgets it and a repeat can only follow another click.
 */
const resetTriedAt = new WeakMap<() => void, number>();

/** A failure this soon after Reload means rendering again did not help. */
const RESET_REPEAT_MS = 10_000;

export interface ErrorScreenProps {
  error: Error & { digest?: string };
  /** Next's boundary reset: renders the failed segment again. */
  reset: () => void;
}

/**
 * What a person sees when a page throws, instead of Next's bare "Application error"
 * (app/error.tsx and app/global-error.tsx). It replaces everything under the root
 * layout, the dashboard's header included, so it carries its own logo and landmark.
 * It never touches the session: the httpOnly cookie is still there on the next load.
 *
 * Plain page markup only, no inline script, so it renders under the strict nonce CSP.
 */
export function ErrorScreen({ error, reset }: ErrorScreenProps) {
  const chunkFailed = isChunkLoadError(error);
  // A chunk failure starts on the status line, so a recovery the owner never has to
  // act on does not first announce a failure. The copy appears only once no reload
  // can be started.
  const [noReload, setNoReload] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const reloadStarted = useRef(false);
  const loadingPage = (chunkFailed && !noReload) || resetFailed;

  useEffect(() => {
    // The live walk reports console errors as annotations; this is the only trace.
    console.error('Page error:', error);
    // This screen has the page now; the pre-hydration fallback must not cover it.
    window.dispatchEvent(new Event(CRASH_SCREEN_EVENT));

    if (chunkFailed) {
      // The ref outlives React's development double run of this effect, whose second
      // pass would otherwise read the guard the first one just set.
      if (reloadStarted.current) return;
      if (reloadOnce()) reloadStarted.current = true;
      else setNoReload(true);
      return;
    }

    // Reload was just used and the page threw again, so rendering again did not help.
    // Reload has to mean a page load: it clears what a render cannot, like a bad answer
    // held in the query cache above this boundary.
    const triedAt = resetTriedAt.get(reset);
    if (triedAt !== undefined && Date.now() - triedAt < RESET_REPEAT_MS) {
      resetTriedAt.delete(reset);
      setResetFailed(true);
      window.location.reload();
    }
  }, [error, chunkFailed, reset]);

  const onReload = () => {
    // Rendering again cannot bring back a chunk that is gone; only a page load can.
    if (chunkFailed) {
      window.location.reload();
      return;
    }
    // Any other error gets the boundary's own retry first, which keeps what is on the
    // page when the cause has gone away. The effect above takes over if it has not.
    resetTriedAt.set(reset, Date.now());
    reset();
  };

  return (
    <div className="flex min-h-screen flex-col bg-vm-surface text-vm-text">
      <header className="px-vm-5 py-vm-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-vm-5 pb-vm-9">
        <Card className="w-full max-w-md">
          {loadingPage ? (
            <div role="status">
              <h1 className="font-heading text-vm-5">Getting the latest version of this page</h1>
              <p className="mt-vm-2 text-vm-2 text-vm-text-muted">One moment.</p>
            </div>
          ) : (
            <div role="alert">
              <h1 className="font-heading text-vm-5">{CRASH_COPY.heading}</h1>
              <p className="mt-vm-2 text-vm-2 text-vm-text-muted">{CRASH_COPY.happened}</p>
              <p className="mt-vm-2 text-vm-2 text-vm-text-muted">{CRASH_COPY.next}</p>
              <Button variant="primary" className="mt-vm-5" onClick={onReload}>
                {CRASH_COPY.button}
              </Button>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
