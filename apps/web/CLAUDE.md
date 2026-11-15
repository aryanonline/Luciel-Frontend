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
- `src/app/error.tsx`, `src/app/global-error.tsx` — the crash pages, both rendering
  `src/components/error-screen.tsx`; `src/lib/chunk-reload.ts` — the one automatic reload;
  `src/lib/chunk-watchdog.ts` — the same recovery for a file lost during a page load.
- `src/app/favicon.ico`, `icon.svg`, `apple-icon.png` — the site icon, the Logo's V mark
  (2026-11-14: the app had none, so browsers fetched `/favicon.ico` on their own and logged a
  404). Next serves them from the ROOT segment by its metadata file convention and adds the
  `<link>` tags to every page; there is no `public/` folder. The ICO (16/32/48 px) and the
  touch icon (180 px, full-bleed because iOS rounds it) are renders of icon.svg by
  `scripts/render-site-icons.mjs`. When the mark changes (in `packages/ui/src/Logo.tsx` and
  icon.svg), run `pnpm --filter @luciel/web exec node scripts/render-site-icons.mjs`; it uses
  Playwright's Chromium, or an installed browser with `--channel msedge` or `--channel chrome`.
  It rewrites both files and records their sha256, and icon.svg's, in
  `tests/unit/site-icon-renders.json`. `tests/unit/site-icon.test.tsx` checks the ICO's three
  sizes, the touch icon's size, icon.svg's viewBox, path and stroke width against the Logo's
  mark on the brand accent, and the recorded digests: an icon.svg changed without a re-render,
  or a raster replaced by hand, fails. It also reads every string in the shipped code (`src/`,
  `packages/ui/src`, `packages/design-tokens/src`, `next.config.mjs` and `tailwind.config.ts`;
  not comments or unit tests) and fails on any root-relative static file Next would not serve,
  either from `public/` or as a metadata file at the top of `src/app`. A path built at runtime
  is not checked. `tests/e2e/site-icon.spec.ts` (`chromium` project) checks the server's answers: the
  three files answer 200 with their image type to a visitor with no session, and `/` and
  `/dashboard` link all three.
- `src/lib/api.ts` and `src/lib/hooks.ts` — typed control-plane client and queries.
- `tests/unit/` — focused UI behavior and regression tests.
- `tests/e2e/a11y.spec.ts` — the WCAG 2.1 AA gate over EVERY route (round 7 WP-12: 23 today).
  Each entry names the page's own heading and waits for it (and for no "Loading…") before
  axe runs; the last test fails when a `page.tsx` is added without an entry. A page that
  exists in one account state runs under that scenario (first-run → fresh, account-closed →
  closed). The crash page has no route: its tests reach it by aborting a page's chunk, or
  main-app for the page-load path.
- `tests/e2e/journey.spec.ts` — the mock-adapter customer walk (overview → configure →
  embed → conversations → leads → billing); `tests/e2e/live-smoke.spec.ts` — the opt-in,
  read-only walk of a deployed environment (there is none while the hosted dev environment is
  paused, since 2026-11-14; see the root CLAUDE.md). Like live-walk it types the credentials with
  `fillSecret` and runs once, with no trace or video: live-smoke.yml uploads the report, pass or
  fail, from this public repository. `tests/e2e/mock-session.ts` — the planted
  session-presence cookie the middleware requires before any dashboard page renders.
- `tests/e2e/scenarios/*.spec.ts` (round 7 WP-12) — one Playwright project per mock
  scenario (`scenario-fresh`, `-at-cap`, `-payg`, `-paused`, `-grace`, `-closed`,
  `-expired-session`). `tests/e2e/support/fixtures.ts` plants the `luciel_mock_scenario`
  cookie (a project option) and offers `mockControl` (inject a failure, slow calls so a
  pending label is readable, end a session, revoke a knowledge grant), `expectPending` and
  `reloadAndExpect` — EVERY mutation a spec makes is followed by a reload, and what the
  page shows after it must have come back from the mock's persisted store.
  `support/provider-stubs.ts` stands in for Stripe Checkout / the Billing Portal and the
  OAuth consent host, returning exactly the way the provider + backend callback would.
