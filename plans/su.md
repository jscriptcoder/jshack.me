# Plan: `su` — elevate to root via masked password prompt

**Branch**: `feat/v2-su` (or stacked on `feat/v2-apt-install` — see Branch note)
**Status**: Proposed — awaiting approval of decisions + slices
**Unblocks**: `apt install` (Story 1.5) — found unreachable in live E2E because no elevation path
exists (`su` was `command not found`, player is `user`). See `plans/apt-install.md` reachability note.

## Goal

A player runs `su`, is prompted (masked) for the root password, and on the correct password
becomes **root** — the prompt reflects it and root-gated commands (`apt install`) now work. Wrong
password → `su: Authentication failure`, still the original user.

## Owner decisions (locked 2026-06-05)

1. **Input**: **interactive masked prompt** — `su` → hidden `Password:` line (NOT an inline arg).
2. **Target**: **root only** — no `su <username>` yet (real su's no-arg default).
3. **Validation**: against the **`/etc/passwd` root hash** — `md5(typed) === root row hash`
   (source of truth; survives a future in-game `passwd`; exercises the readable-passwd surface).
4. **Elevation**: **push a root session onto `hopChain`** via a new env seam; a later `exit` slice
   pops back to the user (matches legacy + the existing `hopChain` field).

## Context the plan rests on (verified)

- **No session-mutation seam today** — `CommandEnv` exposes only `setCwd`/`setInterface`; `session`
  is set once in `ui/state.ts` `startGame`, and `hopChain` is always `[]`. `su` needs a new seam.
- **No interactive/masked input today** — `terminal.tsx` is a single plain input; the only
  takeovers are `ModeChange` (nano/lynx/nc/ftp/mysql/redis), which are fire-and-forget (wrong shape
  for "prompt then continue in the same `execute`"). A promise-returning prompt seam fits `su`.
- **`/etc/passwd` is `read: ['root','user']`** (`workstationFs.ts`) — a `user`-tier `su` can read it;
  `guest` cannot (intended boundary). Root row carries `md5(rootPassword)`.
- **`md5` exists** in v2 core (`core/generation/md5.ts`).
- **No `exit` command** — Slice 2 here.
- **`/bin/su` already exists** in the base FS (`SYSTEM_UTILITY_NAMES`) and `libraryDeps` maps
  `su: ['libpam','libcrypt']` — so the binary + library gates already resolve for a `su` command.

## New seams this introduces (the bulk of the work)

### `env.prompt` — the GENERAL, reusable interactive-input primitive (design for reuse)

This is **not** an su-specific helper. It is the one interactive-input flow every credential-taking
command reuses — `su` is merely **consumer #1**. Designed once, correctly, so `ssh`, `scp`, `ftp`,
`mysql`, `redis`, `hydra`, … all drive the same flow (mirrors legacy's shared `promptMode`
`'username' | 'password'` + masked input, but promise-shaped instead of callback/mode-shaped).

```ts
// CommandEnv seam (sibling to env.sleep / env.signal)
readonly prompt: (opts: { readonly message: string; readonly masked: boolean }) => Promise<string>;
```

Requirements the primitive must satisfy so later commands need NO new infra:

- **Masked or plain** — `masked: true` for passwords (hidden, not echoed), `masked: false` for
  usernames/hosts. (legacy's `'username' | 'password'` modes collapse into the `masked` flag.)
- **Composes sequentially** — `ftp` needs username THEN password: two awaited `env.prompt` calls in
  one `execute`. The promise shape makes this trivial (`const u = await env.prompt(...); const p =
  await env.prompt({ masked:true, ... })`) — no per-command UI wiring.
- **No history / no tab-complete** while a prompt is pending (legacy disabled both).
- **Ctrl-C cancels** — rejects the promise via `env.signal` (like `env.sleep`), so the awaiting
  command aborts cleanly (no half-elevation).
- **Logic stays in core** — the command does the validation/auth after the await; the UI only
  supplies the input channel (a "pending prompt" terminal state that masks input and routes the next
  submitted line to the resolver instead of running a command).

Future consumers (do NOT build now — consumer-driven; listed so the API is shaped right):
`ssh user@host` → password prompt; `scp` → password; `ftp` → username + password; `mysql`/`redis`
→ password; `hydra` drives candidates programmatically (no prompt) but the auth-check it calls is the
same core path. Build the primitive WITH `su` (real consumer), not speculatively — but shape the API
to these cases now so it isn't reworked per command.

### `env.pushSession` — session elevation

- **`env.pushSession(session): void`** — elevate by pushing a new `Session` onto the `hopChain`
  stack (sibling to `setCwd`/`setInterface`); the UI owns the `session` + `hopChain` signals and
  reflects the new active session (prompt, tier) on the next command's env. Reused later by ssh/nc/su
  (every "you are now a different session" transition).

_The masked-input UI + pending-prompt routing + session-signal update are browser behavior →
verified by **E2E** (agent-browser), not vitest integration tests (per the testing preference)._

## Acceptance Criteria

- [x] `su` with the correct root password → session becomes root (prompt shows `root@<machine>#`),
      cwd moves to `/root`, and `apt install nmap` then succeeds. _(unit + live E2E)_
- [x] `su` with a wrong password → `su: Authentication failure`, exit 1, still the original user,
      no session pushed.
- [x] The password entry is **masked** in the terminal and not added to command history. _(E2E)_
- [x] Validation is against the `/etc/passwd` root hash (changing the stored hash changes what `su`
      accepts) — proven in unit tests with a crafted passwd (+ root-row-specificity test).
- [x] `guest` (who cannot read `/etc/passwd`) cannot `su` to root.

> **Slice 1 SHIPPED (pending commit).** Live E2E (su → masked prompt → root → WiFi crack → online →
> `apt install nmap` → `/usr/bin/nmap` → reload-persists) **caught a real server-seam bug the unit
> tests missed**: `BINARY_STUB` contained NUL bytes, which Postgres TEXT rejects, so the real
> `apt install` write failed with `network_error`. Fixed: `BINARY_STUB` is now NUL-free (comment +
> regression test in `apt.test.ts`). This is the legacy lesson in
> `feedback_e2e_test_new_primitives` recurring — exactly why the cross-layer seam is E2E'd, not
> unit-stubbed.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing
test. Load `tdd`, `testing`, `mutation-testing`, `refactoring` first. `npm run lint` in `v2/`
(no Prettier). Bump version per slice. Cross-layer/UI behavior is E2E-verified, not vitest-integration.

### Slice 1: `su` → masked prompt → validate → become root

**Value**: Player can elevate to root, unblocking every root-gated command (apt install first).
**Path**: new `su` command (`tier:'guest'` so it's runnable to attempt elevation; gate is the
password, not the command) → `await env.prompt({ message:'Password:', masked:true })` → read
`/etc/passwd`, parse the `root` row, compare `md5(typed)` to its hash → on match,
`env.pushSession(rootSession)` + `env.setCwd('/root')` + success; on mismatch (or unreadable passwd)
→ `su: Authentication failure` exit 1, nothing pushed. Add the `env.prompt` + `env.pushSession` seams
(core types + `ui/env.ts` + `ui/state.ts` + `terminal.tsx`). Register `su`. Skipped: `su <username>`,
`exit` (Slice 2), inline-password arg.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `api-design`.
**Acceptance criteria**: the correct/wrong-password, masked-entry, /etc/passwd-source, and
guest-cannot criteria above. Core logic (validate + elevate) is unit-tested with a mocked
`env.prompt` + crafted `/etc/passwd` + a `pushSession` spy; the masked UI + prompt routing + prompt
reflecting root is **E2E**. **Confirm before code.**
**RED**: `su` unit tests — correct pw ⇒ pushSession called with a root `Session` + setCwd `/root` +
success; wrong pw ⇒ no pushSession + `Authentication failure` + exit 1; md5 compared to the passwd
row (vary the stored hash); guest/unreadable passwd ⇒ failure. Mutator watch: the hash-equality
compare, the success/failure branch, the exit code, the "nothing pushed on failure" side-effect.
**GREEN**: seams + `su` logic + registry wiring + minimal terminal masked-prompt handling.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met, mutation report reviewed, **E2E run** (su → masked prompt → root →
`apt install nmap` → `ls /usr/bin` → reload still installed), human approves commit.

### Slice 2: `exit` → drop the elevated session

**Value**: Player returns from root to their user (round-trips the elevation).
**Path**: new `exit` command → pops the top of `hopChain` via a new `env.popSession()` seam (or
reuse a session seam), restoring the previous `Session` (prompt/tier/cwd). At the base session,
`exit` is a no-op (or `logout`-style message) — it does NOT close the game. Skipped: SSH/nc session
exits (those land with those features).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: after `su` then `exit`, the session is the original user again (prompt +
tier); at base, `exit` doesn't break the terminal. Core unit-tested; the prompt/tier change is E2E.
**Confirm before code.**
**RED**: pop restores the previous session; base-session exit is a safe no-op. Mutator watch: the
empty-stack guard, the restore.
**GREEN**: `popSession` seam + `exit` command + registry wiring.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met, mutation report reviewed, E2E (su → exit round-trip), human approves.

## Branch note

`apt install` (Slice 1) is committed on `feat/v2-apt-install` but unusable without `su`. Options to
decide when coding starts: (a) build `su` on the same branch so one PR ships "package install +
elevation" as a usable unit, or (b) `su` on its own branch/PR off `main`, merged first, then apt.
Recommend (a) — apt + su are one coherent capability and apt is dead without su.

## Pre-PR Quality Gate (each slice)

1. Mutation testing (`mutation-testing`) — report reviewed.
2. Refactoring assessment (`refactoring`).
3. `npm run lint` + typecheck + `npm run test:run` pass in `v2/`.
4. **E2E through the UI** (agent-browser on `localhost:3100`): `su` → masked `Password:` → correct
   pw → `root@<machine>` prompt → `apt install nmap` succeeds → `ls /usr/bin` shows it → reload →
   still installed. Wrong pw → `Authentication failure`, still user.

---

_Delete this file when both slices ship. `su` unblocks `plans/apt-install.md`._
