'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Logo } from '@luciel/ui';
import { isChunkLoadError, reloadOnce } from '@/lib/chunk-reload';

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
  const [reloading, setReloading] = useState(false);
  const chunkFailed = isChunkLoadError(error);

  useEffect(() => {
    // The live walk reports console errors as annotations; this is the only trace.
    console.error('Page error:', error);
    if (chunkFailed && reloadOnce()) setReloading(true);
  }, [error, chunkFailed]);

  return (
    <div className="flex min-h-screen flex-col bg-vm-surface text-vm-text">
      <header className="px-vm-5 py-vm-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-vm-5 pb-vm-9">
        <Card className="w-full max-w-md">
          {reloading ? (
            <div role="status">
              <h1 className="font-heading text-vm-5">Getting the latest version of this page</h1>
              <p className="mt-vm-2 text-vm-2 text-vm-text-muted">One moment.</p>
            </div>
          ) : (
            <div role="alert">
              <h1 className="font-heading text-vm-5">This page didn’t load</h1>
              <p className="mt-vm-2 text-vm-2 text-vm-text-muted">
                Something went wrong while opening this page. Nothing was lost: everything you saved
                is still there.
              </p>
              <p className="mt-vm-2 text-vm-2 text-vm-text-muted">
                Reload to try again. If it keeps happening, email us at info@vantagemind.ai.
              </p>
              <Button
                variant="primary"
                className="mt-vm-5"
                // Rendering again cannot bring back a chunk that is gone; only a page
                // load can. Any other error gets the boundary's own retry.
                onClick={chunkFailed ? () => window.location.reload() : reset}
              >
                Reload
              </Button>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
