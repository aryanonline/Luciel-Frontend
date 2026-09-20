import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { ConnectionProviders } from '@luciel/api-client';

/**
 * Round 7 WP-10, item 1 — the CSV record-source dead end.
 *
 * The served registry marks `csv` as `authKind: 'provisioned'` with no credential
 * fields: a platform-provisioned resource, connected by the upload under
 * Knowledge → records and nothing else. The control's "provided elsewhere" guard
 * only matched a credential form with no fields, so against the real backend the
 * lookup tool rendered a "Connect CSV upload" button whose click ended in the raw
 * error "Provider 'csv' does not take a credential form." Pinned here: a
 * provisioned option never gets a connect button — alone, or beside a connectable
 * sibling — and the control says where the upload happens instead.
 */

/** Served registry override; null falls through to the mock adapter. */
const served = vi.hoisted(() => ({ providers: null as ConnectionProviders[] | null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        listProviders: async (connectionType?: string) =>
          served.providers
            ? served.providers.filter((g) => !connectionType || g.connectionType === connectionType)
            : actual.api.connections.listProviders(connectionType as never),
      },
    },
  };
});

const recordSourceGroup = (liveConnectorConfigured: boolean): ConnectionProviders[] => [
  {
    connectionType: 'record_source',
    providers: [
      {
        provider: 'live_connector',
        displayName: 'Live connector',
        authKind: 'credential_form',
        helpText: 'Look records up live from your own system.',
        configured: liveConnectorConfigured,
        credentialFields: [{ name: 'url', label: 'Record lookup URL', secret: false, required: true }],
        scopeKind: null,
      },
      {
        provider: 'csv',
        displayName: 'CSV upload',
        authKind: 'provisioned',
        helpText: 'Upload a spreadsheet of records; re-upload to refresh.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
    ],
  },
];

beforeEach(() => {
  served.providers = null;
});

describe('a provisioned record source is set up under Knowledge, never connected here', () => {
  it('on the mock adapter (served as the backend serves it): no connect button, the upload note', async () => {
    renderWithQuery(<ConnectionControl connectionType="record_source" label="your record system" />);
    expect(
      await screen.findByText(/upload your CSV under Knowledge → records/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/i })).not.toBeInTheDocument();
    // The served help text rides along with the note, never a raw enum.
    expect(screen.getByText(/re-upload to refresh/i)).toBeInTheDocument();
  });

  it('beside a connectable sibling, the sibling gets a button and csv gets the note', async () => {
    served.providers = recordSourceGroup(true);
    renderWithQuery(<ConnectionControl connectionType="record_source" label="your record system" />);
    expect(
      await screen.findByRole('button', { name: 'Connect Live connector' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CSV upload/i })).not.toBeInTheDocument();
    expect(screen.getByText(/upload your CSV under Knowledge → records/i)).toBeInTheDocument();
  });

  it('with the sibling unavailable, csv alone still renders the note and no button', async () => {
    served.providers = recordSourceGroup(false);
    renderWithQuery(<ConnectionControl connectionType="record_source" label="your record system" />);
    expect(
      await screen.findByText(/upload your CSV under Knowledge → records/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/does not take a credential form/i)).not.toBeInTheDocument();
  });
});
