import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery, seededQueryClient } from './test-utils';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';
import { api } from '@/lib/api';
import { qk } from '@/lib/hooks';

/**
 * Harmony fixes 2026-08-04, FE-H#11b (owner walkthrough on dev).
 *
 * A short paste rounds to "0.0 MB" under the old one-decimal formatter,
 * which reads as empty/failed rather than small. Anything under 0.1 MB
 * (100 KB) now reads "<0.1 MB" instead of a number implying nothing landed.
 */
describe('Harmony FE-H#11b: small knowledge items read "<0.1 MB", never "0.0 MB"', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows "<0.1 MB" for a short pasted note', async () => {
    const paste = vi.spyOn(api.knowledge, 'pasteText');
    // The card's own reads (sources, quota, connections, the sync registry) are served
    // before it renders, so its first render is the settled card and the only reads left
    // are the ones the paste causes.
    const [sources, quota, connections, syncRegistry] = await Promise.all([
      api.knowledge.listSources(),
      api.knowledge.quota(),
      api.connections.list(),
      api.connections.listProviders('knowledge_source'),
    ]);
    const client = seededQueryClient([
      [qk.knowledge, sources],
      [qk.quota, quota],
      [qk.connections, connections],
      [qk.connectionProviders('knowledge_source'), syncRegistry],
    ]);
    renderWithQuery(<KnowledgePillar />, client);
    const list = screen.getByText('Services brochure.pdf').closest('ul') as HTMLElement;

    // A text query for the trigger: a role query over the whole card costs about as much
    // as rendering it, and the role queries below are kept to the dialog.
    fireEvent.click(screen.getByText('Paste text', { selector: 'button' }));
    const dialog = screen.getByRole('dialog', { name: 'Paste text' });
    fireEvent.change(within(dialog).getByLabelText(/Name this/i), {
      target: { value: 'Quick note' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Text$/i), {
      target: { value: 'Open 9-5 weekdays.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to knowledge' }));

    // The Modal owns the write: pending until the paste answers, and only then closed,
    // with the notice. Awaiting the paste itself (inside act, since the card re-renders
    // when it answers) leaves no Modal state to land after the test.
    expect(within(dialog).getByRole('button', { name: 'Adding…' })).toBeDisabled();
    await act(async () => {
      await paste.mock.results[0]!.value;
    });
    expect(screen.getByText('Added “Quick note” to your knowledge base.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The note's own row, from the list read that followed the paste.
    const row = (await within(list).findByText('Quick note')).closest('li') as HTMLElement;
    expect(within(row).getByText(/<0\.1 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.0 MB/)).not.toBeInTheDocument();
    // The paste's other re-read (the quota) has answered too: nothing is left in flight.
    await waitFor(() => expect(client.isFetching()).toBe(0));
  });
});
