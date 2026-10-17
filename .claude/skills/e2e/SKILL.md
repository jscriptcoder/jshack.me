---
name: e2e
description: Drive the jshack.me game live in a real browser with agent-browser against `vercel dev` + local supabase. Use whenever a slice needs browser-only confirmation (terminal flows, the nano editor, keyboard/focus), when asked to "run the app", "smoke test", "E2E this", or take a screenshot of the game, and before writing any agent-browser command against this project. Holds the preflight, the exact in-game command sequences to reach a given state, the terminal/DOM quirks, and how to derive seeded secrets offline.
---

# Live E2E runbook

Everything here is verified against the running game. Follow the recipes rather than
rediscovering the in-game commands — several have ordering traps that fail with unhelpful
errors.

**Scope.** E2E is reserved for browser-only behaviour Vitest can't reach: terminal flows, the
nano editor, keyboard/focus, full UI journeys. Do NOT duplicate unit or wire-check coverage
here. If a claim can be proven by a `scripts/test*.ts` wire-check, prove it there instead — it
is faster and more precise.

This file holds what every run needs. Read the reference for your scenario before driving it:

| You need to… | Read |
| --- | --- |
| Open sessions, wait for the prompt, type commands, read output, edit in nano | [`references/driving-the-terminal.md`](references/driving-the-terminal.md) |
| Get a new player connected, then onto a service, a deep layer, a generated machine, a phone, or the AP gateway | [`references/reaching-a-state.md`](references/reaching-a-state.md) |
| Run a second player, two players on one network, or two terminals of one player | [`references/two-players.md`](references/two-players.md) |
| Work out a seeded password offline, or read the local database | [`references/offline-secrets.md`](references/offline-secrets.md) |
| Publish a page, get on findit/chainit, show a site defaced and restored | [`references/fixed-sites.md`](references/fixed-sites.md) |
| A long two-player journey (bricked gateway, shared LAN, web surface, path sweep) | [`docs/e2e-shared-network-verification.md`](../../../docs/e2e-shared-network-verification.md) |

Helpers in [`scripts/`](scripts/), each taking the session name first:

- `type-command.sh <session> "<cmd>"` — focus, type, check the field, then Enter.
- `eval "$(cat .claude/skills/e2e/scripts/wait-for-prompt.js)"` — returns `prompt` or `TIMEOUT`.
- `close-nano.sh <session>` — `^X` with retries until the terminal is back for sure.

---

## 1. Preflight (always, in this order)

1. **Kill the port squatter.** Killing a `npm run vercel:dev` background task does NOT kill its
   child vite process; it orphans on 3100, a fresh start silently falls back to vite-only on
   3101, and every `/api/*` call then 502s.
   ```powershell
   Get-NetTCPConnection -LocalPort 3100,3101 -State Listen -ErrorAction SilentlyContinue |
     ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
   ```
2. **Start the server** as a background task, with **no inner `&`** (an inner `&`
   detaches it, the wrapper exits, and an old-code server may keep serving):
   `npm run vercel:dev`
3. **Confirm it is serving the API**, not just vite. An empty POST must return **400** (not
   502/000):
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3100/api/network \
     -H 'Content-Type: application/json' -d '{}'
   ```
4. **Confirm it is YOUR code.** The ASCII banner prints the version from `package.json`. Check it
   matches the version you just bumped — this is the cheapest guard against testing a stale
   orphaned server.
5. **Local supabase must be up** — `npx supabase status`. If you need a clean world,
   `npx supabase db reset` — without `--linked` it resets only the local stack, and
   `SUPABASE_URL` in `.env.development.local` is `127.0.0.1`.

**Never run Stryker while the dev server is up** — it reports false survivors and reloads the
app mid-run, resetting any `su` elevation.

---

## 2. Open a session

```bash
agent-browser close --all                                      # REQUIRED before --headed
agent-browser --session alice open http://localhost:3100 --headed
agent-browser --session alice snapshot -i                      # interactive refs (@e1, @e2 …)
```

The traps that bite on every run (detail in
[`references/driving-the-terminal.md`](references/driving-the-terminal.md)):

- **`--headed` is silently ignored if a daemon is already running** — `close --all` first.
- **`open` often never returns**, but the page IS loaded. Confirm with `eval "location.href"`.
- **`close --all` is GLOBAL and destroys the identity** (the owner key lives in that profile's
  `localStorage`). Mid-run close one session (`--session bob close`), and name every player.
- **Snapshot refs go stale after any DOM change** — re-`snapshot -i` after every click.
- **Wait for the PROMPT, never for output to stop growing** — use `wait-for-prompt.js`.
- **One command per step, verified before Enter** — use `type-command.sh`.
- **Never type while nano is open** — close it with `close-nano.sh` first, or the next command
  lands in the buffer and is saved with it.
- **Wrap every `eval` body in an IIFE** — `const`/`let` leak across calls.

---

## 3. Teardown

```bash
agent-browser close --all
```
then re-run the §1 port kill. Verify 3100/3101 are clear; a survivor will silently serve stale
code to the next session.

---

## 4. Extending this skill

Add a recipe whenever you reach a state that cost you more than one wrong attempt. Keep the
shape: **target state → numbered commands → the trap in each**. Traps are the value; a bare
command list will be re-derived correctly anyway, but an ordering trap costs a full cycle every
time.

Put it in the reference that owns its scenario, not here. This file keeps only what every run
needs — preflight, session basics, teardown and the routing table — so a new reference is
warranted only when a scenario fits none of the existing ones; add its row to the table above.
Still unwritten: a pivot more than one layer down.
