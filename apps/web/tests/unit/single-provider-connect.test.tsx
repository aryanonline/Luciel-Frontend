import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { ProviderGroup } from '@luciel/api-client';

/**
 * Owner ruling (scheduling UX): "connect your calendar" should be enough.
 * With a single configured provider the control shows one plain Connect
 * button, and not-yet-available providers appear as quiet information
 * ("coming soon"), never as disabled radios in a one-option quiz.
 *
 * Audit round 3 (owner concern #8): with TWO OR MORE connectable providers
 * there is no radio quiz either — each provider gets its OWN named connect
 * button ("Connect Google Calendar", "Connect Calendly"); an OAuth provider
 * starts its sign-in on the click.
 */

const listProviders = vi.fn<() => Promise<ProviderGroup[]>>();

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

const calendarGroup = (calendlyConfigured: boolean): ProviderGroup[] => [
  {
    connectionType: 'calendar',
    providers: [
      {
        provider: 'google_calendar',
        displayName: 'Google Calendar',
        authKind: 'oauth',
        helpText: 'Offer and book real times from your Google Calendar.',
        configured: true,
      },
      {
        provider: 'calendly',
        displayName: 'Calendly',
        authKind: 'oauth',
        helpText: 'Offer and book times from your Calendly availability.',
        configured: calendlyConfigured,
      },
    ],
  },
];

beforeEach(() => {
  listProviders.mockReset();
});

describe('single configured provider ⇒ one plain Connect button, no radio quiz', () => {
  it('shows "Connect your calendar" and lists the unconfigured provider as coming soon', async () => {
    listProviders.mockResolvedValue(calendarGroup(false));
    renderWithQuery(<ConnectionControl connectionType="calendar" label="your calendar" />);

    // The coming-soon list renders only once the providers query settles, so
    // finding it first guarantees the button assertion sees the loaded state.
    expect(await screen.findByText(/Calendly — coming soon/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect your calendar' })).toBeEnabled();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose how to connect/)).not.toBeInTheDocument();
  });

  it('renders one NAMED connect button per connectable provider — never radios', async () => {
    listProviders.mockResolvedValue(calendarGroup(true));
    renderWithQuery(<ConnectionControl connectionType="calendar" label="your calendar" />);

    expect(
      await screen.findByRole('button', { name: 'Connect Google Calendar' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Connect Calendly' })).toBeEnabled();
    // The radio-then-generic-button two-step is gone (owner concern #8).
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose how to connect/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect your calendar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/)).not.toBeInTheDocument();
  });
});
