import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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
