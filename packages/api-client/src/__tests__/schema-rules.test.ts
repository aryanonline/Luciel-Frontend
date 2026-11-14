import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWidgetClient } from '../widget';
import {
  uuid,
  isoTimestamp,
  auditEvent,
  loginRequest,
  checkoutSession,
  apiError,
  submitCredentialsRequest,
  knowledgeSyncJob,
  lead,
  teamAvailability,
  accountStatus,
  dayCounts,
  budget,
  escalationEventSignal,
  createLucielRequest,
  confirmSmsContactRequest,
  widgetSendResult,
} from '../schemas';

/**
 * The validation rules the schemas carry, pinned at the major-version move of the
 * validation library (zod 3 → 4, 2026-11-14). zod 4 renamed or tightened several
 * helpers — its `uuid` checks RFC 9562 version and variant bits, its ISO datetime is
 * RFC 3339 only, its URL check trims the string first, and its default messages are
 * worded differently — so each case below is the behaviour the frontend shipped with.
 * The widget parses its bootstrap and replies with these schemas on customers' sites,
 * and the first-run form shows `createLucielRequest`'s messages to the owner, so a
 * failure here means a rule moved, not a test to update.
 */

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

afterEach(() => vi.unstubAllGlobals());

describe('ids', () => {
  it('accepts any 8-4-4-4-12 hex id, not only RFC version/variant UUIDs', () => {
    for (const id of [
      '88888888-8888-4888-8888-888888888888',
      '00000000-0000-0000-0000-000000000001',
      'AD88DFDC-E40B-3B32-FDBE-3B0C5FBC254A',
      'ad88dfdc-e40b-0b32-cdbe-3b0c5fbc254a',
    ]) {
      expect(ok(uuid, id), id).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const id of [
      '',
      '88888888-8888-4888-8888-88888888888',
      '88888888888848888888888888888888',
      'g8888888-8888-4888-8888-888888888888',
      '{88888888-8888-4888-8888-888888888888}',
    ]) {
      expect(ok(uuid, id), id).toBe(false);
    }
  });
});

describe('timestamps', () => {
  const accepted = [
    '2026-06-13T23:42:00Z',
    '2026-06-13T23:42:00.123456Z',
    '2026-06-13T23:42:00+05:30',
    '2026-06-13T23:42:00-0800',
    // Seconds are optional, with a Z or an offset alike.
    '2026-06-13T23:42Z',
    '2026-06-13T23:42+05:30',
    '2024-02-29T00:00:00Z',
  ];
  const refused = [
    '2026-06-13T23:42:00', // no offset
    '2026-06-13 23:42:00Z',
    '2026-06-13T23:42:00z',
    '2026-06-13T23:42:00+05', // an offset needs its minutes
    '2026-02-29T00:00:00Z', // not a leap year
    '2026-06-13T24:00:00Z',
    '2026-06-13',
  ];

  it('an instant needs a date, a time and a Z or numeric offset', () => {
    for (const v of accepted) expect(ok(isoTimestamp, v), v).toBe(true);
    for (const v of refused) expect(ok(isoTimestamp, v), v).toBe(false);
  });

  it('the audit log reads its instants by the same rule', () => {
    const event = (at: string) => ({ eventId: 'e1', eventType: 'luciel.paused', at });
    expect(ok(auditEvent, event('2026-06-13T23:42Z'))).toBe(true);
    expect(ok(auditEvent, event('2026-06-13T23:42:00-0800'))).toBe(true);
    expect(ok(auditEvent, event('2026-06-13T23:42:00'))).toBe(false);
  });
});

describe('email addresses', () => {
  const email = (value: string) => ok(loginRequest, { email: value, password: 'pw' });

  it('accepts ordinary addresses', () => {
    for (const v of [
      'owner@example.com',
      "o'brien+tag@mail.example.co",
      'UPPER.case-1@Sub-Domain.Example.IO',
    ]) {
      expect(email(v), v).toBe(true);
    }
  });

  it('refuses the malformed ones', () => {
    for (const v of [
      'a..b@example.com',
      '.a@example.com',
      'a.@example.com',
      "a'@example.com",
      'a b@example.com',
      'é@example.com',
      'a@example',
      'a@-example.com',
      'a@exam_ple.com',
      'a@example.c',
    ]) {
      expect(email(v), v).toBe(false);
    }
  });
});

