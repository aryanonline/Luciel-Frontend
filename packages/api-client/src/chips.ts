import type { ConnectionStatus, ConnectionChip } from './schemas';

/**
 * Maps the raw connection `status` enum (Arch §3.8.4) onto the THREE
 * customer-facing chips the UI must show (Space Instructions §4, Arch §3.8.1):
 *   Connected / Action needed: connect [X] / Reconnect needed.
 * Status chips must pair color with a text label AND an icon — never color
 * alone (Space Instructions §5, AA). The label/icon are chosen in the UI layer.
 */
export function chipForConnection(status: ConnectionStatus): ConnectionChip {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'expired':
      return 'reconnect_needed';
    case 'unconfigured':
    case 'error':
    case 'revoked':
    case 'dormant':
    // Carrier registration pending: the channel is not yet live, so it shows the
    // "action needed / being activated" chip — never "connected" (Arch §3.1.6).
    case 'pending_carrier_registration':
    default:
      return 'action_needed';
  }
}
