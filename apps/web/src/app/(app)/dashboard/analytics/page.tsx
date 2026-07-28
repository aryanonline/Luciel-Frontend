'use client';

import * as React from 'react';
import { Banner, Card, CardTitle, CardDescription, Button, PageHeader } from '@luciel/ui';
import { useAnalytics } from '@/lib/hooks';
import type { AnalyticsOverview } from '@luciel/api-client';

/**
 * Local, additive widening of the shared `AnalyticsOverview` type for fields
 * this build adds to the backend response (app/schemas_api/usage.py) ahead of
 * the shared `packages/api-client` schema (schemas/analytics.ts) being updated
 * to match — that package is outside this workstream's file ownership
 * (BUILD_BRIEF.md), so the wider shape is declared locally here only. Every
 * new field is optional so this stays backward-compatible with the current
 * mock adapter (which does not seed them yet) and forward-compatible once the
 * shared schema is widened to make them non-optional.
 */
type AnalyticsOverviewExtended = Omit<
  AnalyticsOverview,
  'appointmentsBooked' | 'responseTimeP50Seconds' | 'responseTimeP95Seconds'
> & {
  // Overridden as nullable: honest gap (null + a note) instead of a fabricated
  // 0 when no durable store exists yet (see app/analytics/service.py).
  appointmentsBooked?: number | null;
  appointmentsBookedNote?: string | null;
  responseTimeP50Seconds?: number | null;
  responseTimeP95Seconds?: number | null;
  responseTimeNote?: string | null;
  topKnowledgeSources?: { sourceId: string; name: string; retrievalCount: number }[];
  topKnowledgeSourcesNote?: string | null;
  conversionByChannel?: {
    channel: string;
    conversations: number;
    leads: number;
    conversionRate: number;
  }[];
  conversionBySourceNote?: string | null;
  conversionByServiceNote?: string | null;
};

/**
 * Analytics (Arch §3.9). Aggregates only — no new PII, tenant-scoped. Surfaces:
 * conversations, leads, escalations-by-signal, response-time p50/p95,
 * appointments booked, channel mix, budget utilization, busiest-times heatmap,
 * top knowledge sources, conversion by channel, CSV export (Vision §7).
 *
 * Honest empty states: appointments-booked, response-time p50/p95, and top
 * knowledge sources have no durable store yet on the backend (see
 * app/analytics/service.py's module docstring) — the API returns null/[] plus
 * a `*Note` string explaining why, and this page renders that note instead of
 * a fabricated 0. All new fields are read defensively (optional chaining +
 * fallbacks) because the shared mock adapter (packages/api-client, outside
 * this workstream's ownership per BUILD_BRIEF.md) may not yet seed them.
 */
const signalLabel: Record<string, string> = {
  explicit_human_request: 'Human requested',
  strong_negative_sentiment: 'Negative sentiment',
  cannot_answer: "Couldn't answer",
  high_value_lead: 'High-value lead',
  budget_exhausted: 'Budget exhausted',
  llm_unavailable: 'LLM unavailable',
};

const dayLabel = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// The backend's public base URL (non-secret — same env var api.ts reads for the
// http adapter). Used only for the CSV download, which is a raw file stream,
// not a typed JSON call through the shared api-client interface.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

