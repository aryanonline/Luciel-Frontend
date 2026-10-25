import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLucielClient } from '../index';
import {
  accountClosedDetail,
  accountStatus,
  exportEmailOutcome,
  LucielApiError,
  reopenResult,
  ACCOUNT_CLOSED,
} from '../schemas';

/**
 * Round 7 WP-5 / owner decision D5 — the closed-account reduced surface.
 *
 * Wire facts (Luciel-Backend app/api/errors.py, app/api/deps.py,
 * app/api/v1/admin/account.py, app/schemas_api/account.py):
 *  - every admin route answers a closed account with 403
 *    `{message, code: "account_closed", detail: {closedAt, reopenUntil}}`;
 *  - GET /api/v1/admin/account → AccountStatusOut (camelCase);
 *  - POST /api/v1/admin/account/reopen → ReopenResult;
 *  - POST /api/v1/admin/account/export → `{ok, download_url, ttl_days, emailOutcome}`
 *    (ExportResult is a plain BaseModel: only email_outcome carries an alias).
 */

const BASE_URL = 'https://api.example.com';

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const http = () => createLucielClient({ adapter: 'http', baseUrl: BASE_URL });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP: the typed account_closed refusal', () => {
  it('carries the wire code and detail on the error, beside the 403 → unauthorized mapping', async () => {
    stubFetch(403, {
      message: 'Account closed.',
      code: 'account_closed',
      detail: { closedAt: '2026-10-10T12:00:00+00:00', reopenUntil: '2026-11-09T12:00:00+00:00' },
    });
    const err = await http()
      .luciel.get()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LucielApiError);
    const e = err as LucielApiError;
    expect(e.code).toBe('unauthorized');
    expect(e.reason).toBe(ACCOUNT_CLOSED);
    expect(accountClosedDetail(e)).toEqual({
      closedAt: '2026-10-10T12:00:00+00:00',
      reopenUntil: '2026-11-09T12:00:00+00:00',
    });
  });

  it('an ordinary 403 is NOT a closed account, and a framework detail is not carried', async () => {
    stubFetch(403, { message: 'Email verification required.' });
    const plain = (await http()
      .luciel.get()
      .catch((e: unknown) => e)) as LucielApiError;
    expect(plain.reason).toBeUndefined();
    expect(accountClosedDetail(plain)).toBeNull();

    stubFetch(404, { detail: 'Not Found' });
    const framework = (await http()
      .luciel.get()
      .catch((e: unknown) => e)) as LucielApiError;
    expect(framework.detail).toBeUndefined();
  });
});

describe('HTTP: status, reopen, export', () => {
  it('reads GET /api/v1/admin/account and the served shape parses', async () => {
    const served = {
      state: 'closed',
      closedAt: '2026-10-10T12:00:00Z',
      reopenUntil: '2026-11-09T12:00:00Z',
      canReopen: true,
      lucielRestoredOnReopen: true,
    };
    const fetchMock = stubFetch(200, served);
    const status = await http().account.status();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${BASE_URL}/api/v1/admin/account`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(accountStatus.parse(status)).toEqual(served);
    // An open account: both instants null.
    expect(
      accountStatus.parse({ state: 'verified', closedAt: null, reopenUntil: null }),
    ).toMatchObject({ canReopen: false, lucielRestoredOnReopen: false });
  });

  it('posts the reopen and the served ReopenResult parses', async () => {
    const served = {
      state: 'verified',
      lucielRestored: true,
      lucielState: 'paused',
      billingState: 'free_cap',
    };
    const fetchMock = stubFetch(200, served);
    const out = await http().account.reopen();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${BASE_URL}/api/v1/admin/account/reopen`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(reopenResult.parse(out)).toEqual(served);
  });

  it('normalises the export body and keeps emailOutcome', async () => {
    stubFetch(200, {
      ok: true,
      download_url: 'https://api.example.com/api/v1/exports/tok',
      ttl_days: 7,
      emailOutcome: 'failed:SMTPException',
    });
    expect(await http().account.requestExport()).toEqual({
      ok: true,
      downloadUrl: 'https://api.example.com/api/v1/exports/tok',
      ttlDays: 7,
      emailOutcome: 'failed:SMTPException',
    });
  });
});

