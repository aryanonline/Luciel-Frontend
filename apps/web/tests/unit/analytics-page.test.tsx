import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import AnalyticsPage from '@/app/(app)/dashboard/analytics/page';
import type { AnalyticsOverview } from '@luciel/api-client';

/**
 * First test coverage for the Analytics page (it had none — the owner-visible
 * copy changed twice uncovered). Pins:
 *  - real numbers render for the two previously-"not available" cards
 *    (appointments booked, reply time), in plain language;
 *  - the honest EMPTY state renders the server's plain-language notes, never
 *    a fabricated number and never bare "Not yet available.";
 *  - no engineering jargon (p50/p95, top-N, rolling window, schema-gap
 *    narration) reaches the page.
 */

const overview = vi.fn<[], Promise<AnalyticsOverview>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      analytics: { ...actual.api.analytics, overview: () => overview() },
    },
  };
});

const base: AnalyticsOverview = {
  conversationsThisPeriod: 38,
  conversationsTotal: 312,
  leadsThisPeriod: 12,
  appointmentsBooked: 7,
  appointmentsBookedNote: null,
  responseTimeP50Seconds: 45,
  responseTimeP95Seconds: 240,
  responseTimeNote: null,
  escalationsBySignal: [{ signal: 'high_value_lead', count: 5 }],
  channelMix: [{ channel: 'widget', fraction: 1 }],
  budgetUtilization: 0.4,
  busiestTimes: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
  topKnowledgeSources: [],
  topKnowledgeSourcesNote: "Knowledge source usage isn't tracked yet — coming soon.",
  conversionByChannel: [{ channel: 'widget', conversations: 30, leads: 10, conversionRate: 0.33 }],
  conversionBySourceNote: "Conversion by source isn't available yet — coming soon.",
  conversionByServiceNote: "Conversion by service isn't available yet — coming soon.",
};

const empty: AnalyticsOverview = {
  ...base,
  conversationsThisPeriod: 0,
  leadsThisPeriod: 0,
  appointmentsBooked: 0,
  responseTimeP50Seconds: null,
  responseTimeP95Seconds: null,
  responseTimeNote: 'Shows up once Luciel has replied to customers this billing period.',
  escalationsBySignal: [],
  channelMix: [],
  conversionByChannel: [],
};

beforeEach(() => {
  overview.mockReset();
});

describe('analytics page: real numbers in plain language', () => {
  it('renders appointments booked and reply time as real values', async () => {
    overview.mockResolvedValue(base);
    renderWithQuery(<AnalyticsPage />);
    expect(await screen.findByText('Appointments booked')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Response time (typical / slowest 5%)')).toBeInTheDocument();
    expect(screen.getByText('45s / 240s')).toBeInTheDocument();
  });

  it('keeps engineering jargon off the page', async () => {
    overview.mockResolvedValue(base);
    const { container } = renderWithQuery(<AnalyticsPage />);
    await screen.findByText('Appointments booked');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/p50|p95/i);
    expect(text).not.toMatch(/top-N|rolling window/i);
    expect(text).not.toMatch(/schema|field exists/i);
    expect(text).not.toContain('Not yet available.');
  });
});

describe('analytics page: honest empty states', () => {
  it('renders a real zero for bookings and the plain-language reply-time note', async () => {
    overview.mockResolvedValue(empty);
    renderWithQuery(<AnalyticsPage />);
    expect(await screen.findByText('Appointments booked')).toBeInTheDocument();
    // Conversations, leads, AND bookings all show a real zero — bookings is
    // the one that used to render "—": with a real store, 0 is the honest value.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('—')).toBeInTheDocument(); // reply time has nothing to measure
    expect(
      screen.getByText('Shows up once Luciel has replied to customers this billing period.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Knowledge source usage isn't tracked yet — coming soon."),
    ).toBeInTheDocument();
  });
});
