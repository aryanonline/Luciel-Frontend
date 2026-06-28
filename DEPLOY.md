# Deployment

This monorepo produces two independently-deployed artifacts. They never share an
auth context (Space Instructions §1, §2).

## Canonical domains

| Purpose            | Domain                  |
| ------------------ | ----------------------- |
| Marketing + app    | `vantagemind.ai`        |
| Backend API        | `api.vantagemind.ai`    |
| Widget CDN (embed) | `embed.vantagemind.ai`  |

The founder owns `vantagemind.ai` only. There is no `.com`.

## apps/web — Next.js SSR → ECS container

`apps/web` is a **server-rendered** Next.js App Router app, NOT a static export:

- routes use `export const dynamic = 'force-dynamic'`;
- `src/middleware.ts` sets a per-request nonce-based CSP;
- `next.config.mjs` has **no `output: 'export'`** (confirmed) and no `output: 'standalone'`.

Therefore it must run as a long-lived **Node server** (`next start`), not on
S3/CloudFront. Deploy as a container on **ECS** (Fargate) behind an ALB.

- Dockerfile: `apps/web/Dockerfile` (multi-stage, pnpm workspace-aware, non-root
  `node` user, `next build` → `next start -p 3000`, container `HEALTHCHECK`).
- Build from the **repo root** so the workspace resolves:
  ```bash
  docker build -f apps/web/Dockerfile -t luciel-web .
  ```
- Listens on port `3000` (`PORT` env overridable).

### Marketing routes ship with the dashboard

The marketing site lives inside `apps/web` under the `(marketing)` route group
alongside the gated `(app)` dashboard. They are a **single container** — the
marketing pages deploy WITH the dashboard. This is intentional and is **not**
split now. (A future CDN/edge split of the public marketing routes is possible
but out of scope.)

### Required build-time env (NEXT_PUBLIC_*, all non-secret/public)

Inlined into the client bundle at `next build` time — never put secrets here:

- `NEXT_PUBLIC_API_ADAPTER` — `mock` | `http` (use `http` in prod).
- `NEXT_PUBLIC_API_BASE_URL` — defaults to `https://api.vantagemind.ai`
  (required when adapter is `http`).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe publishable (public) key.

The session JWT is carried by an httpOnly Secure cookie / in memory — it is
never an env var and never baked into the image.

## apps/widget — static bundle → S3 + CloudFront

`apps/widget` is a Vite library-mode build producing a single self-initializing
bundle. Built with:

```bash
pnpm --filter @luciel/widget build   # output → apps/widget/dist/
```

Output (`apps/widget/dist/`): `luciel.js` (IIFE for the `<script>` tag),
`luciel.mjs` (ESM), plus sourcemaps. This is fully static — upload to **S3** and
serve via **CloudFront** at `embed.vantagemind.ai/v1/luciel.js`.

### Required build-time env (VITE_*, all non-secret/public)

- `VITE_WIDGET_API_BASE_URL` — defaults to `https://api.vantagemind.ai`.
- `VITE_WIDGET_ADAPTER` — `mock` | `http`.

The embed key is NOT a build env — the host page supplies it at runtime via the
`data-key` attribute on the `<script>` tag.

## Build all

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r build        # builds apps/web (.next) and apps/widget (dist)
```
