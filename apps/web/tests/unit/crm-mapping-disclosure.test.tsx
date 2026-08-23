import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { Connection } from '@luciel/api-client';

/**
 * CRM field-mapping disclosure (Phase 6.5 — the Customer Journey's "confirms
 * the field mapping" beat). Once a CRM is CONNECTED, the control states exactly
 * what Luciel writes and how it dedupes — including Salesforce's honest
 * "Unknown" fallback for its required Last Name / Company. Read-only: the
 * mapping is fixed, not an editor. Nothing renders before connect.
 */

const crmConnection = (provider: string, status: Connection['status']): Connection => ({
  connectionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  connectionType: 'crm',
  provider,
  providerAvailable: true,
  status,
  createdAt: '2026-06-01T10:00:00Z',
  lastHealthCheckAt: '2026-06-14T10:00:00Z',
});

describe('Phase 6.5: connected CRMs disclose the exact field mapping', () => {
  it('states the Salesforce mapping including the honest Unknown fallback', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={crmConnection('salesforce', 'connected')}
      />,
    );
    expect(await screen.findByText(/one Salesforce Lead per person/)).toBeInTheDocument();
    expect(screen.getByText(/Luciel writes “Unknown” rather than inventing/)).toBeInTheDocument();
    expect(screen.getByText(/never reads your CRM/)).toBeInTheDocument();
  });

  it('states the HubSpot mapping', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={crmConnection('hubspot', 'connected')}
      />,
    );
    expect(await screen.findByText(/one HubSpot contact per lead/)).toBeInTheDocument();
  });

  it('states the webhook contract for the custom endpoint', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={crmConnection('custom_webhook', 'connected')}
      />,
    );
    expect(await screen.findByText(/deduping is your endpoint’s half/)).toBeInTheDocument();
  });

  it('renders no mapping copy before the CRM is connected', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={crmConnection('salesforce', 'unconfigured')}
      />,
    );
    expect(await screen.findByText(/Not connected|Action needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/What Luciel writes/)).not.toBeInTheDocument();
  });
});
