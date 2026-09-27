# 2. Local development

This chapter gets the game running on your machine with its real server and database, and lists the
commands you will use every day. By the end you will have the game at `http://localhost:3100` talking
to a local Supabase, and you will have run the test suite.

The project has been developed on Windows 11 with Git Bash and PowerShell; the commands below work
in both unless marked.

## Prerequisites

| Tool                            | Why                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Node.js (a current LTS) and npm | Everything. There is no `engines` field; Vercel uses its default Node version.                  |
| Docker Desktop                  | The local Supabase stack runs in containers.                                                    |
| Vercel CLI (`npm i -g vercel`)  | `npm run vercel:dev` runs `vercel dev`, which serves the app and the `api/` functions together. |
| Git and GitHub CLI (`gh`)       | Branches and pull requests (squash-merged with `gh pr merge`).                                  |
| `agent-browser` (optional)      | Manual end-to-end runs ([chapter 11](./11-testing-and-quality.md)).                             |

The Supabase CLI is used through `npx supabase`; it does not need a global install.

## First-time setup

```bash
git clone <repo-url> jshack.me
cd jshack.me
npm install
npm run encode                 # generates src/core/secrets/__encoded.ts (git-ignored)
npx supabase start             # local Postgres + API in Docker; applies supabase/migrations/
npx supabase status -o env     # prints the local URL and keys
```

Create `.env.development.local` in the repository root (it is git-ignored) with the local values from
the last command:

```bash
SUPABASE_URL=http://127.0.0.1:54421
SUPABASE_ANON_KEY=<anon key from supabase status>
SUPABASE_SERVICE_ROLE_KEY=<service role key from supabase status>
```

The local API port is **54421**, not the Supabase default 54321 (`supabase/config.toml` moves the
API, database, Studio and mail ports into the 5442x range).

## Run the game

```bash
npm run vercel:dev
```

This runs `dotenv -e .env.development.local -- vercel dev --listen 3100`: Vite plus the three
`api/` functions on `http://localhost:3100`. The first time, `vercel dev` may ask to link the
directory to a Vercel project; the link metadata (`.vercel/`) is git-ignored.

Check the API is really up with the real curl binary (in Windows PowerShell 5.1, plain `curl` is an
alias for `Invoke-WebRequest`, which has shown a spurious empty 500 here, so type `curl.exe`):

```bash
# Git Bash
curl -s -X POST http://localhost:3100/api/network -H 'Content-Type: application/json' -d '{}'
# PowerShell
curl.exe -s -X POST http://localhost:3100/api/network -H "Content-Type: application/json" -d "{}"
# expect: {"error":"envelope_invalid"}  (HTTP 400)
```

| Answer                      | Meaning                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 envelope_invalid`      | Healthy.                                                                                                                                           |
| `500 not_configured`        | The functions have no Supabase variables: you started `vercel dev` without the wrapper, or the env file is wrong.                                  |
| `502` or connection refused | A stale process holds port 3100, or the server fell back to Vite-only on 3101. See [chapter 12](./12-build-deploy-operate.md#operational-gotchas). |

Open `http://localhost:3100`, create a new game, and try `help`, `ls`, `airmon-ng`, `airodump-ng`.
The version in the boot banner must match `package.json`; if it does not, you are looking at a stale
server.

`npm run dev` starts Vite alone (no API). The game boots, but every server-backed command degrades to
network errors. It is useful only for pure UI work.

### Start over

- **A fresh player:** the in-game `new-game` command clears `localStorage` and reloads,
  giving you a new keypair and so a new world. Opening the page in a private window or another browser
  profile also gives you a separate player, which is how you play two players on one machine.
- **A fresh database:** `npx supabase db reset` drops the local database and replays every migration.
  Use it when earlier runs left bricked machines or stale leases behind.

## Everyday commands

| Command                                                             | What it does                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                 | `tsc -b` over `src/`, `api/` and `scripts/`. (A plain `tsc --noEmit` checks nothing.) |
| `npm run lint`                                                      | ESLint, including the rule that every relative import ends in `.js`.                  |
| `npm test`                                                          | Vitest in watch mode.                                                                 |
| `npm run test:run`                                                  | The whole suite once (about 2 minutes).                                               |
| `npx vitest run <path>`                                             | One file or folder.                                                                   |
| `npm run build`                                                     | Type check, production build, then the world budget check.                            |
| `npm run test:coverage`                                             | Coverage report (not a gate).                                                         |
| `npx dotenv -e .env.development.local -- npx tsx scripts/<name>.ts` | Run one wire-check against the running stack.                                         |

`dev`, `build`, `typecheck` and every `test*` script run `npm run encode` first. `vercel:dev` does
not, which is why first-time setup runs it by hand.

## Working conventions you will meet in review

These are enforced by review, not tools (except the `.js` import rule). The full list is in
[`conventions-and-gotchas.md`](../conventions-and-gotchas.md) §2.

- **No single-letter variable names**, except loop indices `i`, `j`, `k`. Name parameters after what
  they hold (`port`, `machine`, `candidate`).
- **No story, slice or decision numbers in code comments or test titles.** Write the reason itself.
- **Do not reference `plans/` or personal notes from code.** Link a `docs/` file if longer context is
  needed.
- **Every relative import ends in `.js`** (`./x.js` resolves to `x.ts`). Lint enforces it.
- **Bump the version** in `package.json` and `package-lock.json` on feature changes (in practice,
  most merged `feat` and `fix` pull requests bump the minor version)
  (`npm install --package-lock-only`).
- **Command names are the real binary's name**, and a ported command keeps the legacy app's flags and
  error messages.
- **There is no `/etc/shadow`** in this game; passwords are inline in `/etc/passwd`.
- **Prefer small, related helpers in one `<topic>Helpers.ts`** over a file per helper.
- **No backward-compatibility burden until launch.** Schema, ids and generators may be reshaped
  freely today. This ends at the multiplayer announcement.

## Where work is planned

When a piece of work starts, it gets a plan in `plans/<name>.md` while it is in flight, and the plan is
deleted when the work ships, after its lasting facts are folded into `docs/`. Between pieces of work
there is no `plans/` folder, which is normal. The backlog of known, deliberately deferred work is
[`conventions-and-gotchas.md`](../conventions-and-gotchas.md) §9; ideas for the next big feature
(missions) are in [`mission-ideas/`](../mission-ideas/README.md).
