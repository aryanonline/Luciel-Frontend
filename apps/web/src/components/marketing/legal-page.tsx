import { Container, Section } from '@luciel/ui';

/**
 * Shared legal page shell.
 *
 * Owner decision D11 (round 7, 2026-09-14): the plain-language summaries on these
 * pages ARE the early-access terms in effect — they mirror the product documents
 * (pricing, retention, residency, breach window, single-login) — while the detailed
 * Legal document stays counsel's draft. So these pages carry a version and a real
 * last-updated date instead of a "Draft — not yet in force" banner, promise the
 * 30-day notice a material change carries (Legal §A10), and still reproduce NO
 * bracketed counsel placeholders and NO verbatim draft clauses.
 *
 * Owner decision D12: the single contact address for privacy requests, security
 * disclosures and support is info@vantagemind.ai (the privacy@/security@ aliases
 * never existed). A unit test pins this address across apps/web/src.
 */
export const LEGAL_CONTACT_EMAIL = 'info@vantagemind.ai';

export interface LegalSection {
  heading: string;
  body: string[];
}

export function LegalPage({
  title,
  intro,
  version,
  lastUpdated,
  sections,
}: {
  title: string;
  intro: string;
  /** Early-access terms version, e.g. "0.1". */
  version: string;
  /** ISO date of the last change to this page's substance. */
  lastUpdated: string;
  sections: LegalSection[];
}) {
  return (
    <Section className="pt-vm-8">
      <Container size="md">
        <h1 className="font-heading text-vm-7 tracking-tight">{title}</h1>
        <p className="mt-vm-2 text-vm-0 text-vm-text-muted">
          Early-access terms, version {version} — last updated {lastUpdated}. A counsel-reviewed
          version will replace these with at least 30 days&apos; notice.
        </p>
        <p className="mt-vm-4 text-vm-2 leading-relaxed text-vm-text-muted">{intro}</p>

        <div className="mt-vm-7 space-y-vm-6">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="font-heading text-vm-4 tracking-tight">{s.heading}</h2>
              <div className="mt-vm-2 space-y-vm-3">
                {s.body.map((p, i) => (
                  <p key={i} className="text-vm-2 leading-relaxed text-vm-text">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-vm-8 border-t border-vm-border pt-vm-4 text-vm-1 text-vm-text-muted">
          Questions about this document, privacy requests, or security disclosures:{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-vm-accent underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </Container>
    </Section>
  );
}
