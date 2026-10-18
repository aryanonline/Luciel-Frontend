import { z } from 'zod';
import { uuid, isoTimestamp, connectionStatus } from './common';
import { connectionType } from './connections';

/**
 * The Luciel instance + the five configuration pillars (Vision §3). Five
 * dropdown-driven surfaces; there is NO sixth "Connections" pillar — the
 * connect step is inline within the pillar that owns it (Vision §3, Arch §3.8.1).
 */

/** Luciel lifecycle states — Arch §3.6.1 (verbatim). */
export const lucielState = z.enum([
  'active',
  'paused',
  'luciel_grace_window',
  'luciel_hard_deleted',
]);
export type LucielState = z.infer<typeof lucielState>;

// --- Channels (Vision §3.1) ---------------------------------------------------
/**
 * The seven configurable channels (Arch §3.1.2). WhatsApp, Messenger and
 * Instagram are SEPARATE channels: one shared Meta sign-in powers WhatsApp and
 * Messenger, Instagram signs in on Business Login for Instagram, and each row
 * still binds its own destination id before it is Connected.
 */
export const channelId = z.enum([
  'widget',
  'email',
  'sms',
  'voice',
  'whatsapp',
  'messenger',
  'instagram',
]);
export type ChannelId = z.infer<typeof channelId>;

/**
 * A channel as read off a SESSION row. Old conversations can still carry the
 * retired combined `instagram_messenger` id; it is read-tolerated for display
 * only and is never a configurable channel — the config enum above stays
 * strict.
 */
export const sessionChannelId = z.union([channelId, z.literal('instagram_messenger')]);
export type SessionChannelId = z.infer<typeof sessionChannelId>;

export const channelConfig = z.object({
  id: channelId,
  enabled: z.boolean(),
  /** Connection backing this channel where one exists (sms_sender, channel_auth). */
  connectionStatus: connectionStatus.optional(),
  /** Voice requires the one-time consent-ack modal before activation (Arch §3.1.2). */
  voiceConsentAcknowledgedAt: isoTimestamp.optional(),
  /**
   * SMS requires an A2P 10DLC / sender-of-record / STOP-HELP / CASL-TCPA
   * acknowledgment before activation (Legal §A2, §A6). Optional and read-only
   * here: when the backend starts stamping it the acknowledgment becomes
   * durable, and until then the UI gates on it per session.
   */
  smsComplianceAcknowledgedAt: isoTimestamp.optional(),
});
export type ChannelConfig = z.infer<typeof channelConfig>;

// --- Tools (Vision §3.2) ------------------------------------------------------
/** Always-on cognition band — non-interactive, no toggles (Customer Journey §4.2). */
export const builtinCognition = z.enum(['capture_leads', 'escalate', 'handoff', 'summarize']);
export type BuiltinCognition = z.infer<typeof builtinCognition>;

export const addonToolId = z.enum([
  'check_availability',
  'book_appointment',
  // Move/cancel a booking Luciel already made (Decision #8). Read-before-write,
  // so they can come back `ambiguous` with candidates rather than guessing.
  'reschedule_appointment',
  'cancel_appointment',
  'send_email',
  'send_sms',
  'lookup_record',
  'schedule_callback',
  'push_to_crm',
  'bring_your_own_webhook',
]);
export type AddonToolId = z.infer<typeof addonToolId>;

export const addonTool = z.object({
  id: addonToolId,
  enabled: z.boolean(),
  /** Second gate: tool usable only when enabled AND connection healthy (Arch §3.8.7). */
  connectionStatus: connectionStatus.optional(),
  /**
   * Why the server is holding this tool off, e.g. `connection_disconnected:calendar`.
   * SERVER-DERIVED and read-only — accepted and ignored on PUT so a client can send
   * back a list it just read (contract §3).
   */
  disabledReason: z.string().nullable().optional(),
});
export type AddonTool = z.infer<typeof addonTool>;

/**
 * One owner-facing capability rolling several tool ids up (contract §3,
 * Decision #8). Read-before-write is an internal mechanic, not two toggles, so
 * "Appointment scheduling" is ONE control with ONE connect affordance for its
 * `connectionType`. The member list is SERVED, never baked into the UI: that is
 * how `reschedule_appointment` / `cancel_appointment` appear without a frontend
 * change. Tools named by no group keep their individual toggles.
 */
