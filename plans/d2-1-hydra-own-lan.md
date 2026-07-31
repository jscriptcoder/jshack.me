# Plan: D2.1 — a player cracks an NPC host on their own LAN

**Status**: Slice 1 **SHIPPED** (2026-07-31, v0.110.0, PR #351 → `4627621`). Slice 2 in progress.
**Parent**: [`d2-credential-layer.md`](./d2-credential-layer.md) (split) →
[`legacy-parity-epic.md`](./legacy-parity-epic.md) (epic, Phase 1).
**Branches**: `feat/apt-extra-files` (slice 1), `feat/hydra-own-lan` (slice 2).

## Goal

A player installs `hydra`, points it at an NPC host on their own LAN, and logs into that host
with a credential the game never told them.

This is the first credential earned in-game. `ssh` has shipped since the ssh epic but takes a
password no player can obtain, so v2's only door has been decorative outside tests. D2.1 opens it.

## Acceptance criteria

- [ ] `apt install hydra` places a readable wordlist at `/usr/share/wordlists/passwords.txt`;
      before the install, no such file exists
- [ ] The wordlist is a normal file on the player's own box — `cat`-able, `nano`-editable, and
      it rides the shared journal like any other file
- [ ] `hydra <npc-host-ip> ssh` reports at least one `login: <user> password: <pw>` line for a
      host on the player's connected LAN
- [ ] `ssh <user>@<npc-host-ip>` with the reported password **succeeds** — hydra and ssh never
      disagree
- [ ] A password absent from the wordlist is never reported, even when it is the account's real
      password (wordlist membership is the sole gate)
- [ ] `hydra` against an address that is not a host on the connected LAN reports the target
      unreachable and cracks nothing
- [ ] `hydra` against a host that is not running ssh reports no service on that port
- [ ] The crack is decided **server-side** — a client that lies about its own wordlist or its
      own machine gets nothing it could not have obtained honestly

## Two design decisions — SETTLED (owner, 2026-07-31)

Both recommendations were taken. The reasoning is kept below because it is the reasoning a
later slice would otherwise re-litigate.

1. **The server reads the caller's wordlist from their own journal.** The client sends its own
   `machine_id`; the server verifies it with `isOwnWorkstation` and replays that machine's
   patches. The wordlist is never a client claim.
2. **With no user named, hydra sweeps every account on the box**, reporting each one that falls.

### A. Where the server gets the caller's wordlist — **from the journal**

The crack must run server-side (the split's finding 1), so the server needs the caller's
wordlist. Two ways:

- **Client sends the list in the payload.** Simplest. But it lets a client post the entire
  obfuscated uncrackable pool — recovered from the bundle per decision 7 — and crack everything
  in one request, with nothing persisted and nothing to see afterwards.
- **Server reads it from the caller's own journal (recommended).** The client sends its own
  `machine_id`; the server verifies it with the shipped `isOwnWorkstation(machineId, publicKey)`
  (`identity/workstation.ts:44`), replays that machine's patches, and reads
  `/usr/share/wordlists/passwords.txt` from the materialized tree.

The second does not make cheating impossible — decision 7 already conceded that — but it forces
the cheat through a real persisted write to the player's own box, which is auditable, is exactly
the in-game action the mechanic intends, and is the same path an honest `nano` append takes. It
also makes the file the single source of truth on **both** the local and cross-player paths, which
is what the split's finding 4 asks for.

### B. What hydra attacks when no user is named — **every account on the box**

`hydra <host> [service] [user]`. With `user` given, attack that account only. Without it, sweep
every account in the target's `/etc/passwd` and report each one that falls. That matches legacy's
output shape (`[22][ssh] host: X login: Y password: Z`, one line per success) and it is what makes
the D2.2 difficulty curve legible later: the player sees `guest` fall and `root` hold.

---

## Slices

### Slice 1: `apt install hydra` puts a wordlist on the player's box

**Class**: Behavior change (`apt` gains a capability it does not have).

**Value**: A player who installs a cracking tool gets the data file that tool is useless without,
and can read and edit it. Honestly stated: this slice is **primarily a horizontal unblock** — it
is small, it delivers little on its own, and it exists because Slice 2 and D1c (`gobuster`) both
need it. The planning skill's four conditions for that are met and are worth stating rather than
glossing:

| Condition | Status |
|---|---|
| Names the vertical slice it unlocks | Slice 2 below, and D1c |
| Leaves the codebase deployable | Yes — additive to `apt`, no other caller changes |
| Has observable verification | `cat /usr/share/wordlists/passwords.txt` |
| Smaller than doing it inside the vertical slice | Yes — keeps a new signed endpoint out of the same PR as a catalog change |
| Introduces no unused abstraction | `extraFiles` has a consumer the moment it lands |

**Actor / trigger / outcome**: player → `apt install hydra` → a readable wordlist exists at a
real path on their box.

**Path**: `apt install` → `APT_PACKAGES` lookup → `env.patches.write` per extra file → journal →
`cat` reads it back.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before code):
1. `AptPackage` gains an optional `extraFiles` — path + content + permissions
2. `apt install hydra` writes `/usr/share/wordlists/passwords.txt`; a package without
   `extraFiles` writes none, and its behaviour is byte-for-byte what it is today
3. The file is world-readable and owner-writable — a normal file, `nano`-editable, NOT a binary
   stub and not root-only
4. A failed extra-file write reports the same `E: Failed to install <pkg> (<error>)` shape the
   binary and library writes already use, and returns apt's error code
5. Extra files are announced in the streamed output like the rest of the install, not written
   silently
6. Before `apt install hydra`, `cat /usr/share/wordlists/passwords.txt` reports no such file

**RED**: a test asserting `cat /usr/share/wordlists/passwords.txt` returns wordlist content after
`apt install hydra`, and no-such-file before it. Currently fails — `apt.ts:162-171` writes
binaries only and `aptPackages.ts:20` has no such field.

**GREEN**: the field, the install-loop step, and the wordlist constant. Nothing more.

**MUTATE**: Stryker over `apt.ts` + `aptPackages.ts`. Expect survivors around the
"package has no extraFiles" branch and the permissions object — both need explicit tests.

**KILL MUTANTS**: a package with no `extraFiles` must be proven to write nothing extra; the
permissions must be asserted as a whole value, not by one field.

**REFACTOR**: assess only. `installPackage` will have three near-identical write loops
(binaries, libraries, extra files) — judge whether that is genuine shared knowledge or three
things that merely look alike. Lean toward leaving them separate; they have different perms,
different failure text, and no reason to change together.

**Known unknown — RESOLVED, and it had a second half.** `patches.write` does NOT create parent
directories: `fsView.ts:107` refuses a write whose container is missing (`parent_not_traversable`).
Replay (`applyPatches`) scaffolds parents, but authorization refuses before replay ever runs. The
half the plan did not anticipate: every `mkdir` is a persisted journal row, so scaffolding `/usr`
— which already exists — would leave a permanent no-op row on the player's box, once per
extra-file package, forever. apt therefore creates only the MISSING ancestors, following
`installPackageLibraries`' existing skip-if-present precedent.

**Done when**: all six criteria pass, mutation reviewed, human approves the commit. ✔ **DONE** —
mutation 97.14% total / 98.55% covered over the changed ranges, no survivors of this slice's code.

---

### Slice 2: `hydra <npc host> ssh` cracks an account, and `ssh` accepts it

**Class**: Behavior change.

**Value**: The first in-game credential. Closes the loop `ssh` has been missing since it shipped.

**Actor / trigger / outcome**: player → `hydra 192.168.x.y ssh` → a `login:`/`password:` line →
`ssh` in with it and land a real session.

**Path**: `hydra` command → new `HydraApi` seam on `CommandEnv` → signed `hydraCrack` action in
`api/sessions.ts` → core handler → regenerate the LAN, resolve the host, materialize its journal,
read `/etc/passwd`, match `md5(word)` per account against the caller's wordlist → report.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before code):
1. `hydra <ip> ssh` against a LAN host running ssh reports every account whose password is in the
   caller's wordlist, one line each, legacy's shape
2. `ssh` with a reported credential succeeds — the same account, the same tier
3. An account whose password is absent from the wordlist is never reported
4. Editing the wordlist changes the result on the next run — the file is read per run, never
   cached or compiled in
5. `hydra` against an IP that is not a host on the connected LAN reports the target unreachable
6. `hydra` against a host with no ssh service reports no service on that port
7. A bricked (unbootable) host is unreachable to hydra, exactly as it is to `ssh`
8. The crack is server-side: the response carries only what the caller's own wordlist could
   already have produced, and a client-claimed foreign `machine_id` is refused
9. `hydra` is unavailable until `apt install hydra` — the existing binary-availability gate
10. The run streams its progress and is Ctrl-C abortable, like `aircrack`

**RED**: a handler test — target host, known passwd, known wordlist → the accounts that fall.
Then a command test for the reported shape. Both fail: neither the handler nor the command exists.

**GREEN**: `handleHydraCrack` modelled on `handleAuthCreateSession` (`sessions/authCreateSession.ts`)
— same `verifySignedRequest` → `generateHomeLan` → `resolveLanHostIdentity` → `findPatches` →
`materializeMachineFs` → `canBoot` preamble, then the wordlist sweep instead of a single
`md5(password)` check, and **no session insert**.

**MUTATE**: Stryker over the handler, the command, and the adapter. Expect survivors on the
per-account loop bounds and the "not in wordlist" branch — the flat pool means almost everything
cracks, so a mutant that reports *everything* may pass a naive test. Test with a password
deliberately outside the wordlist.

**KILL MUTANTS**: at least one account must be proven NOT to fall, or criterion 3 is untested by
construction. Assert the reported set as a whole value, never just its length.

**REFACTOR**: assess whether the shared preamble across `authCreateSession` and `hydraCrack`
(resolve host → materialize → canBoot) is genuine duplicate knowledge worth extracting. It very
likely is — both answer "is this LAN host reachable, and what is its real filesystem?" — but do
it only after green, on its own commit, per the refactoring skill.

**Explicitly NOT in this slice**:
- The `auth.log` trace of the attempt — that is **D2.3**, and it is a different actor's outcome.
  Note that `handleAuthCreateSession` logs unconditionally, so `handleHydraCrack` will be a near
  copy that deliberately does not. Say so in the code, or the omission reads as an oversight.
- The two-pool policy — **D2.2**. Here the pool is flat and effectively everything falls.
- Cross-player targets — **D2.4**. This slice is the own-LAN reachability seam only.

**Wire-check**: `scripts/testHydraOwnLan.ts` against `vercel dev` + supabase. `tsc` cannot see DB
columns or constraints, so the `api/` route is unproven until this runs live. Pick an ESSID with
hosts actually running ssh — D1's slice 4 lost a cycle to an ESSID whose hosts served nothing.

**Done when**: all ten criteria pass, wire-check green, mutation reviewed, human approves.

---

## Pre-PR quality gate (per slice)

1. `npx vitest run` — full suite
2. `npx stryker run --mutate <changed files>` — **dev server must be down**, or it reports false
   survivors
3. `npm run typecheck` (`tsc -b`; a plain `tsc --noEmit` is a no-op here) and `npm run lint`
4. Version bump in `v2/package.json` **and** `v2/package-lock.json`
   (`npm install --package-lock-only`)
5. Slice 2 only: wire-check green against a live stack, ports 3100/3101 killed afterwards

---
*Delete this file when both slices are shipped.*
