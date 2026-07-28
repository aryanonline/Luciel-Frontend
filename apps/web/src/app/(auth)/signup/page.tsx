'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Card, CardTitle, CardDescription, Field, Input, Banner } from '@luciel/ui';
import { api } from '@/lib/api';
import { HCaptcha } from '@/components/marketing/hcaptcha';

/**
 * Signup (Customer Journey Phase 2): email + password + hCaptcha.
 * Client-side validation is UX only (§3.1) — the server re-validates. On
 * success the account is created `unverified`; the next step is the verify wall
 * (hard gate, Arch §3.7.1a). No payment requested (Customer Journey Phase 2).
 *
 * The captcha is a real hCaptcha challenge (§3.7.1a bot-protection): the widget
 * returns a token the BACKEND verifies server-side before creating the account.
 * Submit is blocked until a token is present.
 */
const schema = z.object({
  email: z.string().email('Enter a valid email.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
});
type FormValues = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    if (!captchaToken) {
      setServerError('Please complete the captcha to continue.');
      return;
    }
    try {
      // Real hCaptcha token; the backend verifies it server-side (§3.7.1a).
      const result = await api.auth.signup({ ...values, captchaToken });
      // The verification mail did not make it onto the wire — the verify wall
      // must offer a resend and a support path, not "check your inbox" (§1).
      router.push(result.emailDeliveryDegraded ? '/verify?delivery=degraded' : '/verify');
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
        {/* hCaptcha bot-protection (§3.7.1a). The token is verified server-side
            before the account is created. */}
        <div className="mt-vm-4">
          <HCaptcha onVerify={setCaptchaToken} />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={isSubmitting || !captchaToken}
          className="w-full mt-vm-4"
        >
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
