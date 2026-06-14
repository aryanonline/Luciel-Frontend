'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Card,
  CardTitle,
  CardDescription,
  Field,
  Input,
  Banner,
  ProgressBar,
} from '@luciel/ui';
import { createLucielRequest, type CreateLucielRequest } from '@luciel/api-client';
import { useLucielMutations } from '@/lib/hooks';

/**
 * First-run (Customer Journey Phase 3): "Create my Luciel" — three fields →
 * a short progress strip while the platform sets up the Luciel and mints the
 * embed key → drop into the five-pillar config. One account, one Luciel, one
 * login is stated plainly (Arch §3.7.1).
 */
export default function FirstRunPage() {
  const router = useRouter();
  const { create } = useLucielMutations();
  const [phase, setPhase] = React.useState<'form' | 'provisioning'>('form');
  const [progress, setProgress] = React.useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateLucielRequest>({ resolver: zodResolver(createLucielRequest) });

  const onSubmit = handleSubmit(async (values) => {
    setPhase('provisioning');
    // A short progress strip (Customer Journey Phase 3: ~4s). Respects reduced
    // motion by simply filling; no essential info is conveyed by motion alone.
    const start = Date.now();
    const tick = setInterval(() => {
      const pct = Math.min(95, Math.round(((Date.now() - start) / 1500) * 100));
      setProgress(pct);
    }, 100);
    try {
      await create.mutateAsync(values);
      clearInterval(tick);
      setProgress(100);
      router.replace('/dashboard/configure');
    } catch {
      clearInterval(tick);
      setPhase('form');
    }
  });

  if (phase === 'provisioning') {
    return (
      <div className="mx-auto max-w-md py-vm-8">
        <Card>
          <CardTitle>Setting up your Luciel…</CardTitle>
          <CardDescription>
            Creating your assistant, minting its embed key, and preparing sensible defaults.
          </CardDescription>
          <div className="mt-vm-5">
            <ProgressBar value={progress} max={100} label={`Setup ${progress}%`} />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-vm-8">
      <Card>
        <CardTitle>Let&apos;s get your Luciel running</CardTitle>
        <CardDescription>It takes about 3 minutes.</CardDescription>
        <Banner tone="info" className="mt-vm-4">
          One Luciel, one account owner — the same way a sole hire reports to one person. No team
          seats; an auditor or bookkeeper is served through data export.
        </Banner>
        {create.isError && (
          <Banner tone="danger" className="mt-vm-3">
            Something went wrong creating your Luciel. Please try again.
          </Banner>
        )}
        <form onSubmit={onSubmit} className="mt-vm-5" noValidate>
          <Field
            id="name"
            label="What should we call your Luciel?"
            error={errors.name?.message}
            required
          >
            {(p) => (
              <Input placeholder="Sarah's Front-Desk Assistant" {...p} {...register('name')} />
            )}
          </Field>
          <Field
            id="websiteUrl"
            label="What is the website it will live on?"
            error={errors.websiteUrl?.message}
            required
          >
            {(p) => <Input placeholder="yourbusiness.com" {...p} {...register('websiteUrl')} />}
          </Field>
          <Field
            id="businessOneLiner"
            label="In one sentence, what is your business?"
            error={errors.businessOneLiner?.message}
            hint="Up to 280 characters."
            required
          >
            {(p) => (
              <Input
                placeholder="I'm an independent consultant serving small businesses."
                maxLength={280}
                {...p}
                {...register('businessOneLiner')}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" className="w-full">
            Create my Luciel
          </Button>
        </form>
      </Card>
    </div>
  );
}
