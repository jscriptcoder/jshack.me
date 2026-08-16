# Plan: D3b — `scp`, the transfer

**Branch**: `docs/plan-d3b-scp` (this plan) → `feat/scp-*` per slice
**Status**: COMPLETE — all three slices shipped (v0.137.0, v0.138.0, v0.139.0)
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) — Phase 1, door D3b
**Grilled**: 2026-08-14 — five locked decisions + three-slice spine in the epic's
["D3b — resolved scope & decisions"](legacy-parity-epic.md#d3b--resolved-scope--decisions-grill-me-2026-08-14)

## Goal

A player copies one file between two machines with a single command, authorized by a
credential they already earned, leaving the target's log a login line and nothing else.

## Why this is the smaller half

`scp` ships behind an existing binary (`generation/binaries.ts:60` already lists it, with
`libssl` in `libraryDeps.ts:46`) — there is no `apt`, availability or placement work. It
inherits both halves of the door D3 built:

| What D3 shipped | Where | What D3b does with it |
|---|---|---|
| Kind-parameterized session creation | `authCreateSession.ts:100` (`kind` on the payload), `DOOR_KINDS` | Adds a third kind; splits kind-as-provenance from kind-as-service |
| The remote patch binding | `state.ts:408` `onFtpWrite` → `writeToFtpTarget` | The upload's write, unchanged |
| A second journal beside the shell's | `state.ts:377` `ftpRoot`, `refetchFtpPatches` | The download's read of the target's REAL state |
| `land()`'s `isNew` rule | `ftpShell.ts:104` | Both directions, extracted (slice 1) |
| Server-side session teardown | `endSession.ts`, `sessionsApi.ts:315` `endServerSession` | The `end` of create → transfer → end |

What D3b owns alone: the **transient** session lifecycle, **two-endpoint resolution** in one
command, and the announce-then-one-line UX.

## Grounding that changed the plan before it was written

Three things the code says that the grill could not have known:

1. **`kind` currently does double duty, and slice 1 must split it.**
   `authCreateSession.ts:202` is `const spec = SERVICE_CATALOG[payload.kind]` — the stored
   provenance kind IS the catalog key. Decision 2 requires `scp` to be stored as `scp` but
   logged through the **ssh** row (`SYSLOG_AUTH_SWEEP` → `formatSshdAuthLine`, `auth.log`).
   There is no `SERVICE_CATALOG.scp` and there must not be one: scp is not a service, it
   rides sshd. The collapsed fix is one three-row lookup, not a new column:

   ```ts
   const SERVICE_BY_DOOR = { ssh: 'ssh', ftp: 'ftp', scp: 'ssh' } as const;
   const spec = SERVICE_CATALOG[SERVICE_BY_DOOR[payload.kind]];
   ```

   That makes decision 2 true **by construction** — there is no scp log line to forget to
   suppress, because scp has no log of its own.

2. **The shipped listening check gives decision "scp reaches what ssh reaches" for free —
   and correctly does NOT inherit ssh's exemption.** `authCreateSession.ts:213` is
   `payload.kind !== 'ssh' && !listening`. With `scp` mapped to the ssh spec, the check runs
   (kind is `'scp'`, not `'ssh'`) against `spec.service === 'ssh'`, so a box with sshd down
   is refused server-side — while plain `ssh` keeps its documented, backlogged exemption.
   **Do not "fix" this asymmetry**: it is the grill's rule landing on the existing gate.

3. **No migration.** `supabase/migrations/20260607000000_sessions.sql:28` is
   `kind TEXT NOT NULL` with no check constraint. And a stray `scp` row cannot corrupt boot:
   `sessionRehydrate.ts:43` rebuilds only `HOP_KINDS`, a whitelist scp is not on.

## Open questions — resolved

The grill left two "open for planning". Both take the collapsed answer:

1. **An existing active session on the target: reuse, or always create-and-end?**
   **Always create-and-end.** The row's lifetime is exactly one command, there is no cache to
   invalidate when the other session ends, and reuse would make `scp` behave differently
   depending on invisible state. Cost accepted: a second `Accepted password` line in the
   target's `auth.log` when the player already holds a session there — which is truthful, and
   is what real sshd does.
2. **`-P` as an alias for `-p`.** **Not shipped.** An alias nobody can observe in-game has no
   test that can fail; it stays free to add later (decision 5 makes `-p` canonical either way).

## Acceptance Criteria

- [x] A player copies a file from the box they are standing on to a machine they hold a
      credential for, and the file is there afterwards at the tier the credential bought
- [x] A tier the credential does not carry refuses the write, and no partial file exists
- [x] A player copies a file OFF a remote machine onto the box they are standing on
- [x] The target's `/var/log/auth.log` records one login line, indistinguishable from an
      interactive `ssh` login, and **no line names the file** in either direction — the login
      half by the handler tests (one endpoint, one kind, no direction is even sent), the
      silence by a test running the same theft through both doors with one ledger watching
- [x] The session row that authorized the transfer is gone once the command returns
- [x] A source path that does not exist is reported before anything reaches the target's log
- [x] Ctrl-C during the round-trip leaves no file and no session row — at the password prompt,
      after the session opens but before either transfer starts, and (download only, the one
      place the gap exists) between the remote read and the local write
- [x] Both directions work against another player's box through a NAT forward
- [x] `scp` refuses a host whose sshd is not running, whatever else it serves
- [x] A relative remote path resolves from the home of the account logged into, both directions
- [x] A write that fails for network reasons says so, rather than blaming the player's tier

## Slices

Three slices, each a behavior change following RED → GREEN → MUTATE → REFACTOR. Every slice
loads `tdd`, `testing`, `mutation-testing`, and `refactoring`.

---

### Slice 1: A player carries a file onto a box they hold — ✅ SHIPPED (PR #401, v0.137.0)

**Value**: A player standing on a rooted pivot puts a grown wordlist where the sweep will
read it — closing D2.5's named gap. Upload, own LAN.
**Path**: `scp <src> <user>@<host>:<path> [-p port]` → local read (`env.fs`) → ssh port
auto-detect from the target's `/var/run/sshd.pid` → `authCreateSession` (kind `scp`) →
`upsertPatch` through the remote binding → `endSession` → one completion line. Observability:
the target's `auth.log` gains one `Accepted password for <user> from <ip>` line.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Scope**:
- The `scp` command: operand parsing (whichever operand matches `user@host:path` is remote —
  decision 1 — with the other local), `-p` port override (decision 5), usage errors.
- Reuse `ssh.ts:59` `sshPortOf` for auto-detection rather than re-reading the pidfile: a box
  with sshd down is `Connection refused` before a password is asked.
- The `SERVICE_BY_DOOR` split above + `'scp'` on `DOOR_KINDS` and `SessionKind`.
- The transient lifecycle: create → single `write` → `endSession`, with the end running on
  **every** exit path including a refused write.
- Source-first validation: a missing/unreadable/directory source errors
  (`scp: <path>: Is a directory`) before the session is created, so a typo never reaches the
  target's log.
- Decision 3's UX via `streamedResult` (`streaming.ts:37`): `Connecting to <host>...` paints
  while the round-trip is pending, then one final `<name>   100%  <n> bytes`. No progress bar,
  no `Done` marker.
- Ctrl-C unwinds before the single `upsertPatch`, so a partial file cannot exist.
- Extract `land()`'s isNew rule out of `ftpShell.ts:104` so both doors share one journal rule.

**Acceptance criteria** (present and confirm before code):
- `scp /root/passwords.txt root@<lan host>:/usr/share/wordlists/passwords.txt` writes the file
  on the target; a subsequent read at that tier returns the carried content
- A guest-tier credential writing into `/root/` is refused, with no file and no partial row
- The target's `auth.log` holds exactly one login line for the transfer and **nothing naming
  the file**
- A source path that does not exist errors and the target's `auth.log` is untouched
- A host whose sshd is not running is refused without prompting for a password
- `scp` with a directory source errors `scp: <path>: Is a directory`
- The session row is ended once the command returns, on both the success and refusal paths

**RED**: A behavior test driving `scp` through `CommandEnv` asserting the remote write landed
with the right path/content and that the session was created then ended — failing because the
command does not exist. Plus an `authCreateSession` handler test asserting a `kind: 'scp'`
request stores `scp` **and** appends through the ssh sweep log, failing on the enum.
**GREEN**: The command module + the three-row `SERVICE_BY_DOOR` table + `'scp'` on both enums.
**MUTATE**: Stryker over `src/core/commands/scp.ts` and the changed region of
`authCreateSession.ts`. Expect survivors around the port default and the isNew boundary —
`mutator-rules.md` flags conditional-boundary and literal mutants there.
**KILL MUTANTS**: Cases for `-p` given vs absent vs non-numeric, and new-file vs overwrite.
**REFACTOR**: Assess whether the extracted `land()` wants its own module beside the patch
helpers, or stays a shared local. Take the collapsed option unless a second caller argues.
**Wire-check**: DEFERRED TO SLICE 3 (owner call, 2026-08-15). This slice widens an `api/`-reachable
enum — `authCreateSession` now accepts a third door kind — so by the standing rule it is
live-unproven until the scripts run. Two things make the deferral cheap rather than reckless, and
both are static, not live: the `sessions.kind` column is an unconstrained `TEXT` (no migration, no
constraint to violate), and `sessionRehydrate` rebuilds only `HOP_KINDS`, a whitelist `scp` is not
on — so the worst a stray row can do is linger until the next boot sweep. Slice 3 has to bring the
stack up anyway; running one wire-check over both door-kind paths beats booting it twice.
**Done when**: criteria met, gates green, human approves the commit.

**As-built (2026-08-15)** — where the shipped slice differs from what is written above:

1. **The `land()` extraction did not happen, and `scp` sends no `isNew` at all.** The plan
   said "extract `land()`'s isNew rule out of `ftpShell.ts:104` so both doors share one
   journal rule". Mutation triage found the flag is **unobservable** on this path and the
   claim it makes is **false** for scp: `applyPatches` has zero references to `is_new`;
   `removePatch` always tombstones with `is_new: false` regardless; and `upsertPatch` reads
   it only inside `rejectModifiedSinceOpen`, which early-returns when `base_hash` is absent —
   and scp sends none. More decisively, the flag asserts "no base-FS file stood here", and
   the upload **never looks**: it has no read of the target. So the shipped command omits it
   rather than guessing, with that reasoning inlined at `scp.ts:203`. `ftpShell.ts:104` is
   untouched — one caller of a rule is not a shared rule.
2. **REFACTOR spent itself elsewhere, on a real win.** The private `sshPortOf` copy became a
   call to the shipped `readOpenPorts` primitive (the same one `ftp.ts:112` and `nmap` read),
   deleting 8 lines and 9 surviving unreachable-guard mutants in one move.
3. **All early exits are sync, only the connect-and-transfer path streams.** An abort
   generator with nothing to yield is an eslint `require-yield` error, and the shape it forced
   is better anyway: `failure()` and the 130 abort return plain sync results, so only the path
   that actually waits on the network paints `Connecting to ...`.
4. **A second call site had to move with the enum.** `authCreateSessionPublic.ts:190` indexed
   `SERVICE_CATALOG[payload.kind]` the same way, so `SERVICE_BY_DOOR` is exported from
   `authCreateSession.ts` and used by both — typecheck found it, not review.

**Evidence**: 30 command tests + 3 handler tests; `scp.ts` mutation 80.22% with 0 no-coverage
(6 behavioral survivors triaged unreachable or defensive parity with the shipped ftp door, 30
`manual` help text); `authCreateSession.ts` 98.17% (2 pre-existing/equivalent survivors); full
suite 2769 passing; `tsc -b` and `eslint` clean.

---

### Slice 2: A player takes a file without being seen — ✅ SHIPPED (PR #402, v0.138.0)

**Value**: The silent harvest — the counterpart to ftp's `get`, which D3 made itemise every
byte. Two doors, two costs (decision 2).
**Path**: `scp <user>@<host>:<path> <local>` → session → **remote journal pull** so the read
sees the box's real state, not its generated state → read at the credential's tier → write
through `env.patches` on the box the player is standing on → `endSession`.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Scope**:
- The download direction, reusing slice 1's operand parsing (the remote operand is now
  argument 1 — decision 1's whichever-matches rule is what makes this nearly free).
- The transient remote **read** binding: the target's base FS with its journal replayed, at
  the session's tier — `state.ts:377` `ftpRoot` is the shape, held for one command instead of
  for a session. This is the largest piece of real machinery in D3b.
- A missing and a sealed remote file are refused alike, as D3 decided for `cd`/`get`.
- The local write is the player's own, exactly as if typed into their shell — and unlike
  slice 1's remote write it CAN see its destination (`env.fs.stat`), so `land()`'s rule
  applies here on its own terms.
- **Carried from slice 1: the `isNew` question, reopened by this slice's read.** Slice 1
  omits the flag because the upload has no view of the target. This slice builds exactly the
  view that would end that — so decide it deliberately rather than by drift, and *decide it
  for both directions*. The evidence gathered in slice 1 still points at "keep omitting":
  `applyPatches` ignores `is_new` entirely, so the flag changes nothing anyone in-game can
  observe, and a test pinning it would pin structure rather than behavior. Adopting it would
  need a reason a player could see. Whatever is chosen, the answer belongs in one place, not
  two — this is where `land()` earns its extraction or is written off.
- **Also carried: the mid-transfer abort window opens here.** Slice 1's round-trip is a
  single `write` with no interruptible gap; a download is read-then-write, so "Ctrl-C leaves
  no file and no session row" becomes testable for the first time, and the top-level criterion
  marked `[~]` above is this slice's to close.

**Acceptance criteria** (present and confirm before code):
- `scp root@<lan host>:/etc/passwd ./` lands the file locally, and `john` can then run on it
- The content read reflects the target's **journal**, not its pristine generation (a file
  written to the target earlier comes back with the written content)
