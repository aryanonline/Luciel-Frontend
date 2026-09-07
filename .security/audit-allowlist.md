# Dependency-audit allowlist

`pnpm audit --audit-level=high` blocks CI on any high/critical advisory with a fix
(2026-09-05 audit F076). Entries here are the ONLY waivers, each with why and an expiry;
the machine-readable list is `audit-allowlist.json`, read by `scripts/audit-gate.mjs` (pnpm's own ignore lists are not honoured from a workspace root on pnpm 9.7). Review at every expiry —
an expired entry is a failing build, not a silent pass.

| Advisory | Package | Why it is waived | Real fix | Expires |
|---|---|---|---|---|
| GHSA-36qx-fr4f-26g5 | next 14.2.x | Middleware/proxy bypass in Pages Router apps using i18n — this app is App Router only, no i18n routing. | Next 15.5.16+ | 2026-10-06 |
| GHSA-89xv-2m56-2m9x | next 14.2.x | SSRF in Server Actions on custom servers — this app runs Next's own server and uses no Server Actions (all writes go through the typed API client). | Next 15.5.21+ | 2026-10-06 |
| GHSA-8h8q-6873-q5fj | next 14.2.x | DoS with Server Components — the dashboard is behind login and the ALB/WAF rate limits; accepted for one release cycle. | Next 15.5.16+ | 2026-10-06 |
| GHSA-c4j6-fc7j-m34r | next 14.2.x | SSRF via WebSocket upgrades — no WebSocket upgrade handling in this app. | Next 15.5.16+ | 2026-10-06 |
| GHSA-h25m-26qc-wcjf | next 14.2.x | DoS via insecure RSC request deserialization — same posture as above; accepted for one cycle. | Next 15.0.8+ | 2026-10-06 |
| GHSA-m99w-x7hq-7vfj | next 14.2.x | DoS in App Router Server Actions — no Server Actions in this app. | Next 15.5.21+ | 2026-10-06 |
| GHSA-p9j2-gv94-2wf4 | next 14.2.x | SSRF in rewrites via attacker-controlled destination hostnames — the only rewrites are static and hostname-free (`next.config`). | Next 15.5.21+ | 2026-10-06 |
| GHSA-q4gf-8mx6-v5v3 | next 14.2.x | DoS with Server Components — same posture as above. | Next 15.5.15+ | 2026-10-06 |

All eight are fixed by the Next 14 → 15 migration (React 19, async request APIs,
`eslint-config-next` 15). That is a planned change, not a patch, and is tracked in the
2026-09-06 audit report under "What to do next".

Transitive libraries with in-range fixes are NOT waived — they are pinned up through
`pnpm.overrides` (brace-expansion, browserslist, glob, js-yaml, nanoid, postcss, vite)
and the test runner was moved to vitest 3.2.6+ (GHSA-5xrq-8626-4rwp).
