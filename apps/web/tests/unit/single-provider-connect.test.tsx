import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import type { ProviderGroup } from '@luciel/api-client';

/**
 * Owner ruling (scheduling UX): "connect your calendar" should be enough.
 * Radios are a real choice only when TWO OR MORE providers can actually be
 * connected. With a single configured provider the control shows one plain
 * Connect button, and not-yet-available providers appear as quiet information
 * ("coming soon"), never as disabled radios in a one-option quiz.
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

  it('still offers the radio choice when two providers are genuinely connectable', async () => {
    listProviders.mockResolvedValue(calendarGroup(true));
    renderWithQuery(<ConnectionControl connectionType="calendar" label="your calendar" />);

    expect(await screen.findByText(/Choose how to connect your calendar/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByText(/coming soon/)).not.toBeInTheDocument();
  });
});
