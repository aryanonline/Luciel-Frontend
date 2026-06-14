import Link from 'next/link';
import { Container, Section, Eyebrow, Button, Card } from '@luciel/ui';
import { HeroDemo } from '@/components/marketing/hero-demo';

/**
 * Landing page (Customer Journey Phase 1, §6.1). SSG. One job: convert to
 * /signup. Hero + working widget demo + plainly-stated pricing + the honesty
 * section. Refined-minimal per §5 — typography and whitespace do the work, one
 * accent, no decoration that isn't load-bearing. No tier table implying gating.
 */
const STEPS = [
  {
    n: '1',
    title: 'Hire your Luciel',
    body: 'Create it in minutes and set five things from clean dropdowns — channels, tools, knowledge, who to escalate to, and a personality.',
  },
  {
    n: '2',
    title: 'It answers, around the clock',
    body: 'Luciel replies from your own knowledge across the channels you turn on — and escalates rather than guessing when it can’t answer confidently.',
  },
  {
    n: '3',
    title: 'You win the work',
    body: 'It captures every lead, books appointments, and pings you the moment something needs a person — with the context to act right away.',
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <Section className="pb-vm-7 pt-vm-9">
        <Container>
          <div className="grid items-center gap-vm-8 lg:grid-cols-2">
            <div>
              <Eyebrow>Your AI employee</Eyebrow>
              <h1 className="font-heading text-vm-8 leading-[1.05] tracking-tight">
                Your business, answered.
              </h1>
              <p className="mt-vm-5 max-w-xl text-vm-3 leading-relaxed text-vm-text-muted">
                Assemble an AI employee that answers your customers, captures leads, and knows when
                to bring in a person — without writing a single line of code.
              </p>
              <div className="mt-vm-6 flex flex-wrap items-center gap-vm-3">
                <Button asChild variant="primary" size="lg">
                  <Link href="/signup">Start free — no credit card</Link>
                </Button>
                <Button asChild variant="ghost" size="lg">
                  <Link href="/#how-it-works">See how it works</Link>
                </Button>
              </div>
              <p className="mt-vm-4 text-vm-1 text-vm-text-muted">
                50 conversations a month, free. Every feature included.
              </p>
            </div>
            <div className="flex justify-center lg:justify-end">
              <HeroDemo />
            </div>
          </div>
        </Container>
      </Section>

      {/* How it works */}
      <Section id="how-it-works" className="border-t border-vm-border bg-vm-surface">
        <Container>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="font-heading text-vm-6 tracking-tight">Like hiring one capable person</h2>
          <p className="mt-vm-2 max-w-2xl text-vm-2 text-vm-text-muted">
            One account, one Luciel — the way a small business hires one employee, not a department.
            As you grow, you give that employee more work, not a second hire.
          </p>
          <div className="mt-vm-6 grid gap-vm-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <Card key={s.n}>
                <div className="flex h-8 w-8 items-center justify-center rounded-vm-pill bg-vm-accent-weak font-heading text-vm-2 text-vm-accent">
                  {s.n}
                </div>
                <h3 className="mt-vm-3 font-heading text-vm-4">{s.title}</h3>
                <p className="mt-vm-2 text-vm-1 leading-relaxed text-vm-text-muted">{s.body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* Pricing — plain and honest (Vision §7). No tier table implying gating. */}
      <Section id="pricing">
        <Container>
          <div className="grid items-start gap-vm-6 lg:grid-cols-2">
            <div>
              <Eyebrow>Pricing</Eyebrow>
              <h2 className="font-heading text-vm-6 tracking-tight">One plan. No tiers.</h2>
              <p className="mt-vm-3 max-w-xl text-vm-2 leading-relaxed text-vm-text-muted">
                Start free with 50 conversations a month. Need more? Pay only for what you use.
                Every feature is included on every account — paying more never means a different or
                “upgraded” employee, just more hours of work.
              </p>
            </div>
            <Card className="p-vm-6">
              <div className="flex items-baseline gap-vm-2">
                <span className="font-heading text-vm-7 tracking-tight">$0</span>
                <span className="text-vm-2 text-vm-text-muted">
                  / first 50 conversations a month
                </span>
              </div>
              <div className="mt-vm-3 border-t border-vm-border pt-vm-3 text-vm-2">
                <span className="font-heading text-vm-4">$39</span>{' '}
                <span className="text-vm-text-muted">
                  per 100 conversations after that, billed monthly.
                </span>
              </div>
              {/* Concise included-features list — attract buyers without overwhelming.
                  Six high-signal items (Vision §5: don't exhaust the reader). */}
              <p className="mt-vm-4 text-vm-0 font-label uppercase tracking-[0.08em] text-vm-text-muted">
                Everything included
              </p>
              <ul className="mt-vm-2 grid grid-cols-1 gap-x-vm-4 gap-y-vm-2 text-vm-1 sm:grid-cols-2">
                {[
                  'Web, email, SMS & voice channels',
                  'Books appointments & captures leads',
                  'Answers from your own knowledge',
                  'Escalates to you when it matters',
                  'Analytics, answer review & audit log',
                  'Your data stays yours — never trains AI',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-vm-2">
                    <span aria-hidden="true" className="mt-0.5 text-vm-accent">
                      ✓
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-vm-5">
                <Button asChild variant="primary" className="w-full">
                  <Link href="/signup">Start free</Link>
                </Button>
                <p className="mt-vm-2 text-center text-vm-0 text-vm-text-muted">
                  No credit card to start. Add one only when you outgrow the free 50.
                </p>
              </div>
            </Card>
          </div>
        </Container>
      </Section>

      {/* Trust strip — the brand's 'honest by design' value (Vision §5), reframed
          as a calm row of positives. The two real launch constraints are folded
          in concisely; full detail lives in the legal pages. */}
      <Section className="border-t border-vm-border bg-vm-surface">
        <Container>
          <Eyebrow>Built to be straight with you</Eyebrow>
          <h2 className="max-w-2xl font-heading text-vm-5 tracking-tight">
            Trust is the product. No dark patterns, no surprises.
          </h2>
          <div className="mt-vm-5 grid gap-vm-5 md:grid-cols-3">
            <div>
              <h3 className="font-heading text-vm-2">Your data is yours</h3>
              <p className="mt-vm-1 text-vm-1 leading-relaxed text-vm-text-muted">
                We never sell it and never train AI on it. Export everything, anytime.
              </p>
            </div>
            <div>
              <h3 className="font-heading text-vm-2">Always identified as AI</h3>
              <p className="mt-vm-1 text-vm-1 leading-relaxed text-vm-text-muted">
                Your Luciel tells people it’s an AI for your business — that can’t be turned off.
              </p>
            </div>
            <div>
              <h3 className="font-heading text-vm-2">Honest about launch limits</h3>
              <p className="mt-vm-1 text-vm-1 leading-relaxed text-vm-text-muted">
                At launch: email on a VantageMind subdomain (not your own), and one login per
                account. See our{' '}
                <Link href="/legal/terms" className="text-vm-accent underline">
                  Terms
                </Link>{' '}
                for the full picture.
              </p>
            </div>
          </div>
        </Container>
      </Section>

      {/* Final CTA */}
      <Section>
        <Container className="text-center">
          <h2 className="font-heading text-vm-6 tracking-tight">
            Ready to stop missing inquiries?
          </h2>
          <p className="mx-auto mt-vm-3 max-w-xl text-vm-2 text-vm-text-muted">
            Set up your Luciel in about three minutes. Free to start, no credit card.
          </p>
          <div className="mt-vm-5 flex justify-center">
            <Button asChild variant="primary" size="lg">
              <Link href="/signup">Start free — no credit card</Link>
            </Button>
          </div>
        </Container>
      </Section>
    </>
  );
}
