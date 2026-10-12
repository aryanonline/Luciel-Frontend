import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLucielClient, LucielApiError } from '../index';

/**
 * Round 7 WP-3c (items 5 and 6): the lead stewardship routes, the way the backend
 * registers them (tests/unit/test_route_registry.py):
 *   PATCH /api/v1/dashboard/leads/{lead_id}          — owner edit (name/email/phone)
 *   POST  /api/v1/dashboard/leads/{lead_id}/unarchive
 *   POST  /api/v1/dashboard/leads/crm-backfill        — one bounded batch
 * and the explicit `never_attempted` CRM state with its posture-derived reason.
 * HTTP adapter: the exact path, method and body. Mock adapter: every state the
 * leads page renders.
 */

const BASE_URL = 'https://api.example.com';

const LEAD = {
  leadId: '99999999-9999-4999-8999-999999999999',
  name: 'Jordan P.',
  contactIdentifier: 'jordan@example.com',
  state: 'active',
  outcome: 'in_progress',
  lastActivityAt: '2026-06-13T23:47:00Z',
  createdAt: '2026-06-13T23:42:00Z',
  crmStatus: 'never_attempted',
  crmDetail: 'not_yet_pushed',
};

function stubFetch(body: unknown = LEAD) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('http adapter: lead stewardship routes', () => {
  it('PATCHes only the keys the caller set, so an omitted field is left alone server-side', async () => {
    const fetchMock = stubFetch();
    const client = createLucielClient({ adapter: 'http', baseUrl: BASE_URL });
    await client.leads.update(LEAD.leadId, { phone: null, name: 'Jordan Park' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE_URL}/api/v1/dashboard/leads/${LEAD.leadId}`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ phone: null, name: 'Jordan Park' });
  });

  it('POSTs unarchive and crm-backfill at their registered paths', async () => {
    const fetchMock = stubFetch();
    const client = createLucielClient({ adapter: 'http', baseUrl: BASE_URL });
    await client.leads.unarchive(LEAD.leadId);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `${BASE_URL}/api/v1/dashboard/leads/${LEAD.leadId}/unarchive`,
    );
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('POST');

    stubFetch({ attempted: 1, synced: 1, failed: 0, skippedNoKey: 0, remaining: 0 });
    await client.leads.backfillCrm();
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(call[0])).toBe(`${BASE_URL}/api/v1/dashboard/leads/crm-backfill`);
    expect(call[1]?.method).toBe('POST');
  });
});

describe('mock adapter: never_attempted and its posture-derived reason', () => {
  it('serves the seeded lead as never_attempted with the reason the CURRENT posture gives', async () => {
    // Seed: HubSpot row is `expired`, so nothing can be pushed → crm_not_connected.
    const client = createLucielClient({ adapter: 'mock' });
    const [lead] = await client.leads.list();
    expect(lead?.crmStatus).toBe('never_attempted');
    expect(lead?.crmDetail).toBe('crm_not_connected');
    await expect(client.leads.backfillCrm()).rejects.toMatchObject({
      code: 'conflict',
      message: 'No CRM is connected, so there is nothing to backfill into.',
    });
    await expect(client.leads.retryCrmPush(lead!.leadId)).rejects.toBeInstanceOf(LucielApiError);
  });

  it('becomes a backfill candidate once the CRM reconnects, and one batch syncs it', async () => {
    const client = createLucielClient({ adapter: 'mock' });
    const crm = (await client.connections.list()).find((c) => c.connectionType === 'crm')!;
    await client.connections.reconnect(crm.connectionId);
    await client.connections.completeOauth(crm.connectionId, 'code', 'state');
    const [before] = await client.leads.list();
    expect(before?.crmStatus).toBe('never_attempted');
    expect(before?.crmDetail).toBe('not_yet_pushed');

    const result = await client.leads.backfillCrm();
    expect(result).toMatchObject({ attempted: 1, synced: 1, failed: 0, skippedNoKey: 0, remaining: 0 });
    const [after] = await client.leads.list();
    expect(after?.crmStatus).toBe('synced');
    // Idempotent by construction: a second pass finds nothing left.
    expect(await client.leads.backfillCrm()).toMatchObject({ attempted: 0, remaining: 0 });
  });

  it('edits only what was sent, normalises, refuses a bad email / non-E.164 phone, and un-archives', async () => {
    const client = createLucielClient({ adapter: 'mock' });
    const [lead] = await client.leads.list();
    const id = lead!.leadId;

    const edited = await client.leads.update(id, { email: ' Jordan.P@Example.COM ', phone: '+1 (604) 555-0100' });
    expect(edited.email).toBe('jordan.p@example.com');
    expect(edited.phone).toBe('+16045550100');
    expect(edited.name).toBe(lead!.name); // omitted → left alone

    await expect(client.leads.update(id, { email: 'nope' })).rejects.toMatchObject({
      code: 'validation_error',
      message: 'That is not a valid email address.',
    });
    await expect(client.leads.update(id, { phone: '555-0100' })).rejects.toMatchObject({
      code: 'validation_error',
    });
    const cleared = await client.leads.update(id, { phone: null });
    expect(cleared.phone).toBeNull();

    await client.leads.archive(id);
    expect((await client.leads.list())[0]?.state).toBe('archived');
    const back = await client.leads.unarchive(id);
    expect(back.state).toBe('active');
    // Idempotent: un-archiving an active lead returns it untouched.
    expect((await client.leads.unarchive(id)).state).toBe('active');
  });
});
