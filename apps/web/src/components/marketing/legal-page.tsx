import { Container, Section, Banner } from '@luciel/ui';

/**
 * Shared legal page shell. IMPORTANT (Space Instructions §0/§6, Legal doc
 * header): the Legal document is a DRAFT, NOT IN FORCE, and its bracketed
 * placeholder text must never be reproduced verbatim in the UI. So these pages:
 *   - carry a prominent DRAFT banner,
 *   - summarize the structure and the commitments that mirror the product docs
 *     (pricing, retention, residency, breach window) in plain language,
 *   - contain NO bracketed counsel placeholders and NO verbatim draft clauses.
 * They exist so the public-facing legal surfaces and footer links are present;
 * counsel-approved final copy replaces the body before launch.
 */
export interface LegalSection {
  heading: string;
  body: string[];
}

export function LegalPage({
  title,
  intro,
  lastUpdated,
  sections,
}: {
  title: string;
  intro: string;
  lastUpdated: string;
  sections: LegalSection[];
}) {
  return (
    <Section className="pt-vm-8">
      <Container size="md">
        <Banner tone="warning" className="mb-vm-5">
          <strong>Draft — not yet in force.</strong> This page is a plain-language summary of terms
          we intend to publish. It is not legal advice and is pending review and approval by
          qualified counsel. The binding, counsel-approved version will replace this before launch.
        </Banner>

        <h1 className="font-heading text-vm-7 tracking-tight">{title}</h1>
        <p className="mt-vm-2 text-vm-0 text-vm-text-muted">Last updated: {lastUpdated}</p>
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
          Questions about this document? Contact privacy@vantagemind.ai. Security disclosures:
          security@vantagemind.ai.
        </p>
      </Container>
    </Section>
  );
}
