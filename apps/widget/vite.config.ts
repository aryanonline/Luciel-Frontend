import { defineConfig } from 'vite';

/**
 * Vite library-mode build (Space Instructions §2, §6.3). Produces a single
 * self-initializing bundle (IIFE for the script tag + ESM for module consumers)
 * served from embed.vantagemind.ai/v1/luciel.js. The bundle must be tiny and
 * dependency-minimal and must NOT assume React exists on the host page — so the
 * widget is built with framework-light vanilla DOM, not React.
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'Luciel',
      formats: ['iife', 'es'],
      fileName: (format) => (format === 'iife' ? 'luciel.js' : 'luciel.mjs'),
    },
    // Keep the bundle self-contained (no external React) and minified.
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      // Nothing external — the embed must run standalone on arbitrary host pages.
      external: [],
    },
  },
  define: {
    // Inject the build-time adapter + base URL (NON-secret public values only).
    __WIDGET_ADAPTER__: JSON.stringify(process.env.VITE_WIDGET_ADAPTER ?? 'mock'),
    __WIDGET_API_BASE_URL__: JSON.stringify(
      process.env.VITE_WIDGET_API_BASE_URL ?? 'https://api.vantagemind.ai',
    ),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
