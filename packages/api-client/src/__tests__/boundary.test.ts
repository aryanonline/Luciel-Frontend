import { describe, it, expect } from 'vitest';
import { createLucielClient, LucielApiError, chipForConnection } from '../index';
import type { LucielApiClient } from '../client';

/**
 * These tests guard the api-client boundary contract (Space Instructions §7):
 *  - one interface, two adapters, selected by one flag;
 *  - the mock models the states the UI must handle.
 * They are scaffold-level (interface-shape + state) checks, not feature tests.
 */

describe('adapter selection (one flag)', () => {
  it('returns the same interface shape for mock and http', () => {
    const mock = createLucielClient({ adapter: 'mock' });
    const http = createLucielClient({ adapter: 'http', baseUrl: 'https://api.example.com' });
    // Both satisfy LucielApiClient: the method namespaces line up.
    const namespaces: (keyof LucielApiClient)[] = [
      'auth',
      'luciel',
      'knowledge',
      'connections',
      'conversations',
      'leads',
      'billing',
      'analytics',
      'account',
      'contact',
    ];
    for (const ns of namespaces) {
      expect(Object.keys(mock[ns]).sort()).toEqual(Object.keys(http[ns]).sort());
    }
  });

  it('throws if http adapter is selected without a baseUrl', () => {
    expect(() => createLucielClient({ adapter: 'http' })).toThrow();
  });
});

describe('mock models the required states', () => {
  it('unverified scenario blocks gated calls with verification_required', async () => {
    const client = createLucielClient({ adapter: 'mock', mock: { scenario: 'unverified' } });
    await expect(client.luciel.get()).rejects.toBeInstanceOf(LucielApiError);
    await client.luciel.get().catch((e: LucielApiError) => {
      expect(e.code).toBe('verification_required');
    });
  });

  it('expired_session scenario throws unauthorized (401 mid-session)', async () => {
    const client = createLucielClient({ adapter: 'mock', mock: { scenario: 'expired_session' } });
    await client.luciel.get().catch((e: LucielApiError) => {
      expect(e.code).toBe('unauthorized');
    });
  });

  it('at_cap scenario exposes a capped budget with no payment method', async () => {
    const client = createLucielClient({ adapter: 'mock', mock: { scenario: 'at_cap' } });
    const billing = await client.billing.get();
    expect(billing.budget.atCap).toBe(true);
    expect(billing.budget.billingState).toBe('free_cap');
  });

  it('payg scenario has a payment method and bills above 50', async () => {
    const client = createLucielClient({ adapter: 'mock', mock: { scenario: 'payg' } });
    const billing = await client.billing.get();
    expect(billing.budget.billingState).toBe('payg_enabled');
    expect(billing.paymentMethod).toBeDefined();
    expect(billing.budget.billedThisPeriod).toBeGreaterThan(0);
  });

  it('grace scenario puts the Luciel in the 30-day grace window', async () => {
    const client = createLucielClient({ adapter: 'mock', mock: { scenario: 'grace' } });
    const luciel = await client.luciel.get();
    expect(luciel?.state).toBe('luciel_grace_window');
    expect(luciel?.graceWindowStartedAt).toBeDefined();
  });

  it('restore returns the Luciel to active, not paused (Arch §3.6.4)', async () => {
    const client = createLucielClient({ adapter: 'mock', mock: { scenario: 'grace' } });
    const restored = await client.luciel.restore();
    expect(restored.state).toBe('active');
    expect(restored.graceWindowStartedAt).toBeUndefined();
  });

  it('exposes healthy AND expired connections (states the UI must render)', async () => {
    const client = createLucielClient({ adapter: 'mock' });
    const conns = await client.connections.list();
    const statuses = conns.map((c) => c.status);
    expect(statuses).toContain('connected');
    expect(statuses).toContain('expired');
  });
});

