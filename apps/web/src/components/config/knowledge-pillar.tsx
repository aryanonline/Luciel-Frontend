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
import { LucielApiError } from '@luciel/api-client';
import type { KnowledgeSource, KnowledgeSyncProvider } from '@luciel/api-client';
import {
  qk,
  useChunks,
  useConnectionProviders,
  useConnections,
  useKnowledge,
  useQuota,
} from '@/lib/hooks';
import { api } from '@/lib/api';
import { authorizeOrExplain } from '@/lib/oauth-connect';
import { useQueryClient } from '@tanstack/react-query';
import { KnowledgeScopeSections } from './knowledge-scope';

/**
 * Knowledge pillar (Vision §3.3, Arch §3.2.2, Customer Journey §4.3). Ingestion
 * affordances (upload/paste/CSV + crawl + live-sync connectors) and the raw
 * knowledge view: each source with chunk preview, last-updated (+ last-synced
 * for live sources), manual re-sync, and delete. Deleting shows the "this will
 * affect your Luciel's answers" confirmation (Vision §3.3). Quota: 5 GB / 50 MB
 * per file, enforced client-side for a fast error and again by the backend.
 */
// A short paste or a tiny file rounds to "0.0 MB", which reads as empty/zero
// rather than small (Harmony fix FE-H#11). Anything under 0.1 MB (100 KB)
// says "<0.1 MB" instead of a number that implies nothing was added.
const fmtBytes = (n: number) => {
  const mb = n / 1_000_000;
  if (mb > 0 && mb < 0.1) return '<0.1 MB';
  return `${mb.toFixed(1)} MB`;
};

/** Quota figures are whatever the server says they are, so they must be shown
 *  that way rather than as the hardcoded 5 GB / 50 MB of the current plan. */
const fmtLimit = (n: number) =>
  n >= 1_000_000_000
    ? `${+(n / 1_000_000_000).toFixed(1)} GB`
    : `${+(n / 1_000_000).toFixed(1)} MB`;

const UPLOAD_ACCEPT = '.pdf,.docx,.txt,.csv';
/** Fallback only — the live limit comes from the quota endpoint. */
const PER_FILE_MAX_BYTES = 50_000_000;
/** Chunk preview shows the head of the source verbatim (Arch §3.2.2). */
const CHUNK_PREVIEW_LIMIT = 10;

/** Product labels for source origins — raw wire enums ("google_drive") are not
 * display copy; a de-snaked "google drive" still reads as an engineering leak.
 * Unmapped values fall back to de-snaking so a new origin degrades readably. */
const ORIGIN_LABEL: Record<string, string> = {
  upload: 'Uploaded file',
  paste: 'Pasted text',
  csv: 'CSV import',
  website_crawl: 'Website crawl',
  google_drive: 'Google Drive',
  notion: 'Notion',
  crm_kb: 'CRM knowledge base',
};
const originLabel = (origin: string): string => ORIGIN_LABEL[origin] ?? origin.replace(/_/g, ' ');

/** The live-sync connectors this pillar offers; availability comes from the registry. */
const SYNC_CONNECTORS: { provider: KnowledgeSyncProvider; label: string }[] = [
  { provider: 'google_drive', label: 'Google Drive' },
  { provider: 'notion', label: 'Notion' },
];

type Notice = {
  tone: 'info' | 'danger';
  text: string;
  /** Present right after a delete: the 30-day undo handle (Arch §3.2.2). */
  undo?: { sourceId: string; name: string };
  /** A refused shrink (F107): the owner may confirm the removals are real. */
  confirmShrink?: { connectionId: string };
};

/** Ingestion state per row (F098): a source that is still processing or failed
 *  must say so — a silent row reads as "ready" and it is not. */
const INGESTION_COPY: Record<string, string> = {
  pending: 'Processing…',
  error: 'Could not be processed — replace the file to try again',
};

