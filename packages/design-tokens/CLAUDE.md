# `packages/design-tokens` — Design Tokens Guide

## Purpose

`@luciel/design-tokens` is the shared design vocabulary for the dashboard and
widget. It provides TypeScript token values, CSS custom properties, and the
Tailwind preset so visual decisions stay consistent across independently built
artifacts.

## Key files

- `src/tokens.ts` — canonical token values for color, spacing, radius,
  typography, and motion.
- `src/tokens.css` — exported CSS custom properties for application roots.
- `src/tailwind-preset.ts` — Tailwind mapping to the same token system.
- `src/index.ts` — package exports and the CSS import convention.
- `tsconfig.json` — package TypeScript build configuration.

## Invariants owned here

- Keep the web app and widget on the same visual token system; do not introduce
  per-surface palettes when a shared token is appropriate.
- Tokens support accessible status communication, but components must still use
  text and icons rather than color alone.
- Motion tokens must remain compatible with reduced-motion behavior in consuming
  components.
- Preserve both TypeScript and CSS consumption paths. Web application roots load
  `@luciel/design-tokens/tokens.css`; the widget composes token values into its
  Shadow-DOM stylesheet.
- Make additions semantic and reusable. Do not encode a page-specific product
  state into the token layer.

## Tests and commands

```bash
pnpm --filter @luciel/design-tokens typecheck
pnpm --filter @luciel/design-tokens test
pnpm --filter @luciel/design-tokens build
```

This package currently has no standalone unit tests; its test command documents
that contrast behavior is covered by consuming app accessibility checks. Build
and typecheck are still required.

## Gotchas from this cycle

- Shadow DOM does not inherit the web app's Tailwind classes or global token CSS.
  The widget intentionally imports token values into `src/styles.ts`.
- Do not replace semantic token usage with hard-coded colors merely to match a
  screenshot; shared tokens keep dashboard and embeds visually coherent.
- When an interaction is unavailable, the component copy and icon decide the
  honest state; a color change alone must never communicate availability.
