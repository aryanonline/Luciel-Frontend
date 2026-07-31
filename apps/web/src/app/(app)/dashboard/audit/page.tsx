'use client';

import { Card, CardTitle, CardDescription, PageHeader, Banner } from '@luciel/ui';
import { useAudit } from '@/lib/hooks';

/**
 * Audit log view — read-only (Arch §5.2). The append-only, tamper-evident log is
 * the proof-of-everything record; this surface only reads it.
 */

/**
 * Owner-facing names for the event types we know about (P2-3). The vocabulary is
 * open — the server may log a type this build has never heard of — so anything
 * unmapped is de-snaked rather than dropped.
 */
const EVENT_LABEL: Record<string, string> = {
  instance_configured: 'Luciel configured',
  instance_paused: 'Luciel paused',
  instance_resumed: 'Luciel resumed',
  instance_deleted: 'Luciel deleted',
  instance_restored: 'Luciel restored',
  connection_created: 'Account connected',
  connection_status_changed: 'Connection status changed',
  connection_disconnected: 'Account disconnected',
  knowledge_source_added: 'Knowledge added',
  knowledge_source_deleted: 'Knowledge deleted',
  lead_archived: 'Lead archived',
  lead_pruned: 'Lead permanently deleted',
  payment_method_added: 'Payment method added',
  payment_method_removed: 'Payment method removed',
  export_requested: 'Data export requested',
  account_closed: 'Account closed',
};

const eventLabel = (type: string) =>
  EVENT_LABEL[type] ?? type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default function AuditPage() {
  const { data, isPending, isError, refetch } = useAudit();

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Audit log"
        description="A read-only, append-only record of every meaningful change to your account."
      />
      <Card>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Read-only. Every meaningful change is recorded here.</CardDescription>
        {/* An empty <ul> was how this page rendered both "still loading" and "we
            could not read the log" — and for a proof-of-everything record,
            silently showing nothing is the one thing it must not do (P1-14). */}
        {isPending ? (
          <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
            Loading your activity…
          </p>
        ) : isError ? (
          <Banner tone="danger" className="mt-vm-3">
            We could not load your audit log. This is a read failure on our side — nothing has been
            removed from the record.{' '}
            <button className="underline" onClick={() => void refetch()}>
              Try again
            </button>
          </Banner>
        ) : !data?.length ? (
          <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
            Nothing recorded yet. Changes to your Luciel, your connections, and your account will
            appear here.
          </p>
        ) : (
          <ul className="mt-vm-3 divide-y divide-vm-border">
            {data.map((e) => (
              <li
                key={e.eventId}
                className="flex items-start justify-between gap-vm-3 py-vm-2 text-vm-1"
              >
                <div>
                  <div className="font-label">{eventLabel(e.eventType)}</div>
                  {e.detail && <div className="text-vm-0 text-vm-text-muted">{e.detail}</div>}
                </div>
                <time className="shrink-0 text-vm-0 text-vm-text-muted">
                  {new Date(e.at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
