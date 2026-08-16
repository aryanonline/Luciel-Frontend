import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLucielClient } from '../index';
import { createWidgetClient } from '../widget';

/**
 * The two planes must send OPPOSITE cookie modes, and getting this wrong is
 * invisible in unit-land but fatal in a browser: the widget data-plane answers
 * with `Access-Control-Allow-Origin: *` (it authenticates via embedKey in the
 * body), and a browser refuses a wildcard ACAO on a credentialed request — the
 * preflight fails and the widget renders NOTHING on the customer's site.
 * The admin plane is the inverse: credentialed + strict-origin, so it MUST keep
 * sending the httpOnly session cookie.
 */

const BASE_URL = 'https://api.example.com';

// A schema-valid widget bootstrap body: the widget data-plane now zod-parses
// responses (fail-closed on a customer's site), so the stub must serve a shape
// the parser accepts — the assertion under test is still only the cookie mode.
const VALID_BOOTSTRAP = {
  renderState: 'active',
  businessName: 'Acme',
  assistantName: 'Acme assistant',
  openingMessage: "Hi — I'm the AI assistant for Acme.",
  aiAssistantLabel: 'AI assistant',
  poweredByVantageMind: true,
};

function stubFetch(body: unknown = {}) {
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

const credentialsOf = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls[0]?.[1]?.credentials;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transport cookie mode per plane', () => {
  it("the widget client omits credentials so a wildcard-ACAO preflight can't fail", async () => {
    const fetchMock = stubFetch(VALID_BOOTSTRAP);
    await createWidgetClient({ adapter: 'http', baseUrl: BASE_URL }).bootstrap('vm_live_demo');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credentialsOf(fetchMock)).toBe('omit');
  });

  it('the widget bootstrap fails closed on a response the schema does not recognize', async () => {
    // A 200 whose body carries an unknown renderState (or is missing the
    // AI-disclosure chrome) must REJECT — the widget then renders nothing on
    // the host page instead of an active-looking panel whose sends go nowhere.
    stubFetch({ ...VALID_BOOTSTRAP, renderState: 'revoked' });
    await expect(
      createWidgetClient({ adapter: 'http', baseUrl: BASE_URL }).bootstrap('vm_live_demo'),
    ).rejects.toThrow();
  });

  it('the admin client still includes the httpOnly session cookie', async () => {
    const fetchMock = stubFetch();
    await createLucielClient({ adapter: 'http', baseUrl: BASE_URL }).luciel.get();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credentialsOf(fetchMock)).toBe('include');
  });

  it('the admin lead export is credentialed too — it is an authenticated download', async () => {
    const fetchMock = stubFetch();
    await createLucielClient({ adapter: 'http', baseUrl: BASE_URL }).leads.export('csv');

    expect(credentialsOf(fetchMock)).toBe('include');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/api/v1/dashboard/leads/export?format=csv`,
    );
  });
});
