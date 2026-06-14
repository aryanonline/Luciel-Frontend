'use client';

import * as React from 'react';

/**
 * The hero widget demo (Customer Journey §1): a looped exchange showing the
 * widget answering and offering to book. Built with the design tokens, no
 * external assets. Animation is gentle (fade-up entrance + a typing indicator
 * before assistant replies) and on-brand (§5). prefers-reduced-motion users get
 * the full conversation as a STATIC frame with no typing/animation (Arch §5.16).
 *
 * Mirrors the real widget chrome (AI-assistant label, opening disclosure,
 * Powered by VantageMind) so the demo is honest about what the product does.
 */
type Turn = { role: 'visitor' | 'assistant'; text: string };

const SCRIPT: Turn[] = [
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

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <span
        className="inline-flex items-center gap-1 rounded-vm-card rounded-bl-sm bg-vm-surface px-vm-3 py-vm-3"
        aria-hidden="true"
      >
        <span className="vm-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-vm-text-muted" />
        <span className="vm-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-vm-text-muted" />
        <span className="vm-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-vm-text-muted" />
      </span>
    </div>
  );
}

export function HeroDemo() {
  const reduced = usePrefersReducedMotion();
  // visibleCount = how many script turns are shown; typing = whether the NEXT
  // (assistant) turn is mid-"typing".
  const [visibleCount, setVisibleCount] = React.useState(reduced ? SCRIPT.length : 1);
  const [typing, setTyping] = React.useState(false);

  React.useEffect(() => {
    if (reduced) {
      setVisibleCount(SCRIPT.length);
      setTyping(false);
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const run = (count: number) => {
      if (cancelled) return;
      // Loop: once the whole script is shown, pause then restart.
      if (count >= SCRIPT.length) {
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            setTyping(false);
            setVisibleCount(1);
            run(1);
          }, 2600),
        );
        return;
      }
      const next = SCRIPT[count];
      if (!next) return;
      const reveal = () => {
        if (cancelled) return;
        setTyping(false);
        setVisibleCount(count + 1);
        timers.push(setTimeout(() => run(count + 1), next.role === 'assistant' ? 1100 : 700));
      };
      if (next.role === 'assistant') {
        // Show a typing indicator before an assistant reply.
        setTyping(true);
        timers.push(setTimeout(reveal, 1100));
      } else {
        reveal();
      }
    };

    timers.push(setTimeout(() => run(1), 1100));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduced]);

  const shown = SCRIPT.slice(0, visibleCount);

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
      <div className="flex min-h-[280px] flex-col gap-vm-2 p-vm-4" aria-hidden="true">
        {shown.map((m, i) => (
          <div
            key={i}
            className={`vm-msg-in ${m.role === 'visitor' ? 'flex justify-end' : 'flex justify-start'}`}
          >
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
        {typing && <TypingBubble />}
      </div>
      <div className="border-t border-vm-border px-vm-4 py-vm-2 text-vm-0 text-vm-text-muted">
        Powered by VantageMind
      </div>
    </div>
  );
}
