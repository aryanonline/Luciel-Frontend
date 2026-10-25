'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardTitle, CardDescription, Field, Input, Banner } from '@luciel/ui';
import { LucielApiError } from '@luciel/api-client';
import { api } from '@/lib/api';
import { qk } from '@/lib/hooks';
import {
  ACCOUNT_CLOSED_PATH,
  ACCOUNT_CLOSED_REASON,
  clearSignedOutByClosure,
  sessionIsClosed,
} from '@/lib/account-closed';

/**
 * Login (Arch §3.7.1a): email + password. Login never involves a magic link —
 * the link is verification/reset only. On success we route by the server's
 * nextRoute: first-ever login → first-run; otherwise → dashboard; an unverified
 * account → the verify wall.
 */
const schema = z.object({
  email: z.string().email('Enter a valid email.'),
  password: z.string().min(1, 'Enter your password.'),
});
type FormValues = z.infer<typeof schema>;

/**
 * The middleware sends a gated visitor here with `?next=<the page they wanted>`
 * so login can put them back where they were going (P2-11). Only a same-origin
 * absolute path is honoured — a protocol-relative `//evil.example` or a full URL
 * would turn this into an open redirect.
 */
const safeNext = (raw: string | null): string | null =>
  raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;

/**
 * A failed login is not proof of a wrong password. Only a credential rejection
 * gets the deliberately non-enumerating message; a network drop or a 500 says
 * what it is, so the admin retries instead of doubting a password that works
 * (P1-18).
 */
const loginErrorMessage = (err: unknown): string => {
  if (err instanceof LucielApiError) {
    if (err.code === 'network_error')
      return "We couldn't reach us to sign you in. Check your connection and try again.";
    if (err.code === 'server_error')
      return 'Something went wrong on our side while signing you in. Please try again.';
    if (err.code === 'rate_limited')
      return 'Too many attempts. Please wait a moment and try again.';
  }
  // Non-enumerating message (don't reveal whether the email exists).
  return 'Email or password is incorrect.';
};

/**
 * Why the owner is here, when a guard sent them (round 7 WP-12): the dashboard
 * guard adds `reason=session_expired` when the API refused a session the browser
 * still held, and closing the account (which signs the owner out) arrives with
 * `reason=account_closed`. Read after mount (no Suspense boundary needed for a
 * static page).
 */
const REASON_COPY: Record<string, string> = {
  session_expired:
    'Your session has ended — it expired or was signed out elsewhere. Log in again to pick up where you left off.',
  [ACCOUNT_CLOSED_REASON]:
    'Your account is closed, and closing it signed you out. For 30 days you can still log in here to download your data again or reopen the account; after that, everything is permanently deleted.',
};

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  React.useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('reason');
    // Own keys only: `?reason=__proto__` would otherwise hand React Object.prototype
    // as a child (the page crashed) and `?reason=constructor` an empty banner.
    setReason(value && Object.hasOwn(REASON_COPY, value) ? (REASON_COPY[value] ?? null) : null);
  }, []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const session = await api.auth.login(values);
      // A new session: a later 401 is no longer the closure's sign-out.
      clearSignedOutByClosure();
      qc.setQueryData(qk.session, session);
      // The wall and first-run outrank `next`: both are states the admin has to
      // clear before any dashboard page would work for them anyway. A CLOSED account
      // outranks everything (round 7 WP-5 / D5): login succeeds, and the reduced
      // page is the only surface it may use.
      const dest = sessionIsClosed(session)
        ? ACCOUNT_CLOSED_PATH
        : session.nextRoute === 'verify_wall'
          ? '/verify'
          : session.nextRoute === 'first_run'
            ? '/first-run'
            : (safeNext(new URLSearchParams(window.location.search).get('next')) ?? '/dashboard');
      router.replace(dest);
    } catch (err) {
      setServerError(loginErrorMessage(err));
    }
  });

  return (
    <Card>
      <CardTitle>Log in</CardTitle>
      <CardDescription>Welcome back.</CardDescription>
      {reason && !serverError && (
        <Banner tone="info" className="mt-vm-4">
          <span data-testid="login-reason">{reason}</span>
        </Banner>
      )}
      {serverError && (
        <Banner tone="danger" className="mt-vm-4">
          {serverError}
        </Banner>
      )}
      <form onSubmit={onSubmit} className="mt-vm-5" noValidate>
        <Field id="email" label="Email" error={errors.email?.message} required>
          {(p) => <Input type="email" autoComplete="email" {...p} {...register('email')} />}
        </Field>
        <Field id="password" label="Password" error={errors.password?.message} required>
          {(p) => (
            <Input
              type="password"
              autoComplete="current-password"
              {...p}
              {...register('password')}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Signing in…' : 'Log in'}
        </Button>
      </form>
      <div className="mt-vm-4 flex justify-between text-vm-1">
        <Link href="/forgot" className="text-vm-accent underline">
          Forgot password?
        </Link>
        <Link href="/signup" className="text-vm-accent underline">
          Create account
        </Link>
      </div>
    </Card>
  );
}
