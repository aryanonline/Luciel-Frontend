'use client';

import Link from 'next/link';
import { Banner, Button, PageHeader } from '@luciel/ui';
import { useLuciel } from '@/lib/hooks';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import { ToolsPillar } from '@/components/config/tools-pillar';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';
import { EscalationPillar } from '@/components/config/escalation-pillar';
import { PersonalityPillar } from '@/components/config/personality-pillar';

/**
 * The five-pillar configuration screen — the single most important UX
 * (Customer Journey §4). Five dropdown-driven surfaces; there is NO sixth
 * "Connections" pillar — connecting an account is inline within its pillar
 * (Vision §3). All five stay editable at any time (Arch §3.7.1).
 */
export default function ConfigurePage() {
  const { data: luciel, isLoading } = useLuciel();

  if (isLoading) {
    return (
      <p className="text-vm-1 text-vm-text-muted" role="status">
        Loading your configuration…
      </p>
    );
  }
  if (!luciel) {
    return (
      <Banner tone="info">
        You don&apos;t have a Luciel yet.{' '}
        <Link href="/first-run" className="underline">
          Create one
        </Link>
        .
      </Banner>
    );
  }

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title={`Configure ${luciel.name}`}
        description="Five things to set. You can change any of them at any time — you adjust the role, you don't re-hire."
      />

      <ChannelsPillar luciel={luciel} />
      <ToolsPillar luciel={luciel} />
      <KnowledgePillar />
      <EscalationPillar luciel={luciel} />
      <PersonalityPillar luciel={luciel} />

      <div className="flex justify-end">
        <Button asChild variant="primary">
          <Link href="/dashboard/embed">Save and go to embed</Link>
        </Button>
      </div>
    </div>
  );
}
