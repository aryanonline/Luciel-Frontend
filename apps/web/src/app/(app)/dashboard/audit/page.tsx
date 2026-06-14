'use client';

import { Card, CardTitle, CardDescription } from '@luciel/ui';
import { useAudit } from '@/lib/hooks';

/**
 * Audit log view — read-only (Arch §5.2). The append-only, tamper-evident log is
 * the proof-of-everything record; this surface only reads it.
 */
export default function AuditPage() {
  const { data, isLoading } = useAudit();

  return (
    <div className="space-y-vm-5">
      <h1 className="font-heading text-vm-5">Audit log</h1>
      <Card>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Read-only. Every meaningful change is recorded here.</CardDescription>
        {isLoading ? (
          <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
            Loading…
          </p>
        ) : (
          <ul className="mt-vm-3 divide-y divide-vm-border">
            {data?.map((e) => (
              <li
                key={e.eventId}
                className="flex items-start justify-between gap-vm-3 py-vm-2 text-vm-1"
              >
                <div>
                  <div className="font-label">{e.eventType.replace(/_/g, ' ')}</div>
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