describe('exportEmailOutcome parses every served word', () => {
  it('sent / recorded / no_sender / failed:<reason> / unknown', () => {
    expect(exportEmailOutcome('sent')).toEqual({ kind: 'sent' });
    expect(exportEmailOutcome('recorded')).toEqual({ kind: 'recorded' });
    expect(exportEmailOutcome('no_sender')).toEqual({ kind: 'no_sender' });
    expect(exportEmailOutcome('failed:SMTPException')).toEqual({
      kind: 'failed',
      reason: 'SMTPException',
    });
    expect(exportEmailOutcome('failed:unknown')).toEqual({ kind: 'failed', reason: null });
    expect(exportEmailOutcome(undefined)).toEqual({ kind: 'unknown' });
  });
});

describe('mock: the closed account (D5)', () => {
  it('refuses every admin route with account_closed, but answers status, reopen and export', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'closed' } });

    const refused = await api.luciel.get().catch((e: unknown) => e);
    expect(accountClosedDetail(refused)).not.toBeNull();
    expect(accountClosedDetail(await api.leads.list().catch((e: unknown) => e))).not.toBeNull();

    const status = await api.account.status();
    expect(status.state).toBe('closed');
    expect(status.canReopen).toBe(true);
    expect(status.lucielRestoredOnReopen).toBe(true);
    expect(new Date(status.reopenUntil as string).getTime()).toBeGreaterThan(Date.now());

    const exported = await api.account.requestExport();
    expect(exported.downloadUrl).toBeTruthy();
    expect(exported.emailOutcome).toBe('sent');

    const reopened = await api.account.reopen();
    expect(reopened).toMatchObject({
      state: 'verified',
      lucielRestored: true,
      lucielState: 'active',
    });
    // Open again: the admin surface answers, and a second reopen is a conflict.
    expect((await api.luciel.get())?.state).toBe('active');
    await expect(api.account.reopen()).rejects.toMatchObject({ code: 'conflict' });
  });

  it('past the window even the reduced surface refuses, reopenUntil in the past', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'closed_window_passed' } });
    const err = await api.account.status().catch((e: unknown) => e);
    const closed = accountClosedDetail(err);
    expect(closed).not.toBeNull();
    expect(new Date(closed?.reopenUntil as string).getTime()).toBeLessThan(Date.now());
    await expect(api.account.reopen()).rejects.toMatchObject({ reason: 'account_closed' });
  });

  it('closing a live account puts its Luciel in the grace window that a reopen restores', async () => {
    const api = createLucielClient({ adapter: 'mock' });
    await api.account.close({ confirmDeleteLuciel: true });
    // The closure signed the owner out (below); they sign in again to the reduced surface.
    await api.auth.login({ email: 'owner@example.com', password: 'pw-123456' });
    expect(accountClosedDetail(await api.luciel.get().catch((e: unknown) => e))).not.toBeNull();
    const status = await api.account.status();
    expect(status).toMatchObject({
      state: 'closed',
      canReopen: true,
      lucielRestoredOnReopen: true,
    });
    expect(await api.account.reopen()).toMatchObject({ lucielRestored: true });
  });

  /**
   * Live walk run 7 (2026-10-25): the closure bumps the session epoch
   * (cascade.close_account; SeedTest M8 "old_session_revoked=401"), so the session
   * the owner closed with is dead. The mock used to keep answering with it, which is
   * why the walk passed on the mock and waited 30 minutes on live.
   */
  it('closing signs the owner out: the old session answers 401, and a new sign-in lands closed', async () => {
    const api = createLucielClient({ adapter: 'mock' });
    await api.account.close({ confirmDeleteLuciel: true });

    const calls = [
      () => api.auth.me(),
      // auth.py logout depends on current_session_subject: refused like the rest.
      () => api.auth.logout(),
      () => api.luciel.get(),
      () => api.account.status(),
      () => api.account.requestExport(),
      () => api.account.reopen(),
    ];
    for (const call of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LucielApiError);
      // The plain 401 the http adapter maps — a revoked session, NOT the typed
      // closed-account 403 (that one belongs to a session signed in after closing).
      expect(err).toMatchObject({ code: 'unauthorized', message: 'Session revoked.' });
      expect(accountClosedDetail(err)).toBeNull();
    }

    const session = await api.auth.login({ email: 'owner@example.com', password: 'pw-123456' });
    expect(session.account.state).toBe('closed');
    expect((await api.auth.me()).account.state).toBe('closed');
    expect(await api.account.status()).toMatchObject({ state: 'closed', canReopen: true });
  });
});
