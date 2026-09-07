import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import BillingPage from '@/app/(app)/dashboard/billing/page';
import DashboardPage from '@/app/(app)/dashboard/page';
import type { BillingInfo } from '@luciel/api-client';

/**
 * 2026-09-05 product-owner audit, billing truth on the dashboard.
 *
 *  - F026: when the server reports `paymentsAvailable: false` (its Stripe posture
 *    is mock, the checkout URL goes nowhere) the page says payments are not live
 *    yet instead of rendering an "Add payment method" button that pretends to work.
 *  - F007: the free allowance is per Stripe BILLING PERIOD (calendar month only
 *    until a card exists), so the copy never says "this month".
 *  - F015: Overview shows ONE conversation number — the same billed-session count
 *    the budget bar uses — not a second figure derived from the conversation list.
 */
const served = vi.hoisted(() => ({ billing: null as BillingInfo | null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      billing: {
        ...actual.api.billing,
        get: async () => served.billing ?? actual.api.billing.get(),
      },
    },
  };
});

const freeCap: BillingInfo = {
  budget: {
    billingState: 'free_cap',
    dunningState: 'none',
    conversationsThisPeriod: 12,
    freeAllowance: 50,
    billedThisPeriod: 0,
    periodResetsAt: '2026-10-01T00:00:00Z',
    atCap: false,
  },
};

describe('Billing page: payments availability (F026)', () => {
  beforeEach(() => {
    served.billing = null;
  });

  it('offers the checkout button when the server says payments are available', async () => {
    served.billing = { ...freeCap, paymentsAvailable: true };
    renderWithQuery(<BillingPage />);
    expect(await screen.findByRole('button', { name: 'Add payment method' })).toBeInTheDocument();
    expect(screen.queryByText(/Payments aren't live yet/)).not.toBeInTheDocument();
  });

  it('treats an older server that omits the flag as available', async () => {
    served.billing = freeCap;
    renderWithQuery(<BillingPage />);
    expect(await screen.findByRole('button', { name: 'Add payment method' })).toBeInTheDocument();
  });

  it('says payments are not live yet instead of a dead button when the server says so', async () => {
    served.billing = { ...freeCap, paymentsAvailable: false };
    renderWithQuery(<BillingPage />);
    expect(await screen.findByText(/Payments aren't live yet in this environment/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add payment method' })).not.toBeInTheDocument();
  });
});

describe('Billing period wording (F007)', () => {
  beforeEach(() => {
    served.billing = null;
  });

  it('the billing page speaks of billing periods, never "this month"', async () => {
    served.billing = freeCap;
    const { container } = renderWithQuery(<BillingPage />);
    expect(await screen.findByText('This billing period')).toBeInTheDocument();
    await screen.findByText(/12 conversations this billing period/);
    expect(container.textContent).not.toMatch(/this month/i);
    expect(container.textContent).not.toMatch(/\/month\b/i);
    expect(container.textContent).not.toMatch(/a month\b/i);
  });

  it('the overview speaks of billing periods too', async () => {
    served.billing = freeCap;
    const { container } = renderWithQuery(<DashboardPage />);
    await screen.findByText(/12 conversations this billing period/);
    expect(container.textContent).not.toMatch(/this month/i);
  });
});

describe('One conversation number on Overview (F015)', () => {
  it('the stat repeats the budget count rather than the length of the conversation list', async () => {
    served.billing = freeCap;
    renderWithQuery(<DashboardPage />);
    await screen.findByText(/12 conversations this billing period/);
    const stat = await screen.findByText('Conversations this billing period');
    expect(stat.nextElementSibling?.textContent).toBe('12');
    expect(screen.queryByText(/^Conversations$/)).not.toBeInTheDocument();
  });
});
