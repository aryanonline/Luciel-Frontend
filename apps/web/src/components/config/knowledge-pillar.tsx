'use client';

import * as React from 'react';
import {
  Card,
  CardTitle,
  CardDescription,
  Banner,
  Button,
  Field,
  Input,
  Textarea,
  ProgressBar,
  StatusChip,
  Modal,
} from '@luciel/ui';
import type { KnowledgeSource, KnowledgeSyncProvider } from '@luciel/api-client';
import { qk, useChunks, useKnowledge, useQuota } from '@/lib/hooks';
import { api } from '@/lib/api';
import { authorizeOrExplain } from '@/lib/oauth-connect';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Knowledge pillar (Vision §3.3, Arch §3.2.2, Customer Journey §4.3). Ingestion
 * affordances (upload/paste/CSV + crawl + live-sync connectors) and the raw
 * knowledge view: each source with chunk preview, last-updated (+ last-synced
 * for live sources), manual re-sync, and delete. Deleting shows the "this will
 * affect your Luciel's answers" confirmation (Vision §3.3). Quota: 5 GB / 50 MB
 * per file, enforced client-side for a fast error and again by the backend.
 */
const fmtBytes = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;

const UPLOAD_ACCEPT = '.pdf,.docx,.txt,.csv';
/** Fallback only — the live limit comes from the quota endpoint. */
const PER_FILE_MAX_BYTES = 50_000_000;
/** Chunk preview shows the head of the source verbatim (Arch §3.2.2). */
const CHUNK_PREVIEW_LIMIT = 10;

type Notice = { tone: 'info' | 'danger'; text: string };

