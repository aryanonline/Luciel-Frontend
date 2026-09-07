import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import ConfigurePage from '@/app/(app)/dashboard/configure/page';

/**
 * 2026-09-05 audit F084: an SMS escalation contact had no confirmation loop at all —
 * the first real hot lead was the test. The pillar now hints the only deliverable
 * shape (E.164), refuses anything else at save time, and offers a test text for
 * every saved number that reports honestly when the tenant's own number cannot
 * send (the mock runs with the SMS channel OFF, so the test text is refused with
 * the "no SMS number connected" truth rather than a pretend green).
 */
describe('escalation SMS contacts: E.164 hint, save-time validation, test text', () => {
  it('hints the international format on both SMS fields', async () => {
    renderWithQuery(<ConfigurePage />);
    await screen.findByLabelText('Primary SMS (optional)');
    expect(screen.getAllByText('International format, e.g. +16045551234')).toHaveLength(2);
  });

  it('refuses a number that is not in international format', async () => {
    renderWithQuery(<ConfigurePage />);
    const sms = await screen.findByLabelText('Primary SMS (optional)');
    fireEvent.change(sms, { target: { value: '604-555-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save escalation settings' }));
    expect(await screen.findByText(/Enter the number in international format/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send a test text' })).not.toBeInTheDocument();
  });

  it('offers a test text for a saved number and reports honestly when it cannot send', async () => {
    renderWithQuery(<ConfigurePage />);
    const sms = await screen.findByLabelText('Primary SMS (optional)');
    fireEvent.change(sms, { target: { value: '+1 (604) 555-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save escalation settings' }));
    await screen.findByText(/Saved\. New conversations escalate to these contacts/);

    // The saved (normalised) number shows with its test affordance.
    await waitFor(() =>
      expect(screen.getByText(/\+16045551234 — primary SMS/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send a test text' }));
    expect(
      await screen.findByText(/no SMS number connected yet — add one under Channels/),
    ).toBeInTheDocument();
  });
});
