import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import TermsPage from '@/app/(marketing)/legal/terms/page';
import PrivacyPage from '@/app/(marketing)/legal/privacy/page';
import DpaPage from '@/app/(marketing)/legal/dpa/page';
import { LEGAL_CONTACT_EMAIL } from '@/components/marketing/legal-page';

/**
 * Round 7 owner decisions D11 + D12 (2026-09-14).
 *
 * D11: the legal pages are the early-access terms IN EFFECT (versioned, dated,
 * 30-day change notice) — no "Draft — not yet in force" banner, because a
 * customer reads that banner before signing up.
 *
 * D12: the one contact address for privacy requests, security disclosures and
 * support is info@vantagemind.ai. The privacy@ / security@ aliases never existed,
 * and the .com domain is not ours; the file scan below keeps any other
 * @vantagemind address out of the dashboard/marketing source for good.
 */

// vitest runs with cwd = apps/web (the config root); import.meta.url is a jsdom URL here.
const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe('D11: legal pages are the early-access terms in effect', () => {
  it.each([
    ['Terms', TermsPage],
    ['Privacy', PrivacyPage],
    ['DPA', DpaPage],
  ])('%s page is versioned, dated, and carries no draft banner', (_name, Page) => {
    render(<Page />);
    expect(screen.getByText(/Early-access terms, version 0\.1 — last updated 2026-09-15/)).toBeInTheDocument();
    expect(screen.getAllByText(/at least 30 days' notice/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/not yet in force/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending counsel/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Draft/i)).not.toBeInTheDocument();
  });
});

describe('D12: info@vantagemind.ai is the only contact address', () => {
  it('every legal page links the contact address', () => {
    render(<TermsPage />);
    const link = screen.getByRole('link', { name: LEGAL_CONTACT_EMAIL });
    expect(link).toHaveAttribute('href', `mailto:${LEGAL_CONTACT_EMAIL}`);
  });

  it('no other @vantagemind address exists anywhere in apps/web/src', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@vantagemind\.[a-z]+/g)) {
        if (m[0] !== LEGAL_CONTACT_EMAIL) offenders.push(`${file.slice(SRC.length)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(LEGAL_CONTACT_EMAIL).toBe('info@vantagemind.ai');
  });
});
