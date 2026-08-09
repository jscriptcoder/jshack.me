# Plan: hydra runs where you stand

**Branch**: `feat/hydra-runs-where-you-stand`
**Status**: Active — planned 2026-08-09, no code written yet.
**Parent**: [`d2-credential-layer.md`](./d2-credential-layer.md) (D2 follow-up 2) →
[`legacy-parity-epic.md`](./legacy-parity-epic.md) Phase 1.

## Goal

**A player runs `hydra` from whatever box they are standing on, using the wordlist that box
actually has.**

Two owner-locked principles meet here, both recorded in the parent:

1. **Tools run where you stand** — `hydra`, `john` and `apt install` all work on an NPC box;
   ordinary tier gates apply, but no "this is not your machine" refusal on top.
2. **An NPC box is one box, and tier is the only lens** — everything on it is shared, and what a
   player sees is decided by their user type there, never by who wrote it.

`john` already honours both for free. `hydra` violates the first at **both** ends, and its
server-side wordlist read is the single place in the codebase that violates the second.

## What grounding established (read 2026-08-09 — every file:line below was opened)

Five facts decide the slicing. Three of them cut work out of the plan.

1. **The two ends are not the same check.** `hydra.ts:101` is a bare refusal — deleting it protects
   nothing. `hydraCrack.ts:209-213` is an authorization: the caller *names* the machine their
   wordlist is read from, and `isOwnWorkstation` is the only thing stopping that name being someone
   else's box. The server needs a **replacement rule**, not a deletion.
2. **That replacement rule already exists.** `authorizeMachineAccess` (`authorizeMachineAccess.ts:43`)
   is the shared L1 gate behind `upsertPatch` / `listPatches` / `removePatch`: own workstation →
   bypass, otherwise an ACTIVE `sessions` row for `(player_key, machine_id)` → ok, else 403
   `no_session`. It returns that session's `userType` and `essid`. Adopting it **removes** hydra's
   bespoke check rather than adding a mechanism.
3. **The journal is already shared; only hydra's read is not.** `listPatches` is *"scoped to the
   MACHINE … not to a writer, so every writer's rows on that machine come back"*
   (`listPatches.ts:9-12`), and `materializeMachineFs` replays every writer's rows chronologically,
   latest-write-per-path winning. But `readWordlist` filters `.eq('writer_key', writer_key)` on the
   CALLER's key (`v2/api/sessions.ts:467-477`). Invisible today, because on your own workstation you
   are the only writer.
4. **`env.network` inside a remote session is the PLAYER's own connectivity**, not the box's —
   `networkView` reads a single global `connectivity()` (`ui/env.ts:179-192`). The **essid** that
   comes out is therefore still right (it is the LAN whose hosts you can reach), but
   `wlan0.ipv4` is the player's **workstation** address. Lift the gate alone and a sweep launched
   from a pivot box would be logged on the target as coming from the player's own machine — a false
   trace, and the pivot would buy the attacker nothing.
5. **The wordlist needs no tier branch.** `WORDLIST_PERMISSIONS` is `read: ['root','user','guest']`,
   `write: ['root']` (`defaultWordlist.ts:34-38`). Every tier may read it; growing it stays a root
   act. The tier lens governs the *rule*, and for this file resolves to "everyone standing here".

## Acceptance Criteria

- [ ] A player who roots an NPC box, runs `apt install hydra` **there**, and runs
      `hydra <another host> ssh` from that box gets a crack — no `scp`, no workstation involved.
- [ ] The wordlist hydra uses is the one `cat` shows on that box, **including words another player
      wrote there**; the two can never disagree.
- [ ] A player who holds no session on a box cannot name it as their wordlist source.
- [ ] The target's `/var/log/auth.log` names the box the sweep **actually came from**.
- [ ] Deleting the wordlist still yields `no wordlist — reinstall with: apt install hydra`, and
      that reinstall still restores it.
- [ ] Own-workstation hydra is behaviourally unchanged throughout.

## Out of scope

- **Carrying a GROWN wordlist to an NPC box** — that needs `scp` (D3). Installing hydra on the box
  gives the **default** list; growing it there is `nano` on that box.
- **`AvailabilityRule`** — hydra declares `localhost-only` and the field is read by nothing
  (`registry.ts` wraps only binary + library checks). This plan makes the declaration *more* wrong,
  which is fine: it is inert. Enforce-or-delete stays its own reduction candidate.
- **D2.4 cross-player hydra** — reaching another *player's* box over the `public` /
  `innerGateway` seams is untouched here. This plan is about the box you launch **from**.

## Slices

