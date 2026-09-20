import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { ConnectionControl } from '@/components/config/connection-control';
import { ChannelsPillar } from '@/components/config/channels-pillar';
import { ToolsPillar } from '@/components/config/tools-pillar';
import DashboardPage from '@/app/(app)/dashboard/page';
import type { Luciel } from '@luciel/api-client';

/**
 * Round 7 WP-10, item 2 — a connection nobody had read rendered "Action needed".
 *
 * Every pillar found its row with `connections.data?.find(...)`, so while
 * GET /connections was still pending, or after it failed, the row was simply
 * absent and the control fell through to `chipKind(undefined) ?? 'action_needed'`:
 * "Action needed: connect X" over a connection that may well be live. Pinned
 * here: the read state is threaded through, an unsettled read renders an
 * explicit "checking…" / "we could not read — retry" note that is never a chip,
 * no connect button is offered on an unknown row, and Overview's attention
 * counter never counts an unread list.
 */

const listBehaviour = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'pending' | 'error' }));
const listCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      connections: {
        ...actual.api.connections,
        list: async () => {
          listCalls.count += 1;
          if (listBehaviour.mode === 'pending') return new Promise(() => {});
          if (listBehaviour.mode === 'error') throw new Error('connections read failed');
          return actual.api.connections.list();
        },
      },
    },
  };
});

const withWhatsApp: Luciel = {
  instanceId: '55555555-5555-4555-8555-555555555555',
  name: 'Test Luciel',
  websiteUrl: 'example.com',
  state: 'active',
  channels: [
    { id: 'widget', enabled: true },
    { id: 'email', enabled: false },
    { id: 'sms', enabled: true, connectionStatus: 'unconfigured' },
    { id: 'voice', enabled: false, connectionStatus: 'unconfigured' },
    { id: 'whatsapp', enabled: true },
    { id: 'messenger', enabled: false },
    { id: 'instagram', enabled: false },
  ],
  tools: [{ id: 'push_to_crm', enabled: true }],
  escalation: { primaryEmail: 'owner@example.com', preferredChannel: 'email' },
  personality: { preset: 'warm_concierge' },
};

beforeEach(() => {
  listBehaviour.mode = 'ok';
  listCalls.count = 0;
});

describe('ConnectionControl with an unsettled connections read', () => {
  it('pending: says it is checking, shows no chip and no connect button', async () => {
    renderWithQuery(
      <ConnectionControl connectionType="crm" label="your CRM" readState="pending" />,
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/Checking the your CRM connection/);
    // Registry read settles; still nothing is claimed or offered.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByText(/Action needed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Connected$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });

  it('error: says the state could not be read, offers a retry, and is never Action needed', async () => {
    const retry = vi.fn();
    renderWithQuery(
      <ConnectionControl
        connectionType="crm"
        label="your CRM"
        readState="error"
        onRetryRead={retry}
      />,
    );
    expect(
      await screen.findByText(/We could not read this connection's state/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByText(/Action needed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });
});

describe('the pillars thread the read state through', () => {
  it('Channels: a pending list renders checking notes on WhatsApp and the phone row, no Action needed', async () => {
    listBehaviour.mode = 'pending';
    renderWithQuery(<ChannelsPillar luciel={withWhatsApp} />);
    expect(await screen.findByText(/Checking the WhatsApp connection/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Checking the Twilio connection/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Action needed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect WhatsApp/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Action needed: connect your Twilio account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Action needed: add your number/i)).not.toBeInTheDocument();
  });

  it('Channels: a failed list renders the retry note and re-reads on Retry', async () => {
    listBehaviour.mode = 'error';
    renderWithQuery(<ChannelsPillar luciel={withWhatsApp} />);
    const notes = await screen.findAllByText(/We could not read this connection's state/i);
    expect(notes.length).toBeGreaterThan(0);
    expect(screen.queryByText(/Action needed/i)).not.toBeInTheDocument();
    const before = listCalls.count;
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listCalls.count).toBeGreaterThan(before);
  });

  it('Tools: a pending list never says "Action needed: connect your CRM"', async () => {
    listBehaviour.mode = 'pending';
    renderWithQuery(<ToolsPillar luciel={withWhatsApp} />);
    expect(await screen.findByText(/Checking the your CRM connection/i)).toBeInTheDocument();
    expect(screen.queryByText(/Action needed/i)).not.toBeInTheDocument();
  });
});

describe('Overview attention counter never counts an unread list', () => {
  it('pending: "Checking your connections…" and no attention count', async () => {
    listBehaviour.mode = 'pending';
    renderWithQuery(<DashboardPage />);
    expect(await screen.findByText(/Checking your connections…/)).toBeInTheDocument();
    expect(screen.queryByText(/need(s)? attention/i)).not.toBeInTheDocument();
  });

  it('error: "We could not check your connections." with a retry, and no attention count', async () => {
    listBehaviour.mode = 'error';
    renderWithQuery(<DashboardPage />);
    expect(await screen.findByText(/We could not check your connections\./)).toBeInTheDocument();
    expect(screen.queryByText(/need(s)? attention/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/All connected and healthy/i)).not.toBeInTheDocument();
  });
});
