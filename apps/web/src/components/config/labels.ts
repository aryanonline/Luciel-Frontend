import type { ChannelId, AddonToolId, ConnectionStatus } from '@luciel/api-client';
import { chipForConnection } from '@luciel/api-client';
import type { ChipKind } from '@luciel/ui';

/** Human labels for channels (Vision §3.1). */
export const channelLabel: Record<ChannelId, string> = {
  widget: 'Website chat widget',
  email: 'Email',
  sms: 'SMS',
  voice: 'Voice',
  whatsapp: 'WhatsApp',
  instagram_messenger: 'Instagram / Messenger',
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
    send_email: {
      label: 'Send email',
      desc: 'Send outbound email on behalf of your business.',
      connectLabel: 'a sender identity',
    },
    send_sms: {
      label: 'Send SMS',
      desc: 'Send outbound SMS from your dedicated number.',
    },
    lookup_record: {
      label: 'Look up a record',
      desc: 'Query a live data source for an exact record.',
      connectLabel: 'a record/data source',
    },
    schedule_callback: {
      label: 'Schedule a callback',
      desc: 'Queue a future follow-up over a channel you already connected.',
    },
    push_to_crm: {
      label: 'Push leads to my CRM',
      desc: 'Write captured leads into your external CRM.',
      connectLabel: 'a CRM',
    },
    bring_your_own_webhook: {
      label: 'Custom webhook',
      desc: 'Register your own HTTP endpoint as a tool.',
      connectLabel: 'a webhook',
    },
  };

/** Maps a raw connection status → the UI chip kind (one rule, api-client). */
export function chipKind(status: ConnectionStatus | undefined): ChipKind | null {
  if (!status) return null;
  return chipForConnection(status);
}
