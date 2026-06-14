'use client';

import * as React from 'react';

/**
 * The hero widget demo (Customer Journey §1): a short looped exchange showing
 * the widget answering and offering to book. Built with the design tokens, no
 * external assets. Respects prefers-reduced-motion: reduced-motion users get
 * the full conversation as a STATIC frame (no typing animation) — §5/Arch §5.16.
 *
 * It mirrors the real widget chrome (AI-assistant label, opening disclosure,
 * Powered by VantageMind) so the demo is honest about what the product does.
 */
const SCRIPT: { role: 'visitor' | 'assistant'; text: string }[] = [
  { role: 'assistant', text: "Hi — I'm the AI assistant for GTA Premier. How can I help?" },
  { role: 'visitor', text: 'Are you taking on new clients this month?' },
  {
    role: 'assistant',
    text: 'Yes — we have openings this month. Would you like me to book an intro call?',
  },
  { role: 'visitor', text: 'Sure, tomorrow morning works.' },
  { role: 'assistant', text: "Booked for 9:00 AM. You'll get a confirmation by email." },
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export function HeroDemo() {
  const reduced = usePrefersReducedMotion();
  const [count, setCount] = React.useState(reduced ? SCRIPT.length : 1);

  React.useEffect(() => {
    if (reduced) {
      setCount(SCRIPT.length);
      return;
    }
    // Reveal messages on a gentle loop; pause at the end, then restart.
    let i = 1;
    const advance = () => {
      i = i >= SCRIPT.length ? 1 : i + 1;
      setCount(i);
    };
    const id = setInterval(advance, 1800);
    return () => clearInterval(id);
  }, [reduced]);

  const shown = SCRIPT.slice(0, count);

  return (
    <div
      className="w-full max-w-sm overflow-hidden rounded-vm-card border border-vm-border bg-vm-bg shadow-vm"
      role="img"
      aria-label="Demo of the Luciel chat widget answering a visitor and booking an intro call"
    >
      <div className="flex items-center justify-between border-b border-vm-border bg-vm-surface px-vm-4 py-vm-3">
        <span className="text-vm-1 font-label">GTA Premier</span>
        <span className="rounded-vm-pill border border-vm-border px-vm-2 py-0.5 text-vm-0 text-vm-text-muted">
          AI assistant
        </span>
      </div>
      <div className="flex min-h-[260px] flex-col justify-end gap-vm-2 p-vm-4" aria-hidden="true">
        {shown.map((m, i) => (
          <div key={i} className={m.role === 'visitor' ? 'flex justify-end' : 'flex justify-start'}>
            <span
              className={
                m.role === 'visitor'
                  ? 'max-w-[80%] rounded-vm-card rounded-br-sm bg-vm-accent px-vm-3 py-vm-2 text-vm-1 text-white'
                  : 'max-w-[80%] rounded-vm-card rounded-bl-sm bg-vm-surface px-vm-3 py-vm-2 text-vm-1 text-vm-text'
              }
            >
              {m.text}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-vm-border px-vm-4 py-vm-2 text-vm-0 text-vm-text-muted">
        Powered by VantageMind
      </div>
    </div>
  );
}
