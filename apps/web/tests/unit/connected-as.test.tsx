import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { Connection, ConnectionStatus } from '@luciel/api-client';

/**
 * Round 6 WP-C: the post-exchange verifier records WHOSE account authorized
 * (`nonSecretConfig.connectedAs` — the Salesforce org, the HubSpot portal, the
 * Notion workspace…). The card repeats it verbatim while the row is live, and
 * never under an error chip, where a stale identity would read as working.
 */
const row = (status: ConnectionStatus, connectedAs?: string): Connection => ({
  connectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  connectionType: 'crm',
  provider: 'salesforce',
  providerAvailable: true,
  status,
  createdAt: '2026-09-07T10:00:00Z',
  nonSecretConfig: connectedAs ? { connectedAs, orgId: '00D000000000001' } : {},
});

describe('round 6: the connection card says whose account is connected', () => {
  it('repeats the verifier line for a live row', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={row('connected', 'acme.my.salesforce.com · org 00D000000000001 · ops@acme.com')}
      />,
    );
    expect(await screen.findByTestId('connected-as')).toHaveTextContent(
      'Connected as acme.my.salesforce.com · org 00D000000000001 · ops@acme.com.',
    );
  });

  it('says nothing when the verifier recorded nothing', async () => {
    renderWithQuery(
      <ConnectionControl connectionType="crm" label="your CRM" connection={row('connected')} />,
    );
    expect(await screen.findByText(/Connected/i)).toBeInTheDocument();
    expect(screen.queryByTestId('connected-as')).not.toBeInTheDocument();
  });

  it('never shows a stale identity under an error chip', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={row('error', 'acme.my.salesforce.com · org 00D000000000001')}
      />,
    );
    expect(await screen.findByText(/Action needed: your CRM is having trouble/i)).toBeInTheDocument();
    expect(screen.queryByTestId('connected-as')).not.toBeInTheDocument();
  });
});
