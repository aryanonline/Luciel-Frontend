'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardTitle, Banner, Button, Input, Toggle } from '@luciel/ui';
import type { EmployeeCapability, EmployeeNeed, EmployeeStatus } from '@luciel/api-client';
import { useEmployeeStatus, useLucielMutations } from '@/lib/hooks';
import { useActionNotice } from '@/lib/use-action-notice';

/**
 * The Today card (round 6 WP-F) — the employee, in one place: who it is and that it
 * is on duty around the clock; what it can do right now; what it needs from the
 * owner; and what it did yesterday and so far today. Every figure is served,
 * derived from rows that already exist; nothing here is narrated.
 */

const STATE_COPY: Record<EmployeeCapability['state'], { label: string; cls: string }> = {
  ready: { label: 'Ready', cls: 'bg-vm-success/10 text-vm-success' },
  attention: { label: 'Needs you', cls: 'bg-vm-warning/10 text-vm-warning' },
  off: { label: 'Off', cls: 'bg-vm-border text-vm-text-muted' },
  unavailable: { label: 'Not available yet', cls: 'bg-vm-border text-vm-text-muted' },
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function identityLine(status: EmployeeStatus): string {
  const business = status.businessShortName ? ` for ${status.businessShortName}` : '';
  const usage =
    status.billedBlocks > 0
      ? `${status.conversationsUsed} conversations this period (${status.freeAllowance} free + ${plural(status.billedBlocks, 'paid block')})`
      : `${status.conversationsUsed} of ${status.freeAllowance} free conversations used this period`;
  return `${status.assistantName} is on duty ${status.onDuty}${business} — ${usage}.`;
}

export function teamLine(status: EmployeeStatus): string | null {
  if (status.teamReachableNow === true) return 'Someone on your team is reachable right now.';
  if (status.teamReachableNow === false) {
    return `Nobody on your team is reachable right now${status.nextReachable ? ` — next ${status.nextReachable}` : ''}. ${status.assistantName} keeps answering.`;
  }
  return null;
}

function CapabilityStrip({ items }: { items: EmployeeCapability[] }) {
  const shown = items.filter((c) => c.state !== 'off');
  if (shown.length === 0) return null;
  return (
    <ul className="mt-vm-3 flex flex-wrap gap-vm-2" aria-label="What I can do right now">
      {shown.map((c) => (
        <li
          key={c.id}
          className="inline-flex items-center gap-vm-1 rounded-vm-pill border border-vm-border px-vm-2 py-vm-1 text-vm-0"
        >
          <span>{c.label}</span>
          <span className={`rounded-vm-pill px-vm-1 ${STATE_COPY[c.state].cls}`}>
            {STATE_COPY[c.state].label}
          </span>
          {c.detail && <span className="text-vm-text-muted">· {c.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

function Needs({ needs }: { needs: EmployeeNeed[] }) {
  if (needs.length === 0) {
    return (
      <p className="text-vm-1 text-vm-text-muted" data-testid="needs-empty">
        Nothing right now.
      </p>
    );
  }
  return (
    <ul className="space-y-vm-2" aria-label="What I need from you">
      {needs.map((n) => (
        <li key={n.code} className="text-vm-1">
          <span
            className={
              n.severity === 'attention'
                ? 'mr-vm-2 inline-block h-2 w-2 rounded-full bg-vm-warning align-middle'
                : 'mr-vm-2 inline-block h-2 w-2 rounded-full bg-vm-border align-middle'
            }
            aria-hidden="true"
          />
          <Link href={n.href} className="underline">
            {n.title}
          </Link>
          <span className="text-vm-text-muted"> — {n.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function DayLine({
  id,
  label,
  day,
}: {
  id: string;
  label: string;
  day: EmployeeStatus['yesterday'];
}) {
  const parts: string[] = [plural(day.conversations, 'conversation')];
  if (day.leads) {
    parts.push(
      `${plural(day.leads, 'lead')}${day.leadsToCrm ? ` (${day.leadsToCrm} to your CRM)` : ''}`,
    );
  }
  if (day.escalations) {
    parts.push(`${plural(day.escalations, 'hand-off')} (${day.escalationsReached} reached)`);
  }
  if (day.bookings) parts.push(plural(day.bookings, 'booking'));
  if (day.callbacksScheduled) parts.push(plural(day.callbacksScheduled, 'follow-up'));
  if (day.humanTakeovers) parts.push(plural(day.humanTakeovers, 'takeover'));
  return (
    <p className="text-vm-1" data-testid={`day-${id}`}>
      <span className="font-label">{label}:</span> {parts.join(', ')}.
    </p>
  );
}

function BusinessName({ status }: { status: EmployeeStatus }) {
  const { updateBusinessName } = useLucielMutations();
  const { busy, notice, run } = useActionNotice();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(status.businessShortName ?? '');
  const save = () =>
    void run(async () => {
      await updateBusinessName.mutateAsync(value.trim() || null);
      setEditing(false);
      return value.trim()
        ? `Saved. ${status.assistantName} now introduces itself as an AI assistant for ${value.trim()}.`
        : `Saved. ${status.assistantName} introduces itself as an AI assistant for "this business" again.`;
    }, 'We could not save the business name. Nothing was changed — please try again.');
  return (
    <div className="mt-vm-3 text-vm-0 text-vm-text-muted">
      {editing ? (
        <div className="flex flex-wrap items-center gap-vm-2">
          <label htmlFor="business-short-name" className="text-vm-0">
            Business name in greetings
          </label>
          <Input
            id="business-short-name"
            value={value}
            maxLength={80}
            className="w-64"
            onChange={(e) => setValue(e.target.value)}
          />
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save name'}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      ) : (
        <span>
          Introduces itself as an AI assistant for{' '}
          <strong>{status.businessShortName ?? 'this business'}</strong>.{' '}
          <button className="underline" onClick={() => setEditing(true)}>
            {status.businessShortName ? 'Change' : 'Set your business name'}
          </button>
        </span>
      )}
      {notice && (
        <div className="mt-vm-2">
          <Banner tone={notice.tone}>{notice.text}</Banner>
        </div>
      )}
    </div>
  );
}

function BriefToggle({ status }: { status: EmployeeStatus }) {
  const { updateDailyBrief } = useLucielMutations();
  const { busy, notice, run } = useActionNotice();
  const toggle = (next: boolean) =>
    void run(async () => {
      await updateDailyBrief.mutateAsync(next);
      return next
        ? `Morning brief on — sent once a day after 7:00 am${status.timezone ? ` (${status.timezone})` : ' (UTC until you set a timezone)'}.`
        : 'Morning brief off. You can turn it back on any time.';
    }, 'We could not change the morning brief setting. Nothing was changed — please try again.');
  return (
    <div className="mt-vm-3 flex flex-wrap items-center gap-vm-2 text-vm-0 text-vm-text-muted">
      <Toggle
        id="daily-brief-enabled"
        checked={status.dailyBriefEnabled}
        onChange={toggle}
        disabled={busy}
        label="Morning brief by email"
      />
      <label htmlFor="daily-brief-enabled">
        Morning brief by email, once a day after 7:00 am
        {status.timezone ? ` (${status.timezone})` : ' (UTC until you set a timezone)'}
      </label>
      {notice && (
        <div className="basis-full">
          <Banner tone={notice.tone}>{notice.text}</Banner>
        </div>
      )}
    </div>
  );
}

export function TodayCard() {
  const status = useEmployeeStatus();
  return (
    <Card data-testid="today-card">
      <CardTitle>Today</CardTitle>
      {status.isPending ? (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
          Checking on your Luciel…
        </p>
      ) : status.isError ? (
        <Banner tone="danger" className="mt-vm-3">
          We could not load today&apos;s status.{' '}
          <button className="underline" onClick={() => void status.refetch()}>
            Try again
          </button>
        </Banner>
      ) : !status.data ? (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
          Nothing to report yet — you haven&apos;t built a Luciel.
        </p>
      ) : (
        <TodayBody status={status.data} />
      )}
    </Card>
  );
}

function TodayBody({ status }: { status: EmployeeStatus }) {
  const team = teamLine(status);
  return (
    <>
      <p className="mt-vm-3 text-vm-2" data-testid="identity-line">
        {identityLine(status)}
      </p>
      {team && (
        <p className="mt-vm-1 text-vm-1 text-vm-text-muted" data-testid="team-line">
          {team}
        </p>
      )}
      <BusinessName status={status} />
      <CapabilityStrip items={status.capabilities} />
      <div className="mt-vm-4 grid gap-vm-4 md:grid-cols-2">
        <section>
          <h3 className="mb-vm-2 text-vm-1 font-label">What I need from you</h3>
          <Needs needs={status.needs} />
        </section>
        <section>
          <h3 className="mb-vm-2 text-vm-1 font-label">What I did</h3>
          <div className="space-y-vm-1">
            <DayLine id="yesterday" label="Yesterday" day={status.yesterday} />
            <DayLine id="today" label="So far today" day={status.today} />
          </div>
          <BriefToggle status={status} />
        </section>
      </div>
    </>
  );
}