const isShrinkRefusal = (err: unknown): boolean =>
  err instanceof LucielApiError &&
  err.code === 'conflict' &&
  /confirm the shrink/i.test(err.message);

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
  // Rights acknowledgement (2026-09-05 audit F099): crawling a site the owner has
  // no right to reuse is their liability, and the checkbox is where they say so.
  const [crawlRights, setCrawlRights] = React.useState(false);
  const [renaming, setRenaming] = React.useState<KnowledgeSource | null>(null);
  const [renameTo, setRenameTo] = React.useState('');
  const [replacing, setReplacing] = React.useState<KnowledgeSource | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>(null);

  // The same registry every other pillar reads (contract §1): a connector the
  // platform holds no OAuth app for is offered DISABLED with the reason, not as
  // a button that dead-ends on "Action needed" after the click.
  const syncProviders = useConnectionProviders('knowledge_source');
  const syncOption = (provider: KnowledgeSyncProvider) =>
    syncProviders.data
      ?.find((group) => group.connectionType === 'knowledge_source')
      ?.providers.find((option) => option.provider === provider);

  // A connected HubSpot / Salesforce CRM carries a knowledge base of its own
  // (crm_kb origin). With knowledge connections many-per-tenant (F092) the pillar
  // can finally offer it, next to Drive and Notion, for exactly the CRM in use.
  const connections = useConnections();
  const crmKbProvider = (connections.data ?? []).find(
    (c) =>
      c.connectionType === 'crm' &&
      c.status === 'connected' &&
      (c.provider === 'hubspot' || c.provider === 'salesforce'),
  )?.provider as 'hubspot' | 'salesforce' | undefined;

  const uploadRef = React.useRef<HTMLInputElement>(null);
  const csvRef = React.useRef<HTMLInputElement>(null);
  const replaceRef = React.useRef<HTMLInputElement>(null);
  const chunks = useChunks(viewing?.sourceId ?? null);
  const perFileMax = quota.data?.perFileMaxBytes ?? PER_FILE_MAX_BYTES;

  /** Runs one ingestion action, surfacing pending/success/error and refetching. */
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await fn();
      if (text) setNotice({ tone: 'info', text });
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

  /**
   * Every file gets its own verdict (F098): one bad file used to abort the batch
   * with a single error and leave the owner guessing which of the rest landed.
   */
  const ingestFiles = (files: FileList, kind: 'upload' | 'csv') =>
    run(async () => {
      const chosen = Array.from(files);
      const added: string[] = [];
      const failed: string[] = [];
      let lookupNote = '';
      for (const file of chosen) {
        if (file.size > perFileMax) {
          failed.push(
            `${file.name} (${fmtBytes(file.size)} — the limit is ${fmtBytes(perFileMax)} per file)`,
          );
          continue;
        }
        try {
          await ingestOne(
            file,
            kind === 'csv' || file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'upload',
          );
          added.push(file.name);
        } catch (err) {
          failed.push(
            `${file.name} (${err instanceof Error ? err.message : 'could not be added'})`,
          );
        }
      }
      if (kind === 'csv' && added.length) lookupNote = lookupNotes.join('');
      lookupNotes.length = 0;
      if (!added.length) {
        throw new Error(`Nothing was added. ${failed.join('; ')}`);
      }
      const summary = `Added ${added.length} of ${chosen.length} file${chosen.length > 1 ? 's' : ''} to your knowledge base.`;
      return failed.length
        ? `${summary} Not added: ${failed.join('; ')}.${lookupNote}`
        : `${summary}${lookupNote}`;
    });

  const lookupNotes: string[] = [];
  const ingestOne = async (file: File, kind: 'upload' | 'csv') => {
    if (kind === 'csv') {
      {
        {
          await api.knowledge.importCsv(file, file.name);
          // A CSV is ALSO the live-lookup table behind "Look up a record" — the
          // tools pillar sends owners here for exactly that, so the one import
          // must feed both (live-caught 2026-08-17: it previously fed only the
          // knowledge base and the lookup tool could never be wired at all).
          // Rows replace the previous table; a failure is said out loud, never
          // silently downgraded to knowledge-only success.
          lookupNotes.push(
            await api.connections
              .uploadRecordSourceCsv(file)
              .then((r) => ` Its ${r.records} rows are also on file for live record lookups.`)
              .catch(
                () =>
                  ' The knowledge copy was added, but the live-lookup table could not be ' +
                  'updated — import the CSV again to retry.',
              ),
          );
        }
      }
    } else {
      await api.knowledge.uploadFile(file, file.name);
    }
  };

  /**
   * The modal owns the outcome (F169): a failed paste used to close the dialog and
   * throw the text away with it. Now the request runs while the dialog is open,
   * a failure shows inside it with everything still typed, and only success
   * clears the fields.
   */
  const addPaste = async () => {
    const name = pasteName.trim();
    const text = pasteText.trim();
    await api.knowledge.pasteText({ name, text });
    setPasteOpen(false);
    setPasteName('');
    setPasteText('');
    setNotice({ tone: 'info', text: `Added “${name}” to your knowledge base.` });
    qc.invalidateQueries({ queryKey: qk.knowledge });
    qc.invalidateQueries({ queryKey: qk.quota });
  };

  const addCrawl = async () => {
    const url = crawlUrl.trim();
    // Creating the connection only registers the target; the first crawl is
    // what actually produces sources (Arch §3.2.3 — manual pull, no poller).
    const connection = await api.knowledge.startCrawl([url]);
    const result = await api.knowledge.syncConnection(connection.connectionId);
    setCrawlOpen(false);
    setCrawlUrl('');
    setCrawlRights(false);
    setNotice({
      tone: 'info',
      text: `Crawled ${url} — ${result.added.length} page(s) added. Linked pages on the same site are included, within limits.`,
    });
    qc.invalidateQueries({ queryKey: qk.knowledge });
    qc.invalidateQueries({ queryKey: qk.quota });
  };

  const renameSource = async () => {
    if (!renaming) return;
    const updated = await api.knowledge.renameSource(renaming.sourceId, renameTo.trim());
    setRenaming(null);
    setNotice({ tone: 'info', text: `Renamed to “${updated.name}”.` });
    qc.invalidateQueries({ queryKey: qk.knowledge });
  };

  const replaceFile = (source: KnowledgeSource, file: File) =>
    run(async () => {
      if (file.size > perFileMax) {
        throw new Error(
          `${file.name} is ${fmtBytes(file.size)} — the limit is ${fmtBytes(perFileMax)} per file.`,
        );
      }
      await api.knowledge.replaceSource(source.sourceId, file);
      return `Replaced “${source.name}” with ${file.name} — Luciel answers from the new file from now on.`;
    });

  /** A refused shrink (F107) becomes a decision, not a dead end. */
  const confirmShrink = (connectionId: string) =>
    run(async () => {
      const result = await api.knowledge.syncConnection(connectionId, { confirmShrink: true });
      return `Synced — ${result.removed.length} source(s) removed to match the source, ${result.added.length} added.`;
    });

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
      try {
        await api.knowledge.resyncSource(source.sourceId);
      } catch (err) {
        if (isShrinkRefusal(err) && source.connectionId) {
          setNotice({
            tone: 'danger',
            text: err instanceof Error ? err.message : 'The source shrank.',
            confirmShrink: { connectionId: source.connectionId },
          });
          return '';
        }
        throw err;
      }
      return `Re-synced “${source.name}”.`;
    });

  /**
   * Throws on failure on purpose. The audit suggested routing this through
   * `run()`, but `run()` reports into a Banner behind the dialog, so a failed
   * delete would still close the modal and read as a successful one; since P0-4
   * the Modal owns pending and error itself and stays open (P2-7).
   */
  const onDelete = async () => {
    if (!toDelete) return;
    const name = toDelete.name;
    const sourceId = toDelete.sourceId;
    await api.knowledge.deleteSource(sourceId);
    setToDelete(null);
    // A delete is a tombstone for 30 days (Arch §3.2.2): Luciel stops using the
    // source at once, and the owner can change their mind from this notice.
    setNotice({
      tone: 'info',
      text: `Deleted “${name}” — Luciel no longer answers from it. You can undo this for 30 days.`,
      undo: { sourceId, name },
    });
    qc.invalidateQueries({ queryKey: qk.knowledge });
    qc.invalidateQueries({ queryKey: qk.quota });
  };

  const onUndoDelete = (sourceId: string, name: string) =>
    run(async () => {
      await api.knowledge.restoreSource(sourceId);
      qc.invalidateQueries({ queryKey: qk.knowledge });
      qc.invalidateQueries({ queryKey: qk.quota });
      return `Restored “${name}” — Luciel is answering from it again.`;
    });

  return (
    <Card>
      <CardTitle>Knowledge base</CardTitle>
      <CardDescription>
        Upload anything you want your Luciel to know about — or drop files anywhere on this card.
      </CardDescription>
      <div
        data-testid="knowledge-dropzone"
        className={
          dragging
            ? 'mt-vm-3 rounded-vm-control border-2 border-dashed border-vm-accent p-vm-3 text-vm-1'
            : 'mt-vm-3 rounded-vm-control border-2 border-dashed border-vm-border p-vm-3 text-vm-1 text-vm-text-muted'
        }
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void ingestFiles(e.dataTransfer.files, 'upload');
        }}
      >
        {dragging ? 'Drop to add these files.' : 'Drag PDF, DOCX, TXT or CSV files here.'}
      </div>

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
        {crmKbProvider && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              connectProvider(
                crmKbProvider,
                crmKbProvider === 'hubspot'
                  ? 'HubSpot knowledge base'
                  : 'Salesforce knowledge base',
              )
            }
          >
            {crmKbProvider === 'hubspot'
              ? 'Sync HubSpot knowledge base'
              : 'Sync Salesforce knowledge base'}
          </Button>
        )}
        {SYNC_CONNECTORS.map(({ provider, label }) => {
          const option = syncOption(provider);
          const unavailable = option?.configured === false;
          return (
            <Button
              key={provider}
              variant="secondary"
              disabled={busy || unavailable}
              title={unavailable ? `${label} isn’t available yet.` : undefined}
              onClick={() => connectProvider(provider, label)}
            >
              {unavailable ? `${label} — not available yet` : `Connect ${label}`}
            </Button>
          );
        })}
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
      <input
        ref={replaceRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        aria-label="Replace file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && replacing) void replaceFile(replacing, file);
          setReplacing(null);
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
          {notice.undo && (
            <>
              {' '}
              <button
                type="button"
                className="underline"
                onClick={() => void onUndoDelete(notice.undo!.sourceId, notice.undo!.name)}
              >
                Undo
              </button>
            </>
          )}
          {notice.confirmShrink && (
            <>
              {' '}
              <button
                type="button"
                className="underline"
                onClick={() => void confirmShrink(notice.confirmShrink!.connectionId)}
              >
                Yes, remove them and sync
              </button>
            </>
          )}
        </Banner>
      )}

      {/* The meter is never hidden (F139): loading and failure are stated, never
          rendered as a blank that reads like "no limit". */}
      {quota.data ? (
        <ProgressBar
          className="mt-vm-4"
          value={quota.data.usedBytes}
          max={quota.data.totalBytes}
          label={`${fmtBytes(quota.data.usedBytes)} / ${fmtLimit(quota.data.totalBytes)} used (${fmtLimit(quota.data.perFileMaxBytes)} per file)`}
        />
      ) : quota.isError ? (
        <Banner tone="warning" className="mt-vm-4">
          Storage usage is unavailable right now — your limit still applies.{' '}
          <button type="button" className="underline" onClick={() => void quota.refetch()}>
            Try again
          </button>
        </Banner>
      ) : (
        <p className="mt-vm-4 text-vm-0 text-vm-text-muted" role="status">
          Checking storage usage…
        </p>
      )}

      {/* Raw knowledge view (Arch §3.2.2). */}
      <h4 className="mt-vm-5 text-vm-1 font-label">Your sources</h4>
      <ul className="mt-vm-2 divide-y divide-vm-border">
        {sources.data?.map((s) => (
          <li key={s.sourceId} className="flex items-center justify-between gap-vm-3 py-vm-3">
            <div className="min-w-0">
              <div className="truncate text-vm-2">{s.name}</div>
              <div className="text-vm-0 text-vm-text-muted">
                {originLabel(s.origin)} · {fmtBytes(s.sizeBytes)} ·{' '}
                {s.lastSyncedAt
                  ? `last synced ${new Date(s.lastSyncedAt).toLocaleDateString()}`
                  : `updated ${new Date(s.lastUpdatedAt).toLocaleDateString()}`}
                {INGESTION_COPY[s.ingestionStatus] && (
                  <>
                    {' · '}
                    <span className={s.ingestionStatus === 'error' ? 'text-vm-danger' : undefined}>
                      {INGESTION_COPY[s.ingestionStatus]}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-vm-2">
              {s.ingestionStatus === 'error' && <StatusChip kind="action_needed" />}
              {s.syncStatus && (
                <StatusChip
                  kind={
                    // Explicit per-state mapping: only the two known-healthy
                    // states may claim Connected. A sync status this build does
                    // not recognize is unknown, and unknown must never render
                    // as Connected (honest-states invariant) — it asks for
                    // attention instead.
                    s.syncStatus === 'paused_reconnect_needed'
                      ? 'reconnect_needed'
                      : s.syncStatus === 'synced' || s.syncStatus === 'syncing'
                        ? 'connected'
                        : 'action_needed'
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
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setRenaming(s);
                  setRenameTo(s.name);
                }}
              >
                Rename
              </Button>
              {!s.syncStatus && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setReplacing(s);
                    replaceRef.current?.click();
                  }}
                >
                  Replace file
                </Button>
              )}
              <Button variant="ghost" onClick={() => setToDelete(s)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
        {/* "Still loading", "we could not load" and "you have not added anything
            yet" are three different things; only the last invites an upload
            (P2-4). */}
        {!sources.data?.length &&
          (sources.isPending ? (
            <li className="py-vm-3 text-vm-1 text-vm-text-muted">
              <span role="status">Loading your sources…</span>
            </li>
          ) : sources.isError ? (
            <li className="py-vm-3">
              <Banner tone="danger">
                We could not load your knowledge sources, so this list is not shown rather than
                shown empty.{' '}
                <button className="underline" onClick={() => void sources.refetch()}>
                  Try again
                </button>
              </Banner>
            </li>
          ) : (
            <li className="py-vm-3 text-vm-1 text-vm-text-muted">
              Nothing here yet — upload a file, paste text, or crawl a page above, and your Luciel
              will start answering from it.
            </li>
          ))}
      </ul>

      {/* Scope selection for connected Drive/Notion sources (Decision #9). */}
      <KnowledgeScopeSections />

      <Modal
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Paste text"
        description="Paste anything you want Luciel to know — pricing, policies, FAQs."
        confirmLabel="Add to knowledge"
        confirmPendingLabel="Adding…"
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
        description="We fetch the page — and the pages it links to on the same site, within limits — and add what they say to your knowledge base. Sites that ask crawlers to stay out are respected."
        confirmLabel="Crawl this site"
        confirmPendingLabel="Crawling…"
        confirmDisabled={!/^https?:\/\/\S+$/.test(crawlUrl.trim()) || !crawlRights}
        onConfirm={addCrawl}
      >
        <label className="mb-vm-3 flex items-start gap-vm-2 text-vm-1">
          <input
            type="checkbox"
            checked={crawlRights}
            onChange={(e) => setCrawlRights(e.target.checked)}
          />
          <span>
            I own this website or have the right to reuse its content in my Luciel’s answers.
          </span>
        </label>
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
        open={Boolean(renaming)}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename this source"
        description="Only the name changes — what Luciel reads stays exactly the same."
        confirmLabel="Rename"
        confirmPendingLabel="Renaming…"
        confirmDisabled={!renameTo.trim()}
        onConfirm={renameSource}
      >
        <Field id="rename-source" label="Name">
          {(fieldProps) => (
            <Input {...fieldProps} value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
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
            This will affect the answers Luciel gives.{' '}
            {/* The §3.2.2 trust-contract number, real since C14: served from the
                durable retrieval trace, never a generic claim. */}
            {toDelete && toDelete.usedByQuestions7d > 0
              ? `${toDelete.usedByQuestions7d} customer ${
                  toDelete.usedByQuestions7d === 1 ? 'question' : 'questions'
                } in the last 7 days drew on this source.`
              : 'No customer questions in the last 7 days used this source.'}{' '}
            Editing or removing knowledge is how you keep Luciel accurate — but make sure you mean
            to.
          </>
        }
        confirmLabel="Delete source"
        confirmPendingLabel="Deleting…"
        confirmVariant="danger"
        onConfirm={onDelete}
      />
    </Card>
  );
}
