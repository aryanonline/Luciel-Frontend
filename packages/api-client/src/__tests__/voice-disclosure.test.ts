import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLucielClient } from '../index';
import { personalityConfig, personalityForWrite } from '../schemas';

/**
 * Round 7 voice-disclosure contract: `personality.voiceDisclosureIntro` (optional,
 * ≤ 200, empty = none) and the READ-ONLY `personality.voiceDisclosurePreview`. The
 * personality PUT is a StrictWireModel (extra='forbid'), so the preview must never
 * ride back, and an intro key an older server never served must not either.
 */

afterEach(() => vi.unstubAllGlobals());

describe('schema', () => {
  it('parses a server with and without the two fields', () => {
    expect(personalityConfig.parse({ preset: 'warm_concierge' })).toEqual({
      preset: 'warm_concierge',
    });
    expect(
      personalityConfig.parse({
        preset: 'warm_concierge',
        voiceDisclosureIntro: null,
        voiceDisclosurePreview: "You're speaking with an AI assistant…",
      }).voiceDisclosurePreview,
    ).toBe("You're speaking with an AI assistant…");
    expect(
      personalityConfig.safeParse({
        preset: 'warm_concierge',
        voiceDisclosureIntro: 'x'.repeat(201),
      }).success,
    ).toBe(false);
  });

  it('personalityForWrite drops the read-only preview and an unserved intro', () => {
    expect(
      personalityForWrite({
        preset: 'warm_concierge',
        voiceDisclosureIntro: 'Hi.',
        voiceDisclosurePreview: 'Hi. You are speaking with an AI assistant…',
      }),
    ).toEqual({ preset: 'warm_concierge', voiceDisclosureIntro: 'Hi.' });
    expect(personalityForWrite({ preset: 'warm_concierge' })).toEqual({ preset: 'warm_concierge' });
  });
});

describe('HTTP: the PUT never carries the preview', () => {
  it('strips voiceDisclosurePreview from the personality body', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = createLucielClient({ adapter: 'http', baseUrl: 'https://api.example.com' });
    await api.luciel.updatePersonality({
      preset: 'warm_concierge',
      voiceDisclosureIntro: 'Thanks for calling.',
      voiceDisclosurePreview: 'Thanks for calling. You are speaking with an AI assistant…',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.com/api/v1/admin/luciel/personality',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      preset: 'warm_concierge',
      voiceDisclosureIntro: 'Thanks for calling.',
    });
  });
});

describe('mock: the served preview always carries the mandatory facts', () => {
  it('composes intro + facts, clears to facts only, and refuses past 200', async () => {
    const api = createLucielClient({ adapter: 'mock' });
    const before = await api.luciel.get();
    expect(before?.personality.voiceDisclosurePreview).toMatch(
      /^You're speaking with an AI assistant/,
    );

    const withIntro = await api.luciel.updatePersonality({
      ...before!.personality,
      voiceDisclosureIntro: '  Thanks for calling Sarah Chen Realty.  ',
    });
    expect(withIntro.personality.voiceDisclosureIntro).toBe(
      'Thanks for calling Sarah Chen Realty.',
    );
    expect(withIntro.personality.voiceDisclosurePreview).toMatch(
      /^Thanks for calling Sarah Chen Realty\. You're speaking with an AI assistant, not a human.*recorded and transcribed/,
    );

    const cleared = await api.luciel.updatePersonality({
      ...withIntro.personality,
      voiceDisclosureIntro: '',
    });
    expect(cleared.personality.voiceDisclosureIntro).toBeNull();
    expect(cleared.personality.voiceDisclosurePreview).toMatch(
      /^You're speaking with an AI assistant/,
    );

    await expect(
      api.luciel.updatePersonality({
        ...cleared.personality,
        voiceDisclosureIntro: 'x'.repeat(201),
      }),
    ).rejects.toMatchObject({
      code: 'validation_error',
      message: expect.stringContaining('voiceDisclosureIntro'),
    });
  });
});
