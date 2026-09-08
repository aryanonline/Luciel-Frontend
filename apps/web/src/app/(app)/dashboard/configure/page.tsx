'use client';

import Link from 'next/link';
import { Banner, Button, PageHeader } from '@luciel/ui';
import { useLuciel } from '@/lib/hooks';
import { ConsentLanding } from '@/components/config/consent-landing';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import { ToolsPillar } from '@/components/config/tools-pillar';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';
import { EscalationPillar } from '@/components/config/escalation-pillar';
import { PersonalityPillar } from '@/components/config/personality-pillar';
import { TeamAvailabilityPillar } from '@/components/config/team-availability-pillar';
import { Acknowledgements } from '@/components/config/acknowledgements';

/**
 * The five-pillar configuration screen — the single most important UX
 * (Customer Journey §4). Five dropdown-driven surfaces; there is NO sixth
 * "Connections" pillar — connecting an account is inline within its pillar
 * (Vision §3). All five stay editable at any time (Arch §3.7.1).
 */
export default function ConfigurePage() {
  return (
    <div className="space-y-vm-5">
      {/* Ahead of the configuration itself: this is where a provider's consent
          screen sends the owner back to, and they are owed that outcome even
          when the read behind it is still loading — or failed. */}
      <ConsentLanding />
      <ConfigureBody />
    </div>
  );
}

function ConfigureBody() {
  const { data: luciel, isPending, isError, refetch } = useLuciel();

  if (isPending) {
    return (
      <p className="text-vm-1 text-vm-text-muted" role="status">
        Loading your configuration…
      </p>
    );
  }
  if (isError) {
    // "You don't have a Luciel yet" is a claim we cannot make while the read failed.
    return (
      <Banner tone="danger">
        We could not load your configuration.{' '}
        <button className="underline" onClick={() => void refetch()}>
          Try again
        </button>
      </Banner>
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

  if (luciel.state === 'luciel_hard_deleted') {
    // Audit F156: a hard-deleted Luciel is not configurable — every pillar save would be
    // refused — so say so and point at the one thing that can be done.
    return (
      <Banner tone="info">
        {luciel.name} was deleted and its 30-day restore window has passed. Its configuration cannot
        be edited.{' '}
        <Link href="/first-run" className="underline">
          Create a new Luciel
        </Link>
        .
      </Banner>
    );
  }

  return (
    <>
      <PageHeader
        title={`Configure ${luciel.name}`}
        description="Five things to set, plus an optional note about your team. You can change any of them at any time — you adjust the role, you don't re-hire."
      />

      {/* When a change takes effect (Arch §3.8.7 rule E, Decision #39): additive/
          neutral edits snapshot-defer to NEW conversations; turning something off,
          revoking, or any safety change takes effect immediately. Banner pairs
          color + icon + text (AA). */}
      <Banner tone="info">
        Changes apply to new conversations. Turning something off takes effect immediately.
      </Banner>

      <ChannelsPillar luciel={luciel} />
      {/* Round 6 WP-D: every acknowledgement listed and withdrawable. */}
      <Acknowledgements luciel={luciel} />
      <ToolsPillar luciel={luciel} />
      <KnowledgePillar />
      <EscalationPillar luciel={luciel} />
      <PersonalityPillar luciel={luciel} />
      {/* Optional, and about the PEOPLE: Luciel keeps answering around the clock
          whatever is set here (round 6 WP-E). */}
      <TeamAvailabilityPillar luciel={luciel} />

      {/* Each pillar saves itself, so this link saves nothing — calling it "Save"
          promised a write that never happened (P1-1). It is navigation, and it
          says so. */}
      <div className="flex flex-wrap items-center justify-end gap-vm-3">
        <span className="text-vm-0 text-vm-text-muted">
          Each section above saves on its own — there is nothing left to save here.
        </span>
        <Button asChild variant="primary">
          <Link href="/dashboard/embed">Go to embed &amp; launch</Link>
        </Button>
      </div>
    </>
  );
}
