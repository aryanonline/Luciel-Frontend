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

/**
 * Start a connect flow (Arch §3.8). ADDITIVE, backward-compatible request shape:
 * `phoneNumber` is the tenant's OWN E.164 number for the BYO SMS/Voice sender
 * (Arch §3.1.4/§3.1.6, Decision #48 — the platform never provisions a number).
 * Mirrors backend PR #32's additive optional `phoneNumber` on StartConnectionRequest.
 * Omitted for every existing (OAuth/credential) connect flow, so no caller breaks.
 */
export const startConnectionRequest = z.object({
  connectionType,
  provider: z.string(),
  /** Tenant-supplied E.164 number for sms_sender/voice (BYO). Non-secret. */
  phoneNumber: z.string().optional(),
});
export type StartConnectionRequest = z.infer<typeof startConnectionRequest>;

/** Start an OAuth/credential connect flow; UI redirects to authorizeUrl. */
export const startConnectionResult = z.object({
  authorizeUrl: z.string().url().optional(),
  /** For non-OAuth (CSV upload, webhook URL) the UI collects fields client-side. */
  requiresClientForm: z.boolean().optional(),
});
export type StartConnectionResult = z.infer<typeof startConnectionResult>;

/**
 * Email-address provisioning (Arch §3.1.6a, Decision #49). The admin provisions
 * the address Luciel SENDS AND RECEIVES on. Two modes, both LAUNCH capabilities:
 *   own_domain   — the business's own address; requires an inbound DNS/MX routing
 *                  step, so it sits at `pending_email_routing` until verified.
 *   vm_subdomain — a zero-DNS VantageMind-subdomain fallback; live immediately.
 * Own-domain inbound is NOT a deferred limitation.
 */
export const emailProvisioningMode = z.enum(['own_domain', 'vm_subdomain']);
export type EmailProvisioningMode = z.infer<typeof emailProvisioningMode>;

/** A single non-secret DNS record the admin adds for own-domain inbound routing. */
export const dnsRecord = z.object({
  type: z.string(), // 'MX' | 'TXT' | 'CNAME'
  host: z.string(),
  value: z.string(),
  priority: z.number().int().optional(),
});
export type DnsRecord = z.infer<typeof dnsRecord>;

export const provisionEmailRequest = z.object({
  mode: emailProvisioningMode,
  /** Required for own_domain: the address Luciel should send + receive on. */
  emailAddress: z.string().optional(),
});
export type ProvisionEmailRequest = z.infer<typeof provisionEmailRequest>;

export const emailProvisioning = z.object({
  mode: emailProvisioningMode,
  /** The provisioned send+receive address (own-domain or the VM-subdomain one). */
  emailAddress: z.string(),
  /** `connected` once live; `pending_email_routing` while own-domain DNS/MX verifies. */
  status: connectionStatus,
  /** own_domain only: the records the admin must add to complete inbound routing. */
  dnsRecords: z.array(dnsRecord).optional(),
});
export type EmailProvisioning = z.infer<typeof emailProvisioning>;
