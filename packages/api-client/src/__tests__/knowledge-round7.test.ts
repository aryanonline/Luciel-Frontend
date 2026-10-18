import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLucielClient } from '../index';

/**
 * Round 7 WP-4c (Luciel-Backend app/api/v1/admin/knowledge.py,
 * schemas_api/knowledge.py): the chunk page with its total; a revoked grant's
 * re-sync pausing the sources and marking the connection broken before the 409;
 * an item gone at its origin tombstoned (404 on re-sync) and never restorable (409).
 */

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown) {
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
}

const http = () => createLucielClient({ adapter: 'http', baseUrl: 'https://api.example.com' });
const chunk = {
  chunkId: 'c0c0c0c0-0000-4000-8000-000000000001',
  sourceId: '11111111-1111-4111-8111-111111111111',
  ordinal: 0,
  text: 'piece',
};

describe('HTTP: the chunk page', () => {
  it('reads KnowledgeChunkPageOut as served', async () => {
    stubFetch({ chunks: [chunk], totalChunks: 300, pageSize: 20 });
    expect(await http().knowledge.getChunks(chunk.sourceId)).toEqual({
      chunks: [chunk],
      totalChunks: 300,
      pageSize: 20,
    });
  });

  it("an older server's bare list leaves the total unknown, never the page length", async () => {
    stubFetch([chunk]);
    expect(await http().knowledge.getChunks(chunk.sourceId)).toEqual({
      chunks: [chunk],
      totalChunks: null,
      pageSize: null,
    });
  });
});

describe('mock: knowledge_states', () => {
  const DRIVE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('serves a page bounded at 20 with the real total', async () => {
    const api = createLucielClient({ adapter: 'mock' });
    const [first] = await api.knowledge.listSources();
    const out = await api.knowledge.getChunks(first!.sourceId);
    expect(out.pageSize).toBe(20);
    expect(out.chunks.length).toBeLessThanOrEqual(20);
    expect(out.totalChunks).toBeGreaterThan(out.chunks.length);
  });

  it('a re-sync on the revoked grant pauses its sources and marks the row broken, then 409s', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'knowledge_states' } });
    expect((await api.connections.list()).find((c) => c.connectionId === DRIVE)?.status).toBe(
      'connected',
    );
    const driveSource = (await api.knowledge.listSources()).find((s) => s.connectionId === DRIVE);
    await expect(api.knowledge.resyncSource(driveSource!.sourceId)).rejects.toMatchObject({
      code: 'conflict',
    });
    const row = (await api.connections.list()).find((c) => c.connectionId === DRIVE);
    expect(row?.status).toBe('error');
    const after = (await api.knowledge.listSources()).find((s) => s.connectionId === DRIVE);
    expect(after?.syncStatus).toBe('paused_reconnect_needed');
    expect(after?.pausedSince).toBeTruthy();
  });

  it('serves a source still answering and one that has stopped', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'knowledge_states' } });
    const paused = (await api.knowledge.listSources()).filter(
      (s) => s.syncStatus === 'paused_reconnect_needed',
    );
    const ages = paused
      .map((s) => Math.round((Date.now() - new Date(s.pausedSince!).getTime()) / 86_400_000))
      .sort((a, b) => a - b);
    expect(ages).toEqual([3, 9]);
  });

  it('an item gone at its origin: 404 on re-sync, then a 409 on restore', async () => {
    const api = createLucielClient({ adapter: 'mock', mock: { scenario: 'knowledge_states' } });
    const gone = (await api.knowledge.listSources()).find(
      (s) => s.name === 'sarahchen.com/old-pricing',
    );
    await expect(api.knowledge.resyncSource(gone!.sourceId)).rejects.toMatchObject({
      code: 'not_found',
      message: 'Source no longer exists at the sync origin.',
    });
    expect((await api.knowledge.listSources()).some((s) => s.sourceId === gone!.sourceId)).toBe(
      false,
    );
    await expect(api.knowledge.restoreSource(gone!.sourceId)).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('cannot be restored here'),
    });
  });

  it("an owner's own delete is still restorable", async () => {
    const api = createLucielClient({ adapter: 'mock' });
    const [first] = await api.knowledge.listSources();
    await api.knowledge.deleteSource(first!.sourceId);
    expect((await api.knowledge.restoreSource(first!.sourceId)).sourceId).toBe(first!.sourceId);
  });
});
