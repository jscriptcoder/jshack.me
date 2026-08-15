# Plan: D3b — `scp`, the transfer

**Branch**: `docs/plan-d3b-scp` (this plan) → `feat/scp-*` per slice
**Status**: Active
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

- [ ] A player copies a file from the box they are standing on to a machine they hold a
      credential for, and the file is there afterwards at the tier the credential bought
- [ ] A tier the credential does not carry refuses the write, and no partial file exists
- [ ] A player copies a file OFF a remote machine onto the box they are standing on
- [ ] The target's `/var/log/auth.log` records one login line, indistinguishable from an
      interactive `ssh` login, and **no line names the file** in either direction
- [ ] The session row that authorized the transfer is gone once the command returns
- [ ] A source path that does not exist is reported before anything reaches the target's log
- [ ] Ctrl-C during the round-trip leaves no file and no session row
- [ ] Both directions work against another player's box through a NAT forward
- [ ] `scp` refuses a host whose sshd is not running, whatever else it serves

## Slices

Three slices, each a behavior change following RED → GREEN → MUTATE → REFACTOR. Every slice
loads `tdd`, `testing`, `mutation-testing`, and `refactoring`.

---

### Slice 1: A player carries a file onto a box they hold

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
**Done when**: criteria met, gates green, human approves the commit.

---

### Slice 2: A player takes a file without being seen

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
- The local write is the player's own, exactly as if typed into their shell.

**Acceptance criteria** (present and confirm before code):
- `scp root@<lan host>:/etc/passwd ./` lands the file locally, and `john` can then run on it
- The content read reflects the target's **journal**, not its pristine generation (a file
  written to the target earlier comes back with the written content)
- The target's `auth.log` shows a login line and **nothing about the file** — asserted
  against ftp's `OK DOWNLOAD` line for the same theft, so the contrast is a test, not a claim
- A remote path the tier cannot read is refused identically to one that does not exist
- A refused local write records no transfer and leaves no file

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

---

### Slice 3: A player reaches a stranger's box

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

**Acceptance criteria** (present and confirm before code):
- B `scp <file> root@<A's public IP>:/root/ -p <fwd>` lands the file on A's box; A sees it
- B `scp root@<A public IP>:<file> ./ -p <fwd>` returns A's real file content
- A's `auth.log` names **B's home address**, derived server-side, not anything B sent
- A forwarded port answered by a service other than ssh is refused without prompting
- **Wire-check**: a `scripts/test*.ts` run against `vercel dev` + local supabase proves the
  round-trip live — an `api/` change is unproven until it runs against the real stack
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
