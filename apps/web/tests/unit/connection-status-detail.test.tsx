import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { Connection, ConnectionStatus } from '@luciel/api-client';

/**
 * Server `statusDetail` on the generic connection card (round 5, item 3). A
 * not-live row's served detail is the backend's own words about why — it
 * renders as a muted note, EXCEPT the internal `reconnect_pending:` staged-swap
 * marker (never shown raw) and the `*_disconnected` enums the disabledReason
 * note already translates. Sentences render verbatim; a lone snake_case token
 * is de-snaked so a wire enum never reaches the owner as-is.
 *
 * Dormant (downgrade grace) is its own honest state: the chip says the billing
 * truth and NO connect surface renders — the backend refuses connects on a
 * dormant row, so a Connect button would be a dead end.
 */

const row = (status: ConnectionStatus, statusDetail?: string | null): Connection => ({
  connectionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  connectionType: 'crm',
  provider: 'hubspot',
  providerAvailable: true,
  status,
  statusDetail,
  createdAt: '2026-06-01T10:00:00Z',
});

describe('round 5: served statusDetail renders as an honest note on not-live rows', () => {
  it('renders a sentence detail verbatim', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={row('error', 'HubSpot rejected the saved token — reconnect to fix this.')}
      />,
    );
    expect(
      await screen.findByText('HubSpot rejected the saved token — reconnect to fix this.'),
    ).toBeInTheDocument();
  });

  it('de-snakes a lone wire token instead of showing it raw', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={row('error', 'provider_timeout')}
      />,
    );
    expect(await screen.findByText('Provider timeout')).toBeInTheDocument();
    expect(screen.queryByText('provider_timeout')).not.toBeInTheDocument();
  });

  it('never renders the internal reconnect_pending staged-swap marker', async () => {
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        connection={row('not_connected', 'reconnect_pending:hubspot')}
      />,
    );
    // The card still renders its normal chip…
    expect(await screen.findByText(/Action needed/i)).toBeInTheDocument();
    // …but the marker stays internal.
    expect(screen.queryByText(/reconnect_pending/)).not.toBeInTheDocument();
  });

  it('dormant renders the billing copy and offers no Connect button', async () => {
    // Counterfactual first: the same card with a reconnectable status DOES
    // offer provider connect buttons once the registry read settles — proving
    // the dormant branch below is withholding them on purpose.
    const reconnectable = renderWithQuery(
      <ConnectionControl connectionType="crm" label="your CRM" connection={row('not_connected')} />,
    );
    expect(await screen.findByRole('button', { name: /Connect HubSpot/i })).toBeInTheDocument();
    reconnectable.unmount();

    renderWithQuery(
      <ConnectionControl connectionType="crm" label="your CRM" connection={row('dormant')} />,
    );
    expect(
      await screen.findByText(/Action needed: paused until a payment method is added/i),
    ).toBeInTheDocument();
    // Give the registry read the same settle time the counterfactual needed.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /switch/i })).not.toBeInTheDocument();
  });
});
