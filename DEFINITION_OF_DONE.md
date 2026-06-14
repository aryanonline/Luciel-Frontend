# Definition of Done — Luciel Frontend PR checklist

These gates are **non-negotiable** (Space Instructions §3, §8). A PR that fails
any of them is rejected regardless of how the feature looks. Copy this checklist
into every PR description and check each item.

---

## 1. Source-of-truth fidelity

- [ ] **Cite the doc + section** for every product-behavior decision in the PR
      description (e.g. "renders empty `<div>` when paused — Arch §3.6.2").
      Decisions without a citation or a flagged assumption are not done.
- [ ] If the task's framing conflicted with the documents, the **weakest
      assumption was stated in sentence one** and the correct path proposed
      before building (Space Instructions §8).
- [ ] No product behavior invented that contradicts the documents. Where a
      document was genuinely silent, the **minimal honest choice** was made and
      **flagged** (not stalled on, not contradicting).
- [ ] The mock was **not** treated as a source of truth. If the mock and a
      document disagreed, the document won and the mock was fixed.

## 2. Accessibility — WCAG 2.1 AA (Arch §5.16)

- [ ] `@axe-core/playwright` reports **zero AA violations** on every new/changed
      surface (added an axe assertion in `tests/e2e`).
- [ ] Keyboard operable end-to-end; **visible focus ring** present and never
      removed; focus order logical; no focus trap (widget especially).
- [ ] Correct ARIA (prefer Radix defaults — do not override them away).
      Live-region announcements for async content (e.g. incoming widget messages).
- [ ] **44px** minimum touch target on interactive elements.
- [ ] Color is **never the only signal** — status uses color + icon + text label.
- [ ] `prefers-reduced-motion` respected everywhere (no autoplaying/unpausable
      motion; reduced-motion users get a static frame).

## 3. Security posture (Space Instructions §3)

- [ ] **No secret in any bundle** and **no secret in a `NEXT_PUBLIC_*` var**.
      (Only non-secret public values use that prefix.)
- [ ] **Session token handling:** carried via `httpOnly`/`Secure`/`SameSite`
      cookie or in-memory only — **never** `localStorage`/`sessionStorage`.
- [ ] **401 mid-session** is handled (route to login cleanly, no crash);
      password-reset → global-revocation path handled (Arch §3.7.1a).
- [ ] **Hard email-verification gate** respected — an `unverified` account hitting
      a gated route goes to the verify wall, never the dashboard.
- [ ] **CSP/HSTS intact:** changes did not weaken the strict CSP (no
      `unsafe-inline` scripts; `connect-src`/`frame-src` allowlisted; `object-src
    'none'`; `base-uri 'self'`; `frame-ancestors 'none'` on the dashboard).
- [ ] Client-side validation treated as **UX only**, never as a security control.

## 4. Plane separation (Space Instructions §1, §6.3)

- [ ] The **widget bundle contains zero admin-API surface** —
      `pnpm --filter @luciel/widget build` passes `check-bundle.mjs`.
- [ ] UI imports **only** `@luciel/api-client` (`createLucielClient`) — never an
      adapter or the mock directly (enforced by the `no-restricted-imports` lint
      rule in `apps/web/.eslintrc.json`).
- [ ] The widget imports **only** `@luciel/api-client/widget` (data-plane).

## 5. api-client boundary (Space Instructions §7)

- [ ] New endpoints are modeled in the **typed client interface** with Zod-derived
      types, and implemented in **both** adapters (mock + http).
- [ ] The **mock reproduces the states the UI must handle** (not just happy
      paths) for the new surface.
- [ ] Swapping `mock → http` still requires **zero component changes**.

## 6. Design system (Space Instructions §5)

- [ ] Uses the **locked tokens** from `@luciel/design-tokens` — no per-screen
      palettes, no hardcoded hex.
- [ ] One primary (accent) button per view max; restraint, generous whitespace.
- [ ] Empty states are calm: one line + one action.

## 7. Honesty / no over-claiming (Vision §5; Space Instructions §3.7)

- [ ] No UI implies capabilities the platform hasn't built (MFA, multi-user /
      team seats, model selection, custom-domain inbound email at launch).
- [ ] Product invariants honored: one account/one Luciel/one login; five pillars
      (no sixth "Connections" pillar); cognition band non-interactive; escalation
      signals fixed (who/how editable, never when); the three connection chips
      (Connected / Action needed / Reconnect needed).

## 8. Quality gate (Arch §5.15)

- [ ] `pnpm -r typecheck` passes (strict TypeScript).
- [ ] `pnpm -r test` passes (Vitest unit/component).
- [ ] `pnpm --filter @luciel/web lint` passes.
- [ ] Both builds pass: `@luciel/web build` and `@luciel/widget build`.

## 9. Visual self-review (before declaring done)

- [ ] No broken/wrapped text, no overflow, no truncation.
- [ ] AA contrast verified on the actual rendered output.
- [ ] Focus states visible; reduced-motion honored; layout not broken at mobile width.