- The target's `auth.log` shows a login line and **nothing about the file** — asserted
  against ftp's `OK DOWNLOAD` line for the same theft, so the contrast is a test, not a claim
- A remote path the tier cannot read is refused identically to one that does not exist
- A refused local write records no transfer and leaves no file
- Ctrl-C after the session is open leaves no local file and no session row — the window
  slice 1 could not reach

**RED**: A behavior test asserting the downloaded content equals the target's journal-replayed
content, and a log test asserting the target's `auth.log` gains one login line and no transfer
line — failing because download does not exist.
**GREEN**: The download branch + the transient read binding.
**MUTATE**: Stryker over the new binding and the download branch.
**KILL MUTANTS**: Journal-replay ordering and the tier-refusal collapse.
**REFACTOR**: Assess whether slice 1's and slice 2's session lifecycles collapse into one
`withTransientSession`-shaped helper now that both directions exist. **Do not build it in
slice 1** — one caller is not a pattern.
**Done when**: criteria met, gates green, human approves the commit.

**As-built (2026-08-16)**:

1. **The read binding was six lines, not the largest piece of machinery in D3b.** The plan
   sized it from `ftpRoot`'s shape, but `fetchOwnPatches` → `resolveActiveRoot` →
   `createFsView` are all shipped and tested, and a transfer needs no signal because it
   looks once and is gone. `state.ts` `readFromScpTarget` is that composition with nothing
   held.
