import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import LeadsPage from '@/app/(app)/dashboard/leads/page';
import { describeCrmDetail } from '@/lib/crm-detail';
import { api } from '@/lib/api';
import type { Lead } from '@luciel/api-client';
import { LucielApiError } from '@luciel/api-client';

/**
 * 2026-09-05 audit WP6 (F134 / F112 / F111):
 *  - a lead that did not reach the CRM says so, shows the recorded reason, and
 *    offers a retry whose 409 reason is shown verbatim;
 *  - archived leads stay out of the active view unless asked for;
 *  - the stale window follows the tenant's own auto-prune window;
 *  - erasure is offered per lead under its own name with the legal copy;
 *  - the volunteered phone renders as a second identifier line.
 */

const lead = (over: Partial<Lead>): Lead => ({
  leadId: '11111111-1111-4111-8111-111111111111',
  name: 'Jordan P.',
  contactIdentifier: 'jordan@example.com',
  intent: 'Deck quote',
  state: 'active',
  outcome: 'in_progress',
  lastActivityAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-08-01T00:00:00Z',
  ...over,
});

const failed = lead({ crmStatus: 'failed', crmDetail: 'crm_error: hubspot_create_http_400' });
const archived = lead({
  leadId: '22222222-2222-4222-8222-222222222222',
  name: 'Sam Archived',
  contactIdentifier: 'sam@example.com',
  state: 'archived',
});
const synced = lead({
  leadId: '33333333-3333-4333-8333-333333333333',
  name: 'Dana Phone',
  contactIdentifier: 'dana@example.com',
  phone: '+16045550100',
  crmStatus: 'synced',
  crmPushedAt: '2026-09-02T00:00:00Z',
});

describe('leads page: CRM state, archive filter, erase, stale window', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says a lead is not in the CRM, with the recorded reason, and retries it', async () => {
    vi.spyOn(api.leads, 'list').mockResolvedValue([failed, synced]);
    const retry = vi
      .spyOn(api.leads, 'retryCrmPush')
      .mockResolvedValue({ ...failed, crmStatus: 'synced', crmDetail: null });
    renderWithQuery(<LeadsPage />);
    const row = (await screen.findByText('Jordan P.')).closest('li') as HTMLElement;
    expect(screen.getByText(/1 lead did not reach your CRM/)).toBeInTheDocument();
    expect(
      within(row).getByText(/Not in your CRM — your CRM rejected the record \(400\)/),
    ).toBeInTheDocument();
    const other = screen.getByText('Dana Phone').closest('li') as HTMLElement;
    expect(within(other).getByText('in your CRM')).toBeInTheDocument();
    expect(within(other).getByText('also: +16045550100')).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Retry CRM push' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(failed.leadId));
    expect(await screen.findByText('Jordan P. is now in your CRM.')).toBeInTheDocument();
  });

  it('shows the 409 reason when the retry could not even be attempted', async () => {
    vi.spyOn(api.leads, 'list').mockResolvedValue([failed]);
    vi.spyOn(api.leads, 'retryCrmPush').mockRejectedValue(
      new LucielApiError({
        code: 'conflict',
        message: 'The push was not attempted: the Push to CRM tool is switched off.',
      }),
    );
    renderWithQuery(<LeadsPage />);
    await screen.findByText('Jordan P.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry CRM push' }));
    expect(
      await screen.findByText('The push was not attempted: the Push to CRM tool is switched off.'),
    ).toBeInTheDocument();
  });

  it('keeps archived leads out of the active view until asked', async () => {
    vi.spyOn(api.leads, 'list').mockResolvedValue([lead({}), archived]);
    renderWithQuery(<LeadsPage />);
    await screen.findByText('Jordan P.');
    expect(screen.queryByText('Sam Archived')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Show archived leads \(1\)/));
    expect(await screen.findByText('Sam Archived')).toBeInTheDocument();
    expect(screen.getByText(/archived \(kept\)/)).toBeInTheDocument();
  });

  it('uses a one-year stale window by default and names erasure for what it is', async () => {
    vi.spyOn(api.leads, 'list').mockResolvedValue([lead({})]);
    renderWithQuery(<LeadsPage />);
    await screen.findByText('Jordan P.');
    expect(screen.getByText(/no activity for over 365 days/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is deleted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Erase Jordan P.'s data" }));
    expect(await screen.findByText("Erase this lead's data?")).toBeInTheDocument();
    expect(screen.getByText(/right-to-erasure action/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erase permanently' })).toBeInTheDocument();
  });
});

describe('describeCrmDetail', () => {
  it('turns the backend reason tokens into plain words and never hides an unknown one', () => {
    expect(describeCrmDetail('crm_error: crm_lead_key_not_owned')).toBe(
      'the record key did not belong to this lead',
    );
    expect(describeCrmDetail('crm_error: salesforce_update_http_503')).toBe(
      'your CRM was unavailable',
    );
    expect(describeCrmDetail('crm_error: crm_webhook_timeout')).toBe(
      'your webhook did not accept it (timeout)',
    );
    expect(describeCrmDetail('tool_exception:RuntimeError')).toBe('tool exception:RuntimeError');
    expect(describeCrmDetail(null)).toBe('the CRM did not accept the record');
  });
});
