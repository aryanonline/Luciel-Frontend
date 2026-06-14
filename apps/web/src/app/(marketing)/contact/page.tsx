'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Container,
  Section,
  Eyebrow,
  Card,
  CardTitle,
  CardDescription,
  Field,
  Input,
  Textarea,
  Button,
  Banner,
} from '@luciel/ui';
import { HCaptcha } from '@/components/marketing/hcaptcha';

/**
 * Contact page (user request #6). Anti-spam is layered:
 *  1. hCaptcha (the stack already uses it) — token verified SERVER-SIDE before
 *     any message is accepted or relayed.
 *  2. A hidden honeypot field — bots fill it, humans never see it; a filled
 *     honeypot is silently dropped.
 *  3. Server-side rate limiting (backend) once wired.
 *
 * EMAIL PRIVACY: the destination inbox (info@vantagemind.ai) is intentionally
 * NOT present anywhere in this client bundle — no mailto:, no rendered address.
 * The form POSTs to a backend endpoint that holds the destination address and
 * relays the message, so the inbox is never harvestable from the page source.
 * For this mock build, submission is simulated; the real POST wires in with the
 * backend (see the TODO in onSubmit).
 */
const schema = z.object({
  name: z.string().min(1, 'Please tell us your name.'),
  email: z.string().email('Enter a valid email so we can reply.'),
  message: z.string().min(10, 'A little more detail helps us help you.'),
  // Honeypot — must stay empty. Not shown to humans.
  company: z.string().max(0).optional(),
});
type FormValues = z.infer<typeof schema>;

export default function ContactPage() {
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    // Honeypot tripped → silently succeed without sending (don't tip off bots).
    if (values.company) {
      setSent(true);
      return;
    }
    if (!captchaToken) {
      setError('Please complete the spam-protection challenge.');
      return;
    }
    try {
      // TODO(backend): POST { name, email, message, captchaToken } to
      // /api/v1/contact, which verifies the hCaptcha token server-side and
      // relays to the internal inbox. The inbox address lives only on the
      // server — never in this bundle. For the mock, simulate success:
      await new Promise((r) => setTimeout(r, 500));
      setSent(true);
    } catch {
      setError('Something went wrong sending your message. Please try again.');
    }
  });

  return (
    <Section className="pt-vm-8">
      <Container size="sm">
        <Eyebrow>Contact us</Eyebrow>
        <h1 className="font-heading text-vm-6 tracking-tight">We’d love to hear from you</h1>
        <p className="mt-vm-2 text-vm-2 text-vm-text-muted">
          Questions about VantageMind, your account, or a partnership — send a note and a real
          person will reply.
        </p>

        <Card className="mt-vm-6">
          {sent ? (
            <Banner tone="info">
              Thanks — your message is on its way. We’ll get back to you by email shortly.
            </Banner>
          ) : (
            <>
              <CardTitle>Send us a message</CardTitle>
              <CardDescription>We typically reply within one business day.</CardDescription>
              {error && (
                <Banner tone="danger" className="mt-vm-4">
                  {error}
                </Banner>
              )}
              <form onSubmit={onSubmit} className="mt-vm-5" noValidate>
                <Field id="name" label="Your name" error={errors.name?.message} required>
                  {(p) => <Input autoComplete="name" {...p} {...register('name')} />}
                </Field>
                <Field id="email" label="Your email" error={errors.email?.message} required>
                  {(p) => <Input type="email" autoComplete="email" {...p} {...register('email')} />}
                </Field>
                <Field id="message" label="Message" error={errors.message?.message} required>
                  {(p) => <Textarea rows={5} {...p} {...register('message')} />}
                </Field>

                {/* Honeypot: visually hidden + off-screen, aria-hidden, no tab stop. */}
                <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label htmlFor="company">Company (leave blank)</label>
                  <input id="company" tabIndex={-1} autoComplete="off" {...register('company')} />
                </div>

                <div className="mb-vm-4">
                  <HCaptcha onVerify={setCaptchaToken} />
                </div>

                <Button type="submit" variant="primary" disabled={isSubmitting} className="w-full">
                  {isSubmitting ? 'Sending…' : 'Send message'}
                </Button>
              </form>
            </>
          )}
        </Card>
      </Container>
    </Section>
  );
}
