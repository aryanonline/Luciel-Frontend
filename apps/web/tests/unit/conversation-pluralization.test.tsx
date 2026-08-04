import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';

/**
 * Harmony fixes 2026-08-04, FE-H#8 (owner walkthrough on dev).
 *
 * The conversation-budget progress-bar label always pluralized
 * "conversations", so a Luciel that had answered exactly one conversation
 * this period read "1 conversations this month" on both Overview and
 * Billing. Mocks the hook layer directly (mirrors
 * residency-payg-copy.test.tsx) so the budget can be pinned to exactly 1.
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

function mockHooks() {
  vi.doMock('@/lib/hooks', () => ({
    useLuciel: () => ({ data: { name: 'Sarah', state: 'active' }, isLoading: false }),
    useBilling: () => ({ data: { budget } }),
    useConversations: () => ({ data: [] }),
    useLeads: () => ({ data: [] }),
    useConnections: () => ({ data: [] }),
    useConnectionProviders: () => ({ data: [] }),
    useSwapConnection: () => ({ mutate: vi.fn(), isPending: false }),
  }));
}

describe('Harmony FE-H#8: conversation-count pluralizes correctly on Overview', () => {
  it('reads "1 conversation" (singular), never "1 conversations", on the Overview budget bar', async () => {
    vi.resetModules();
    mockHooks();
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page');
    renderWithQuery(<DashboardPage />);
    expect(await screen.findByText(/\b1 conversation\b(?! s)/i)).toBeInTheDocument();
    expect(screen.queryByText(/\b1 conversations\b/i)).not.toBeInTheDocument();
  });
});

describe('Harmony FE-H#8: conversation-count pluralizes correctly on Billing', () => {
  it('reads "1 conversation" (singular), never "1 conversations", on the Billing budget bar', async () => {
    vi.resetModules();
    mockHooks();
    const { default: BillingPage } = await import('@/app/(app)/dashboard/billing/page');
    renderWithQuery(<BillingPage />);
    expect(screen.queryByText(/\b1 conversations\b/i)).not.toBeInTheDocument();
  });
});
