// Dependency-audit gate (2026-09-05 audit F076; allowlist added 2026-09-06).
//
// `pnpm audit --audit-level=high` blocks on ANY high/critical advisory, and pnpm 9.7's
// auditConfig ignore lists are not honoured from a workspace root — so the waiver
// discipline lives here, mirroring the backend's `scripts/check_image_scan.py`:
// every waiver in `.security/audit-allowlist.json` carries a reason and an expiry,
// an expired waiver FAILS the build, and anything not waived fails it too.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allowlist = JSON.parse(readFileSync(new URL('../.security/audit-allowlist.json', import.meta.url), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

let raw;
try {
  raw = execSync('pnpm audit --audit-level=high --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
} catch (err) {
  // pnpm exits non-zero when it found something; the JSON is still on stdout.
  raw = err.stdout?.toString() ?? '';
}
const report = raw.trim() ? JSON.parse(raw) : { advisories: {} };
const advisories = Object.values(report.advisories ?? {}).filter((a) => a.severity === 'high' || a.severity === 'critical');

const waivers = new Map(allowlist.waivers.map((w) => [w.ghsa, w]));
const expired = [];
const blocking = [];
const waived = [];
for (const a of advisories) {
  const w = waivers.get(a.github_advisory_id);
  if (!w) { blocking.push(a); continue; }
  if (w.expires < today) { expired.push({ a, w }); continue; }
  waived.push({ a, w });
}
for (const { a, w } of waived) console.log(`waived   ${a.github_advisory_id} ${a.module_name} (${a.severity}) until ${w.expires}: ${w.reason}`);
for (const { a, w } of expired) console.error(`EXPIRED  ${a.github_advisory_id} ${a.module_name} (${a.severity}) waiver ended ${w.expires}`);
for (const a of blocking) console.error(`BLOCKING ${a.github_advisory_id} ${a.module_name} (${a.severity}) patched ${a.patched_versions} — ${a.title}`);
for (const w of allowlist.waivers) {
  if (!advisories.some((a) => a.github_advisory_id === w.ghsa)) console.log(`stale    ${w.ghsa} no longer reported — remove the waiver`);
}
if (expired.length || blocking.length) {
  console.error(`\naudit gate: ${blocking.length} blocking, ${expired.length} expired waiver(s)`);
  process.exit(1);
}
console.log(`\naudit gate: clean (${waived.length} waived, all with an expiry)`);