async function downloadAnalyticsCsv(view: string) {
  const res = await fetch(`${API_BASE_URL}/api/v1/admin/usage/export.csv?view=${view}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Analytics CSV export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `analytics_${view}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const { data: raw, isLoading } = useAnalytics();
  const a = raw as AnalyticsOverviewExtended | undefined;
  const [exportError, setExportError] = React.useState<string | null>(null);

  const exportCsv = (view: string) => {
    setExportError(null);
    downloadAnalyticsCsv(view).catch(() =>
      setExportError('We could not download that CSV just now. Please try again.'),
    );
  };

  return (
    <div className="space-y-vm-5">
      <PageHeader
        title="Analytics"
        description="Aggregates only, scoped to your account. No individual customer data is exposed here."
        actions={
          <Button variant="secondary" onClick={() => exportCsv('overview')}>
            Export CSV
          </Button>
        }
      />

      {exportError && <Banner tone="danger">{exportError}</Banner>}

      {isLoading || !a ? (
        <p className="text-vm-1 text-vm-text-muted" role="status">
          Loading…
        </p>
      ) : (
        <>
          <div className="grid gap-vm-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Conversations (period)" value={a.conversationsThisPeriod} />
            <Stat label="Leads (period)" value={a.leadsThisPeriod} />
            <Stat
              label="Appointments booked"
              value={a.appointmentsBooked ?? 'Not yet available'}
              note={a.appointmentsBookedNote}
            />
            <Stat
              label="Response time p50 / p95"
              value={
                a.responseTimeP50Seconds != null && a.responseTimeP95Seconds != null
                  ? `${a.responseTimeP50Seconds}s / ${a.responseTimeP95Seconds}s`
                  : 'Not yet available'
              }
              note={a.responseTimeNote}
            />
          </div>

          <Card>
            <CardTitle>Escalations by signal</CardTitle>
            <CardDescription>
              The four signals are fixed; this is how often each fired.
            </CardDescription>
            <ul className="mt-vm-3 space-y-vm-2">
              {a.escalationsBySignal.map((s) => (
                <li key={s.signal} className="flex items-center justify-between text-vm-1">
                  <span>{signalLabel[s.signal] ?? s.signal}</span>
                  <span className="font-label">{s.count}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Channel mix</CardTitle>
              <Button variant="ghost" onClick={() => exportCsv('channel_mix')}>
                Export CSV
              </Button>
            </div>
            <ul className="mt-vm-3 space-y-vm-2">
              {a.channelMix.map((c) => (
                <li key={c.channel} className="flex items-center justify-between text-vm-1">
                  <span className="capitalize">{c.channel.replace(/_/g, ' ')}</span>
                  <span className="font-label">{Math.round(c.fraction * 100)}%</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Conversion by channel</CardTitle>
              <Button variant="ghost" onClick={() => exportCsv('conversion_by_channel')}>
                Export CSV
              </Button>
            </div>
            <CardDescription>
              Lead-capture rate per channel (leads captured / conversations). True
              admin-marked-outcome conversion, and conversion by source/service, are not yet
              available — no lead-outcome or service-type field exists yet.
              {a.conversionBySourceNote ? ` ${a.conversionBySourceNote}` : ''}
            </CardDescription>
            {!a.conversionByChannel || a.conversionByChannel.length === 0 ? (
              <p className="mt-vm-3 text-vm-1 text-vm-text-muted">No conversation data yet.</p>
            ) : (
              <ul className="mt-vm-3 space-y-vm-2">
                {a.conversionByChannel.map((c) => (
                  <li key={c.channel} className="flex items-center justify-between text-vm-1">
                    <span className="capitalize">{c.channel.replace(/_/g, ' ')}</span>
                    <span className="font-label">
                      {Math.round(c.conversionRate * 100)}% ({c.leads}/{c.conversations})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Busiest times</CardTitle>
              <Button variant="ghost" onClick={() => exportCsv('busiest_times')}>
                Export CSV
              </Button>
            </div>
            <CardDescription>Conversation volume by day of week and hour of day.</CardDescription>
            {!a.busiestTimes || a.busiestTimes.length === 0 ? (
              <p className="mt-vm-3 text-vm-1 text-vm-text-muted">No conversation data yet.</p>
            ) : (
              <div className="mt-vm-3 overflow-x-auto">
                <table className="text-vm-0">
                  <tbody>
                    {a.busiestTimes.map((row, day) => (
                      <tr key={day}>
                        <td className="pr-vm-2 text-vm-text-muted">{dayLabel[day] ?? day}</td>
                        {row.map((count, hour) => (
                          <td
                            key={hour}
                            title={`${dayLabel[day] ?? day} ${hour}:00 — ${count} conversation(s)`}
                            className="px-[2px]"
                          >
                            <div
                              className="h-3 w-3 rounded-sm"
                              style={{
                                backgroundColor:
                                  count === 0
                                    ? 'var(--vm-color-surface-muted, #eee)'
                                    : `color-mix(in srgb, var(--vm-color-primary, #4338ca) ${Math.min(100, 20 + count * 15)}%, transparent)`,
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Top knowledge sources</CardTitle>
            <CardDescription>
              The top-N source files by retrieval frequency in the rolling window.
            </CardDescription>
            {a.topKnowledgeSources && a.topKnowledgeSources.length > 0 ? (
              <ul className="mt-vm-3 space-y-vm-2">
                {a.topKnowledgeSources.map((src) => (
                  <li
                    key={src.sourceId}
                    className="flex items-center justify-between text-vm-1"
                  >
                    <span>{src.name}</span>
                    <span className="font-label">{src.retrievalCount}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
                {a.topKnowledgeSourcesNote ?? 'Not yet available.'}
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: string | null;
}) {
  return (
    <Card>
      <div className="text-vm-0 text-vm-text-muted">{label}</div>
      <div className="mt-vm-1 font-heading text-vm-5">{value}</div>
      {note ? <div className="mt-vm-1 text-vm-0 text-vm-text-muted">{note}</div> : null}
    </Card>
  );
}
