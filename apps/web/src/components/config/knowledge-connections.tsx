'use client';

import * as React from 'react';
import { Banner, Button, Modal, StatusChip } from '@luciel/ui';
import {
  chipForConnection,
  type Connection,
  type ConnectionProviders,
  type KnowledgeSyncJob,
  type KnowledgeSyncResult,
} from '@luciel/api-client';
import { api } from '@/lib/api';
import {
  qk,
  useConnectionLifecycle,
  useConnectionProviders,
  useConnections,
  useKnowledge,
} from '@/lib/hooks';
import { authorizeOrExplain } from '@/lib/oauth-connect';
import { syncUntilAnswered } from '@/lib/sync-action';
import { useActionNotice } from '@/lib/use-action-notice';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Connected sources (round 6 WP-D): every knowledge connection — a crawled site,
 * a Drive, a Notion workspace, a CRM knowledge base — listed with its state and
 * the last time it synced, and each one re-syncable, reconnectable and
 * disconnectable from here. Before this the pillar minted rows silently and the
 * owner had no list to take one away from.
 */

/** How often the rows are re-read while a knowledge sync is still running. */
export const SYNC_POLL_MS = 2000;

const isKnowledgeRow = (c: Connection) =>
  c.connectionType === 'knowledge_source' && c.status !== 'revoked';

/** A removed source has no job to speak of: the sync stopped with it. */
const servedJob = (c: Connection) => (c.status === 'not_connected' ? null : c.syncJob);

/**
 * Round 7 — the asynchronous crawl: while any knowledge row's served job is still
 * `syncing`, the rows are re-read every {@link SYNC_POLL_MS}; otherwise not at all.
 */
export const knowledgeSyncRefetchInterval = (rows: Connection[] | undefined): number | false =>
  (rows ?? []).some((c) => isKnowledgeRow(c) && servedJob(c)?.state === 'syncing')
    ? SYNC_POLL_MS
    : false;

const clock = (iso: string) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime())
    ? null
    : t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const crawlUrls = (c: Connection): string[] => {
  const raw = c.nonSecretConfig?.crawl_urls;
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : [];
};

const rowName = (c: Connection, groups: ConnectionProviders[] | undefined) => {
  const urls = crawlUrls(c);
  if (c.provider === 'website_crawl' && urls.length > 0) return urls.join(', ');
  return (
    c.displayName ??
    groups
      ?.find((g) => g.connectionType === 'knowledge_source')
      ?.providers.find((p) => p.provider === c.provider)?.displayName ??
    c.provider
  );
};

/** The sentence of a served shrink_pending, even when the server sent no text. */
const shrinkSentence = (job: KnowledgeSyncJob) => {
  if (job.error) return job.error;
  if (job.shrink) {
    return `The source now reports ${job.shrink.remote} item(s) where ${job.shrink.existing} are synced, so nothing was removed. If you did remove them at the source, sync again and confirm the shrink.`;
  }
  return 'The source shrank, so nothing was removed. If you did remove those items at the source, confirm it here.';
};

/** What a screen reader hears when a row's job leaves `syncing`. */
const announcement = (name: string, job: KnowledgeSyncJob | null | undefined) => {
  if (job?.state === 'synced') {
    const r = job.result;
    return r
      ? `Finished syncing ${name} — ${r.added?.length ?? 0} added, ${r.updated?.length ?? 0} updated, ${r.removed?.length ?? 0} removed.`
      : `Finished syncing ${name}.`;
  }
  if (job?.state === 'failed') {
    return `The sync of ${name} failed: ${job.error || 'it did not finish.'}`;
  }
  if (job?.state === 'shrink_pending') {
    return `The sync of ${name} stopped: ${shrinkSentence(job)}`;
  }
  return '';
};

