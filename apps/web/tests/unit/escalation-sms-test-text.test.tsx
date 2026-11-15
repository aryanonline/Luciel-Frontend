import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery, seededQueryClient } from './test-utils';
import { EscalationPillar } from '@/components/config/escalation-pillar';
import { api } from '@/lib/api';
import { qk, useLuciel } from '@/lib/hooks';

// The same mock API minus its artificial 150 ms a call. These tests are about what each
// write leaves on screen, not about how long it pends, and a save is three calls in a
// row (the write, the Luciel re-read, then the test text), so the delay only added up.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  const { createLucielClient } = await import('@luciel/api-client');
  return { ...actual, api: createLucielClient({ adapter: 'mock', mock: { latencyMs: 0 } }) };
});

/**
 * 2026-09-05 audit F084: an SMS escalation contact had no confirmation loop at all —
 * the first real hot lead was the test. The pillar now hints the only deliverable
 * shape (E.164), refuses anything else at save time, and offers a test text for
 * every saved number that reports honestly when the tenant's own number cannot
 * send (the mock runs with the SMS channel OFF, so the test text is refused with
 * the "no SMS number connected" truth rather than a pretend green).
 */

/** The pillar as Configure mounts it: on the served Luciel, re-read after every save. */
function ServedEscalationPillar() {
  const { data: luciel } = useLuciel();
  return luciel ? <EscalationPillar luciel={luciel} /> : null;
}

/**
 * The card alone, with the served Luciel already in the cache, so the first render is
 * the card and only the writes under test are waited for. (Rendering all of Configure
 * and waiting for its reads ran past the 5 s test budget on a loaded machine.)
 */
async function renderPillar() {
  const luciel = await api.luciel.get();
  renderWithQuery(<ServedEscalationPillar />, seededQueryClient([[qk.luciel, luciel]]));
}

describe('escalation SMS contacts: E.164 hint, save-time validation, test text', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hints the international format on both SMS fields', async () => {
    await renderPillar();
    expect(screen.getByLabelText('Primary SMS (optional)')).toBeInTheDocument();
    expect(screen.getAllByText('International format, e.g. +16045551234')).toHaveLength(2);
  });

  it('refuses a number that is not in international format', async () => {
    await renderPillar();
    fireEvent.change(screen.getByLabelText('Primary SMS (optional)'), {
      target: { value: '604-555-1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save escalation settings' }));
    expect(await screen.findByText(/Enter the number in international format/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send a test text' })).not.toBeInTheDocument();
  });

  it('offers a test text for a saved number and reports honestly when it cannot send', async () => {
    const write = vi.spyOn(api.luciel, 'updateEscalation');
    await renderPillar();
    fireEvent.change(screen.getByLabelText('Primary SMS (optional)'), {
      target: { value: '+1 (604) 555-1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save escalation settings' }));
    // A save is the write, then a re-read of the Luciel, and only then the notice. The
    // write is awaited on its own (inside act: the card re-renders while it answers),
    // so the wait below covers the re-read alone.
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    await act(async () => {
      await write.mock.results[0]!.value;
    });
    expect(
      await screen.findByText(/Saved\. New conversations escalate to these contacts/),
    ).toBeInTheDocument();

    // The saved (normalised) number shows with its test affordance.
    expect(await screen.findByText(/\+16045551234 — primary SMS/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send a test text' }));
    expect(
      await screen.findByText(/no SMS number connected yet — add one under Channels/),
    ).toBeInTheDocument();
  });
});