- `tests/e2e/walk/customer-walk.spec.ts` (round 7 WP-12, project `walk`) — the customer-style
  walk, in order: sign in, Today card, every Configure pillar, Embed + allowlist + Test it
  here, Conversations, Leads, Analytics, Audit, the walk's own knowledge deleted again,
  Billing, Pause/Resume, Delete/Restore, Close/Re-export/Reopen. `walk/walk-kit.ts`'s
  `Walk.mutate` runs every write the honest way — (mock) an injected failure first, the
  pending label while slowed, the success, then a reload. A success check must not pass
  while the call is still pending (a button relabelled "Restoring…" is not "restored"), or
  the reload cuts the write off. Timings (each pillar, time to the first GROUNDED answer —
  judged from the evidence panel, the widget reply carries no attribution) are report
  annotations. ~4–5 minutes on the mock. As the `live-walk` project (E2E_LIVE=1 +
  E2E_LIVE_WRITE=1, `.github/workflows/live-walk.yml`, dispatch-only) the same spec signs in
  with the walk account (credentials set through the DOM by `fillSecret`, never a titled
  `fill`; no trace or video), first repairs what a cut-short walk left (closed / deleted /
  paused), changes only what it created or toggles back, and skips with the reason every
  step needing an owner asset or provider consent (`NEEDS` in walk-kit.ts). While the hosted dev
  environment is paused (since 2026-11-14), `live-walk` has no tenant to walk: the walk account
  comes back with the database snapshot, and the backend's restore runbook runs this walk once
  dev is back. `walk/summary.mjs` turns the JSON report into the job summary.

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
- Evidence respects the four attribution states. Old answers render
  **“Not scored (before scoring existed)”** instead of a made-up score.
- Takeover UI must not describe widget delivery as real time; widget replies are
  delivered through polling.
- Team availability describes people, never the Luciel: no copy may imply Luciel is
  offline, closed, or has hours. Off = the generic "follow up shortly" wording.
- Round 6 WP-D: everything connected can be switched or disconnected with its toggle OFF
  (off rows carry a "Manage connection" disclosure); the channel→send-tool cascade is the
  SERVER's (F163) — never issue a second PUT for it; `chipKind(status, available)`; the
  designate toast phrases the served status (`numberOutcomePhrase`, F159).
