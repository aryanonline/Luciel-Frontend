import { z } from 'zod';
import { uuid, isoTimestamp } from './common';
import { sessionChannelId, escalationSignal } from './luciel';

/**
 * Conversations, leads, escalation events, answer-review. Sources: Arch §3.4.9
 * (lead identity), §3.4.11 (data-subject rights / erasure), §3.4.12 (human
 * handoff / live takeover), §3.4.13 (answer grounding / source chunks),
 * §3.4.10a (prune vs archive), §3.5.2 (escalation event model).
 */

/** Live-conversation control mode (Arch §3.4.12). */
export const conversationMode = z.enum(['ai', 'human_controlled']);
export type ConversationMode = z.infer<typeof conversationMode>;

export const leadState = z.enum(['active', 'archived']);
// NOTE: there is no 'pruned' state — prune permanently deletes (Arch §3.4.10a).
export type LeadState = z.infer<typeof leadState>;

/**
 * Admin-marked business outcome (Vision §7; C14) — what conversion analytics
 * group by. Distinct from `state` (visibility lifecycle). Reversible.
 */
export const leadOutcome = z.enum(['in_progress', 'converted', 'lost']);
export type LeadOutcome = z.infer<typeof leadOutcome>;

export const lead = z.object({
  leadId: uuid,
  /** Captured contact info (where available). */
  name: z.string().optional(),
  contactIdentifier: z.string().optional(),
  /**
   * `LeadOut.email` (round 5): the lead's captured email, served alongside
   * whatever transport identifier the session carried. Nullable/optional so a
   * backend that has no email for the lead (or predates the field) parses fine.
   */
  email: z.string().nullable().optional(),
  intent: z.string().optional(),
  state: leadState,
  outcome: leadOutcome.default('in_progress'),
  lastActivityAt: isoTimestamp,
  createdAt: isoTimestamp,
  /** 2026-09-05 audit F111: the volunteered phone (E.164) beside a non-phone key. */
  phone: z.string().nullable().optional(),
  /**
   * F134: the honest CRM state of this record — 'synced' / 'failed' with the
   * non-secret reason and the time of the last successful push. Round 7 WP-3c
   * item 5: a lead nothing ever pushed is an EXPLICIT `never_attempted` whose
   * `crmDetail` is a `NeverAttemptedReason` derived from the tenant's CURRENT
   * posture, so the dashboard can offer the one-time backfill the moment a CRM
   * connects. Null only from a server that predates the state.
   */
  crmStatus: z.enum(['synced', 'failed', 'never_attempted']).nullable().optional(),
  crmDetail: z.string().nullable().optional(),
  crmPushedAt: isoTimestamp.nullable().optional(),
});
export type Lead = z.infer<typeof lead>;

/**
 * Why a lead was never pushed (`crmDetail` when `crmStatus === 'never_attempted'`;
 * backend `schemas_api.leads.NeverAttemptedReason`). `not_yet_pushed` is the
 * backfill candidate: captured before the CRM was connected.
 */
export const neverAttemptedReason = z.enum([
  'crm_not_connected',
  'dormant',
  'tool_off',
  'no_crm_key',
  'not_yet_pushed',
]);
export type NeverAttemptedReason = z.infer<typeof neverAttemptedReason>;

/**
 * PATCH /dashboard/leads/{id} (round 7 WP-3c item 6): the owner's correction of a
 * lead's own facts. An omitted field is left alone; an explicit `null` clears it.
 * The server normalises email (case-folded) and phone (E.164), refuses a phone it
 * cannot read as E.164 and a malformed email with `validation_error`, and answers
 * `conflict` when another lead already owns the value — never a silent merge.
 */
export const leadPatchRequest = z.object({
  name: z.string().max(255).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
});
export type LeadPatchRequest = z.infer<typeof leadPatchRequest>;

/**
 * POST /dashboard/leads/crm-backfill (round 7 WP-3c item 5): what one bounded pass
 * did, in LEADS. `remaining > 0` means another call is needed; `refusedReason` is
 * set when the broker refused before reaching the CRM (nothing was attempted).
 */
export const crmBackfillResult = z.object({
  attempted: z.number().int().nonnegative(),
  synced: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skippedNoKey: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  refusedReason: z.string().nullable().optional(),
});
export type CrmBackfillResult = z.infer<typeof crmBackfillResult>;

/** Open formats only — the backend accepts no others (Legal §A7 portability). */
export const leadExportFormat = z.enum(['csv', 'json']);
export type LeadExportFormat = z.infer<typeof leadExportFormat>;

