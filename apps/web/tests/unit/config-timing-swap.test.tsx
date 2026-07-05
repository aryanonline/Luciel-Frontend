import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import ConfigurePage from '@/app/(app)/dashboard/configure/page';
import DashboardPage from '@/app/(app)/dashboard/page';

/**
 * P0-5 (config timing + connection swap), Arch §3.7.1 / §3.8.7 rules E & B,
 * Decision #39:
 *  (a) The config UX must COMMUNICATE when a change takes effect — additive edits
 *      apply to NEW conversations; turning something off takes effect immediately.
 *  (b) Proven-before-cutover swap: swapping a connected account keeps the old one
 *      live until the new one is verified. Distinct from Reconnect.
 */

describe('P0-5: config-timing note on the configure surface', () => {
  it('states additive changes apply to new conversations, disable is immediate', async () => {
    renderWithQuery(<ConfigurePage />);
    expect(
      await screen.findByText(
        /Changes apply to new conversations\. Turning something off takes effect immediately\./i,
      ),
    ).toBeInTheDocument();
  });
});

describe('P0-5: connection swap affordance on the dashboard', () => {
  it('offers "Change connected account" for a connected account', async () => {
    renderWithQuery(<DashboardPage />);
    // seedConnections has a connected google_calendar → swap affordance shows.
    expect(
      await screen.findByRole('button', { name: /Change connected account/i }),
    ).toBeInTheDocument();
  });

  it('reassures that the current connection stays live until the new one is verified', async () => {
    renderWithQuery(<DashboardPage />);
    await screen.findByRole('button', { name: /Change connected account/i });
    expect(
      screen.getByText(/Your current connection stays live until the new one is verified\./i),
    ).toBeInTheDocument();
  });
});
