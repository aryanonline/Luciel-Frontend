import type { ConnectionStatus, ConnectionChip } from './schemas';

/**
 * Maps the raw connection `status` enum (Arch §3.8.4) onto the customer-facing
 * chips the UI must show (Space Instructions §4, Arch §3.8.1):
 *   Connected / Action needed: connect [X] / Reconnect needed / Not available yet.
 * Status chips must pair color with a text label AND an icon — never color
 * alone (Space Instructions §5, AA). The label/icon are chosen in the UI layer.
 *
 * `registryConfigured` (Harmony wave 2, item 6a; backend contract:
 * `ConnectionOut.providerAvailable`, backend_gaps.md §"Harmony wave 2", FE
 * CONTRACT BLOCK item 3): a status of `unconfigured` (or any other
 * non-connected, non-reconnect status) literally means "Action needed:
 * connect/fix [X]" — but that is only true if the tenant CAN act on it. When
 * the served registry cannot connect this provider at all (`providerAvailable:
 * false` — the same truth Configure derives per-provider from
 * `ProviderOptionOut.configured`), telling the owner there is an action they
 * can take is false: there is no button that does anything. Per the backend
 * contract this overrides even a `connected` row — "Not available yet" wins
 * REGARDLESS of `status` — so pass `registryConfigured: false` and every
 * chip collapses to `not_available`, no exceptions. Omitted/`true` preserves
 * the original three-chip behavior exactly (default param — every
 * pre-existing call site, and every row where the backend defaults
 * `providerAvailable` to `true`, is unaffected).
 */
export function chipForConnection(
  status: ConnectionStatus,
  registryConfigured: boolean = true,
): ConnectionChip {
  if (!registryConfigured) return 'not_available';
  switch (status) {
    case 'connected':
      return 'connected';
    case 'expired':
      return 'reconnect_needed';
    case 'unconfigured':
    case 'error':
    case 'revoked':
    // Disconnected by the admin: reconnectable, but nothing works until they do.
    case 'not_connected':
    case 'dormant':
    // Carrier registration pending: the channel is not yet live, so it shows the
    // "action needed / being activated" chip — never "connected" (Arch §3.1.6).
    case 'pending_carrier_registration':
    // Own-domain email routing not yet verified: not live, so "action needed"
    // until DNS/MX checks pass — never "connected" (Arch §3.1.6a).
    case 'pending_email_routing':
    default:
      return 'action_needed';
  }
}
