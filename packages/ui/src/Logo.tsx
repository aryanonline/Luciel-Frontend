import { cn } from './cn';

/**
 * Logo — a restrained wordmark with a small token-built mark (no external image
 * asset; §5 favors typography/whitespace over decoration). The mark is a single
 * accent square with a "V" cut, kept minimal. If a brand SVG arrives later it
 * slots in here without touching consumers.
 *
 * The V is DRAWN, not typed. As a text node it was part of the logo's visible text
 * ("V VantageMind") even under aria-hidden, so every link wrapping the logo with
 * aria-label="VantageMind ..." failed WCAG 2.5.3 Label in Name (axe 4.14's
 * label-content-name-mismatch): the visible text was not in the accessible name.
 * The mark is a graphic; the only words the logo shows are "VantageMind".
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-vm-2 font-heading text-vm-3', className)}>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        className="h-6 w-6 shrink-0 rounded-[6px] bg-vm-accent text-white"
      >
        <path d="M8 8l4 9 4-9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      <span className="tracking-tight">
        Vantage<span className="text-vm-accent">Mind</span>
      </span>
    </span>
  );
}
