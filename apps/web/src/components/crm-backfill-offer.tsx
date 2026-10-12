'use client';

import * as React from 'react';
import { Banner, Button } from '@luciel/ui';
import { LucielApiError } from '@luciel/api-client';
import type { CrmBackfillResult } from '@luciel/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useConnections, useLeads, qk } from '@/lib/hooks';
import { isBackfillCandidate } from '@/lib/crm-detail';

/**
 * The one-time "Send your N earlier leads to <CRM>?" offer (round 7 WP-3c item 5;
 * POST /dashboard/leads/crm-backfill).
 *
 * Shown once a CRM connection is `connected` and the leads list carries leads
 * nothing ever pushed under the current posture (never-attempted, non-archived —
 * the backend's own candidate set). The count and the CRM's name are served; the
 * backend pushes one bounded batch per call and says how many remain, so the
 * result offers the next batch instead of pretending the first was all of them.
 *
 * "One-time" is per CRM connection: a dismissed or completed offer is remembered
 * in this browser (a per-viewer convenience, so a refresh does not re-ask). The
 * offer also disappears on its own once the list carries no candidates — the
 * served state, not the memory, is what decides it.
 *
 * Mounted where a CRM becomes connected (the Configure screen: consent landing,
 * tools pillar) and on the Leads page itself.
 */

const STORAGE_PREFIX = 'luciel.crm-backfill-offer:';

function remembered(connectionId: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + connectionId) !== null;
  } catch {
    return false;
  }
}

function remember(connectionId: string, outcome: 'dismissed' | 'done') {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + connectionId, outcome);
  } catch {
    /* private window / blocked storage: the offer simply shows again next time */
  }
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function CrmBackfillOffer() {
  const connections = useConnections();
  const leads = useLeads();
  const qc = useQueryClient();
  const [hidden, setHidden] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<CrmBackfillResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const crm = connections.data?.find((c) => c.connectionType === 'crm' && c.status === 'connected');
  const candidates = (leads.data ?? []).filter(isBackfillCandidate);
  const noKey = candidates.filter((l) => l.crmDetail === 'no_crm_key').length;

  // Nothing to offer until BOTH reads have settled with a connected CRM and
  // candidates; a loading or failed read is not "no earlier leads".
  if (!crm || hidden === crm.connectionId) return null;
  if (result === null && (candidates.length === 0 || remembered(crm.connectionId))) return null;

  const crmName = crm.displayName ?? crm.provider;

  const run = async () => {
    setPending(true);
    setError(null);
    try {
      const outcome = await api.leads.backfillCrm();
      setResult(outcome);
      if (outcome.remaining === 0 && outcome.refusedReason == null) {
        remember(crm.connectionId, 'done');
      }
      await qc.invalidateQueries({ queryKey: qk.leads });
    } catch (err) {
      setError(
        err instanceof LucielApiError && err.code === 'conflict'
          ? `Nothing was sent: ${err.message}`
          : 'We could not send your leads just now. Nothing changed — please try again.',
      );
    } finally {
      setPending(false);
    }
  };

  const dismiss = () => {
    remember(crm.connectionId, result && result.remaining === 0 ? 'done' : 'dismissed');
    setHidden(crm.connectionId);
  };

  if (result) {
    const parts: string[] = [];
    parts.push(`${plural(result.synced, 'lead is', 'leads are')} now in ${crmName}`);
    if (result.failed > 0) {
      parts.push(
        `${plural(result.failed, 'push', 'pushes')} failed — each row on the Leads page says why and offers a retry`,
      );
    }
    if (result.skippedNoKey > 0) {
      parts.push(
        `${result.skippedNoKey} skipped because they have no email address ${crmName} accepts`,
      );
    }
    return (
      <Banner tone={result.refusedReason ? 'warning' : 'info'} onDismiss={dismiss}>
        {result.refusedReason ? (
          <>
            {crmName} refused before anything was sent ({result.refusedReason.replace(/_/g, ' ')}
            ). Nothing changed.
          </>
        ) : (
          <>{parts.join('; ')}.</>
        )}
        {result.remaining > 0 && (
          <>
            {' '}
            {plural(result.remaining, 'lead', 'leads')} still to send.{' '}
            <Button variant="ghost" disabled={pending} onClick={() => void run()}>
              {pending ? 'Sending…' : `Send the next ${result.remaining}`}
            </Button>
          </>
        )}
        {error && <div className="mt-vm-2 text-vm-danger">{error}</div>}
      </Banner>
    );
  }

  return (
    <Banner tone="info" onDismiss={dismiss}>
      <span className="font-label">
        Send your {plural(candidates.length, 'earlier lead', 'earlier leads')} to {crmName}?
      </span>{' '}
      {candidates.length === 1 ? 'It was' : 'They were'} captured before {crmName} was connected,
      so {candidates.length === 1 ? 'it is' : 'they are'} not in it yet. Sending is one-time and
      safe to repeat: a lead already in {crmName} is updated, never duplicated.
      {noKey > 0 && (
        <>
          {' '}
          {plural(noKey, 'of them has', 'of them have')} no email address {crmName} accepts and will
          be skipped.
        </>
      )}
      <div className="mt-vm-2 flex flex-wrap items-center gap-vm-2">
        <Button variant="primary" disabled={pending} onClick={() => void run()}>
          {pending ? 'Sending…' : `Send ${candidates.length} to ${crmName}`}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={dismiss}>
          Not now
        </Button>
      </div>
      {error && (
        <div className="mt-vm-2 text-vm-danger" role="alert">
          {error}
        </div>
      )}
    </Banner>
  );
}
