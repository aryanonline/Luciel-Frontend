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

/** Round 5 item 4: every provider text owns the external-CRM erasure honesty. */
const ERASE_HONESTY = /Erasing or pruning a lead here does not delete the record inside your CRM\./;

describe('Phase 6.5: connected CRMs disclose the exact field mapping', () => {
  it('states the Salesforce mapping including the honest Unknown-at-creation rule', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={crmConnection('salesforce', 'connected')}
      />,
    );
    expect(await screen.findByText(/one Salesforce Lead per person/)).toBeInTheDocument();
    // Round 5: "Unknown" is a record-CREATION rule, and later updates never
    // overwrite what the owner edited in Salesforce.
    expect(
      screen.getByText(/Salesforce requires both at record creation/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a brand-new record without them says “Unknown”/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/never overwrite what you’ve edited in Salesforce/),
    ).toBeInTheDocument();
    expect(screen.getByText(/never reads your CRM/)).toBeInTheDocument();
    expect(screen.getByText(ERASE_HONESTY)).toBeInTheDocument();
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
    expect(screen.getByText(ERASE_HONESTY)).toBeInTheDocument();
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
    expect(screen.getByText(ERASE_HONESTY)).toBeInTheDocument();
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
