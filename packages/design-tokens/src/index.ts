export * from './tokens';
export { lucielPreset, default as tailwindPreset } from './tailwind-preset';

/**
 * The token CSS lives at '@luciel/design-tokens/tokens.css'. Import it once at
 * each app's root so the --vm-* custom properties are defined globally.
 */
