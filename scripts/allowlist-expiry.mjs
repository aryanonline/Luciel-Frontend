#!/usr/bin/env node
/**
 * Report audit waivers that expire soon (round 6 WP-B).
 *
 * `scripts/audit-gate.mjs` fails CI the day a waiver in
 * `.security/audit-allowlist.json` expires; this is the earlier, quieter signal —
 * the monthly dependency review lists every waiver and exits non-zero when one
 * expires within `--within-days` (default 14), so the re-review happens before a
 * build is blocked rather than because one was.
 *
 *   node scripts/allowlist-expiry.mjs --within-days 14 [--markdown out.md]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const withinDays = Number(opt('--within-days', '14'));
const markdown = opt('--markdown', null);
const file = resolve(opt('--allowlist', '.security/audit-allowlist.json'));

const data = JSON.parse(readFileSync(file, 'utf8'));
const waivers = Array.isArray(data.waivers) ? data.waivers : [];
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

const rows = waivers.map((w) => {
  const expires = new Date(`${w.expires}T00:00:00Z`);
  const days = Number.isNaN(expires.getTime())
    ? -1
    : Math.round((expires.getTime() - today.getTime()) / 86_400_000);
  return { ghsa: w.ghsa ?? '?', pkg: w.package ?? '?', expires: w.expires ?? '(none)', days };
});
rows.sort((a, b) => a.days - b.days);

const lines = ['| advisory | package | expires | days left |', '|---|---|---|---|'];
for (const r of rows) {
  lines.push(
    `| ${r.ghsa} | ${r.pkg} | ${r.expires} | ${r.days}${r.days <= withinDays ? ' ⚠️' : ''} |`,
  );
}
if (rows.length === 0) lines.push('| (no waivers) | | | |');
const table = lines.join('\n');
console.log(table);
if (markdown) writeFileSync(markdown, `${table}\n`);

const soon = rows.filter((r) => r.days <= withinDays);
if (soon.length > 0) {
  console.error(
    `\n${soon.length} waiver(s) expire within ${withinDays} days or are malformed: ${soon.map((r) => r.ghsa).join(', ')}`,
  );
  process.exit(1);
}
console.log(`\nno waiver expires within ${withinDays} days`);