2. **`isNew` stays omitted, both directions, and `land()` was not extracted** — the decision
   the plan asked to be made deliberately. Every reference was checked: `applyPatches` and
   `materializeMachineFs` never read `is_new`; `removePatch` deletes the patch tree and
   tombstones with `is_new: false` regardless, so the flag does **not** decide "a later `rm`
   deletes it" the way `ftpShell.ts:104` says it does; the only live read is inside
   `upsertPatch`'s guard, which early-returns without a `base_hash`. Adopting an inert flag
   for symmetry would copy a claim no test can fail. `ftpShell.ts` was left alone — its
   comment is stale, which is a separate, behavior-neutral cleanup.
3. **The two lifecycles collapsed during GREEN, not after it.** `connectAndTransfer` is the
   `withTransientSession` shape the REFACTOR step anticipated, and it arrived as the minimum
   code that could satisfy "the row closes on every path" for two directions at once — one
   `env.scp.end` for success, both refusals, and both abort windows.
4. **The mid-flight abort needed the command to look.** Nothing else in the codebase reads
   `env.signal.aborted`; a Ctrl-C surfaces by rejecting an in-flight `env.sleep`, and a
   transfer awaits the network instead. So the command checks the signal itself, at the two
   moments nothing has landed yet.

**Evidence**: 43 command tests (+13); `scp.ts` mutation **85.31%**, 0 no-coverage, 36
survivors — 30 `manual` help text and 6 triaged (2 unreachable guards, 2 defensive
redundancy, 1 impossible array state, 1 genuinely equivalent: `normalize` anchors every
path at root, so `resolveAbsPath`'s base cannot be observed). **Zero survivors in the new
download code.** Full suite 2782 passing; `tsc -b` and `eslint` clean.

**Two named gaps, both inherited from slice 1 and both one decision:**

- **A relative remote path resolves from `/`, not the account's home.** `scp root@h:notes.txt .`
  reads `/notes.txt`; real scp reads `~/notes.txt`. Pinned by a test so the answer is visible
  and changing it is a deliberate act.
- **A local write that fails for network reasons reports `Permission denied`.** True of the
  remote write since slice 1, and the download inherits it. It contradicts the rule applied
  one function earlier on the read side, where a failed round-trip gets its own line rather
  than being dressed as the target's answer. Fixing it honestly means fixing both directions.

---

### Slice 3: A player reaches a stranger's box — ✅ SHIPPED (v0.139.0)

**Value**: The carry and the harvest both work against another player's machine, through the
port its owner forwarded — consistent with D3 including cross-player rather than deferring it.
**Path**: public IP → `env.scan.resolvePublic` for reachability → `authCreateSessionPublic`
(kind `scp`, carrying `callerMachineId` as `FtpPublicAuthParams` does) → transfer → end.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Scope**:
- Public-IP routing for both directions, mirroring `ftp.ts:144` `publicLogin`: the port must
  be answered by the **ssh** service, so a stranger's forward onto their ftp door is refused
  before a password is typed.
- The source IP the defender sees is **server-derived**, never client-reported — the rule
  `recordFtpTransfer.ts:121` `resolveProvenance` already enforces for the other door.
- `caller_machine_id` on the public path, so a transfer run from a pivot traces to the network
  the target actually saw.
- **Carried from slice 2: the two named gaps, and this is the last cheap moment to decide
  them.** Both are recorded at the end of slice 2 — a relative remote path resolving from `/`
  rather than the account's home, and a local write failing for network reasons reporting
  `Permission denied`. Each is one decision, and each currently has two inheritors; this slice
  adds a third path that inherits both, so the cost of deciding rises with it. Settle both at
  this slice's CONFIRM gate: either fix them here across all directions (the honest fix touches
  the shipped upload, which is why it is a decision and not a cleanup), or defer them past D3b
  in writing. Do not let a third path acquire them by drift.

