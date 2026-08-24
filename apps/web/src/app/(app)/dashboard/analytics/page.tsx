'use client';

import * as React from 'react';
import { Banner, Card, CardTitle, CardDescription, Button, PageHeader } from '@luciel/ui';
import { useAnalytics } from '@/lib/hooks';
import { saveBlob } from '@/lib/download';

/**
 * Analytics (Arch §3.9). Aggregates only — no new PII, tenant-scoped. Surfaces:
 * conversations, leads, escalations-by-signal, reply time, appointments booked,
 * channel mix, budget utilization, busiest-times heatmap, top knowledge
 * sources, conversion by channel, CSV export (Vision §7).
 *
 * Appointments booked and reply time are REAL numbers now (backend
 * booking_events + transcript turn gaps); a null only ever means "nothing to
 * measure yet this period" and arrives with a plain-language `*Note`. Top
 * knowledge sources keeps its honest server-side gap note. The shared
 * `AnalyticsOverview` schema carries all of this — the page-local widened type
 * that papered over the old schema mismatch is gone.
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
  saveBlob(await res.blob(), `analytics_${view}.csv`);
}

export default function AnalyticsPage() {
  const { data: a, isPending, isError, refetch } = useAnalytics();
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

      {/* `isLoading || !a` left a failed read spinning on "Loading…" forever,
          because a query that has errored is no longer loading and still has no
          data (P1-13). */}
      {isPending ? (
        <p className="text-vm-1 text-vm-text-muted" role="status">
          Loading your analytics…
        </p>
      ) : isError ? (
        <Banner tone="danger">
          We could not load your analytics, so no figures are shown rather than shown wrong.{' '}
          <button className="underline" onClick={() => void refetch()}>
            Try again
          </button>
        </Banner>
      ) : !a ? (
        <p className="text-vm-1 text-vm-text-muted">
          No analytics yet — they appear once your Luciel has handled its first conversation.
        </p>
      ) : (
        <>
          <div className="grid gap-vm-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Conversations (period)"
              value={a.conversationsThisPeriod}
              note={`${a.conversationsTotal} all time · ${Math.round(a.budgetUtilization * 100)}% of the free 50 used this period`}
            />
            <Stat label="Leads (period)" value={a.leadsThisPeriod} />
            <Stat
              label="Appointments booked"
              value={a.appointmentsBooked ?? '—'}
              note={
                a.appointmentsBooked == null
                  ? (a.appointmentsBookedNote ??
                    'Shows up once a calendar tool is connected and Luciel books its first appointment.')
                  : a.appointmentsBookedNote
              }
            />
            <Stat
              label="Response time (typical / slowest 5%)"
              value={
                a.responseTimeP50Seconds != null && a.responseTimeP95Seconds != null
                  ? // At most one decimal: the wire carries raw float seconds, and
                    // "19.877088999999998s" reached the page verbatim
                    // (live-caught 2026-08-23). Number() trims "45.0" back to "45".
                    `${Number(a.responseTimeP50Seconds.toFixed(1))}s / ${Number(a.responseTimeP95Seconds.toFixed(1))}s`
                  : '—'
              }
              note={
                a.responseTimeP50Seconds == null
                  ? (a.responseTimeNote ??
                    'How fast Luciel answers: the typical reply, and the slowest 5% of replies. Measured once real conversations flow.')
                  : a.responseTimeNote
              }
            />
          </div>

          <Card>
            <CardTitle>Escalations by signal</CardTitle>
            {/* Six reasons are reported, not four: the four escalation signals
                Luciel decides on, plus the two operational reasons it hands over
                for. Claiming four while listing six was simply wrong (P2-2). */}
            <CardDescription>
              Luciel decides when to escalate on four fixed signals — you never configure them. It
              also hands over when the conversation budget is exhausted or the model is unavailable.
              This is how often each fired.
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
              How many conversations on each channel turned into a captured lead.
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
            <CardTitle>Conversion by source</CardTitle>
            <CardDescription>
              Of the leads that came from each place, how many you marked as won. Mark each
              lead&apos;s outcome on the Leads page — that is what this card reads.
              {a.conversionBySourceNote ? ` ${a.conversionBySourceNote}` : ''}
            </CardDescription>
            {!a.conversionBySource || a.conversionBySource.length === 0 ? (
              <p className="mt-vm-3 text-vm-1 text-vm-text-muted">
                No leads captured yet this period.
              </p>
            ) : (
              <ul className="mt-vm-3 space-y-vm-2">
                {a.conversionBySource.map((c) => (
                  <li key={c.source} className="flex items-center justify-between text-vm-1">
                    <span className="capitalize">{c.source.replace(/_/g, ' ')}</span>
                    <span className="font-label">
                      {Math.round(c.conversionRate * 100)}% won ({c.converted}/{c.leads})
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
                                    ? 'var(--vm-surface)'
                                    : `color-mix(in srgb, var(--vm-accent) ${Math.min(100, 20 + count * 15)}%, transparent)`,
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
              Which of your documents Luciel reaches for most when answering.
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
                {a.topKnowledgeSourcesNote ??
                  "Nothing to show yet — this fills in as Luciel answers from your documents."}
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
