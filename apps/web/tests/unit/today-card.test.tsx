import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { TodayCard, identityLine, teamLine } from '@/components/today-card';
import type { EmployeeStatus } from '@luciel/api-client';

/**
 * Round 6 WP-F: the Today card is the employee in one place. Everything it says is
 * served; it never claims Luciel has hours; needs link to the fix; the brief toggle
 * and the business name save through the client.
 */
const served = vi.hoisted(() => ({
  status: null as EmployeeStatus | null | undefined,
  fail: false,
  briefCalls: [] as boolean[],
  nameCalls: [] as (string | null)[],
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      luciel: {
        ...actual.api.luciel,
        status: async () => {
          if (served.fail) throw new Error('boom');
          return served.status ?? null;
        },
        updateDailyBrief: async (enabled: boolean) => {
          served.briefCalls.push(enabled);
          return actual.api.luciel.get();
        },
        updateBusinessName: async (name: string | null) => {
          served.nameCalls.push(name);
          return actual.api.luciel.get();
        },
      },
    },
  };
});

const base: EmployeeStatus = {
  assistantName: 'Aurora',
  businessShortName: null,
  onDuty: 'around the clock',
  conversationsUsed: 12,
  freeAllowance: 50,
  freeRemaining: 38,
  billedBlocks: 0,
  billable: true,
  periodResetsAt: '2026-10-01T00:00:00Z',
  timezone: 'America/Toronto',
  teamReachableNow: null,
  nextReachable: null,
  capabilities: [
    {
      id: 'widget',
      kind: 'channel',
      label: 'Website chat',
      state: 'ready',
      detail: 'on your website',
    },
    {
      id: 'email',
      kind: 'channel',
      label: 'Email',
      state: 'attention',
      detail: 'nothing connected',
    },
    { id: 'sms', kind: 'channel', label: 'Text messages', state: 'off', detail: null },
    {
      id: 'lookup_record',
      kind: 'tool',
      label: 'Look up a record',
      state: 'unavailable',
      detail: 'not available yet',
    },
  ],
  needs: [
    {
      code: 'email_no_mailbox',
      severity: 'attention',
      title: 'Email channel is on but no mailbox is connected',
      detail: 'Connect your work mailbox under Configure → Channels, or turn email off.',
      href: '/dashboard/configure',
    },
    {
      code: 'allowed_origins_unset',
      severity: 'info',
      title: 'Name the websites that may load your chat',
      detail: 'Right now any page that copies your embed key can use it.',
      href: '/dashboard/embed',
    },
  ],
  yesterday: {
    date: '2026-09-07',
    conversations: 7,
    byChannel: { widget: 5, sms: 2 },
    leads: 3,
    leadsToCrm: 2,
    escalations: 1,
    escalationsReached: 1,
    bookings: 1,
    callbacksScheduled: 0,
    humanTakeovers: 0,
  },
  today: {
    date: '2026-09-08',
    conversations: 2,
    byChannel: { widget: 2 },
    leads: 0,
    leadsToCrm: 0,
    escalations: 0,
    escalationsReached: 0,
    bookings: 0,
    callbacksScheduled: 0,
    humanTakeovers: 0,
  },
  dailyBriefEnabled: true,
};

describe('Today card', () => {
  beforeEach(() => {
    served.status = base;
    served.fail = false;
    served.briefCalls = [];
    served.nameCalls = [];
  });

  it('says the employee is on duty around the clock and shows served facts', async () => {
    renderWithQuery(<TodayCard />);
    expect(await screen.findByTestId('identity-line')).toHaveTextContent(
      'Aurora is on duty around the clock — 12 of 50 free conversations used this period.',
    );
    expect(screen.queryByTestId('team-line')).toBeNull();
    const strip = screen.getByRole('list', { name: 'What I can do right now' });
    expect(strip).toHaveTextContent('Website chat');
    expect(strip).toHaveTextContent('Ready');
    expect(strip).toHaveTextContent('Email');
    expect(strip).toHaveTextContent('Needs you');
    expect(strip).toHaveTextContent('Not available yet');
    expect(strip).not.toHaveTextContent('Text messages'); // off channels are not listed
    const needs = screen.getByRole('list', { name: 'What I need from you' });
    expect(needs).toHaveTextContent('Email channel is on but no mailbox is connected');
    expect(
      screen.getByRole('link', { name: 'Email channel is on but no mailbox is connected' }),
    ).toHaveAttribute('href', '/dashboard/configure');
    expect(screen.getByTestId('day-yesterday')).toHaveTextContent(
      '7 conversations, 3 leads (2 to your CRM), 1 hand-off (1 reached), 1 booking.',
    );
    expect(screen.getByTestId('day-today')).toHaveTextContent('2 conversations.');
    expect(screen.getByRole('switch', { name: 'Morning brief by email' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('describes people, not Luciel, when the team is away', () => {
    expect(
      teamLine({ ...base, teamReachableNow: false, nextReachable: 'tomorrow at 9:00 am (EDT)' }),
    ).toBe(
      'Nobody on your team is reachable right now — next tomorrow at 9:00 am (EDT). Aurora keeps answering.',
    );
    expect(teamLine({ ...base, teamReachableNow: true })).toBe(
      'Someone on your team is reachable right now.',
    );
    expect(
      identityLine({ ...base, businessShortName: 'Acme', billedBlocks: 2, conversationsUsed: 230 }),
    ).toBe(
      'Aurora is on duty around the clock for Acme — 230 conversations this period (50 free + 2 paid blocks).',
    );
  });

  it('turns the brief off through the client and reports it', async () => {
    renderWithQuery(<TodayCard />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Morning brief by email' }));
    await waitFor(() => expect(served.briefCalls).toEqual([false]));
    expect(
      await screen.findByText('Morning brief off. You can turn it back on any time.'),
    ).toBeVisible();
  });

  it('saves the business name and says how Luciel now introduces itself', async () => {
    renderWithQuery(<TodayCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set your business name' }));
    fireEvent.change(screen.getByLabelText('Business name in greetings'), {
      target: { value: '  Acme Patios ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(served.nameCalls).toEqual(['Acme Patios']));
    expect(
      await screen.findByText(/Aurora now introduces itself as an AI assistant for Acme Patios/),
    ).toBeVisible();
  });

  it('shows an honest empty and error state', async () => {
    served.status = null;
    renderWithQuery(<TodayCard />);
    expect(await screen.findByText(/you haven't built a Luciel/)).toBeVisible();
    served.fail = true;
    renderWithQuery(<TodayCard />);
    expect(await screen.findByText(/We could not load today's status/)).toBeVisible();
  });
});