**Acceptance criteria** (present and confirm before code):
- B `scp <file> root@<A's public IP>:/root/ -p <fwd>` lands the file on A's box; A sees it
- B `scp root@<A public IP>:<file> ./ -p <fwd>` returns A's real file content
- A's `auth.log` names **B's home address**, derived server-side, not anything B sent
- A forwarded port answered by a service other than ssh is refused without prompting
- **Wire-check**: a `scripts/test*.ts` run against `vercel dev` + local supabase proves the
  round-trip live — an `api/` change is unproven until it runs against the real stack. **This
  slice carries slice 1's deferred wire-check too**, so the run must cover BOTH door-kind paths:
  the own-LAN `authCreateSession` with `kind: 'scp'` (slice 1's widened enum — session row stored
  under `scp`, `auth.log` line written through the ssh spec, row gone after `endSession`) and the
  cross-player `authCreateSessionPublic` one. `scripts/testFtpSession.ts` is the closest analogue
  to adapt. Until this runs, slice 1's endpoint change is statically verified only
- **E2E**: the full carry in a real browser per the `v2-e2e` skill, appended to
  `e2e-shared-network-verification.md`:
  ```
  ssh root@<npc>            a box you rooted, fronting a deep layer
  apt install hydra         creates /usr/share/wordlists/ (load-bearing — see below)
  scp ~/passwords.txt root@<npc>:/usr/share/wordlists/passwords.txt
  hydra -p <fwd> <inner gw> opens with a word the shipped list does not hold
  ```
  **Do not drop the `apt install` step.** A generated NPC's `/usr` holds only `bin` and
  `sbin` (`remoteHostFs.ts:189`), so without it the scp fails on the missing containing
  directory — scp does not create parents, as real scp does not.

