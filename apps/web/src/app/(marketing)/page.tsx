import Link from 'next/link';

/**
 * Landing page (Customer Journey Phase 1, Space Instructions §6.1). SSG.
 * One job: get the visitor to /signup. Hero + one primary CTA + plainly-stated
 * pricing + the honesty section. No feature-stuffing, no tier table that
 * implies gating.
 *
 * The looped widget demo (Customer Journey §1) is a placeholder here; the real
 * reduced-motion-aware demo lands in the marketing-build milestone.
 */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-vm-5">
      {/* Hero */}
      <section className="py-vm-9">
        <h1 className="font-heading text-vm-7 leading-tight">Your business, answered.</h1>
        <p className="mt-vm-4 max-w-xl text-vm-4 text-vm-text-muted">
          Assemble an AI employee for your business in minutes — it answers your customers, captures
          leads, and knows when to bring in a person.
        </p>
        <div className="mt-vm-6">
          <Link
            href="/signup"
            className="inline-flex min-h-[44px] items-center rounded-vm-control bg-vm-accent px-vm-5 py-vm-3 font-label text-white hover:bg-vm-accent-hover"
          >
            Start free — no credit card
          </Link>
        </div>
        {/* Placeholder for the looped widget demo. Reduced-motion users will get a
            static frame in the marketing-build milestone (Customer Journey §1). */}
        <div
          className="mt-vm-7 rounded-vm-card border border-vm-border bg-vm-surface p-vm-6 text-vm-1 text-vm-text-muted"
          aria-label="Product demo placeholder"
        >
          [ Widget demo — placeholder. A 20-second loop of the widget answering and offering to book
          lands in the marketing milestone. ]
        </div>
      </section>

      {/* Pricing — plain and honest (Vision §7). No tier table implying gating. */}
      <section className="border-t border-vm-border py-vm-7">
        <h2 className="font-heading text-vm-5">Simple pricing</h2>
        <p className="mt-vm-3 max-w-xl text-vm-2">
          Start free with 50 conversations a month. Need more? Pay only for what you use — $39 per
          100 conversations, billed monthly. Every feature is included, on every account.
        </p>
      </section>

      {/* Honesty section — brand-differentiating (Customer Journey §1). */}
      <section className="border-t border-vm-border py-vm-7">
        <h2 className="font-heading text-vm-5">A couple of honest notes before you sign up</h2>
        <ul className="mt-vm-3 max-w-xl list-disc space-y-vm-2 pl-vm-5 text-vm-1 text-vm-text-muted">
          <li>
            At launch, inbound email arrives on a VantageMind subdomain (e.g.
            yourname@inbound.vantagemind.com), not your own domain. Outbound email is sent on your
            behalf so replies look native. Receiving on your own domain is a planned enhancement.
          </li>
          <li>
            One account, one login — no team seats. An auditor or bookkeeper is served through data
            export, not a second login.
          </li>
        </ul>
      </section>
    </div>
  );
}
