import { color, radius, space, fontFamily, motion } from '@luciel/design-tokens';

/**
 * Shadow-DOM scoped styles. The widget compiles the SAME design tokens into its
 * shadow root (NOT Tailwind utilities leaking onto host pages — Space
 * Instructions §2, §5). Built as a string injected into the shadow root so host
 * CSS can never collide with widget CSS and vice-versa.
 *
 * prefers-reduced-motion is respected (Arch §5.16): transitions collapse to 0.
 *
 * Layout contract (P0-1): the shadow host is fixed bottom-right at the
 * conventional embed z-index band, the panel is CLOSED by default behind a
 * circular launcher, the transcript is height-bounded so a long conversation
 * can never grow the host page, and under 480px the open panel goes full-bleed
 * instead of being a 360px card wider than the phone.
 */
export const widgetStyles = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ${fontFamily}; }
  .vm-root {
    color: ${color.text};
    font-size: 14px;
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: ${space[3]};
  }
  /* Closed by default — the host page looks untouched until the visitor asks. */
  .vm-root[data-open="false"] .vm-panel { display: none; }
  .vm-panel {
    background: ${color.bg};
    border: 1px solid ${color.border};
    border-radius: ${radius.card};
    box-shadow: 0 1px 2px rgba(20,24,31,.06), 0 4px 12px rgba(20,24,31,.05);
    width: 360px;
    max-width: calc(100vw - ${space[5]});
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .vm-launcher {
    width: 56px;
    height: 56px;
    min-width: 56px;
    min-height: 56px;
    padding: 0;
    border: none;
    border-radius: ${radius.pill};
    background: ${color.accent};
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 2px rgba(20,24,31,.06), 0 4px 12px rgba(20,24,31,.05);
    transition: background ${motion.duration} ${motion.easing};
  }
  .vm-launcher:hover { background: ${color.accentHover}; }
  .vm-launcher:focus-visible { outline: 2px solid ${color.focusRing}; outline-offset: 2px; }
  .vm-launcher svg { width: 26px; height: 26px; display: block; fill: currentColor; }
  .vm-header {
    display: flex;
    align-items: center;
    gap: ${space[2]};
    padding: ${space[3]} ${space[4]};
    background: ${color.surface};
    border-bottom: 1px solid ${color.border};
    flex: none;
  }
  .vm-header-title { font-weight: 600; }
  /* The AI-identity disclosure sits between the name and the close button and
     is never allowed to be squeezed out of the header (Arch §3.4.16). */
  .vm-ai-label {
    font-size: 12px;
    color: ${color.textMuted};
    border: 1px solid ${color.border};
    border-radius: ${radius.pill};
    padding: 2px 8px;
    white-space: nowrap;
    flex: none;
    margin-left: auto;
  }
  .vm-close {
    flex: none;
    min-width: 32px;
    min-height: 32px;
    margin: -6px -6px -6px 0;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: ${radius.control};
    color: ${color.textMuted};
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .vm-close:hover { background: ${color.border}; }
  .vm-close:focus-visible { outline: 2px solid ${color.focusRing}; outline-offset: 2px; }
  /* Height-bounded transcript: the panel scrolls internally, the page does not
     grow as the conversation runs. */
  .vm-body {
    padding: ${space[4]};
    max-height: 60vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    flex: 1 1 auto;
  }
  .vm-msg { margin: 0 0 ${space[3]}; }
  /* Rendered markdown in assistant bubbles. The first paragraph goes inline so
     it continues the "Luciel: " label instead of dropping to its own line. */
  .vm-msg > p { margin: 0 0 ${space[2]}; }
  .vm-msg > p:first-of-type { display: inline; }
  .vm-msg > :last-child { margin-bottom: 0; }
  .vm-msg ul, .vm-msg ol { margin: ${space[2]} 0; padding-left: ${space[4]}; }
  .vm-msg li { margin: 0 0 2px; }
  .vm-msg code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    background: ${color.surface};
    border: 1px solid ${color.border};
    border-radius: ${radius.control};
    padding: 0 4px;
  }
  .vm-msg a { color: ${color.accent}; text-decoration: underline; }
  .vm-msg a:focus-visible { outline: 2px solid ${color.focusRing}; outline-offset: 2px; }
  .vm-footer {
    padding: ${space[2]} ${space[4]};
    border-top: 1px solid ${color.border};
    font-size: 11px;
    color: ${color.textMuted};
  }
  /* Typing indicator — the visitor sees the reply being worked on instead of
     dead air, so they don't press Enter again (P1-20). */
  .vm-typing { display: flex; align-items: center; gap: 4px; margin: 0 0 ${space[3]}; }
  .vm-typing span {
    width: 6px;
    height: 6px;
    border-radius: ${radius.pill};
    background: ${color.textMuted};
    opacity: .35;
    animation: vm-typing-dot 1.2s ${motion.easing} infinite;
  }
  .vm-typing span:nth-child(2) { animation-delay: .15s; }
  .vm-typing span:nth-child(3) { animation-delay: .3s; }
  @keyframes vm-typing-dot {
    0%, 60%, 100% { opacity: .35; }
    30% { opacity: 1; }
  }
  .vm-input-row { display: flex; gap: ${space[2]}; padding: 0 ${space[4]} ${space[4]}; flex: none; }
  .vm-input:disabled, .vm-send:disabled { opacity: .5; cursor: not-allowed; }
  .vm-input {
    flex: 1;
    min-height: 44px;
    padding: 0 ${space[3]};
    border: 1px solid ${color.border};
    border-radius: ${radius.control};
    font-size: 14px;
  }
  .vm-input:focus-visible { outline: 2px solid ${color.focusRing}; outline-offset: 2px; }
  .vm-send {
    min-height: 44px;
    padding: 0 ${space[4]};
    background: ${color.accent};
    color: #fff;
    border: none;
    border-radius: ${radius.control};
    font-weight: 500;
    cursor: pointer;
    transition: background ${motion.duration} ${motion.easing};
  }
  .vm-send:hover { background: ${color.accentHover}; }
  .vm-send:focus-visible { outline: 2px solid ${color.focusRing}; outline-offset: 2px; }
  /* Phones: a 360px card is wider than the screen and a floating launcher on
     top of it is unusable, so the open panel takes the viewport. */
  @media (max-width: 480px) {
    .vm-root[data-open="true"] .vm-panel {
      position: fixed;
      inset: 0;
      width: auto;
      max-width: none;
      height: auto;
      max-height: none;
      border: none;
      border-radius: 0;
    }
    .vm-root[data-open="true"] .vm-body { max-height: none; }
    .vm-root[data-open="true"] .vm-launcher { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .vm-send, .vm-launcher { transition: none; }
    .vm-typing span { animation: none; opacity: .6; }
  }
`;
