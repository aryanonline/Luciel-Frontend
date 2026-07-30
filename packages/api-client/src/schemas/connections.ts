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
  statusDetail: z.string().nullable().optional(),
  lastHealthCheckAt: isoTimestamp.nullable().optional(),
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

/**
 * Start an OAuth/credential connect flow. `authorizeUrl` is a REAL provider
 * consent URL carrying a single-use 10-minute signed state; the UI performs a
 * full-page navigation to it and never reuses one across attempts. It is `null`
 * for non-OAuth classes (then `requiresClientForm` is true) and for providers
 * with no registered OAuth client — those also carry a `statusDetail` beginning
 * "Action needed:", which means DO NOT REDIRECT, show the message.
 */
export const startConnectionResult = z.object({
  authorizeUrl: z.string().url().nullable().optional(),
  /** For non-OAuth (CSV upload, webhook URL) the UI collects fields client-side. */
  requiresClientForm: z.boolean().nullable().optional(),
  statusDetail: z.string().nullable().optional(),
});
export type StartConnectionResult = z.infer<typeof startConnectionResult>;

/**
 * Provider CHOICE per connection type (contract §1, Decision #6). The registry
 * is served, never hardcoded in the UI: a customer on a different CRM is not
 * stuck with whichever vendor we happened to render first.
 */
export const providerAuthKind = z.enum(['oauth', 'credential_form']);
export type ProviderAuthKind = z.infer<typeof providerAuthKind>;

/** Non-null means the connection supports the knowledge scope endpoints (§4). */
export const providerScopeKind = z.enum(['drive_folders', 'notion_pages']);
export type ProviderScopeKind = z.infer<typeof providerScopeKind>;

/** One field of a `credential_form` provider's form. `secret` is never echoed back. */
export const providerCredentialField = z.object({
  name: z.string(),
  label: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
});
export type ProviderCredentialField = z.infer<typeof providerCredentialField>;

export const providerOption = z.object({
  provider: z.string(),
  displayName: z.string(),
  authKind: providerAuthKind,
  helpText: z.string(),
  /**
   * Whether the PLATFORM holds the OAuth app credential for this provider.
   * `false` means we cannot start the flow yet — render the option DISABLED
   * rather than hiding it, so the choice stays visible (contract §1).
   */
  configured: z.boolean(),
  credentialFields: z.array(providerCredentialField),
  scopeKind: providerScopeKind.nullable(),
});
export type ProviderOption = z.infer<typeof providerOption>;

export const connectionProviders = z.object({
  connectionType,
  providers: z.array(providerOption),
});
export type ConnectionProviders = z.infer<typeof connectionProviders>;

/** `provider` omitted/null = switch ACCOUNTS within the same provider (§1). */
export const switchConnectionRequest = z.object({
  provider: z.string().nullable().optional(),
});
export type SwitchConnectionRequest = z.infer<typeof switchConnectionRequest>;

/**
 * What "hand this connection back" actually did (contract §1). The disabled
 * lists are a consequence the owner must be TOLD about at confirmation time —
 * discovering it from a failed booking is the failure mode this replaces.
 */
export const disconnectResult = z.object({
  connection,
  secretDeleted: z.boolean(),
  disabledTools: z.array(z.string()),
  disabledChannels: z.array(z.string()),
});
export type DisconnectResult = z.infer<typeof disconnectResult>;

/** Generic OAuth completion — one route for every provider/type (contract §2). */
export const oauthCallbackRequest = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type OauthCallbackRequest = z.infer<typeof oauthCallbackRequest>;

/**
 * Bind the Meta destination a `channel_auth` connection answers on (contract §2):
 * the WhatsApp `phone_number_id` or the Instagram/Messenger Page id. Inbound
 * routing resolves a tenant SOLELY by this id, so a connected channel without one
 * receives nothing.
 */
export const bindDestinationRequest = z.object({
  destination: z.string().min(1).max(128),
});
export type BindDestinationRequest = z.infer<typeof bindDestinationRequest>;

/**
 * Result of an on-demand A2P 10DLC re-verify of the BYO SMS/Voice number
 * (Arch §3.1.6). There is NO background poller: a number sitting at
 * `pending_carrier_registration` only becomes send-ready when the tenant asks
 * the platform to re-read its carrier status, after completing the Brand +
 * Campaign registration themselves (Legal §A2). Both fields are optional so a
 * backend that answers with a bare 200 does not break the caller.
 */
export const reverifySmsResult = z.object({
  status: connectionStatus.optional(),
  /** Human-readable outcome, e.g. still pending vs. what is missing. */
  statusDetail: z.string().nullable().optional(),
});
export type ReverifySmsResult = z.infer<typeof reverifySmsResult>;

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
