import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import DashboardPage from '@/app/(app)/dashboard/page';
import BillingPage from '@/app/(app)/dashboard/billing/page';

/**
 * Harmony fixes 2026-08-04, FE-H#8 (owner walkthrough on dev).
 *
 * The conversation-budget progress-bar label always pluralized
 * "conversations", so a Luciel that had answered exactly one conversation
 * this period read "1 conversations this month" on both Overview and
 * Billing. Mocks the hook layer directly so the budget can be pinned to
 * exactly 1.
 *
 * The mock and the pages load with the file, not inside a test: both tests share
 * the one mock, and importing a page's whole module graph after `vi.resetModules()`
 * counted against the first test's 5 s budget — over it on a loaded machine.
 */
const budget = {
  dunningState: 'none' as const,
  freeAllowance: 50 as const,
  periodResetsAt: '2026-07-15T14:00:00Z',
  atCap: false,
  billingState: 'free_cap' as const,
  conversationsThisPeriod: 1,
  billedThisPeriod: 0,
};

vi.mock('@/lib/hooks', () => ({
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

describe('Harmony FE-H#8: conversation-count pluralizes correctly on Overview', () => {
  it('reads "1 conversation" (singular), never "1 conversations", on the Overview budget bar', async () => {
    renderWithQuery(<DashboardPage />);
    expect(await screen.findByText(/\b1 conversation\b(?! s)/i)).toBeInTheDocument();
    expect(screen.queryByText(/\b1 conversations\b/i)).not.toBeInTheDocument();
  });
});

describe('Harmony FE-H#8: conversation-count pluralizes correctly on Billing', () => {
  it('reads "1 conversation" (singular), never "1 conversations", on the Billing budget bar', async () => {
    renderWithQuery(<BillingPage />);
    expect(screen.queryByText(/\b1 conversations\b/i)).not.toBeInTheDocument();
  });
});
