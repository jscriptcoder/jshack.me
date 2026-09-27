import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid/configs/typescript';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // `.stryker-tmp` is a full COPY of the repo with mutants spliced into it, so
  // linting it reports hundreds of errors in code nobody wrote — and it outlives
  // the run whenever one is killed partway. The lint gate has to answer about the
  // working tree, not about a sandbox.
  { ignores: ['dist', 'coverage', '.stryker-tmp'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Vercel runs api/ as plain Node ESM, which resolves a relative import only by
  // its exact file name — `./x` is ERR_MODULE_NOT_FOUND at runtime, `./x.js` finds
  // x.ts. vite, vitest, tsx and `vercel dev` all forgive the missing extension, so
  // nothing but a deploy would notice. One rule for every file keeps the question
  // of which modules api/ happens to load from ever arising. A stylesheet may
  // carry Vite's `?raw` query: that import only exists under Vite, never in api/.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'ImportDeclaration',
          'ExportNamedDeclaration',
          'ExportAllDeclaration',
          'ImportExpression',
        ].map((node) => ({
          selector: `${node}[source.value=/^\\.{1,2}\\W(?!.*\\.(?:js|css(?:\\?raw)?)$)/]`,
          message:
            "Relative imports end in '.js' (it resolves to the .ts file): Vercel runs api/ as plain Node ESM, which does not guess extensions.",
        })),
      ],
    },
  },
  {
    ...solid,
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', 'src/test/**'],
  },
  prettierConfig,
);
