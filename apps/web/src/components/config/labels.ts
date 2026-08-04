import type {
  ChannelId,
  AddonToolId,
  ConnectionStatus,
  ConnectionType,
  ConnectionProviders,
} from '@luciel/api-client';
import { chipForConnection } from '@luciel/api-client';
import type { ChipKind } from '@luciel/ui';

/** Human labels for channels (Vision §3.1). */
export const channelLabel: Record<ChannelId, string> = {
  widget: 'Website chat widget',
  email: 'Email',
  sms: 'SMS',
  voice: 'Voice',
  whatsapp: 'WhatsApp',
  // One switch, two surfaces on two separate grants — "&", not "/": the owner
  // is turning both on, and each is connected on its own below.
  instagram_messenger: 'Instagram & Messenger',
};

/** Add-on tools with one-sentence descriptions (Vision §3.2). */
export const toolMeta: Record<AddonToolId, { label: string; desc: string; connectLabel?: string }> =
  {
    check_availability: {
      label: 'Check availability',
      desc: 'Read open slots from your calendar before booking.',
      connectLabel: 'a calendar',
    },
    book_appointment: {
      label: 'Book an appointment',
      desc: 'Write a confirmed booking to your calendar (read-before-write).',
      connectLabel: 'a calendar',
    },
    reschedule_appointment: {
      label: 'Reschedule an appointment',
      desc: 'Move an existing booking to a new slot on your calendar.',
      connectLabel: 'a calendar',
    },
    cancel_appointment: {
      label: 'Cancel an appointment',
      desc: 'Cancel an existing booking on your calendar.',
      connectLabel: 'a calendar',
    },
    // Channel vs tool, in the owner's words (Decision #4): the Email channel is
    // Luciel answering people who emailed it; this tool is Luciel starting an
    // email to someone who reached out somewhere else.
    send_email: {
      label: 'Send email',
      desc: 'Luciel starts an email to a lead who reached out somewhere else, like the chat widget. The Email channel is the other half: that is Luciel replying to people who email it.',
      connectLabel: "Luciel's work email",
    },
    send_sms: {
      label: 'Send SMS',
      desc: 'Send outbound SMS from your business number.',
    },
    lookup_record: {
      label: 'Look up a record',
      desc: 'Query a live data source for an exact record.',
      connectLabel: 'your record system',
    },
    schedule_callback: {
      label: 'Schedule a callback',
      desc: 'Queue a future follow-up over a channel you already connected.',
    },
    push_to_crm: {
      label: 'Push leads to my CRM',
      desc: 'Write captured leads into your external CRM.',
      connectLabel: 'your CRM',
    },
    // NOT "Custom webhook": the served CRM registry already offers a provider by
    // that name, and the two rendered side by side under Tools with the same
    // words are different things — that one is where captured leads go INSTEAD
    // of a CRM, this one is an endpoint Luciel calls as a tool of its own. The
    // provider's name is the backend's to set (Decision #6), so the one we own
    // is the one that moves.
    bring_your_own_webhook: {
      label: 'Post to my own endpoint',
      desc: 'Luciel calls an HTTP endpoint you run, as a tool in its own right — not the webhook you can pick as the destination for captured leads.',
      connectLabel: 'your endpoint',
    },
  };

/** Maps a raw connection status → the UI chip kind (one rule, api-client). */
export function chipKind(status: ConnectionStatus | undefined): ChipKind | null {
  if (!status) return null;
  return chipForConnection(status);
}

/**
 * Human labels for `ConnectionType` — the OTHER half of a Connections row.
 * These are internal registry enum values (e.g. `sms_sender`, `channel_auth`)
 * and must never reach an owner-visible surface verbatim (Harmony fix FE-H#6):
 * a raw "Sms_sender · Twilio" reads as an engineering leak, not a product.
 * Kept alongside `channelLabel`/`toolMeta` so every pillar and every summary
 * surface (Overview included) draws from the same one word list.
 */
export const connectionTypeLabel: Record<ConnectionType, string> = {
  calendar: 'Calendar',
  crm: 'CRM',
  record_source: 'Record lookup',
  email_sender: 'Email sending',
  sms_sender: 'SMS & Voice number',
  outbound_webhook: 'Webhook',
  channel_auth: 'Meta sign-in',
  instagram_auth: 'Instagram sign-in',
  knowledge_source: 'Knowledge source',
};

/** `sms_sender` → `Sms sender`, for a connection type the map above does not name. */
function humanizeEnum(raw: string): string {
  const words = raw.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The provider's own display name, from the served registry (Decision #6) —
 * never a hardcoded vendor and never the raw provider slug. Mirrors
 * `providerName()` in consent-landing.tsx so a provider reads identically
 * everywhere it is named, including the raw slug fallback while the registry
 * is still loading or does not carry it.
 */
export function providerDisplayName(
  groups: ConnectionProviders[] | undefined,
  connectionType: ConnectionType,
  provider: string,
): string {
  const served = groups
    ?.find((group) => group.connectionType === connectionType)
    ?.providers.find((option) => option.provider === provider)?.displayName;
  return served ?? humanizeEnum(provider);
}

/**
 * Whether the served registry considers this provider actually usable today.
 * `undefined` (registry still loading, or the provider is not carried at all)
 * is treated as "not configured" — an owner-visible surface must never assume
 * actionable while honesty is unresolved (Harmony fix FE-H#7): Overview and
 * Configure read the exact same `configured` flag, so neither can call a
 * provider live while the other calls it honest-disabled.
 */
export function providerConfigured(
  groups: ConnectionProviders[] | undefined,
  connectionType: ConnectionType,
  provider: string,
): boolean {
  return (
    groups
      ?.find((group) => group.connectionType === connectionType)
      ?.providers.find((option) => option.provider === provider)?.configured === true
  );
}
