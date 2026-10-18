import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { EscalationPillar } from '@/components/config/escalation-pillar';
import { TeamAvailabilityPillar } from '@/components/config/team-availability-pillar';
import { api } from '@/lib/api';
import { LucielApiError, type Luciel } from '@luciel/api-client';

/**
 * Round 7 WP-4b — SMS escalation contacts have a confirmation state.
 *
 * The contact-health list now covers SMS contacts and the after-hours contact.
 * Until a number answers its 6-digit code, every page to it is copied to the
 * owner (escalation_dispatch `_proven`). Pinned: the unconfirmed copy; "Enter code"
 * validates six digits at the field before anything is sent, posts {number, code},
 * keeps a wrong/expired code and a 429 in the dialog, and announces a confirmation;
 * "Resend code" re-mints through the resend route and is disabled (with the reason)
 * when no SMS number is connected to send it from; the after-hours number's health
 * renders on the Team availability card.
 */

const base: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: true, connectionStatus: 'connected' },
    { id: 'voice', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [],
  escalation: {
    primaryEmail: 'sales@acme.example',
    primarySms: '+16045550101',
    secondarySms: '+16045550102',
    preferredChannel: 'email',
  },
  escalationContactHealth: [
    {
      address: 'sales@acme.example',
      state: 'verified',
      verifiedAt: '2026-08-01T09:00:00Z',
      lastBouncedAt: null,
      channel: 'email',
      role: 'primary',
      detail: null,
    },
    {
      address: '+16045550101',
      state: 'pending_confirmation',
      verifiedAt: null,
      lastBouncedAt: null,
      channel: 'sms',
      role: 'primary',
      detail: null,
    },
    {
      address: '+16045550102',
      state: 'verified',
      verifiedAt: '2026-10-01T09:00:00Z',
      lastBouncedAt: null,
      channel: 'sms',
      role: 'secondary',
      detail: null,
    },
    {
      address: '+16045550103',
      state: 'unverified',
      verifiedAt: null,
      lastBouncedAt: null,
      channel: 'sms',
      role: 'after_hours',
      detail: null,
    },
  ],
  personality: { preset: 'warm_concierge' },
  leadRetentionDays: null,
  timezone: 'America/Vancouver',
  teamAvailability: {
    enabled: true,
    weekly: [{ day: 0, start: '09:00', end: '17:00' }],
    closures: [],
    afterHours: { escalation: { channel: 'sms', contactSms: '+16045550103' } },
  },
};

afterEach(() => vi.restoreAllMocks());

function healthList() {
  return screen.getByRole('list', { name: 'Escalation contact confirmation status' });
}

async function openCodeDialog() {
  renderWithQuery(<EscalationPillar luciel={base} />);
  fireEvent.click(within(healthList()).getByRole('button', { name: 'Enter code' }));
  return screen.findByRole('dialog', { name: 'Enter the confirmation code' });
}

