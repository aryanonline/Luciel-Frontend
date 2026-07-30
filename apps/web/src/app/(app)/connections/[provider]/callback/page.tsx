'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardTitle, CardDescription, Banner } from '@luciel/ui';
import { LucielApiError } from '@luciel/api-client';
import { api } from '@/lib/api';
import { clearPendingConnection, recallPendingConnection } from '@/lib/oauth-connect';

/**
 * OAuth callback landing page (Arch §3.2.3/§3.8.7).
 *
 * The provider (Google, HubSpot, Salesforce, Meta, …) redirects the admin back
 * here after they click "Allow", with `code` and `state` (or `error=` on
 * denial). BOTH are forwarded to the backend: `state` is a signed, single-use,
 * 10-minute token the backend verifies, and the PKCE verifier is derived from it
 * server-side. The backend, never the browser, holds the secret.
 *
 * TWO completion routes, and which one this is was decided when the flow
 * STARTED, not here (contract §2):
 *  - `knowledge` — the knowledge-sync route, which reports a failed token
 *    exchange only in its response.
 *  - `connection` — the GENERIC route serving every other connection type. A
 *    failed exchange there is PERSISTED on the connection row, so a `conflict`
 *    is answered by re-reading the row and showing what the backend recorded
 *    rather than a guess.
 *
 * `state` is opaque to us, so the connection being completed comes from the
 * `connectionId` query param, falling back to what was stashed when the flow
 * started. A rejected `state` (expired, replayed, forged) cannot be retried —
 * the attempt is gone, and the only recovery is to start the connection again.
 */
function CallbackInner() {
  const router = useRouter();
  const params = useParams<{ provider: string }>();
  const query = useSearchParams();
  const provider = params.provider;
  const code = query.get('code');
  const pending = recallPendingConnection(provider);
  // Providers echo `state` back; the stash is only a fallback for one that does not.
  const oauthState = query.get('state') ?? pending?.state ?? null;
  const connectionId = query.get('connectionId') ?? pending?.connectionId ?? null;
  const callbackKind = pending?.callbackKind ?? 'knowledge';
  const providerError = query.get('error');

  const [status, setStatus] = React.useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = React.useState<string>('Finishing connection…');

  React.useEffect(() => {
    if (providerError) {
      setStatus('error');
      setMessage(`${provider} declined the connection (${providerError}).`);
      return;
    }
    if (!code || !oauthState || !connectionId) {
      setStatus('error');
      setMessage(
        'This connection link is missing required information. Please start the connection again.',
      );
      return;
    }
    (async () => {
      try {
        if (callbackKind === 'connection') {
          await api.connections.completeConnectionOauth(connectionId, code, oauthState);
        } else {
          await api.connections.completeOauth(connectionId, code, oauthState);
        }
        clearPendingConnection();
        setStatus('done');
        setMessage(
          callbackKind === 'connection'
            ? `${provider} connected.`
            : `${provider} connected. Your knowledge source will begin syncing.`,
        );
        setTimeout(() => router.replace('/dashboard/configure'), 1500);
      } catch (err) {
        clearPendingConnection();
        setStatus('error');
        if (err instanceof LucielApiError && err.code === 'validation_error') {
          setMessage(
            `This ${provider} sign-in has expired or was already used. Start the connection again to get a fresh one.`,
          );
          return;
        }
        // The generic route records WHY the exchange failed on the row itself.
        if (err instanceof LucielApiError && err.code === 'conflict') {
          setMessage(await recordedFailure(connectionId, provider, err.message));
          return;
        }
        setMessage(`We couldn't complete the ${provider} connection. Please start the connection again.`);
      }
    })();
  }, [provider, code, oauthState, connectionId, callbackKind, providerError, router]);

  return (
    <div style={{ maxWidth: 460, margin: '96px auto' }}>
      <Card>
        <CardTitle>
          {status === 'working' && 'Connecting…'}
          {status === 'done' && 'Connected'}
          {status === 'error' && 'Connection failed'}
        </CardTitle>
        <CardDescription>{message}</CardDescription>
        {status === 'error' && (
          <>
            <Banner tone="danger">
              The connection was not completed. Nothing was changed, and this link cannot be reused.
            </Banner>
            <Button onClick={() => router.replace('/dashboard/configure')}>
              Start the connection again
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

/** The reason the backend persisted on the row, or the response message if unreadable. */
async function recordedFailure(
  connectionId: string,
  provider: string,
  fallback: string,
): Promise<string> {
  try {
    const rows = await api.connections.list();
    const detail = rows.find((c) => c.connectionId === connectionId)?.statusDetail;
    if (detail) return `${provider} did not finish connecting: ${detail}`;
  } catch {
    /* fall through to the message the failed call already gave us */
  }
  return fallback;
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  );
}
