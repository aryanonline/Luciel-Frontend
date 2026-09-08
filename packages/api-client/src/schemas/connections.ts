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
  /**
   * Instagram messaging is its OWN grant, not a provider under `channel_auth`.
   * Facebook's dialog rejects an authorize request carrying the `instagram_*`
   * scopes outright, so Instagram runs on Business Login for Instagram — a
   * separate app, consent host and token endpoint. It needs a separate type
   * because one connection is active per type: a second `channel_auth` row
   * would evict the Facebook grant that WhatsApp and Messenger ride on.
   */
  'instagram_auth',
  'knowledge_source',
]);
export type ConnectionType = z.infer<typeof connectionType>;

export const connection = z.object({
  connectionId: uuid,
  connectionType,
  /** Open-ended provider id (e.g. google_calendar | hubspot | twilio | notion). */
  provider: z.string(),
  status: connectionStatus,
  /**
   * `ConnectionOut.providerAvailable` (Harmony wave 2, backend item 3;
   * backend_gaps.md §"Harmony wave 2", FE CONTRACT BLOCK item 3). `false`
   * means the registry cannot connect this provider today (dropped from the
   * catalog, or its platform OAuth client was never configured) — the exact
   * same truth Configure derives per-provider from
   * `/connections/providers` → `ProviderOptionOut.configured`. When `false`,
   * this row must render the non-actionable "Not available yet" chip, never
   * "Action needed", REGARDLESS of `status`. Defaults to `true` so every
   * pre-existing healthy row is unaffected.
   */
  providerAvailable: z.boolean().optional(),
  /**
   * `ConnectionOut.displayName` (Harmony wave 2, backend item 4). The
   * human-readable provider label (e.g. "Amazon SES"), sourced from the same
   * catalog `/connections/providers` serves as `ProviderOptionOut.displayName`.
   * Render THIS instead of deriving a label from the raw `provider` code
   * (closes the "Email sending · Ses" bug — `provider` stays `"ses"` on the
   * wire for API calls, `displayName` is `"Amazon SES"` for the UI).
   */
  displayName: z.string().optional(),
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
/** `provisioned` (audit F157): a platform-provisioned resource such as the CSV record source. */
export const providerAuthKind = z.enum(['oauth', 'credential_form', 'provisioned']);
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
 * Which messaging surface a grant is being pointed at (contract §2). `whatsapp`
 * and `messenger` ride the one `channel_auth` grant and `instagram` rides the
 * `instagram_auth` one; in every case each names its own asset, so binding one
 * never unbinds another.
 */
export const metaChannel = z.enum(['whatsapp', 'instagram', 'messenger']);
export type MetaChannel = z.infer<typeof metaChannel>;

/**
 * Bind the destination a messaging connection answers on (contract §2): the
 * WhatsApp `phone_number_id`, the Messenger Page id, or the Instagram
 * professional account id. Inbound routing resolves a tenant SOLELY by this id,
 * so a connected channel without one receives nothing. `channel` is omitted only
 * by the single-destination senders.
 */
export const bindDestinationRequest = z.object({
  destination: z.string().min(1).max(128),
  channel: metaChannel.optional(),
});
export type BindDestinationRequest = z.infer<typeof bindDestinationRequest>;

/**
 * The values for a `credential_form` provider's `credentialFields` (contract
 * §1a) — the customer's OWN credential, e.g. their Twilio Account SID + Auth
 * Token. Fields the registry marks `secret` go to Secrets Manager and are never
 * echoed back; the rest land in `nonSecretConfig`.
 */
export const submitCredentialsRequest = z.object({
  fields: z.record(z.string()),
});
export type SubmitCredentialsRequest = z.infer<typeof submitCredentialsRequest>;

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
 * The designate picker (C9): the numbers in the tenant's OWN Twilio account,
 * listed with the credentials already on file. `numbers: null` = listing
 * wasn't possible (no usable credential, provider refused) — the UI falls
 * back to manual E.164 entry rather than blocking the designate step.
 */
export const tenantNumber = z.object({
  phoneNumber: z.string(),
  friendlyName: z.string(),
});
export type TenantNumber = z.infer<typeof tenantNumber>;

export const tenantNumbersResult = z.object({
  numbers: z.array(tenantNumber).nullable(),
});
export type TenantNumbersResult = z.infer<typeof tenantNumbersResult>;

/**
 * One of the owner's Calendly event types (round 6 WP-H, F055). Customers book
 * exactly ONE event type; the owner picks it here. `GET /connections/{id}/calendly/
 * event-types` serves `eventTypes: null` when the account could not be read (the
 * token is unusable) — say so, never an empty picker that looks like "no types".
 */
export const calendlyEventType = z.object({
  uri: z.string(),
  name: z.string(),
  active: z.boolean(),
  durationMinutes: z.number().int(),
  schedulingUrl: z.string(),
});
export type CalendlyEventType = z.infer<typeof calendlyEventType>;

export const calendlyEventTypes = z.object({
  eventTypes: z.array(calendlyEventType).nullable(),
  chosenUri: z.string().nullable().optional(),
});
export type CalendlyEventTypes = z.infer<typeof calendlyEventTypes>;

/** `PUT /connections/{id}/settings` — provider settings that are not credentials. */
export const connectionSettingsUpdate = z.object({
  eventTypeUri: z.string().optional(),
  eventTypeName: z.string().optional(),
});
export type ConnectionSettingsUpdate = z.infer<typeof connectionSettingsUpdate>;

/**
 * Result of uploading the live-lookup CSV (record_source connection). The rows
 * REPLACE the previous table (the backend's replace-on-upload semantics) and the
 * connection flips to connected with "N records on file". Live-caught
 * 2026-08-17: this backend route existed with NO frontend caller — the tools
 * pillar told customers "CSV lives under Knowledge" while the Knowledge CSV
 * import only ingested text, so lookup_record could never be wired from the UI.
 */
export const recordSourceCsvResult = z.object({
  records: z.number().int().nonnegative(),
  columns: z.array(z.string()),
});
export type RecordSourceCsvResult = z.infer<typeof recordSourceCsvResult>;

/**
 * Email-address provisioning (Arch §3.1.6a, Decision #49). The admin provisions
 * the address Luciel SENDS AND RECEIVES on. Two platform modes, both LAUNCH
 * capabilities:
 *   own_domain   — the business's own address; requires an inbound DNS/MX routing
 *                  step, so it sits at `pending_email_routing` until verified.
 *   vm_subdomain — a zero-DNS VantageMind-subdomain fallback; live immediately.
 * Own-domain inbound is NOT a deferred limitation.
 *
 * byo_mailbox (§3.1.6a BYO email, owner decision 2026-08-10 Outlook-first) is
 * the customer's OWN Outlook mailbox connected as the sender via OAuth — not
 * provisioned here (it arrives through the email_sender connect/swap flow), but
 * reported here so the one email read answers "what address is Luciel on?" for
 * every mode. `dnsRecords` is null for it: there is nothing to publish.
 */
export const emailProvisioningMode = z.enum(['own_domain', 'vm_subdomain', 'byo_mailbox']);
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
  /**
   * own_domain only: the records the admin must add to complete inbound routing.
   * The backend serves an explicit `null` for byo_mailbox (nothing to publish),
   * so null is accepted alongside omission.
   */
  dnsRecords: z.array(dnsRecord).nullable().optional(),
});
export type EmailProvisioning = z.infer<typeof emailProvisioning>;
