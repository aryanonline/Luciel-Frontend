/**
 * Bundle-separation gate (Space Instructions §1, §6.3): the widget bundle must
 * contain ZERO admin-API surface. A leak of admin-client code into the widget
 * is a RELEASE BLOCKER. This script greps the built bundle for admin-only
 * symbols and fails the build if any are present.
 *
 * It is a coarse but effective tripwire; it runs in `pnpm build` for the widget
 * and is wired into CI (see DEFINITION_OF_DONE.md).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const distDir = resolve(process.cwd(), 'dist');
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

for (const file of candidates) {
  const p = resolve(distDir, file);
  if (!existsSync(p)) continue;
  const content = readFileSync(p, 'utf8');
  for (const symbol of FORBIDDEN) {
    if (content.includes(symbol)) {
      console.error(`[check-bundle] FORBIDDEN admin symbol "${symbol}" found in ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('[check-bundle] Widget bundle contains admin-API surface — release blocker.');
  process.exit(1);
}
console.log('[check-bundle] OK — widget bundle contains no admin-API surface.');
