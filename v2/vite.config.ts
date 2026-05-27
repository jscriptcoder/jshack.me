import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

// `hot: false` under vitest: solid-refresh (HMR) injects a virtual
// `/@solid-refresh` module that jsdom can't resolve. Dev/build keep HMR.
// Tailwind is dev/build-only — jsdom doesn't render CSS, so tests skip it.
export default defineConfig(({ mode }) => ({
  plugins: [solid({ hot: mode !== 'test' }), ...(mode === 'test' ? [] : [tailwindcss()])],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
  },
}));
