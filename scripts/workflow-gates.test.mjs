// Two things the workflows promise, read from the files themselves: a deploy does not
// report success before the web service has finished rolling, and the monthly review
// posts early enough for the steward and finds the month's issue by its exact title.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

/** The lines of one job under `jobs:` (2-space key, up to the next job). */
function job(workflow, name) {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `no job ${name}`);
  const end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l) && !l.startsWith('  #'));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** A job's steps, split at each 6-space list item. */
function steps(jobText) {
  return jobText.split(/^(?= {6}- )/m).slice(1);
}

for (const name of ['deploy-dev', 'deploy-prod']) {
  test(`${name} waits for the roll to finish, and a timeout fails the job`, () => {
    const all = steps(job(read('.github/workflows/deploy.yml'), name));
    const last = all.at(-1);
    // The wait is the job's last step, after the step that updates the service.
    assert.match(last, /name: Wait for the web service roll to finish/);
    assert.match(last, /aws ecs wait services-stable --cluster "\$CLUSTER" --services \$SERVICES/);
    assert.ok(all.slice(0, -1).some((s) => /aws ecs update-service/.test(s)));
    // Nothing may swallow the waiter's non-zero exit.
    assert.match(last, /set -euo pipefail/);
    assert.doesNotMatch(last, /continue-on-error/);
    assert.doesNotMatch(last, /services-stable[^\n]*(\|\||;)/);
    // It looks up the same environment's cluster the update rolled.
    assert.match(last, /contains\(@,'Luciel-\$\{ENVIRONMENT\}-Web'\)/);
  });
}

const review = () => read('.github/workflows/dependency-review.yml');

test('the monthly review fires at 02:00 on the 1st, like the backend', () => {
  assert.match(review(), /- cron: '0 2 1 \* \*'/);
});

test('the monthly review never reads the eventually consistent search index', () => {
  // The commands, not the comment that explains why they are not used.
  const wf = review()
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  assert.doesNotMatch(wf, /gh issue list/);
  assert.doesNotMatch(wf, /--search/);
  // gh refuses --slurp together with --jq.
  assert.doesNotMatch(wf, /--slurp[^\n]*--jq/);
  assert.match(
    wf,
    /gh api --paginate --slurp "repos\/\$REPO\/issues\?state=open&per_page=100" \| jq -r/,
  );
});

/** Run the workflow's own lookup line with a stand-in `gh` that serves these pages. */
function lookup(pages, title) {
  const line = review()
    .split('\n')
    .find((l) => l.trim().startsWith('existing=$(gh api'));
  assert.ok(line, 'no lookup line');
  const dir = mkdtempSync(join(tmpdir(), 'review-lookup-'));
  writeFileSync(join(dir, 'pages.json'), JSON.stringify(pages));
  const gh = join(dir, 'gh');
  writeFileSync(gh, `#!/usr/bin/env bash\ncat "$(dirname "$0")/pages.json"\n`);
  chmodSync(gh, 0o755);
  const script = `set -euo pipefail\n${line.trim()}\nprintf '%s' "$existing"`;
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir.replace(/\\/g, '/')}${delimiter}${process.env.PATH}`,
      REPO: 'o/r',
      title,
    },
  });
}

const hasTools = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0;

test(
  'the lookup finds the exact title across pages, skipping pull requests',
  { skip: hasTools ? false : 'needs bash and jq' },
  () => {
    const title = 'Dependency & CVE review 2026-11';
    const pages = [
      [
        { number: 1, title: `${title} (copy)` },
        { number: 2, title, pull_request: { url: 'x' } },
      ],
      [{ number: 3, title }],
    ];
    const hit = lookup(pages, title);
    assert.equal(hit.status, 0, hit.stderr);
    assert.equal(hit.stdout, '3');

    const miss = lookup([[{ number: 1, title: 'Dependency & CVE review 2026-10' }]], title);
    assert.equal(miss.status, 0, miss.stderr);
    assert.equal(miss.stdout, '');
  },
);
