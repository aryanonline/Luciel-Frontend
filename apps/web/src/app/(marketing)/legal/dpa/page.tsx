import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/legal-page';

export const metadata: Metadata = { title: 'Data Processing Addendum — VantageMind' };

/** DPA — plain-language summary, DRAFT/not-in-force (Legal Part C). */
export default function DpaPage() {
  return (
    <LegalPage
      title="Data Processing Addendum"
      lastUpdated="June 21, 2026"
      intro="This addendum governs how VantageMind processes your end customers’ (leads’) personal data on your behalf. You are the controller; VantageMind is the processor, acting on your documented instructions. It forms part of the Terms of Service."
      sections={[
        {
          heading: 'Roles and instructions',
          body: [
            'You are the controller of lead personal data and VantageMind is the processor. We process that data only to provide the platform as you configure it, as you otherwise instruct in writing, and as required by law.',
            'We will not process lead personal data for our own purposes, and specifically will never use it to train any AI model.',
          ],
        },
        {
          heading: 'AI provider terms',
          body: [
            'Our AI providers process conversation content at inference time only, under zero-retention and no-training API terms — content is not stored beyond the API call and is not used to train provider models. This is the cornerstone of the no-training commitment.',
          ],
        },
        {
          heading: 'Voice recording and disclosure',
          body: [
            'Where you enable the Voice channel, the platform transcribes the caller’s speech to provide the service and plays a mandatory notice that the caller is speaking with an AI assistant and that the call may be recorded or transcribed. You cannot disable this notice. As the controller, you remain responsible for confirming the disclosure meets the consent standard of every jurisdiction in which you take calls. We log delivery of the notice so your consent posture is auditable.',
          ],
        },
        {
          heading: 'Security, sub-processors, and breach assistance',
          body: [
            'We maintain the technical and organizational measures described in our Privacy Policy — tenant isolation, encryption, access control, audit logging, abuse controls, and incident response. Personnel with potential access operate under a no-standing-access, break-glass policy.',
            'You authorize the sub-processors listed in our Privacy Policy; we give advance notice before engaging a new one that processes lead personal data. We notify you within 72 hours of confirming a breach affecting your lead data and assist with your own notification obligations.',
          ],
        },
        {
          heading: 'Data-subject requests, deletion, and transfers',
          body: [
            'We provide you the tools — per-lead erasure and export — to fulfill your leads’ access and erasure requests, and we assist you in responding to data-subject and regulator requests we receive.',
            'On termination, we delete or return lead personal data per the retention schedule and the deletion cascade, except where retention is required by law. Lead data is resident in the offering’s disclosed region and is not relocated without notice.',
          ],
        },
      ]}
    />
  );
}
