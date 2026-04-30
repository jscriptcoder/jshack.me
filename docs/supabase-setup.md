# Supabase setup

This project uses Supabase (Postgres + Realtime) as the backend for multiplayer. All game state — public IP allocations, patches, sessions, mission instances — lives server-side in Postgres, accessed via the Supabase JS SDK and RLS-protected queries.

This doc covers the local dev loop and the cloud preview project. Production is deliberately deferred until multiplayer launch (see `feedback_no_backward_compat.md` memory for why pre-launch iteration is kept loose).

## Prerequisites

- **Docker Desktop** (running) — Supabase's local dev stack runs entirely in Docker.
- **Supabase CLI** — already a devDep of this repo; run via `npx supabase` or the `supabase:*` npm scripts.
- **Vercel CLI** (only if you want to run the `/api/allocate-ip` function locally) — `npm install -g vercel`. After install, `vercel link` once to associate the clone with the Vercel project. Then `npm run vercel:dev` (which loads `.env.local` via dotenv-cli) starts Vite + the function on `localhost:3000`. Plain `npm run dev` runs Vite only — no API functions.

## Local dev loop

Day-to-day cycle:

```bash
npm run supabase:start     # spin up local Postgres + Realtime + Auth in Docker
npm run supabase:status    # print local URLs and keys
npm run db:reset           # drop everything, re-run all migrations from scratch
npm run supabase:stop      # shut down when done
```

**The reset command is your trash bin.** Playtesting fills the DB with junk patches and allocations; `npm run db:reset` wipes it in seconds. No fear needed — local state is meant to be disposable.

After `supabase start`, the CLI prints:

- `API URL` — point `SUPABASE_URL` (server) and `VITE_SUPABASE_URL` (client) here
- `anon key` — point `VITE_SUPABASE_ANON_KEY` here (Vite exposes only `VITE_`-prefixed vars to the browser bundle)
- `service_role key` — point `SUPABASE_SERVICE_ROLE_KEY` here (Vercel dev functions only — NEVER exposed to the client)

Write these to `.env.local` (gitignored by default):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<from supabase:status>

VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<from supabase:status>
```

The `VITE_*` pair is needed by the browser-side Realtime subscriptions (`src/patchRegistry/realtime.ts`). If they're missing, the app still runs — it just falls back to refresh-driven cross-player updates without live broadcasts.

> **Note**: `npm run vercel:dev` uses `dotenv-cli` to explicitly load `.env.local` before invoking `vercel dev`. The CLI's own env-file loading is bypassed — when a clone is linked to a cloud Vercel project, `vercel dev` would otherwise pull cloud-side dev env vars (which aren't relevant for local-Supabase development). The dotenv wrapper keeps local secrets local.

## Migrations

Migrations live in `supabase/migrations/` as timestamped `.sql` files. To add one:

```bash
npx supabase migration new <name>     # creates a new timestamped file
# edit the file, then:
npm run db:reset                      # re-apply from scratch locally
```

Pre-launch: migrations can be rewritten/dropped freely — just reset. Post-launch: treat them as append-only history (see `feedback_no_backward_compat.md`).

## Cloud dev project (`jshack-dev`)

One shared cloud project for Vercel preview deploys. **Not production** — trash freely.

One-time setup (user action — not automated):

1. Create a free-tier Supabase project at https://supabase.com/dashboard. Name it `jshack-dev`.
2. Copy the project's `URL`, `anon` key, and `service_role` key from project settings.
3. Add them to Vercel project env vars (Preview + Production scopes):
   - `SUPABASE_URL` (server-only)
   - `SUPABASE_SERVICE_ROLE_KEY` (**NEVER exposed to browsers** — server-side only)
   - `VITE_SUPABASE_URL` (client — duplicate of the URL but with the `VITE_` prefix Vite needs to expose it to the bundle)
   - `VITE_SUPABASE_ANON_KEY` (client — safe to expose to browsers; public by design)
4. Push migrations to the cloud project:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref-from-dashboard-url>
   npx supabase db push
   ```

To wipe the cloud dev project without dropping the schema, paste `supabase/reset.sql` into the Supabase dashboard's SQL editor.

## Secret hygiene

- **`anon` key**: public. Shipped to client JS. Safe because RLS is the actual security boundary (see `project_multiplayer_security_model.md`).
- **`service_role` key**: catastrophic if leaked. Lives in `.env.local` (local dev) and Vercel env vars (cloud). **Never in client code, never in a committed file, never in a browser bundle.** If leaked, rotate immediately via the Supabase dashboard.
- The repo's `.env.local` is gitignored. Double-check before committing new env files.

## What's deployed where

| Component                                  | Location                         | Secret needed                                                                                |
| ------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------- |
| Client app (React + Vite)                  | Vercel edge (static)             | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (baked into bundle via `import.meta.env`)     |
| `/api/allocate-ip` etc. (Vercel functions) | Vercel serverless (Node)         | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (runtime env vars, never baked into the bundle) |
| Postgres + Realtime                        | Supabase cloud (or local Docker) | —                                                                                            |

## Troubleshooting

- **`supabase start` hangs or errors about Docker**: make sure Docker Desktop is running.
- **`supabase db reset` fails mid-migration**: fix the migration, run again. Reset drops everything.
- **Cloud function returns `not_configured`**: env vars aren't set on Vercel. Check project settings → Environment Variables.
- **Client sees `403` from Supabase reads**: RLS policy is blocking anon SELECT. Check the policy in the relevant migration file.
