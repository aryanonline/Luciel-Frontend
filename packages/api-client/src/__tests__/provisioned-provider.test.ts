import { describe, it, expect } from 'vitest';
import { createLucielClient, LucielApiError } from '../index';

/**
 * Round 7 WP-10, item 1: the mock serves the CSV record source EXACTLY as the
 * backend registry does — `authKind: 'provisioned'`, no credential fields — and
 * answers a start/credentials pair for it the way the backend does (a
 * `requiresClientForm` start, then a refused credential POST with the backend's
 * own wording). The mock used to say `credential_form` with no fields, which
 * hid a dead-end "Connect CSV upload" button from every test that ran on it.
 */
describe('mock serves the CSV record source as the backend does', () => {
  it('lists csv as a provisioned resource with no credential form', async () => {
    const client = createLucielClient({ adapter: 'mock' });
    const [group] = await client.connections.listProviders('record_source');
    const csv = group?.providers.find((p) => p.provider === 'csv');
    expect(csv?.authKind).toBe('provisioned');
    expect(csv?.credentialFields).toEqual([]);
    expect(csv?.configured).toBe(true);
  });

  it('answers a csv start with requiresClientForm and refuses the credential POST', async () => {
    const client = createLucielClient({ adapter: 'mock' });
    const start = await client.connections.start('record_source', 'csv');
    expect(start.requiresClientForm).toBe(true);
    expect(start.authorizeUrl ?? null).toBeNull();

    const row = (await client.connections.list()).find(
      (c) => c.connectionType === 'record_source',
    );
    expect(row?.provider).toBe('csv');
    const attempt = client.connections.submitCredentials(row!.connectionId, {});
    await expect(attempt).rejects.toBeInstanceOf(LucielApiError);
    await expect(attempt).rejects.toThrow("Provider 'csv' does not take a credential form.");
  });
});
