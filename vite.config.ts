import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

// `hot: false` under vitest: solid-refresh (HMR) injects a virtual
// `/@solid-refresh` module that jsdom can't resolve. Dev/build keep HMR.
// Tailwind is dev/build-only — jsdom doesn't render CSS, so tests skip it.
export default defineConfig(({ mode }) => ({
  // `__APP_VERSION__` is injected at build time from package.json and read by
  // the boot banner. Defined unconditionally so it resolves under test too.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [solid({ hot: mode !== 'test' }), ...(mode === 'test' ? [] : [tailwindcss()])],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Well above anything a healthy test needs, and deliberately so. Under Stryker's
    // instrumentation every test runs several times slower, and vitest's 5s default was
    // enough to trip the module-import test in `ui/state.test.ts` — which fails the
    // mutation DRY RUN, so no mutants run at all and the gate reports nothing rather
    // than reporting a problem. Same reasoning as `timeoutMS` in stryker.config.json: a
    // timeout here is a correctness setting, not a patience setting.
    testTimeout: 30000,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
  },
}));
