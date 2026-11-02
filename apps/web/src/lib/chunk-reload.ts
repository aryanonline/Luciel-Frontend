/**
 * Recovery from a page whose code is gone. During a rolling deploy two web builds
 * serve behind the load balancer, so a page from the old build can ask for a chunk
 * the new build does not have (and the old build's task may already be draining).
 * The fix for the person looking at it is a fresh page load, which gets one build's
 * page and that build's chunks.
 */
const RELOAD_KEY = 'vm-chunk-reload-at';

/**
 * A second failure inside this window means reloading did not help, so the page
 * stops and shows its copy. It is a window, not a flag held for the tab's life, so a
 * dashboard tab left open still recovers by itself from next week's deploy.
 */
const RELOAD_WINDOW_MS = 5 * 60 * 1000;

const CHUNK_MESSAGE =
  /Loading (CSS )?chunk .* failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** A ChunkLoadError or a failed dynamic import: a load failure, not a page's bug. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_MESSAGE.test(error.message);
}

/**
 * Reload the page unless this tab already did so moments ago. True when a reload was
 * started. Without working sessionStorage nothing can remember the attempt, so there
 * is no automatic reload at all: an unguarded reload is how a page ends up looping.
 */
export function reloadOnce(): boolean {
  try {
    const previous = window.sessionStorage.getItem(RELOAD_KEY);
    if (previous !== null) {
      const elapsed = Date.now() - Number(previous);
      if (!(elapsed >= RELOAD_WINDOW_MS)) return false;
    }
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
