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
  {
    ...solid,
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', 'src/test/**'],
  },
  prettierConfig,
);
