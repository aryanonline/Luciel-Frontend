import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import DashboardPage from '@/app/(app)/dashboard/page';

/**
 * Harmony fixes 2026-08-04, FE-H#10 (owner walkthrough on dev).
 *
 * The owner reported seeing the free-plan budget sentence cut mid-word
 * ("...it never changes your L..."). The source string was already complete
 * with no truncating container in its ancestry, so the likely cause was a
 * stale build on dev -- but the sentence is reworded here regardless: the
 * ambiguous "it" is resolved, and "Luciel" is kept as the deliberate last
 * word so nothing trails it that a truncating container could catch.
 */
describe('Harmony FE-H#10: the free-plan budget sentence renders in full', () => {
  it('ends on the word "Luciel." with the "it" made unambiguous', async () => {
    renderWithQuery(<DashboardPage />);
    expect(
      await screen.findByText(
        'Free plan: 50 conversations per billing period. Add a card to keep it answering past 50 — adding a card never changes your Luciel.',
      ),
    ).toBeInTheDocument();
  });

  it('never renders the truncated fragment the owner saw', async () => {
    renderWithQuery(<DashboardPage />);
    await screen.findByText(/Free plan: 50 conversations per billing period/i);
    expect(screen.queryByText(/your L\.\.\.$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/it never changes your Luciel\.$/)).not.toBeInTheDocument();
  });
});
