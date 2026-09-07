# Dependency-audit allowlist

`pnpm audit --audit-level=high` blocks CI on any high/critical advisory with a fix
(2026-09-05 audit F076). Entries here are the ONLY waivers, each with why and an expiry;
the machine-readable list is `audit-allowlist.json`, read by `scripts/audit-gate.mjs` (pnpm's own ignore lists are not honoured from a workspace root on pnpm 9.7). Review at every expiry —
an expired entry is a failing build, not a silent pass. `scripts/allowlist-expiry.mjs`
(run by the monthly `dependency-review` workflow) warns 14 days before an expiry.

## Current waivers

None. The list is empty as of 2026-09-07.

## Retired waivers

The eight Next 14.2.x advisories below were waived on 2026-09-06 for one release cycle and
retired on 2026-09-07 by the Next 14 → 15 migration (round 6 WP-B: `next` 15.5.x, React 19,
`eslint-config-next` 15; no async request APIs, Server Actions or rewrites were in use, so the
migration was a dependency change verified by the full workspace suite, the Playwright walks
and the widget bundle gate). Kept as the record of what was accepted and why.

| Advisory | Package | Why it was waived | Fixed by |
|---|---|---|---|
| GHSA-36qx-fr4f-26g5 | next 14.2.x | Middleware/proxy bypass in Pages Router apps using i18n — App Router only, no i18n routing. | Next 15.5.16+ |
| GHSA-89xv-2m56-2m9x | next 14.2.x | SSRF in Server Actions on custom servers — Next's own server, no Server Actions. | Next 15.5.21+ |
| GHSA-8h8q-6873-q5fj | next 14.2.x | DoS with Server Components — behind login and the ALB/WAF rate limits for one cycle. | Next 15.5.16+ |
| GHSA-c4j6-fc7j-m34r | next 14.2.x | SSRF via WebSocket upgrades — none handled. | Next 15.5.16+ |
| GHSA-h25m-26qc-wcjf | next 14.2.x | DoS via insecure RSC request deserialization — same posture. | Next 15.0.8+ |
| GHSA-m99w-x7hq-7vfj | next 14.2.x | DoS in App Router Server Actions — no Server Actions. | Next 15.5.21+ |
| GHSA-p9j2-gv94-2wf4 | next 14.2.x | SSRF in rewrites via attacker-controlled hostnames — rewrites are static. | Next 15.5.21+ |
| GHSA-q4gf-8mx6-v5v3 | next 14.2.x | DoS with Server Components — same posture. | Next 15.5.15+ |

Transitive libraries with in-range fixes are NOT waived — they are pinned up through
`pnpm.overrides` (brace-expansion, browserslist, glob, js-yaml, nanoid, postcss, vite)
and the test runner was moved to vitest 3.2.6+ (GHSA-5xrq-8626-4rwp). Minor and patch
updates now arrive weekly through Dependabot and merge themselves once CI is green
(`.github/dependabot.yml`, `dependabot-auto-merge.yml`); a major is labelled for a person.
