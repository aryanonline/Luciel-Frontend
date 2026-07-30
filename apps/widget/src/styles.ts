import { color, radius, space, fontFamily, motion } from '@luciel/design-tokens';

/**
 * Shadow-DOM scoped styles. The widget compiles the SAME design tokens into its
 * shadow root (NOT Tailwind utilities leaking onto host pages — Space
 * Instructions §2, §5). Built as a string injected into the shadow root so host
 * CSS can never collide with widget CSS and vice-versa.
 *
 * prefers-reduced-motion is respected (Arch §5.16): transitions collapse to 0.
 */
export const widgetStyles = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ${fontFamily}; }
  .vm-root {
    color: ${color.text};
    font-size: 14px;
    line-height: 1.5;
  }
  .vm-panel {
    background: ${color.bg};
    border: 1px solid ${color.border};
    border-radius: ${radius.card};
    box-shadow: 0 1px 2px rgba(20,24,31,.06), 0 4px 12px rgba(20,24,31,.05);
    width: 360px;
    max-width: calc(100vw - ${space[5]});
    overflow: hidden;
  }
  .vm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${space[2]};
    padding: ${space[3]} ${space[4]};
    background: ${color.surface};
    border-bottom: 1px solid ${color.border};
  }
  .vm-header-title { font-weight: 600; }
  .vm-ai-label {
    font-size: 12px;
    color: ${color.textMuted};
    border: 1px solid ${color.border};
    border-radius: ${radius.pill};
    padding: 2px 8px;
  }
  .vm-body { padding: ${space[4]}; }
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
  .vm-input-row { display: flex; gap: ${space[2]}; padding: 0 ${space[4]} ${space[4]}; }
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
  @media (prefers-reduced-motion: reduce) {
    .vm-send { transition: none; }
  }
`;
