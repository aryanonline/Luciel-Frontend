import { KNOWLEDGE_PAUSED_SERVING_DAYS, type KnowledgeSource } from '@luciel/api-client';

/**
 * What a source paused for reconnect is doing RIGHT NOW (round 7 WP-4c #5, owner
 * decision D10): a revoked/expired grant pauses its sources, they keep answering for
 * seven days from `pausedSince` (knowledge/service.py `stops_serving_at`), then stop
 * until the connection is reconnected. Without a served `pausedSince` (the backend
 * at 5de5cf6 does not serve it yet) no date is claimed — only "paused".
 */
export type PausedServing =
  | { kind: 'not_paused' }
  | { kind: 'paused_undated' }
  | { kind: 'still_answering'; stopsOn: Date }
  | { kind: 'stopped'; stoppedOn: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

export function pausedServing(source: KnowledgeSource, now: Date = new Date()): PausedServing {
  if (source.syncStatus !== 'paused_reconnect_needed') return { kind: 'not_paused' };
  const since = source.pausedSince ? new Date(source.pausedSince) : null;
  if (!since || Number.isNaN(since.getTime())) return { kind: 'paused_undated' };
  const stops = new Date(since.getTime() + KNOWLEDGE_PAUSED_SERVING_DAYS * DAY_MS);
  return now < stops
    ? { kind: 'still_answering', stopsOn: stops }
    : { kind: 'stopped', stoppedOn: stops };
}

export function pausedServingCopy(state: PausedServing): string | null {
  const day = (d: Date) => d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  switch (state.kind) {
    case 'still_answering':
      return `Paused — reconnect needed. Luciel still answers from it; it stops answering on ${day(state.stopsOn)}.`;
    case 'stopped':
      return 'No longer answering — reconnect to resume.';
    case 'paused_undated':
      return 'Paused — reconnect needed. It stops answering 7 days after the pause unless you reconnect.';
    default:
      return null;
  }
}
