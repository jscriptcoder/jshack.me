# jshack.me

A browser-based, hacking-themed simulation game. You work from a terminal on your own in-game
workstation: crack a WiFi network, scan the machines around you, find a way into them, and defend
your own box from other players doing the same. Everything is simulated. There are no real hosts
or networks, and the "exploits" run on the game's own generated machines.

Live at [jshack.me](https://jshack.me).

## Stack

- **Client:** Solid.js + Vite + Tailwind, all in TypeScript (strict)
- **Server:** Vercel Functions in `api/`, backed by Supabase Postgres
- **Tests:** Vitest with jsdom and `@solidjs/testing-library`; Stryker for mutation testing;
  `scripts/test*.ts` wire-checks against a running `vercel dev` + local Supabase

## Layout

```
src/
  core/       pure TypeScript, no framework (shared by client and server)
  adapters/   signed fetch clients for api/, and the cross-tab BroadcastChannel
  ui/         Solid components and screens
api/          Vercel Functions: network, patches, sessions
scripts/      build helpers and wire-checks
supabase/     migrations and local stack config
docs/         as-built architecture, conventions, legacy and mission-ideas
plans/        live epic and slice plans
```

## Run it locally

```bash
npm install
npm run encode              # generates the git-ignored src/core/secrets/__encoded.ts
npx supabase start          # local Postgres in Docker
npm run vercel:dev          # vite + api/ functions on http://localhost:3100
```

`npm run vercel:dev` reads `.env.development.local`, which holds the keys that
`npx supabase status -o env` prints for the local stack. `npm run dev` starts Vite without the
functions.

## Commands

```bash
npm run typecheck      # tsc -b (src, api and scripts)
npm run lint           # eslint
npm run test:run       # vitest, once
npm run build          # production build, then the world budget check
npm run test:mutation  # stryker (a whole-suite run does not finish; scope it, see the handbook ch. 11)
```

## Deployment

Vercel builds the repository root. `main` deploys to production against the `jshack-prod` Supabase
project. Every other branch gets a preview deployment against `jshack-dev`. Schema changes are
Supabase migrations in `supabase/migrations/`.

## Documentation

New to the project? Start with the [maintainer's handbook](./docs/handbook/README.md): architecture,
every subsystem, the server and database reference, testing, deployment and known issues. The full
documentation index is [docs/README.md](./docs/README.md); the long-form conventions and gotchas are in
[docs/conventions-and-gotchas.md](./docs/conventions-and-gotchas.md).

This codebase is v2, a from-scratch rewrite. The original React app is retired: its design is in
[docs/legacy/](./docs/legacy/README.md), its source at git tag `legacy-final`, and its mission ideas
are kept for the missions rebuild in [docs/mission-ideas/](./docs/mission-ideas/README.md).

## License

MIT
