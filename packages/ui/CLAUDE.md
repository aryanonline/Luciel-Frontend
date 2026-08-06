# `packages/ui` — Shared React UI Guide

## Purpose

`@luciel/ui` supplies accessible, token-backed React primitives used by the
Luciel dashboard and preview surfaces. It owns reusable interaction behavior,
not domain-specific API calls or screen-level state.

## Key files

- `src/index.ts` — package public exports.
- `src/Modal.tsx` and `src/Modal.test.tsx` — async confirmation behavior.
- `src/StatusChip.tsx` and `src/StatusChip.test.tsx` — textual, icon, and color
  status treatment.
- `src/Field.tsx` — accessible label, hint, and error wiring.
- `src/Button.tsx`, `src/Card.tsx`, `src/Layout.tsx`, and `src/Banner.tsx` — core
  composition primitives.
- `src/markdown.ts` and `src/markdown.test.ts` — safe assistant markdown and
  plain-text conversion.
- `src/test-setup.ts` and `vitest.config.ts` — component test setup.

## Invariants owned here

- `Modal` owns async confirmation state: disable both actions while pending,
  display the pending label, retain focus semantics, and keep the dialog open
  with an error banner when confirmation rejects.
- `StatusChip` communicates a state with text, icon, and visual treatment. It
  must distinguish `not_available` from owner-actionable `action_needed`.
- Field errors are associated with controls and announced accessibly.
- Shared primitives consume design tokens and retain visible focus and keyboard
  behavior; product code must not override those safeguards away.
- Assistant markdown is sanitized before DOM insertion. Use plain-text output
  for live announcements and never treat visitor input as HTML.

## Tests and commands

```bash
pnpm --filter @luciel/ui typecheck
pnpm --filter @luciel/ui test
pnpm --filter @luciel/ui build
```

Keep component regressions next to the component (`*.test.tsx` or `*.test.ts`).
Test rejected promises, disabled controls, status wording, and dangerous markdown
inputs when changing their corresponding primitive.

## Gotchas from this cycle

- Call sites must pass the promise-returning mutation to `Modal`; closing the
  modal optimistically bypasses its pending/error guarantees.
- A status that cannot be acted on must not borrow Action needed wording or
  warning treatment. Use the distinct Not available yet presentation.
- Do not render model or visitor text with raw `innerHTML`; the markdown helper
  is escape-first and intentionally limited.
- Keep long modal bodies scrollable while the title and action row remain
  reachable on small screens.
