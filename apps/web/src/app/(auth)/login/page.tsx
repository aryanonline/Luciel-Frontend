'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardTitle, CardDescription, Field, Input, Banner } from '@luciel/ui';
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
      const dest =
        session.nextRoute === 'verify_wall'
          ? '/verify'
          : session.nextRoute === 'first_run'
            ? '/first-run'
            : '/dashboard';
      router.replace(dest);
    } catch {
      // Non-enumerating message (don't reveal whether the email exists).
      setServerError('Email or password is incorrect.');
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