**RED**: A behavior test driving the public path against a stubbed `resolvePublic` +
`authenticatePublic`, asserting both directions and the non-ssh-forward refusal.
**GREEN**: The public branch.
**MUTATE**: Stryker over the public routing; `N/A` for the wire-check and E2E, whose evidence
is the live run recorded in the doc.
**KILL MUTANTS**: The service-match predicate (an `ftp`-serving forward must not open).
**REFACTOR**: Assess collapsing the own-LAN and public paths now that all three exist.
**Done when**: criteria met, wire-check and E2E recorded, gates green, human approves.

**As-built (2026-08-16)**:

1. **The server needed no change at all, and that was the slice's first finding.** D3.6 made
   `authCreateSessionPublic` kind-parameterized and slice 1 moved it onto `SERVICE_BY_DOOR`, so
   `scp` already mapped to the ssh spec there: the reached-port check already demanded sshd
   (`authCreateSessionPublic.ts:195`), the trace already went through the ssh sweep log, and the
   source IP was already server-derived via `standingVantage` + `resolveVantageSourceIp`. Three of
   this slice's four criteria were true server-side before a line was written. Slice 3 is
   **client-only** — which is why its whole risk sat in one place.
2. **That place was the read binding, and slice 2's version was wrong for a stranger's box.**
   `resolveActiveRoot` falls back to `ownBaseFs` when the ESSID cannot generate the machine
   (`activeRoot.ts:45`), so pointing slice 2's composition at another player's workstation would
   not have errored — it would have handed B **their own file under A's name**. Cross-player reads
   now go through `resolveCrossPlayerFs`, server-materialized and tier-pruned, the same call an
   ssh hop's `refreshServedRoot` makes. `handleResolveCrossPlayerFs` authorizes on any un-ended
   row with no kind filter, so a transient `scp` row is enough to read and ending it is enough to
   stop — checks 17-19 of the wire-check, and the one thing in the slice that could only be
   proved live.
