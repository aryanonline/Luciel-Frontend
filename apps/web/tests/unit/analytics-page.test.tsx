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
  conversionBySource: [
    { source: 'widget', leads: 10, converted: 4, conversionRate: 0.4 },
    { source: 'email', leads: 2, converted: 1, conversionRate: 0.5 },
  ],
  conversionBySourceNote: null,
  conversionByServiceNote: "Conversion by service isn't available yet — coming soon.",
};

const empty: AnalyticsOverview = {
  ...base,
  conversationsThisPeriod: 0,
  conversationsTotal: 0,
  leadsThisPeriod: 0,
  appointmentsBooked: 0,
  budgetUtilization: 0,
  responseTimeP50Seconds: null,
  responseTimeP95Seconds: null,
  responseTimeNote: 'Shows up once Luciel has replied to customers this billing period.',
  escalationsBySignal: [],
  channelMix: [],
  conversionByChannel: [],
  conversionBySource: [],
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

describe('analytics page: real dimensions (audit round 3, C14/C15)', () => {
  it('renders the all-time count and free-50 usage on the Conversations stat', async () => {
    overview.mockResolvedValue(base);
    renderWithQuery(<AnalyticsPage />);
    expect(
      await screen.findByText('312 all time · 40% of the free 50 used this period'),
    ).toBeInTheDocument();
  });

  it('renders Conversion by source with won percentages from marked outcomes', async () => {
    overview.mockResolvedValue(base);
    renderWithQuery(<AnalyticsPage />);
    expect(await screen.findByText('Conversion by source')).toBeInTheDocument();
    expect(screen.getByText('40% won (4/10)')).toBeInTheDocument();
    expect(screen.getByText('50% won (1/2)')).toBeInTheDocument();
    // The card explains where the number comes from — the Leads page.
    expect(screen.getByText(/Mark each lead's outcome on the Leads page/)).toBeInTheDocument();
  });

  it('renders real top knowledge sources with their retrieval counts', async () => {
    overview.mockResolvedValue({
      ...base,
      topKnowledgeSources: [
        { sourceId: 's-1', name: 'Services brochure.pdf', retrievalCount: 21 },
        { sourceId: 's-2', name: 'FAQ.docx', retrievalCount: 9 },
      ],
      topKnowledgeSourcesNote: null,
    });
    renderWithQuery(<AnalyticsPage />);
    expect(await screen.findByText('Services brochure.pdf')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('FAQ.docx')).toBeInTheDocument();
  });

  it('shows an honest empty state for Conversion by source, never a fabricated rate', async () => {
    overview.mockResolvedValue(empty);
    renderWithQuery(<AnalyticsPage />);
    expect(await screen.findByText('Conversion by source')).toBeInTheDocument();
    expect(screen.getByText('No leads captured yet this period.')).toBeInTheDocument();
    expect(screen.queryByText(/% won/)).not.toBeInTheDocument();
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
