import { StatusChip } from '@luciel/ui';
import { chipForConnection, type ConnectionStatus } from '@luciel/api-client';

/**
 * Thin app-level adapter: maps a raw connection `status` (api-client) to the UI
 * StatusChip kind. Keeps the status→chip rule in ONE place (api-client's
 * chipForConnection, Arch §3.8.1/§3.8.4) and the presentation in @luciel/ui.
 */
export { StatusChip };

export function chipKindFromStatus(status: ConnectionStatus) {
  return chipForConnection(status);
}
