# `packages/api-client` — Typed API Boundary Guide

## Purpose

`@luciel/api-client` is the typed frontend boundary to Luciel APIs. It exposes a
control-plane dashboard client and a deliberately separate data-plane widget
client, with mock and HTTP adapters behind stable interfaces.

## Key files

- `src/schemas/` — Zod schemas and derived shared types.
- `src/client.ts` — control-plane `LucielApiClient` interface.
- `src/widget-client.ts` — widget `WidgetApiClient` interface.
- `src/index.ts` — control-plane public entrypoint.
- `src/widget.ts` — data-plane-only public entrypoint.
- `src/factory.ts` — control-plane adapter selection.
- `src/widget-factory.ts` — widget adapter selection.
- `src/adapters/http-admin.ts` — authenticated control-plane HTTP transport.
- `src/adapters/widget-adapters.ts` — public widget transport and mock behavior.
- `src/adapters/mock-admin.ts` and `src/adapters/mock-data.ts` — deterministic
  control-plane states for UI development and tests.
- `src/chips.ts` — raw connection-status to customer-chip mapping.
- `src/__tests__/` — boundary, transport, and plane-separation tests.

## Invariants owned here

- UI code consumes interfaces and public factories, not adapter internals.
  Changing mock to HTTP must not require component changes.
- The dashboard/control plane and public widget/data plane have separate
  entrypoints, transports, and authentication behavior. Never re-export an
  admin symbol from `src/widget.ts`.
- HTTP admin requests include the dashboard session context; widget requests
  omit credentials and use the embed-key data-plane contract.
- Schemas are the source for client response shapes. Change the schema,
  interface, HTTP implementation, mock implementation, and regression coverage
  together.
- Connection chip mapping must never show false Connected. A provider marked
  unavailable resolves to `not_available`, regardless of a stale raw status.
- Human labels come from served `displayName` fields; raw enums are wire values,
  not display copy.
- Model evidence attribution as three states, not an empty/non-empty boolean;
  preserve the legacy unscored condition.

## Tests and commands

```bash
pnpm --filter @luciel/api-client typecheck
pnpm --filter @luciel/api-client test
pnpm --filter @luciel/api-client build
```

Add tests under `src/__tests__/` for boundary, transport, or plane-separation
rules. Test adapters through their public client behavior where possible.

## Gotchas from this cycle

- `providerAvailable` is stronger than a connection's stale `status`. It avoids
  offering an impossible owner action or showing a false Connected chip.
- The widget bundle gate checks emitted output, not just TypeScript exports.
  Keep both the source-level separation test and `apps/widget` build gate green.
- A widget `widget_poll_only` delivery result is not an error; it means a
  persisted takeover reply will arrive on a later poll, not a push.
- Mock scenarios must exercise loading/failure/honesty paths but do not grant
  permission to claim behavior absent from the served contract.