export const capabilityGroup = z.object({
  capability: z.string(),
  label: z.string(),
  helpText: z.string(),
  toolIds: z.array(addonToolId),
  /** The single connection the whole group is gated on; null = needs none. */
  connectionType: connectionType.nullable(),
});
export type CapabilityGroup = z.infer<typeof capabilityGroup>;

// --- Knowledge (Vision §3.3, Arch §3.2) --------------------------------------
export const knowledgeSourceOrigin = z.enum([
  'upload',
  'paste',
  'csv',
  'website_crawl',
  'google_drive',
  'notion',
  'crm_kb',
]);
export type KnowledgeSourceOrigin = z.infer<typeof knowledgeSourceOrigin>;

// Arch §3.2.3 sync_status vocabulary. paused_reconnect_needed replaces the former
// needs_reconnect; error surfaces non-revocation sync failures (audit Axis4-F02).
export const knowledgeSyncStatus = z.enum([
  'synced',
  'syncing',
  'paused_reconnect_needed',
  'error',
]);
export type KnowledgeSyncStatus = z.infer<typeof knowledgeSyncStatus>;

export const knowledgeSource = z.object({
  sourceId: uuid,
  name: z.string(),
  origin: knowledgeSourceOrigin,
  ingestionStatus: z.enum(['pending', 'ready', 'error']),
  sizeBytes: z.number().int().nonnegative(),
  lastUpdatedAt: isoTimestamp,
  /** Live-sync sources only (Arch §3.2.3). */
  lastSyncedAt: isoTimestamp.optional(),
  syncStatus: knowledgeSyncStatus.optional(),
  /** The sync connection a live source belongs to (2026-09-05 audit F107). */
  connectionId: uuid.nullable().optional(),
  /**
   * §3.2.2 delete-confirmation truth (C14): answers in the last 7 days that
   * drew on this source, from the durable retrieval trace. A real 0 for a
   * source no answer has used.
   */
  usedByQuestions7d: z.number().int().nonnegative().default(0),
  /**
   * Round 7 WP-4c #5 (owner decision D10): when a revoked/expired grant paused this
   * source. It keeps answering for `KNOWLEDGE_PAUSED_SERVING_DAYS` from this
   * instant, then stops until the connection is reconnected
   * (knowledge/service.py `stops_serving_at`). NOT SERVED by KnowledgeSourceOut at
   * backend 5de5cf6 — the column is `knowledge_sources.paused_since` and this is its
   * WireModel camelization; optional so today's wire parses and the UI falls back
   * to "paused — reconnect needed" without a date.
   */
  pausedSince: isoTimestamp.nullable().optional(),
  /**
   * Who tombstoned the source (round 7 WP-4c #9; `knowledge_sources.deleted_by`):
   * `owner` (undo-able for 30 days), `origin` (gone at Drive/Notion/the site — never
   * restorable here), `lifecycle` (comes back with the Luciel). NOT SERVED at
   * 5de5cf6 (the list omits tombstones); the served truth today is the restore
   * route's 409 and the re-sync's 404, which the UI renders verbatim.
   */
  deletedBy: z.enum(['owner', 'origin', 'lifecycle']).nullable().optional(),
});
export type KnowledgeSource = z.infer<typeof knowledgeSource>;

/** D10: a source paused for reconnect keeps answering this many days (PAUSED_SERVING_DAYS). */
export const KNOWLEDGE_PAUSED_SERVING_DAYS = 7;

export const knowledgeChunk = z.object({
  chunkId: uuid,
  sourceId: uuid,
  ordinal: z.number().int().nonnegative(),
  text: z.string(),
});
export type KnowledgeChunk = z.infer<typeof knowledgeChunk>;

/**
 * GET /admin/knowledge/sources/{id}/chunks (round 7 WP-4c #6; KnowledgeChunkPageOut):
 * the first page of a source's chunks WITH the real count. The bare list it used to
 * return made the preview say "first 20 of 20" for a source with 300 pieces.
 * `totalChunks`/`pageSize` are null only for an older server's bare list — the
 * count is then unknown, never the page length.
 */
export const knowledgeChunkPage = z.object({
  chunks: z.array(knowledgeChunk),
  totalChunks: z.number().int().nonnegative().nullable(),
  pageSize: z.number().int().positive().nullable(),
});
export type KnowledgeChunkPage = z.infer<typeof knowledgeChunkPage>;

