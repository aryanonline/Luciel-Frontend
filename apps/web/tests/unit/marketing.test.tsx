import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/(marketing)/page';

/**
 * Scaffold-level content checks for the landing page: the honesty notes and
 * plain pricing must be present (Customer Journey §1, Vision §7). These guard
 * against accidentally dropping the brand-differentiating honesty section.
 */
describe('marketing landing page', () => {
  it('shows the hero line and the no-credit-card CTA', () => {
    render(<HomePage />);
    expect(screen.getByText('Your business, answered.')).toBeInTheDocument();
    expect(screen.getByText(/Start free — no credit card/)).toBeInTheDocument();
  });

  it('states pricing plainly with no implied tiers', () => {
    render(<HomePage />);
    expect(screen.getByText(/\$39 per 100 conversations/)).toBeInTheDocument();
    expect(screen.getByText(/Every feature is included, on every/)).toBeInTheDocument();
  });

  it('keeps the honest launch-constraint notes (email subdomain, one login)', () => {
    render(<HomePage />);
    expect(screen.getByText(/inbound.vantagemind.com/)).toBeInTheDocument();
    expect(screen.getByText(/One account, one login/)).toBeInTheDocument();
  });
});
