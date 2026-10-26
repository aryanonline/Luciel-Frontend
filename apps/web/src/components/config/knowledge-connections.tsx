'use client';

import * as React from 'react';
import { Banner, Button, Modal, StatusChip } from '@luciel/ui';
import { chipForConnection, LucielApiError, type Connection } from '@luciel/api-client';
import { api } from '@/lib/api';
import {
  qk,
  useConnectionLifecycle,
  useConnectionProviders,
  useConnections,
  useKnowledge,
} from '@/lib/hooks';
import { authorizeOrExplain } from '@/lib/oauth-connect';
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

/**
 * Round 7 — the asynchronous crawl: while any knowledge row's served job is still
 * `syncing`, the rows are re-read every {@link SYNC_POLL_MS}; otherwise not at all.
 */
export const knowledgeSyncRefetchInterval = (rows: Connection[] | undefined): number | false =>
  (rows ?? []).some((c) => isKnowledgeRow(c) && c.syncJob?.state === 'syncing')
    ? SYNC_POLL_MS
    : false;

const clock = (iso: string) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime())
    ? null
    : t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/** A poll that gave up (the job runs on server-side) is said as it is — not a failure. */
const stillSyncing = (err: unknown): err is LucielApiError =>
  err instanceof LucielApiError && err.code === 'service_unavailable';

const crawlUrls = (c: Connection): string[] => {
  const raw = c.nonSecretConfig?.crawl_urls;
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : [];
};

export function KnowledgeConnections() {
  const qc = useQueryClient();
  const connections = useConnections({ refetchInterval: knowledgeSyncRefetchInterval });
  const sources = useKnowledge();
  const providers = useConnectionProviders('knowledge_source');
  const { reconnect, disconnect } = useConnectionLifecycle();
  const { busy, notice, run } = useActionNotice();
  const [toDisconnect, setToDisconnect] = React.useState<Connection | null>(null);

  const rows = (connections.data ?? []).filter(isKnowledgeRow);

  // A job that leaves `syncing` changed what is synced: the sources and the quota are
  // re-read from the server (the row's own state already came with this read).
  const syncingIds = rows
    .filter((c) => c.syncJob?.state === 'syncing')
    .map((c) => c.connectionId)
    .join(',');
  const wasSyncing = React.useRef<string[]>([]);
  React.useEffect(() => {
    const now = syncingIds ? syncingIds.split(',') : [];
    const finished = wasSyncing.current.some((id) => !now.includes(id));
    wasSyncing.current = now;
    if (finished) {
      void qc.invalidateQueries({ queryKey: qk.knowledge });
      void qc.invalidateQueries({ queryKey: qk.quota });
    }
  }, [syncingIds, qc]);

  if (connections.isPending || rows.length === 0) return null;

  const nameOf = (c: Connection) => {
    const urls = crawlUrls(c);
    if (c.provider === 'website_crawl' && urls.length > 0) return urls.join(', ');
    return (
      c.displayName ??
      providers.data
        ?.find((g) => g.connectionType === 'knowledge_source')
        ?.providers.find((p) => p.provider === c.provider)?.displayName ??
      c.provider
    );
  };
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
  const resync = (c: Connection) =>
    void run(async () => {
      try {
        const result = await api.knowledge.syncConnection(c.connectionId);
        return `Synced ${nameOf(c)} — ${result.added.length} added, ${result.removed.length} removed.`;
      } catch (err) {
        // Still running server-side after the poll's limit: said as it is, and the row
        // keeps reading "Syncing…" from the server until it finishes.
        if (stillSyncing(err)) return err.message;
        throw err;
      } finally {
        await refreshServed();
      }
    }, 'We could not sync that source. Nothing was changed — please try again.');

  /** A served shrink_pending job (F107): the owner confirms the removals are real. */
  const confirmShrink = (c: Connection) =>
    void run(async () => {
      try {
        const result = await api.knowledge.syncConnection(c.connectionId, { confirmShrink: true });
        return `Synced — ${result.removed.length} source(s) removed to match the source, ${result.added.length} added.`;
      } catch (err) {
        if (stillSyncing(err)) return err.message;
        throw err;
      } finally {
        await refreshServed();
      }
    }, 'We could not sync that source. Nothing was changed — please try again.');

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
    const ok = await run(async () => {
      await disconnect.mutateAsync({ connectionId: c.connectionId });
      await qc.invalidateQueries({ queryKey: qk.knowledge });
      return c.provider === 'website_crawl'
        ? `${nameOf(c)} is no longer crawled. Its pages stay in your knowledge until you delete them below.`
        : `${nameOf(c)} is disconnected and its saved sign-in was deleted. Its synced pages stay until you delete them below.`;
    }, 'We could not disconnect that source. Nothing was changed — please try again.');
    if (ok) setToDisconnect(null);
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
      <ul className="mt-vm-3 divide-y divide-vm-border" aria-label="Connected sources">
        {rows.map((c) => {
          const chip = chipForConnection(c.status);
          const canReconnect = c.status === 'expired' || c.status === 'error';
          const job = c.syncJob;
          const syncing = job?.state === 'syncing';
          const started = syncing && job ? clock(job.startedAt) : null;
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
                  <div className="text-vm-0" role="status">
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
                    {job.error}{' '}
                    <button
                      type="button"
                      className="underline"
                      disabled={busy}
                      onClick={() => confirmShrink(c)}
                    >
                      Yes, remove them and sync
                    </button>
                  </div>
                )}
              </div>
              <StatusChip kind={chip} />
              {c.status === 'connected' && (
                <Button
                  variant="ghost"
                  disabled={busy || syncing}
                  aria-disabled={busy || syncing ? true : undefined}
                  onClick={() => {
                    if (!syncing) resync(c);
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
