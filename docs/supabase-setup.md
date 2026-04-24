# Supabase setup

This project uses Supabase (Postgres + Realtime) as the backend for multiplayer. All game state — public IP allocations, patches, sessions, mission instances — lives server-side in Postgres, accessed via the Supabase JS SDK and RLS-protected queries.

This doc covers the local dev loop and the cloud preview project. Production is deliberately deferred until multiplayer launch (see `feedback_no_backward_compat.md` memory for why pre-launch iteration is kept loose).

## Prerequisites

- **Docker Desktop** (running) — Supabase's local dev stack runs entirely in Docker.
- **Supabase CLI** — already a devDep of this repo; run via `npx supabase` or the `supabase:*` npm scripts.

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

- `API URL` — point `SUPABASE_URL` here for local dev
- `anon key` — point `SUPABASE_ANON_KEY` here
- `service_role key` — point `SUPABASE_SERVICE_ROLE_KEY` here (in Vercel dev functions only)

Write these to `.env.local` (gitignored by default):

```
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=<from supabase:status>
SUPABASE_SERVICE_ROLE_KEY=<from supabase:status>
```

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
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (safe to expose to browsers — public by design)
   - `SUPABASE_SERVICE_ROLE_KEY` (**NEVER exposed to browsers** — server-side only)
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

| Component                                 | Location                         | Secret needed                                                          |
| ----------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| Client app (React + Vite)                 | Vercel edge (static)             | `SUPABASE_ANON_KEY` (baked into bundle via `import.meta.env`)          |
| `/api/allocate-ip` (and future functions) | Vercel serverless (Node)         | `SUPABASE_SERVICE_ROLE_KEY` (runtime env var, never baked into bundle) |
| Postgres + Realtime                       | Supabase cloud (or local Docker) | —                                                                      |

## Troubleshooting

- **`supabase start` hangs or errors about Docker**: make sure Docker Desktop is running.
- **`supabase db reset` fails mid-migration**: fix the migration, run again. Reset drops everything.
- **Cloud function returns `not_configured`**: env vars aren't set on Vercel. Check project settings → Environment Variables.
- **Client sees `403` from Supabase reads**: RLS policy is blocking anon SELECT. Check the policy in the relevant migration file.
