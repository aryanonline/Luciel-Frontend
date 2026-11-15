import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// Let what React and TanStack Query queued before a test's unmount (a scheduled render,
// a batched query notification) run while the jsdom window still exists. Left queued,
// it runs whenever the event loop gets to it — after the file's environment has been
// torn down, for the last test in a file — and React's first read of `window` then
// throws, failing a run whose tests all passed. testing-library registers its cleanup
// (the unmount) when a test file imports it, after this file has run, and Vitest runs
// after-hooks last-registered first, so this runs after the unmount.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
});

// The App Router hooks read a router context that only Next itself provides, so
// a component using them throws under a bare render. Default them to an empty
// query on a no-op router; a test that cares about either re-mocks the module.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useParams: () => ({}),
}));

// jsdom does not implement matchMedia; components that respect
// prefers-reduced-motion call it. Provide a minimal stub (defaults to
// "no preference" so the animated path is exercised in tests).
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
