import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import EmbedPage from '@/app/(app)/dashboard/embed/page';

/**
 * Harmony fixes 2026-08-04, FE-H#11a (owner walkthrough on dev).
 *
 * The embed-snippet Copy button already swapped its label to "Copied", but
 * with no other visible or announced signal it read as easy to miss. Now it
 * carries a checkmark glyph (matching StatusChip's "connected" treatment) and
 * an aria role="status" announcement for screen-reader users.
 */
describe('Harmony FE-H#11a: Copy button gives visible + announced "Copied" feedback', () => {
  it('shows a checkmark and announces the copy for assistive tech', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithQuery(<EmbedPage />);
    const copyButton = await screen.findByRole('button', { name: /^Copy$/i });
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /Copied/i })).toBeInTheDocument();
    expect(screen.getByText(/Snippet copied to clipboard\./i)).toBeInTheDocument();
  });
});
