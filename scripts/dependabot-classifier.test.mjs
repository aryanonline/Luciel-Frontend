// The Dependabot auto-merge classifier, run exactly as the workflow runs it.
//
// `.github/workflows/dependabot-auto-merge.yml` embeds a small Python program that
// reads a pull-request title and prints the update kind: `minor` (merged when CI is
// green) or anything else (labelled `major-update`, left for a person). The program
// is extracted from the workflow file here, so the test and the workflow cannot drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
  join(here, '..', '.github', 'workflows', 'dependabot-auto-merge.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

function embeddedProgram() {
  const start = workflow.indexOf("<<'PY'\n");
  assert.notEqual(start, -1, 'the workflow no longer embeds the classifier heredoc');
  const body = workflow.slice(start + "<<'PY'\n".length);
  const end = body.search(/\n\s*PY\n/);
  assert.notEqual(end, -1, 'the classifier heredoc is not terminated');
  const lines = body.slice(0, end).split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}

function python() {
  for (const exe of ['python3', 'python']) {
    const probe = spawnSync(exe, ['-c', 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)']);
    if (probe.status === 0) return exe;
  }
  throw new Error('no Python 3 interpreter on PATH (the workflow runs this program with python3)');
}

const PROGRAM = embeddedProgram();
const PY = python();

function classify(title) {
  const run = spawnSync(PY, ['-c', PROGRAM, title], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

const CASES = [
  // The grouped upkeep PR.
  ['build(deps): bump the minor-and-patch group with 7 updates', 'minor'],
  // Ordinary single updates.
  ['build(deps): bump zod from 3.25.1 to 3.25.4', 'minor'],
  ['build(deps): bump zod from 3.25.1 to 3.26.0', 'minor'],
  ['build(deps-dev): bump eslint from 8.57.1 to 10.11.0', 'major'],
  ['build(deps): bump actions/checkout from 4 to 7', 'major'],
  // 0.x packages carry breaking changes in the second component.
  ['chore(deps-dev): Bump ruff from 0.16.8 to 0.16.9', 'minor'],
  ['chore(deps-dev): Bump ruff from 0.16.8 to 0.17.0', 'major'],
  // Requirement ranges.
  ['Update httpx requirement from <1.4,>=1.3.1 to >=1.3.1,<1.7', 'minor'],
  ['Update fastapi requirement from <0.139,>=0.138 to >=0.138,<0.142', 'major'],
  // The runtime image: a patch of the same line and variant is upkeep ...
  ['build(deps): bump node from 22.23.2-trixie-slim to 22.23.3-trixie-slim in /apps/web', 'minor'],
  ['chore(deps): Bump python from 3.12.14-slim to 3.12.15-slim', 'minor'],
  // ... a new minor, a new major, or a new distro is a person's call.
  ['build(deps): bump node from 22.23.2-trixie-slim to 22.24.0-trixie-slim in /apps/web', 'runtime'],
  ['build(deps): bump node from 22.23.2-trixie-slim to 24.1.0-trixie-slim in /apps/web', 'runtime'],
  ['build(deps): bump node from 22.23.2-bookworm-slim to 22.23.3-trixie-slim in /apps/web', 'runtime'],
  ['chore(deps): Bump python from 3.12-slim to 3.14-slim', 'runtime'],
  // A package that merely ends in "node" is not the runtime image.
  ['build(deps-dev): bump @types/node from 24.13.2 to 26.6.2', 'major'],
  // Anything unreadable is never merged.
  ['Something Dependabot never wrote', 'unknown'],
];

for (const [title, expected] of CASES) {
  test(`"${title}" is ${expected}`, () => {
    assert.equal(classify(title), expected);
  });
}

test('only "minor" is ever merged by the workflow', () => {
  // The merge branch is guarded by kind = minor; every other word falls to the label branch.
  assert.match(workflow, /if \[ "\$kind" = "minor" \]; then\n\s+# A refused merge/);
});
