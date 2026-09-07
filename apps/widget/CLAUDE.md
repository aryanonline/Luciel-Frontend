# `apps/widget` — Embeddable Widget Guide

## Purpose

`apps/widget` creates the public Luciel customer-site embed as a Vite library.
It is a lightweight, Shadow-DOM widget loaded from the embed CDN, separate from
the owner dashboard's auth and admin API surface.

## Key files

- `src/index.ts` — self-initializing script that reads the host `data-key`.
- `src/mount.ts` — Shadow DOM mount, bootstrap, launcher, send loop, session id,
  AI disclosure, paused behavior, and accessibility behavior.
- `src/styles.ts` — isolated widget layout and responsive styling.
- `src/mount.test.ts` — DOM, disclosure, safety, positioning, and interaction
  regressions.
- `scripts/check-bundle.mjs` — release gate against admin-API bundle leakage.
- `vite.config.ts` — library entry, output, and compile-time public settings.
- `index.html` — local development harness.

## Invariants owned here

- Mount in a Shadow DOM and read the embed key at runtime from the script tag;
  never hardcode an embed key or put it in a build environment variable.
- Stay closed by default behind the launcher. The host is fixed bottom-right at
  z-index `2147483000`; the transcript uses a `60vh` maximum and is full-bleed
  below `480px`.
- Keep an AI-assistant disclosure visible while the panel is open and preserve
  the active session id for conversation continuity.
- Render paused state as no visible widget chrome, not a misleading offline or
  error panel.
- Use the data-plane-only `@luciel/api-client/widget` entrypoint. The built
  bundle must have zero admin client, admin endpoint, or admin helper surface;
  `check-bundle.mjs` enforces this.
- Human takeover replies are delivered by polling persisted replies. Never make
  a real-time or instant-delivery promise in widget copy or behavior.
- Render assistant markdown through the safe renderer and visitor input as text;
  retain keyboard, focus, live-region, and reduced-motion behavior.

## Tests and commands

```bash
pnpm --filter @luciel/widget typecheck
pnpm --filter @luciel/widget test
pnpm --filter @luciel/widget build
```

The build runs `scripts/check-bundle.mjs`. Keep focused regressions in
`src/mount.test.ts` whenever changing launch, disclosure, paused, session, or
message-rendering behavior.

## Gotchas from this cycle

- The widget must not be re-positionable by host-page CSS: apply fixed placement
  directly to the Shadow host rather than relying on a weaker `:host` rule.
- A `60vh` transcript must scroll internally; never let conversation growth alter
  the customer page layout.
- On narrow screens, use the full viewport open panel rather than a card wider
  than the phone.
- A failed bootstrap fails quietly on the host page. Do not turn it into a
  broken floating shell.
- Any bundle-separation failure is a release blocker, even if source-level
  imports appear correct.
