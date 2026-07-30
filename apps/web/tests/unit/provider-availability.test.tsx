import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';

/**
 * contract §1, everywhere — not just in the shared connection control. A
 * provider the platform holds no OAuth app for (`configured: false`) is offered
 * DISABLED with the reason; it never gets a live connect button that dead-ends
 * on "Action needed" after the click.
 *
 * The knowledge pillar has its own bespoke connector buttons rather than the
 * shared control, so the rule has to be asserted here separately. Notion is
 * `configured: false` in the served registry today and Google Drive is not.
 */
describe('contract §1: connect affordances follow the served registry', () => {
  it('offers a configured connector as a live connect button', async () => {
    renderWithQuery(<KnowledgePillar />);
    const drive = await screen.findByRole('button', { name: /Connect Google Drive/i });
    expect(drive).toBeEnabled();
  });

  it('offers an unconfigured connector disabled, and never as "Connect"', async () => {
    renderWithQuery(<KnowledgePillar />);
    const notion = await screen.findByRole('button', { name: /Notion — not available yet/i });
    expect(notion).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Connect Notion/i })).not.toBeInTheDocument();
  });
});
