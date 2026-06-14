'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Card, CardTitle, CardDescription, Field, Input, Banner } from '@luciel/ui';
import { api } from '@/lib/api';

/**
 * Reset password (Arch §3.7.1a): consume the single-use reset token from the
 * link and set a new password. Completing a reset revokes ALL sessions (logs
 * out every device) — a security requirement, not a convenience. After reset we
 * send the owner to log in fresh.
 */
const schema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters.'),
    confirm: z.string().min(1, 'Re-enter your password.'),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match.',
  });
type FormValues = z.infer<typeof schema>;

export default function ResetPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api.auth.resetPassword({ token, newPassword: values.password });
      setDone(true);
      setTimeout(() => router.replace('/login'), 1500);
    } catch {
      setServerError(
        'That reset link is invalid or expired. Request a new one from "Forgot password".',
      );
    }
  });

  if (!token) {
    return (
      <Card>
        <CardTitle>Reset link missing</CardTitle>
        <CardDescription>
          Open the reset link from your email, or request a new one.
        </CardDescription>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Set a new password</CardTitle>
      <CardDescription>
        Setting a new password signs you out on every device, for your security.
      </CardDescription>
      {serverError && (
        <Banner tone="danger" className="mt-vm-4">
          {serverError}
        </Banner>
      )}
      {done ? (
        <Banner tone="info" className="mt-vm-4">
          Password updated. Redirecting you to log in…
        </Banner>
      ) : (
        <form onSubmit={onSubmit} className="mt-vm-5" noValidate>
          <Field id="password" label="New password" error={errors.password?.message} required>
            {(p) => (
              <Input type="password" autoComplete="new-password" {...p} {...register('password')} />
            )}
          </Field>
          <Field id="confirm" label="Confirm password" error={errors.confirm?.message} required>
            {(p) => (
              <Input type="password" autoComplete="new-password" {...p} {...register('confirm')} />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}
    </Card>
  );
}
