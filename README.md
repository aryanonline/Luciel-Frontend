# Luciel — Frontend

Luciel is an AI assistant that a business runs on its own knowledge. It answers
customers on the business's website and other channels, grounds its answers in the
business's own documents, and hands the conversation to the team when it can't
answer confidently.

This repository holds everything people see: the public marketing and legal pages,
the owner sign-up and dashboard, and the chat widget that businesses embed on their
own websites. The API and AI runtime live in a separate backend repository.

## What's in this repository

It is a pnpm monorepo with two apps and three shared packages:

| Path                                               | What it is                                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)                             | Next.js 15 (App Router) and React 19 app: marketing and legal pages, sign-up / login / password reset, the first-run setup, the owner dashboard and the embed preview |
| [`apps/widget`](apps/widget)                       | The embeddable website chat widget: a Vite library bundle that mounts inside a Shadow DOM on the customer's site                                                      |
| [`packages/api-client`](packages/api-client)       | The typed API boundary: Zod schemas plus a dashboard (control-plane) client and a separate widget (data-plane) client, each with HTTP and mock adapters               |
| [`packages/ui`](packages/ui)                       | Shared, accessible React UI primitives and markdown helpers                                                                                                           |
| [`packages/design-tokens`](packages/design-tokens) | Design tokens shared as TypeScript, CSS and Tailwind configuration                                                                                                    |

The dashboard (`apps/web/src/app/(app)/dashboard`) covers the overview, configuration
(knowledge sources, channels and connections), conversations and human takeover,
leads, analytics, billing, embed code, the audit log and account settings.

The marketing site, the dashboard and the widget share a design system but never an
auth context: the widget talks only to the public data-plane API and ships no admin
code.

## Tech stack

- **Language and tooling:** TypeScript, pnpm workspaces, Prettier, ESLint
- **Web app:** Next.js 15, React 19, TanStack Query, React Hook Form with Zod, Radix UI, Tailwind CSS
- **Widget:** Vite (library mode), plain TypeScript and DOM, Shadow DOM isolation
- **Testing:** Vitest and Testing Library for unit tests; Playwright with axe-core for end-to-end and accessibility tests
- **Delivery:** GitHub Actions, Docker (web image), with the widget published to an embed CDN

## How it behaves

These rules are enforced in code and tests:

- **Honest states.** A connection shows _Connected_, _Action needed_, _Reconnect needed_
  or _Not available yet_, never a false _Connected_. Labels come from the API, not from
  raw provider names.
- **Every action shows its outcome.** Mutations show pending, success and error states,
  and every list has separate loading, empty and error views. An empty list never stands
  in for a failed request.
- **Evidence is never invented.** Answers carry one of three evidence states (has sources,
  no sources retrieved, attribution unavailable). Answers from before scoring existed are
  shown as not scored, not as ungrounded.
- **A well-behaved widget.** It is closed by default, isolated in a Shadow DOM, keeps an
  AI disclosure visible whenever it is open, and shows nothing at all when the assistant
  is paused. A bundle check fails the build if any admin API code leaks into it.
- **Accessible by default.** Keyboard operation, visible focus, semantic labels, live
  announcements and reduced-motion support. CI runs a WCAG 2.1 AA check over every route.

## Getting started

Requirements: Node.js 20 or later and pnpm 9 (via Corepack).

```bash
corepack prepare pnpm@9.7.0 --activate
pnpm install --frozen-lockfile
```

Configuration comes from environment variables. Copy [`.env.example`](.env.example) to
`.env.local` and read the comments in it. The key setting is the API adapter:

| Variable                             | Purpose                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_API_ADAPTER`            | `mock` runs the dashboard against in-memory data with no backend; `http` uses the real API |
| `NEXT_PUBLIC_API_BASE_URL`           | Public API origin, needed only with the `http` adapter                                     |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe _publishable_ key (never a secret key)                                              |
| `VITE_WIDGET_API_BASE_URL`           | Data-plane API origin for the widget build                                                 |

No secret ever belongs in a `NEXT_PUBLIC_*` or `VITE_*` variable, because those are
compiled into public bundles. Session tokens live in an httpOnly cookie set by the
backend, and the widget's embed key is read at runtime from the host page's `data-key`
attribute.

Run everything in development mode:

```bash
pnpm dev
```

Or work on one package at a time:

```bash
pnpm --filter @luciel/web dev
pnpm --filter @luciel/widget dev
```

## Testing and quality checks

```bash
pnpm -r typecheck      # all packages
pnpm -r test           # unit tests (about 675 across the workspace)
pnpm -r build          # production builds
pnpm test:e2e          # Playwright journeys and accessibility checks for the web app
pnpm test:scripts      # tests for the repository scripts (image CVE gate)
pnpm format            # Prettier check
```

The end-to-end suite runs against the mock adapter. It covers the customer journey,
one project per account scenario (fresh, at the free cap, pay-as-you-go, paused, grace
period, closed, expired session) and an accessibility check of every route. A read-only
smoke test against a deployed environment is opt-in and runs only from a manually
dispatched workflow.

CI (`.github/workflows/ci.yml`) runs on every push and pull request:

- typecheck, unit tests and a build for every package, plus lint for the web app
- a dependency audit that blocks high and critical vulnerabilities (waivers expire)
- the widget bundle check
- the WCAG 2.1 AA accessibility suite (Playwright and axe-core)
- a secret scan (gitleaks)

## Deployment

Deployments run only by manual dispatch of `.github/workflows/deploy.yml`, with an
explicit environment. The workflow builds the web image, scans it against a dated CVE
allowlist (`.security/cve-allowlist.json`, which fails closed when a waiver expires),
rolls the web service and publishes the widget bundle to the embed CDN. A guard job
refuses to deploy from any branch other than the release branch, `main`, and nothing
deploys on push. Dependabot keeps dependencies current; green minor and patch updates merge
automatically, and major updates wait for review.

## Working in this codebase

The [`CLAUDE.md`](CLAUDE.md) files at the root and in each app and package are the
working guides: invariants, key files, test locations and known pitfalls. Read the one
for the module you are changing first. Product and business documents are kept outside
this repository.
