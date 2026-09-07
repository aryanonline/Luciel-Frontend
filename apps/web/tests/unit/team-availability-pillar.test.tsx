import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { TeamAvailabilityPillar } from '@/components/config/team-availability-pillar';
import { LucielApiError, type Luciel } from '@luciel/api-client';

/**
 * Round 6 WP-E (audit F054): the optional sixth card is about the PEOPLE. It never
 * claims to change when Luciel answers; it saves the owner's hours, closures and
 * after-hours contact as one wire body, and reports the server's refusal verbatim.
 */
const served = vi.hoisted(() => ({
  calls: [] as unknown[],
  refuse: null as string | null,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      luciel: {
        ...actual.api.luciel,
        updateTeamAvailability: async (req: unknown) => {
          served.calls.push(req);
          if (served.refuse) {
            throw new LucielApiError({ code: 'validation_error', message: served.refuse });
          }
          return { ...base, timezone: 'America/Toronto' };
        },
      },
    },
  };
});

const base: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Aurora',
  websiteUrl: 'acme.example',
  state: 'active',
  channels: [{ id: 'widget', enabled: true }],
  tools: [],
  escalation: { primaryEmail: 'owner@acme.example' },
  escalationContactHealth: [],
  personality: { preset: 'warm_concierge' },
  leadRetentionDays: null,
  allowedOrigins: null,
  timezone: null,
  teamAvailability: null,
};

describe('Team availability card', () => {
  beforeEach(() => {
    served.calls = [];
    served.refuse = null;
  });

  it('is off by default and says Luciel keeps answering around the clock', () => {
    renderWithQuery(<TeamAvailabilityPillar luciel={base} />);
    expect(screen.getByRole('heading', { name: 'Team availability (optional)' })).toBeVisible();
    expect(screen.getByText(/Aurora answers customers around the clock/)).toBeVisible();
    expect(
      screen.getByRole('switch', { name: 'Tell customers when your team is reachable' }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('team-availability-off')).toHaveTextContent(
      'Hand-offs say someone will follow up shortly',
    );
    expect(screen.queryByLabelText('Weekly hours')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save team availability' })).toBeDisabled();
  });

  it('saves hours, a closure and an after-hours text contact as one body', async () => {
    renderWithQuery(<TeamAvailabilityPillar luciel={base} />);
    fireEvent.click(
      screen.getByRole('switch', { name: 'Tell customers when your team is reachable' }),
    );
    const zone = screen.getByLabelText('Your timezone') as HTMLSelectElement;
    expect(zone.value).not.toBe('');
    fireEvent.change(zone, { target: { value: 'America/Toronto' } });

    fireEvent.click(screen.getByLabelText('Monday reachable'));
    fireEvent.change(screen.getByLabelText('Monday from'), { target: { value: '08:30' } });
    fireEvent.click(screen.getByLabelText('Friday reachable'));
    fireEvent.change(screen.getByLabelText('Friday to'), { target: { value: '06:00' } });
    fireEvent.change(screen.getByLabelText('Friday from'), { target: { value: '22:00' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add a closure' }));
    fireEvent.change(screen.getByLabelText('Closure 1 date'), { target: { value: '2026-12-25' } });
    fireEvent.change(screen.getByLabelText('Closure 1 label'), { target: { value: 'Christmas' } });

    fireEvent.change(screen.getByLabelText('Reach the after-hours contact by'), {
      target: { value: 'sms' },
    });
    fireEvent.change(screen.getByLabelText('After-hours number'), {
      target: { value: '+16045559999' },
    });
    fireEvent.click(screen.getByLabelText('Also email the account owner'));

    fireEvent.click(screen.getByRole('button', { name: 'Save team availability' }));
    await waitFor(() => expect(served.calls).toHaveLength(1));
    expect(served.calls[0]).toEqual({
      timezone: 'America/Toronto',
      enabled: true,
      weekly: [
        { day: 0, start: '08:30', end: '17:00' },
        { day: 4, start: '22:00', end: '06:00' },
      ],
      closures: [{ date: '2026-12-25', label: 'Christmas' }],
      afterHours: {
        escalation: {
          channel: 'sms',
          contactEmail: null,
          contactSms: '+16045559999',
          ccOwnerEmail: true,
        },
      },
    });
    expect(await screen.findByText(/Luciel keeps answering around the clock/)).toBeVisible();
  });

  it('renders the served grid, and turning it off keeps it while sending enabled=false', async () => {
    const on: Luciel = {
      ...base,
      timezone: 'Europe/Berlin',
      teamAvailability: {
        enabled: true,
        weekly: [{ day: 2, start: '10:00', end: '16:00' }],
        closures: [],
        afterHours: { escalation: { channel: 'email', contactEmail: 'night@acme.example' } },
      },
    };
    renderWithQuery(<TeamAvailabilityPillar luciel={on} />);
    expect(screen.getByLabelText('Wednesday reachable')).toBeChecked();
    expect((screen.getByLabelText('Wednesday from') as HTMLInputElement).value).toBe('10:00');
    expect((screen.getByLabelText('After-hours email') as HTMLInputElement).value).toBe(
      'night@acme.example',
    );
    fireEvent.click(
      screen.getByRole('switch', { name: 'Tell customers when your team is reachable' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save team availability' }));
    await waitFor(() => expect(served.calls).toHaveLength(1));
    expect(served.calls[0]).toMatchObject({
      timezone: 'Europe/Berlin',
      enabled: false,
      weekly: [{ day: 2, start: '10:00', end: '16:00' }],
      afterHours: { escalation: { channel: 'email', contactEmail: 'night@acme.example' } },
    });
    expect(await screen.findByText(/Hand-offs use the general wording again/)).toBeVisible();
  });

  it("shows the server's refusal and keeps the draft", async () => {
    served.refuse = 'Add the number the after-hours text should go to.';
    renderWithQuery(<TeamAvailabilityPillar luciel={base} />);
    fireEvent.click(
      screen.getByRole('switch', { name: 'Tell customers when your team is reachable' }),
    );
    fireEvent.change(screen.getByLabelText('Reach the after-hours contact by'), {
      target: { value: 'sms' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save team availability' }));
    expect(
      await screen.findByText('Add the number the after-hours text should go to.'),
    ).toBeVisible();
    expect(
      (screen.getByLabelText('Reach the after-hours contact by') as HTMLSelectElement).value,
    ).toBe('sms');
    expect(screen.getByRole('button', { name: 'Save team availability' })).toBeEnabled();
  });
});
