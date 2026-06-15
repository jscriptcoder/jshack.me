# jshack-me v2

Solid.js rewrite of jshack.me. Built from the spec in `./docs/rewrite-blueprint/`.

This is a skeleton. No game features yet — just a working Solid + Vite + Vitest + ESLint + Prettier toolchain.

## Layout

```
v2/
  src/
    core/         pure TypeScript, zero framework deps (shared client+server)
    adapters/     thin glue to IndexedDB, Supabase, BroadcastChannel
    ui/           Solid signals + screens (the only framework-aware layer)
    test/         setup + factories for tests
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  eslint.config.js
```

See `./docs/rewrite-blueprint/decisions.md` for locked architectural decisions.

## Commands

```bash
npm install        # one-time
npm run dev        # vite dev server
npm run build      # production build
npm run test       # vitest watch mode
npm run test:run   # one-shot
npm run test:mutation  # stryker mutation testing (core/ only)
npm run lint       # eslint
```

## Status

- [x] Toolchain skeleton (Solid + Vite + Vitest + ESLint + Prettier)
- [x] One passing smoke test
- [ ] Core types + walker
- [ ] First command (`cat`) end-to-end
- [ ] Minimal terminal UI
- [ ] ...
