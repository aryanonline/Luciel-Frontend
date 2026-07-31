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

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const session = await api.auth.login(values);
      qc.setQueryData(qk.session, session);
      // The wall and first-run outrank `next`: both are states the admin has to
      // clear before any dashboard page would work for them anyway.
      const dest =
        session.nextRoute === 'verify_wall'
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
