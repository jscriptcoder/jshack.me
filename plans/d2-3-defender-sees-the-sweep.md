# Plan: D2.3 — the defender sees the sweep

**Branch**: `feat/defender-sees-the-sweep`
**Status**: Slice 1 GREEN at v0.114.0 — all nine acceptance criteria met, awaiting commit approval

> **Evidence.** 2292 tests / 134 files green; `tsc -b` + `eslint` clean. Mutation on
> `hydraCrack.ts`: **98.67%**, 148 killed, **0 timeouts**, 2 survivors, both provably equivalent
> (see "Mutation outcome" below). Wire-check `testHydraOwnLan.ts` **17/17 live** against
> `vercel dev` + supabase, six of them net-new trace checks.
**Parent**: [`d2-credential-layer.md`](./d2-credential-layer.md) row D2.3 → [`legacy-parity-epic.md`](./legacy-parity-epic.md) Phase 1

## Goal

A hydra sweep stops being invisible: every password it tries against an own-LAN host lands in that
host's `/var/log/auth.log`, so the box's occupant can read the attack back.

## Why this slice, and why now

It was picked over D2.5 (`john`) because grounding the code killed D2.5's stated reason to exist.
`hydraCrack.ts:176` already sweeps **every** account in the target's `/etc/passwd` against the
caller's own wordlist, so `john` on a hash from any hydra-reachable host returns exactly what hydra
already printed — same wordlist, same `md5`, same answer. The full finding is in the parent split
under "D2.5 grounding, read 2026-08-09".

D2.3 is what fixes that. `hydraCrack.ts` says so in its own docstring today:

> *"NOT here: the attempt's `auth.log` trace. A sweep is far noisier than a login and the
> defender's view of it is its own slice; this handler deliberately writes nothing, unlike its
> `authCreateSession` model, which logs every attempt."*