/** 5 GB total, 50 MB per file — single quota (Vision §3.3). */
export const knowledgeQuota = z.object({
  usedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int(), // 5 GB
  perFileMaxBytes: z.number().int(), // 50 MB
});
export type KnowledgeQuota = z.infer<typeof knowledgeQuota>;

/** Pasted-text ingest body (Arch §3.2.2 "paste text"). */
export const pasteTextRequest = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
});
export type PasteTextRequest = z.infer<typeof pasteTextRequest>;

/**
 * Live-sync connectors (Arch §3.2.3). The provider is the concrete brand;
 * hubspot/salesforce both land on the `crm_kb` source origin. `website_crawl`
 * needs no authorization — it is an httpx fetch target, so it is created
 * already connected.
 */
export const knowledgeSyncProvider = z.enum([
  'google_drive',
  'notion',
  'hubspot',
  'salesforce',
  'website_crawl',
]);
export type KnowledgeSyncProvider = z.infer<typeof knowledgeSyncProvider>;

export const knowledgeSyncConnection = z.object({
  connectionId: uuid,
  provider: knowledgeSyncProvider,
  status: connectionStatus,
  /** Carries `authorize_url` (real provider consent URL) while a connect is pending. */
  nonSecretConfig: z.record(z.unknown()).optional(),
  /** A detail beginning "Action needed:" means do not redirect — show it instead. */
  statusDetail: z.string().nullable().optional(),
});
export type KnowledgeSyncConnection = z.infer<typeof knowledgeSyncConnection>;

/**
 * Knowledge scope (Decision #9) — WHICH folders (Drive) or pages/databases
 * (Notion) Luciel may read. Stored as a pointer on the connection's
 * nonSecretConfig: ids + display names only, never credential material.
 */
export const knowledgeScopeKind = z.enum(['drive_folders', 'notion_pages']);
export type KnowledgeScopeKind = z.infer<typeof knowledgeScopeKind>;

export const scopeCandidate = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['folder', 'page', 'database']),
});
export type ScopeCandidate = z.infer<typeof scopeCandidate>;

/** One selection. `name` is display-only and falls back to the id server-side. */
export const scopeSelection = z.object({
  id: z.string(),
  name: z.string().optional(),
  /** Server echo on read ('selected'); not meaningful on write. */
  kind: z.string().optional(),
});
export type ScopeSelection = z.infer<typeof scopeSelection>;

/**
 * `wholeAccount: true` is the DEFAULT and means Luciel reads the WHOLE connected
 * account — it must never be rendered as "nothing selected, so nothing is read".
 * `scopeKind: null` means the provider has no selectable scope: hide the picker.
 */
export const knowledgeScope = z.object({
  connectionId: uuid,
  provider: knowledgeSyncProvider,
  scopeKind: knowledgeScopeKind.nullable(),
  selections: z.array(scopeSelection),
  wholeAccount: z.boolean(),
});
export type KnowledgeScope = z.infer<typeof knowledgeScope>;

/** External ids reconciled by one sync/crawl run (Arch §3.2.3). */
export const knowledgeSyncResult = z.object({
  added: z.array(z.string()),
  updated: z.array(z.string()),
  removed: z.array(z.string()),
});
export type KnowledgeSyncResult = z.infer<typeof knowledgeSyncResult>;

// --- Escalation (Vision §3.4) -------------------------------------------------
/** The four signals are FIXED — never admin toggles (Vision §3.4, Arch §3.4.5). */
export const escalationSignal = z.enum([
  'explicit_human_request',
  'strong_negative_sentiment',
  'cannot_answer',
  'high_value_lead',
]);
export type EscalationSignal = z.infer<typeof escalationSignal>;

export const notificationChannel = z.enum(['email', 'sms']);
export type NotificationChannel = z.infer<typeof notificationChannel>;

export const escalationContact = z.object({
  primaryEmail: z.string().email().optional(),
  primarySms: z.string().optional(),
  secondaryEmail: z.string().email().optional(),
  secondarySms: z.string().optional(),
  preferredChannel: notificationChannel.optional(),
  /** Per-signal routing: only who/how is editable, never the trigger (Vision §3.4). */
  routing: z
    .array(
      z.object({
        signal: escalationSignal,
        channel: notificationChannel,
        ccOwnerEmail: z.boolean().optional(),
      }),
    )
    .optional(),
});
export type EscalationContact = z.infer<typeof escalationContact>;

