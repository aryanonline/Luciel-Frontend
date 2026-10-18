import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLucielClient } from '../index';
import { MOCK_SMS_CODE } from '../adapters/mock-admin';

/**
 * Round 7 WP-4b — SMS escalation contacts are confirmed by a 6-digit code.
 *
 * Wire facts (Luciel-Backend app/api/v1/admin/luciel.py, schemas_api/luciel.py):
 *  - POST /api/v1/admin/luciel/escalation/contacts/confirm-sms {number, code} →
 *    {outcome, luciel}; outcomes confirmed | already_confirmed | wrong_code | locked |
 *    expired | no_pending; rate-limited (429) per tenant;
 *  - a fresh code = POST .../escalation/resend-confirmation {address: <number>};
 *  - escalationContactHealth lists SMS contacts and the after-hours contact, with
 *    `channel`, `role` and `detail` (`sms_channel_not_provisioned`).
 */

afterEach(() => vi.unstubAllGlobals());

describe('HTTP: confirm-sms', () => {
  it('posts {number, code} to the confirm route', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ outcome: 'wrong_code', luciel: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = createLucielClient({ adapter: 'http', baseUrl: 'https://api.example.com' });
    const out = await api.luciel.confirmSmsContact('+16045550101', '000000');
    expect(out.outcome).toBe('wrong_code');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.com/api/v1/admin/luciel/escalation/contacts/confirm-sms',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      number: '+16045550101',
      code: '000000',
    });
  });
});

describe('mock: the confirmation states', () => {
  it('lists every SMS contact — pending, expired, confirmed — with its role', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'escalation_sms' } });
    const luciel = await api.luciel.get();
    const sms = (luciel?.escalationContactHealth ?? []).filter((h) => h.channel === 'sms');
    expect(sms.map((h) => [h.address, h.role, h.state])).toEqual([
      ['+16045550101', 'primary', 'pending_confirmation'],
      ['+16045550102', 'secondary', 'unverified'],
      ['+16045550103', 'after_hours', 'verified'],
    ]);
  });

  it('a wrong code counts, the right one confirms, an expired one says so', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'escalation_sms' } });
    expect((await api.luciel.confirmSmsContact('+16045550101', '000000')).outcome).toBe(
      'wrong_code',
    );
    const ok = await api.luciel.confirmSmsContact('+1 604 555 0101', MOCK_SMS_CODE);
    expect(ok.outcome).toBe('confirmed');
    expect(ok.luciel.escalationContactHealth.find((h) => h.address === '+16045550101')?.state).toBe(
      'verified',
    );
    expect((await api.luciel.confirmSmsContact('+16045550102', MOCK_SMS_CODE)).outcome).toBe(
      'expired',
    );
  });

  it('the fourth entry in a row is rate-limited (429)', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'escalation_sms' } });
    for (let i = 0; i < 3; i += 1) await api.luciel.confirmSmsContact('+16045550101', '000000');
    await expect(api.luciel.confirmSmsContact('+16045550101', '000000')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSeconds: 60,
    });
  });

  it('refuses a number that is not a contact, and a code that is not six digits', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'escalation_sms' } });
    await expect(api.luciel.confirmSmsContact('+19995550000', '123456')).rejects.toMatchObject({
      code: 'validation_error',
    });
    await expect(api.luciel.confirmSmsContact('+16045550101', '12')).rejects.toMatchObject({
      code: 'validation_error',
    });
  });

  it('resend mints a fresh code for an expired number; inside the cooldown it refuses', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'escalation_sms' } });
    const after = await api.luciel.resendContactConfirmation('+16045550102');
    expect(after.escalationContactHealth.find((h) => h.address === '+16045550102')?.state).toBe(
      'pending_confirmation',
    );
    await expect(api.luciel.resendContactConfirmation('+16045550102')).rejects.toMatchObject({
      code: 'validation_error',
      message: expect.stringContaining('moments ago'),
    });
    await expect(api.luciel.resendContactConfirmation('+16045550103')).rejects.toMatchObject({
      message: 'That number is already confirmed.',
    });
  });

  it('with no SMS number connected, a saved contact names the honest refusal', async () => {
    const api = createLucielClient({ adapter: 'mock' });
    const luciel = await api.luciel.updateEscalation({
      primaryEmail: 'sarah@sarahchen.com',
      primarySms: '+16045550199',
      preferredChannel: 'email',
    });
    const h = luciel.escalationContactHealth.find((x) => x.address === '+16045550199');
    expect(h).toMatchObject({
      channel: 'sms',
      role: 'primary',
      state: 'unverified',
      detail: 'sms_channel_not_provisioned',
    });
    // The verified email keeps its state through the save.
    expect(
      luciel.escalationContactHealth.find((x) => x.address === 'sarah@sarahchen.com')?.state,
    ).toBe('verified');
  });
});
