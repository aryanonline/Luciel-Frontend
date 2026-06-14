'use client';

import * as React from 'react';
import { Card, CardTitle, CardDescription, Button, Modal, Banner, StatusChip } from '@luciel/ui';
import type { Lead } from '@luciel/api-client';
import { useLeads, qk } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Leads + lead-store maintenance (Customer Journey §7; Arch §3.4.10a, §3.4.11).
 * The product NEVER blurs prune vs archive:
 *   - Prune = permanent delete (and the per-lead data-subject erasure).
 *   - Archive = kept in cold storage, NOT deleted; a returning archived lead is
 *     recognized.
 * Per-lead erasure (data-subject rights) is the same destructive delete.
 */
export default function LeadsPage() {
  const leads = useLeads();
  const qc = useQueryClient();
  const [pruneTarget, setPruneTarget] = React.useState<Lead | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: qk.leads });

  const archive = async (leadId: string) => {
    await api.leads.archive(leadId);
    refresh();
  };
  const prune = async () => {
    if (!pruneTarget) return;
    await api.leads.prune([pruneTarget.leadId]);
    setPruneTarget(null);
    refresh();
  };

  return (
    <div className="space-y-vm-5">
      <h1 className="font-heading text-vm-5">Leads</h1>

      <Banner tone="info">
        Keeping your list tidy: <strong>Prune</strong> permanently deletes a lead (and forgets the
        person). <strong>Archive</strong> keeps them in cheaper storage — a returning archived lead
        is recognized automatically. The two are never the same.
      </Banner>

      <Card>
        <CardTitle>All leads</CardTitle>
        <CardDescription>Captured automatically by cognition — no tool to enable.</CardDescription>
        <ul className="mt-vm-3 divide-y divide-vm-border">
          {leads.data?.map((l) => (
            <li key={l.leadId} className="flex items-center justify-between gap-vm-3 py-vm-3">
              <div className="min-w-0">
                <div className="truncate text-vm-2">{l.name ?? 'Unknown'}</div>
                <div className="text-vm-0 text-vm-text-muted">
                  {l.contactIdentifier ?? '—'} · {l.intent ?? 'No stated intent'}
                </div>
              </div>
              <div className="flex items-center gap-vm-2">
                {l.state === 'archived' && <StatusChip kind="connected" detail="archived (kept)" />}
                {l.state === 'active' && (
                  <Button variant="ghost" onClick={() => archive(l.leadId)}>
                    Archive
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setPruneTarget(l)}>
                  Prune
                </Button>
              </div>
            </li>
          ))}
          {leads.data?.length === 0 && (
            <li className="py-vm-4 text-vm-1 text-vm-text-muted">No leads yet.</li>
          )}
        </ul>
      </Card>

      <Modal
        open={Boolean(pruneTarget)}
        onOpenChange={(o) => !o && setPruneTarget(null)}
        title="Prune this lead?"
        description="This permanently deletes the lead and forgets the person — it can't be undone. If they contact you again, they'll be treated as brand new. To keep them out of your active view without deleting, use Archive instead."
        confirmLabel="Prune permanently"
        confirmVariant="danger"
        onConfirm={prune}
      />
    </div>
  );
}
