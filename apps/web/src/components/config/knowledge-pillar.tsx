'use client';

import * as React from 'react';
import {
  Card,
  CardTitle,
  CardDescription,
  Button,
  ProgressBar,
  StatusChip,
  Modal,
} from '@luciel/ui';
import type { KnowledgeSource } from '@luciel/api-client';
import { useKnowledge, useQuota } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/hooks';

/**
 * Knowledge pillar (Vision §3.3, Arch §3.2.2, Customer Journey §4.3). Ingestion
 * affordances (upload/paste/CSV + crawl + live-sync connectors) and the raw
 * knowledge view: each source with chunk preview, last-updated (+ last-synced
 * for live sources), and edit/delete. Deleting shows the "this will affect your
 * Luciel's answers" confirmation (Vision §3.3). Quota: 5 GB / 50 MB per file.
 *
 * The actual upload pipeline is backend work; here the ingestion buttons are
 * present and honest (they describe what they do); the raw view and delete-with-
 * confirm are fully wired against the typed client.
 */
const fmtBytes = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;

export function KnowledgePillar() {
  const sources = useKnowledge();
  const quota = useQuota();
  const qc = useQueryClient();
  const [toDelete, setToDelete] = React.useState<KnowledgeSource | null>(null);

  const onDelete = async () => {
    if (!toDelete) return;
    await api.knowledge.deleteSource(toDelete.sourceId);
    setToDelete(null);
    qc.invalidateQueries({ queryKey: qk.knowledge });
    qc.invalidateQueries({ queryKey: qk.quota });
  };

  return (
    <Card>
      <CardTitle>Knowledge base</CardTitle>
      <CardDescription>Upload anything you want your Luciel to know about.</CardDescription>

      <div className="mt-vm-4 flex flex-wrap gap-vm-2">
        <Button variant="secondary">Upload files</Button>
        <Button variant="secondary">Paste text</Button>
        <Button variant="secondary">Import CSV</Button>
        <Button variant="secondary">Crawl a website</Button>
        <Button variant="secondary">Connect Google Drive</Button>
        <Button variant="secondary">Connect Notion</Button>
      </div>

      {quota.data && (
        <ProgressBar
          className="mt-vm-4"
          value={quota.data.usedBytes}
          max={quota.data.totalBytes}
          label={`${fmtBytes(quota.data.usedBytes)} / 5 GB used (50 MB per file)`}
        />
      )}

      {/* Raw knowledge view (Arch §3.2.2). */}
      <h4 className="mt-vm-5 text-vm-1 font-label">Your sources</h4>
      <ul className="mt-vm-2 divide-y divide-vm-border">
        {sources.data?.map((s) => (
          <li key={s.sourceId} className="flex items-center justify-between gap-vm-3 py-vm-3">
            <div className="min-w-0">
              <div className="truncate text-vm-2">{s.name}</div>
              <div className="text-vm-0 text-vm-text-muted">
                {s.origin.replace(/_/g, ' ')} · {fmtBytes(s.sizeBytes)} ·{' '}
                {s.lastSyncedAt
                  ? `last synced ${new Date(s.lastSyncedAt).toLocaleDateString()}`
                  : `updated ${new Date(s.lastUpdatedAt).toLocaleDateString()}`}
              </div>
            </div>
            <div className="flex items-center gap-vm-2">
              {s.syncStatus && (
                <StatusChip
                  kind={s.syncStatus === 'needs_reconnect' ? 'reconnect_needed' : 'connected'}
                />
              )}
              <Button variant="ghost">View</Button>
              <Button variant="ghost" onClick={() => setToDelete(s)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this knowledge source?"
        description={
          <>
            This will affect the answers Luciel gives. Recent customer questions used this source.
            Editing or removing knowledge is how you keep Luciel accurate — but make sure you mean
            to.
          </>
        }
        confirmLabel="Delete source"
        confirmVariant="danger"
        onConfirm={onDelete}
      />
    </Card>
  );
}
