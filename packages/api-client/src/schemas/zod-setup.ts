import { z } from 'zod';

/**
 * zod's JIT is off (2026-11-14). The first classic `z.object()` zod 4 builds test-runs
 * `new Function("")` to learn whether it may compile a faster parser. The dashboard's
 * production CSP (apps/web/src/middleware.ts) has no 'unsafe-eval', so the browser blocked
 * that probe and reported a securitypolicyviolation on every page load; zod caught the error
 * and fell back to the parser it uses anyway when eval is unavailable. `jitless` skips the probe
 * and the compiled parser. zod/mini (the widget's schemas) never compiles one.
 *
 * zod reads the flag when it BUILDS a schema, not when it parses, so this module must run
 * before any schema module builds one: `common.ts` imports it first, every other classic
 * schema module imports `common.ts`, and `contact.ts`, which does not, imports it directly.
 * zod keeps the flag on globalThis, so it also holds for the form schemas apps/web builds:
 * each form page imports `@/lib/api`, which loads this package before the page's own schema
 * is built. The import is for its side effect only, so the package must never be marked
 * `sideEffects: false`: a bundler would drop it.
 */
z.config({ jitless: true });
