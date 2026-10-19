// The workflows that touch a DEPLOYED environment (round 6 WP-J live-smoke, round 7
// WP-12 live-walk) stay dispatch-only, and the walk's report summary renders what the
// walk records. Read from the files themselves, so a later edit cannot quietly add a
// schedule or a push trigger to a workflow that writes to a live tenant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

/** The top-level keys under `on:` (the workflow's triggers). */
function triggers(workflow) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.notEqual(start, -1, 'no block-style `on:` key');
  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // the next top-level key
    const m = line.match(/^ {2}([a-z_]+):/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

for (const file of ['live-smoke.yml', 'live-walk.yml']) {
  test(`${file} runs only when a person dispatches it`, () => {
    assert.deepEqual(triggers(read(`.github/workflows/${file}`)), ['workflow_dispatch']);
  });
}

test('live-walk runs the walk spec as the live-walk project, with the walk account from secrets', () => {
  const wf = read('.github/workflows/live-walk.yml');
  assert.match(wf, /playwright test --project=live-walk\b/);
  assert.match(wf, /E2E_LIVE: '1'/);
  assert.match(wf, /E2E_LIVE_WRITE: '1'/);
  assert.match(wf, /E2E_EMAIL: \$\{\{ secrets\.E2E_LIVE_EMAIL \}\}/);
  assert.match(wf, /E2E_PASSWORD: \$\{\{ secrets\.E2E_LIVE_PASSWORD \}\}/);
  // Credentials are never printed: no step echoes or cats the credential variables.
  assert.doesNotMatch(wf, /(echo|printf|cat)[^\n]*\$\{?E2E_(EMAIL|PASSWORD)/);
  // The dispatcher has to say, in words, that this walk writes to the walk tenant.
  assert.match(wf, /"\$CONFIRM" != "walk-account-only"/);
  // Inputs reach the shell through env, never interpolated into a script.
  const inputUses = wf.split('\n').filter((l) => l.includes('${{ inputs.'));
  assert.ok(inputUses.length > 0);
  for (const line of inputUses) {
    assert.match(line, /^\s+[A-Z0-9_]+: \$\{\{ inputs\.[a-z_]+ \}\}$/);
  }
});

test('the read-only live-smoke never turns on the writing walk', () => {
  assert.doesNotMatch(read('.github/workflows/live-smoke.yml'), /E2E_LIVE_WRITE/);
});

test('the walk summary renders timings, notes and skipped steps from the JSON report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walk-summary-'));
  const file = join(dir, 'walk-results.json');
  const annotations = [
    { type: 'pillar-time', description: 'Sign in: 4100 ms' },
    { type: 'recovered', description: 'an earlier walk left the Luciel paused — resumed it' },
    {
      type: 'time-to-first-grounded-answer',
      description: 'sign-in → knowledge in place → first grounded answer (Test it here): 61000 ms',
    },
    { type: 'skipped-step', description: 'Billing — needs an owner asset: a real card' },
  ];
  writeFileSync(
    file,
    JSON.stringify({
      suites: [
        {
          specs: [],
          suites: [
            {
              specs: [
                {
                  title: 'a customer walks the whole dashboard',
                  tests: [
                    { projectName: 'live-walk', annotations, results: [{ status: 'passed' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  const run = spawnSync(
    process.execPath,
    [join(root, 'apps/web/tests/e2e/walk/summary.mjs'), file],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const out = run.stdout;
  assert.match(out, /\*\*a customer walks the whole dashboard\*\* — live-walk: passed/);
  assert.match(out, /\| pillar-time — Sign in \| 4100 ms \|/);
  assert.match(
    out,
    /\| time-to-first-grounded-answer — sign-in → knowledge in place → first grounded answer \(Test it here\) \| 61000 ms \|/,
  );
  assert.match(out, /- recovered: an earlier walk left the Luciel paused — resumed it/);
  assert.match(out, /Skipped steps \(1\):\n\n- Billing — needs an owner asset: a real card/);
});

test('the walk summary says so when the walk never ran', () => {
  const run = spawnSync(
    process.execPath,
    [join(root, 'apps/web/tests/e2e/walk/summary.mjs'), join(tmpdir(), 'no-such-report.json')],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0);
  assert.match(run.stdout, /the walk did not run/);
});
