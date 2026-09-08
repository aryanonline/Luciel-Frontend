import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ToolsPillar } from '@/components/config/tools-pillar';
import type {
  CalendlyEventTypes,
  CapabilityGroup,
  Connection,
  ConnectionProviders,
  Luciel,
} from '@luciel/api-client';

/**
 * Round 6 WP-H (F055): Calendly books ONE event type, so a connected Calendly
 * calendar shows which one customers book and lets the owner change it — validated
 * server-side, refetched after the write. When Calendly cannot be read the control
 * says so instead of showing an empty list, and a Google calendar shows no picker.
 */

const ROW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INTRO = 'https://api.calendly.com/event_types/intro';
const VISIT = 'https://api.calendly.com/event_types/visit';

const updateSettings = vi.fn();
const served = vi.hoisted(() => ({
  connections: [] as Connection[],
  types: null as CalendlyEventTypes | null,
}));

const GROUPS: CapabilityGroup[] = [
  {
    capability: 'scheduling',
    label: 'Appointment scheduling',
    helpText: 'Offer, book, move or cancel appointments.',
    toolIds: ['check_availability', 'book_appointment'],
    connectionType: 'calendar',
  },
];

const CATALOG: ConnectionProviders[] = [
  {
    connectionType: 'calendar',
    providers: [
      {
        provider: 'calendly',
        displayName: 'Calendly',
        authKind: 'oauth',
        helpText: 'Offer and book times from your Calendly availability.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
      {
        provider: 'google_calendar',
        displayName: 'Google Calendar',
        authKind: 'oauth',
        helpText: 'Offer and book real times from your Google Calendar.',
        configured: true,
        credentialFields: [],
        scopeKind: null,
      },
    ],
  },
];

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      luciel: { ...actual.api.luciel, capabilities: async () => GROUPS },
      connections: {
        ...actual.api.connections,
        list: async () => served.connections,
        listProviders: async (connectionType?: string) =>
          connectionType ? CATALOG.filter((g) => g.connectionType === connectionType) : CATALOG,
        listCalendlyEventTypes: async () => {
          if (!served.types) throw new Error('unreadable');
          return served.types;
        },
        updateSettings: (...args: unknown[]) => Promise.resolve(updateSettings(...args)),
      },
    },
  };
});

const luciel: Luciel = {
  instanceId: '44444444-4444-4444-8444-444444444444',
  name: 'Aurora',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [{ id: 'widget', enabled: true }],
  tools: [
    { id: 'check_availability', enabled: true, connectionStatus: 'connected' },
    { id: 'book_appointment', enabled: true, connectionStatus: 'connected' },
  ],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

const calendlyRow = (config: Record<string, unknown>): Connection => ({
  connectionId: ROW_ID,
  connectionType: 'calendar',
  provider: 'calendly',
  displayName: 'Calendly',
  providerAvailable: true,
  status: 'connected',
  createdAt: '2026-09-01T10:00:00Z',
  nonSecretConfig: { userUri: 'https://api.calendly.com/users/U', ...config },
});

const twoTypes = (chosenUri: string | null): CalendlyEventTypes => ({
  chosenUri,
  eventTypes: [
    { uri: INTRO, name: 'Intro call', active: true, durationMinutes: 15, schedulingUrl: 'x' },
    { uri: VISIT, name: 'Site visit', active: true, durationMinutes: 60, schedulingUrl: 'y' },
  ],
});

beforeEach(() => {
  updateSettings.mockReset();
  served.connections = [];
  served.types = null;
});

describe('Calendly event type (round 6 WP-H)', () => {
  it('shows what customers book and switches it through PUT /settings', async () => {
    served.connections = [calendlyRow({ eventTypeUri: INTRO, eventTypeName: 'Intro call' })];
    served.types = twoTypes(INTRO);
    updateSettings.mockImplementation(async (_id: string, req: { eventTypeUri: string }) => {
      served.types = twoTypes(req.eventTypeUri);
      served.connections = [
        calendlyRow({ eventTypeUri: req.eventTypeUri, eventTypeName: 'Site visit' }),
      ];
      return served.connections[0];
    });
    renderWithQuery(<ToolsPillar luciel={luciel} />);

    const note = await screen.findByTestId('calendly-event-type');
    await waitFor(() => expect(note).toHaveTextContent(/Customers book Intro call \(15 min\)/));

    fireEvent.click(screen.getByRole('button', { name: /Change event type/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Use Site visit/i }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(ROW_ID, {
        eventTypeUri: VISIT,
        eventTypeName: 'Site visit',
      }),
    );
    await screen.findByText(/Customers now book "Site visit"\./);
    await waitFor(() =>
      expect(screen.getByTestId('calendly-event-type')).toHaveTextContent(
        /Customers book Site visit \(60 min\)/,
      ),
    );
  });

  it('says when Calendly could not be read instead of showing an empty picker', async () => {
    served.connections = [calendlyRow({ eventTypeUri: INTRO, eventTypeName: 'Intro call' })];
    served.types = { chosenUri: INTRO, eventTypes: null };
    renderWithQuery(<ToolsPillar luciel={luciel} />);

    await screen.findByText(/Calendly would not let us read your event types/i);
    expect(screen.queryByRole('button', { name: /Change event type/i })).not.toBeInTheDocument();
    // The stored choice still reads back from the row itself.
    expect(screen.getByTestId('calendly-event-type')).toHaveTextContent(
      /Customers book Intro call/,
    );
  });

  it('asks the owner to pick one when none is chosen yet', async () => {
    served.connections = [calendlyRow({})];
    served.types = twoTypes(null);
    renderWithQuery(<ToolsPillar luciel={luciel} />);

    await screen.findByText(/No event type is chosen yet/i);
    fireEvent.click(await screen.findByRole('button', { name: /Choose event type/i }));
    expect(await screen.findByRole('button', { name: /Use Intro call/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Use Site visit/i })).toBeEnabled();
  });

  it('renders no picker for a Google calendar', async () => {
    served.connections = [
      { ...calendlyRow({}), provider: 'google_calendar', displayName: 'Google Calendar' },
    ];
    served.types = twoTypes(null);
    renderWithQuery(<ToolsPillar luciel={luciel} />);

    await screen.findByRole('switch', { name: /Enable Appointment scheduling/i });
    expect(screen.queryByTestId('calendly-event-type')).not.toBeInTheDocument();
  });
});
