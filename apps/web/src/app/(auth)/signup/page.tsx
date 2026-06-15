'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Card, CardTitle, CardDescription, Field, Input, Banner } from '@luciel/ui';
import { api } from '@/lib/api';

/**
 * Signup (Customer Journey Phase 2): email + password + invisible captcha.
 * Client-side validation is UX only (§3.1) — the server re-validates. On
 * success the account is created `unverified`; the next step is the verify wall
 * (hard gate, Arch §3.7.1a). No payment requested (Customer Journey Phase 2).
 *
 * The captcha is an invisible-recaptcha placeholder; the real provider is wired
 * when the backend lands. We do NOT imply a working captcha that isn't there.
 */
const schema = z.object({
  email: z.string().email('Enter a valid email.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
});
type FormValues = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      // Invisible-captcha token placeholder (real provider wired with backend).
      await api.auth.signup({ ...values, captchaToken: 'mock-invisible-captcha' });
      router.push('/verify');
    } catch {
      setServerError('Something went wrong creating your account. Please try again.');
    }
  });

  return (
    <Card>
      <CardTitle>Create your account</CardTitle>
      <CardDescription>
        Start free with 50 conversations a month. No credit card required.
      </CardDescription>
      {serverError && (
        <Banner tone="danger" className="mt-vm-4">
          {serverError}
        </Banner>
      )}
      <form onSubmit={onSubmit} className="mt-vm-5" noValidate>
        <Field id="email" label="Email" error={errors.email?.message} required>
          {(p) => <Input type="email" autoComplete="email" {...p} {...register('email')} />}
        </Field>
        <Field
          id="password"
          label="Password"
          error={errors.password?.message}
          hint="At least 8 characters. Use something strong and unique."
          required
        >
          {(p) => (
            <Input type="password" autoComplete="new-password" {...p} {...register('password')} />
          )}
        </Field>
        {/* An invisible captcha runs silently on submit (Customer Journey Phase 2) —
            no visible challenge and intentionally NOT narrated to the user. The
            MFA-availability disclosure lives in the Terms, not on this form. */}
        <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-vm-4 text-vm-0 text-vm-text-muted">
        By creating an account you agree to our{' '}
        <Link href="/legal/terms" className="text-vm-accent underline">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/legal/privacy" className="text-vm-accent underline">
          Privacy Policy
        </Link>
        .
      </p>
      <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-vm-accent underline">
          Log in
        </Link>
      </p>
    </Card>
  );
}