/** A lead export ready to hand to the browser as a download. */
export interface LeadExportFile {
  blob: Blob;
  filename: string;
}

export const conversationSummary = z.object({
  sessionId: uuid,
  leadId: uuid.optional(),
  /** Read-tolerant: old sessions may still carry legacy `instagram_messenger`. */
  channel: sessionChannelId,
  mode: conversationMode,
  startedAt: isoTimestamp,
  lastMessageAt: isoTimestamp,
  /** One-line cognition summary (Arch §3.4.7). */
  summary: z.string().optional(),
  /**
   * When the session ENDED (§3.4.8; round 7 WP-3b item 4). Non-null means take-over
   * and a human reply are refused with 409 `session_ended`: nothing on the
   * customer's transport is waiting on it. Optional for an older server.
   */
  endedAt: isoTimestamp.nullable().optional(),
  /**
   * Whether this session was counted against the plan's allowance (round 7 WP-3b
   * item 6). False for a session that never reached the fire-once trigger — refused
   * at cap, or lost to an outage before the first model call — so the page can
   * label an unbilled conversation instead of listing it as if it were one.
   * Optional for an older server that does not say.
   */
  countedForBilling: z.boolean().optional(),
});
export type ConversationSummary = z.infer<typeof conversationSummary>;

/**
 * What happened to a `human_agent` reply on the customer's transport, PERSISTED
 * on the row (round 7 WP-3b item 5): `delivered` = the provider accepted it;
 * `queued` = the widget serves it on its next history fetch; `failed` = nothing
 * reached the customer (`deliveryDetail` says why). Null on every other role and
 * on human replies from before the column existed — unknown is reported as
 * unknown, never as delivered.
 */
export const messageDeliveryStatus = z.enum(['delivered', 'queued', 'failed']);
export type MessageDeliveryStatus = z.infer<typeof messageDeliveryStatus>;

/**
 * Why an admin reply was not pushed. `null` when `delivered` is true.
 * `widget_poll_only` is the ONLY outcome for the widget channel — the reply is
 * persisted and the visitor picks it up on their next history fetch, so it is a
 * normal outcome, not a failure. `no_recipient` / `channel_not_provisioned` are
 * actionable: the admin needs contact details or a sender connection. The
 * backend collapses any token outside this vocabulary to `send_failed`.
 */
export const messageDeliveryDetail = z.enum([
  'widget_poll_only',
  'no_recipient',
  'channel_not_provisioned',
  'unsupported_channel',
  'send_failed',
  // 2026-09-05 audit: a voice takeover reply reaches the caller as a TEXT (F150) —
  // labelled, never silent — or cannot because SMS is off / not attested; and the
  // senders' health gates (F070) name why nothing left.
  'voice_bridged_to_sms',
  'voice_reply_requires_sms',
  'sms_sender_not_operable',
  'email_sender_not_connected',
  'mailbox_reconnect_needed',
  // Round 7 WP-3b item 1: the lead is not known by any identifier THIS session's
  // channel can deliver to (an email-keyed record on an SMS conversation after a
  // unification). The reply is persisted, never re-routed to another channel.
  'no_recipient_for_channel',
  // Round 7 WP-3b item 7: the Meta grant that owns the surface the conversation
  // happened on is expired / errored / unbound — the owner must reconnect Meta.
  'meta_reconnect_needed',
]);
export type MessageDeliveryDetail = z.infer<typeof messageDeliveryDetail>;

export const message = z.object({
  messageId: uuid,
  role: z.enum(['lead', 'luciel', 'human_agent']),
  text: z.string(),
  at: isoTimestamp,
  /** Round 7 WP-3b item 5 — `human_agent` rows only; null elsewhere (MessageOut). */
  deliveryStatus: messageDeliveryStatus.nullable().optional(),
  deliveryDetail: messageDeliveryDetail.nullable().optional(),
  deliveredAt: isoTimestamp.nullable().optional(),
});
export type Message = z.infer<typeof message>;

/** Result of an admin takeover reply (Arch §3.4.12, §11.5–11.7). */
export const sendMessageResult = z.object({
  message,
  delivered: z.boolean(),
  deliveryDetail: messageDeliveryDetail.nullable().optional(),
});
export type SendMessageResult = z.infer<typeof sendMessageResult>;

