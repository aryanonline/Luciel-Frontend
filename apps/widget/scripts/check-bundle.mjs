/**
 * Bundle-separation gate (Space Instructions §1, §6.3): the widget bundle must
 * contain ZERO admin-API surface. A leak of admin-client code into the widget
 * is a RELEASE BLOCKER. This script greps the built bundle for admin-only
 * symbols and fails the build if any are present.
 *
 * It is a coarse but effective tripwire; it runs in `pnpm build` for the widget
 * and is run by the widget build and CI.
 *
 * dist is resolved from this file, not the working directory, so the check reads the
 * same bundle whether it runs inside apps/widget (the build script) or from the repo
 * root (CI). It fails closed: the build emits both bundles (vite.config.ts) and the
 * deploy copies both by name, so a missing or renamed bundle is a failure, never an OK.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const candidates = ['luciel.js', 'luciel.mjs'];

// Symbols that should NEVER appear in the widget bundle.
const FORBIDDEN = [
  'createLucielClient', // admin client factory
  'createHttpAdminClient',
  'createMockAdminClient',
  '/api/v1/admin', // admin API paths
  '/api/v1/billing',
  '/api/v1/dashboard',
  'chipForConnection', // admin-only helper
];

let failed = false;
const checked = [];
const missing = [];

for (const file of candidates) {
  const p = resolve(distDir, file);
  if (!existsSync(p)) {
    missing.push(file);
    continue;
  }
  checked.push(file);
  const content = readFileSync(p, 'utf8');
  for (const symbol of FORBIDDEN) {
    if (content.includes(symbol)) {
      console.error(`[check-bundle] FORBIDDEN admin symbol "${symbol}" found in ${file}`);
      failed = true;
    }
  }
}

if (missing.length > 0) {
  console.error(
    `[check-bundle] Missing ${missing.join(' and ')} in ${distDir} (expected ${candidates.join(' and ')}). ` +
      'Build the widget first (pnpm --filter @luciel/widget build).',
  );
  process.exit(1);
}

if (failed) {
  console.error('[check-bundle] Widget bundle contains admin-API surface — release blocker.');
  process.exit(1);
}
console.log(
  `[check-bundle] OK — checked ${checked.join(', ')} in ${distDir}: no admin-API surface.`,
);