describe('SMS contact confirmation in the Escalation pillar', () => {
  it('says an unconfirmed number has its pages copied to the owner, and a confirmed one is confirmed', () => {
    renderWithQuery(<EscalationPillar luciel={base} />);
    const list = healthList();
    expect(
      within(list).getByText(
        '+16045550101 (primary) — Unconfirmed — escalations are copied to you until confirmed',
      ),
    ).toBeInTheDocument();
    expect(within(list).getByText(/A 6-digit code was texted to this number/)).toBeInTheDocument();
    expect(within(list).getByText('+16045550102 (backup) — Confirmed')).toBeInTheDocument();
    // The after-hours contact belongs to the Team availability card, not here.
    expect(within(list).queryByText(/\+16045550103/)).not.toBeInTheDocument();
    // Only the unconfirmed number offers the code actions.
    expect(within(list).getAllByRole('button', { name: 'Enter code' })).toHaveLength(1);
    expect(within(list).getAllByRole('button', { name: 'Resend code' })).toHaveLength(1);
  });

  it('checks six digits at the field before anything is sent', async () => {
    const confirm = vi.spyOn(api.luciel, 'confirmSmsContact');
    const dialog = await openCodeDialog();
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '12a' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm number' }));
    expect(
      await within(dialog).findByText('Enter the 6-digit code from the text.'),
    ).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a wrong code stays in the dialog with the served outcome', async () => {
    const confirm = vi
      .spyOn(api.luciel, 'confirmSmsContact')
      .mockResolvedValue({ outcome: 'wrong_code', luciel: base });
    const dialog = await openCodeDialog();
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '000000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm number' }));
    expect(await within(dialog).findByText(/That code is not right/)).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith('+16045550101', '000000');
  });

  it('an expired code says so and points at Resend', async () => {
    vi.spyOn(api.luciel, 'confirmSmsContact').mockResolvedValue({
      outcome: 'expired',
      luciel: base,
    });
    const dialog = await openCodeDialog();
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm number' }));
    expect(
      await within(dialog).findByText(/That code has expired. Resend a new one/),
    ).toBeInTheDocument();
  });

  it('renders the 429 instead of swallowing it', async () => {
    vi.spyOn(api.luciel, 'confirmSmsContact').mockRejectedValue(
      new LucielApiError({
        code: 'rate_limited',
        message: 'Too many code entries. Please wait a few minutes.',
        retryAfterSeconds: 60,
      }),
    );
    const dialog = await openCodeDialog();
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm number' }));
    expect(
      await within(dialog).findByText(/Too many code entries. Please wait a few minutes./),
    ).toBeInTheDocument();
  });

  it('a confirmed code closes the dialog and announces it', async () => {
    vi.spyOn(api.luciel, 'confirmSmsContact').mockResolvedValue({
      outcome: 'confirmed',
      luciel: base,
    });
    const dialog = await openCodeDialog();
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm number' }));
    expect(
      await screen.findByText('+16045550101 is confirmed — escalations now go to it directly.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Enter the confirmation code' })).toBeNull(),
    );
  });

  it('Resend code re-mints through the resend route and reports the refusal verbatim', async () => {
    const resend = vi
      .spyOn(api.luciel, 'resendContactConfirmation')
      .mockRejectedValueOnce(
        new LucielApiError({
          code: 'validation_error',
          message: 'A code was sent moments ago — give it a few minutes, then retry.',
        }),
      )
      .mockResolvedValueOnce(base);
    renderWithQuery(<EscalationPillar luciel={base} />);
    const button = within(healthList()).getByRole('button', { name: 'Resend code' });

    fireEvent.click(button);
    expect(await screen.findByText(/A code was sent moments ago/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByText(/A new code was texted to \+16045550101/)).toBeInTheDocument();
    expect(resend).toHaveBeenCalledWith('+16045550101');
  });

  it('with no SMS number to send from, Resend is disabled and the row says why', () => {
    const noSender: Luciel = {
      ...base,
      escalationContactHealth: base.escalationContactHealth.map((h) =>
        h.address === '+16045550101'
          ? { ...h, state: 'unverified' as const, detail: 'sms_channel_not_provisioned' }
          : h,
      ),
    };
    renderWithQuery(<EscalationPillar luciel={noSender} />);
    const list = healthList();
    expect(
      within(list).getByText(/connect an SMS number under Configure → Channels first/),
    ).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Resend code' })).toBeDisabled();
  });
});

describe('the after-hours contact on the Team availability card', () => {
  it("renders the saved after-hours number's confirmation state and its actions", () => {
    renderWithQuery(<TeamAvailabilityPillar luciel={base} />);
    const list = screen.getByRole('list', { name: 'After-hours contact confirmation status' });
    expect(
      within(list).getByText(
        '+16045550103 (after hours) — Unconfirmed — escalations are copied to you until confirmed',
      ),
    ).toBeInTheDocument();
    expect(
      within(list).getByText(/No code is waiting — it expired or never went out/),
    ).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Enter code' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Resend code' })).toBeEnabled();
  });
});
