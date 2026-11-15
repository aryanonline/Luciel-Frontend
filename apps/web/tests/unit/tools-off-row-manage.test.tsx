import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithQuery, seededQueryClient } from './test-utils';
import { ToolsPillar } from '@/components/config/tools-pillar';
import type { Luciel } from '@luciel/api-client';
import { api } from '@/lib/api';
import { qk } from '@/lib/hooks';

/**
 * Round 7 WP-10, item 3 — tools off-rows had no way to disconnect or re-point a
 * connected account while the tool was off; channels already carried a
 * "Manage connection" disclosure (round 6 WP-D). Pinned here against the mock
 * seed (calendar google_calendar connected; crm hubspot expired): an OFF
 * capability and an OFF standalone tool each expose the disclosure, and the
 * control inside offers the real actions — never a "Connect" on a saved row.
 */
const allOff: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'sms', enabled: false },
    { id: 'email', enabled: false },
    { id: 'voice', enabled: false },
    { id: 'whatsapp', enabled: false },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [
    { id: 'book_appointment', enabled: false },
    { id: 'check_availability', enabled: false },
    { id: 'reschedule_appointment', enabled: false },
    { id: 'cancel_appointment', enabled: false },
    { id: 'push_to_crm', enabled: false },
    { id: 'lookup_record', enabled: false },
    { id: 'schedule_callback', enabled: false },
  ],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  escalationContactHealth: [],
  personality: { preset: 'warm_concierge' },
  leadRetentionDays: null,
};

const rowOf = (toggleName: RegExp): HTMLElement => {
  const row = screen.getByRole('switch', { name: toggleName }).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

/**
 * The card's reads served by the mock up front (capabilities, connections and every
 * provider registry), so the first render is the settled card: what a row offers, and
 * what it does not, is checked against reads that have landed.
 */
async function renderSettled() {
  const [capabilities, connections, registry] = await Promise.all([
    api.luciel.capabilities(),
    api.connections.list(),
    api.connections.listProviders(),
  ]);
  renderWithQuery(
    <ToolsPillar luciel={allOff} />,
    seededQueryClient([
      [qk.capabilities, capabilities],
      [qk.connections, connections],
      ...registry.map((group) => [qk.connectionProviders(group.connectionType), [group]] as const),
    ]),
  );
}

describe('tools off-rows keep their saved connection manageable', () => {
  it('an OFF capability with a connected calendar offers Manage connection → Disconnect', async () => {
    await renderSettled();
    const row = rowOf(/Enable Appointment scheduling/i);
    expect(
      within(row).getByText(/Its connection is saved — nothing to set up again/i),
    ).toBeInTheDocument();
    fireEvent.click(within(row).getByText('Manage connection'));
    expect(within(row).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Switch account/i })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^Connect /i })).not.toBeInTheDocument();
  });

  it('an OFF standalone tool with an expired CRM offers Manage connection → Reconnect', async () => {
    await renderSettled();
    const row = rowOf(/Enable Push leads to my CRM/i);
    expect(within(row).getByText(/Its saved connection needs a reconnect/i)).toBeInTheDocument();
    fireEvent.click(within(row).getByText('Manage connection'));
    // The saved provider is reconnected; the other CRMs are a switch away (never a
    // "Connect", which would reconnect HubSpot under another provider's name).
    expect(within(row).getByRole('button', { name: 'Reconnect HubSpot' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Switch to Salesforce' })).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: 'Switch to Custom webhook' }),
    ).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^Connect /i })).not.toBeInTheDocument();
    expect(within(row).getByText(/Reconnect needed/i)).toBeInTheDocument();
  });

  it('an OFF tool with nothing saved shows no disclosure', async () => {
    await renderSettled();
    // The connection read has landed: the saved CRM row has its disclosure…
    expect(
      within(rowOf(/Enable Push leads to my CRM/i)).getByText('Manage connection'),
    ).toBeInTheDocument();
    // …and the seed has no record_source row, so there is nothing to manage here.
    const row = rowOf(/Enable Look up a record/i);
    expect(within(row).queryByText('Manage connection')).not.toBeInTheDocument();
  });
});