Two, in this order. Slice 1 first is deliberate: it removes the contradiction **before** slice 2
can expose it. Reversed, the intermediate state ships a shell where `cat` shows a wordlist and
hydra denies one exists.

---

### Slice 1: The wordlist hydra reads is the box's, not the caller's own row

**Value**: any player standing on a box another player has written to gets one consistent answer
about what the wordlist holds. `cat` and `hydra` agree by construction, not by two resolvers
staying in step. Under the shared-box principle this is also the mechanic: a list left on a box
you rooted is loot for whoever roots it next.

**Path**: `hydra` → signed `hydraCrack` → the CALLER-machine's journal, machine-scoped and
chronological, latest write per path winning → the sweep.

**Class**: Behaviour change.

**Built differently from this plan — deviation recorded 2026-08-09.** The plan said to delete
`readWordlist` and point the existing `findPatches` at the caller's machine. Reading the code first
showed a better fit: **`upsertPatch` already owns exactly this query and exactly this rule** — a
`listPathPatches({ machine_id, path })` dep (`upsertPatch.ts:63-74`) returning `PathPatchRow[]`, and
`orderPatchesForReplay(rows ?? []).at(-1)` (`upsertPatch.ts:140`) to pick the row a reader
materializes. hydra now takes the **same dep shape, the same row type and the same rule**, so the
"latest write to one path on one machine" knowledge has one spelling across the codebase and the
api/ helper is a copy of one already proven live.

Reusing `findPatches` would have been worse on two counts: it pulls a machine's ENTIRE journal
(including an unbounded `auth.log`) to read one file, and it would have forced the test double to
serve both target and caller from one mock — destroying the existing test's ability to prove the
wordlist is read from the caller's machine rather than the target's. Dep count is therefore
unchanged; no reduction is claimed.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before any code):
1. Two writers hold rows at `/usr/share/wordlists/passwords.txt` on one machine → hydra uses the
   **latest**, whoever wrote it.
2. A row written **only** by another player → hydra uses it, rather than reporting no wordlist.
3. A deletion row that is latest → `wordlistFound: false`, so the documented
   `apt install hydra` recovery still works.
4. A single-writer own-workstation journal → identical behaviour to today (regression).

**RED**: `hydraCrack.test.ts` — a caller-machine journal whose newest wordlist row carries a
DIFFERENT `writer_key` and holds a password absent from the caller's own older row; assert the
sweep cracks the account that password belongs to. Fails today, because the writer-scoped read
never sees that row.

**GREEN**: call `findPatches({ machine_id: payload.caller_machine_id })`, run
`orderPatchesForReplay`, take the last row at `WORDLIST_PATH`, treat `content: null` as absent.
Delete `readWordlist` from the deps type and from `api/sessions.ts`.

**MUTATE**: Stryker over `v2/src/core/sessions/hydraCrack.ts`. Watch the ordering and
last-wins selection specifically — an off-by-one or a `find` where `findLast` belongs is exactly
the mutant a single-row fixture cannot kill.

**KILL MUTANTS**: expect to need a fixture with **three** rows in non-obvious order, so
"take the last" and "take the caller's" are distinguishable from "take the first".

**REFACTOR**: assess whether the ordered-journal-to-one-file read wants a named helper shared with
`materializeMachineFs`'s consumers, or stays inline. Do not extract for testability alone.

**Wire-check** (`api/` change → mandatory): extend `scripts/testHydraOwnLan.ts` — seed a wordlist
row on the caller's machine under a **second** `writer_key`, assert the sweep uses it. No second
identity is needed: the script already seeds the caller's row directly, so this is one more insert.

**Done when**: all four criteria hold, mutation evidence recorded, `npm run typecheck`,
`npm run lint` and `npx vitest run` green, the wire-check passes live, version bumped to
**0.117.0** in `package.json` + `package-lock.json`, and the human approves the commit.

---

### Slice 2: hydra runs from whatever box you are standing on, and the target's log says so

**Value**: the locked principle, made real and end-to-end with no `scp` — root an NPC box,
`apt install hydra` there, sweep the LAN from it. The pivot is real rather than cosmetic, because
the box you launched from is what the defender reads back.

**Path**: `hydra` on a remote session → signed `hydraCrack` carrying that box's machine_id →
`authorizeMachineAccess` → the sweep → the trace, naming the standing box.

**Class**: Behaviour change.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before any code):
1. hydra no longer refuses to start on a box that is not the player's workstation.
2. The server accepts a `caller_machine_id` the caller holds an **active session** on; the own
   workstation still passes; anything else is 403 `no_session`.
