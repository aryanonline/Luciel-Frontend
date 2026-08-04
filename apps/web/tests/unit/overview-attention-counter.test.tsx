import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import DashboardPage from '@/app/(app)/dashboard/page';
import type { Connection, ConnectionProviders } from '@luciel/api-client';

/**
 * Copy fallback + attention counter (register/frontend_gaps.md, "Copy
 * fallback + attention counter"). Overview's Connections card header said
 * "4 need attention" while only 3 rows actually rendered the "Action
 * needed" chip — Notion is now correctly chipped "Not available yet"
 * (registry `configured: false` / `providerAvailable: false`), but the
 * counter's own filter (`status !== 'connected'`) still counted it, because
 * it never looked at provider availability the way the row's own chip
 * (`chipForConnection`) does.
 *
 * This fixture pins the exact scenario from the report: 3 rows that render
 * "Action needed" + 1 row that renders "Not available yet" (never
 * connected, registry-unavailable) → the header must read "3 need
 * attention", not 4.
 */
const served = vi.hoisted(() => ({
  connections: null as Connection[] | null,
  providers: null as ConnectionProviders[] | null,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        list: async () => served.connections ?? actual.api.connections.list(),
        listProviders: async () => served.providers ?? actual.api.connections.listProviders(),
      },
    },
  };
});

beforeEach(() => {
  served.connections = null;
  served.providers = null;
});

const actionNeededRow = (
  connectionId: string,
  connectionType: Connection['connectionType'],
  provider: string,
): Connection => ({
  connectionId,
  connectionType,
  provider,
  displayName: provider,
  providerAvailable: true, // registry CAN connect this — the row is genuinely actionable.
  status: 'unconfigured', // -> chipForConnection(...) === 'action_needed'
  createdAt: '2026-02-01T10:00:00Z',
});

const notAvailableRow = (connectionId: string): Connection => ({
  connectionId,
  connectionType: 'knowledge_source',
  provider: 'notion',
  displayName: 'Notion',
  providerAvailable: false, // registry cannot connect this at all -> "Not available yet".
  status: 'unconfigured',
  createdAt: '2026-02-01T10:00:00Z',
});

describe('Overview Connections attention counter agrees with the rows it renders', () => {
  it('counts only the rows that render "Action needed", excluding a registry-unavailable row (3 action-needed + 1 not-available -> "3 need attention")', async () => {
    served.connections = [
      actionNeededRow('11111111-1111-4111-8111-111111111111', 'crm', 'hubspot'),
      actionNeededRow('22222222-2222-4222-8222-222222222222', 'sms_sender', 'twilio'),
      actionNeededRow('33333333-3333-4333-8333-333333333333', 'email_sender', 'ses'),
      notAvailableRow('44444444-4444-4444-8444-444444444444'),
    ];
    served.providers = [];

    renderWithQuery(<DashboardPage />);

    // The header must say exactly 3, not 4 — Notion's "Not available yet"
    // row must not inflate the count.
    expect(await screen.findByText(/^3 needs? attention\.?$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^4 needs? attention/i)).not.toBeInTheDocument();

    // Sanity: the rows themselves render what the header is counting —
    // exactly 3 "Action needed" chips and exactly 1 "Not available yet".
    expect(screen.getAllByText(/^Action needed/i)).toHaveLength(3);
    expect(screen.getByText(/Not available yet/i)).toBeInTheDocument();
  });

  it('a row with providerAvailable omitted falls back to the registry configured lookup for the count, matching its own chip', async () => {
    served.connections = [
      {
        connectionId: '55555555-5555-4555-8555-555555555555',
        connectionType: 'calendar',
        provider: 'google_calendar',
        displayName: 'Google Calendar',
        // providerAvailable deliberately omitted -> falls back to the
        // providers-registry `configured` flag below (false), same as the
        // row's own chip does.
        status: 'connected',
        createdAt: '2026-02-01T10:00:00Z',
      },
    ];
    served.providers = [
      {
        connectionType: 'calendar',
        providers: [
          {
            provider: 'google_calendar',
            displayName: 'Google Calendar',
            authKind: 'oauth',
            helpText: '',
            configured: false,
            credentialFields: [],
            scopeKind: null,
          },
        ],
      },
    ];

    renderWithQuery(<DashboardPage />);

    // configured: false -> chip is "Not available yet" (never "Action
    // needed"), regardless of the `connected` status -> 0 need attention.
    await screen.findByText(/Not available yet/i);
    expect(screen.getByText(/All connected and healthy\./i)).toBeInTheDocument();
  });

  it('all-actionable fixture still counts every row (no false negatives from the fix)', async () => {
    served.connections = [
      actionNeededRow('66666666-6666-4666-8666-666666666666', 'crm', 'hubspot'),
      actionNeededRow('77777777-7777-4777-8777-777777777777', 'sms_sender', 'twilio'),
    ];
    served.providers = [];

    renderWithQuery(<DashboardPage />);

    expect(await screen.findByText(/^2 need attention\.?$/i)).toBeInTheDocument();
  });
});
