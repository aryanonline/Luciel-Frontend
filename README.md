# Luciel Frontend

The customer-facing frontend for **VantageMind** (product name: **Luciel**) — an
AI-employee platform a business owner assembles from a clean dropdown UI.

> **Source of truth.** The four business documents in the Luciel Frontend space
> are the product contract, in precedence order on any conflict:
> **Vision > Architecture > Customer Journey > Legal**. This repository's code is
> downstream of them. The mock API is **never** a source of truth — it is a
> temporary, discardable implementation of the documented contract.

---

## The three artifacts

The frontend is **three independently-built artifacts** that share a design
system but **never share an auth context** (Space Instructions §1; Arch §1.3).
This separation is a security property, not a preference.

| Artifact                                        | Plane                    | Auth subject | Public?                   | Ships auth-aware code?               |
| ----------------------------------------------- | ------------------------ | ------------ | ------------------------- | ------------------------------------ |
| **Marketing site** (`apps/web` → `(marketing)`) | Control Plane (pre-auth) | none         | Yes (SEO)                 | No                                   |
| **Admin dashboard** (`apps/web` → `(app)`)      | Control Plane            | Admin JWT    | No (gated)                | Yes                                  |
| **Embeddable widget** (`apps/widget`)           | **Data Plane**           | embed key    | Yes (on customers' sites) | Widget client only — **never** admin |

**Hard rule:** the widget bundle must contain **zero** admin-API surface, zero
admin tokens, and zero secrets. A leak of admin-client code into the widget
bundle is a **release blocker** — enforced by `apps/widget/scripts/check-bundle.mjs`,
which fails the widget build if any admin symbol appears.

---

## Repository structure (pnpm monorepo)

```
apps/
  web/                     Next.js App Router — marketing (marketing) + dashboard (app)
    src/app/(marketing)/   SSG landing, pricing, honesty section — pre-auth, no admin code
    src/app/(app)/         Gated dashboard shell, auth stubs
    src/middleware.ts      Per-request strict CSP (nonce-based) + plane notes
    src/lib/api.ts         The ONE place the adapter flag is read → exports `api`
  widget/                  Vite library-mode embeddable (shadow DOM, framework-light)
    src/index.ts           Self-initializing entry; reads data-key at runtime
    src/mount.ts           Shadow-DOM mount, AI-identity disclosure, powered-by, paused→empty div
    scripts/check-bundle.mjs   Bundle-separation gate (zero admin surface)
packages/
  design-tokens/           THE locked tokens (§5): CSS vars + TS + Tailwind preset
  api-client/              THE typed client — one interface, two adapters (mock | http)
    src/schemas/           Zod schemas → types (the single shape definition)
    src/client.ts          Admin (control-plane) interface — all UI codes against this
    src/widget-client.ts   Widget (data-plane) interface — no admin surface
    src/index.ts           Control-plane entrypoint
    src/widget.ts          Data-plane entrypoint (widget imports ONLY this)
  ui/                      Shared Radix + Tailwind primitives (token-backed)
```

### Locked stack (Space Instructions §2 — do not relitigate)

- **Next.js App Router + TypeScript** (marketing + dashboard). Route groups give
  the two planes separate layouts/middleware/bundle boundaries in one repo.
- **Widget is NOT Next.js** — Vite library-mode → a single self-initializing
  bundle for `embed.vantagemind.com/v1/luciel.js`, mounted into a shadow DOM,
  framework-light (does not assume React on the host page).
- **Tailwind + CSS-variable tokens** · **Radix UI** (accessible primitives) ·
  **TanStack Query** (server state) · **React Hook Form + Zod** (forms; Zod
  schemas double as the api-client types) · **Vitest + RTL** (unit) ·
  **Playwright + @axe-core/playwright** (E2E + a11y).

---

## The api-client boundary (Space Instructions §7)

`@luciel/api-client` is the **only** thing UI imports for server data. No
component, page, or hook imports an adapter or the mock directly.

- **One interface, two adapters, one flag.** `createLucielClient({ adapter })`
  returns the `mockAdapter` (in-memory, deterministic, models real states) or the
  `httpAdapter` (real `fetch`). Selected by the single env flag
  `NEXT_PUBLIC_API_ADAPTER` (`mock` | `http`). Swapping `mock → http` requires
  **zero component changes** — guarded by `packages/api-client` tests.
- **The mock models the states the UI must handle**, not just happy paths:
  verified/unverified, healthy/expired connections, free-cap vs PAYG,
  paused/grace, at-cap, and 401 mid-session (via mock scenarios).

### Token handling (Space Instructions §3.3)

The session JWT is **never** read by JS: it is carried by an `httpOnly`, `Secure`,
`SameSite` cookie (the transport uses `credentials: 'include'`), or held in memory
only. It is **never** placed in `localStorage`/`sessionStorage`, and **never** in a
`NEXT_PUBLIC_*` env var. A 401 maps to a typed `unauthorized` error so the app can
route to login cleanly on a mid-session expiry.

---

## Run / build / test

Requires **Node ≥ 20** and **pnpm ≥ 9** (`corepack enable`).

```bash
pnpm install                 # install the whole workspace

# Develop
pnpm --filter @luciel/web dev        # marketing + dashboard at http://localhost:3000
pnpm --filter @luciel/widget dev     # widget dev harness (apps/widget/index.html)

# Verify (all packages)
pnpm -r typecheck            # strict TypeScript across the workspace
pnpm -r test                 # Vitest unit/component tests
pnpm --filter @luciel/web lint
pnpm --filter @luciel/web test:e2e   # Playwright E2E + @axe-core a11y (starts dev server)

# Build
pnpm --filter @luciel/web build      # Next.js production build (CSP/HSTS wired)
pnpm --filter @luciel/widget build   # Vite lib build + bundle-separation gate
```

Copy `.env.example` → `.env.local`. **Never commit any `.env` file or any
secret/embed key.** The embed key is injected at runtime by the host page's
`data-key`, never hardcoded or stored in env.

### Try the whole journey (mock)

The app runs entirely on the mock adapter — no backend. Set
`NEXT_PUBLIC_MOCK_SCENARIO` to walk different documented states:

| Scenario             | What you see                                                                       |
| -------------------- | ---------------------------------------------------------------------------------- |
| `verified` (default) | An active Luciel with conversations, connections (one healthy, one expired), leads |
| `fresh`              | Verified account, **no Luciel** → routed to first-run (Create my Luciel)           |
| `unverified`         | The hard email-verification wall (resend + cooldown)                               |
| `at_cap`             | Free 50 reached, no card → the at-cap banner + graceful widget reply               |
| `payg`               | Payment method on file, billing above 50                                           |
| `paused`             | Paused Luciel (the preview renders nothing, as a live widget would)                |
| `grace`              | Deleted Luciel in its 30-day grace window → Restore available                      |

```bash
NEXT_PUBLIC_MOCK_SCENARIO=fresh pnpm --filter @luciel/web dev
```

Key routes: `/` (marketing) · `/signup` `/login` `/verify` `/forgot` `/reset`
(auth) · `/first-run` · `/dashboard` and `/dashboard/{configure,embed,conversations,leads,billing,analytics,audit,account}` ·
`/embed-preview` (the “test it here” widget).

> Sandbox note: if `next dev` misbehaves in a constrained environment, a
> production build (`next build` then `next start`) serves every route reliably.

---

## Honesty about what IS and ISN'T built

Per the product's defining posture (Vision §5; Space Instructions §3.7):

- **Built (full breadth, mock-backed, runnable end-to-end):** marketing site,
  all auth flows, first-run, the five-pillar config (with the Voice consent
  gate, the non-interactive cognition band, inline connections, raw-knowledge
  view), embed + launch, conversations/leads/answer-review/live-takeover,
  billing + dunning states, analytics, audit log, lifecycle (pause/delete/close),
  and the embeddable widget's chat loop. Every surface reads/writes through the
  typed client; swapping the mock for a real backend is one env flag.
- **Deliberately shallow / not real (no over-claiming):**
  - **No backend.** All data is the in-memory mock; full reload resets state.
  - **MFA does not exist** — no UI implies it; the honesty disclosure is shown.
  - **Auth gating is a client-side UX redirect**, not a security control. Real
    enforcement is server-side middleware against the session cookie (documented
    in `middleware.ts` / `auth-guard.tsx`).
  - **Invisible captcha, file upload, OAuth handoffs, Stripe Checkout** are
    placeholders that describe what they do — the real providers wire in with
    the backend.
  - The `httpAdapter` endpoint **paths** mirror the documented families
    (Arch §1.1) and reconcile against the real backend inside
    `adapters/http-admin.ts`, with no component impact.

See `DEFINITION_OF_DONE.md` for the non-negotiable gates every PR must clear.