- A saved row that is expired or erroring reconnects only its OWN provider ("Reconnect
  HubSpot"); with more than one provider on offer, every other one is "Switch to …" through
  the staged swap. `reconnect` re-runs the saved provider's flow whatever the button named, so
  a "Connect Salesforce" there opened HubSpot's consent screen (fixed 2026-11-14).
- The Today card never derives a state locally: capabilities, needs and counts come from
  `GET /admin/luciel/status`. A test that mocks `@/lib/hooks` wholesale must stub
  `useEmployeeStatus` and `useLucielMutations` or the Overview page cannot render.

## Tests and commands

```bash
pnpm --filter @luciel/web typecheck
pnpm --filter @luciel/web typecheck:tests
pnpm --filter @luciel/web lint
pnpm --filter @luciel/web test
pnpm --filter @luciel/web build
pnpm --filter @luciel/web test:e2e
```

`tsconfig.json` excludes `tests/` so `next build` never compiles them. `tsconfig.test.json`
extends it and type-checks `tests/**`, `playwright.config.ts` and `vitest.config.ts`
(`typecheck:tests`, run by CI's typecheck step, added 2026-11-14). A fixture typed with a schema
type must carry every required field; when one is added, give it the value its absence already
behaved as (for a Luciel, `escalationContactHealth: []` and `leadRetentionDays: null`). Vitest
strips types without checking them, so only this check catches a fixture that has drifted from
the contract.

Lint is the ESLint 9 CLI over the whole app (`eslint .`, migrated from the deprecated
`next lint` on 2026-11-14). `eslint.config.mjs` is a flat config that loads eslint-config-next
15's `next/core-web-vitals` through FlatCompat and adds the adapter-import ban; `next build`
lints `src/` with the same config. eslint-config-next 15.5 does not support ESLint 10.

Forms validate with zod 4 through `@hookform/resolvers` 7 (both moved on 2026-11-14).
`tests/unit/form-validation-messages.test.tsx` pins every message a form schema shows, word
for word; a field error renders as `#<field>-error` under its input.

Run the whole workspace checks before handoff. Add a focused unit test alongside
any fix to a dashboard state, connection label, count, modal, or evidence rule.

Unit tests run beside three other Vitest suites under `pnpm -r test`, so a busy machine slows
them several times over (2026-11-14). Render the component under test, not the whole page,
and hand `renderWithQuery` a `seededQueryClient` holding the served answers for any read the
test is not about, so the first render is the settled screen. Wait for the end state a flow
produces (`findBy*`, or the write's own promise inside `act`), never a fixed sleep: a check
that something is absent proves nothing until the read behind it has landed. Keep `*ByRole`
queries to a small container: over a whole card they cost about as much as rendering it. A
test that is not about pending states can mock `@/lib/api` with the same mock client at
`latencyMs: 0` (escalation-sms-test-text does), so chained calls do not add up 150 ms each.
`tests/setup.ts` lets the work React and TanStack Query queued before each unmount run while
the jsdom window still exists.

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
- Vitest 4 (2026-11-14, from 3.2.7) changed two mock rules the unit tests lean on.
  `vi.restoreAllMocks()`, which many files call in `afterEach`, now only puts back methods that
  `vi.spyOn` replaced: it no longer clears the calls or resets the implementation of a `vi.fn()`.
  A `vi.fn()` shared between tests needs its own `mockReset()`, in a hook or at the top of each
  test, as every one has today. And `vi.spyOn` on a method that is already a spy returns that
  same spy (Vitest 3 wrapped it in a new one), so a helper that reads the current method and then
  spies again makes the spy call itself: bind the real method once, before any spy, as
  `chunk-watchdog.test.ts` does.
- `apps/web` imports the control-plane client entrypoint only. Keep adapters and
  widget data-plane imports out of components and pages.
- Voice/SMS chip split at `pending_carrier_registration` (2026-08-18): 10DLC gates
  TEXTING only, so the Voice row renders Connected + "Calls work now…" while SMS
  keeps action_needed — presentation-only; the wire status stays one value.
- The mock scenario is a RUNTIME choice (round 7 WP-12): `?mock_scenario=<name>` or the
  `luciel_mock_scenario` cookie, read by the mock adapter; `NEXT_PUBLIC_MOCK_SCENARIO` is
  only the build default. In a browser the mock persists in sessionStorage (`?mock_reset=1`
  starts over); unit tests (NODE_ENV test) keep the old fresh-per-client store. A session
  the API refuses sends the owner to `/login?reason=session_expired&next=…`, and the login
  page says why. After first-run's create the session is re-read (`refreshSession`) — the
  cached `first_run` answer used to bounce the owner straight back to first-run.
- Closing the account SIGNS THE OWNER OUT (the server bumps the session epoch; live walk run 7,
  2026-10-25): the account page clears the query cache and goes to `/login?reason=account_closed`
  (never `/`); `markSignedOutByClosure()` makes the guard send a racing 401 there too instead of
  `session_expired`, until a sign-in or any served session clears it; signing in again lands
  on `/account-closed`.
- Knowledge syncs can be asynchronous (round 7; the server answers 202 past its 20 s inline
  wait and the client polls — see packages/api-client CLAUDE.md). "Connected sources" reads
  the SERVED `syncJob`: `syncing` → "Crawling…" (website_crawl) / "Syncing…" + "started
  <time>", Re-sync held by aria-disabled (NEVER native disabled: the guarded click is real and
  `aria-describedby` points at that line), and `useConnections` with
  `refetchInterval: knowledgeSyncRefetchInterval` re-reads every 2 s while any row syncs; a row
  leaving `syncing` invalidates knowledge + quota + employeeStatus and the list's one
  always-mounted `role="status"` region says how it ended. `failed` → "Last sync failed:
  <error>" beside a last-synced time that is never erased; `shrink_pending` → the served
  sentence (or one built from `job.shrink`), + "Yes, remove them and sync" on a connected row
  only; a not_connected row shows no job line. "Remove crawl" / "Disconnect" stays ENABLED on
  a syncing row: removing a source stops its sync and keeps nothing from it, so "Nothing new
  is pulled…" is true. The stopped sync's "removed while it was syncing" sentence is an outcome,
  never red (`isSyncRemoved` → info tone), and a list whose own tab removed the source keeps its
  "no longer crawled" notice over it. A row that leaves the list mid-sync (a Luciel delete from
  another tab, a Log out's `qc.clear()` racing the 2 s poll) counts as having left `syncing`; a
  throw in that effect would land the owner on the crash page. A
  test of it needs the poll's read in flight or refused (an instant mock hides the bug) and an
  error boundary. A per-source Re-sync in "Your sources" is held, with its reason, while
  its connection serves `syncing`. **Nobody is held behind a 202** (`lib/sync-action.ts`
  `syncUntilAnswered`, used by the crawl dialog, row Re-sync, both confirm-shrinks, per-source
  Re-sync and the scope panel's Sync now): pending lasts until the POST answers. A fast
  outcome is as ever (a failure stays in the crawl dialog with its input, F169, a real 503
  included). On a 202 the dialog closes with "Crawling <url> — this can take a few minutes…",
  `qk.connections` is re-read so the row serves "Crawling…" in the same tab, and the
  byte-identical success toast, a danger notice with the served text, or the still-running
  info notice (`isSyncStillRunning`, never the code alone) follows when the poll settles. A
  source that sync removed at its origin never reads "Re-synced".
  The walk's mock-only step "a crawl in progress survives a reload" uses
  `mockControl(page).holdNextSync()` + `releaseSync()`; on live the Knowledge pillar first
  waits up to 7 min for a crawl a cut-short walk left running, removes it if it is still
  CONNECTED (matched by its exact name; the same URL reuses one row, so a finished walk leaves
  it not-connected) and deletes a leftover `walk-services-<epoch>.csv` the skipped "Knowledge
  cleanup" never reached. The live crawl and its re-sync each get 420 s. A refused
  sync's sentence appears TWICE (the action banner and the row's "Last sync failed: …"),
  so a spec locates the banner by role (`getByRole('status').filter({ hasText })`), never
  by a bare `getByText` of the sentence.
- Crash pages: `app/error.tsx` catches a page or nested layout (it replaces the dashboard's
  header too, so ErrorScreen carries its own logo and `main`); `global-error.tsx` catches the
  root layout and sets its own html, body and font variable. A ChunkLoadError or failed
  dynamic import reloads once (sessionStorage `vm-chunk-reload-at`; a recurrence within five
  minutes, or storage that throws, shows the copy instead), and starts on the status line so
  a recovery never announces a failure. Reload on any other error calls the boundary's
  `reset` first; if the page throws again within 10 s it does a real page load, because
  `reset` only renders again and the query cache sits above the boundary.
- A file lost during a FULL page load is a different path. If one of the scripts every page
  starts from fails (`webpack-*`, `main-app-*`, what main-app waits on), Next neither hydrates
  nor throws; any other script in the HTML only throws at webpack's 120 s timeout, and a failed
  chunk that global-error needs clears the page. `src/lib/chunk-watchdog.ts`, an inline nonced
  script in the root layout's head, catches the failed `/_next/static` script or stylesheet
  up to the load event, applies the same guard, then draws the same copy (`CRASH_COPY`) as a
  modal dialog with inline styles, putting it back if React clears the document. ErrorScreen
  dismisses it on mount. Not covered: a file that hangs instead of failing. Old chunks still
  vanish during a roll, so an owner in that window can still land on this copy.
- `Logo` shows one word, "VantageMind": its V mark is an SVG, not text. A typed mark fails
  WCAG 2.5.3 (axe `label-content-name-mismatch`) on every link wrapping the logo with an
  aria-label, even under aria-hidden.
- Conversations page: rows carry `#<first-8-of-sessionId>` matching the escalation
  email's ref; `?open=<sessionId>` deep-opens a transcript (useSearchParams under
  Suspense); escalation badges ride `useEscalations` and degrade to a note on
  fetch failure. SMS-modal dismissal is never silent.
