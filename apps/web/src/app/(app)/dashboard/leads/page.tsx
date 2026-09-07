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
  Field,
  Select,
} from '@luciel/ui';
import { LucielApiError } from '@luciel/api-client';
import type { Lead, LeadExportFormat, LeadOutcome } from '@luciel/api-client';
import { useLeads, useLuciel, useLucielMutations, qk } from '@/lib/hooks';
import { api } from '@/lib/api';
import { saveBlob } from '@/lib/download';
import { describeCrmDetail } from '@/lib/crm-detail';
import { usePagedTail } from '@/lib/paging';
import { LoadOlder } from '@/components/load-older';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Leads + lead-store maintenance (Customer Journey §7; Arch §3.4.10a, §3.4.11).
 * The product NEVER blurs prune vs archive:
 *   - Prune = permanent delete (and the per-lead data-subject erasure).
 *   - Archive = kept out of the active list, NOT deleted; a returning archived
 *     lead is recognized.
 * Per-lead erasure (data-subject rights, Legal §A7 / Arch §3.4.11) is the same
 * destructive delete, named for what it is.
 *
 * 2026-09-05 audit (WP6):
 *   - a lead that did not reach the CRM says so on its row and can be retried
 *     (F134); the reason the backend records is shown, never a bare "failed";
 *   - archived leads stay out of the active view unless asked for (F112);
 *   - the stale window is the tenant's own auto-prune window when one is set,
 *     otherwise a year — the "stale" label and the auto-prune rule can no longer
 *     disagree with each other.
 */
const DEFAULT_STALE_AFTER_DAYS = 365;

