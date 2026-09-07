import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import PrivacyPage from '@/app/(marketing)/legal/privacy/page';
import DpaPage from '@/app/(marketing)/legal/dpa/page';

/**
 * P1 doctrine alignment.
 *
 * Residency (Arch §4.2): the privacy + DPA copy must be a flat, unconditional
 * Canada-residency statement, not the hedged "for the current offering that
 * region is…" framing.
 *
 * PAYG nudge (Arch §3.4.1b / Vision §7): payg_enabled accounts ~80% through a
 * billed 100-block get an honest heads-up (never a cap). free_cap accounts must
 * NOT see it.
 */

describe('P1: residency copy is flat and unconditional (Arch §4.2)', () => {
  it('privacy page states Canada residency without the hedged framing', () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(
        /VantageMind is Canada-resident\. All customer data is stored in AWS Canada Central \(ca-central-1\), with no cross-region replication\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/current offering/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/disclosed region/i)).not.toBeInTheDocument();
  });

  it('DPA page states Canada residency without the hedged framing', () => {
    render(<DpaPage />);
    expect(
      screen.getByText(
        /VantageMind is Canada-resident\. All customer data is stored in AWS Canada Central \(ca-central-1\), with no cross-region replication\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/disclosed region/i)).not.toBeInTheDocument();
  });
});

const budgetBase = {
  dunningState: 'none' as const,
  freeAllowance: 50 as const,
  periodResetsAt: '2026-07-15T14:00:00Z',
  atCap: false,
};

function mockHooks(budget: Record<string, unknown>) {
  vi.doMock('@/lib/hooks', () => ({
    useLuciel: () => ({ data: { name: 'Sarah', state: 'active' }, isLoading: false }),
    useBilling: () => ({ data: { budget } }),
    useConversations: () => ({ data: [] }),
    useLeads: () => ({ data: [] }),
    useConnections: () => ({ data: [] }),
    useConnectionProviders: () => ({ data: [] }),
    useSwapConnection: () => ({ mutate: vi.fn(), isPending: false }),
    // The Today card (round 6 WP-F) reads the employee status; an empty read keeps
    // these budget-copy assertions about the budget card alone.
    useEmployeeStatus: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
    useLucielMutations: () => ({}),
  }));
}

describe('P1: PAYG near-next-block nudge (Arch §3.4.1b / Vision §7)', () => {
  it('renders the honest heads-up for a payg_enabled account near a new block', async () => {
    vi.resetModules();
    mockHooks({
      ...budgetBase,
      billingState: 'payg_enabled',
      conversationsThisPeriod: 240,
      billedThisPeriod: 190,
      nearNextBlock: true,
    });
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page');
    renderWithQuery(<DashboardPage />);
    expect(screen.getByText(/about 80% through your current billed block/i)).toBeInTheDocument();
    expect(screen.getByText(/not a cap/i)).toBeInTheDocument();
  });

  it('does NOT render the nudge for a free_cap account', async () => {
    vi.resetModules();
    mockHooks({
      ...budgetBase,
      billingState: 'free_cap',
      conversationsThisPeriod: 38,
      billedThisPeriod: 0,
    });
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page');
    renderWithQuery(<DashboardPage />);
    expect(screen.queryByText(/current billed block/i)).not.toBeInTheDocument();
  });
});
