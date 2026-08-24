import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { ProviderGroup } from '@luciel/api-client';

/**
 * #5a (live-caught on the 2026-08-23 dev walkthrough): the server writes the
 * dependent-tool hold-off reason as `{connection_type}_disconnected`
 * (service.py), and the owner read the raw wire enum — "Held off by your CRM:
 * crm_disconnected". Known reasons get a plain instruction; unknown future
 * reasons are de-snaked, never shown as wire enums.
 */

const listProviders = vi.fn<[], Promise<ProviderGroup[]>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        listProviders: () => listProviders(),
      },
    },
  };
});

const crmProviders: ProviderGroup[] = [
  {
    connectionType: 'crm',
    providers: [
      {
        provider: 'hubspot',
        displayName: 'HubSpot',
        authKind: 'oauth',
        helpText: 'Keep HubSpot contacts current.',
        configured: true,
      },
    ],
  },
];

beforeEach(() => {
  listProviders.mockReset().mockResolvedValue(crmProviders);
});

describe('#5a: dependent-tool hold-off reason copy', () => {
  it('translates {type}_disconnected into a plain instruction — never the raw enum', async () => {
    renderWithQuery(
      <ConnectionControl connectionType="crm" label="your CRM" disabledReason="crm_disconnected" />,
    );
    expect(
      await screen.findByText('Luciel cannot use this until you connect your CRM again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/crm_disconnected/)).not.toBeInTheDocument();
  });

  it('de-snakes unknown future reasons instead of leaking wire enums', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        disabledReason="credential_rotation_pending"
      />,
    );
    expect(
      await screen.findByText('Held off by your CRM: credential rotation pending.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/credential_rotation_pending/)).not.toBeInTheDocument();
  });
});
