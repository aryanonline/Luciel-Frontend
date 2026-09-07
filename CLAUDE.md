# Luciel Frontend — Working Guide

## Purpose and authority

This repository is the Luciel customer-facing frontend monorepo. It contains:

- the Luciel dashboard web app and public marketing routes;
- the embeddable customer-site widget; and
- shared API, UI, and design-token packages.

Authoritative business and product documents live in the Luciel Perplexity project
files, updated **2026-08-06**. They are not maintained in this repository.
Treat served backend state and the current code contract as implementation evidence;
do not recreate, copy, or infer a business specification into repository docs.

When product language or behavior is uncertain, use the project files and the
served contract. Prefer the least-claiming state rather than a happy-path claim.
Do not use mock data as a business authority.

## Branch discipline

- Work only on `feat/docs-conformance-build-20260713-r2` unless the owner gives
  a different branch explicitly.
- `main` is stale. Never use it as a merge base, source of truth, or deploy cue.
- Check the current branch and working tree before changing files.
- Keep changes narrow, run the relevant workspace checks, then run the complete
  monorepo verification before handing off.
- Do not commit generated output (`.next/`, `dist/`, coverage, reports) or env
  files. Secrets and embed keys never belong in source or docs.

## Monorepo map

```text
apps/
  web/                 Next.js dashboard, auth, marketing, and embed-preview app
  widget/              Vite library-mode customer-site widget (Shadow DOM)
packages/
  api-client/          Typed control-plane and widget data-plane clients/adapters
  design-tokens/       Shared TypeScript, CSS, and Tailwind design tokens
  ui/                  Shared accessible React UI primitives and markdown helpers
```

See the module-level `CLAUDE.md` files for implementation-specific paths, tests, and gotchas.

## Product invariants owned by the frontend

### Honest connection and availability states

- A connection state is **Connected**, **Action needed**, **Reconnect needed**,
  or **Not available yet**. Never show a false Connected state.
- Consent alone does not make a channel live. If its destination still needs to
  be bound, the owner sees **Action needed**, not Connected.
- `Not available yet` is non-actionable. Do not relabel it as Action needed or
  offer an action that cannot work.
- Connection and provider labels come from the served `displayName` contract.
  Never expose raw provider enums/slugs as human-facing labels.
- The dashboard attention counter counts only rows whose computed chip is
  `action_needed`; do not include connected, reconnect-needed, or unavailable
  rows merely because their raw backend status looks concerning.
- Consent landing must read real channel state. When authorization succeeded but
  binding remains, say **“authorized — one step left”** rather than Connected.

### Mutations, loading, and collection states

- Every mutation visibly represents pending, success, and error outcomes.
  Do not silently close or reset an action after a failed write.
- `Modal` owns async confirmation: its pending label and disabled controls stay
  active while the promise settles; on failure it remains open and shows the
  error. Call sites pass an async mutation rather than closing it themselves.
- Every list or collection has distinct loading, empty, and error branches.
  An empty list cannot stand in for an unresolved or failed read.
- Preserve typed API errors and render a useful recovery path instead of
  downgrading a known failure to a generic success-like state.

### Evidence, conversations, and takeover

- Evidence attribution is three-state: `has_sources`,
  `no_sources_retrieved`, and `attribution_unavailable`. An empty source list
  is not enough to claim that retrieval found no sources.
- Legacy answers without scoring render **“Not scored (before scoring existed)”**;
  never manufacture a score or label them as ungrounded.
- Human takeover replies are persisted and arrive in the widget by polling.
  Never promise or describe that delivery as real-time, pushed, or instant.

### Widget contract

- The launcher is closed by default and mounts in a Shadow DOM.
- Its host is fixed bottom-right with z-index `2147483000`; the transcript panel
  is bounded to `60vh` and becomes full-bleed below `480px`.
- Keep the AI disclosure visible whenever the panel is open and retain session
  continuity during a conversation.
- The public widget bundle contains no admin-API surface, admin client, or
  admin routes. `apps/widget/scripts/check-bundle.mjs` is a release gate.
