/**
 * ESLint 9 flat config for the web app, run by the ESLint CLI (`pnpm lint`) and by
 * `next build`. `next lint` is deprecated as of Next.js 15.5; this is the migration the
 * Next.js 15.5 docs give for an existing project. eslint-config-next 15 ships eslintrc
 * presets only, so FlatCompat translates them, and the rules are the former
 * .eslintrc.json's, unchanged.
 */
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  {
    // Build and test output, and the type stub Next generates. ESLint 9 skips only
    // node_modules and .git by default, and it does not read .gitignore.
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...compat.config({
    extends: ['next/core-web-vitals'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@luciel/api-client/src/adapters/*',
                '**/adapters/mock-*',
                '**/adapters/http-*',
              ],
              message:
                "Import the typed client via '@luciel/api-client' (createLucielClient). UI must never import an adapter or the mock directly.",
            },
          ],
        },
      ],
    },
  }),
];

export default eslintConfig;
