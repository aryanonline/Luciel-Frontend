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
});
export type Lead = z.infer<typeof lead>;

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
});
export type ConversationSummary = z.infer<typeof conversationSummary>;

export const message = z.object({
  messageId: uuid,
  role: z.enum(['lead', 'luciel', 'human_agent']),
  text: z.string(),
  at: isoTimestamp,
});
export type Message = z.infer<typeof message>;

/**
 * Why an admin reply was not pushed. `null` when `delivered` is true.
 * `widget_poll_only` is the ONLY outcome for the widget channel — the reply is
 * persisted and the visitor picks it up on their next history fetch, so it is a
 * normal outcome, not a failure. `no_recipient` / `channel_not_provisioned` are
 * actionable: the admin needs contact details or a sender connection.
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
]);
export type MessageDeliveryDetail = z.infer<typeof messageDeliveryDetail>;

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
});
export type EscalationEvent = z.infer<typeof escalationEvent>;
