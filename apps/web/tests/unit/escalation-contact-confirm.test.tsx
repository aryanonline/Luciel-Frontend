import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import EscalationContactConfirmPage from '@/app/(auth)/escalation-contact/confirm/page';

/**
 * Round 5B item 13 — the public confirmation landing. The confirmation email
 * links every contact here; the recipient is usually NOT the account owner and
 * has no session, so the page must resolve the token on its own and land on
 * plain success/failure copy. Before this page existed the emailed link 404'd
 * and no contact could ever complete verification.
 */

const confirmApi = vi.fn();
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => nav.params,
  usePathname: () => '/escalation-contact/confirm',
  useParams: () => ({}),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      escalationContact: {
        confirm: (...args: unknown[]) => Promise.resolve(confirmApi(...args)),
      },
    },
  };
});

beforeEach(() => {
  confirmApi.mockReset();
  nav.params = new URLSearchParams();
});

describe('public escalation-contact confirmation (round 5B item 13)', () => {
  it('consumes the token and lands on confirmed copy', async () => {
    nav.params = new URLSearchParams('token=tok-123');
    confirmApi.mockReturnValue({ status: 'confirmed' });

    renderWithQuery(<EscalationContactConfirmPage />);

    expect(await screen.findByText('Address confirmed')).toBeInTheDocument();
    expect(confirmApi).toHaveBeenCalledWith({ token: 'tok-123' });
    expect(screen.getByText(/escalation alerts/i)).toBeInTheDocument();
  });

  it('an expired or used link explains itself and points at the owner re-send', async () => {
    nav.params = new URLSearchParams('token=expired');
    confirmApi.mockImplementation(() => {
      throw new Error('validation_error');
    });

    renderWithQuery(<EscalationContactConfirmPage />);

    expect(await screen.findByText(/this confirmation link didn't work/i)).toBeInTheDocument();
    expect(screen.getByText(/ask the business owner to re-send/i)).toBeInTheDocument();
  });

  it('no token at all is the failure state, not a blank page', async () => {
    renderWithQuery(<EscalationContactConfirmPage />);

    expect(await screen.findByText(/this confirmation link didn't work/i)).toBeInTheDocument();
    expect(confirmApi).not.toHaveBeenCalled();
  });
});
