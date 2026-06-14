import { z } from 'zod';
import { uuid, isoTimestamp, connectionStatus } from './common';

/**
 * The one connection model for everything external (Arch §3.8). Surfaced inline
 * per pillar; the object underneath is identical. The data-export / UI shows
 * provider + non-secret config + status ONLY — never secret material
 * (Arch §3.8.3, Space Instructions §3.4).
 */

export const connectionType = z.enum([
  'calendar',
  'crm',
  'record_source',
  'email_sender',
  'sms_sender',
  'outbound_webhook',
  'channel_auth',
  'knowledge_source',
]);
export type ConnectionType = z.infer<typeof connectionType>;

export const connection = z.object({
  connectionId: uuid,
  connectionType,
  /** Open-ended provider id (e.g. google_calendar | hubspot | twilio | notion). */
  provider: z.string(),
  status: connectionStatus,
  /** Provider-specific NON-secret config only (calendar id, field mappings, etc.). */
  nonSecretConfig: z.record(z.unknown()).optional(),
  /** Human-readable detail for error/expired states (never a secret). */
  statusDetail: z.string().optional(),
  lastHealthCheckAt: isoTimestamp.optional(),
  createdAt: isoTimestamp,
});
export type Connection = z.infer<typeof connection>;

/** Start an OAuth/credential connect flow; UI redirects to authorizeUrl. */
export const startConnectionResult = z.object({
  authorizeUrl: z.string().url().optional(),
  /** For non-OAuth (CSV upload, webhook URL) the UI collects fields client-side. */
  requiresClientForm: z.boolean().optional(),
});
export type StartConnectionResult = z.infer<typeof startConnectionResult>;
