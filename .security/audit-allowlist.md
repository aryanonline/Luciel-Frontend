# Dependency-audit allowlist

`pnpm audit --audit-level=high` blocks CI on any high/critical advisory with a fix
(2026-09-05 audit F076). Entries here are the ONLY waivers, each with why and an expiry;
the machine-readable list is `audit-allowlist.json`, read by `scripts/audit-gate.mjs` (pnpm's own ignore lists are not honoured from a workspace root on pnpm 9.7). Review at every expiry —
an expired entry is a failing build, not a silent pass. `scripts/allowlist-expiry.mjs`
(run by the monthly `dependency-review` workflow with `--within-days 35`) lists the waivers
expiring within 35 days.

## Current waivers

None. The last one, GHSA-mrhx-c7xc-m3w5 (zod), was retired on 2026-11-14 by the zod 4
migration (see Retired waivers).

2026-11-15: the `brace-expansion` overrides were raised ahead of GHSA-6jwq-xf8q-xcwh (high: unbounded parsing and expansion work, a CPU denial of service). The brace-expansion repository published it on 2026-11-11, but the GitHub advisory database does not list it yet, so neither Dependabot nor `pnpm audit` reports it; once listed, it would fail the audit gate on every PR and on the daily run. It covers every version below 1.1.22 and from 4.0.0 below 5.0.13, which took in the tree's 1.1.21 (under minimatch 3.1.5) and 5.0.12 (under minimatch 11.0.8). `brace-expansion@1` → `^1.1.22`, `brace-expansion@2` → `^2.1.8` and `brace-expansion@>=3 <6` → `^5.0.13`: the lockfile moves 1.1.21 → 1.1.22 and 5.0.12 → 5.0.13, and no 2.x, 3.x or 4.x is in the tree. The `^5.0.13` floor also stops the override from lowering minimatch 11.0.8's own `^5.0.12`. The fixed releases (2026-11-11) have no npm provenance, like those before them, so their code was checked against the source: 1.1.22's `index.js` is identical to the repository at its gitHead, 5.0.13's `dist/commonjs` rebuilds byte for byte from `src/index.ts` at its gitHead with TypeScript 5.9.3, and neither has install scripts. Both add three work bounds (`maxDepth`, `maxRewrites`, `maxSteps`), past which the rest of a pattern comes back literally; ordinary patterns need a few hundred of the default 20 million steps. The `>=3 <6` entry would also move a later brace-expansion 3 or 4 consumer to 5 (4.x has no fix; 3.x has 3.0.10); none is in the tree.

Round 7 (2026-11-01): both `tinypool` waivers retired two days before they expired, without the vitest major: a `pnpm.overrides` entry `"tinypool": "^2.2.0"` runs vitest 3.2.x on tinypool 2.2.0. The whole workspace suite stays green on it, and `scripts/audit-gate.mjs` reported both advisories as no longer reported. The override was dropped on 2026-11-14 by the vitest 4 migration (4.1.12): Vitest 4 runs its own worker pool, so nothing in the tree depends on tinypool any more. The same move cleared three moderate vitest advisories (GHSA-82fw-gwwq-j7x9 on `vitest` and `@vitest/mocker`, GHSA-qxg6-89mg-rqv8 on `@vitest/mocker`, fixed in 4.1.11 and 4.1.12).

Round 7 (2026-10-25): the nightly audit went red on 2026-10-24 for four advisories. Three had in-range fixes and were taken: `next` 15.5.27 → 15.5.28 (GHSA-2464-fhr4-w9xw, an unauthenticated RCE in the Image Optimization API with SVG input, and GHSA-p3m5-59mp-jv5r), `vite` 6.4.3 → 6.4.4+ (GHSA-587h-7wmj-h5pm, launch-editor). `zod` had no 3.x fix and was waived (retired 2026-11-14, below). The `braces` waiver was retired the same day: the advisory is no longer reported.

Round 7 (2026-10-11): the nightly audit went red on 2026-10-06 for four advisories. Three had in-range fixes and were taken, not waived: `next` 15.5.25 → 15.5.27 (two moderates), `sharp` 0.35.5 (GHSA-wq5f-xc86-pv6w) and `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q) by refreshing the lockfile. The two `tinypool` criticals have no fix inside vitest 3 and were waived (retired 2026-11-01, above).

Round 7 (2026-10-04): the nightly audit went red on 2026-09-30 for two `brace-expansion` advisories (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p). Those had fixes and were closed by raising the `pnpm.overrides` (1.x → ^1.1.20, 5.x → ^5.0.11), not waived.

## Overrides across a major

Most `pnpm.overrides` entries lift a transitive package to a fixed release inside the range its
consumers already accept (listed at the end of this file). One entry moves a package to its next
major, because the fix exists only there.

`"@typescript-eslint/typescript-estree>minimatch@>=10.0.0 <11.0.1": "^11.0.8"` (2026-11-15)
clears the Dependabot alert for GHSA-g3hv-75wg-m249 (moderate): with `optimizationLevel` 2 or
higher, an attacker-supplied glob can make minimatch's pattern preprocessing use excessive CPU and
memory. The vulnerable range is `>=7.0.0 <11.0.1`, and minimatch published no 10.x fix. The only
copy in range was 10.2.6, which `@typescript-eslint/typescript-estree` 8.71.1 requires as
`^10.2.2`. It is lint tooling, reached through eslint-config-next and `@typescript-eslint/parser`,
and its latest stable release, 8.72.2, still requires `^10.2.2`.

- Scope: the key names its consumer and the vulnerable range. pnpm 9.7 applies an override
  without a parent (`minimatch@<range>`) to every package whose declared minimatch range
  intersects the selector, in dependencies, optional, dev and peer dependencies alike. The first
  version of this entry had no parent, so a later minimatch 10 consumer (glob 11 to 13,
  test-exclude 8, typedoc 0.28, and jest-config 30 and rimraf 6 through glob 13) would have moved
  to 11 without a word, and green minor and patch updates merge themselves. glob 13 handles only
  string, `**` and `RegExp` pattern parts, and minimatch 11 hands it a `Matcher`, so its wildcard
  walks would find nothing. A parent without a child range always applies, so it would keep
  forcing `^11.0.8` onto typescript-estree after typescript-estree moves on, and would pull a later
  minimatch 12 back down to 11. With both, a new minimatch 10 consumer keeps 10 and gets its own
  Dependabot alert, and the entry matches nothing once typescript-estree requires 11.0.1 or later.
  eslint and its plugins keep minimatch 3.1.5, which the advisory does not cover.
  `scripts/pnpm-overrides.test.mjs` fails if a minimatch override loses its parent or its child
  range or is missing from this file, and if typescript-estree resolves a minimatch the advisory
  names.
- Checked in scratch with `pnpm install --lockfile-only`, each run on its own clean metadata
  cache: with this key the lockfile is the same as with the generic key apart from the key itself,
  and with a probe package that adds glob 13.0.7 and the typescript-estree canary, the generic key
  moves glob to minimatch 11.0.8 while this key leaves it on 10.2.6. pnpm 9.7.0 can write an
  override-mutated manifest back into its shared metadata cache (it serialises the cached object
  after the read-package hook has changed it), so give override experiments their own
  `--config.cache-dir`.
- What typescript-estree uses: one call, `minimatch(path, pattern, { dot: true })` in
  `dist/useProgramFromProjectService.js`, made only when `parserOptions.projectService` has an
  `allowDefaultProject` list. The web lint is not typed: eslint-config-next's TypeScript block
  sets only `sourceType`, and the web config adds no `project` or `projectService`, so lint loads
  minimatch (a top-level `require`) and never calls it. A deliberately broken TypeScript file
  therefore shows only that the parser runs, not that minimatch works. minimatch 11 removed
  `makeRe()`, `Minimatch#regexp`, the `AST` class, three internal methods and the `debug` and
  `maxExtglobRecursion` options. typescript-estree uses none of them, and the CommonJS build, the
  named `minimatch` export, its signature and `dot` are unchanged. typescript-estree also leaves
  `optimizationLevel` at its default of 1, so the vulnerable code was never reached here: the
  override clears the alert, not a reachable path.
- Why 11.0.8: every earlier 11.x is named in another advisory that the minimatch repository has
  published but the GitHub advisory database (which Dependabot and `pnpm audit` read) does not list
  yet: GHSA-cf2h-pxjq-68xw (quadratic compile time, a regression in 11.0.0, up to 11.0.6),
  GHSA-hqmv-qgp3-jx75 (pattern cache memory growth, 11.0.3 to 11.0.7) and GHSA-c859-jr93-m5j4
  (`escape()` output, 7.4.0 to 11.0.7, so 10.2.6 too). 11.0.8 (2026-11-11) is the first release
  with none. npm trusted publishing released it, and its provenance shows the isaacs/minimatch
  release workflow building tag v11.0.8 (commit 35c928b).
- Against it:
  - 11.x is a rewrite and very new: nine releases from 2026-10-27 to 2026-11-11, and two of the
    three advisories above are regressions that 11.x introduced. Upstream CI at the v11.0.8 commit
    failed in its two Windows Node 26 jobs (6 of 50 cases in `test/escape-literal.js`); commit
    82b84b4 changed only that test after the release, and CI has been green since.
  - It adds `@isaacs/nonrecursive-glob-match` 1.1.0, which now does the matching, and which has no
    npm provenance: the maintainer's account published it, its manifest has no repository field,
    the package dates from 2026-10-26 and 1.1.0 from 2026-11-05. Its `src` is identical to tag
    v1.1.0 (commit 0ac7bea) of github.com/isaacs/nonrecursive-glob-match, its `dist/commonjs`,
    which minimatch loads, rebuilds byte for byte from that source with TypeScript 5.9.3 and the
    tag's compiler options, and it requires only its own files, with no dependencies or install
    scripts. 10.2.6 had no provenance either: one unattested package gives way to one attested and
    one unattested.
  - The web Dockerfile copies the build stage's whole `node_modules` into the runtime image, so
    minimatch 11.0.8 and the new package ship in the image, as 10.2.6 did, where nothing loads
    them.
  - The alternative is to wait: the first typescript-eslint stable release with upstream commit
    837401e92d (`^11.0.1`, already in the 8.72.3-alpha.8 canary) would resolve the same 11.0.8
    without an override.
- Matching: in a sample of 18,150 path, glob and platform combinations, 10.2.6 and 11.0.8 differ
  only in cases the 11.0 changelog lists as intended (a path ending in `/` against `?(x)` or
  `*(x)`, `**/a/b/c/**/d/**`, and a Windows pattern whose `..` climbs past its drive letter). The
  matcher was rewritten, though, and random inputs find more: `?` and `[!a]` now match one code
  point outside the Basic Multilingual Plane rather than one UTF-16 unit, a POSIX class followed by
  an escaped `!` (`[[:alpha:]]\![ab]`) threw in 10.2.6 and matches in 11.0.8, and
  `?(a)!(a)!(a)` now matches `aab`, as in Bash. None of these comes up with relative file paths
  and `allowDefaultProject`-style globs.
- Checked on 2026-11-15, on Node 24.16.0, with the scoped key and brace-expansion 5.0.13 and
  1.1.22 (see the 2026-11-15 note under Current waivers): `pnpm install --frozen-lockfile`, the
  audit gate, the 53 script tests, both typechecks, the 726 unit tests (api-client 166, ui 20,
  widget 41, web 499), lint, format, the build and the widget bundle check pass.
  `pnpm why -r minimatch` lists 11.0.8 (through typescript-estree only) and 3.1.5, and
  `pnpm audit` lists no advisory at any severity, which means none that the GitHub advisory
  database lists as of that day. Lint, and the lint step of `next build`, load minimatch 11.0.8,
  the new package and brace-expansion 5.0.13 through typescript-estree. To make typescript-estree
  call minimatch, the web config was run in scratch with `projectService.allowDefaultProject`
  over the 84 `src` files, the config files, test files and a pattern that matches nothing: its
  398 calls, on Windows relative paths and including a brace pattern, gave the same answers and
  the same ESLint output under 11.0.8 and under 10.2.6 forced in.
- The Playwright and axe run passed locally (38 passed and 3 flaky, which failed at the 30-second
  limit while the dev server compiled and passed on a retry), against an installed Chrome 157
  (`E2E_CHROMIUM_EXECUTABLE`), not the Chromium build CI installs. It cannot show anything
  about this change: a load trace over its 19 Node processes, the dev server's included, found
  no minimatch, brace-expansion or `@isaacs/nonrecursive-glob-match`, because `pnpm dev` does
  not lint. CI runs the a11y gate, and its build job runs lint and the build on Node 22, which
  this machine does not have: a green CI build is the Node 22 check. minimatch's own CI passed
  its Node 22 jobs on Linux and macOS at the v11.0.8 commit.
- Remove it once the lockfile's `@typescript-eslint/typescript-estree` requires `minimatch` 11.0.1
  or later. The entry then matches nothing. typescript-eslint comes in through
  eslint-config-next, so Dependabot's weekly updates do not move it; it moves when the lockfile is
  refreshed. Then delete the entry, run `pnpm install`, and check that `pnpm why -r minimatch`
  shows no version from 7.0.0 to 11.0.0, that `pnpm audit` lists no minimatch advisory (the audit
  gate blocks only high and critical, and this advisory is moderate) and that
  `pnpm test:scripts` passes.

## Retired waivers

| Advisory            | Package    | Why it was waived                                                                                                                                                                                                           | Waived                         | Fixed by                                                     |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| GHSA-mrhx-c7xc-m3w5 | zod <4.6.6 | Memory exhaustion validating oversized constrained collections, fixed only in zod 4.6.6. zod parsed Luciel's own backend responses and one owner-typed confirm-code form, so no attacker-sized collection reached a schema. | 2026-10-25, renewed 2026-11-13 | zod 4.6.7 and @hookform/resolvers 7.0.6 (retired 2026-11-14) |

The zod 4 migration kept zod 3's rules where zod 4 changed its own (ids, ISO instants, URLs and
the first-run messages; `packages/api-client/src/__tests__/schema-rules.test.ts` pins them), and
`scripts/audit-gate.mjs` passes with the waiver removed.

