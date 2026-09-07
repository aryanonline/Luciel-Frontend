import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/legal-page';

export const metadata: Metadata = { title: 'Terms of Service — VantageMind' };

/**
 * Terms of Service — plain-language summary, DRAFT/not-in-force (Legal Part A).
 * Mirrors the product commitments (single plan, PAYG, dunning, lifecycle,
 * single-login, SLA) WITHOUT verbatim draft clauses or bracketed placeholders.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="Draft — pending counsel"
      intro="These terms describe the commercial relationship between you (the account owner) and VantageMind. The summary below mirrors the product as documented; the binding version is finalized with counsel before launch."
      sections={[
        {
          heading: 'The plan',
          body: [
            'VantageMind is a single plan. The first 50 conversations each billing period are free. Your billing period is the calendar month until you save a card, and your card’s billing cycle from then on. Above the free 50, usage is billed pay-as-you-go at $39 per 100 conversations, rounded up to the next whole 100-conversation block, at the close of each billing period.',
            'There is no feature gating — every feature is available on every account. A payment method on file is what enables usage above the free 50; without one, the account stays capped at 50 with a graceful at-capacity reply.',
            'Your free-allowance counter resets on your billing-cycle date, not the calendar month. Unused conversations do not roll over.',
            'The free starter allowance is an ongoing feature, not a time-limited trial. We reserve the right to change it, but if we ever reduce it we will give all existing accounts at least 30 days’ notice before the change takes effect — sent by email and shown in your dashboard on your next login, so a stale email address cannot cause you to miss it. Increases need no notice.',
          ],
        },
        {
          heading: 'Channel activation — carrier and sender requirements',
          body: [
            'SMS and Voice are bring-your-own-number. You supply a phone number you already control; we never provision, pool, resell, or acquire numbers for you. The number stays yours with your own carrier, and all of its carrier costs — number rental and usage — are paid to your carrier directly. We are never in that billing path.',
            'If your number is not already carrier-registered, you complete the required A2P 10DLC Brand and Campaign registration yourself, in your own carrier account and in your business’s legal name — carrier rules require the registered sender to be the party actually messaging the consumer, which is you. We provide guidance and verify your number’s status before treating the channel as send-ready, but we do not perform, submit, or operate the registration for you, and any registration fees are yours. Until registration is complete and verified, the channel shows “Action needed: complete carrier registration” and does not send.',
            'You are responsible for the lawfulness of your opt-in and for honoring opt-out — the consent and opt-out obligations of CASL in Canada and, where applicable, the US TCPA. The platform enforces STOP and HELP handling at the channel layer, but the lawful basis for contacting any given recipient is yours as the sender. If you message only Canadian recipients, US A2P 10DLC may not apply, but Canadian carrier requirements and CASL obligations still do.',
            'Email is bring-your-own-mailbox: you connect a Microsoft 365 / Outlook mailbox you control, and your Luciel sends and receives as that mailbox under your provider’s terms. We do not send customer email on your behalf from our own infrastructure or your domain. Until a mailbox is connected and verified, the email channel shows “Action needed” and does not send. You are responsible for sending only to recipients you have a lawful basis to contact, and for list hygiene.',
          ],
        },
        {
          heading: 'Payment and failed payments',
          body: [
            'By saving a payment method you authorize us to charge it for pay-as-you-go usage at the close of each billing period. There is no recurring subscription charge — if you use 50 or fewer conversations in a billing period, there is no charge.',
            'If an end-of-cycle charge fails, your Luciel does not go offline immediately. We retry over a short grace window and notify you at each attempt. If payment still has not succeeded by the end of that window, the account gracefully reverts to free-cap behavior — it does not delete data and does not stop responding. Updating a valid card restores full capability immediately.',
          ],
        },
        {
          heading: 'Your data and your Luciel',
          body: [
            'You own your content — the knowledge you ingest, your leads’ conversations, captured lead records, and your Luciel’s outputs. We never sell it and never use it to train AI models.',
            'You can export your complete data at any time in open formats. Because this is a single-login product, the export is how you give an auditor or bookkeeper visibility — there are no team seats.',
          ],
        },
        {
          heading: 'Acceptable use',
          body: [
            'You agree not to use the platform to send spam or to contact anyone without a lawful basis or the required consent — including the consent and opt-out requirements of CASL for Canadian recipients and, where applicable, the US TCPA and carrier A2P 10DLC rules for SMS and voice. You also agree not to impersonate others, configure your Luciel to deny that it is an AI, ingest content you do not have the right to use, process regulated or special-category data the platform is not designed for, or attempt to bypass our security and abuse controls.',
            'The platform enforces a baseline AI-identity disclosure on every customer-facing channel and a recording/transcription notice on voice calls; you remain responsible for any additional disclosure or consent obligations in your jurisdiction.',
          ],
        },
        {
          heading: 'Account, deletion, and closure',
          body: [
            'A VantageMind account has a single owner and a single login. Pausing your Luciel is a reversible freeze with no charges. Deleting your Luciel removes it and everything attached to it but leaves your account open, with a 30-day window to restore it. Closing your account ends the login, email, and billing entirely, and requires the Luciel to be deleted first — an export is always offered before any destruction.',
          ],
        },
        {
          heading: 'Service levels and disclaimers',
          body: [
            'Accounts with a payment method on file are covered by a 99.9% monthly uptime target for the ability to receive and respond to messages; free-only accounts are best-effort. Planned maintenance and third-party provider outages outside our control are excluded.',
            'Your Luciel is an AI system. It is grounded in your knowledge and escalates rather than guessing when it cannot answer confidently, but no AI is infallible. You are responsible for reviewing and correcting your Luciel’s knowledge and for decisions made based on its outputs.',
          ],
        },
        {
          heading: 'Account security (current state)',
          body: [
            'Access is protected by an email-and-password credential, and you must verify your email before using the account. Multi-factor authentication is on our roadmap and is not yet available, so your account’s security depends on a strong, unique password and on protecting access to your email. We disclose this rather than leave it unstated.',
          ],
        },
      ]}
    />
  );
}
