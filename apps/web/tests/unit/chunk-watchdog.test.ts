import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRASH_COPY, CRASH_SCREEN_EVENT, RELOAD_KEY } from '@/lib/chunk-reload';
import { CHUNK_WATCHDOG_SCRIPT } from '@/lib/chunk-watchdog';

/** A tag in the page whose file failed, the way the browser reports it. */
function fail(tag: 'script' | 'link', url: string, rel?: string) {
  const node = document.createElement(tag);
  if (node instanceof HTMLScriptElement) node.src = url;
  if (node instanceof HTMLLinkElement) {
    node.rel = rel ?? 'stylesheet';
    node.href = url;
  }
  document.head.appendChild(node);
  node.dispatchEvent(new Event('error'));
}

const MAIN_APP = '/_next/static/chunks/main-app-2985950f.js';
const dialog = () => document.querySelector('dialog');

describe('the script behind a file that fails during a page load', () => {
  const originalLocation = window.location;
  // Bound once, before any spy exists: a test that installs twice spies on a method that is
  // already a spy, and vi.spyOn then hands back that same spy (Vitest 4), so binding the
  // current method inside install() would make the spy call itself.
  const realAddEventListener = window.addEventListener.bind(window);
  const reload = vi.fn();
  let added: [string, EventListenerOrEventListenerObject, unknown][];

  const install = () => {
    // Each run stands for its own page load, so its listeners go with it.
    vi.spyOn(window, 'addEventListener').mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean,
    ) => {
      added.push([type, listener, options]);
      realAddEventListener(type, listener, options);
    }) as typeof window.addEventListener);
    new Function(CHUNK_WATCHDOG_SCRIPT)();
  };

  beforeEach(() => {
    added = [];
    window.sessionStorage.clear();
    reload.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // A run that drew the copy puts it back every 250 ms until ErrorScreen takes the
    // page. Stand it down the way ErrorScreen does, before its listener goes: left
    // running, the interval outlived the file and fired after the environment was torn
    // down ("document is not defined"), failing a run whose tests had all passed.
    window.dispatchEvent(new Event(CRASH_SCREEN_EVENT));
    for (const [type, listener, options] of added) {
      window.removeEventListener(type, listener, options as boolean);
    }
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
    vi.useRealTimers();
    dialog()?.remove();
    document.head.innerHTML = '';
  });

  it('reloads once on the first failed file, and shows nothing', () => {
    install();
    fail('script', MAIN_APP);
    fail('script', '/_next/static/chunks/webpack-c838593c.js');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(RELOAD_KEY)).not.toBeNull();
    expect(dialog()).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('main-app'));
  });

  it('shows the crash copy and a working button when the reload did not help', () => {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    install();
    fail('script', MAIN_APP);
    expect(reload).not.toHaveBeenCalled();
    const box = dialog();
    expect(box).toHaveTextContent(CRASH_COPY.heading);
    expect(box).toHaveTextContent('Nothing was lost');
    expect(box).toHaveTextContent('info@vantagemind.ai');
    box?.querySelector('button')?.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the button works while React is holding clicks back at the document', () => {
    // What a root does while hydration waits on a missing chunk.
    const stop = (event: Event) => event.stopPropagation();
    document.addEventListener('click', stop, true);
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    install();
    fail('script', MAIN_APP);
    dialog()?.querySelector('button')?.click();
    document.removeEventListener('click', stop, true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each(['getItem', 'setItem'] as const)(
    'shows the copy instead of reloading when sessionStorage.%s throws',
    (method) => {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error('blocked');
      });
      install();
      fail('script', MAIN_APP);
      expect(reload).not.toHaveBeenCalled();
      expect(dialog()).toHaveTextContent(CRASH_COPY.heading);
    },
  );

  it('recovers by itself again once the guard window has passed', () => {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 6 * 60 * 1000));
    install();
    fail('script', MAIN_APP);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('counts a failed stylesheet, but no other tag or origin of file', () => {
    install();
    fail('link', '/_next/static/media/font.woff2', 'preload');
    fail('script', 'https://js.stripe.com/v3/');
    fail('link', 'https://hcaptcha.com/x.css');
    expect(reload).not.toHaveBeenCalled();
    fail('link', '/_next/static/css/app.css');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('catches a script that had already failed before it ran', () => {
    const entries = [
      { name: MAIN_APP, initiatorType: 'script', responseStatus: 200 },
      { name: '/_next/static/media/font.woff2', initiatorType: 'link', responseStatus: 404 },
      { name: 'https://js.stripe.com/v3/', initiatorType: 'script', responseStatus: 404 },
    ];
    const timing = vi
      .spyOn(performance, 'getEntriesByType')
      .mockReturnValue(entries as unknown as PerformanceEntryList);
    install();
    expect(reload).not.toHaveBeenCalled();

    entries.push({ name: MAIN_APP, initiatorType: 'script', responseStatus: 404 });
    timing.mockReturnValue(entries as unknown as PerformanceEntryList);
    install();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves failures after the load event to webpack and ErrorScreen', () => {
    install();
    window.dispatchEvent(new Event('load'));
    fail('script', MAIN_APP);
    expect(reload).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('does not treat a navigation away as a failure', () => {
    install();
    window.dispatchEvent(new Event('beforeunload'));
    fail('script', MAIN_APP);
    expect(reload).not.toHaveBeenCalled();
  });

  it('puts the copy back when React clears the document', () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    install();
    fail('script', MAIN_APP);
    expect(dialog()).not.toBeNull();
    dialog()?.remove();
    vi.advanceTimersByTime(300);
    expect(dialog()).toHaveTextContent(CRASH_COPY.heading);
  });

  it('stands down when ErrorScreen has the page', () => {
    vi.useFakeTimers();
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    install();
    fail('script', MAIN_APP);
    window.dispatchEvent(new Event(CRASH_SCREEN_EVENT));
    expect(dialog()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(dialog()).toBeNull();
  });

  it('holds nothing that could end its own script tag', () => {
    expect(CHUNK_WATCHDOG_SCRIPT).not.toMatch(/<\/script/i);
    expect(CHUNK_WATCHDOG_SCRIPT).not.toContain('<!--');
  });
});
