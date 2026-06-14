import Link from 'next/link';
import { Container, Logo } from '@luciel/ui';

/**
 * Site footer — shared across marketing surfaces. Carries the legal links
 * (Terms / Privacy / DPA) the product implies, plus the "Powered by" line.
 * These were missing before; the legal pages they point to are placeholder-
 * pending-counsel (the Legal doc is a DRAFT, not in force).
 */
const productLinks = [
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/signup', label: 'Start free' },
  { href: '/login', label: 'Log in' },
];

const legalLinks = [
  { href: '/legal/terms', label: 'Terms of Service' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/dpa', label: 'Data Processing Addendum' },
];

export function SiteFooter() {
  return (
    <footer className="mt-vm-9 border-t border-vm-border bg-vm-surface">
      <Container className="py-vm-8">
        <div className="grid gap-vm-6 sm:grid-cols-3">
          <div>
            <Logo />
            <p className="mt-vm-3 max-w-xs text-vm-1 text-vm-text-muted">
              An AI employee for your business — answering customers, capturing leads, and knowing
              when to bring in a person.
            </p>
          </div>
          <nav aria-label="Product">
            <h2 className="text-vm-0 font-label uppercase tracking-[0.08em] text-vm-text-muted">
              Product
            </h2>
            <ul className="mt-vm-3 space-y-vm-2 text-vm-1">
              {productLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-vm-text hover:text-vm-accent">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Legal">
            <h2 className="text-vm-0 font-label uppercase tracking-[0.08em] text-vm-text-muted">
              Legal
            </h2>
            <ul className="mt-vm-3 space-y-vm-2 text-vm-1">
              {legalLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-vm-text hover:text-vm-accent">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-vm-6 flex flex-wrap items-center justify-between gap-vm-2 border-t border-vm-border pt-vm-4 text-vm-0 text-vm-text-muted">
          <span>© {new Date().getFullYear()} VantageMind. All rights reserved.</span>
          <span>Powered by VantageMind · Data resident in AWS Canada Central</span>
        </div>
      </Container>
    </footer>
  );
}