The eight Next 14.2.x advisories below were waived on 2026-09-06 for one release cycle and
retired on 2026-09-07 by the Next 14 → 15 migration (round 6 WP-B: `next` 15.5.x, React 19,
`eslint-config-next` 15; no async request APIs, Server Actions or rewrites were in use, so the
migration was a dependency change verified by the full workspace suite, the Playwright walks
and the widget bundle gate). Kept as the record of what was accepted and why.

| Advisory            | Package     | Why it was waived                                                                           | Fixed by      |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------- | ------------- |
| GHSA-36qx-fr4f-26g5 | next 14.2.x | Middleware/proxy bypass in Pages Router apps using i18n — App Router only, no i18n routing. | Next 15.5.16+ |
| GHSA-89xv-2m56-2m9x | next 14.2.x | SSRF in Server Actions on custom servers — Next's own server, no Server Actions.            | Next 15.5.21+ |
| GHSA-8h8q-6873-q5fj | next 14.2.x | DoS with Server Components — behind login and the ALB/WAF rate limits for one cycle.        | Next 15.5.16+ |
| GHSA-c4j6-fc7j-m34r | next 14.2.x | SSRF via WebSocket upgrades — none handled.                                                 | Next 15.5.16+ |
| GHSA-h25m-26qc-wcjf | next 14.2.x | DoS via insecure RSC request deserialization — same posture.                                | Next 15.0.8+  |
| GHSA-m99w-x7hq-7vfj | next 14.2.x | DoS in App Router Server Actions — no Server Actions.                                       | Next 15.5.21+ |
| GHSA-p9j2-gv94-2wf4 | next 14.2.x | SSRF in rewrites via attacker-controlled hostnames — rewrites are static.                   | Next 15.5.21+ |
| GHSA-q4gf-8mx6-v5v3 | next 14.2.x | DoS with Server Components — same posture.                                                  | Next 15.5.15+ |

Transitive libraries with in-range fixes are NOT waived — they are pinned up through
`pnpm.overrides` (brace-expansion, browserslist, glob, js-yaml, nanoid, postcss, vite;
minimatch crosses a major, see Overrides across a major)
and the test runner was moved to vitest 3.2.6+ (GHSA-5xrq-8626-4rwp). Minor and patch
updates now arrive weekly through Dependabot and merge themselves once CI is green
(`.github/dependabot.yml`, `dependabot-auto-merge.yml`); a major is labelled for a person.

Re-review 2026-11-13: GHSA-mrhx-c7xc-m3w5 (zod) renewed from 2026-11-24 to 2026-12-31. No 3.x release carries the fix; zod here still parses only Luciel's own backend responses and one short owner-typed form, so no attacker-sized collection reaches a schema. The exit is still the zod 4 migration (apps/web and packages/api-client), owed as its own change. That migration landed on 2026-11-14 and retired the waiver.
