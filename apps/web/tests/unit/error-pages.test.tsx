import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorPage from '@/app/error';
import GlobalError from '@/app/global-error';
import { isChunkLoadError } from '@/lib/chunk-reload';

// next/font is a compiler transform; there is no compiler under vitest.
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'font-var' }) }));

function chunkError(): Error {
  const error = new Error('Loading chunk 812 failed. (error: /_next/static/chunks/812.js)');
  error.name = 'ChunkLoadError';
  return error;
}

describe('the crash pages', () => {
  const originalLocation = window.location;
  const reload = vi.fn();
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.sessionStorage.clear();
    reload.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });
    logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
  });

  it('says what happened, that nothing was lost, and how to reach us', () => {
    render(<ErrorPage error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'This page didn’t load' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was lost/);
    expect(screen.getByText(/info@vantagemind\.ai/)).toBeVisible();
    // Shown as text, not a link.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('logs the error to the console', () => {
    const error = new Error('boom');
    render(<ErrorPage error={error} reset={vi.fn()} />);
    expect(logged).toHaveBeenCalledWith('Page error:', error);
  });

  it('Reload calls reset for an ordinary error, and never reloads by itself', () => {
    const reset = vi.fn();
    render(<ErrorPage error={new Error('boom')} reset={reset} />);
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads automatically once on a chunk failure', () => {
    render(<ErrorPage error={chunkError()} reset={vi.fn()} />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Getting the latest version');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not loop: the failure coming back shows the page copy', () => {
    render(<ErrorPage error={chunkError()} reset={vi.fn()} />).unmount();
    expect(reload).toHaveBeenCalledTimes(1);

    // What the reloaded page does when the chunk is still missing.
    render(<ErrorPage error={chunkError()} reset={vi.fn()} />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'This page didn’t load' })).toBeVisible();
  });

  it('after a recurring chunk failure, the button loads the page again', () => {
    const reset = vi.fn();
    render(<ErrorPage error={chunkError()} reset={reset} />).unmount();
    render(<ErrorPage error={chunkError()} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();
  });

  it('recovers by itself again from a later deploy', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    render(<ErrorPage error={chunkError()} reset={vi.fn()} />).unmount();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 6 * 60 * 1000);
    render(<ErrorPage error={chunkError()} reset={vi.fn()} />);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it.each(['getItem', 'setItem'] as const)(
    'never reloads by itself when sessionStorage.%s throws',
    (method) => {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error('blocked');
      });
      render(<ErrorPage error={chunkError()} reset={vi.fn()} />);
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: 'This page didn’t load' })).toBeVisible();
    },
  );

  it('a garbled guard value counts as already tried', () => {
    window.sessionStorage.setItem('vm-chunk-reload-at', 'not-a-time');
    render(<ErrorPage error={chunkError()} reset={vi.fn()} />);
    expect(reload).not.toHaveBeenCalled();
  });

  it('global-error renders its own document, with no inline script for the CSP to block', () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error('boom')} reset={vi.fn()} />);
    expect(html).toMatch(/<html lang="en"[^>]*><(head>.*<\/head><)?body>/);
    expect(html).toContain('This page didn’t load');
    expect(html).not.toContain('<script');
  });
});

describe('isChunkLoadError', () => {
  it.each([
    ['webpack', chunkError()],
    [
      'Chromium import()',
      new TypeError('Failed to fetch dynamically imported module: https://x/a.js'),
    ],
    ['Firefox import()', new TypeError('error loading dynamically imported module')],
    ['Safari import()', new TypeError('Importing a module script failed.')],
    ['CSS chunk', new Error('Loading CSS chunk 12 failed')],
  ])('recognizes %s', (_, error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it.each([
    ['an ordinary error', new Error('Cannot read properties of undefined')],
    ['a failed API call', new TypeError('Failed to fetch')],
    ['something not an Error', 'Loading chunk 1 failed'],
  ])('does not mistake %s', (_, error) => {
    expect(isChunkLoadError(error)).toBe(false);
  });
});
