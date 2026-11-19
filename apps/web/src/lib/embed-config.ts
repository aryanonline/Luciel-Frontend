/**
 * Where the embed snippet loads the widget from, and the optional local demo website.
 *
 * Both are public build-time values. Read with `||`, not `??`: a Docker build that
 * does not pass the build argument hands `next build` an empty string (see lib/api.ts),
 * and an empty script URL would ship a snippet that loads nothing.
 */
export const DEFAULT_WIDGET_SCRIPT_URL = 'https://embed.vantagemind.ai/v1/luciel.js';

/** The script URL the embed snippet points at (the production embed host by default). */
export function widgetScriptUrl(): string {
  return process.env.NEXT_PUBLIC_WIDGET_SCRIPT_URL || DEFAULT_WIDGET_SCRIPT_URL;
}

/** The one line an owner pastes into their website. */
export function snippetFor(embedKey: string): string {
  return `<script src="${widgetScriptUrl()}" data-key="${embedKey}"></script>`;
}

/**
 * A link to the demo website that the local Docker stack serves, carrying this
 * Luciel's public embed key. Null unless the build names a demo site
 * (NEXT_PUBLIC_DEMO_SITE_URL), which production builds never do.
 */
export function demoSiteUrlFor(embedKey: string): string | null {
  const base = process.env.NEXT_PUBLIC_DEMO_SITE_URL;
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  url.searchParams.set('key', embedKey);
  return url.toString();
}
