'use client';

import * as React from 'react';
import { Banner, Button, Modal, StatusChip } from '@luciel/ui';
import type { Connection, KnowledgeScopeKind, ScopeSelection } from '@luciel/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk, useConnections } from '@/lib/hooks';

/**
 * Knowledge scope picker (Decision #9). Once a Google Drive / Notion sync
 * connection is CONNECTED, the owner chooses which folders (Drive) or pages and
 * databases (Notion) Luciel may read, instead of an all-access ingest.
 *
 * Two rules the copy here exists to honour:
 *  - `wholeAccount: true` is the DEFAULT and means the WHOLE account is read —
 *    never "nothing selected, so nothing is read".
 *  - a scope change takes effect on the NEXT sync, so the manual sync button is
 *    offered right beside it.
 * `scopeKind: null` means the provider has nothing to narrow → no picker at all.
 */

const scopeKey = (connectionId: string) => ['knowledgeScope', connectionId] as const;

const SCOPE_COPY: Record<
  KnowledgeScopeKind,
  { provider: string; heading: string; whole: string; pick: string; picker: string; note?: string }
> = {
  drive_folders: {
    provider: 'Google Drive',
    heading: 'What Luciel reads from Google Drive',
    whole: 'Luciel can read your whole Drive.',
    pick: 'Choose folders',
    picker: 'Choose the folders Luciel can read',
    note: 'Drive matches the files directly inside a folder you pick. A folder nested inside it is not included unless you pick that one too.',
  },
  notion_pages: {
    provider: 'Notion',
    heading: 'What Luciel reads from Notion',
    whole: 'Luciel can read your whole Notion workspace.',
    pick: 'Choose pages',
    picker: 'Choose the pages and databases Luciel can read',
  },
};

type Notice = { tone: 'info' | 'danger'; text: string };

const message = (err: unknown) =>
  err instanceof Error ? err.message : 'That did not work. Please try again.';

/** One scope card per connected knowledge source that supports a scope. */
export function KnowledgeScopeSections() {
  const connections = useConnections();
  const sources = (connections.data ?? []).filter(
    (c) => c.connectionType === 'knowledge_source' && c.status === 'connected',
  );

  return (
    <>
      {sources.map((c) => (
        <ScopeSection key={c.connectionId} connection={c} />
      ))}
    </>
  );
}

function ScopeSection({ connection }: { connection: Connection }) {
  const connectionId = connection.connectionId;
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<Record<string, string>>({});
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [busy, setBusy] = React.useState(false);

  const scope = useQuery({
    queryKey: scopeKey(connectionId),
    queryFn: () => api.knowledge.getScope(connectionId),
  });
  // Candidates are a live provider call, so only fetch while the picker is open.
  const candidates = useQuery({
    queryKey: [...scopeKey(connectionId), 'candidates'],
    queryFn: () => api.knowledge.listScopeCandidates(connectionId),
    enabled: pickerOpen,
    retry: false,
  });

  const current = scope.data;
  const kind = current?.scopeKind ?? null;

  const openPicker = () => {
    setNotice(null);
    setPicked(
      Object.fromEntries((current?.selections ?? []).map((s) => [s.id, s.name ?? s.id])),
    );
    setPickerOpen(true);
  };

  const save = async (selections: ScopeSelection[]) => {
    setBusy(true);
    setNotice(null);
    try {
      await api.knowledge.saveScope(connectionId, selections);
      await qc.invalidateQueries({ queryKey: scopeKey(connectionId) });
      setNotice({
        tone: 'info',
        text: selections.length
          ? 'Saved. Applies from the next sync — anything now out of scope is retired by that sync.'
          : 'Saved — Luciel can read the whole account again. Applies from the next sync.',
      });
    } catch (err) {
      setNotice({ tone: 'danger', text: message(err) });
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await api.knowledge.syncConnection(connectionId);
      qc.invalidateQueries({ queryKey: qk.knowledge });
      qc.invalidateQueries({ queryKey: qk.quota });
      setNotice({ tone: 'info', text: 'Synced — Luciel now reads exactly what you picked.' });
    } catch (err) {
      setNotice({ tone: 'danger', text: message(err) });
    } finally {
      setBusy(false);
    }
  };

  // Providers with no selectable scope get no picker at all (contract §4).
  if (!current || !kind) return null;
  const copy = SCOPE_COPY[kind];

  return (
    <div className="mt-vm-4 rounded-vm-card border border-vm-border p-vm-4">
      <div className="flex flex-wrap items-center justify-between gap-vm-3">
        <span className="text-vm-2 font-label">{copy.heading}</span>
        <StatusChip kind="connected" />
      </div>

      {current.wholeAccount ? (
        <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
          {copy.whole} Narrow it below if you only want part of it used for answers.
        </p>
      ) : (
        <div className="mt-vm-2">
          <p className="text-vm-1 text-vm-text-muted">Luciel reads only these:</p>
          <ul className="mt-vm-2 flex flex-wrap gap-vm-2">
            {current.selections.map((s) => (
              <li
                key={s.id}
                className="rounded-vm-pill border border-vm-border bg-vm-surface px-vm-3 py-vm-1 text-vm-0"
              >
                {s.name ?? s.id}
              </li>
            ))}
          </ul>
        </div>
      )}

      {copy.note && <p className="mt-vm-2 text-vm-0 text-vm-text-muted">{copy.note}</p>}

      <div className="mt-vm-3 flex flex-wrap gap-vm-2">
        <Button variant="secondary" disabled={busy} onClick={openPicker}>
          {copy.pick}
        </Button>
        {!current.wholeAccount && (
          <Button variant="ghost" disabled={busy} onClick={() => void save([])}>
            Let Luciel read everything again
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => void syncNow()}>
          Sync now
        </Button>
      </div>

      {busy && (
        <p className="mt-vm-2 text-vm-1 text-vm-text-muted" role="status">
          Working on it…
        </p>
      )}

      {notice && (
        <Banner tone={notice.tone} className="mt-vm-3">
          {notice.text}
        </Banner>
      )}

      <Modal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={copy.picker}
        description="Pick nothing to leave the whole account readable. This applies from the next sync."
        confirmLabel="Save selection"
        confirmDisabled={busy || candidates.isLoading || Boolean(candidates.error)}
        onConfirm={() => {
          setPickerOpen(false);
          void save(Object.entries(picked).map(([id, name]) => ({ id, name })));
        }}
      >
        {candidates.isLoading ? (
          <p className="text-vm-1 text-vm-text-muted" role="status">
            Asking {copy.provider} what you can pick…
          </p>
        ) : candidates.error ? (
          // A 409 carries the real reason (no token yet, provider unreachable,
          // nothing to narrow) — show it rather than "no folders found".
          <Banner tone="danger">{message(candidates.error)}</Banner>
        ) : !candidates.data?.length ? (
          <p className="text-vm-1 text-vm-text-muted">
            We did not get any choices back just now. Your scope is unchanged — try again in a
            moment.
          </p>
        ) : (
          <ul className="max-h-80 space-y-vm-2 overflow-y-auto">
            {candidates.data.map((c) => (
              <li key={c.id}>
                <label className="flex items-start gap-vm-2 text-vm-1">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={c.id in picked}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const next = { ...prev };
                        if (e.target.checked) next[c.id] = c.name;
                        else delete next[c.id];
                        return next;
                      })
                    }
                  />
                  <span>
                    {c.name} <span className="text-vm-text-muted">({c.kind})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
