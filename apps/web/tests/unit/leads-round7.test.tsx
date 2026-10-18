import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import LeadsPage from '@/app/(app)/dashboard/leads/page';
import { CrmBackfillOffer } from '@/components/crm-backfill-offer';
import { validateLeadEdit, leadPatchFrom } from '@/components/lead-edit-dialog';
import { describeNeverAttempted, isBackfillCandidate } from '@/lib/crm-detail';
import { api } from '@/lib/api';
import type { Connection, Lead } from '@luciel/api-client';
import { LucielApiError } from '@luciel/api-client';

/**
 * Round 7 WP-3c (items 5 and 6), wired to the backend's lead stewardship routes:
 *  - a never-pushed lead says so with the SERVED reason and offers "Send to CRM"
 *    (POST /dashboard/leads/{id}/crm-retry);
 *  - the one-time backfill offer (POST /dashboard/leads/crm-backfill) counts the
 *    never-attempted, non-archived leads, names the served CRM, renders the
 *    bounded result and a refused 409 verbatim, and is dismissible;
 *  - the Edit dialog (PATCH /dashboard/leads/{id}) validates field by field the way
 *    the backend does, sends ONLY changed fields (null to clear), lands a server
 *    422 / 409 on the field it names and stays open;
 *  - an archived row offers Un-archive (POST /dashboard/leads/{id}/unarchive).
 */

const lead = (over: Partial<Lead>): Lead => ({
  leadId: '11111111-1111-4111-8111-111111111111',
  name: 'Jordan P.',
  contactIdentifier: 'jordan@example.com',
  email: 'jordan@example.com',
  intent: 'Deck quote',
  state: 'active',
  outcome: 'in_progress',
  lastActivityAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-08-01T00:00:00Z',
  ...over,
});

const neverNoCrm = lead({ crmStatus: 'never_attempted', crmDetail: 'crm_not_connected' });
const neverEarlier = lead({
  leadId: '22222222-2222-4222-8222-222222222222',
  name: 'Sam Earlier',
  contactIdentifier: 'sam@example.com',
  email: 'sam@example.com',
  crmStatus: 'never_attempted',
  crmDetail: 'not_yet_pushed',
});
const neverNoKey = lead({
  leadId: '33333333-3333-4333-8333-333333333333',
  name: 'Dana NoKey',
  contactIdentifier: '+16045550100',
  email: null,
  crmStatus: 'never_attempted',
  crmDetail: 'no_crm_key',
});
const archived = lead({
  leadId: '44444444-4444-4444-8444-444444444444',
  name: 'Ava Archived',
  state: 'archived',
  crmStatus: 'never_attempted',
  crmDetail: 'not_yet_pushed',
});

