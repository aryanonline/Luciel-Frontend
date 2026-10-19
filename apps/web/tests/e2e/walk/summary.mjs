#!/usr/bin/env node
/**
 * Round 7 WP-12 — the walk's report, as Markdown (the live-walk workflow appends it to
 * the job summary). Reads Playwright's JSON report and prints, per test, the timing
 * annotations the walk records (time to the first grounded answer, each pillar's
 * completion time, the whole walk) and every step it skipped with the reason.
 *
 *   node apps/web/tests/e2e/walk/summary.mjs apps/web/walk-results.json
 *
 * Nothing secret is in the report: the walk never puts a credential in a title.
 */
import { readFileSync, existsSync } from 'node:fs';

const file = process.argv[2] ?? 'walk-results.json';
if (!existsSync(file)) {
  console.log(`### Customer walk\n\nNo report at \`${file}\` — the walk did not run.`);
  process.exit(0);
}
const report = JSON.parse(readFileSync(file, 'utf8'));

/** Every test in the report, with the suite path it sits in. */
function* tests(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) yield { spec, test };
  }
  for (const child of suite.suites ?? []) yield* tests(child);
}

const rows = [];
for (const suite of report.suites ?? []) rows.push(...tests(suite));

const lines = ['### Customer walk', ''];
if (rows.length === 0) lines.push('No walk test in the report.');
for (const { spec, test } of rows) {
  const results = test.results ?? [];
  const last = results[results.length - 1];
  // Annotations live on the test (and, in newer reporters, on each result).
  const annotations = [...(test.annotations ?? []), ...(last?.annotations ?? [])].filter(
    (a, i, all) => all.findIndex((b) => b.type === a.type && b.description === a.description) === i,
  );
  lines.push(
    `**${spec.title}** — ${test.projectName}: ${last?.status ?? test.status ?? 'unknown'}`,
  );
  lines.push('');
  // A timing ends in "<n> ms"; anything else (e.g. `recovered`) is a note.
  const isTiming = (a) => /: \d+ ms$/.test(String(a.description ?? ''));
  const timings = annotations.filter((a) => a.type !== 'skipped-step' && isTiming(a));
  const notes = annotations.filter((a) => a.type !== 'skipped-step' && !isTiming(a));
  if (notes.length) {
    for (const a of notes) lines.push(`- ${a.type}: ${a.description}`);
    lines.push('');
  }
  if (timings.length) {
    lines.push('| Timing | Measured |', '| --- | --- |');
    for (const a of timings) {
      const [label, value] = String(a.description ?? '').split(/: (?=[^:]*$)/);
      lines.push(`| ${a.type} — ${label} | ${value ?? ''} |`);
    }
    lines.push('');
  }
  const skipped = annotations.filter((a) => a.type === 'skipped-step');
  if (skipped.length) {
    lines.push(`Skipped steps (${skipped.length}):`, '');
    for (const a of skipped) lines.push(`- ${a.description}`);
    lines.push('');
  }
}
console.log(lines.join('\n'));