Once a sweep costs the attacker a visible wall of `Failed password` lines, **offline cracking has a
reason to exist** — `john` becomes the silent alternative rather than a slower hydra. So this slice
is both independently valuable (the actor flip that made D1's slice 4 worth its own PR) and the
thing that unblocks D2.5's value with no new content and no new generation.

## What already exists — read 2026-08-09, not recalled

Almost all of it. This slice is wiring plus one new decision about volume.

| Piece | Where | State |
|---|---|---|
| The line format | `logging/authLog.ts:71` `formatSshdAuthLine` | Shipped. `Failed password for <user> from <ip>` / `Accepted password for …` |
| The log's storage identity | `logging/authLog.ts:26-32` `AUTH_LOG_PATH` / `_OWNER` / `_PERMISSIONS` | Shipped. Root-owned, root-write, **world-readable** — a guest occupant can `cat` it |
| The owner-keyed appender | `patches/appendMachineLog.ts` | Shipped |
| The exact pattern to copy | `sessions/authCreateSession.ts:110-137` `logSshAttempt` | Shipped — stamp `deps.now()`, `derivePid`, append best-effort, swallow errors |
| The client's own LAN IP | `commands/ssh.ts:268` — `const sourceIp = wlan0.ipv4` | Shipped. `hydra.ts:108` already holds the same `wlan0` |
| The sweep itself | `sessions/hydraCrack.ts:176-181` | Shipped, and writes nothing |

**Net new**: build the lines, append them, pass a source IP through `hydra` → the signed payload →
the handler, and widen the handler's deps + `api/sessions.ts:477` wiring.

## Decisions this plan takes

### 1. One line per password TRIED, not one per account — this is the whole point

A sweep must read as a sweep. `crackAccount` already models the attempt as `words.find(…)`, so the
volume is free: for an account that held, one `Failed password` per word in the list; for an account
that fell, one `Failed password` per word tried *before* the match, then one `Accepted password`.

The alternative — one summary line per account — was rejected. It would make a sweep of three
accounts quieter than three ordinary ssh logins, and "hydra is loud" is the only thing this slice
sells. Loudness is the mechanic, not decoration: it is what makes `john`'s silence worth paying for
and, later, what a rate-limit or lockout counter-move would have to react to.

**Accepted cost**: a default wordlist is ~37 words and an NPC box has 3 accounts, so one sweep
writes ~110 lines, and repeat sweeps grow the log without bound. That is the attacker's cost made
visible, and it is exactly what a real `auth.log` does. Written as **one** append, not 110.

### 2. Client-supplied source IP on the own LAN — matching `ssh`, not `resolveCrossPlayerSourceIp`

The parent split's D2.3 row says "server-derived source IP". Grounding says that would make hydra
*differ from `ssh`*: `authCreateSession.ts:196` uses `payload.source_ip ?? 'unknown'` for a same-LAN
login, and only the cross-player writers use the server-authoritative
`resolveCrossPlayerSourceIp`. On your own generated LAN the occupant is an NPC and there is nobody
to frame, so forging the field costs nothing and consistency with `ssh` is worth more than purity.
**Server derivation arrives with D2.4**, where the box belongs to another player and the field
becomes forgeable in a way that matters.

### 3. Log exactly what was attempted — a refused sweep writes nothing

`host_unreachable`, `service_not_running`, a bricked box, `not_own_machine`: nothing reached the
target, so nothing is written. A sweep with no wordlist row (`wordlistFound: false`) tried no
passwords, so it writes nothing either. This keeps the rule stateable in one line and stops a
dead machine from being probed through its own log.

### 4. One timestamp and one pid for the whole sweep

Real `sshd` forks per connection, so a purist would vary the pid. One sweep is one attack, one
`deps.now()` stamp, one `derivePid` — the collapsed version. Varying them adds a per-line seam
nobody can act on. Revisit only if a later slice needs to distinguish concurrent attackers.

## Acceptance Criteria

**Present for approval before any code is written.**

- [ ] After a sweep against an own-LAN host, that host's `/var/log/auth.log` carries one
      `Failed password for <user> from <attacker LAN IP>` line for every wordlist word tried
      against every account that held
- [ ] An account that fell carries `Accepted password for <user> from <ip>` instead, preceded only
      by the words tried before the match
- [ ] `hydra <host> ssh root` traces **only** `root` — a named sweep does not fabricate attempts
      against accounts it never attacked
- [ ] The trace records the attacker's real LAN IP, the same address `ssh` records for a login from
      the same machine
- [ ] A sweep that never reached the box — unknown host, service not running, bricked — writes
      nothing at all
- [ ] A sweep with no wordlist on the caller's box writes nothing
- [ ] The lines are **appended**: an earlier `ssh` login trace on that box survives the sweep, and a
      second sweep adds to the first
- [ ] The log stays root-owned and world-readable, so a guest-tier occupant can `cat` it
- [ ] A logging failure never changes the sweep's result — the cracked credentials still come back

## Slices

### Slice 1: A hydra sweep leaves its attempts in the target host's `auth.log`

**Value**: The attacker stops being invisible. The box's occupant reads back exactly which accounts
were swept, with how many attempts, from which address.
**Path**: `hydra <host> [service] [user]` → `env.hydra.crack` with the caller's `wlan0.ipv4` →
signed `hydraCrack` action → `handleHydraCrack` sweeps as today → builds the attempt lines →
`appendMachineLog` writes one block to the target's `AUTH_LOG_PATH` under the caller's writer key →
occupant runs `cat /var/log/auth.log`.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
`reduce-system-complexity` — `N/A`, this adds a trace rather than retiring a mechanism.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria**: the list above, in full.

**RED**: Extend `sessions/hydraCrack.test.ts` — a sweep against a host whose accounts partly hold
produces the expected `Failed`/`Accepted` lines through the injected appender, in order; a named
sweep traces one account; each refusal path writes nothing. All fail today because the handler
writes nothing.

**GREEN**: The minimum — a line builder over the existing `words`/`accountsUnderAttack` pair, one
`appendMachineLog` call modelled on `logSshAttempt`, `source_ip` added to the payload schema,
`hydra.ts` passing `wlan0.ipv4`, and `readAuthLog`/`upsertPatch`/`now` added to `HydraCrackDeps` and
to the `api/sessions.ts:477` wiring.

**MUTATE**: `npx stryker run --mutate src/core/sessions/hydraCrack.ts` (dev server DOWN;
`timeoutMS` is already 30000 in the config since D2.2). Expect the outcome/`find`-index boundaries
and the refusal guards to be the mutants that matter.

**KILL MUTANTS**: Address survivors in the touched code. Pre-existing survivors elsewhere are
logged, not folded in.

**REFACTOR**: `logSshAttempt` and this appender will be near-identical. Assess extracting the shared
"stamp + append best-effort" step **only after green** — two call sites is the threshold to think
about it, not automatically the threshold to do it.

**Wire-check**: `scripts/testHydraOwnLan.ts` (11/11 today) extended to read the target's `auth.log`
back after a sweep. `api/` changed, so this slice is unproven until it runs live against
`vercel dev` + supabase.

**Done when**: every acceptance criterion holds, the mutation report is honest (timeouts drained),
`npm run typecheck` + `npm run lint` + `npx vitest run` are green, the wire-check passes live, the
version is bumped in `v2/package.json` + `v2/package-lock.json`, and the human approves the commit.

## Mutation outcome

First run: **96.67%**, 5 survivors. Three were real and were killed; two are equivalent.

**Killed — one of them the slice's own claim.** `matchedAt === -1 ? words.length : matchedAt + 1`
mutated to always-`words.length` and **survived**, because the original test put the matching
password LAST in the wordlist, where "stop at the match" and "try everything" give the same line
count. Moving the match into the middle of the list killed it. That mutant is exactly the bug the
defender would see: attempts the attacker never made. The other two were an unnamed error body on
the signature-rejection path (a nameless refusal reaches the player as a generic network error) and
an unvalidated payload — both now asserted.

**Equivalent, left alone:**

- `matchedAt === -1 ? undefined : words[matchedAt]` → always `words[matchedAt]`. For an array,
  `words[-1]` *is* `undefined`, so both branches produce the same value. The explicit guard stays:
  switching to `words.at(matchedAt)` would return the **last** word instead, which is a real bug the
  sentinel currently hides.
- `outcome: … ? 'success' : 'failure'` → `''`. `formatSshdAuthLine` only ever compares against
  `'success'`, so any other value takes the same branch. Type-invalid as well — `outcome` is
  `'success' | 'failure'`.

`hydra.ts` scored 64.36% with 36 survivors, **none in the changed path**: 28 are man-page/metadata
strings and 8 are pre-existing refusal messages, the streaming banner and blank spacer lines. Logged,
not folded in.

## Refactoring assessment — extraction earned, deliberately deferred

`recordSweep` is the **seventh** near-identical best-effort auth.log appender in `core/sessions/`
(`authCreateSession`, `…SameLan`, `…Public`, `…InnerGateway`, `authElevateSession`, and now this).
The duplicated knowledge is real — "how a system-written auth.log line lands on a machine" — so
extraction is earned by the codebase rather than speculative. It is **not** folded into this slice:
it would touch six files this behaviour change has no other reason to open, each with its own tests
and mutation profile, and it would make the diff unreviewable against the claim it is here to prove.
**Follow-up PR**, pure behaviour-preserving.

## Fixed on the way past

**A latent flake in `nmapScan.test.ts`, proven rather than assumed.** The full suite failed once at
`does not trace an occupant at its DERIVED octet once its lease moved elsewhere`. The test's own
comment claimed `.7`/`.8` were "outside the range either derivation can produce" — false. A 20000-draw
probe found derived octets uniform across the whole 2-254 range, hitting `.7` 79 times: a ~0.4%
failure rate per run, in code this slice does not touch. `setup` now draws identities whose derived
octet avoids the redrawn pair, and the false comment is corrected. Structural, not a retry loop.

## Pre-PR Quality Gate

1. Mutation report on `hydraCrack.ts` — timeouts drained, survivors classified
2. Refactoring assessment on the duplicated append step (`reduce-system-complexity` `N/A`)
3. `npm run typecheck` + `npm run lint`
4. `npx vitest run` full suite
5. `scripts/testHydraOwnLan.ts` live, and ports 3100/3101 killed after
6. Version bump in both `v2/package.json` and `v2/package-lock.json`

## Follow-ons this slice unlocks or defers

- **D2.5 (`john`)** — its value becomes legible the moment this ships. Re-plan it after, and fix
  the parent's acceptance example first: guest **cannot** read `/etc/passwd`
  (`baseFs.ts:26-32`), so the loot path is a cracked `user` account.
- **Unbounded `auth.log` growth** — accepted here, named as the attacker's cost. A cap or rotation
  is a separate slice, and nothing today needs it.
- **Rate limiting / lockout** — the counter-move this trace would feed. Parked in the split; not
  legacy parity.

---
*Delete this file when the slice ships; fold its as-built into the parent split.*
