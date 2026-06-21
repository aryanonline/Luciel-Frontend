import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/legal-page';

export const metadata: Metadata = { title: 'Privacy Policy — VantageMind' };

/** Privacy Policy — published copy (mirrors Legal Part B + the four canonical docs). */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="June 21, 2026"
      intro="This Privacy Policy explains how VantageMind handles personal information. For your end customers’ (leads’) data you are the controller and we are the processor, acting on your instructions; the processing terms are in our Data Processing Addendum."
      sections={[
        {
          heading: 'What we collect',
          body: [
            'Admin data: your name, email, business details, and billing information (billing is handled by Stripe; we do not store full card numbers).',
            'Customer content: the knowledge you ingest, your leads’ conversations across enabled channels, captured lead records, and your Luciel’s outputs.',
            'Operational metadata: conversation counts, channel mix, performance metrics, and audit-log events, used to operate, secure, and bill the platform. Identifiers are minimized and hashed in logs where they appear.',
          ],
        },
        {
          heading: 'How we use it — and what we never do',
          body: [
            'We use it to provide and operate the platform (including AI inference to generate responses), to bill you, to secure the platform, and to support you.',
            'We do not sell personal information, and we do not use your content to train AI models — neither ours nor our providers’. Your Luciel improves over time only from your own knowledge and the memory of past conversations, never from training on them.',
          ],
        },
        {
          heading: 'Data residency',
          body: [
            'Your data is resident in a disclosed region and is never silently relocated. For the current offering that region is AWS Canada Central (ca-central-1), with no cross-region replication of customer data. AI inference calls transit to our model providers under zero-retention, no-training terms — that step stores nothing.',
          ],
        },
        {
          heading: 'Retention and deletion',
          body: [
            'Conversation transcripts, session summaries, and the audit log are each retained for one year, then permanently deleted. Deletion is deterministic and logged, never at an AI’s discretion.',
            'Captured lead records are your business data: they are exportable and are not auto-deleted on a timer. You control their lifecycle with prune (permanent delete) and archive (kept in cheaper storage). An incomplete signup that is never email-verified is purged after a short window.',
          ],
        },
        {
          heading: 'Sub-processors',
          body: [
            'We rely on a published, versioned register of sub-processors: Amazon Web Services (hosting, storage, database, cache, secrets, logging); Anthropic (primary LLM inference, zero-retention/no-training); OpenAI (fallback LLM inference and, when Voice is enabled, Whisper speech-to-text — zero-retention/no-training); Twilio (SMS and voice transport); AWS SES (email transport); Meta (WhatsApp, Instagram, and Messenger channels); ElevenLabs (voice text-to-speech when Voice is enabled); and Stripe (billing only — we never store full card numbers).',
            'We give at least 30 days’ advance notice before adding a sub-processor that would process your leads’ personal data, during which you may object.',
          ],
        },
        {
          heading: 'Security and breach notification',
          body: [
            'We protect personal information with three-layer tenant isolation, encryption at rest and in transit, managed secrets with a rotation policy, an append-only tamper-evident audit log, and a no-standing-internal-access policy for staff. No system is perfectly secure, but these are real, named controls.',
            'If we confirm a breach involving your data, we will notify affected account owners within 72 hours of confirmation.',
          ],
        },
        {
          heading: 'Your rights and your leads’ rights',
          body: [
            'You may access, correct, export, or delete your admin data, subject to legitimate retention such as billing records. Your leads have data-subject rights (access and erasure); because you are the controller of their data, the platform gives you a per-lead erasure action and export to honor those requests.',
          ],
        },
        {
          heading: 'SMS and messaging terms',
          body: [
            'When an Admin enables the SMS channel, VantageMind (via our messaging carrier, Twilio) sends and receives text messages with that Admin’s leads on the Admin’s behalf. Leads opt in to messaging by initiating or continuing a conversation with the Admin’s business; messages are conversational and may recur as the conversation continues.',
            'Message frequency varies by conversation. Msg & data rates may apply. Reply STOP to any message to opt out and stop further messages; reply HELP for help. Opting out is honored at the carrier level.',
            'We do not sell or share mobile information or SMS opt-in data with third parties for their own marketing. SMS sender registration (A2P 10DLC) is completed per business before live sending; until a business’s registration is carrier-approved, its SMS channel shows as pending and cannot send.',
            'SMS carrier-network transport is not end-to-end encrypted — this is the nature of the SMS protocol, and we state it plainly rather than overclaim. The VantageMind-to-carrier API leg is TLS-protected.',
          ],
        },
      ]}
    />
  );
}
