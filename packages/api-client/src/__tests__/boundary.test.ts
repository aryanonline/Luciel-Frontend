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
  it('maps status → the three customer-facing chips', () => {
    expect(chipForConnection('connected')).toBe('connected');
    expect(chipForConnection('expired')).toBe('reconnect_needed');
    expect(chipForConnection('unconfigured')).toBe('action_needed');
    expect(chipForConnection('error')).toBe('action_needed');
  });
});
