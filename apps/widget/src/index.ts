import { mountWidget } from './mount';

/**
 * Self-initializing entry (Customer Journey §5, Space Instructions §6.3).
 * The host page embeds exactly one line:
 *
 *   <script src="https://embed.vantagemind.ai/v1/luciel.js" data-key="vm_live_..."></script>
 *
 * On load this script finds its own tag, reads the embed key from data-key
 * (runtime injection — never hardcoded, §3.4), and mounts the widget into a
 * shadow DOM appended to <body>.
 */
function resolveOwnScript(): HTMLScriptElement | null {
  // document.currentScript works for classic script execution.
  if (document.currentScript instanceof HTMLScriptElement) return document.currentScript;
  // Fallback: the last script referencing luciel.js.
  const scripts = Array.from(document.querySelectorAll('script[src*="luciel.js"]'));
  return (scripts[scripts.length - 1] as HTMLScriptElement) ?? null;
}

function init(): void {
  const self = resolveOwnScript();
  const embedKey = self?.getAttribute('data-key') ?? '';
  if (!embedKey) {
    // eslint-disable-next-line no-console
    console.warn('[Luciel] Missing data-key on the embed script; widget not mounted.');
    return;
  }
  const host = document.body ?? document.documentElement;
  void mountWidget({ embedKey, host });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

// Also export for module consumers / tests.
export { mountWidget } from './mount';
