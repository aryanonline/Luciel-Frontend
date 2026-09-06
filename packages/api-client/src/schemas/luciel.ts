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
  /**
   * §3.2.2 delete-confirmation truth (C14): answers in the last 7 days that
   * drew on this source, from the durable retrieval trace. A real 0 for a
   * source no answer has used.
   */
  usedByQuestions7d: z.number().int().nonnegative().default(0),
});
export type KnowledgeSource = z.infer<typeof knowledgeSource>;

export const knowledgeChunk = z.object({
  chunkId: uuid,
  sourceId: uuid,
  ordinal: z.number().int().nonnegative(),
  text: z.string(),
});
export type KnowledgeChunk = z.infer<typeof knowledgeChunk>;

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
  /** `bouncing` means mail to this address is failing and escalations skip it. */
  state: z.enum(['unverified', 'pending_confirmation', 'verified', 'bouncing']),
  verifiedAt: isoTimestamp.nullable(),
  lastBouncedAt: isoTimestamp.nullable(),
});
export type EscalationContactHealth = z.infer<typeof escalationContactHealth>;

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
});
export type Luciel = z.infer<typeof luciel>;

export const createLucielRequest = z.object({
  name: z.string().min(1),
  websiteUrl: z.string().min(1),
  /** "In one sentence, what is your business?" (Customer Journey Phase 3). */
  businessOneLiner: z.string().min(1).max(280),
});
export type CreateLucielRequest = z.infer<typeof createLucielRequest>;
