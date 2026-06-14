'use client';

import { useQuery } from '@tanstack/react-query';
import { StatusChip, chipKindFromStatus } from '@/components/connection-chip';
import { api } from '@/lib/api';

/**
 * Dashboard home — scaffold. Demonstrates the api-client boundary end-to-end:
 * the page imports ONLY `api` (the typed client), never an adapter or the mock.
 * Swapping mock → http here is a one-line env change with no edits to this file
 * (Space Instructions §7).
 *
 * It renders the budget bar copy EXACTLY as specified (Arch §3.4.1b) and the
 * connection chips. Full dashboard surfaces (five-pillar config, conversations,
 * analytics, lifecycle, billing) are built in later milestones.
 */
export default function DashboardPage() {
  const luciel = useQuery({ queryKey: ['luciel'], queryFn: () => api.luciel.get() });
  const billing = useQuery({ queryKey: ['billing'], queryFn: () => api.billing.get() });
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.connections.list(),
  });

  return (
    <div className="space-y-vm-6">
      <section>
        <h1 className="font-heading text-vm-5">
          {luciel.isLoading ? 'Loading…' : (luciel.data?.name ?? 'No Luciel yet')}
        </h1>

        {/* Budget bar copy — verbatim spec (Arch §3.4.1b):
            "[Luciel name]: X conversations this month (50 free + Y billed)". */}
        {billing.data && luciel.data && (
          <p className="mt-vm-2 text-vm-1 text-vm-text-muted">
            {luciel.data.name}: {billing.data.budget.conversationsThisPeriod} conversations this
            month ({billing.data.budget.freeAllowance} free + {billing.data.budget.billedThisPeriod}{' '}
            billed)
          </p>
        )}

        {/* At-cap honesty (no over-claim): only shown when server says so. */}
        {billing.data?.budget.atCap && (
          <p className="mt-vm-2 text-vm-1 text-vm-warning">
            You&apos;ve reached your 50 free conversations this month. Your Luciel is still
            capturing leads and escalating them to you. Add a payment method to keep it fully
            answering.
          </p>
        )}
      </section>

      <section>
        <h2 className="font-heading text-vm-4">Connections</h2>
        <ul className="mt-vm-3 space-y-vm-2">
          {connections.data?.map((c) => (
            <li key={c.connectionId} className="flex items-center gap-vm-3 text-vm-1">
              <span className="w-40 text-vm-text-muted">
                {c.connectionType} · {c.provider}
              </span>
              <StatusChip
                kind={chipKindFromStatus(c.status)}
                detail={c.status === 'unconfigured' ? `connect ${c.provider}` : undefined}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
