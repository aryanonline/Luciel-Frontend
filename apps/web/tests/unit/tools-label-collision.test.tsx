import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery, seededQueryClient } from './test-utils';
import { ToolsPillar } from '@/components/config/tools-pillar';
import { toolMeta } from '@/components/config/labels';
import { api } from '@/lib/api';
import { qk } from '@/lib/hooks';

/**
 * Two different things must not arrive under Tools wearing the same name.
 *
 * The served CRM registry offers a `custom_webhook` PROVIDER — where captured
 * leads go instead of a CRM — and `bring_your_own_webhook` is a separate TOOL
 * on its own `outbound_webhook` connection. Both rendered the words "Custom
 * webhook" into the same list, so an owner could set one up believing they had
 * set up the other. The provider's name is the backend's to choose, so the tool
 * label is the one that had to move.
 */

describe('Tools pillar: no two entries share a name', () => {
  it('no add-on tool is named after a served provider', async () => {
    const groups = await api.connections.listProviders();
    const providerNames = new Set(
      groups.flatMap((group) => group.providers).map((option) => option.displayName),
    );
    const collisions = Object.values(toolMeta)
      .map((meta) => meta.label)
      .filter((label) => providerNames.has(label));
    expect(collisions).toEqual([]);
  });

  it('names the own-endpoint tool as its own thing, leaving one Custom webhook', async () => {
    // The served Luciel and every read the Tools card renders from (capabilities,
    // connections, each provider registry) are in hand before the card renders, so its
    // first render is the settled card: nothing here waits on a read, and nothing that
    // has not landed yet can be missed. The card alone is rendered, not all of Configure.
    const [luciel, capabilities, connections, registry] = await Promise.all([
      api.luciel.get(),
      api.luciel.capabilities(),
      api.connections.list(),
      api.connections.listProviders(),
    ]);
    renderWithQuery(
      <ToolsPillar luciel={luciel!} />,
      seededQueryClient([
        [qk.capabilities, capabilities],
        [qk.connections, connections],
        ...registry.map(
          (group) => [qk.connectionProviders(group.connectionType), [group]] as const,
        ),
      ]),
    );
    expect(
      screen.getByRole('switch', { name: /Enable Post to my own endpoint/i }),
    ).toBeInTheDocument();
    // The one left is the CRM destination: since the Phase-4 rework it is that provider's
    // own named button inside the CRM control ("Switch to Custom webhook" on the seed's
    // expired HubSpot row).
    expect(screen.getAllByRole('button', { name: /Custom webhook/ })).toHaveLength(1);
    expect(screen.queryAllByText('Custom webhook')).toHaveLength(0);
  });
});