describe('contact form (public, unauthenticated)', () => {
  it('accepts a captcha-backed message without a session', async () => {
    const client = createLucielClient({ adapter: 'mock', mock: { scenario: 'expired_session' } });
    await expect(
      client.contact.submit({
        name: 'Ada',
        email: 'ada@example.com',
        message: 'I have a question about pricing.',
        captchaToken: 'valid',
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('rejects a captcha the server will not accept', async () => {
    const client = createLucielClient({ adapter: 'mock' });
    await client.contact
      .submit({
        name: 'Ada',
        email: 'ada@example.com',
        message: 'I have a question about pricing.',
        captchaToken: 'invalid',
      })
      .catch((e: LucielApiError) => {
        expect(e.code).toBe('validation_error');
      });
  });
});

describe('Axis10: removePaymentMethod returns BillingInfo (backend changed 204→200+body)', () => {
  it('mock removePaymentMethod returns a BillingInfo object with budget fields', async () => {
    const client = createLucielClient({ adapter: 'mock', mock: { scenario: 'payg' } });
    // Confirm payg has a payment method before removal.
    const before = await client.billing.get();
    expect(before.paymentMethod).toBeDefined();

    const result = await client.billing.removePaymentMethod();
    // Must return a BillingInfo (not undefined / void).
    expect(result).toBeDefined();
    expect(result.budget).toBeDefined();
    expect(result.budget.billingState).toBe('free_cap');
    // Payment method must be absent after removal.
    expect(result.paymentMethod).toBeUndefined();
  });
});

describe('connection chip mapping (Arch §3.8.1/§3.8.4)', () => {
  it('maps status → the three original customer-facing chips (registryConfigured omitted)', () => {
    expect(chipForConnection('connected')).toBe('connected');
    expect(chipForConnection('expired')).toBe('reconnect_needed');
    expect(chipForConnection('unconfigured')).toBe('action_needed');
    expect(chipForConnection('error')).toBe('action_needed');
  });

  // Arch §3.1.4: a BYO number not hosted in the tenant's own Twilio account is an
  // actionable state (host/port the number), never a bare "error" and never
  // "connected". The wire enum gained the value so the guidance survives to the UI.
  it('not_operable_hosting_required is action_needed (actionable, not a bare error)', () => {
    expect(chipForConnection('not_operable_hosting_required')).toBe('action_needed');
    expect(chipForConnection('not_operable_hosting_required', false)).toBe('not_available');
  });

  // Harmony wave 2, item 6a: a provider the served registry does not hold at
  // all can never be told "Action needed" — there is no button that does
  // anything. `registryConfigured: true` (explicit) must reproduce the
  // original three-chip behavior exactly.
  it('registryConfigured: true reproduces the original three-chip behavior exactly', () => {
    expect(chipForConnection('connected', true)).toBe('connected');
    expect(chipForConnection('expired', true)).toBe('reconnect_needed');
    expect(chipForConnection('unconfigured', true)).toBe('action_needed');
    expect(chipForConnection('error', true)).toBe('action_needed');
  });

  it('registryConfigured: false collapses EVERY status to not_available, with no exceptions (backend contract: providerAvailable wins regardless of status)', () => {
    // backend_gaps.md §"Harmony wave 2", FE CONTRACT BLOCK item 3: "the
    // Overview row must render... never the owner-actionable 'Action needed'
    // status chip, regardless of what the row's own `status` field says."
    // That "regardless" is explicit and applies to `connected` too — a
    // provider the registry can no longer connect is not available, full
    // stop, even if a stale row still says `connected`.
    expect(chipForConnection('connected', false)).toBe('not_available');
    expect(chipForConnection('expired', false)).toBe('not_available');
    expect(chipForConnection('unconfigured', false)).toBe('not_available');
    expect(chipForConnection('error', false)).toBe('not_available');
    expect(chipForConnection('not_connected', false)).toBe('not_available');
    expect(chipForConnection('dormant', false)).toBe('not_available');
    expect(chipForConnection('pending_carrier_registration', false)).toBe('not_available');
    expect(chipForConnection('pending_email_routing', false)).toBe('not_available');
  });
});
