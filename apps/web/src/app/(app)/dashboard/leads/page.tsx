'use client';

import * as React from 'react';
import {
  Card,
  CardTitle,
  CardDescription,
  Button,
  Modal,
  Banner,
  StatusChip,
  PageHeader,
} from '@luciel/ui';
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
 *
 * The stale window is computed here from `lastActivityAt` because the list
 * endpoint takes no filter params — the whole list is already client-side.
 */
const STALE_AFTER_MONTHS = 12;

function staleCutoff(): number {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - STALE_AFTER_MONTHS);
  return cutoff.getTime();
}

export default function LeadsPage() {
  const leads = useLeads();
  const qc = useQueryClient();
  const [staleOnly, setStaleOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [pruneIds, setPruneIds] = React.useState<string[] | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: qk.leads });

  const all = leads.data ?? [];
  const cutoff = staleCutoff();
  const isStale = (l: Lead) => new Date(l.lastActivityAt).getTime() < cutoff;
  const staleCount = all.filter(isStale).length;
  const visible = staleOnly ? all.filter(isStale) : all;
  const selectedVisible = visible.filter((l) => selected.includes(l.leadId));
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;

  const toggleFilter = (next: boolean) => {
    setStaleOnly(next);
    setSelected([]);
  };

  const toggleOne = (leadId: string, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev, leadId] : prev.filter((id) => id !== leadId)));

  const toggleAllVisible = (checked: boolean) =>
    setSelected(checked ? visible.map((l) => l.leadId) : []);

  const archive = async (leadId: string) => {
    await api.leads.archive(leadId);
    refresh();
  };

  const prune = async () => {
    if (!pruneIds) return;
    await api.leads.prune(pruneIds);
    setPruneIds(null);
    setSelected([]);
    refresh();
  };

  const pruneCount = pruneIds?.length ?? 0;

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Leads"
        description="Everyone your Luciel has captured. Keep the list tidy with prune and archive."
      />

      <Banner tone="info">
        Keeping your list tidy: <strong>Prune</strong> permanently deletes a lead (and forgets the
        person). <strong>Archive</strong> keeps them in cheaper storage — a returning archived lead
        is recognized automatically. The two are never the same.
      </Banner>

      <Card>
        <CardTitle>All leads</CardTitle>
        <CardDescription>Captured automatically by cognition — no tool to enable.</CardDescription>

        <div className="mt-vm-3 flex flex-wrap items-center justify-between gap-vm-3">
          <label className="flex items-center gap-vm-2 text-vm-1">
            <input
              type="checkbox"
              checked={staleOnly}
              onChange={(e) => toggleFilter(e.target.checked)}
              className="h-4 w-4"
            />
            <span>
              Show only stale leads — no activity for over {STALE_AFTER_MONTHS} months (
              {staleCount})
            </span>
          </label>
          {selectedVisible.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => setPruneIds(selectedVisible.map((l) => l.leadId))}
            >
              Prune {selectedVisible.length} selected
            </Button>
          )}
        </div>

        {visible.length > 0 && (
          <label className="mt-vm-3 flex items-center gap-vm-2 text-vm-0 text-vm-text-muted">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(e) => toggleAllVisible(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Select all {visible.length} shown</span>
          </label>
        )}

        <ul className="mt-vm-3 divide-y divide-vm-border">
          {visible.map((l) => (
            <li key={l.leadId} className="flex items-center justify-between gap-vm-3 py-vm-3">
              <div className="flex min-w-0 items-center gap-vm-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${l.name ?? 'lead'}`}
                  checked={selected.includes(l.leadId)}
                  onChange={(e) => toggleOne(l.leadId, e.target.checked)}
                  className="h-4 w-4 shrink-0"
                />
                <div className="min-w-0">
                  <div className="truncate text-vm-2">{l.name ?? 'Unknown'}</div>
                  <div className="text-vm-0 text-vm-text-muted">
                    {l.contactIdentifier ?? '—'} · {l.intent ?? 'No stated intent'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-vm-2">
                {isStale(l) && <span className="text-vm-0 text-vm-text-muted">stale</span>}
                {l.state === 'archived' && <StatusChip kind="connected" detail="archived (kept)" />}
                {l.state === 'active' && (
                  <Button variant="ghost" onClick={() => archive(l.leadId)}>
                    Archive
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setPruneIds([l.leadId])}>
                  Prune
                </Button>
              </div>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="py-vm-4 text-vm-1 text-vm-text-muted">
              {staleOnly && all.length > 0
                ? `No leads have been inactive for over ${STALE_AFTER_MONTHS} months.`
                : 'No leads yet.'}
            </li>
          )}
        </ul>
      </Card>

      <Modal
        open={Boolean(pruneIds)}
        onOpenChange={(o) => !o && setPruneIds(null)}
        title={pruneCount > 1 ? `Prune ${pruneCount} leads?` : 'Prune this lead?'}
        description={
          pruneCount > 1
            ? `This permanently deletes ${pruneCount} leads and forgets those people — it can't be undone. If any of them contact you again, they'll be treated as brand new. To keep leads out of your active view without deleting, use Archive instead.`
            : "This permanently deletes the lead and forgets the person — it can't be undone. If they contact you again, they'll be treated as brand new. To keep them out of your active view without deleting, use Archive instead."
        }
        confirmLabel={pruneCount > 1 ? `Prune ${pruneCount} permanently` : 'Prune permanently'}
        confirmVariant="danger"
        onConfirm={prune}
      />
    </div>
  );
}