/**
 * POST /admin/luciel/escalation/test-sms (2026-09-05 audit F084): which saved SMS
 * contact to text, and whether the tenant's own number could deliver it. `detail`
 * is the outbound delivery vocabulary (`channel_not_provisioned`,
 * `sms_sender_not_operable`, …) when it could not.
 */
export const testSmsWhich = z.enum(['primary', 'secondary']);
export type TestSmsWhich = z.infer<typeof testSmsWhich>;
export const testSmsResult = z.object({
  delivered: z.boolean(),
  detail: z.string().nullable().optional(),
});
export type TestSmsResult = z.infer<typeof testSmsResult>;

// --- Personality (Vision §3.5) ------------------------------------------------
export const personalityPreset = z.enum([
  'warm_concierge',
  'professional_advisor',
  'friendly_expert',
  'trusted_authority',
  'custom',
]);
export type PersonalityPreset = z.infer<typeof personalityPreset>;

export const personalityConfig = z.object({
  preset: personalityPreset,
  /** Custom exposes the four axes (Vision §3.5). */
  axes: z
    .object({
      tone: z.number().min(0).max(1),
      verbosity: z.number().min(0).max(1),
      formality: z.number().min(0).max(1),
      pace: z.number().min(0).max(1),
    })
    .optional(),
  /** The single free-text input — capped at 280 chars (Vision §3.5). */
  businessContext: z.string().max(280).optional(),
  /**
   * Phrases that mean a hot lead for THIS business (round 6 WP-G, F102): the one
   * admin input to the fixed high-value-lead signal. At most 20, each ≤ 60 chars.
   */
  highValueSignals: z.array(z.string().max(60)).max(20).optional(),
  // NOTE: no model selection field anywhere — never exposed (Arch §3.4.3).
});
export type PersonalityConfig = z.infer<typeof personalityConfig>;

/**
 * Per-address deliverability truth for the configured escalation email
 * contacts (round 5B item 13). Served as a SIBLING of the editable escalation
 * blob — the pillar PUT is a strict full-replace, so server-owned state never
 * rides inside the object the frontend echoes back.
 */
export const escalationContactHealth = z.object({
  address: z.string(),
  /**
   * `bouncing` means mail to this address is failing and escalations skip it. For an
   * SMS contact (round 7 WP-4b): `pending_confirmation` = a live 6-digit code is out,
   * `unverified` = no live code (never sent, or it expired), `verified` = answered.
   * Until an SMS contact is confirmed, the OWNER is copied on every page to it
   * (escalation_dispatch `_proven`).
   */
  state: z.enum(['unverified', 'pending_confirmation', 'verified', 'bouncing']),
  verifiedAt: isoTimestamp.nullable(),
  lastBouncedAt: isoTimestamp.nullable(),
  /**
   * Round 7 WP-4b: the list covers SMS contacts and the after-hours contact too.
   * `channel` email | sms (absent from an older server = email); `role` primary |
   * secondary | after_hours.
   */
  channel: z.enum(['email', 'sms']).optional(),
  role: z.enum(['primary', 'secondary', 'after_hours']).nullable().optional(),
  /**
   * An honest refusal, code-shaped: `sms_channel_not_provisioned` (no number is
   * connected to send the confirmation code from); for a bouncing email, the
   * provider's bounce detail.
   */
  detail: z.string().nullable().optional(),
});
export type EscalationContactHealth = z.infer<typeof escalationContactHealth>;

/**
 * What a code entry did (round 7 WP-4b; contact_confirmation.confirm_sms_code). The
 * vocabulary is the server's; an unknown word is still rendered honestly.
 */
export const confirmSmsOutcome = z.enum([
  'confirmed',
  'already_confirmed',
  'wrong_code',
  'locked',
  'expired',
  'no_pending',
]);
export type ConfirmSmsOutcome = z.infer<typeof confirmSmsOutcome>;

/**
 * POST /admin/luciel/escalation/contacts/confirm-sms body — mirrors the backend's
 * StrictWireModel (`number` 3–32 chars, `code` exactly six digits).
 */
export const confirmSmsContactRequest = z.object({
  number: z.string().min(3).max(32),
  code: z.string().regex(/^[0-9]{6}$/, 'Enter the 6-digit code.'),
});
export type ConfirmSmsContactRequest = z.infer<typeof confirmSmsContactRequest>;