export function KnowledgeConnections() {
  const qc = useQueryClient();
  const connections = useConnections({ refetchInterval: knowledgeSyncRefetchInterval });
  const sources = useKnowledge();
  const providers = useConnectionProviders('knowledge_source');
  const { reconnect, disconnect } = useConnectionLifecycle();
  const { busy, notice, setNotice, run } = useActionNotice();
  const [toDisconnect, setToDisconnect] = React.useState<Connection | null>(null);
  const [announced, setAnnounced] = React.useState('');
  /** Sources this tab removed: their stopped sync must not talk over "no longer crawled". */
  const removedHere = React.useRef(new Set<string>());

  const rows = (connections.data ?? []).filter(isKnowledgeRow);

  // A job that leaves `syncing` changed what is synced: the sources, the quota and the
  // employee's status are re-read from the server (the row's own state already came with
  // this read), and the one live region of this list says how it ended.
  const served = connections.data;
  const groups = providers.data;
  const wasSyncing = React.useRef<string[]>([]);
  React.useEffect(() => {
    const knowledge = (served ?? []).filter(isKnowledgeRow);
    // A row the list no longer serves left `syncing` too: a revoked or quiescing source
    // drops out of the list, and a cleared cache (Log out) serves no rows at all while
    // this tree is still mounted.
    const left = wasSyncing.current.filter((id) => {
      const row = knowledge.find((c) => c.connectionId === id);
      return !row || servedJob(row)?.state !== 'syncing';
    });
    wasSyncing.current = knowledge
      .filter((c) => servedJob(c)?.state === 'syncing')
      .map((c) => c.connectionId);
    if (left.length === 0) return;
    void qc.invalidateQueries({ queryKey: qk.knowledge });
    void qc.invalidateQueries({ queryKey: qk.quota });
    void qc.invalidateQueries({ queryKey: qk.employeeStatus });
    const said = knowledge
      .filter((c) => left.includes(c.connectionId))
      .map((c) => announcement(rowName(c, groups), servedJob(c)))
      .filter(Boolean);
    if (said.length > 0) setAnnounced(said.join(' '));
  }, [served, groups, qc]);

  if (connections.isPending || rows.length === 0) return null;

  const nameOf = (c: Connection) => rowName(c, groups);
  const lastSynced = (c: Connection) => {
    const stamps = (sources.data ?? [])
      .filter((s) => s.connectionId === c.connectionId && s.lastSyncedAt)
      .map((s) => new Date(s.lastSyncedAt as string).getTime())
      .filter((t) => !Number.isNaN(t));
    if (stamps.length === 0) return 'never';
    return new Date(Math.max(...stamps)).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };
  const countOf = (c: Connection) =>
    (sources.data ?? []).filter((s) => s.connectionId === c.connectionId).length;

  /**
   * Round 7 WP-4c #7: a manual sync on a grant the provider revoked now pauses the
   * sources and marks the connection broken BEFORE the 409. Success or failure, the
   * row's chip is re-read from the server — the "Connected" it showed a moment ago
   * may be the very claim the failure just retired. No local green.
   */
  const refreshServed = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.knowledge }),
      qc.invalidateQueries({ queryKey: qk.connections }),
      qc.invalidateQueries({ queryKey: qk.employeeStatus }),
    ]);
  const SYNC_FAILED = 'We could not sync that source. Nothing was changed — please try again.';
  /**
   * `busy` holds only until the POST answers. On a 202 the row reads the served job (the
   * re-read below starts the 2 s refetch) and the toast comes when the sync ends.
   */
  const syncRow = (
    c: Connection,
    success: (result: KnowledgeSyncResult) => string,
    opts?: { confirmShrink: boolean },
  ) => {
    removedHere.current.delete(c.connectionId);
    void run(
      () =>
        syncUntilAnswered({
          start: (onStarted) =>
            api.knowledge.syncConnection(c.connectionId, { ...opts, onStarted }),
          onStarted: () => void qc.invalidateQueries({ queryKey: qk.connections }),
          success,
          refresh: refreshServed,
          report: ({ tone, text, removed }) => {
            if (removed && removedHere.current.has(c.connectionId)) return;
            setNotice({ tone, text });
          },
          fallbackError: SYNC_FAILED,
        }),
      SYNC_FAILED,
    );
  };
  const resync = (c: Connection) =>
    syncRow(
      c,
      (result) =>
        `Synced ${nameOf(c)} — ${result.added.length} added, ${result.removed.length} removed.`,
    );

  /** A served shrink_pending job (F107): the owner confirms the removals are real. */
  const confirmShrink = (c: Connection) =>
    syncRow(
      c,
      (result) =>
        `Synced — ${result.removed.length} source(s) removed to match the source, ${result.added.length} added.`,
      { confirmShrink: true },
    );

  const reconnectRow = (c: Connection) =>
    void run(async () => {
      const start = await reconnect.mutateAsync({ connectionId: c.connectionId });
      return (
        authorizeOrExplain({
          ...start,
          provider: c.provider,
          label: nameOf(c),
          connectionId: c.connectionId,
          callbackKind: 'connection',
        }) ?? `Taking you to ${nameOf(c)} to sign in again…`
      );
    }, 'We could not start the reconnect. Please try again.');

  const confirmDisconnect = async () => {
    if (!toDisconnect) return;
    const c = toDisconnect;
    // Marked before the call: the poll may read the removal before this answer lands.
    removedHere.current.add(c.connectionId);
    const ok = await run(async () => {
      await disconnect.mutateAsync({ connectionId: c.connectionId });
      await qc.invalidateQueries({ queryKey: qk.knowledge });
      return c.provider === 'website_crawl'
        ? `${nameOf(c)} is no longer crawled. Its pages stay in your knowledge until you delete them below.`
        : `${nameOf(c)} is disconnected and its saved sign-in was deleted. Its synced pages stay until you delete them below.`;
    }, 'We could not disconnect that source. Nothing was changed — please try again.');
    if (ok) setToDisconnect(null);
    else removedHere.current.delete(c.connectionId);
  };

  return (
    <div className="mt-vm-5">
      <h3 className="text-vm-2 font-label">Connected sources</h3>
      <p className="mt-vm-1 text-vm-1 text-vm-text-muted">
        Where Luciel keeps pulling knowledge from. Re-sync, reconnect, or take one away here.
      </p>
      {notice && (
        <Banner tone={notice.tone} className="mt-vm-3">
          {notice.text}
        </Banner>
      )}
      {/* Always mounted, so a screen reader hears the text change. */}
      <div role="status" className="sr-only" data-testid="knowledge-sync-announcer">
        {announced}
      </div>
      <ul className="mt-vm-3 divide-y divide-vm-border" aria-label="Connected sources">
        {rows.map((c) => {
          const chip = chipForConnection(c.status);
          const canReconnect = c.status === 'expired' || c.status === 'error';
          const job = servedJob(c);
          const syncing = job?.state === 'syncing';
          const started = syncing && job ? clock(job.startedAt) : null;
          const syncLineId = `knowledge-sync-${c.connectionId}`;
          const resyncHeld = busy || syncing;
          return (
            <li key={c.connectionId} className="flex flex-wrap items-center gap-vm-3 py-vm-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-vm-1">{nameOf(c)}</div>
                <div className="text-vm-0 text-vm-text-muted">
                  {countOf(c)} source{countOf(c) === 1 ? '' : 's'} · last synced {lastSynced(c)}
                  {c.provider !== 'website_crawl' && c.status === 'connected'
                    ? ' · scope below'
                    : ''}
                </div>
                {/* The served job (round 7 — the asynchronous crawl). The last-synced
                    time above is never erased by a running or failed job. */}
                {syncing && (
                  <div className="text-vm-0" id={syncLineId}>
                    {c.provider === 'website_crawl' ? 'Crawling…' : 'Syncing…'}
                    {started ? ` started ${started}` : ''}
                  </div>
                )}
                {job?.state === 'failed' && (
                  <div className="text-vm-0 text-vm-danger">
                    Last sync failed: {job.error || 'it did not finish.'}
                  </div>
                )}
                {job?.state === 'shrink_pending' && (
                  <div className="text-vm-0 text-vm-danger">
                    {shrinkSentence(job)}
                    {c.status === 'connected' && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="underline"
                          disabled={busy}
                          onClick={() => confirmShrink(c)}
                        >
                          Yes, remove them and sync
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <StatusChip kind={chip} />
              {c.status === 'connected' && (
                // Held with aria-disabled, never native disabled: the button stays in the
                // tab order and says why, through the "Crawling…" line.
                <Button
                  variant="ghost"
                  aria-disabled={resyncHeld ? true : undefined}
                  aria-describedby={syncing ? syncLineId : undefined}
                  className={resyncHeld ? 'cursor-not-allowed opacity-50' : undefined}
                  onClick={() => {
                    if (!resyncHeld) resync(c);
                  }}
                >
                  Re-sync
                </Button>
              )}
              {canReconnect && (
                <Button variant="ghost" disabled={busy} onClick={() => reconnectRow(c)}>
                  Reconnect
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => setToDisconnect(c)}>
                {c.provider === 'website_crawl' ? 'Remove crawl' : 'Disconnect'}
              </Button>
            </li>
          );
        })}
      </ul>
      <Modal
        open={toDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setToDisconnect(null);
        }}
        title={
          toDisconnect?.provider === 'website_crawl'
            ? `Stop crawling ${toDisconnect ? nameOf(toDisconnect) : ''}?`
            : `Disconnect ${toDisconnect ? nameOf(toDisconnect) : ''}?`
        }
        description="The pages already synced stay in your knowledge until you delete them. Nothing new is pulled from this source afterwards."
        confirmLabel={toDisconnect?.provider === 'website_crawl' ? 'Remove crawl' : 'Disconnect'}
        confirmPendingLabel="Working…"
        confirmVariant="danger"
        onConfirm={confirmDisconnect}
      >
        <p className="text-vm-1">You can connect it again later from the options above.</p>
      </Modal>
    </div>
  );
}
