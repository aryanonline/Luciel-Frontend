import { z } from 'zod';
import { uuid, isoTimestamp } from './common';
import { channelId, escalationSignal } from './luciel';

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

export const lead = z.object({
  leadId: uuid,
  /** Captured contact info (where available). */
  name: z.string().optional(),
  contactIdentifier: z.string().optional(),
  intent: z.string().optional(),
  state: leadState,
  lastActivityAt: isoTimestamp,
  createdAt: isoTimestamp,
});
export type Lead = z.infer<typeof lead>;

export const conversationSummary = z.object({
  sessionId: uuid,
  leadId: uuid.optional(),
  channel: channelId,
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
]);
export type MessageDeliveryDetail = z.infer<typeof messageDeliveryDetail>;

/** Result of an admin takeover reply (Arch §3.4.12, §11.5–11.7). */
export const sendMessageResult = z.object({
  message,
  delivered: z.boolean(),
  deliveryDetail: messageDeliveryDetail.nullable().optional(),
});
export type SendMessageResult = z.infer<typeof sendMessageResult>;

/** Source chunk + grounding score for answer review (Arch §3.4.13). */
export const answerEvidence = z.object({
  messageId: uuid,
  /** [0,1]; grounding floor is 0.50 uniform (Vision §3.3). */
  groundingScore: z.number().min(0).max(1),
  sourceChunks: z.array(
    z.object({
      sourceId: uuid,
      sourceName: z.string(),
      text: z.string(),
    }),
  ),
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
