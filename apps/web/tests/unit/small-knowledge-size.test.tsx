import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithQuery, seededQueryClient } from './test-utils';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';
import { api } from '@/lib/api';
import { qk } from '@/lib/hooks';

// The same mock API minus its artificial 150 ms a call: this test is about what a short
// paste looks like in the list, not about how long a call pends.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  const { createLucielClient } = await import('@luciel/api-client');
  return { ...actual, api: createLucielClient({ adapter: 'mock', mock: { latencyMs: 0 } }) };
});

/**
 * Harmony fixes 2026-08-04, FE-H#11b (owner walkthrough on dev).
 *
 * A short paste rounds to "0.0 MB" under the old one-decimal formatter,
 * which reads as empty/failed rather than small. Anything under 0.1 MB
 * (100 KB) now reads "<0.1 MB" instead of a number implying nothing landed.
 */
describe('Harmony FE-H#11b: small knowledge items read "<0.1 MB", never "0.0 MB"', () => {
  it('shows "<0.1 MB" for a short pasted note', async () => {
    // The note goes in through the call the Paste text dialog makes, and the card renders
    // on the sources the mock then serves, so its first render is the settled list. The
    // dialog itself (failure kept in it, the success notice, the list read again) is
    // knowledge-pillar-ux's to test; driving it here as well cost this one-check test
    // most of its budget on a busy machine.
    await api.knowledge.pasteText({ name: 'Quick note', text: 'Open 9-5 weekdays.' });
    const [sources, quota, connections, syncRegistry] = await Promise.all([
      api.knowledge.listSources(),
      api.knowledge.quota(),
      api.connections.list(),
      api.connections.listProviders('knowledge_source'),
    ]);
    renderWithQuery(
      <KnowledgePillar />,
      seededQueryClient([
        [qk.knowledge, sources],
        [qk.quota, quota],
        [qk.connections, connections],
        [qk.connectionProviders('knowledge_source'), syncRegistry],
      ]),
    );

    const row = screen.getByText('Quick note').closest('li') as HTMLElement;
    expect(within(row).getByText(/<0\.1 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.0 MB/)).not.toBeInTheDocument();
  });
});
