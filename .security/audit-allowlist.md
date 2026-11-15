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

Round 7 (2026-11-01): both `tinypool` waivers retired two days before they expired, without the vitest major: a `pnpm.overrides` entry `"tinypool": "^2.2.0"` runs vitest 3.2.x on tinypool 2.2.0. The whole workspace suite stays green on it, and `scripts/audit-gate.mjs` reported both advisories as no longer reported. The override was dropped on 2026-11-14 by the vitest 4 migration (4.1.12): Vitest 4 runs its own worker pool, so nothing in the tree depends on tinypool any more. The same move cleared three moderate vitest advisories (GHSA-82fw-gwwq-j7x9 on `vitest` and `@vitest/mocker`, GHSA-qxg6-89mg-rqv8 on `@vitest/mocker`, fixed in 4.1.11 and 4.1.12).

Round 7 (2026-10-25): the nightly audit went red on 2026-10-24 for four advisories. Three had in-range fixes and were taken: `next` 15.5.27 → 15.5.28 (GHSA-2464-fhr4-w9xw, an unauthenticated RCE in the Image Optimization API with SVG input, and GHSA-p3m5-59mp-jv5r), `vite` 6.4.3 → 6.4.4+ (GHSA-587h-7wmj-h5pm, launch-editor). `zod` had no 3.x fix and was waived (retired 2026-11-14, below). The `braces` waiver was retired the same day: the advisory is no longer reported.

Round 7 (2026-10-11): the nightly audit went red on 2026-10-06 for four advisories. Three had in-range fixes and were taken, not waived: `next` 15.5.25 → 15.5.27 (two moderates), `sharp` 0.35.5 (GHSA-wq5f-xc86-pv6w) and `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q) by refreshing the lockfile. The two `tinypool` criticals have no fix inside vitest 3 and were waived (retired 2026-11-01, above).

Round 7 (2026-10-04): the nightly audit went red on 2026-09-30 for two `brace-expansion` advisories (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p). Those had fixes and were closed by raising the `pnpm.overrides` (1.x → ^1.1.20, 5.x → ^5.0.11), not waived.

## Overrides across a major

Most `pnpm.overrides` entries lift a transitive package to a fixed release inside the range its
consumers already accept (listed at the end of this file). One entry moves a package to its next
major, because the fix exists only there.

`"minimatch@>=10.0.0 <11.0.1": "^11.0.8"` (2026-11-15) clears the Dependabot alert for
GHSA-g3hv-75wg-m249 (moderate): with `optimizationLevel` 2 or higher, an attacker-supplied glob
can make minimatch's pattern preprocessing use excessive CPU and memory. The vulnerable range is
`>=7.0.0 <11.0.1`, and minimatch published no 10.x fix. The only copy in range was 10.2.6, which
`@typescript-eslint/typescript-estree` 8.71.1 requires as `^10.2.2`. It is lint tooling, reached
through eslint-config-next and `@typescript-eslint/parser`, and its latest stable release, 8.72.2,
still requires `^10.2.2`.

- Scope: pnpm applies a `name@range` override to each declared dependency whose range intersects
  the selector's range. Here that is only typescript-estree's `^10.2.2`. The `^3.1.2` and `^3.1.5`
  ranges of eslint, `@eslint/config-array`, `@eslint/eslintrc` and three eslint plugins do not
  intersect it, so their 3.1.5, which is outside the advisory, stays. `pnpm why -r minimatch`
  lists 11.0.8 (through typescript-estree only) and 3.1.5.
- What typescript-estree uses: one call, `minimatch(path, pattern, { dot: true })` in
  `dist/useProgramFromProjectService.js`, made only when `parserOptions.projectService` has an
  `allowDefaultProject` list. The web lint config sets neither, so lint loads minimatch (a
  top-level `require`) and never calls it. minimatch 11 removed `makeRe()`, `Minimatch#regexp`, the
  `AST` class, three internal methods and the `debug` and `maxExtglobRecursion` options.
  typescript-estree uses none of them, and the CommonJS build, the named `minimatch` export, its
  signature and `dot` are unchanged. typescript-estree also leaves `optimizationLevel` at its
  default of 1, so the vulnerable code was never reached here: the override clears the alert, not
  a reachable path.
- Why 11.0.8: every earlier 11.x is named in another advisory that the minimatch repository has
  published but the GitHub advisory database (which Dependabot and `pnpm audit` read) does not list
  yet: GHSA-cf2h-pxjq-68xw (quadratic compile time, a regression in 11.0.0, up to 11.0.6),
  GHSA-hqmv-qgp3-jx75 (pattern cache memory growth, 11.0.3 to 11.0.7) and GHSA-c859-jr93-m5j4
  (`escape()` output, 7.4.0 to 11.0.7, so 10.2.6 too). 11.0.8 (2026-11-11) is the first release
  with none. Its npm provenance shows it was built by the isaacs/minimatch release workflow from
  tag v11.0.8 (commit 35c928b). It adds one dependency, `@isaacs/nonrecursive-glob-match` 1.1.0,
  by the same author, with no dependencies or install scripts of its own.
- Checked on 2026-11-15: the audit gate, the script tests, both typechecks, the 726 unit tests,
  lint, format, the build, the widget bundle check and the Playwright and axe run pass, and
  `pnpm audit` reports nothing at any severity. Lint on a deliberately broken TypeScript file
  reports the same parse error with 10.2.6 and 11.0.8. Run directly, typescript-estree's
  `allowDefaultProject` check accepts and refuses the same files with both. Across 18,150 path,
  glob and platform combinations, the two versions differ only in three cases that the 11.0
  changelog lists as intended: a path ending in `/` against `?(x)` or `*(x)`,
  `**/a/b/c/**/d/**`, and a Windows pattern whose `..` climbs past its drive letter.
- Remove it once the lockfile's `@typescript-eslint/typescript-estree` requires `minimatch` 11.0.1
  or later (the 8.72.3 canary already requires `^11.0.1`). The selector then matches nothing:
  delete the entry, run `pnpm install`, then check that `pnpm why -r minimatch` shows no version
  from 7.0.0 to 11.0.0 and that `pnpm audit` lists no minimatch advisory (the audit gate blocks
  only high and critical, and this advisory is moderate). Until then, look at any new consumer of
  minimatch 10 that a lockfile change brings in: the override moves it to 11 too.

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
