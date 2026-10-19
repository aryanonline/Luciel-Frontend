import { describe, it, expect } from 'vitest';
import { createLucielClient, LucielApiError } from '../index';
import type { MockControl, MockRuntime } from '../index';
import { MOCK_SCENARIO_COOKIE, MOCK_STORE_KEY, resolveMockScenario } from '../index';

/**
 * Round 7 WP-12 — the mock's browser runtime. The e2e scenario projects choose a
 * scenario at RUNTIME (query parameter or cookie, never a build constant), and every
 * walk mutation is followed by a reload: the store must come back from the mock
 * "server" (sessionStorage), not from component state. A fake page stands in for the
 * browser: one cookie jar and one storage shared by every client built "on" it, the
 * way every page load in a tab builds a fresh client over the same sessionStorage.
 */

function fakeTab() {
  const store = new Map<string, string>();
  const cookies = new Map<string, string>();
  let control: MockControl | undefined;
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const load = (search = '', pathname = '/dashboard') => {
    const runtime: MockRuntime = {
      search,
      pathname,
      readCookie: () =>
        Array.from(cookies.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
      writeCookie: (cookie) => {
        const [pair, ...attrs] = cookie.split(';').map((p) => p.trim());
        const [name, ...value] = (pair ?? '').split('=');
        if (!name) return;
        if (attrs.some((a) => a.toLowerCase().startsWith('expires=thu, 01 jan 1970'))) {
          cookies.delete(name);
        } else {
          cookies.set(name, value.join('='));
        }
      },
      storage,
      installControl: (c) => {
        control = c;
      },
    };
    return createLucielClient({ adapter: 'mock', mock: { runtime } });
  };
  return {
    load,
    cookies,
    store,
    control: () => {
      if (!control) throw new Error('control not installed');
      return control;
    },
  };
}

describe('scenario selection at runtime', () => {
  it('reads the query parameter first (and remembers it in the cookie), then the cookie', () => {
    expect(resolveMockScenario('?mock_scenario=at_cap', '')).toEqual({
      scenario: 'at_cap',
      fromQuery: true,
    });
    expect(resolveMockScenario('', `${MOCK_SCENARIO_COOKIE}=paused; other=1`)).toEqual({
      scenario: 'paused',
      fromQuery: false,
    });
    // An unknown name is ignored rather than trusted.
    expect(resolveMockScenario('?mock_scenario=nope', '')).toEqual({
      scenario: null,
      fromQuery: false,
    });
  });

  it('a page opened with ?mock_scenario= serves that scenario and sets the cookie', async () => {
    const tab = fakeTab();
    const api = tab.load('?mock_scenario=paused');
    expect((await api.luciel.get())?.state).toBe('paused');
    expect(tab.cookies.get(MOCK_SCENARIO_COOKIE)).toBe('paused');
    // The next page in the tab carries no parameter — the cookie still says paused.
    expect((await tab.load().luciel.get())?.state).toBe('paused');
  });
});

describe('the store persists across page loads', () => {
  it('a reload reads back what a mutation wrote', async () => {
    const tab = fakeTab();
    await tab.load().luciel.pause();
    expect(tab.store.has(MOCK_STORE_KEY)).toBe(true);
    expect((await tab.load().luciel.get())?.state).toBe('paused');
  });

  it('a different scenario, or ?mock_reset=1, starts from the seed', async () => {
    const tab = fakeTab();
    await tab.load().luciel.pause();
    expect((await tab.load('?mock_reset=1').luciel.get())?.state).toBe('active');
    await tab.load().luciel.pause();
    expect((await tab.load('?mock_scenario=grace').luciel.get())?.state).toBe(
      'luciel_grace_window',
    );
  });

  it('ids never repeat across reloads (the counter is part of the store)', async () => {
    const tab = fakeTab();
    const first = await tab.load().knowledge.pasteText({ name: 'A', text: 'a' });
    const second = await tab.load().knowledge.pasteText({ name: 'B', text: 'b' });
    expect(second.sourceId).not.toBe(first.sourceId);
  });

  it('a flagged answer is still flagged after a reload', async () => {
    const tab = fakeTab();
    const session = '88888888-8888-4888-8888-888888888888';
    await tab.load().conversations.flagAnswer(session, 'm2');
    const evidence = await tab.load().conversations.getAnswerEvidence(session, 'm2');
    expect(evidence.flaggedByAdmin).toBe(true);
  });
});

describe('the e2e control surface', () => {
  it('failNext fails the next call with a typed error, persisted across a reload', async () => {
    const tab = fakeTab();
    tab.load();
    tab.control().failNext('leads.list', 2);
    const api = tab.load();
    await expect(api.leads.list()).rejects.toMatchObject({ code: 'server_error' });
    await expect(api.leads.list()).rejects.toBeInstanceOf(LucielApiError);
    await expect(api.leads.list()).resolves.toHaveLength(3);
  });

  it('endSession ends a conversation the page still shows open: take-over is refused', async () => {
    const tab = fakeTab();
    const api = tab.load();
    const session = '88888888-8888-4888-8888-888888888888';
    tab.control().endSession(session);
    await expect(api.conversations.takeOver(session)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('a revoked knowledge grant fails its next sync and the row stops saying connected', async () => {
    const tab = fakeTab();
    const api = tab.load();
    const drive = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    tab.control().revokeKnowledgeGrant(drive);
    await expect(api.knowledge.syncConnection(drive)).rejects.toMatchObject({ code: 'conflict' });
    const row = (await tab.load().connections.list()).find((c) => c.connectionId === drive);
    expect(row?.status).toBe('error');
  });
});

describe('provider round-trips land the way the backend lands them', () => {
  it('a reconnect consent that returns connected redeems the attempt; a declined one does not', async () => {
    const tab = fakeTab();
    const crm = (await tab.load().connections.list()).find((c) => c.connectionType === 'crm')!;
    const start = await tab.load().connections.reconnect(crm.connectionId);
    const url = new URL(start.authorizeUrl ?? '');
    expect(url.searchParams.get('connection_id')).toBe(crm.connectionId);
    expect(url.searchParams.get('provider')).toBe('hubspot');

    // Declined: nothing changes.
    await tab
      .load(`?status=error&reason=access_denied&client=hubspot&connectionId=${crm.connectionId}`)
      .connections.list();
    let row = (await tab.load().connections.list()).find((c) => c.connectionType === 'crm');
    expect(row?.status).toBe('expired');

    await tab.load().connections.reconnect(crm.connectionId);
    tab.load(`?status=connected&provider=hubspot&connectionId=${crm.connectionId}`);
    row = (await tab.load().connections.list()).find((c) => c.connectionType === 'crm');
    expect(row?.status).toBe('connected');
  });

  it('Checkout success puts the card on file; a return without an open session changes nothing', async () => {
    const tab = fakeTab();
    tab.load('?mock_scenario=at_cap');
    expect(
      (await tab.load('?checkout=success', '/dashboard/billing').billing.get()).paymentMethod,
    ).toBeUndefined();
    await tab.load().billing.startCheckout();
    const billing = await tab.load('?checkout=success', '/dashboard/billing').billing.get();
    expect(billing.paymentMethod?.last4).toBe('4242');
    expect(billing.budget.billingState).toBe('payg_enabled');
    expect(billing.budget.atCap).toBe(false);
  });

  it('the Billing Portal stub replaces the card; removing it past 50 puts the account at the cap', async () => {
    const tab = fakeTab();
    tab.load('?mock_scenario=payg');
    await tab.load().billing.startPortal();
    const billing = await tab
      .load('?mock_stripe=portal_card_updated', '/dashboard/billing')
      .billing.get();
    expect(billing.paymentMethod?.last4).toBe('4444');
    const removed = await tab.load().billing.removePaymentMethod();
    expect(removed.paymentMethod).toBeUndefined();
    expect(removed.budget.atCap).toBe(true);
  });
});

describe('the session cookie', () => {
  it('login sets the presence cookie and ends an expired session; logout clears it', async () => {
    const tab = fakeTab();
    const api = tab.load('?mock_scenario=expired_session');
    await expect(api.auth.me()).rejects.toMatchObject({ code: 'unauthorized' });
    await api.auth.login({ email: 'owner@example.com', password: 'x' });
    expect(tab.cookies.get('luciel_session')).toBe('mock-session');
    await expect(tab.load().auth.me()).resolves.toMatchObject({ nextRoute: 'dashboard' });
    await tab.load().auth.logout();
    expect(tab.cookies.has('luciel_session')).toBe(false);
  });
});

describe('scenario shapes the walk relies on', () => {
  it('fresh is a new account: no Luciel and every collection empty', async () => {
    const api = fakeTab().load('?mock_scenario=fresh');
    expect(await api.luciel.get()).toBeNull();
    expect(await api.conversations.list()).toEqual([]);
    expect(await api.leads.list()).toEqual([]);
    expect(await api.knowledge.listSources()).toEqual([]);
    expect(await api.connections.list()).toEqual([]);
    expect(await api.analytics.auditLog()).toEqual([]);
  });

  it('at_cap has a conversation in flight', async () => {
    const api = fakeTab().load('?mock_scenario=at_cap');
    const [first] = await api.conversations.list();
    expect(first?.summary).toBeUndefined();
    expect(first?.endedAt ?? null).toBeNull();
  });

  it('a crawl is listed as a connection, and a re-sync never adds a page twice', async () => {
    const api = fakeTab().load();
    const crawl = await api.knowledge.startCrawl(['https://sarahchen.com/services']);
    const first = await api.knowledge.syncConnection(crawl.connectionId);
    const again = await api.knowledge.syncConnection(crawl.connectionId);
    expect(first.added).toHaveLength(1);
    expect(again.added).toHaveLength(0);
    const row = (await api.connections.list()).find((c) => c.connectionId === crawl.connectionId);
    expect(row).toMatchObject({ provider: 'website_crawl', status: 'connected' });
    expect(row?.nonSecretConfig?.crawl_urls).toEqual(['https://sarahchen.com/services']);
  });

  it('the walk’s writes reach the audit log, newest first', async () => {
    const api = fakeTab().load();
    await api.luciel.pause();
    const [newest] = await api.analytics.auditLog();
    expect(newest).toMatchObject({ eventType: 'lifecycle_transition', detail: 'active → paused' });
  });
});

describe('mock parity the walk relies on', () => {
  it('Twilio takes its credential form as the fallback to OAuth (service.py _takes_form)', async () => {
    const api = createLucielClient({ adapter: 'mock' });
    await api.connections.start('sms_sender', 'twilio');
    const row = (await api.connections.list()).find((c) => c.connectionType === 'sms_sender')!;
    const saved = await api.connections.submitCredentials(row.connectionId, {
      accountSid: 'AC00000000000000000000000000000001',
      authToken: 'test-auth-token',
    });
    // An account on file with no designated number is not live (§3.1.4).
    expect(saved.status).toBe('unconfigured');
    expect(saved.statusDetail).toMatch(/^Action needed: add your number/);
    expect(saved.nonSecretConfig?.accountSid).toBe('AC00000000000000000000000000000001');
    expect(saved.nonSecretConfig).not.toHaveProperty('authToken');
  });
});
