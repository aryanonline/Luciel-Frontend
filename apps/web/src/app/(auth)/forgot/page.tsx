'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Card, CardTitle, CardDescription, Field, Input, Banner } from '@luciel/ui';
import { api } from '@/lib/api';

/**
 * Forgot password (Arch §3.7.1a): request a single-use, 1h-TTL reset link by
 * email. The response is intentionally non-enumerating — we always say "if an
 * account exists, we've sent a link," never revealing whether the email is
 * registered.
 */
const schema = z.object({ email: z.string().email('Enter a valid email.') });
type FormValues = z.infer<typeof schema>;

export default function ForgotPage() {
  const [sent, setSent] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    await api.auth.forgotPassword(values);
    setSent(true);
  });

  return (
    <Card>
      <CardTitle>Reset your password</CardTitle>
      <CardDescription>
        We&apos;ll email you a link to set a new password. The link works once and expires after an
        hour.
      </CardDescription>
      {sent ? (
        <Banner tone="info" className="mt-vm-4">
          If an account exists for that email, we&apos;ve sent a reset link. Check your inbox.
        </Banner>
      ) : (
        <form onSubmit={onSubmit} className="mt-vm-5" noValidate>
          <Field id="email" label="Email" error={errors.email?.message} required>
            {(p) => <Input type="email" autoComplete="email" {...p} {...register('email')} />}
          </Field>
          <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <p className="mt-vm-4 text-vm-1">
        <Link href="/login" className="text-vm-accent underline">
          Back to log in
        </Link>
      </p>
    </Card>
  );
}
