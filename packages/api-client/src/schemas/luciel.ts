import { z } from 'zod';
import { uuid, isoTimestamp, connectionStatus } from './common';

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
export const channelId = z.enum([
  'widget',
  'email',
  'sms',
  'voice',
  'whatsapp',
  'instagram_messenger',
]);
export type ChannelId = z.infer<typeof channelId>;

export const channelConfig = z.object({
  id: channelId,
  enabled: z.boolean(),
  /** Connection backing this channel where one exists (sms_sender, channel_auth). */
  connectionStatus: connectionStatus.optional(),
  /** Voice requires the one-time consent-ack modal before activation (Arch §3.1.2). */
  voiceConsentAcknowledgedAt: isoTimestamp.optional(),
});
export type ChannelConfig = z.infer<typeof channelConfig>;

// --- Tools (Vision §3.2) ------------------------------------------------------
/** Always-on cognition band — non-interactive, no toggles (Customer Journey §4.2). */
export const builtinCognition = z.enum(['capture_leads', 'escalate', 'handoff', 'summarize']);
export type BuiltinCognition = z.infer<typeof builtinCognition>;

export const addonToolId = z.enum([
  'check_availability',
  'book_appointment',
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
});
export type AddonTool = z.infer<typeof addonTool>;

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
  personality: personalityConfig,
  /** Grace window stamp when state = luciel_grace_window (Arch §3.6.4). */
  graceWindowStartedAt: isoTimestamp.optional(),
});
export type Luciel = z.infer<typeof luciel>;

export const createLucielRequest = z.object({
  name: z.string().min(1),
  websiteUrl: z.string().min(1),
  /** "In one sentence, what is your business?" (Customer Journey Phase 3). */
  businessOneLiner: z.string().min(1).max(280),
});
export type CreateLucielRequest = z.infer<typeof createLucielRequest>;
