import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWidgetClient } from '../widget';
import { LucielApiError } from '../schemas';

/**
 * The explicit end-of-session signal (Arch §3.4.8b): POST
 * /api/v1/chat-widget/sessions/{session_id}/end?embedKey=… → 204. The route is
 * the backend's declared contract (chat_widget.py end_session: embed key as a
 * camelCase query parameter, no body, 204 no-content, idempotent). Sent as an
 * ordinary data-plane fetch — credentials omitted like every widget request,
 * and never via navigator.sendBeacon (audit F049: a per-navigation beacon split
 * one visit into several billed conversations; the end is a visitor's explicit
 * action only).
 */

const BASE_URL = 'https://api.example.com';
const SESSION = '00000000-0000-4000-8000-0000000000e9';

function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('widget endSession — the §3.4.8b explicit end signal', () => {
  it('POSTs to the declared route with the embed key as a query parameter and resolves on 204', async () => {
    const fetchMock = stubFetch(204);
    const client = createWidgetClient({ adapter: 'http', baseUrl: BASE_URL });

    await expect(client.endSession('vm_live_demo', SESSION)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `${BASE_URL}/api/v1/chat-widget/sessions/${SESSION}/end?embedKey=vm_live_demo`,
    );
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    // Data plane: no cookie, so a wildcard-ACAO preflight cannot fail.
    expect(init?.credentials).toBe('omit');
  });

  it('is an ordinary fetch — it never reaches for navigator.sendBeacon', async () => {
    stubFetch(204);
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    await createWidgetClient({ adapter: 'http', baseUrl: BASE_URL }).endSession(
      'vm_live_demo',
      SESSION,
    );
    expect(beacon).not.toHaveBeenCalled();
  });

  it('surfaces a refusal as a typed error so the widget can say the end did not go through', async () => {
    stubFetch(403, { message: "This chat isn't available on this website." });
    await expect(
      createWidgetClient({ adapter: 'http', baseUrl: BASE_URL }).endSession(
        'vm_live_demo',
        SESSION,
      ),
    ).rejects.toBeInstanceOf(LucielApiError);
  });

  it('the mock client acks an end without inventing state', async () => {
    const client = createWidgetClient({ adapter: 'mock' });
    await expect(client.endSession('vm_live_demo', SESSION)).resolves.toBeUndefined();
  });
});
