'use client';

import { Card, CardTitle, CardDescription, Button } from '@luciel/ui';
import { useAnalytics } from '@/lib/hooks';

/**
 * Analytics (Arch §3.9). Aggregates only — no new PII, tenant-scoped. Surfaces:
 * conversations, leads, escalations-by-signal, response-time p50/p95,
 * appointments booked, channel mix, budget utilization, busiest-times heatmap,
 * CSV export.
 */
const signalLabel: Record<string, string> = {
  explicit_human_request: 'Human requested',
  strong_negative_sentiment: 'Negative sentiment',
  cannot_answer: "Couldn't answer",
  high_value_lead: 'High-value lead',
  budget_exhausted: 'Budget exhausted',
  llm_unavailable: 'LLM unavailable',
};

export default function AnalyticsPage() {
  const { data: a, isLoading } = useAnalytics();

  return (
    <div className="space-y-vm-5">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-vm-5">Analytics</h1>
        <Button variant="secondary">Export CSV</Button>
      </div>

      {isLoading || !a ? (
        <p className="text-vm-1 text-vm-text-muted" role="status">
          Loading…
        </p>
      ) : (
        <>
          <div className="grid gap-vm-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Conversations (period)" value={a.conversationsThisPeriod} />
            <Stat label="Leads (period)" value={a.leadsThisPeriod} />
            <Stat label="Appointments booked" value={a.appointmentsBooked} />
            <Stat
              label="Response time p50 / p95"
              value={`${a.responseTimeP50Seconds}s / ${a.responseTimeP95Seconds}s`}
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
            <CardTitle>Channel mix</CardTitle>
            <ul className="mt-vm-3 space-y-vm-2">
              {a.channelMix.map((c) => (
                <li key={c.channel} className="flex items-center justify-between text-vm-1">
                  <span className="capitalize">{c.channel.replace(/_/g, ' ')}</span>
                  <span className="font-label">{Math.round(c.fraction * 100)}%</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <div className="text-vm-0 text-vm-text-muted">{label}</div>
      <div className="mt-vm-1 font-heading text-vm-5">{value}</div>
    </Card>
  );
}
