/**
 * Shared Tailwind preset — maps the locked tokens onto Tailwind's theme so
 * apps style with token-backed utilities (e.g. bg-vm-surface, text-vm-text)
 * that resolve to the CSS variables. This keeps Tailwind utilities and the
 * design tokens as one source of truth (Space Instructions §2, §5).
 *
 * Utilities reference var(--vm-*) (not the raw hex) so dark-theme switching is
 * runtime, not a rebuild.
 */
import type { Config } from 'tailwindcss';

export const lucielPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        'vm-bg': 'var(--vm-bg)',
        'vm-surface': 'var(--vm-surface)',
        'vm-border': 'var(--vm-border)',
        'vm-text': 'var(--vm-text)',
        'vm-text-muted': 'var(--vm-text-muted)',
        'vm-accent': 'var(--vm-accent)',
        'vm-accent-hover': 'var(--vm-accent-hover)',
        'vm-accent-weak': 'var(--vm-accent-weak)',
        'vm-success': 'var(--vm-success)',
        'vm-warning': 'var(--vm-warning)',
        'vm-danger': 'var(--vm-danger)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        'vm-0': ['0.75rem', { lineHeight: '1.2' }],
        'vm-1': ['0.875rem', { lineHeight: '1.4' }],
        'vm-2': ['1rem', { lineHeight: '1.6' }],
        'vm-3': ['1.125rem', { lineHeight: '1.5' }],
        'vm-4': ['1.25rem', { lineHeight: '1.4' }],
        'vm-5': ['1.5rem', { lineHeight: '1.3' }],
        'vm-6': ['2rem', { lineHeight: '1.2' }],
        'vm-7': ['2.5rem', { lineHeight: '1.15' }],
        'vm-8': ['3rem', { lineHeight: '1.1' }],
      },
      fontWeight: {
        body: '400',
        label: '500',
        heading: '600',
      },
      spacing: {
        'vm-1': '4px',
        'vm-2': '8px',
        'vm-3': '12px',
        'vm-4': '16px',
        'vm-5': '24px',
        'vm-6': '32px',
        'vm-7': '48px',
        'vm-8': '64px',
        'vm-9': '96px',
      },
      borderRadius: {
        'vm-control': '6px',
        'vm-card': '10px',
        'vm-pill': '9999px',
      },
      boxShadow: {
        vm: '0 1px 2px rgba(20,24,31,.06), 0 4px 12px rgba(20,24,31,.05)',
      },
      transitionTimingFunction: {
        'vm-ease-out': 'cubic-bezier(0, 0, 0.2, 1)',
      },
      transitionDuration: {
        vm: '175ms',
      },
      ringColor: {
        'vm-focus': 'var(--vm-focus-ring)',
      },
    },
  },
};

export default lucielPreset;
