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
            'VantageMind is a single plan. The first 50 conversations each month are free. Above that, usage is billed pay-as-you-go at $39 per 100 conversations, rounded up to the next whole 100-conversation block, billed monthly in arrears.',
            'There is no feature gating — every feature is available on every account. A payment method on file is what enables usage above the free 50; without one, the account stays capped at 50 with a graceful at-capacity reply.',
            'Your free-allowance counter resets on your billing-cycle date, not the calendar month. Unused conversations do not roll over.',
          ],
        },
        {
          heading: 'Payment and failed payments',
          body: [
            'By saving a payment method you authorize us to charge it for pay-as-you-go usage at the close of each billing cycle. There is no recurring subscription charge — if you use 50 or fewer conversations in a month, there is no charge.',
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
            'You agree not to use the platform to send spam, impersonate others, configure your Luciel to deny that it is an AI, ingest content you do not have the right to use, process regulated or special-category data the platform is not designed for, or attempt to bypass our security and abuse controls.',
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
