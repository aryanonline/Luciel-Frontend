import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
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
    fireEvent.click(await screen.findByRole('button', { name: /Paste text/i }));
    fireEvent.change(screen.getByLabelText(/Name this/i), { target: { value: 'Quick note' } });
    fireEvent.change(screen.getByLabelText(/^Text$/i), { target: { value: 'Open 9-5 weekdays.' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to knowledge/i }));
    expect(await screen.findByText(/<0\.1 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.0 MB/)).not.toBeInTheDocument();
  });
});