function staleCutoff(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

/** Offered auto-prune windows. Any whole number ≥ 1 is valid server-side, so a
 *  window set outside this UI is preserved as an extra option rather than lost. */
const RETENTION_PRESETS = [90, 180, 365, 730];

const RETENTION_LABEL: Record<number, string> = {
  90: '90 days',
  180: '180 days (6 months)',
  365: '365 days (1 year)',
  730: '730 days (2 years)',
};

const retentionLabel = (days: number) => RETENTION_LABEL[days] ?? `${days} days`;

const leadKey = (l: Lead) => l.leadId;
const fetchOlderLeads = (opts: { limit?: number; offset?: number }) => api.leads.list(opts);

export default function LeadsPage() {
  const leads = useLeads();
  const luciel = useLuciel();
  const { updateLeadRetention } = useLucielMutations();
  const qc = useQueryClient();
  const [staleOnly, setStaleOnly] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [pruneIds, setPruneIds] = React.useState<string[] | null>(null);
  const [pruneMode, setPruneMode] = React.useState<'prune' | 'erase'>('prune');
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [archiving, setArchiving] = React.useState<string | null>(null);
  const [archiveError, setArchiveError] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState<string | null>(null);
  const [retryError, setRetryError] = React.useState<string | null>(null);
  const [retryNotice, setRetryNotice] = React.useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: qk.leads });

  const retentionDays = luciel.data?.leadRetentionDays ?? null;
  // The tenant's own window when they set one (an "auto-prune in 90 days" rule
  // makes a 12-month "stale" label a lie); otherwise a year.
  const staleAfterDays = retentionDays ?? DEFAULT_STALE_AFTER_DAYS;

  // 2026-09-05 audit WP7: paged server-side (200 per page); older leads load on request.
  const olderLeads = usePagedTail(leads.data, fetchOlderLeads, leadKey);
  const all = [...(leads.data ?? []), ...olderLeads.extra];
  const cutoff = staleCutoff(staleAfterDays);
  const isStale = (l: Lead) => new Date(l.lastActivityAt).getTime() < cutoff;
  const archivedCount = all.filter((l) => l.state === 'archived').length;
  const inView = all.filter((l) => showArchived || l.state !== 'archived');
  const staleCount = inView.filter(isStale).length;
  const visible = staleOnly ? inView.filter(isStale) : inView;
  const notInCrm = all.filter((l) => l.crmStatus === 'failed');
  const selectedVisible = visible.filter((l) => selected.includes(l.leadId));
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;

  const toggleFilter = (next: boolean) => {
    setStaleOnly(next);
    setSelected([]);
  };

  const toggleArchived = (next: boolean) => {
    setShowArchived(next);
    setSelected([]);
  };

  const toggleOne = (leadId: string, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev, leadId] : prev.filter((id) => id !== leadId)));

  const toggleAllVisible = (checked: boolean) =>
    setSelected(checked ? visible.map((l) => l.leadId) : []);

  const archive = async (leadId: string) => {
    setArchiveError(null);
    setArchiving(leadId);
    try {
      await api.leads.archive(leadId);
      refresh();
    } catch {
      setArchiveError('We could not archive that lead. It is unchanged — please try again.');
    } finally {
      setArchiving(null);
    }
  };

  /** F134: push the lead's current facts again. A 409 carries the reason nothing
   *  was attempted (tool off, connection not ready) and is shown verbatim. */
  const retryCrm = async (lead: Lead) => {
    setRetryError(null);
    setRetryNotice(null);
    setRetrying(lead.leadId);
    try {
      const updated = await api.leads.retryCrmPush(lead.leadId);
      if (updated.crmStatus === 'synced') {
        setRetryNotice(`${lead.name ?? 'The lead'} is now in your CRM.`);
      } else {
        setRetryError(
          `Still not in your CRM — ${describeCrmDetail(updated.crmDetail)}. Nothing else changed.`,
        );
      }
      refresh();
    } catch (err) {
      setRetryError(
        err instanceof LucielApiError
          ? err.message
          : 'We could not retry that push just now. Nothing changed — please try again.',
      );
    } finally {
      setRetrying(null);
    }
  };

  const [outcomeSaving, setOutcomeSaving] = React.useState<string | null>(null);
  const [outcomeError, setOutcomeError] = React.useState<string | null>(null);
  /** Mark the lead's business outcome (Vision §7; C14) — feeds the analytics
   *  Conversion-by-source card. Reversible; a failed write leaves the lead
   *  unchanged and says so (never a silent revert). */
  const markOutcome = async (leadId: string, outcome: LeadOutcome) => {
    setOutcomeError(null);
    setOutcomeSaving(leadId);
    try {
      await api.leads.markOutcome(leadId, outcome);
      refresh();
    } catch {
      setOutcomeError('We could not save that outcome. The lead is unchanged — please try again.');
    } finally {
      setOutcomeSaving(null);
    }
  };

  /**
   * Throws on failure ON PURPOSE: the Modal renders the error and stays open, so
   * a prune that did not happen can never look like one that did (P0-6). The
   * selection is only cleared once the delete is confirmed.
   */
  const prune = async () => {
    if (!pruneIds) return;
    await api.leads.prune(pruneIds);
    setPruneIds(null);
    setSelected([]);
    refresh();
  };

  const openErase = (leadId: string) => {
    setPruneMode('erase');
    setPruneIds([leadId]);
  };

  const openPrune = (ids: string[]) => {
    setPruneMode('prune');
    setPruneIds(ids);
  };

  const pruneCount = pruneIds?.length ?? 0;

  const exportLeads = async (format: LeadExportFormat) => {
    setExportError(null);
    setExporting(true);
    try {
      const file = await api.leads.export(format);
      saveBlob(file.blob, file.filename);
    } catch {
      setExportError('We could not prepare that export just now. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const retentionOptions =
    retentionDays !== null && !RETENTION_PRESETS.includes(retentionDays)
      ? [...RETENTION_PRESETS, retentionDays].sort((a, b) => a - b)
      : RETENTION_PRESETS;

  const changeRetention = (value: string) => {
    updateLeadRetention.mutate(value === 'off' ? null : Number(value));
  };

  const modalTitle =
    pruneMode === 'erase'
      ? "Erase this lead's data?"
      : pruneCount > 1
        ? `Prune ${pruneCount} leads?`
        : 'Prune this lead?';
  const modalDescription =
    pruneMode === 'erase'
      ? 'This is the right-to-erasure action (Privacy Policy, your customers’ data rights). It permanently deletes the lead and everything we hold about them — their conversations, summaries, scheduled callbacks and our link to your CRM record — and cannot be undone. If they contact you again, they will be treated as brand new. The record inside your own CRM is yours to delete there; erasing here removes everything on our side, including the link to it.'
      : pruneCount > 1
        ? `This permanently deletes ${pruneCount} leads and forgets those people — it can't be undone. If any of them contact you again, they'll be treated as brand new. To keep leads out of your active view without deleting, use Archive instead. Leads already pushed to your CRM stay in your CRM — deleting those records there is up to you.`
        : "This permanently deletes the lead and forgets the person — it can't be undone. If they contact you again, they'll be treated as brand new. To keep them out of your active view without deleting, use Archive instead. If this lead was pushed to your CRM, the record inside your CRM is yours to delete there — erasing here removes everything we hold, including our link to that record.";
  const modalConfirm =
    pruneMode === 'erase'
      ? 'Erase permanently'
      : pruneCount > 1
        ? `Prune ${pruneCount} permanently`
        : 'Prune permanently';
  const modalPending =
    pruneMode === 'erase' ? 'Erasing…' : pruneCount > 1 ? `Pruning ${pruneCount}…` : 'Pruning…';

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Leads"
        description="Everyone your Luciel has captured. Keep the list tidy with prune and archive."
      />

      <Banner tone="info">
        Keeping your list tidy: <strong>Prune</strong> permanently deletes a lead (and forgets the
        person). <strong>Archive</strong> keeps them out of your active list — nothing is deleted,
        and a returning archived lead is recognized automatically. The two are never the same.
      </Banner>

      {notInCrm.length > 0 && (
        <Banner tone="warning">
          {notInCrm.length} lead{notInCrm.length === 1 ? '' : 's'} did not reach your CRM. The leads
          are safe here; use <strong>Retry CRM push</strong> on a row once your CRM connection is
          healthy. Luciel also retries on its own the next time it learns something new about them.
        </Banner>
      )}

      <Card>
        <CardTitle>All leads</CardTitle>
        <CardDescription>Captured automatically by cognition — no tool to enable.</CardDescription>

        <div className="mt-vm-3 flex flex-wrap items-center justify-between gap-vm-3">
          <div className="flex flex-col gap-vm-2">
            <label className="flex items-center gap-vm-2 text-vm-1">
              <input
                type="checkbox"
                checked={staleOnly}
                onChange={(e) => toggleFilter(e.target.checked)}
                className="h-4 w-4"
              />
              <span>
                Show only stale leads — no activity for over {staleAfterDays} days
                {retentionDays !== null ? ' (your auto-prune window)' : ''} ({staleCount})
              </span>
            </label>
            <label className="flex items-center gap-vm-2 text-vm-1">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => toggleArchived(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Show archived leads ({archivedCount})</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-vm-2">
            <Button variant="ghost" disabled={exporting} onClick={() => void exportLeads('csv')}>
              {exporting ? 'Preparing…' : 'Export CSV'}
            </Button>
            <Button variant="ghost" disabled={exporting} onClick={() => void exportLeads('json')}>
              {exporting ? 'Preparing…' : 'Export JSON'}
            </Button>
            {selectedVisible.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => openPrune(selectedVisible.map((l) => l.leadId))}
              >
                Prune {selectedVisible.length} selected
              </Button>
            )}
          </div>
        </div>

        {exportError && (
          <Banner tone="danger" className="mt-vm-3">
            {exportError}
          </Banner>
        )}
        {archiveError && (
          <Banner tone="danger" className="mt-vm-3">
            {archiveError}
          </Banner>
        )}
        {outcomeError && (
          <Banner tone="danger" className="mt-vm-3">
            {outcomeError}
          </Banner>
        )}
        {retryError && (
          <Banner tone="danger" className="mt-vm-3">
            {retryError}
          </Banner>
        )}
        {retryNotice && (
          <Banner tone="info" className="mt-vm-3">
            {retryNotice}
          </Banner>
        )}

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
                  {/* LeadOut.email (round 5): a second identifier when the
                      captured email is a different handle than the transport
                      identifier — repeating the same string tells the owner
                      nothing. */}
                  {l.email && l.email !== l.contactIdentifier && (
                    <div className="truncate text-vm-0 text-vm-text-muted">also: {l.email}</div>
                  )}
                  {/* LeadOut.phone (F111): the volunteered number beside a
                      non-phone key. */}
                  {l.phone && l.phone !== l.contactIdentifier && (
                    <div className="truncate text-vm-0 text-vm-text-muted">also: {l.phone}</div>
                  )}
                  {l.crmStatus === 'failed' && (
                    <div className="text-vm-0 text-vm-warning">
                      Not in your CRM — {describeCrmDetail(l.crmDetail)}.
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-vm-2">
                {isStale(l) && <span className="text-vm-0 text-vm-text-muted">stale</span>}
                {l.crmStatus === 'synced' && (
                  <span className="text-vm-0 text-vm-text-muted">in your CRM</span>
                )}
                {l.crmStatus === 'failed' && (
                  <>
                    <StatusChip kind="action_needed" detail="not in your CRM" />
                    <Button
                      variant="ghost"
                      disabled={retrying === l.leadId}
                      onClick={() => void retryCrm(l)}
                    >
                      {retrying === l.leadId ? 'Retrying…' : 'Retry CRM push'}
                    </Button>
                  </>
                )}
                {/* Business outcome (Vision §7; C14): what Conversion-by-source
                    reads. Reversible on purpose — deals change. */}
                <Select
                  aria-label={`Outcome for ${l.name ?? 'lead'}`}
                  value={l.outcome}
                  disabled={outcomeSaving === l.leadId}
                  onChange={(e) => void markOutcome(l.leadId, e.target.value as LeadOutcome)}
                >
                  <option value="in_progress">In progress</option>
                  <option value="converted">Won</option>
                  <option value="lost">Lost</option>
                </Select>
                {l.state === 'archived' && <StatusChip kind="connected" detail="archived (kept)" />}
                {l.state === 'active' && (
                  <Button
                    variant="ghost"
                    disabled={archiving === l.leadId}
                    onClick={() => void archive(l.leadId)}
                  >
                    {archiving === l.leadId ? 'Archiving…' : 'Archive'}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  aria-label={`Erase ${l.name ?? 'lead'}'s data`}
                  onClick={() => openErase(l.leadId)}
                >
                  Erase
                </Button>
              </div>
            </li>
          ))}
          {/* "Still loading", "we could not load" and "genuinely none" are three
              different things; only the last is good news (P1-9). */}
          {visible.length === 0 &&
            (leads.isPending ? (
              <li className="py-vm-4 text-vm-1 text-vm-text-muted" role="status">
                Loading your leads…
              </li>
            ) : leads.isError ? (
              <li className="py-vm-4">
                <Banner tone="danger">
                  We could not load your leads.{' '}
                  <button className="underline" onClick={() => void leads.refetch()}>
                    Try again
                  </button>
                </Banner>
              </li>
            ) : (
              <li className="py-vm-4 text-vm-1 text-vm-text-muted">
                {staleOnly && inView.length > 0
                  ? `No leads have been inactive for over ${staleAfterDays} days.`
                  : !showArchived && archivedCount > 0 && all.length === archivedCount
                    ? `All ${archivedCount} of your leads are archived. Tick “Show archived leads” to see them.`
                    : 'No leads yet.'}
              </li>
            ))}
        </ul>
        <LoadOlder label="Load older leads" tail={olderLeads} />
      </Card>

      {luciel.data && (
        <Card>
          <CardTitle>Auto-prune rule</CardTitle>
          <CardDescription>
            Optional. Off unless you turn it on — we never delete your leads on your behalf.
          </CardDescription>

          <div className="mt-vm-3 max-w-sm">
            <Field
              id="lead-retention-days"
              label="Automatically prune leads with no activity for"
              hint={
                retentionDays === null
                  ? 'Currently off: leads are kept until you prune them yourself.'
                  : `Active leads with no activity for ${retentionLabel(retentionDays)} are permanently deleted — this cannot be undone. Archived leads are never auto-pruned.`
              }
              error={
                updateLeadRetention.isError
                  ? 'We could not save that just now. Please try again.'
                  : undefined
              }
            >
              {(props) => (
                <Select
                  {...props}
                  value={retentionDays === null ? 'off' : String(retentionDays)}
                  disabled={updateLeadRetention.isPending}
                  onChange={(e) => changeRetention(e.target.value)}
                >
                  <option value="off">Off — keep leads until I prune them</option>
                  {retentionOptions.map((days) => (
                    <option key={days} value={days}>
                      {retentionLabel(days)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <p className="text-vm-0 text-vm-text-muted">
            Export first if you want your own copy — pruning is permanent.
          </p>
        </Card>
      )}

      <Modal
        open={Boolean(pruneIds)}
        onOpenChange={(o) => !o && setPruneIds(null)}
        title={modalTitle}
        description={modalDescription}
        confirmLabel={modalConfirm}
        confirmVariant="danger"
        confirmPendingLabel={modalPending}
        onConfirm={prune}
      />
    </div>
  );
}