export function KnowledgePillar() {
  const sources = useKnowledge();
  const quota = useQuota();
  const qc = useQueryClient();
  const [toDelete, setToDelete] = React.useState<KnowledgeSource | null>(null);
  const [viewing, setViewing] = React.useState<KnowledgeSource | null>(null);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteName, setPasteName] = React.useState('');
  const [pasteText, setPasteText] = React.useState('');
  const [crawlOpen, setCrawlOpen] = React.useState(false);
  const [crawlUrl, setCrawlUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>(null);

  const uploadRef = React.useRef<HTMLInputElement>(null);
  const csvRef = React.useRef<HTMLInputElement>(null);
  const chunks = useChunks(viewing?.sourceId ?? null);
  const perFileMax = quota.data?.perFileMaxBytes ?? PER_FILE_MAX_BYTES;

  /** Runs one ingestion action, surfacing pending/success/error and refetching. */
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ tone: 'info', text: await fn() });
      qc.invalidateQueries({ queryKey: qk.knowledge });
      qc.invalidateQueries({ queryKey: qk.quota });
    } catch (err) {
      setNotice({
        tone: 'danger',
        text: err instanceof Error ? err.message : 'That did not work. Please try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  const ingestFiles = (files: FileList, kind: 'upload' | 'csv') =>
    run(async () => {
      const chosen = Array.from(files);
      const tooBig = chosen.find((f) => f.size > perFileMax);
      if (tooBig) {
        throw new Error(
          `${tooBig.name} is ${fmtBytes(tooBig.size)} — the limit is ${fmtBytes(perFileMax)} per file.`,
        );
      }
      for (const file of chosen) {
        if (kind === 'csv') await api.knowledge.importCsv(file, file.name);
        else await api.knowledge.uploadFile(file, file.name);
      }
      return `Added ${chosen.length} file${chosen.length > 1 ? 's' : ''} to your knowledge base.`;
    });

  const addPaste = () => {
    setPasteOpen(false);
    const name = pasteName.trim();
    const text = pasteText.trim();
    setPasteName('');
    setPasteText('');
    return run(async () => {
      await api.knowledge.pasteText({ name, text });
      return `Added “${name}” to your knowledge base.`;
    });
  };

  const addCrawl = () => {
    setCrawlOpen(false);
    const url = crawlUrl.trim();
    setCrawlUrl('');
    return run(async () => {
      // Creating the connection only registers the target; the first crawl is
      // what actually produces sources (Arch §3.2.3 — manual pull, no poller).
      const connection = await api.knowledge.startCrawl([url]);
      const result = await api.knowledge.syncConnection(connection.connectionId);
      return `Crawled ${url} — ${result.added.length} page(s) added.`;
    });
  };

  /**
   * Live-sync connectors (Arch §3.2.3). Creating the connection mints a fresh
   * single-use consent URL; the admin's browser goes to the provider in full so
   * they can authorize the account. Nothing syncs until they come back through
   * the callback. Providers with no registered OAuth client say so instead.
   */
  const connectProvider = (provider: KnowledgeSyncProvider, label: string) =>
    run(async () => {
      const connection = await api.knowledge.startSyncConnection(provider);
      if (connection.status === 'connected') return `${label} is connected and will sync.`;
      const authorizeUrl = connection.nonSecretConfig?.authorize_url;
      return (
        authorizeOrExplain({
          authorizeUrl: typeof authorizeUrl === 'string' ? authorizeUrl : null,
          statusDetail: connection.statusDetail,
          provider,
          connectionId: connection.connectionId,
          label,
        }) ?? `Taking you to ${label} to authorize access…`
      );
    });

  const resync = (source: KnowledgeSource) =>
    run(async () => {
      await api.knowledge.resyncSource(source.sourceId);
      return `Re-synced “${source.name}”.`;
    });

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
        <Button variant="secondary" disabled={busy} onClick={() => uploadRef.current?.click()}>
          Upload files
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setPasteOpen(true)}>
          Paste text
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => csvRef.current?.click()}>
          Import CSV
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setCrawlOpen(true)}>
          Crawl a website
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => connectProvider('google_drive', 'Google Drive')}
        >
          Connect Google Drive
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => connectProvider('notion', 'Notion')}
        >
          Connect Notion
        </Button>
      </div>

      <input
        ref={uploadRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void ingestFiles(e.target.files, 'upload');
          e.target.value = '';
        }}
      />
      <input
        ref={csvRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void ingestFiles(e.target.files, 'csv');
          e.target.value = '';
        }}
      />

      {busy && (
        <p className="mt-vm-3 text-vm-1 text-vm-text-muted" role="status">
          Working on it…
        </p>
      )}
      {notice && !busy && (
        <Banner className="mt-vm-3" tone={notice.tone}>
          {notice.text}
        </Banner>
      )}

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
                  kind={
                    s.syncStatus === 'paused_reconnect_needed'
                      ? 'reconnect_needed'
                      : s.syncStatus === 'error'
                        ? 'action_needed'
                        : 'connected'
                  }
                />
              )}
              {s.syncStatus && (
                <Button variant="ghost" disabled={busy} onClick={() => resync(s)}>
                  Re-sync
                </Button>
              )}
              <Button variant="ghost" onClick={() => setViewing(s)}>
                View
              </Button>
              <Button variant="ghost" onClick={() => setToDelete(s)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Paste text"
        description="Paste anything you want Luciel to know — pricing, policies, FAQs."
        confirmLabel="Add to knowledge"
        confirmDisabled={!pasteName.trim() || !pasteText.trim()}
        onConfirm={addPaste}
      >
        <Field id="paste-name" label="Name this" hint="e.g. Cancellation policy">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              value={pasteName}
              onChange={(e) => setPasteName(e.target.value)}
              placeholder="Cancellation policy"
            />
          )}
        </Field>
        <Field id="paste-text" label="Text">
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste your text here…"
            />
          )}
        </Field>
      </Modal>

      <Modal
        open={crawlOpen}
        onOpenChange={setCrawlOpen}
        title="Crawl a website"
        description="We fetch the page and add what it says to your knowledge base."
        confirmLabel="Crawl this page"
        confirmDisabled={!/^https?:\/\/\S+$/.test(crawlUrl.trim())}
        onConfirm={addCrawl}
      >
        <Field id="crawl-url" label="Page address" hint="e.g. https://yourbusiness.com/services">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="url"
              inputMode="url"
              value={crawlUrl}
              onChange={(e) => setCrawlUrl(e.target.value)}
              placeholder="https://yourbusiness.com/services"
            />
          )}
        </Field>
      </Modal>

      <Modal
        open={Boolean(viewing)}
        onOpenChange={(o) => !o && setViewing(null)}
        title={viewing ? `What Luciel reads from “${viewing.name}”` : 'Chunk preview'}
        description="This is the text itself, exactly as Luciel stores it."
        cancelLabel="Close"
      >
        {chunks.isLoading ? (
          <p className="text-vm-1 text-vm-text-muted" role="status">
            Loading…
          </p>
        ) : chunks.error ? (
          <p className="text-vm-1 text-vm-danger" role="alert">
            We could not load this source right now.
          </p>
        ) : !chunks.data?.length ? (
          <p className="text-vm-1 text-vm-text-muted">
            Nothing stored for this source yet — it may still be processing.
          </p>
        ) : (
          <ul className="max-h-80 space-y-vm-3 overflow-y-auto">
            {chunks.data.slice(0, CHUNK_PREVIEW_LIMIT).map((c) => (
              <li
                key={c.chunkId}
                className="whitespace-pre-wrap rounded-vm-control border border-vm-border bg-vm-surface p-vm-3 text-vm-0"
              >
                {c.text}
              </li>
            ))}
            {chunks.data.length > CHUNK_PREVIEW_LIMIT && (
              <li className="text-vm-0 text-vm-text-muted">
                Showing the first {CHUNK_PREVIEW_LIMIT} of {chunks.data.length} pieces.
              </li>
            )}
          </ul>
        )}
      </Modal>

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