// --- Team availability (round 6 WP-E, audit F054) -------------------------------
/**
 * One weekly window the HUMAN team is reachable: `day` 0=Monday … 6=Sunday, 24-hour
 * HH:MM local times; an end before the start wraps past midnight.
 */
export const teamWindow = z.object({
  day: z.number().int().min(0).max(6),
  start: z.string(),
  end: z.string(),
});
export type TeamWindow = z.infer<typeof teamWindow>;

export const teamClosure = z.object({
  date: z.string(),
  label: z.string().nullable().optional(),
});
export type TeamClosure = z.infer<typeof teamClosure>;

/** Who an escalation reaches while the team is unreachable (routing only). */
export const afterHoursEscalation = z.object({
  channel: notificationChannel.nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  contactSms: z.string().nullable().optional(),
  ccOwnerEmail: z.boolean().nullable().optional(),
});
export type AfterHoursEscalation = z.infer<typeof afterHoursEscalation>;

/**
 * When the owner's PEOPLE are reachable — never Luciel's hours. Luciel answers
 * around the clock regardless; this only shapes the follow-up promise in a hand-off
 * and where an after-hours escalation goes. `enabled` false keeps the generic
 * behaviour while the grid is remembered.
 */
export const teamAvailability = z.object({
  enabled: z.boolean().default(false),
  weekly: z.array(teamWindow).default([]),
  closures: z.array(teamClosure).default([]),
  afterHours: z
    .object({ escalation: afterHoursEscalation.nullable().optional() })
    .nullable()
    .optional(),
});
export type TeamAvailability = z.infer<typeof teamAvailability>;

/** PUT body: the setting plus the owner's IANA timezone (required when enabled). */
export const teamAvailabilityUpdate = teamAvailability.extend({
  timezone: z.string().nullable().optional(),
});
export type TeamAvailabilityUpdate = z.input<typeof teamAvailabilityUpdate>;

// --- The Luciel instance ------------------------------------------------------
export const luciel = z.object({
  instanceId: uuid,
  name: z.string(),
  websiteUrl: z.string(),
  state: lucielState,
  /** Embed key is per-instance; the widget receives it via host data-key, never hardcoded. */
  embedKeyPublicId: z.string().optional(),
  channels: z.array(channelConfig),
  tools: z.array(addonTool),
  escalation: escalationContact,
  /** Round 5B item 13: server-owned confirmation/bounce state per email contact. */
  escalationContactHealth: z.array(escalationContactHealth).default([]),
  personality: personalityConfig,
  /** Grace window stamp when state = luciel_grace_window (Arch §3.6.4). */
  graceWindowStartedAt: isoTimestamp.optional(),
  /**
   * The Admin's opt-in lead auto-prune window in days; null = off, which is the
   * default and the only value the platform assumes for them (Arch §3.4.10a,
   * Legal §B5). Backend rejects anything below 1.
   */
  leadRetentionDays: z.number().int().min(1).nullable(),
  /**
   * The website origins the widget may load on (round 6 WP-I, audit F066):
   * `scheme://host[:port]` strings, at most ten. null = any page, which is what
   * every Luciel has until its owner narrows it. Additive/optional for older
   * servers.
   */
  allowedOrigins: z.array(z.string()).nullable().optional(),
  /** The owner's IANA timezone (round 6 WP-E); null until they set it. */
  timezone: z.string().nullable().optional(),
  /** When the human team is reachable (round 6 WP-E); null = never described. */
  teamAvailability: teamAvailability.nullable().optional(),
  /** What Luciel calls the business in greetings (round 6 WP-F); null = "this business". */
  businessShortName: z.string().nullable().optional(),
  /** The morning brief opt-out (round 6 WP-F); on by default. */
  dailyBriefEnabled: z.boolean().optional(),
});
export type Luciel = z.infer<typeof luciel>;

/** The confirm-sms answer: the outcome word and the Luciel with its fresh contact health. */
export const confirmSmsContactResult = z.object({
  outcome: z.string(),
  luciel,
});
export type ConfirmSmsContactResult = z.infer<typeof confirmSmsContactResult>;

export const createLucielRequest = z.object({
  name: z.string().min(1),
  websiteUrl: z.string().min(1),
  /** "In one sentence, what is your business?" (Customer Journey Phase 3). */
  businessOneLiner: z.string().min(1).max(280),
});
export type CreateLucielRequest = z.infer<typeof createLucielRequest>;