/** `AnswerEvidenceOut.scoringStatus` (Harmony wave 2, item 6b/backend item 2c).
 *
 * `'not_applicable'` (#5c, live-caught 2026-08-23, backend migration 0051): the
 * row is a DETERMINISTIC code-composed reply — the persisted greeting, the
 * at-cap notice, an escalation ack — so scoring never applied to it. That is a
 * different truth from `'not_scored_legacy'` ("predates scoring"): a fresh
 * greeting row used to render "Not scored (before scoring existed)", a temporal
 * claim that was false for a row minutes old. Unscored rows persisted before
 * the backend marker existed honestly keep `'not_scored_legacy'`. */
export const scoringStatus = z.enum(['scored', 'not_scored_legacy', 'not_applicable']);
export type ScoringStatus = z.infer<typeof scoringStatus>;

/** `AnswerEvidenceOut.attributionStatus` (Harmony wave 2, item 6b/backend item 2a) — a
 * 3-state enum, NOT a boolean: `no_sources_retrieved` (honest empty result) and
 * `attribution_unavailable` (never captured) are different claims that both
 * happen to carry an empty `sourceChunks`. */
export const attributionStatus = z.enum([
  'has_sources',
  'no_sources_retrieved',
  'attribution_unavailable',
  // 2026-09-06 E2E walk: retrieval never RAN for this turn (the embedding provider
  // failed) — a fourth truth. Render "couldn't be searched", never "no source".
  'retrieval_unavailable',
]);
export type AttributionStatus = z.infer<typeof attributionStatus>;

/**
 * Source chunk + grounding score for answer review (Arch §3.4.13).
 *
 * `scoringStatus` and `attributionStatus` (Harmony wave 2, backend contract
 * `backend_gaps.md` §"Harmony wave 2", FE CONTRACT BLOCK) distinguish
 * backend-honest "nothing to show" states from the numbers/copy they would
 * otherwise be confused with — `sourceChunks.length === 0` is NEVER on its own
 * sufficient to decide the copy; always branch on `attributionStatus` first:
 *
 *  - `scoringStatus: 'not_scored_legacy'`: `groundingScore` is `null` (never
 *    the old 0.50 floor constant — that fallback was the item-2c bug itself).
 *    Render "Not scored (before scoring existed)", never a number.
 *  - `attributionStatus: 'no_sources_retrieved'`: `sourceChunks` is `[]` and
 *    this is an HONEST empty result — retrieval genuinely ran and found
 *    nothing. The ONLY state where "No knowledge source backed this answer"
 *    is a true statement.
 *  - `attributionStatus: 'attribution_unavailable'`: `sourceChunks` is also
 *    `[]`, but attribution was simply never captured (legacy rows, or any
 *    reply path with no attribution seam bound). Must render "Source
 *    attribution isn't available yet" — never "No knowledge source backed
 *    this answer" (that false claim was the live item-2a bug: a verbatim
 *    KB-backed reply scored 0.36 showed "no source").
 *  - `attributionStatus: 'retrieval_unavailable'`: `sourceChunks` is `[]` because
 *    the knowledge base could not be SEARCHED for this turn (embedding provider
 *    failure — 2026-09-06 E2E walk, OpenAI 429 at quota). Luciel handed off
 *    rather than guess; render "couldn't be searched", never "no source".
 */
export const answerEvidence = z.object({
  messageId: uuid,
  /** [0,1] when scored; `null` for `scoringStatus: 'not_scored_legacy'` rows. */
  groundingScore: z.number().min(0).max(1).nullable(),
  scoringStatus,
  sourceChunks: z.array(
    z.object({
      sourceId: uuid,
      sourceName: z.string(),
      text: z.string(),
    }),
  ),
  attributionStatus,
  flaggedByAdmin: z.boolean(),
});
export type AnswerEvidence = z.infer<typeof answerEvidence>;

/** Escalation event row (Arch §3.5.2). Includes server-only signals too. */
export const escalationEventSignal = z.enum([
  ...escalationSignal.options,
  'budget_exhausted',
  'llm_unavailable',
]);
export type EscalationEventSignal = z.infer<typeof escalationEventSignal>;

export const escalationEvent = z.object({
  escalationId: uuid,
  sessionId: uuid,
  leadId: uuid.optional(),
  signal: escalationEventSignal,
  gate: z.enum(['intake', 'outcome']),
  firedAt: isoTimestamp,
  scoreOrConfidence: z.number().min(0).max(1).optional(),
  /** Why it fired, in short owner-facing phrases (round 6 WP-G, F124); [] on older rows. */
  reasons: z.array(z.string()).optional(),
});
export type EscalationEvent = z.infer<typeof escalationEvent>;