const hubspot: Connection = {
  connectionId: '55555555-5555-4555-8555-555555555555',
  connectionType: 'crm',
  provider: 'hubspot',
  displayName: 'HubSpot',
  status: 'connected',
  createdAt: '2026-02-01T10:05:00Z',
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('never-sent leads', () => {
  it('renders the served reason and sends the lead through the retry route', async () => {
    vi.spyOn(api.leads, 'list').mockResolvedValue([neverNoCrm]);
    vi.spyOn(api.connections, 'list').mockResolvedValue([]);
    const retry = vi
      .spyOn(api.leads, 'retryCrmPush')
      .mockResolvedValue({ ...neverNoCrm, crmStatus: 'synced', crmDetail: null });
    renderWithQuery(<LeadsPage />);
    const row = (await screen.findByText('Jordan P.')).closest('li') as HTMLElement;
    expect(
      within(row).getByText('Never sent to your CRM — no CRM is connected.'),
    ).toBeInTheDocument();
    // Never-sent is not a failure: the failure banner stays quiet.
    expect(screen.queryByText(/did not reach your CRM/)).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Send to CRM' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(neverNoCrm.leadId));
    expect(await screen.findByText('Jordan P. is now in your CRM.')).toBeInTheDocument();
  });

  it('puts every served reason into plain words and never hides an unknown one', () => {
    expect(describeNeverAttempted('crm_not_connected')).toBe('no CRM is connected');
    expect(describeNeverAttempted('dormant')).toBe(
      'your CRM connection is dormant until a card is on file',
    );
    expect(describeNeverAttempted('tool_off')).toBe('the Push to CRM tool is switched off');
    expect(describeNeverAttempted('no_crm_key')).toBe(
      'this lead has no email address your CRM accepts',
    );
    expect(describeNeverAttempted('not_yet_pushed')).toBe(
      'it was captured before your CRM was connected',
    );
    expect(describeNeverAttempted('some_new_reason')).toBe('some new reason');
    expect(describeNeverAttempted(null)).toBe('nothing has pushed it yet');
  });
});

describe('CRM backfill offer', () => {
  it('counts the never-attempted, non-archived leads under the served CRM name and runs the batch', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([hubspot]);
    vi.spyOn(api.leads, 'list').mockResolvedValue([neverEarlier, neverNoKey, archived, neverNoCrm]);
    const backfill = vi.spyOn(api.leads, 'backfillCrm').mockResolvedValue({
      attempted: 1,
      synced: 1,
      failed: 0,
      skippedNoKey: 1,
      remaining: 0,
      refusedReason: null,
    });
    renderWithQuery(<CrmBackfillOffer />);
    // The archived row and a tenant-level refusal are not candidates.
    expect(await screen.findByText('Send your 2 earlier leads to HubSpot?')).toBeInTheDocument();
    expect(screen.getByText(/1 of them has no email address HubSpot accepts/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send 2 to HubSpot' }));
    await waitFor(() => expect(backfill).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        /1 lead is now in HubSpot; 1 skipped because they have no email address HubSpot accepts\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/still to send/)).not.toBeInTheDocument();
  });

  it('offers the next bounded batch when the server says leads remain', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([hubspot]);
    vi.spyOn(api.leads, 'list').mockResolvedValue([neverEarlier]);
    vi.spyOn(api.leads, 'backfillCrm').mockResolvedValue({
      attempted: 100,
      synced: 98,
      failed: 2,
      skippedNoKey: 0,
      remaining: 40,
      refusedReason: null,
    });
    renderWithQuery(<CrmBackfillOffer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send 1 to HubSpot' }));
    expect(
      await screen.findByText(/98 leads are now in HubSpot; 2 pushes failed/),
    ).toBeInTheDocument();
    expect(screen.getByText(/40 leads still to send/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send the next 40' })).toBeInTheDocument();
  });

  it('renders a refused 409 verbatim and leaves the offer standing', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([hubspot]);
    vi.spyOn(api.leads, 'list').mockResolvedValue([neverEarlier]);
    vi.spyOn(api.leads, 'backfillCrm').mockRejectedValue(
      new LucielApiError({ code: 'conflict', message: 'The Push to CRM tool is switched off.' }),
    );
    renderWithQuery(<CrmBackfillOffer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send 1 to HubSpot' }));
    expect(
      await screen.findByText('Nothing was sent: The Push to CRM tool is switched off.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send 1 to HubSpot' })).toBeInTheDocument();
  });

  it('is one-time: "Not now" hides it and a re-render does not re-ask', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([hubspot]);
    vi.spyOn(api.leads, 'list').mockResolvedValue([neverEarlier]);
    const first = renderWithQuery(<CrmBackfillOffer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/Send your 1 earlier lead/)).not.toBeInTheDocument();
    first.unmount();

    renderWithQuery(<CrmBackfillOffer />);
    await waitFor(() => expect(api.leads.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Send your 1 earlier lead/)).not.toBeInTheDocument();
  });

  it('stays quiet without a connected CRM or without candidates', async () => {
    vi.spyOn(api.connections, 'list').mockResolvedValue([{ ...hubspot, status: 'expired' }]);
    const list = vi.spyOn(api.leads, 'list').mockResolvedValue([neverNoCrm]);
    renderWithQuery(<CrmBackfillOffer />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByText(/earlier lead/)).not.toBeInTheDocument();
    expect(isBackfillCandidate(neverNoCrm)).toBe(false);
    expect(isBackfillCandidate(archived)).toBe(false);
    expect(isBackfillCandidate(neverEarlier)).toBe(true);
    expect(isBackfillCandidate(neverNoKey)).toBe(true);
  });
});