describe('links', () => {
  it('accepts what the URL parser accepts, any scheme, and returns it as sent', () => {
    expect(ok(checkoutSession, { url: 'https://checkout.stripe.com/c/pay/cs_test_123' })).toBe(
      true,
    );
    expect(ok(checkoutSession, { url: 'mailto:owner@example.com' })).toBe(true);
    expect(checkoutSession.parse({ url: ' https://example.com/' }).url).toBe(
      ' https://example.com/',
    );
  });

  it('refuses a string the URL parser refuses, padding included', () => {
    for (const v of ['example.com', 'not a url', ' https://example.com/']) {
      expect(ok(checkoutSession, { url: v }), v).toBe(false);
    }
  });
});

describe('maps', () => {
  it('a typed refusal keeps its detail map, which must be an object', () => {
    const refusal = { code: 'conflict', message: 'Closed.', reason: 'account_closed' };
    expect(apiError.parse({ ...refusal, detail: { closedAt: null, count: 2 } }).detail).toEqual({
      closedAt: null,
      count: 2,
    });
    expect(ok(apiError, { ...refusal, detail: ['closedAt'] })).toBe(false);
  });

  it('credential fields are strings only', () => {
    expect(ok(submitCredentialsRequest, { fields: { accountSid: 'AC1', authToken: 'x' } })).toBe(
      true,
    );
    expect(ok(submitCredentialsRequest, { fields: { accountSid: 'AC1', authToken: 2 } })).toBe(
      false,
    );
  });
});

describe('unknown keys', () => {
  it('a sync job keeps a key the server added; a lead drops one', () => {
    const job = knowledgeSyncJob.parse({
      state: 'synced',
      startedAt: '2026-06-13T23:42:00Z',
      result: { added: ['a'], pagesSeen: 3 },
      attempt: 2,
    });
    expect(job).toMatchObject({ attempt: 2, result: { added: ['a'], pagesSeen: 3 } });

    const parsed = lead.parse({
      leadId: '88888888-8888-4888-8888-888888888888',
      state: 'active',
      lastActivityAt: '2026-06-13T23:42:00Z',
      createdAt: '2026-06-13T23:42:00Z',
      somethingNew: true,
    });
    expect(parsed).not.toHaveProperty('somethingNew');
  });
});

describe('defaults', () => {
  const minimalLead = {
    leadId: '88888888-8888-4888-8888-888888888888',
    state: 'active',
    lastActivityAt: '2026-06-13T23:42:00Z',
    createdAt: '2026-06-13T23:42:00Z',
  };

  it('fills what an older server leaves out, and never overrides a served value', () => {
    expect(lead.parse(minimalLead).outcome).toBe('in_progress');
    expect(lead.parse({ ...minimalLead, outcome: 'converted' }).outcome).toBe('converted');
    expect(accountStatus.parse({ state: 'verified' })).toEqual({
      state: 'verified',
      canReopen: false,
      lucielRestoredOnReopen: false,
    });
    expect(accountStatus.parse({ state: 'closed', closedAt: null }).closedAt).toBeNull();
    const day = dayCounts.parse({
      date: '2026-06-13',
      conversations: 0,
      leads: 0,
      leadsToCrm: 0,
      escalations: 0,
      escalationsReached: 0,
      bookings: 0,
      callbacksScheduled: 0,
      humanTakeovers: 0,
    });
    expect(day.byChannel).toEqual({});
  });

  it('team availability defaults to off and empty, with a fresh list each parse', () => {
    const a = teamAvailability.parse({});
    const b = teamAvailability.parse({ enabled: undefined });
    expect(a).toEqual({ enabled: false, weekly: [], closures: [] });
    expect(b).toEqual({ enabled: false, weekly: [], closures: [] });
    expect(a.weekly).not.toBe(b.weekly);
  });
});