3. The target's `auth.log` line carries the **standing box's** LAN address when the sweep came from
   a generated host, and the client-supplied `source_ip` when it came from the player's own
   workstation — the latter preserving D2.3's deliberate agreement with `ssh`.
4. A sweep from a box the caller was ejected from writes no trace and cracks nothing.

**RED**: two tests. `hydra.test.ts` — a remote session no longer produces
`command not available on this machine`. `hydraCrack.test.ts` — a session-backed
`caller_machine_id` is accepted, a session-less one is 403, and the trace's `from` is the standing
host's IP rather than the payload's.

**GREEN**: delete the `isOwnWorkstation` guard in `hydra.ts`; swap the server guard for
`authorizeMachineAccess` with a `findActiveSession` dep (the same query the patch handlers already
wire in `api/sessions.ts`); derive `fromIp` from the caller machine when it resolves to a host on
the regenerated LAN, else fall back to `payload.source_ip`.

**MUTATE**: Stryker over `hydraCrack.ts` and `hydra.ts`. The source-IP branch is the risk — a
mutant that always takes `payload.source_ip` must be killed by a test asserting the *standing box's*
address specifically, not merely "an address".

**KILL MUTANTS**: ask before hardening anything in the `manual` block — D2.5 established those
survivors are declarative and not worth chasing.

**REFACTOR**: reassess hydra's client-side `connectedWlan0` requirement once the server derives the
source IP. It still supplies the essid, so it likely stays — but the *reason* it stays changes, and
the comment should say the new one.

**Wire-check** (`api/` change → mandatory): extend `scripts/testHydraOwnLan.ts`.
**Note the existing assertion this invalidates**: the script currently asserts a foreign
`caller_machine_id` → `403 not_own_machine`. That error ceases to exist; the assertion becomes
`403 no_session`. Add a session-backed sweep launched from an NPC box, asserting both that it
cracks and that the trace on the target names **that box's** IP.

### As built — three deviations, recorded 2026-08-09

1. **AC 3 narrowed, and a refusal added.** The plan said the trace carries the standing box's
   address "when the sweep came from a generated host". As built it derives the address for a host
   on the caller's **own regenerated LAN** — which is every box the owner's principle actually
   names, NPC hosts and gateways alike. A caller machine that is neither the own workstation nor a
   LAN host (a deep-chain box, another player's workstation) is **refused with a new
   `caller_not_on_lan`** rather than traced. The alternative was writing a trace naming an address
   the server had guessed, and a false origin in a defender's log is worse than a refusal —
   especially now that the log is the attacker's only visible cost. Nothing regresses: those boxes
   could not run hydra at all before this slice.
2. **`availability` corrected to `any-machine`** (it declared `localhost-only`). The plan called
   this out of scope because the field is inert — but leaving a declaration that says the opposite
   of the behaviour is a trap for the next reader, and the fix is one word with no behaviour
   attached. Enforce-or-delete remains open.
3. **Two pre-existing refusal messages gained tests.** `wordlist_lookup_failed` and
   `patches_lookup_failed` were untested strings in the `REFUSALS` map this slice edits; mutation
   flagged them alongside the new entries. Closing them costs two tests and leaves the map wholly
   covered.

**Consequence worth knowing**: because another player's workstation is not a host on your
generated LAN, a player standing on someone else's box still cannot sweep from it. So "B uses A's
wordlist" does not arise yet — the shared-wordlist rule from slice 1 currently reaches only NPC
boxes and gateways. Extending it to a player's box is D2.4's territory, where the source IP has to
come from `resolveCrossPlayerSourceIp` anyway.

**Done when**: all four criteria hold, mutation evidence recorded, gates green, the wire-check
passes live against `vercel dev` + supabase, version bumped to **0.118.0**, and the human approves
the commit.

---

## Pre-PR Quality Gate

Per PR:

1. Mutation run over the changed files, survivors triaged (or an explicit, reviewed `N/A`).
2. Refactoring assessment — applied only where it adds value.
3. `npm run typecheck` (`tsc -b`), `npm run lint`, `npx vitest run` — all from `v2/`.
4. The wire-check script run live; `tsc` cannot see column names, conflict targets or the
   permissions JSON shape.
5. Version bumped in **both** `v2/package.json` and `v2/package-lock.json`
   (`npm install --package-lock-only`).

## Close-out

On the last slice: fold the as-built into [`d2-credential-layer.md`](./d2-credential-layer.md),
update `v2/docs/conventions-and-gotchas.md` §1, refresh the epic's "Next action", and **delete this
file**.

---
*Delete this file when the plan is complete.*
