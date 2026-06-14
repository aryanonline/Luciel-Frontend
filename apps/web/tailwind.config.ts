import type { Config } from 'tailwindcss';
import { lucielPreset } from '@luciel/design-tokens';

/**
 * App Tailwind config. The locked token mapping comes from the shared preset
 * (single source of truth — Space Instructions §5). We add only content globs
 * here; we do NOT redefine token values.
 */
const config: Config = {
  presets: [lucielPreset as Config],
  content: [
    './src/**/*.{ts,tsx}',
    // Pull class usage from the shared UI package so its utilities aren't purged.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  // Dark theme is class/attribute driven (data-theme="dark"), matching tokens.css.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