describe('numbers and enums', () => {
  it('a count is a whole, non-negative number', () => {
    const served = {
      billingState: 'free_cap',
      dunningState: 'none',
      conversationsThisPeriod: 3,
      freeAllowance: 50,
      billedThisPeriod: 0,
      periodResetsAt: '2026-07-01T00:00:00Z',
      atCap: false,
    };
    expect(ok(budget, served)).toBe(true);
    expect(ok(budget, { ...served, conversationsThisPeriod: 1.5 })).toBe(false);
    expect(ok(budget, { ...served, conversationsThisPeriod: -1 })).toBe(false);
  });

  it('escalation events carry the four fixed signals plus the two server-only ones', () => {
    expect(escalationEventSignal.options).toEqual([
      'explicit_human_request',
      'strong_negative_sentiment',
      'cannot_answer',
      'high_value_lead',
      'budget_exhausted',
      'llm_unavailable',
    ]);
  });
});

describe('owner-facing messages', () => {
  const messageFor = (value: unknown, field: string) => {
    const result = createLucielRequest.safeParse(value);
    expect(result.success).toBe(false);
    return result.error?.issues.find((issue) => issue.path[0] === field)?.message;
  };

  it('first-run says what it always said for an empty or over-long field', () => {
    const filled = { name: 'Front Desk', websiteUrl: 'example.com', businessOneLiner: 'A studio.' };
    for (const field of ['name', 'websiteUrl', 'businessOneLiner'] as const) {
      expect(messageFor({ ...filled, [field]: '' }, field)).toBe(
        'String must contain at least 1 character(s)',
      );
    }
    expect(messageFor({ ...filled, businessOneLiner: 'x'.repeat(281) }, 'businessOneLiner')).toBe(
      'String must contain at most 280 character(s)',
    );
  });

  it('the SMS confirmation code is exactly six digits', () => {
    const number = '+15551234567';
    expect(ok(confirmSmsContactRequest, { number, code: '123456' })).toBe(true);
    for (const code of ['12345', '1234567', 'abcdef', ' 123456']) {
      expect(ok(confirmSmsContactRequest, { number, code }), code).toBe(false);
    }
    expect(ok(confirmSmsContactRequest, { number: '12', code: '123456' })).toBe(false);
    const result = confirmSmsContactRequest.safeParse({ number, code: '12' });
    expect(result.error?.issues[0]?.message).toBe('Enter the 6-digit code.');
  });
});

describe('the widget data plane', () => {
  it('a reply parses under the same id and timestamp rules the widget shipped with', () => {
    const reply = widgetSendResult.parse({
      sessionId: '00000000-0000-0000-0000-000000000001',
      reply: {
        messageId: 'AD88DFDC-E40B-3B32-FDBE-3B0C5FBC254A',
        role: 'assistant',
        text: 'Hello.',
        at: '2026-06-13T23:42+05:30',
      },
      renderState: 'active',
    });
    expect(reply.reply.at).toBe('2026-06-13T23:42+05:30');
    expect(
      ok(widgetSendResult, {
        sessionId: '00000000-0000-0000-0000-000000000001',
        reply: { messageId: 'r1', role: 'assistant', text: 'Hello.', at: '2026-06-13T23:42Z' },
        renderState: 'active',
      }),
    ).toBe(false);
  });

  it('the HTTP widget client parses a reply with them and refuses a malformed one', async () => {
    const served = {
      sessionId: '00000000-0000-0000-0000-000000000001',
      reply: {
        messageId: '88888888-8888-4888-8888-888888888888',
        role: 'assistant',
        text: 'Hello.',
        at: '2026-06-13T23:42:00Z',
      },
      renderState: 'active',
    };
    const serve = (body: unknown) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        ),
      );
    const client = createWidgetClient({ adapter: 'http', baseUrl: 'https://api.example.com' });
    serve(served);
    await expect(client.send('vm_live_demo', { text: 'Hi' })).resolves.toEqual(served);
    serve({ ...served, reply: { ...served.reply, at: '2026-06-13T23:42:00' } });
    await expect(client.send('vm_live_demo', { text: 'Hi' })).rejects.toThrow();
  });
});
