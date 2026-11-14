// Two things the workflows promise, read from the files themselves: a deploy does not
// report success before the web service has finished rolling, and the monthly review
// posts early enough for the steward, and both workflows that post to the month's issue
// find it by its exact title.
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

// Both workflows post to the month's "Dependency & CVE review" issue.
const POSTERS = [
  ['the monthly review', '.github/workflows/dependency-review.yml'],
  ['the weekly image rebuild', '.github/workflows/image-rebuild.yml'],
];

for (const [name, path] of POSTERS) {
  test(`${name} never reads the eventually consistent search index`, () => {
    // The commands, not the comment that explains why they are not used.
    const wf = read(path)
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
}

/** Run a workflow's own lookup line with a stand-in `gh` that serves these pages. */
function lookup(path, pages, title) {
  const line = read(path)
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

for (const [name, path] of POSTERS) {
  test(
    `${name}'s lookup finds the exact title across pages, skipping pull requests`,
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
      const hit = lookup(path, pages, title);
      assert.equal(hit.status, 0, hit.stderr);
      assert.equal(hit.stdout, '3');

      const miss = lookup(path, [[{ number: 1, title: 'Dependency & CVE review 2026-10' }]], title);
      assert.equal(miss.status, 0, miss.stderr);
      assert.equal(miss.stdout, '');
    },
  );
}

// 2026-11-02: the build job pushed :latest before the CVE gate ran, so a gate-refused
// image became the tag the web task definition runs. Only the commit tag is pushed
// before the gate; each deploy job promotes the gated image to :latest, and a failed
// promotion fails the job instead of rolling the previous image.
test('the build pushes only the commit tag; :latest moves after the gate', () => {
  const build = job(read('.github/workflows/deploy.yml'), 'build');
  const all = steps(build);
  const pushIdx = all.findIndex((s) => /docker push/.test(s));
  const gateIdx = all.findIndex((s) => /image-scan-gate\.mjs/.test(s));
  assert.ok(pushIdx !== -1 && gateIdx > pushIdx, 'the gate runs after the push');
  assert.doesNotMatch(all[pushIdx], /:latest/, 'the build must not push or tag :latest');
});

// 2026-11-14 (deploy 43562167704): newer Docker engines add a provenance attestation by
// default, so the push became an OCI image index that ECR's basic scan-on-push never
// scans, and the CVE gate failed closed on a scan that never appeared. Every image build
// must push a single image manifest.
for (const path of ['.github/workflows/deploy.yml', '.github/workflows/image-rebuild.yml']) {
  test(`${path} builds the web image without attestations, so ECR scans it`, () => {
    const builds = read(path)
      .split('\n')
      .filter((l) => /^\s*docker (buildx )?build\b/.test(l));
    assert.ok(builds.length > 0, 'no docker build line found');
    for (const line of builds) {
      assert.match(line, /--provenance=false/, line.trim());
      assert.match(line, /--sbom=false/, line.trim());
    }
  });
}

for (const name of ['deploy-dev', 'deploy-prod']) {
  test(`${name} promotes the gated image to :latest before it rolls, and fails if it cannot`, () => {
    const text = job(read('.github/workflows/deploy.yml'), name);
    const promote = text.indexOf('--image-tag latest');
    const roll = text.indexOf('aws ecs update-service');
    assert.ok(promote !== -1, 'promotes :latest');
    assert.ok(roll > promote, 'promotes before the roll');
    const before = text.slice(0, roll);
    assert.match(before, /set -euo pipefail/);
    assert.doesNotMatch(
      before.slice(before.lastIndexOf('put-image')),
      /\|\| true/,
      'a failed promotion must fail the job',
    );
  });
}

// 2026-11-14: the AWS account id was a literal in both AWS workflows of this public
// repository. It is the repository variable AWS_ACCOUNT_ID now, and a run without a
// 12-digit value stops with a readable error before the first AWS call, instead of
// failing inside the OIDC step on a role ARN with no account in it. The id is read
// only by that check step's env and the role ARNs: GitHub does not mask a variable,
// and a workflow- or job-level env value is repeated in every step's log header.
const AWS_WORKFLOWS = [
  ['.github/workflows/deploy.yml', 'guard'],
  ['.github/workflows/image-rebuild.yml', 'rebuild'],
];
const ACCOUNT_CHECK = /name: Refuse a run without the AWS account id/;

/** The names of a workflow's jobs (2-space keys under `jobs:`). */
function jobNames(workflow) {
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
  return [...jobs.matchAll(/^ {2}([A-Za-z0-9_-]+):$/gm)].map((m) => m[1]);
}

/** A step's `run: |` script, dedented. */
function runScript(step) {
  const lines = step.split('\n');
  const at = lines.findIndex((l) => /^ {8}run: \|$/.test(l));
  assert.notEqual(at, -1, 'no run block');
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() !== '' && !l.startsWith(' '.repeat(10))) break;
    body.push(l.slice(10));
  }
  return body.join('\n');
}

