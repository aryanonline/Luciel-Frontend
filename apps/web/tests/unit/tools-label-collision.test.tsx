import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import ConfigurePage from '@/app/(app)/dashboard/configure/page';
import { toolMeta } from '@/components/config/labels';
import { api } from '@/lib/api';

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
    renderWithQuery(<ConfigurePage />);
    expect(
      await screen.findByRole('switch', { name: /Enable Post to my own endpoint/i }),
    ).toBeInTheDocument();
    // The one left is the CRM destination — since the Phase-4 rework it renders
    // as that provider's own named connect button inside the CRM control.
    expect(await screen.findAllByRole('button', { name: 'Connect Custom webhook' })).toHaveLength(
      1,
    );
    expect(screen.queryAllByText('Custom webhook')).toHaveLength(0);
  });
});
