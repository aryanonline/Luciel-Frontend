'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardTitle, CardDescription, Banner } from '@luciel/ui';
import { LucielApiError } from '@luciel/api-client';
import { api } from '@/lib/api';

/**
 * Email-verification wall (hard gate — Arch §3.7.1a). An unverified account
 * cannot reach the dashboard. If a verification link is present in the URL
 * (?token=...), we consume it; otherwise we show the "check your email" wall
 * with a resend action. Resend is rate-limited to 3 per 15 min — exceeding it
 * shows a cooldown message, not another send (Arch §3.7.1a). Links are 24h TTL,
 * single-use; an expired/used link routes here to resend, never a dead-end.
 */
export default function VerifyPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');

  const [status, setStatus] = React.useState<'idle' | 'verifying' | 'verified' | 'error'>(
    token ? 'verifying' : 'idle',
  );
  const [cooldown, setCooldown] = React.useState<number>(0);
  const [resendMsg, setResendMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const session = await api.auth.verifyEmail({ token });
        setStatus('verified');
        // First-ever verification routes to first-run (Arch §3.7.1a).
        router.replace(session.nextRoute === 'dashboard' ? '/dashboard' : '/first-run');
      } catch {
        setStatus('error');
      }
    })();
  }, [token, router]);

  // Tick the cooldown down.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const resend = async () => {
    setResendMsg(null);
    try {
      const res = await api.auth.resendVerification();
      if (res.ok) setResendMsg('Verification email sent. Check your inbox.');
      else if (res.cooldownSecondsRemaining) setCooldown(res.cooldownSecondsRemaining);
    } catch (e) {
      if (e instanceof LucielApiError && e.code === 'rate_limited') {
        setCooldown(e.retryAfterSeconds ?? 60);
      } else {
        setResendMsg('Could not resend right now. Please try again shortly.');
      }
    }
  };

  if (status === 'verifying') {
    return (
      <Card>
        <CardTitle>Verifying your email…</CardTitle>
        <CardDescription>One moment.</CardDescription>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>{status === 'error' ? 'That link has expired' : 'Check your email'}</CardTitle>
      <CardDescription>
        {status === 'error'
          ? 'Verification links expire after 24 hours and can only be used once. Request a new one below.'
          : 'We sent you a verification link. Click it to unlock your account. You must verify your email before you can sign in.'}
      </CardDescription>
      {resendMsg && (
        <Banner tone="info" className="mt-vm-4">
          {resendMsg}
        </Banner>
      )}
      <div className="mt-vm-5">
        <Button variant="secondary" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend verification email'}
        </Button>
      </div>
      <p className="mt-vm-4 text-vm-0 text-vm-text-muted">
        Resends are limited to 3 per 15 minutes to keep inboxes safe.
      </p>
    </Card>
  );
}
