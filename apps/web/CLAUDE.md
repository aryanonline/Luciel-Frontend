# `apps/web` — Dashboard and Marketing Guide

## Purpose

`apps/web` is the Next.js App Router application for Luciel's public marketing
routes, authentication journey, owner dashboard, configuration surface, and
embed preview. It is the control-plane UI; it does not ship the public widget
bundle.

## Key files

- `src/app/layout.tsx` — application root layout and global setup.
- `src/app/(marketing)/` — public marketing, legal, contact, and preview routes.
- `src/app/(auth)/` — sign-up, verification, login, reset, and recovery routes.
- `src/app/(app)/dashboard/page.tsx` — overview and attention counter.
- `src/components/today-card.tsx` — the employee in one place (round 6 WP-F): identity line
  ("on duty around the clock"), capability strip, "What I need from you" (served needs with
  links), yesterday/today counts, morning-brief toggle, business short name. All served.
- `src/app/(app)/dashboard/configure/page.tsx` — configuration entry surface.
- `src/app/(app)/dashboard/conversations/page.tsx` — conversation, evidence, and
  takeover presentation.
- `src/components/config/connection-control.tsx` — connection lifecycle actions.
- `src/components/config/acknowledgements.tsx` — every acknowledgement listed and withdrawable
  (round 6 WP-D); `knowledge-connections.tsx` — connected knowledge sources with re-sync,
  reconnect, disconnect/remove crawl.
- `src/components/config/calendly-event-type.tsx` — which Calendly event type customers
  book (round 6 WP-H): served list with the chosen one marked, PUT /connections/{id}/settings,
  honest copy when Calendly cannot be read; mounted under a connected Calendly calendar only.
- `src/components/config/consent-landing.tsx` — post-consent state messaging.
- `src/components/config/labels.ts` — served provider display-label resolution.
- `src/components/config/channels-pillar.tsx` — channel configuration and consent.
- `src/components/config/team-availability-pillar.tsx` — the optional sixth card (round 6
  WP-E): when the HUMAN team is reachable, closures, after-hours contact. Luciel has no
  hours; the copy must keep saying it answers around the clock.
- `src/components/connection-chip.tsx` — status-chip presentation bridge.
- `src/lib/api.ts` and `src/lib/hooks.ts` — typed control-plane client and queries.
- `tests/unit/` — focused UI behavior and regression tests.
- `tests/e2e/a11y.spec.ts` — browser accessibility coverage.
- `tests/e2e/journey.spec.ts` — the mock-adapter customer walk (overview → configure →
  embed → conversations → leads → billing); `tests/e2e/live-smoke.spec.ts` — the opt-in,
  read-only walk of a deployed environment; `tests/e2e/mock-session.ts` — the planted
  session-presence cookie the middleware requires before any dashboard page renders.

## Invariants owned here

- Render honest connection states. Authorization without a bound destination is
  **Action needed**, and a non-configured provider is **Not available yet**,
  never Connected.
- Consent landing reads served state and says **“authorized — one step left”**
  when the provider consent worked but channel binding remains.
- Display human-facing provider names from served `displayName` data; never
  surface raw enums/slugs as labels.
- The overview attention counter includes only rows whose resolved chip is
  `action_needed`.
- Every list has separate loading, empty, and error rendering. Do not erase an
  error by showing an empty state.
- Every mutation exposes pending, success, and error. Destructive or confirmable
  writes use `Modal`'s async contract so failures stay visible.
- Evidence respects the three attribution states. Old answers render
  **“Not scored (before scoring existed)”** instead of a made-up score.
- Takeover UI must not describe widget delivery as real time; widget replies are
  delivered through polling.
- Team availability describes people, never the Luciel: no copy may imply Luciel is
  offline, closed, or has hours. Off = the generic "follow up shortly" wording.
- Round 6 WP-D: everything connected can be switched or disconnected with its toggle OFF
  (off rows carry a "Manage connection" disclosure); the channel→send-tool cascade is the
  SERVER's (F163) — never issue a second PUT for it; `chipKind(status, available)`; the
  designate toast phrases the served status (`numberOutcomePhrase`, F159).
- The Today card never derives a state locally: capabilities, needs and counts come from
  `GET /admin/luciel/status`. A test that mocks `@/lib/hooks` wholesale must stub
  `useEmployeeStatus` and `useLucielMutations` or the Overview page cannot render.

## Tests and commands

```bash
pnpm --filter @luciel/web typecheck
pnpm --filter @luciel/web test
pnpm --filter @luciel/web build
pnpm --filter @luciel/web test:e2e
```

Run the whole workspace checks before handoff. Add a focused unit test alongside
any fix to a dashboard state, connection label, count, modal, or evidence rule.

## Gotchas from this cycle

- Treat a still-loading registry as unknown, not unavailable; otherwise the UI
  can show a false “not available yet” state.
- Connection status is not sufficient by itself: combine it with served provider
  availability before choosing a chip or counting owner attention.
- Do not derive labels from raw API identifiers when a served `displayName` is
  available. Compatibility fallback must still be human-readable.
- Browser automation copy feedback can vary around the exact text. Assert the
  meaningful **“Copied”** substring, then reproduce questionable interactions in
  plain Chromium before changing application code.
- `apps/web` imports the control-plane client entrypoint only. Keep adapters and
  widget data-plane imports out of components and pages.
- Voice/SMS chip split at `pending_carrier_registration` (2026-08-18): 10DLC gates
  TEXTING only, so the Voice row renders Connected + "Calls work now…" while SMS
  keeps action_needed — presentation-only; the wire status stays one value.
- Conversations page: rows carry `#<first-8-of-sessionId>` matching the escalation
  email's ref; `?open=<sessionId>` deep-opens a transcript (useSearchParams under
  Suspense); escalation badges ride `useEscalations` and degrade to a note on
  fetch failure. SMS-modal dismissal is never silent.
