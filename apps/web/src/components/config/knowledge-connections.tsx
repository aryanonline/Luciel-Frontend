'use client';

import * as React from 'react';
import { Banner, Button, Modal, StatusChip } from '@luciel/ui';
import { chipForConnection, type Connection } from '@luciel/api-client';
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

const crawlUrls = (c: Connection): string[] => {
  const raw = c.nonSecretConfig?.crawl_urls;
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : [];
};

export function KnowledgeConnections() {
  const qc = useQueryClient();
  const connections = useConnections();
  const sources = useKnowledge();
  const providers = useConnectionProviders('knowledge_source');
  const { reconnect, disconnect } = useConnectionLifecycle();
  const { busy, notice, run } = useActionNotice();
  const [toDisconnect, setToDisconnect] = React.useState<Connection | null>(null);

  const rows = (connections.data ?? []).filter(
    (c) => c.connectionType === 'knowledge_source' && c.status !== 'revoked',
  );
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

  const resync = (c: Connection) =>
    void run(async () => {
      const result = await api.knowledge.syncConnection(c.connectionId);
      await qc.invalidateQueries({ queryKey: qk.knowledge });
      return `Synced ${nameOf(c)} — ${result.added.length} added, ${result.removed.length} removed.`;
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
              </div>
              <StatusChip kind={chip} />
              {c.status === 'connected' && (
                <Button variant="ghost" disabled={busy} onClick={() => resync(c)}>
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
