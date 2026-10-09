# 12. Build, deployment and operations

This chapter covers how the game is built, where it runs, how a change reaches production, how to
change the database schema in the cloud, how to roll back, and the operational traps that have cost
time before. Read it before your first deploy, and again when something works locally but not in
production.

## Environments

| Environment    | App and functions                                                                                                                  | Database                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Local**      | `npm run vercel:dev`: Vite and the `api/` functions together on `http://localhost:3100`. `npm run dev` is Vite alone, with no API. | Supabase in Docker via `npx supabase start` (API on port 54421, database 54422, Studio 54423). |
| **Preview**    | A Vercel preview deployment for every pushed branch other than `main`.                                                             | Supabase cloud project **jshack-dev**.                                                         |
| **Production** | `main`, deployed automatically by Vercel to [jshack.me](https://jshack.me). Vercel project `jshack-me`.                            | Supabase cloud project **jshack-prod**.                                                        |

- Functions run in region **`fra1`** (Frankfurt), pinned in `vercel.json`, next to the production
  database.
- Node version, memory and timeout are Vercel project defaults: there is no function config in the
  repo and no `engines` field in `package.json`.
- Supabase project refs are **not** stored in the repo. Get them from the Supabase dashboard or
  `npx supabase projects list`.
- Vercel dashboard settings (build command overrides, deployment protection on previews, domains) are
  not recorded in the repo either.

## Environment variables

| Name                                                                    | Used by                        | Purpose                                                                      |
| ----------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `SUPABASE_URL`                                                          | `api/*.ts`, wire-checks        | The Supabase API URL. Missing → every endpoint answers `500 not_configured`. |
| `SUPABASE_SERVICE_ROLE_KEY`                                             | `api/*.ts`, wire-checks        | The service-role key (bypasses row-level security). Required.                |
| `SUPABASE_ANON_KEY`                                                     | `scripts/verifyPatchesRls.ts`  | Only for the row-level-security probe. The app does not use it.              |
| `VERCEL`                                                                | `scripts/checkBudgets.ts`      | Set to `1` by Vercel builds; skips the timing budget.                        |
| `ENDPOINT`, `NETWORK_ENDPOINT`, `PATCHES_ENDPOINT`, `SESSIONS_ENDPOINT` | wire-checks                    | Override the default `http://localhost:3100/api/<fn>`.                       |
| `EXPLOIT_ESSID`                                                         | `scripts/testExploitOwnLan.ts` | Optional script parameter: which network to test against.                    |

Set the two Supabase variables per Vercel environment in the Vercel dashboard (Production for
jshack-prod; Preview for jshack-dev). Locally they live in `.env.development.local` (git-ignored),
which holds the **local** stack's values; regenerate them with `npx supabase status -o env`.

**The client uses no environment variables**: there is no `import.meta.env`. The only build-time
injection is `__APP_VERSION__`.

## The build

`npm run build` runs, in order:

1. **`prebuild` → `npm run encode`**: writes the git-ignored `src/core/secrets/__encoded.ts` from
   `secrets.ts` (chapter 6). The functions import it too.
2. **`tsc -b`**: type-checks both project references: `tsconfig.app.json` (`src/`) and
   `tsconfig.node.json` (`vite.config.ts`, `api/`, `scripts/`). Both are strict with
   `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters` and `noImplicitReturns`. A plain
   `tsc --noEmit` checks **nothing**, because the root `tsconfig.json` has `files: []`.
3. **`vite build`**: emits the single-page app to `dist/`.
4. **`postbuild` → `scripts/checkBudgets.ts`**: fails the build if the gzipped main chunk exceeds
   284,975 bytes, or (locally only) if the average box build exceeds 2 ms (chapter 6).

Any failure fails the build, and on Vercel that means **nothing deploys**.

### What runs automatically

Only Vercel's `npm run build` on every push. That covers types, the Vite build and the bundle budget.
**Lint, tests, wire-checks, E2E and mutation testing never run automatically.** There is no CI and no
git hooks.

## Releasing

1. Work on a branch; push it. Vercel builds a preview against jshack-dev.
2. Run the gates by hand: `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run build`,
   plus wire-checks for any `api/` change.
3. Bump the minor version in `package.json` and `package-lock.json`
   (`npm install --package-lock-only`). The version appears in the in-game boot banner.
4. Open a pull request and squash-merge it (`gh pr merge <number> --squash --delete-branch`).
5. Vercel builds `main` and promotes it to production.
6. **Smoke-check the functions.** An empty `POST` must answer `400 {"error":"envelope_invalid"}`:

   ```bash
   curl -s -X POST https://jshack.me/api/network -H 'Content-Type: application/json' -d '{}'
   ```

   `500 not_configured` means the environment variables are missing. A `502` or an
   `ERR_MODULE_NOT_FOUND` in the logs means an import without a `.js` extension.

The client and the server are one deployment, so they always ship together. That matters: both
regenerate the world, and a client and server built from different generator versions would
disagree about every machine.

## Changing the cloud schema

The Supabase CLI is normally **unlinked**. For each cloud project, dev first, then prod:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase migration list --linked   # confirm it applied
npx supabase unlink
```

Order migrations against code: push jshack-dev before merging; push jshack-prod before, or together
with, the merge to `main`. For a drop, deploy the code that stops reading the column first, then drop
it. Leaving the CLI linked risks pushing to the wrong project.

## Rolling back

- **The app**: in the Vercel dashboard use Instant Rollback or promote a previous production
  deployment (`vercel rollback` / `vercel promote <deployment>` with the Vercel CLI), or `git revert`
  the merge on `main`. Front end and functions roll back together.
- **The database**: there are no down migrations. Write a compensating forward migration and push it
  dev, then prod. A destructive migration cannot be reversed without a backup. **Backups and
  point-in-time recovery for jshack-prod are not documented anywhere in the repo**; find out what the
  Supabase plan provides before you need it.
- **Rolling the app back across a schema change** can break the old code if it reads something the
  migration dropped.
- **Environment variable changes** take effect on the next deployment only.

## Secrets

- **Infrastructure secret**: `SUPABASE_SERVICE_ROLE_KEY`, per project. To rotate: regenerate it in the
  Supabase dashboard, update the matching Vercel environment, redeploy, and refresh
  `.env.development.local` locally. There are no other server secrets: players sign with their own
  keys, and there are no third-party API keys.
- **Game "secrets"**: the obfuscated password pools (chapter 6). Changing `secrets.ts` or the codec
  key and re-running `npm run encode` is enough; Vercel re-encodes during `prebuild`. Changing a pool
  changes the generated world for every player.

## Operating production

- **Logs.** Only `console.error` lines in the Vercel runtime logs, prefixed `[network]`,
  `[patches]` or `[sessions]` and a label. Read them in the Vercel dashboard or with `vercel logs`.
  There are no metrics, alerts or error tracker.
- **Data fixes.** There are no admin endpoints. Operators use the service-role key directly, through
  Supabase Studio's SQL editor or a script. `scripts/restoreSite.ts <domain>` is the one operator
  script: it resets a shared fixed site, `findit.io` or `hackademy.io` (ends its sessions, deletes
  its journal, writes a fresh boot marker), and can be pointed at production by supplying production
  credentials by hand.
- **Querying the local database**:
  `docker exec supabase_db_jshack-me psql -U postgres -tAc "select count(*) from patches"`.
  (`supabase db psql -c` does not exist in the CLI version used.)

## Operational gotchas

- **Port 3100 squatter.** Killing `npm run vercel:dev` can leave a child process on port 3100. It
  answers `502` and serves stale code, and a fresh `vercel:dev` silently moves to 3101 with no API.
  Fix (PowerShell):
  `Get-NetTCPConnection -LocalPort 3100,3101 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.
- **Always start with `npm run vercel:dev`, never a bare `vercel dev`.** Only the wrapper loads
  `.env.development.local`; without it every call answers `500 not_configured`.
- **Health probe with the real curl binary**: `curl.exe` in PowerShell, where plain `curl` is an alias
  for `Invoke-WebRequest` (which has shown a spurious empty `500`). Expect `400 envelope_invalid`.
- **`vercel dev` can inject cloud variables** from the Vercel "Development" scope. If local functions
  see cloud values, untick Development on those variables in the dashboard.
- **Non-default Supabase ports.** The local API is on 54421, not 54321. Check with
  `docker ps --format '{{.Names}}\t{{.Ports}}'`.
- **Windows port reservations.** Hyper-V/WinNAT can reserve Supabase's ports at boot (containers start
  with no port mapping, or `bind: ... forbidden`). Check with
  `netsh interface ipv4 show excludedportrange protocol=tcp`; fix with `net stop winnat` then
  `net start winnat` in an elevated shell.
- **Local data survives `supabase stop`/`start`.** Stale bricks, leases and public IPs poison later
  wire-checks. `npx supabase db reset` is the cure.
- **`__encoded.ts` must exist before `npm run vercel:dev`**, which has no pre-hook. On a fresh clone
  run `npm run encode` (or any of `typecheck`, `test`, `dev`, `build`) first.
- **Case-only renames on Windows** can ship import casing that fails on Linux. Check import casing
  after renaming.
- **Do not run Stryker alongside `vercel dev`.** Its sandbox copies (`.stryker-tmp/`) can crash the
  local functions; `rm -rf .stryker-tmp` after a killed run. (ESLint now ignores `.stryker-tmp`, so
  lint is no longer affected.)
- **A player's clock more than two minutes off** makes every request fail with `timestamp_skew`
  (chapter 9).

## Related

- [Chapter 2](./02-local-development.md) for the local setup.
- [Chapter 10](./10-server-and-database.md) for the schema and migrations.
- [`conventions-and-gotchas.md`](../conventions-and-gotchas.md) §4 for the full history of each
  gotcha.