describe('Edit dialog', () => {
  it('mirrors the backend rules field by field and sends only what changed', () => {
    expect(validateLeadEdit({ name: '', email: 'not-an-email', phone: '' })).toEqual({
      email: 'That is not a valid email address.',
    });
    expect(validateLeadEdit({ name: '', email: '', phone: '604 555 0100' })).toEqual({
      phone: expect.stringContaining('E.164'),
    });
    expect(validateLeadEdit({ name: 'x'.repeat(256), email: '', phone: '' })).toEqual({
      name: 'Keep the name under 255 characters.',
    });
    expect(
      validateLeadEdit({ name: 'Jordan', email: 'Jordan@Example.com', phone: '+1 (604) 555-0100' }),
    ).toEqual({});

    const base = lead({ name: 'Jordan P.', email: 'jordan@example.com', phone: '+16045550100' });
    expect(
      leadPatchFrom(base, { name: 'Jordan P.', email: 'jordan@example.com', phone: '' }),
    ).toEqual({
      phone: null,
    });
    expect(
      leadPatchFrom(base, {
        name: 'Jordan Park',
        email: 'jordan@example.com',
        phone: '+16045550100',
      }),
    ).toEqual({
      name: 'Jordan Park',
    });
  });

  it('refuses a bad email on the field without calling the server', async () => {
    vi.spyOn(api.leads, 'list').mockResolvedValue([neverNoCrm]);
    vi.spyOn(api.connections, 'list').mockResolvedValue([]);
    const update = vi.spyOn(api.leads, 'update');
    renderWithQuery(<LeadsPage />);
    await screen.findByText('Jordan P.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Jordan P.' }));
    const email = await screen.findByLabelText('Email');
    fireEvent.change(email, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That is not a valid email address.',
    );
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('saves changed fields only, lands a server conflict on its field, and stays open', async () => {
    vi.spyOn(api.leads, 'list').mockResolvedValue([neverNoCrm]);
    vi.spyOn(api.connections, 'list').mockResolvedValue([]);
    const update = vi
      .spyOn(api.leads, 'update')
      .mockRejectedValueOnce(
        new LucielApiError({
          code: 'conflict',
          message: 'That phone number already belongs to another lead.',
        }),
      )
      .mockResolvedValueOnce({ ...neverNoCrm, name: 'Jordan Park', phone: '+16045550199' });
    renderWithQuery(<LeadsPage />);
    await screen.findByText('Jordan P.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Jordan P.' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Jordan Park' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+1 604 555 0199' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(neverNoCrm.leadId, {
        name: 'Jordan Park',
        phone: '+1 604 555 0199',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That phone number already belongs to another lead.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+1 604 555 0199' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Jordan Park was updated.')).toBeInTheDocument();
  });

  it('keeps the dialog open with the reason when the write fails for another reason', async () => {
    vi.spyOn(api.leads, 'list').mockResolvedValue([neverNoCrm]);
    vi.spyOn(api.connections, 'list').mockResolvedValue([]);
    vi.spyOn(api.leads, 'update').mockRejectedValue(
      new LucielApiError({ code: 'server_error', message: 'Internal Server Error' }),
    );
    renderWithQuery(<LeadsPage />);
    await screen.findByText('Jordan P.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Jordan P.' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Jordan Park' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(
        'We could not save those changes. The lead is unchanged — please try again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Un-archive', () => {
  it('offers Un-archive on an archived row and reports a failed write honestly', async () => {
    vi.spyOn(api.leads, 'list').mockResolvedValue([archived]);
    vi.spyOn(api.connections, 'list').mockResolvedValue([]);
    const unarchive = vi
      .spyOn(api.leads, 'unarchive')
      .mockRejectedValueOnce(new LucielApiError({ code: 'server_error', message: 'boom' }))
      .mockResolvedValueOnce({ ...archived, state: 'active' });
    renderWithQuery(<LeadsPage />);
    fireEvent.click(await screen.findByLabelText(/Show archived leads \(1\)/));
    const row = (await screen.findByText('Ava Archived')).closest('li') as HTMLElement;
    // An archived never-sent lead is not offered "Send to CRM" (the backfill skips it too).
    expect(within(row).queryByRole('button', { name: 'Send to CRM' })).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Un-archive Ava Archived' }));
    expect(
      await screen.findByText(
        'We could not un-archive that lead. It is still archived — please try again.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Un-archive Ava Archived' }));
    await waitFor(() => expect(unarchive).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.leads.list).toHaveBeenCalledTimes(2));
  });
});
