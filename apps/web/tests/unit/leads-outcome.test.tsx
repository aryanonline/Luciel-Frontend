import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import LeadsPage from '@/app/(app)/dashboard/leads/page';
import { api } from '@/lib/api';

/**
 * Lead outcomes (Vision §7; audit round 3, C14/C15). The owner marks each
 * lead In progress / Won / Lost, and that marking is what the analytics
 * Conversion-by-source card reads. Pins:
 *  - every lead row carries an outcome control, defaulting to the served value;
 *  - a change persists through the client and survives the list refresh;
 *  - a failed write says so and leaves the lead unchanged — never a silent
 *    revert (mutation pending/error invariant).
 */
describe('leads page: business outcome per lead', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the outcome control with the served value and saves a change', async () => {
    renderWithQuery(<LeadsPage />);
    const select = (await screen.findByLabelText('Outcome for Jordan P.')) as HTMLSelectElement;
    expect(select.value).toBe('in_progress');
    // The three business states, in plain words.
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['In progress', 'Won', 'Lost']);

    fireEvent.change(select, { target: { value: 'converted' } });
    // The mock adapter persists the outcome; after the refetch the row still
    // reads Won (round-tripped through the client, not local component state).
    await waitFor(() => {
      expect(
        (screen.getByLabelText('Outcome for Jordan P.') as HTMLSelectElement).value,
      ).toBe('converted');
    });
    expect(screen.queryByText(/We could not save that outcome/)).not.toBeInTheDocument();
  });

  it('shows the served email as a second identifier line when it differs (round 5)', async () => {
    renderWithQuery(<LeadsPage />);
    // The seeded lead's transport identifier is a phone number; the captured
    // email is different information, so it renders as "also: …".
    await screen.findByText(/416-555-0143/);
    expect(screen.getByText('also: jordan.p@example.com')).toBeInTheDocument();
  });

  it('shows an error and keeps the lead unchanged when the write fails', async () => {
    renderWithQuery(<LeadsPage />);
    await screen.findByLabelText('Outcome for Jordan P.');
    vi.spyOn(api.leads, 'markOutcome').mockRejectedValueOnce(new Error('boom'));
    fireEvent.change(screen.getByLabelText('Outcome for Jordan P.'), {
      target: { value: 'lost' },
    });
    expect(
      await screen.findByText('We could not save that outcome. The lead is unchanged — please try again.'),
    ).toBeInTheDocument();
    // The served value (unchanged by the failed write) is back after refresh.
    await waitFor(() => {
      expect(
        (screen.getByLabelText('Outcome for Jordan P.') as HTMLSelectElement).value,
      ).not.toBe('lost');
    });
  });
});
