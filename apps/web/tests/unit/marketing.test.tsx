import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/(marketing)/page';

/**
 * Content checks for the landing page: the honesty notes and plain pricing must
 * be present (Customer Journey §1, Vision §7). These guard against accidentally
 * dropping the brand-differentiating honesty section or the no-tier framing.
 */
describe('marketing landing page', () => {
  it('shows the hero line and a no-credit-card CTA', () => {
    render(<HomePage />);
    expect(screen.getByText('Your business, answered.')).toBeInTheDocument();
    // The CTA appears in the hero and the final section.
    expect(screen.getAllByText(/Start free — no credit card/).length).toBeGreaterThan(0);
  });

  it('states pricing plainly with no implied tiers', () => {
    render(<HomePage />);
    expect(screen.getByText(/per 100 conversations after that/)).toBeInTheDocument();
    expect(screen.getByText(/One plan\. No tiers\./)).toBeInTheDocument();
    expect(screen.getByText(/Every feature is included on every account/)).toBeInTheDocument();
  });

  it('states the honest launch limit (own-domain email supported; one login)', () => {
    render(<HomePage />);
    // Own-domain email is a launch capability now (Arch §3.1.6a, Decision #49) —
    // no longer listed as a limit. The one remaining launch limit is one login.
    expect(screen.getByText(/Email works on your own domain from day one/)).toBeInTheDocument();
    expect(screen.getByText(/one login per\s+account/)).toBeInTheDocument();
    expect(screen.queryByText(/VantageMind subdomain/)).not.toBeInTheDocument();
  });

  it('shows the concise included-features list', () => {
    render(<HomePage />);
    expect(screen.getByText('Everything included')).toBeInTheDocument();
    expect(screen.getByText(/never trains AI/)).toBeInTheDocument();
  });
});
