import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';

/**
 * Harmony fixes 2026-08-04, FE-H#11b (owner walkthrough on dev).
 *
 * A short paste rounds to "0.0 MB" under the old one-decimal formatter,
 * which reads as empty/failed rather than small. Anything under 0.1 MB
 * (100 KB) now reads "<0.1 MB" instead of a number implying nothing landed.
 */
describe('Harmony FE-H#11b: small knowledge items read "<0.1 MB", never "0.0 MB"', () => {
  it('shows "<0.1 MB" for a short pasted note', async () => {
    renderWithQuery(<KnowledgePillar />);
    // The seeded sources first. The mock adds a pasted source the moment the paste is
    // called, so a first list read still in flight came back already holding the note:
    // its size showed while the dialog still read "Adding…", the test ended, and the
    // paste's state updates could land after the environment was torn down.
    expect(await screen.findByText('Services brochure.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Paste text/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Paste text' });
    fireEvent.change(within(dialog).getByLabelText(/Name this/i), {
      target: { value: 'Quick note' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Text$/i), {
      target: { value: 'Open 9-5 weekdays.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add to knowledge/i }));

    // The Modal owns the write: the notice shows, and the dialog closes, only once the
    // paste has answered and the dialog's pending state has cleared.
    expect(
      await screen.findByText('Added “Quick note” to your knowledge base.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The note's own row, from the list read that followed the paste.
    const row = (await screen.findByText('Quick note')).closest('li') as HTMLElement;
    expect(within(row).getByText(/<0\.1 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.0 MB/)).not.toBeInTheDocument();
  });
});
