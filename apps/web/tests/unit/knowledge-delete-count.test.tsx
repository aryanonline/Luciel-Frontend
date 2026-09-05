import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';

/**
 * §3.2.2 delete-confirmation truth (audit round 3, C14/C15): the confirmation
 * used to claim "Recent customer questions used this source." for every source,
 * used or not. With the durable retrieval trace the modal now states the REAL
 * 7-day count served per source — and an honest "no questions used this" when
 * that is the truth. Mock fixtures: 'Services brochure.pdf' → 12,
 * 'Google Drive — Service playbooks' → 0.
 */
function deleteRow(name: RegExp) {
  const row = screen.getByText(name).closest('li');
  expect(row).not.toBeNull();
  fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Delete' }));
}

describe('knowledge source delete confirmation states the real 7-day usage', () => {
  it('shows the served count for a source recent answers drew on', async () => {
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Services brochure.pdf');
    deleteRow(/Services brochure\.pdf/);
    expect(
      await screen.findByText(/12 customer questions in the last 7 days drew on this source\./),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Recent customer questions used this source\./),
    ).not.toBeInTheDocument();
  });

  it('says honestly when no recent questions used the source', async () => {
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Google Drive — Service playbooks');
    deleteRow(/Service playbooks/);
    expect(
      await screen.findByText(/No customer questions in the last 7 days used this source\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\d+ customer questions? in the last 7 days/)).not.toBeInTheDocument();
  });
});

/**
 * 2026-09-05 audit F109: a delete is a tombstone for 30 days, so the notice that
 * confirms it carries an Undo, and undoing brings the source back into the list.
 */
describe('knowledge source delete is undoable for 30 days', () => {
  it('offers Undo after a delete and restores the source when clicked', async () => {
    renderWithQuery(<KnowledgePillar />);
    await screen.findByText('Services brochure.pdf');
    deleteRow(/Services brochure\.pdf/);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete source' }));
    await screen.findByText(/You can undo this for 30 days/);
    await waitFor(() =>
      expect(screen.queryByText('Services brochure.pdf')).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText(/Restored “Services brochure\.pdf”/);
    expect(await screen.findByText('Services brochure.pdf')).toBeInTheDocument();
  });
});