- A paused Luciel renders no visible widget chrome; it must not show a false
  offline/error experience.

## Implementation practices

- Use `@luciel/api-client` for dashboard server data and
  `@luciel/api-client/widget` for widget data. Do not cross those plane
  boundaries or import adapters directly into UI components.
- Keep API shape changes in schemas, interfaces, HTTP adapters, and mock
  adapters together. The mock must model failure and pending states needed by
  the UI; it is not authorization to invent a product claim.
- Use `@luciel/design-tokens` and `@luciel/ui` rather than local palettes or
  ad-hoc shared components. Status always pairs text with its visual treatment.
- Widget assistant markdown is sanitized before rendering; visitor text remains
  a text node. Preserve that split.
- Make accessibility concrete: keyboard operation, visible focus, semantic
  labels, live announcements where content arrives, and reduced motion support.

## Commands

Use the locked package manager and install from the repository root:

```bash
corepack prepare pnpm@9.7.0 --activate
pnpm install --frozen-lockfile
```

Run a single workspace while developing:

```bash
pnpm --filter @luciel/web typecheck
pnpm --filter @luciel/web test
pnpm --filter @luciel/web build
pnpm --filter @luciel/widget typecheck
pnpm --filter @luciel/widget test
pnpm --filter @luciel/widget build
pnpm --filter @luciel/api-client typecheck
pnpm --filter @luciel/api-client test
pnpm --filter @luciel/api-client build
pnpm --filter @luciel/design-tokens typecheck
pnpm --filter @luciel/design-tokens test
pnpm --filter @luciel/design-tokens build
pnpm --filter @luciel/ui typecheck
pnpm --filter @luciel/ui test
pnpm --filter @luciel/ui build
```

Required whole-workspace verification:

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

The current suite is approximately 300 tests (api-client 27, ui 17, widget 28, web ~227).
Treat an unexpected test-count change as a signal to review, not as a substitute for
the command exit status. `pnpm --filter @luciel/web test:e2e` runs the Playwright
a11y gate plus the mock-adapter customer journey (`tests/e2e/journey.spec.ts`) against
the dev server; the dashboard pages need the planted session cookie from
`tests/e2e/mock-session.ts` or the middleware bounces them to /login. `E2E_LIVE=1`
with `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD` selects the read-only live-smoke
project instead (the `live-smoke` workflow is its dispatch-only home).

The web app runs on Next 15 / React 19 (migrated 2026-09-07). The strict CSP admits
`'unsafe-eval'` for development builds only, because `next dev` cannot hydrate without
it; production policy is unchanged. Dependencies are kept current by Dependabot on the
release branch with auto-merge of green minor/patch updates; a major bump is labelled
`major-update` for a person, and the `dependency-review` workflow files a monthly issue.

## Verification lesson from this cycle

When validating cloud-browser artifacts, match the copied confirmation by the
substring **“Copied”** rather than assuming exact surrounding UI text. If an
interaction appears to fail in a cloud browser, confirm it in plain Chromium
before changing production code; avoid fixing a browser-artifact mismatch as if
it were an application defect.

## Deploy

The deployment workflow builds the web artifact and publishes the widget to the
embed CDN. To dispatch a development deployment from this branch, use:

```bash
gh workflow run deploy.yml --ref feat/docs-conformance-build-20260713-r2 -f environment=dev
```

Always pass `--ref`: the workflow's `guard` job refuses any other ref (2026-09-06: a
bare dispatch shipped stale `main`'s widget to dev), there is no push trigger, and a
prod dispatch no longer rolls dev first.

Do not imply that publishing the dashboard alone updates embeds: the widget
bundle is deployed to the embed CDN as part of the workflow. Use the workflow's
explicit environment input; do not treat a push to stale `main` as the operating
path.

## Documentation hygiene

`CLAUDE.md` files are operational codebase guidance, not a replacement for the
Perplexity project business documents. Keep root guidance cross-cutting and
module guidance local. Before removing or renaming a doc, search scripts, tests,
and workflows for filename reads or references; update those references in the
same change.
