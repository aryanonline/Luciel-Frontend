import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import DashboardPage from '@/app/(app)/dashboard/page';

/**
 * Harmony fixes 2026-08-04, FE-H#6 + FE-H#7 (owner walkthrough on dev).
 *
 * FE-H#6: the Overview Connections panel must never print raw registry enums
 * ("Sms_sender · Twilio", "Email_sender · Ses", "Channel_auth · Meta") — only
 * human labels, drawn from the same served catalog / word list Configure uses.
 *
 * FE-H#7: Overview must not present a provider as an actionable connected
 * account when Configure's served registry calls it `configured: false`
 * (honest-disabled). `seedConnections` connects `calendar/google_calendar`,
 * but `seedConnectionProviders` marks every `calendar` provider
 * `configured: false` — exactly the disagreement the walkthrough hit.
 */
describe('Harmony FE-H#6: Connections panel uses human labels, never raw enums', () => {
  it('never renders a raw snake_case connectionType or Capitalized_Enum on the page', async () => {
    renderWithQuery(<DashboardPage />);
    await screen.findByText(/Knowledge source/i);
    expect(screen.queryByText(/calendar_/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sms_sender/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Email_sender/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Channel_auth/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/knowledge_source/)).not.toBeInTheDocument();
  });

  it('labels the calendar row "Calendar" and the provider by its served display name', async () => {
    renderWithQuery(<DashboardPage />);
    expect(await screen.findByText(/Calendar · Google Calendar/i)).toBeInTheDocument();
  });

  it('labels the CRM row "CRM" with the served provider display name', async () => {
    renderWithQuery(<DashboardPage />);
    expect(await screen.findByText(/CRM · HubSpot/i)).toBeInTheDocument();
  });

  it('labels the knowledge row "Knowledge source" with the served provider display name', async () => {
    renderWithQuery(<DashboardPage />);
    expect(await screen.findByText(/Knowledge source · Google Drive/i)).toBeInTheDocument();
  });
});

describe('Harmony FE-H#7: Overview agrees with Configure on honest-disabled providers', () => {
  it('does not offer "Change connected account" for a connected provider the registry marks configured: false', async () => {
    renderWithQuery(<DashboardPage />);
    // Wait for the panel to settle before asserting an absence.
    await screen.findByText(/Calendar · Google Calendar/i);
    // google_calendar is `connected` in seedConnections but `configured: false`
    // in seedConnectionProviders — Overview must not treat it as swappable.
    const calendarRow = screen.getByText(/Calendar · Google Calendar/i).closest('li');
    expect(calendarRow).not.toBeNull();
    expect(
      within(calendarRow as HTMLElement).queryByRole('button', { name: /Change connected account/i }),
    ).not.toBeInTheDocument();
  });

  it('still offers "Change connected account" for a connected, configured provider (Google Drive)', async () => {
    renderWithQuery(<DashboardPage />);
    await screen.findByText(/Knowledge source · Google Drive/i);
    expect(
      (await screen.findAllByRole('button', { name: /Change connected account/i })).length,
    ).toBeGreaterThan(0);
  });
});

describe('Harmony wave 2, item 6a: a registry-unconfigured connection row is never told "Action needed"', () => {
  it('shows the non-actionable "Not available yet" chip — never "Action needed" — for a never-connected row whose provider the registry marks configured: false', async () => {
    renderWithQuery(<DashboardPage />);
    // Fixture: channel_auth/meta is `status: 'unconfigured'` in seedConnections
    // and `configured: false` in seedConnectionProviders — there is no OAuth
    // app on this environment, so there is no action the owner can take.
    const metaLabel = await screen.findByText(/Meta sign-in · Meta/i);
    const metaRow = metaLabel.closest('li');
    expect(metaRow).not.toBeNull();
    expect(within(metaRow as HTMLElement).getByText(/Not available yet/i)).toBeInTheDocument();
    expect(within(metaRow as HTMLElement).queryByText(/^Action needed/i)).not.toBeInTheDocument();
  });

  it('still shows "Reconnect needed" — an actionable state — for the expired, registry-configured HubSpot connection', async () => {
    renderWithQuery(<DashboardPage />);
    const hubspotLabel = await screen.findByText(/CRM · HubSpot/i);
    const hubspotRow = hubspotLabel.closest('li');
    expect(hubspotRow).not.toBeNull();
    expect(within(hubspotRow as HTMLElement).getByText(/Reconnect needed/i)).toBeInTheDocument();
  });
});

