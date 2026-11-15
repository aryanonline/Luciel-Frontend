// The minimatch override crosses a major (10 -> 11) for GHSA-g3hv-75wg-m249, so two of its
// properties are pinned here, read from package.json, the lockfile and the allowlist doc
// (.security/audit-allowlist.md, "Overrides across a major"):
//
// - it names its consumer and the vulnerable range. pnpm applies an override without a
//   parent to every package whose declared range intersects the selector, so a generic
//   `minimatch@...` key would also move any future minimatch 10 consumer onto 11 without a
//   word (glob 13 finds nothing under minimatch 11). An override without a child range keeps
//   rewriting the consumer's declaration after it has moved on, down to 11 even if it
//   later asks for 12. With both, the entry matches nothing once the consumer requires
//   minimatch 11.0.1 or later, and can then be deleted.
// - typescript-estree never resolves a minimatch the advisory names, so the override is
//   not dropped while it is still needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

const CONSUMER = '@typescript-eslint/typescript-estree';
// GHSA-g3hv-75wg-m249: minimatch >=7.0.0 <11.0.1.
const ADVISORY = { from: '7.0.0', below: '11.0.1' };

/** pnpm 9.7's own split of an override key into parent and child selectors. */
function parseSelector(key) {
  const at = key.search(/[^ |@]>/);
  const [parent, child] = at === -1 ? [null, key] : [key.slice(0, at + 1), key.slice(at + 2)];
  const versionAt = child.indexOf('@', 1);
  return {
    parent,
    name: versionAt === -1 ? child : child.slice(0, versionAt),
    range: versionAt === -1 ? null : child.slice(versionAt + 1),
  };
}

/** Compare two exact versions (x.y.z, a prerelease sorts first). */
function compare(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split('-');
    return { nums: core.split('.').map(Number), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  return x.pre === null ? 1 : y.pre === null ? -1 : x.pre < y.pre ? -1 : 1;
}

/** Each snapshot entry of the lockfile: its key and its dependency lines. */
function snapshots(lockfile) {
  const body = lockfile.split('\nsnapshots:\n')[1];
  assert.ok(body, 'pnpm-lock.yaml has no snapshots section');
  return body
    .split(/\n(?= {2}\S)/)
    .map((block) => {
      const [head, ...lines] = block.split('\n');
      const deps = {};
      for (const line of lines) {
        const m = line.match(/^ {6}'?([^':]+)'?: (\S+)$/);
        if (m) deps[m[1]] = m[2];
      }
      return { key: head.trim().replace(/:$/, '').replace(/^'|'$/g, ''), deps };
    });
}

const overrides = () => JSON.parse(read('package.json')).pnpm?.overrides ?? {};
const minimatchKeys = () => Object.keys(overrides()).filter((k) => parseSelector(k).name === 'minimatch');

test('the selector parser reads pnpm keys the way pnpm 9.7 does', () => {
  assert.deepEqual(parseSelector('minimatch@>=10.0.0 <11.0.1'), {
    parent: null,
    name: 'minimatch',
    range: '>=10.0.0 <11.0.1',
  });
  assert.deepEqual(parseSelector(`${CONSUMER}>minimatch@>=10.0.0 <11.0.1`), {
    parent: CONSUMER,
    name: 'minimatch',
    range: '>=10.0.0 <11.0.1',
  });
  assert.deepEqual(parseSelector('brace-expansion@>=3 <6'), {
    parent: null,
    name: 'brace-expansion',
    range: '>=3 <6',
  });
});

test('a minimatch override names its consumer and the vulnerable range, and is documented', () => {
  const doc = read('.security/audit-allowlist.md');
  for (const key of minimatchKeys()) {
    const { parent, range } = parseSelector(key);
    assert.ok(
      parent,
      `"${key}" has no parent, so pnpm applies it to every minimatch consumer whose range intersects it; scope it as "<consumer>>minimatch@<range>"`,
    );
    assert.ok(
      range,
      `"${key}" has no child range, so it keeps rewriting ${parent}'s minimatch after that package moves past the advisory; add "@<vulnerable range>"`,
    );
    assert.ok(doc.includes(`\`"${key}"`), `"${key}" is not recorded in .security/audit-allowlist.md`);
  }
});

test('typescript-estree never resolves a minimatch that GHSA-g3hv-75wg-m249 names', () => {
  const entries = snapshots(read('pnpm-lock.yaml')).filter((s) => s.key.startsWith(`${CONSUMER}@`));
  if (minimatchKeys().some((k) => parseSelector(k).parent === CONSUMER)) {
    assert.ok(entries.length > 0, `the override names ${CONSUMER}, which the lockfile no longer has: delete the override`);
  }
  for (const { key, deps } of entries) {
    const version = deps.minimatch;
    if (!version) continue;
    const named = compare(version, ADVISORY.from) >= 0 && compare(version, ADVISORY.below) < 0;
    assert.ok(
      !named,
      `${key} resolves minimatch ${version}, which GHSA-g3hv-75wg-m249 names: keep the override until ${CONSUMER} requires minimatch 11.0.1 or later`,
    );
  }
});
