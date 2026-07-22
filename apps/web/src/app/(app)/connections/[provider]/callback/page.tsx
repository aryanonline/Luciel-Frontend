'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardTitle, CardDescription, Banner } from '@luciel/ui';
import { api } from '@/lib/api';

/**
 * OAuth callback landing page (Arch §3.2.3/§3.8.7).
 *
 * A knowledge-source / channel OAuth provider (Google Drive, HubSpot, Salesforce)
 * redirects the admin back here after they click "Allow". The provider appends
 * `?code=<authorization_code>&state=<connectionId>` (and `?error=` on denial). We
 * exchange the code via the backend, which stores the token as a tenant-scoped
 * secret_ref — the code is single-use and never persisted client-side.
 *
 * `state` carries the connectionId we set when starting the flow (CSRF + correlation).
 */
function CallbackInner() {
  const router = useRouter();
  const params = useParams<{ provider: string }>();
  const query = useSearchParams();
  const provider = params.provider;
  const code = query.get('code');
  const connectionId = query.get('state');
  const providerError = query.get('error');

  const [status, setStatus] = React.useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = React.useState<string>('Finishing connection…');

  React.useEffect(() => {
    if (providerError) {
      setStatus('error');
      setMessage(`${provider} declined the connection (${providerError}).`);
      return;
    }
    if (!code || !connectionId) {
      setStatus('error');
      setMessage('This connection link is missing required information. Please start the connection again.');
      return;
    }
    (async () => {
      try {
        await api.connections.completeOauth(connectionId, code);
        setStatus('done');
        setMessage(`${provider} connected. Your knowledge source will begin syncing.`);
        setTimeout(() => router.replace('/dashboard/configure'), 1500);
      } catch {
        setStatus('error');
        setMessage(`We couldn't complete the ${provider} connection. Please try connecting again.`);
      }
    })();
  }, [provider, code, connectionId, providerError, router]);

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
            <Banner tone="danger">The connection was not completed.</Banner>
            <Button onClick={() => router.replace('/dashboard/configure')}>
              Back to configuration
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  );
}
