import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import BillingPage from '@/app/(app)/dashboard/billing/page';
import { periodAnchorSentence } from '@/lib/billing-period';
import { LucielApiError } from '@luciel/api-client';
import type { BillingInfo } from '@luciel/api-client';

/**
 * Round 7 WP-1 #5 — "Update payment method" opens the Stripe Billing Portal
 * (POST /billing/portal → {url}), and the free-50 window is the SERVED anchor.
 *
 *  - the button sits beside the card summary, redirects in the same tab, and
 *    reports pending while the portal session is minted;
 *  - 503 (payments not live) renders the same "not live yet" state the read's
 *    `paymentsAvailable: false` renders — never a dead button;
 *  - 409 (no card on file) offers Checkout ("Add a card") instead;
 *  - the period line reads `periodResetsAt` as served (a mid-month date stays a
 *    mid-month date), never a locally derived calendar-month label.
 */
const served = vi.hoisted(() => ({
  billing: null as BillingInfo | null,
  portal: null as (() => Promise<{ url: string }>) | null,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      billing: {
        ...actual.api.billing,
        get: async () => served.billing ?? actual.api.billing.get(),
        startPortal: () => (served.portal ?? actual.api.billing.startPortal)(),
      },
    },
  };
});

const withCard: BillingInfo = {
  paymentsAvailable: true,
  budget: {
    billingState: 'payg_enabled',
    dunningState: 'none',
    conversationsThisPeriod: 70,
    freeAllowance: 50,
    billedThisPeriod: 20,
    periodResetsAt: '2026-10-14T00:00:00Z',
    atCap: false,
  },
  paymentMethod: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
};

describe('Billing: update payment method via the Stripe portal', () => {
  const assign = vi.fn();
  beforeEach(() => {
    served.billing = withCard;
    served.portal = null;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });
    assign.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the button beside the card summary and opens the served URL in the same tab', async () => {
    served.portal = async () => ({ url: 'https://billing.stripe.com/session/abc' });
    renderWithQuery(<BillingPage />);
    expect(await screen.findByText(/VISA ending 4242/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update payment method' }));
    expect(screen.getByRole('button', { name: 'Opening your billing portal…' })).toBeDisabled();
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/session/abc'),
    );
  });

  it('renders the not-live state on a 503, exactly as paymentsAvailable:false does', async () => {
    served.portal = async () => {
      throw new LucielApiError({
        code: 'service_unavailable',
        message: 'Card payments are not live in this deployment yet.',
      });
    };
    renderWithQuery(<BillingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update payment method' }));
    expect(
      await screen.findByText(/Payments aren't live yet in this environment, so the card on file/),
    ).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeEnabled();
  });

  it('disables the button up front when the read already says payments are not live', async () => {
    served.billing = { ...withCard, paymentsAvailable: false };
    renderWithQuery(<BillingPage />);
    expect(await screen.findByRole('button', { name: 'Update payment method' })).toBeDisabled();
    expect(screen.getByText(/Payments aren't live yet in this environment/)).toBeInTheDocument();
  });

  it('offers Checkout instead on a 409 (no card on file to update)', async () => {
    served.portal = async () => {
      throw new LucielApiError({
        code: 'conflict',
        message: 'No card on file to update — add a card first.',
      });
    };
    renderWithQuery(<BillingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update payment method' }));
    expect(await screen.findByText(/There is no card on file to update/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a card' })).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the card unchanged and says so on any other failure', async () => {
    served.portal = async () => {
      throw new Error('boom');
    };
    renderWithQuery(<BillingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update payment method' }));
    expect(await screen.findByText(/We could not open your billing portal/)).toBeInTheDocument();
  });
});

describe('Billing: the free-50 window is the served anchor', () => {
  beforeEach(() => {
    served.billing = withCard;
  });

  it('renders periodResetsAt as served — a mid-month card anchor is not rounded to a month', async () => {
    renderWithQuery(<BillingPage />);
    const line = await screen.findByTestId('period-anchor');
    expect(line).toHaveTextContent(
      periodAnchorSentence('2026-10-14T00:00:00Z', 'payg_enabled').replace(/\s+/g, ' '),
    );
    expect(line).toHaveTextContent(new Date('2026-10-14T00:00:00Z').toLocaleDateString());
    expect(line.textContent).not.toMatch(/calendar month/i);
  });

  it('says the anchor moves to the card date once a card exists, for a cardless account', () => {
    expect(periodAnchorSentence('2026-11-01T00:00:00Z', 'free_cap')).toBe(
      `Your free 50 reset on ${new Date('2026-11-01T00:00:00Z').toLocaleDateString()}. Once a card is on file, the period follows your card's billing-cycle date instead.`,
    );
  });
});