3. **The upload direction needed nothing.** `writeToScpTarget` points the shipped patch client at
   the target and `authorizeMachineAccess` accepts a caller holding a session there — the path
   ftp's `put` already used cross-player.
4. **The two paths collapsed into a `Reach`.** Own-LAN and public differ only in what establishes
   the port and who names the machine id; after the password is typed they are one piece of code.
   No new type was needed: `PublicAuthResult` is already the shape a LAN login can return, with
   the locally-resolved machine id supplied by the caller. That is the REFACTOR this slice
   anticipated, and it arrived as the minimum code for a third path.
5. **`FtpPublicAuthParams` became `PublicDoorAuthParams`** — both doors send `callerMachineId`,
   and only `ssh` names no caller box, so the name belonged to the door and not to ftp.
6. **Both carried gaps fixed, as approved at the CONFIRM gate.** A relative remote path now
   resolves from the account's home — which forced the resolution to move INSIDE the session,
   since the tier that decides where that is only comes back with the credential. And a write
   failing for network reasons now says `Connection closed by remote host.` in both directions,
   symmetric with the read side.
7. **Mutation found a real gap the tests could not see: single-element port arrays.** With one
   published forward, `.some` and `.every` are indistinguishable, and so is
   `candidate.port === port` from `true`. A stranger publishing TWO forwards kills both — the
   same case ftp's suite already carried.

**Evidence**: 62 command tests (+19) and 2 state-level integration tests driving the real UI
wiring; `scp.ts` mutation **88.66%**, 0 no-coverage, 33 survivors — 28 `manual` help text and 5
pre-existing (2 unreachable optional-chaining guards, 2 redundant defensive halves, 1 colon-in-
username edge). **Zero survivors in the new cross-player code.** Full suite 2801 passing; `tsc -b`
and `eslint` clean. **Wire-check `testScpTransfer` 19/19 live**, covering both door-kind paths —
**slice 1's deferred wire-check is discharged with it** — with `testFtpCrossPlayer` 16/16 and
`testFtpSession` 14/14 re-run green. **E2E: Act 12** of `e2e-shared-network-verification.md`, two
real players on two networks, v0.139.0.

---

## Explicitly out of scope (named, deferred)

- **Remote-to-remote** (`scp root@A:/f root@B:/g`) — two transient sessions in one command;
  worth its own slice, and genuinely interesting given decision 2's silence
- **`-r`** and directory transfer
- **Preserve-times** — can never have its real name, since `-p` is the port (decision 5)
- **`-P` alias** — resolved above: not shipped

## Pre-PR Quality Gate

Per slice, from `v2/`:
1. Mutation evidence (or reviewed `N/A` + alternate evidence for the wire-check/E2E slice)
2. Refactoring assessment
3. `npm run typecheck` (`tsc -b` — a plain `tsc --noEmit` is a NO-OP) and `npm run lint`
4. Version bump in `v2/package.json` **and** `v2/package-lock.json`
   (`npm install --package-lock-only`) — v0.137.0 → v0.139.0 across the three slices

---
*Delete this file when D3b is complete; fold the as-built into
`v2/docs/conventions-and-gotchas.md` and close out in `plans/legacy-parity-epic.md`.*
