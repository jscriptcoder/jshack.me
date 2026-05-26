import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid/configs/typescript';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
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
