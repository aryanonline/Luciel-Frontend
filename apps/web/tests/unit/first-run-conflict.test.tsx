import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { screen, fireEvent, waitFor, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithQuery } from './test-utils';
import FirstRunPage from '@/app/(app)/first-run/page';
import { LucielApiError, type Session } from '@luciel/api-client';
import { qk } from '@/lib/hooks';

/**
 * First-run resilience (found live on dev, 2026-08-10): the very first thing a
 * brand-new customer does is create their Luciel, and a double-fired submit
 * painted "Something went wrong" OVER a create that had already succeeded —
 * the second POST's 409 ("a Luciel already exists") was rendered as a generic
 * failure. One account, one Luciel (Arch §3.7.1): a conflict on create means
 * the account HAS its Luciel, so the honest response is to go there.
 */

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

const create = vi.fn();
const me = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, me: () => me() },
      luciel: { ...actual.api.luciel, create: (req: unknown) => create(req) },
    },
  };
});

const session = (nextRoute: Session['nextRoute']): Session =>
  ({
    account: {
      adminId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      email: 'owner@example.com',
      state: 'verified',
      createdAt: '2026-01-15T14:00:00Z',
      emailVerified: true,
      hasCompletedFirstRun: nextRoute === 'dashboard',
      hasLuciel: nextRoute === 'dashboard',
    },
    nextRoute,
    notices: [],
  }) as Session;

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/what should we call/i), {
    target: { value: 'Front Desk' },
  });
  fireEvent.change(screen.getByLabelText(/website/i), {
    target: { value: 'example.com' },
  });
  fireEvent.change(screen.getByLabelText(/one sentence/i), {
    target: { value: 'A studio.' },
  });
  fireEvent.click(screen.getByRole('button', { name: /create my luciel/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('first-run create resilience', () => {
  it('a 409 (Luciel already exists) routes to configure instead of claiming failure', async () => {
    create.mockRejectedValueOnce(
      new LucielApiError({
        code: 'conflict',
        message: 'A Luciel already exists for this account.',
      }),
    );
    renderWithQuery(<FirstRunPage />);
    await fillAndSubmit();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/configure'));
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it('a real failure still returns to the form with the error banner', async () => {
    create.mockRejectedValueOnce(new LucielApiError({ code: 'server_error', message: 'boom' }));
    renderWithQuery(<FirstRunPage />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText(/something went wrong creating your luciel/i)).toBeTruthy(),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('success routes to configure exactly once', async () => {
    create.mockResolvedValueOnce({ id: 'l1' });
    renderWithQuery(<FirstRunPage />);
    await fillAndSubmit();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/configure'));
    expect(create).toHaveBeenCalledTimes(1);
  });

  // Round 7 WP-12 (the `fresh` scenario walk): the session cached at login still said
  // `first_run`, so the dashboard guard bounced the owner straight back here after a
  // create that had succeeded. The session is re-read BEFORE leaving first-run.
  it.each([
    ['success', () => create.mockResolvedValueOnce({ id: 'l1' })],
    [
      'a 409 (already exists)',
      () =>
        create.mockRejectedValueOnce(
          new LucielApiError({ code: 'conflict', message: 'A Luciel already exists.' }),
        ),
    ],
  ])('%s: the cached session says dashboard by the time it navigates', async (_label, arrange) => {
    arrange();
    me.mockResolvedValue(session('dashboard'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(qk.session, session('first_run'));
    let routeAtNavigation: string | undefined;
    replace.mockImplementation(() => {
      routeAtNavigation = client.getQueryData<Session>(qk.session)?.nextRoute;
    });
    render(
      <QueryClientProvider client={client}>
        <FirstRunPage />
      </QueryClientProvider>,
    );
    await fillAndSubmit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/configure'));
    expect(me).toHaveBeenCalled();
    expect(routeAtNavigation).toBe('dashboard');
  });
});
