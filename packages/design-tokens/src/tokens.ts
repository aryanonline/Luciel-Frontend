/**
 * Typed token objects — the JS/TS mirror of tokens.css. Source of truth:
 * Space Instructions §5 (locked). Tailwind config and the widget read these so
 * there is exactly one place a token value lives.
 *
 * Components should prefer the CSS variables (var(--vm-*)) so theming (dark) is
 * runtime-switchable; these literals exist for build-time consumers (Tailwind,
 * the shadow-DOM widget) and for tests asserting the locked values.
 */

export const color = {
  bg: '#FFFFFF',
  surface: '#F7F8FA',
  border: '#E3E6EB',
  text: '#14181F',
  textMuted: '#5A6473',
  accent: '#2F5BEA',
  accentHover: '#2348C4',
  accentWeak: '#EAF0FF',
  success: '#1A7F5A',
  warning: '#B26A00',
  danger: '#C2362F',
  focusRing: '#2F5BEA',
} as const;

/** Font scale in rem, indexed 0..8. §5 verbatim. */
export const fontSize = [
  '0.75rem',
  '0.875rem',
  '1rem',
  '1.125rem',
  '1.25rem',
  '1.5rem',
  '2rem',
  '2.5rem',
  '3rem',
] as const;

export const fontWeight = {
  body: 400,
  label: 500,
  heading: 600,
} as const;

export const lineHeight = {
  body: 1.6,
  tight: 1.2,
} as const;

export const fontFamily = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** 8px-based spacing scale (4 for fine adjustments). §5 verbatim. */
export const space = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '24px',
  6: '32px',
  7: '48px',
  8: '64px',
  9: '96px',
} as const;

export const radius = {
  control: '6px',
  card: '10px',
  pill: '9999px',
} as const;

export const shadow = '0 1px 2px rgba(20,24,31,.06), 0 4px 12px rgba(20,24,31,.05)';

export const motion = {
  /** 150–200ms ease-out for state changes (§5). */
  duration: '175ms',
  easing: 'cubic-bezier(0, 0, 0.2, 1)',
  focusRingWidth: '2px',
  minTouchTarget: '44px',
} as const;

export const tokens = {
  color,
  fontSize,
  fontWeight,
  lineHeight,
  fontFamily,
  space,
  radius,
  shadow,
  motion,
} as const;

export type Tokens = typeof tokens;
