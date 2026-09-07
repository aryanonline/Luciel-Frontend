import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import EmbedPage from '@/app/(app)/dashboard/embed/page';
import { LucielApiError } from '@luciel/api-client';

/**
 * Round 6 WP-I (audit F066): the Embed page owns the list of websites that may
 * load the chat. Empty = any page (said plainly); the registered site is offered
 * as the first entry; every change saves at once and reports its own outcome,
 * including the server's refusal of a non-origin.
 */
const served = vi.hoisted(() => ({
  origins: null as string[] | null,
  calls: [] as string[][],
  refuse: null as string | null,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      luciel: {
        ...actual.api.luciel,
        get: async () => {
          const base = await actual.api.luciel.get();
          return base
            ? { ...base, websiteUrl: 'acme.example', allowedOrigins: served.origins }
            : base;
        },
        updateAllowedOrigins: async (origins: string[]) => {
          served.calls.push(origins);
          if (served.refuse) {
            throw new LucielApiError({ code: 'validation_error', message: served.refuse });
          }
          served.origins = origins.length ? origins : null;
          const base = await actual.api.luciel.get();
          return { ...base!, websiteUrl: 'acme.example', allowedOrigins: served.origins };
        },
      },
    },
  };
});

describe('Embed page: websites that may load the chat', () => {
  beforeEach(() => {
    served.origins = null;
    served.calls = [];
    served.refuse = null;
  });

  it('says any page may load the chat while the list is empty and offers the registered site', async () => {
    renderWithQuery(<EmbedPage />);
    expect(await screen.findByTestId('origins-empty')).toHaveTextContent(
      'Any website can load your chat right now.',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add https://acme.example' }));
    await waitFor(() => expect(served.calls).toEqual([['https://acme.example']]));
    expect(await screen.findByText('https://acme.example can load your chat.')).toBeInTheDocument();
  });

  it('lists the saved sites, removes one, and adds a typed one', async () => {
    served.origins = ['https://acme.example', 'https://shop.acme.example'];
    renderWithQuery(<EmbedPage />);
    const list = await screen.findByRole('list', { name: 'Allowed websites' });
    expect(list).toHaveTextContent('https://acme.example');
    expect(list).toHaveTextContent('https://shop.acme.example');
    fireEvent.click(screen.getByRole('button', { name: 'Remove https://shop.acme.example' }));
    await waitFor(() => expect(served.calls).toEqual([['https://acme.example']]));
    fireEvent.change(screen.getByPlaceholderText('https://www.example.com'), {
      target: { value: 'https://landing.acme.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    await waitFor(() =>
      expect(served.calls[1]).toEqual(['https://acme.example', 'https://landing.acme.example']),
    );
  });

  it("shows the server's refusal instead of pretending a bad address was saved", async () => {
    served.refuse =
      "'https://acme.example/pricing' is not a website address — use the form https://www.example.com (no path or query).";
    renderWithQuery(<EmbedPage />);
    await screen.findByTestId('origins-empty');
    fireEvent.change(screen.getByPlaceholderText('https://www.example.com'), {
      target: { value: 'https://acme.example/pricing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    expect(await screen.findByText(/is not a website address/)).toBeInTheDocument();
    expect(screen.getByTestId('origins-empty')).toBeInTheDocument();
  });
});