for (const [path] of AWS_WORKFLOWS) {
  test(`${path} takes the AWS account id from vars.AWS_ACCOUNT_ID, never a literal`, () => {
    const wf = read(path);
    assert.doesNotMatch(wf, /^( {2}| {6})ACCOUNT:/m, 'no workflow- or job-level ACCOUNT env');
    assert.doesNotMatch(wf, /env\.ACCOUNT/, 'the role ARNs read vars.AWS_ACCOUNT_ID directly');
    const roles = [...wf.matchAll(/role-to-assume: (.*)$/gm)].map((m) => m[1]);
    assert.ok(roles.length > 0, 'no role-to-assume');
    for (const role of roles) {
      assert.match(role, /^arn:aws:iam::\$\{\{ vars\.AWS_ACCOUNT_ID \}\}:role\//);
    }
    assert.doesNotMatch(wf, /ACCOUNT: '?\d/);
    assert.doesNotMatch(
      wf,
      /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:/,
      'a literal account id in an ARN',
    );
  });
}

test('deploy.yml checks the account id in guard, and every job that assumes an AWS role needs guard', () => {
  const wf = read('.github/workflows/deploy.yml');
  assert.ok(
    steps(job(wf, 'guard')).some((s) => ACCOUNT_CHECK.test(s)),
    'guard has no account check',
  );
  const awsJobs = jobNames(wf).filter((name) => /configure-aws-credentials/.test(job(wf, name)));
  assert.ok(awsJobs.length > 0, 'no job assumes an AWS role');
  for (const name of awsJobs) {
    assert.match(
      job(wf, name),
      /^ {4}needs: (guard|\[[^\]]*\bguard\b[^\]]*\])$/m,
      `${name} must need guard`,
    );
  }
});

test('image-rebuild.yml checks the account id before its first AWS step', () => {
  const all = steps(job(read('.github/workflows/image-rebuild.yml'), 'rebuild'));
  const check = all.findIndex((s) => ACCOUNT_CHECK.test(s));
  const firstAws = all.findIndex((s) => /aws-actions\/|\baws [a-z]/.test(s));
  assert.notEqual(check, -1, 'no account check step');
  assert.ok(firstAws !== -1 && check < firstAws, 'the check must run before any AWS step');
});

const hasBash = spawnSync('bash', ['-c', 'true'], { encoding: 'utf8' }).status === 0;

for (const [path, jobName] of AWS_WORKFLOWS) {
  test(
    `${path} refuses an unset or malformed AWS_ACCOUNT_ID with a readable error`,
    { skip: hasBash ? false : 'needs bash' },
    () => {
      const step = steps(job(read(path), jobName)).find((s) => ACCOUNT_CHECK.test(s));
      assert.ok(step, 'no account check step');
      const script = runScript(step);
      assert.doesNotMatch(script, /\$\{\{/, 'the check must run as written, with no expressions');
      assert.match(
        step,
        /^ {8}env:\n {10}ACCOUNT: \$\{\{ vars\.AWS_ACCOUNT_ID \}\}$/m,
        'the check step reads the variable through its own env',
      );
      const run = (ACCOUNT) =>
        spawnSync('bash', ['-c', `set -eo pipefail\n${script}`], {
          encoding: 'utf8',
          env: { ...process.env, ACCOUNT },
        });
      for (const bad of ['', '12345', '1234567890123', '12345678901a', ' 123456789012']) {
        const r = run(bad);
        assert.equal(r.status, 1, `accepted ${JSON.stringify(bad)}`);
        assert.match(r.stdout, /^::error::the repository variable AWS_ACCOUNT_ID /m);
      }
      const ok = run('000000000000');
      assert.equal(ok.status, 0, ok.stderr);
    },
  );
}
