import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderWithQuery } from './test-utils';
import ContactPage from '@/app/(marketing)/contact/page';
import SignupPage from '@/app/(auth)/signup/page';
import { LEGAL_CONTACT_EMAIL } from '@/components/marketing/legal-page';

/**
 * Round 7 owner decisions D11 + D12, pinned at the two places a visitor meets them.
 *
 * D12: LEGAL_CONTACT_EMAIL (info@vantagemind.ai) is the ONLY address the product
 * names. Every `mailto:` in apps/web/src either carries no recipient (the owner's own
 * mail client, e.g. "Email this to my web person") or LEGAL_CONTACT_EMAIL; no other
 * literal address of ANY domain lives in the source; and the contact page — a relay
 * form whose inbox lives server-side — renders no other address or mailto.
 *
 * D11: the signup consent line names the Early-access Terms and the Privacy Policy,
 * linked, and no longer calls them drafts.
 */

vi.mock('@/components/marketing/hcaptcha', () => ({ HCaptcha: () => null }));

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe('D12: one contact address', () => {
  it('every mailto in apps/web/src is recipient-less or LEGAL_CONTACT_EMAIL', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      // A link target starts with a recipient, a query or a template expression; a
      // prose mention ("no mailto:, no rendered address") is not a link.
      for (const m of text.matchAll(/mailto:([A-Za-z0-9?$][^`'"\s)]*)/g)) {
        const target = m[1] ?? '';
        const ok =
          target === '' ||
          target.startsWith('?') ||
          target === LEGAL_CONTACT_EMAIL ||
          target === '${LEGAL_CONTACT_EMAIL}';
        if (!ok) offenders.push(`${file.slice(SRC.length)}: mailto:${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no literal address of any domain other than LEGAL_CONTACT_EMAIL lives in the source', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g)) {
        if (m[0] !== LEGAL_CONTACT_EMAIL) offenders.push(`${file.slice(SRC.length)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the contact page renders no other address and no other mailto', () => {
    const { container } = renderWithQuery(<ContactPage />);
    const text = container.textContent ?? '';
    const addresses = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g) ?? [];
    expect(addresses.filter((a) => a !== LEGAL_CONTACT_EMAIL)).toEqual([]);
    for (const a of Array.from(container.querySelectorAll('a[href^="mailto:"]'))) {
      expect(a.getAttribute('href')).toBe(`mailto:${LEGAL_CONTACT_EMAIL}`);
    }
  });
});

describe('D11: the signup consent line', () => {
  it('names the Early-access Terms and the Privacy Policy, linked, and not as drafts', () => {
    render(<SignupPage />);
    const line = screen.getByTestId('signup-consent');
    expect(line).toHaveTextContent(
      'By creating an account you agree to the Early-access Terms and Privacy Policy',
    );
    expect(within(line).getByRole('link', { name: 'Early-access Terms' })).toHaveAttribute(
      'href',
      '/legal/terms',
    );
    expect(within(line).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/legal/privacy',
    );
    expect(line.textContent).not.toMatch(/draft/i);
  });
});
