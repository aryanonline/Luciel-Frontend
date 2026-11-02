import { CRASH_COPY, CRASH_SCREEN_EVENT, RELOAD_KEY, RELOAD_WINDOW_MS } from './chunk-reload';

/**
 * The script behind a file that fails DURING a page load. When one of the scripts
 * every page starts from (webpack-*, main-app-*, and what main-app waits on) fails,
 * nothing runs: no hydration, no error, no boundary, and the page stays on its
 * server-rendered "Loading…" for good. When any other chunk in the HTML fails, webpack
 * only notices when its 120 s timeout runs out, and if the failed file is one
 * global-error needs, the page goes blank.
 *
 * So it has to sit outside the bundle (instrumentation-client.ts loads from inside
 * main-app and would be lost with it): an inline script at the top of the root layout's
 * head, under the request's CSP nonce, ahead of the files it watches. On the first failed
 * file it applies reloadOnce's guard; if the guard refuses it shows the crash copy. It
 * stops listening at the window's load event: later chunks are webpack's, whose failure
 * reaches ErrorScreen straight away.
 *
 * Inline styles, with token fallbacks, because the stylesheet may be the file that failed,
 * or gone: when React gives up on the root it clears the document, overlay included, so
 * the overlay puts itself back. A file that hangs rather than fails is not caught.
 */
export const CHUNK_WATCHDOG_SCRIPT = `(function () {
  var KEY = ${JSON.stringify(RELOAD_KEY)};
  var WINDOW_MS = ${RELOAD_WINDOW_MS};
  var COPY = ${JSON.stringify(CRASH_COPY)};
  var settled = false;
  var box = null;
  var timer = null;

  function reloadOnce() {
    try {
      var previous = sessionStorage.getItem(KEY);
      if (previous !== null && !(Date.now() - Number(previous) >= WINDOW_MS)) return false;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (e) {
      return false;
    }
    location.reload();
    return true;
  }

  function el(tag, css, text) {
    var node = document.createElement(tag);
    node.style.cssText = css;
    if (text) node.textContent = text;
    return node;
  }

  function build() {
    var muted = 'margin:8px 0 0;font-size:var(--vm-font-size-2,1rem);color:var(--vm-text-muted,#5a6473)';
    box = el(
      'dialog',
      'position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;padding:24px;' +
        'box-sizing:border-box;display:flex;align-items:center;justify-content:center;' +
        'background:var(--vm-surface,#f7f8fa);color:var(--vm-text,#14181f);font-family:var(--vm-font-family,system-ui,sans-serif)',
    );
    box.setAttribute('aria-labelledby', 'vm-load-failed-heading');
    box.addEventListener('cancel', function (e) {
      e.preventDefault();
    });
    var card = el(
      'div',
      'width:100%;max-width:28rem;box-sizing:border-box;padding:24px;background:var(--vm-bg,#fff);' +
        'border:1px solid var(--vm-border,#e3e6eb);border-radius:var(--vm-radius-card,10px)',
    );
    card.setAttribute('role', 'alert');
    var heading = el('h1', 'margin:0;font-size:var(--vm-font-size-5,1.5rem);font-weight:600', COPY.heading);
    heading.id = 'vm-load-failed-heading';
    var button = el(
      'button',
      'margin-top:24px;padding:8px 16px;font:inherit;font-weight:500;color:#fff;background:var(--vm-accent,#2f5bea);' +
        'border:0;border-radius:var(--vm-radius-control,6px);cursor:pointer',
      COPY.button,
    );
    button.type = 'button';
    button.addEventListener('click', function () {
      location.reload();
    });
    card.appendChild(heading);
    card.appendChild(el('p', muted, COPY.happened));
    card.appendChild(el('p', muted, COPY.next));
    card.appendChild(button);
    box.appendChild(card);
  }

  function place() {
    if (document.readyState === 'loading') return;
    if (!box) build();
    if (!box.isConnected) {
      if (!document.documentElement) {
        var html = document.createElement('html');
        html.lang = 'en';
        document.appendChild(html);
      }
      if (!document.body) document.documentElement.appendChild(document.createElement('body'));
      document.body.appendChild(box);
    }
    if (!box.open) {
      // A modal dialog makes whatever is left of the page inert, without touching it.
      if (box.showModal) box.showModal();
      else box.setAttribute('open', '');
    }
  }

  function failedFile(target) {
    if (!target) return '';
    var url = target.tagName === 'SCRIPT' ? target.src : target.tagName === 'LINK' && target.rel === 'stylesheet' ? target.href : '';
    return url && url.indexOf('/_next/static/') !== -1 ? url : '';
  }

  function onError(event) {
    if (settled) return;
    var url = failedFile(event.target);
    if (!url) return;
    settled = true;
    console.error('Page error: a file of this page did not load: ' + url);
    if (reloadOnce()) return;
    place();
    timer = setInterval(place, 250);
  }

  window.addEventListener('error', onError, true);
  window.addEventListener('load', function () {
    window.removeEventListener('error', onError, true);
  });
  // A navigation away cancels files in flight; that is not a failure.
  window.addEventListener('beforeunload', function () {
    settled = true;
  });
  window.addEventListener(${JSON.stringify(CRASH_SCREEN_EVENT)}, function () {
    settled = true;
    if (timer !== null) clearInterval(timer);
    if (box) box.remove();
  });
})();`;
