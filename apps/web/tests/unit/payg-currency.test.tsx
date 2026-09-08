import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarketingPage from '@/app/(marketing)/page';
import TermsPage from '@/app/(marketing)/legal/terms/page';

/**
 * Round 6 WP-K: the price names its currency. The Stripe price object is CAD
 * (provision_stripe_test.py), and a bare "$39" reads as USD to most visitors — so
 * every place the block price is shown says "$39 CAD".
 */
describe('the PAYG price is stated in CAD', () => {
  it('on the marketing page', () => {
    render(<MarketingPage />);
    expect(screen.getByText('$39 CAD')).toBeInTheDocument();
    expect(screen.queryByText(/^\$39$/)).not.toBeInTheDocument();
  });

  it('in the terms', () => {
    render(<TermsPage />);
    expect(screen.getByText(/\$39 CAD per 100 conversations/)).toBeInTheDocument();
  });
});
