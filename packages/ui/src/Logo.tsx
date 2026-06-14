import { cn } from './cn';

/**
 * Logo — a restrained wordmark with a small token-built mark (no external image
 * asset; §5 favors typography/whitespace over decoration). The mark is a single
 * accent square with the "V" cut, kept minimal. If a brand SVG arrives later it
 * slots in here without touching consumers.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-vm-2 font-heading text-vm-3', className)}>
      <span
        aria-hidden="true"
        className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] bg-vm-accent text-white"
        style={{ fontSize: '0.8rem', fontWeight: 600 }}
      >
        V
      </span>
      <span className="tracking-tight">
        Vantage<span className="text-vm-accent">Mind</span>
      </span>
    </span>
  );
}
