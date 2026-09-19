# Plan: Phase 3 Slice 8 — Libraries Fall

**Epic:** `plans/legacy-parity-epic.md` — Phase 3 (the "V" series), slice 8. Grill + find-gaps
record: the epic's `### Slice 8 — resolved decisions (grill-me, 2026-09-18)` section, decisions
63–74 (decision 69 supersedes 17; an earlier lost grill's answers recovered into 67–74). Prior
slice close-out: "Phase 3 slice 7 — reboot evicts" (#515–#518, v0.231.0–v0.234.0), which closed V3.
**Slice 9 (firmware) is the only V-series axis left after this.**

**Status:** Active — PR1 ✔ merged (#519, v0.235.0). PR2 ✔ merged (#520, v0.236.0). PR3 ✔ merged (#521, v0.237.0). PR4 in progress on `feat/local-exploit-escalates`.

**Delivery:** Six independent PRs, sequenced to trunk (NOT a stack), per decision 72. Each merges
to `main`; the next branches from updated `main`. PRs 1, 2 and 3 are independent of everything and
of each other; PR4 needs PR2 only for the "guest carries the tool in" story (it runs unaided on a
box the player already holds root on) and PR3 only for its forecast to be readable; PR5 needs PR4's
interpreter; PR6 widens PR4's map. Versions 0.235.0 → 0.240.0, bumped in both `v2/package.json`
and `v2/package-lock.json` per PR.

**Branches (proposed):** PR1 `feat/ldd-lists-linked-libraries`, PR2 `feat/run-a-carried-binary`,
PR3 `feat/apt-list-names-the-cve`, PR4 `feat/local-exploit-escalates`,
PR5 `feat/local-exploit-crosses-players`, PR6 `feat/library-map-covers-the-toolchain`.

---

## Goal

Make a live library CVE a privilege-escalation route: a shell on a box — guest, user, whatever the
player holds — becomes a higher tier through `msfconsole --local <command>`, with no password,
because a library the command links has an unpatched hole. `ldd` is the recon that shows which
libraries a command links; `apt upgrade` is still the whole defence.

## Scope boundary

The escalation axis, and its recon and its one new delivery mechanism (running a carried binary).
Library *timelines* already shipped with slice 2 — every library carries a `PACKAGE_TEMPLATES`
row and `liveCve` already derives a live library CVE. Firmware (slice 9) stays out. The eight
effect *handlers* are slice 5's and are reused, not rebuilt.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 9 | Severity → tier, with libraries floored at user (`critical`/`high` → root, `medium`/`low` → user). The interpreter PR4 writes reads this floor; `exploitEffect.ts`'s `tierForSeverity` is the service floor and must not be reused unchanged for libraries. |
| 11 | `libraryDeps` is the single authority for what a command links; `metadata.libraryLinks` is deleted (PR1). |
| 12 | The map extends to the game's own tools, keeping eight libraries; each added command needs its own pool (PR6). |
| 25 | One axis-blind `liveCve(key, version, gameDay)`; per-axis interpretation attaches here. The library interpreter is the second caller (`exploitOutcome` was the first). |
| 18 | An exploit session is an ordinary row at the granted tier — no special cases, brick included. A `--local` root row is an ordinary root row. |
| 23 | From a `node` script a shell effect REPORTS instead of pushing a session. `--local` inherits this unchanged. |

## Resolved decisions

All twelve (63–74), the seven find-gaps answers and the recovered-grill answers live in the
epic's `### Slice 8 — resolved decisions` section and are not restated here. The mapping from
decision to PR is the delivery list above and each slice's **Decisions** line below.

---

## Slices

All six are **behavior change** — fast RED-GREEN-REFACTOR increments, with the
mutation-or-alternate gate run once per PR at PR readiness. PR5 changes `api/` behaviour and
therefore carries a `scripts/test*.ts` wire-check against `vercel dev` + supabase (the epic's
routine-evidence line). PR4 carries a solo browser run. The rest are pure `src/core` + `src/ui`
and prove themselves at the unit layer.

**Required implementation skills:** `tdd`, `testing`, and `functional` throughout; `refactoring`
where a PR also tidies already-tested code; `front-end-testing` for PR4's terminal-observable
escalation; `mutation-testing` at each PR boundary's readiness.

---

### PR1 — `ldd` lists a command's linked libraries, and `libraryLinks` is deleted (v0.235.0) ✔ SHIPPED v0.235.0 (#519)

**Value:** A player can see which shared libraries a command links, and whether each `.so` is
present — the recon half of the axis, and the one map that (decision 11) also drives the exploit,
so the two can never disagree.
**Actor/trigger/outcome:** player runs `ldd <name-or-path>` on any box they stand on → one line
per linked library, `<lib>.so => /lib/<lib>.so (0x…)` when present or `not found` when the file is
gone; a present binary that links nothing prints real `ldd`'s `not a dynamic executable`; a binary
not on the box prints `ldd: <arg>: No such file or directory`.
**Class:** Behavior change.
**Decisions:** 67 (legacy's line format, no version/CVE; **name or path, the file must exist**),
11 (`metadata.libraryLinks` deleted).
**Path:** new `ldd` command in `src/core/commands/`, reading `libraryDeps` (already the authority)
and `env.fs` for each `/lib/<lib>.so`; registered in `registry.ts`. A path argument is taken
literally; a bare name resolves through `/bin`, `/usr/bin`, `/usr/sbin`. This PR keys the map on
the resolved file's basename; PR2 switches that lookup to the stub's content along with execution.
`ldd` is already stamped as a binary (`binaries.ts:75`) with no command behind it, so this fills
that stub — no packaging work.
Delete `libraryLinks` from `filesystem/types.ts:30` and the two `treeCodec.test.ts` fixtures that
carry it (the field is never populated or read; its only example value contradicts the libc
exclusion).
**Acceptance:**
- `ldd su` lists `libpam.so` and `libcrypt.so`, each with its present path and a stable fake
  address, in `libraryDeps` order.
- `ldd grep` shows the single `libpcre.so` dependency.
- After `/lib/libpam.so` is removed, `ldd su` shows `libpam.so => not found` and still lists
  `libcrypt.so`.
- `ldd /bin/su` answers exactly as `ldd su` does (V4's acceptance line as written).
- A present binary not in `libraryDeps` (e.g. `mkdir`) prints `not a dynamic executable`, not an
  empty list.
- After `/bin/su` is removed, `ldd su` and `ldd /bin/su` both print `ldd: <arg>: No such file or
  directory` — the map is never consulted for a binary that is not there.
- `ldd` with no argument prints its usage and exits non-zero.
- `metadata.libraryLinks` no longer exists on the `FileNode` type; the tree codec round-trips
  without it and the two fixtures no longer reference it.
**RED:** an `ldd.test.ts` asserting the two-library listing for `su` and the `not found` line after
removal; a `treeCodec` test proving a node round-trips with no `libraryLinks` field.
**Evidence:** RED-GREEN unit tests; typecheck proves no reader of `libraryLinks` remains; mutation
gate at PR readiness. No wire-check (pure client), no browser run (a unit test observes the exact
lines).

---

### PR2 — a binary carried onto a box runs by its path (v0.236.0)

**Value:** A guest who has copied a tool onto a box (via `scp`/`ftp put` into a writable place) can
run it by naming its path — the realistic way an attacker brings their own tool, and the only way a
non-root player gets `msfconsole` onto a box they broke into. Closes the gap that made V4's own
acceptance line ("B **(guest)** `msfconsole --local su` → root") unreachable.
**Actor/trigger/outcome:** player runs `/tmp/msfconsole …` or `./msfconsole …` → the file at that
path is resolved, its content identifies the tool, the caller's tier is checked against its execute
bit, and the matching command runs; a bare `msfconsole` still resolves only through
`/bin`,`/usr/bin`,`/usr/sbin`.
**Class:** Behavior change.
**Decisions:** 71 (explicit-path execution, gated like an installed binary; **binaries name their
tool in their content and dispatch is by content, not filename**; path execution is prompt-only).
**Path:** two coupled changes.
  1. **Binaries name their tool.** `BINARY_STUB` (`binaries.ts:39`) is identical for every binary,
     so a filename dispatch would let `cp /bin/cat ~/msfconsole` forge any tool. Change the stub to
     carry the tool name (one function, used by generation `binaries.ts:139`, `libraries.ts:68` and
     both `apt.ts` install writes `:154`,`:529` — libraries keep a non-tool marker so `ldd`/exec
     never treat a `.so` as runnable). This re-rolls every generated binary's content (pre-launch
     licence allows it).
  2. **The shell resolves a path-shaped token.** `runLine.ts:142` does `commands.get(stage.name)`
     on the bare token, so `/tmp/msfconsole` is `command not found` today. When `stage.name`
     contains `/`, resolve the FileNode at that path instead, read its content to get the tool
     name, verify the caller's tier holds `perms.execute`, and dispatch to that registry command —
     bypassing the availability wrapper's own `/bin` search (the binary is at the explicit path).
     A path that is not a file, whose content names no registered tool, or whose execute bit the
     tier lacks, fails as real Linux does (`No such file or directory` / `Permission denied`,
     non-zero).
**Acceptance:**
- With a real `msfconsole`-content binary at `/tmp/msfconsole` and its execute bit set for the
  caller's tier, `/tmp/msfconsole <host> <port>` runs the exploit command.
- `./msfconsole` from the cwd holding that file resolves the same way.
- A copy of `cat`'s binary saved as `~/msfconsole` runs `cat`, not whatever the file is named —
  dispatch is by content. (v2 has no `cp`; players carry binaries in with `scp`/`ftp put`, so the
  test plants the renamed copy directly.)
- A carried binary whose execute bit the tier lacks refuses with `Permission denied`; `chmod +x`
  on the player's own copy (already allowed by D10) then lets it run.
- A path token pointing at a non-file, or a file whose content names no tool, prints
  `No such file or directory` and exits non-zero.
- A bare command name still resolves only through the three system directories (no cwd/PATH
  surprise); `msfconsole` with no install on the box is still `command not found`.
- `apt install`-written and generation-written binaries both carry the tool-naming content (one
  stamping function; no drift).
- `ldd` looks the map up by the stub's content too (decision 67): `cp /bin/su /tmp/foo && ldd
  /tmp/foo` lists `libpam.so` and `libcrypt.so`.
**RED:** a shell test that a path-shaped token resolves to and runs the named command; a test that a
renamed copy runs by its content not its name; a test that a missing execute bit refuses.
**Evidence:** RED-GREEN unit tests at the shell + availability layer; a codec/generation test that
every stamped binary carries a recoverable tool name; mutation gate at PR readiness. No wire-check
(pure client — `apt install` already round-trips through `api/patches` and is unchanged in shape).

---

### PR3 — `apt list -u` names each exposed package's CVE and its severity (v0.237.0)

**Value:** A player can read how badly a package is exposed before acting on it — the defender a
triage order, the attacker the tier a `--local` fire would land at (decision 13's library half),
and a player whose root was reset through a library the candidate ids to work it back out.
**Actor/trigger/outcome:** player runs `apt list -u` on any box they stand on (no root needed) → a
row that carries a live CVE shows its id and severity beside the move, e.g. `libpam 1.5.3 [CVE-…
high · upgradable → 1.5.4]`; the `no fix yet — ETA` form gains the same prefix. Never the effect.
**Class:** Behavior change.
**Decisions:** 74.
**Path:** `upgradableRow` in `apt.ts` (`:262`) and the one shared phrase `noFixYet` (`:257`) that
`upgrade`'s warning also uses; the id and severity come from the same axis-blind `liveCve` the
upgrade status is derived from, so the row and `nmap -sV` read one fact. One format for every
package — services and libraries alike.
**Acceptance:**
- On a box whose `libpam` is inside a live-CVE window with a fix shipped, its row shows that CVE's
  id and severity and the upgrade target.
- The same inside the patch-delay gap shows the id and severity with the ETA.
- A service package's row carries the same id and severity `nmap -sV` prints for its port.
- No row shows an effect kind.
- A clean box still prints `All packages are up to date.`
- `apt upgrade`'s `W: … no fix yet` warning stays consistent with the row's wording.
**RED:** `apt.test.ts` row assertions for the upgradable and no-fix-yet forms carrying id and
severity; a test that a service row agrees with the scan.
**Evidence:** RED-GREEN unit tests; mutation gate at PR readiness. No wire-check (pure client), no
browser run (a unit test observes the exact rows).

---

### PR4 — a live library CVE escalates a shell on a box you hold (v0.238.0)

**Value:** The headline. A shell on the player's own box or an NPC box becomes a higher tier —
often root — with no password, because a library the named command links has a live CVE. This is
the whole "patch or die" pressure on the player's own libraries (decision 6) made real and playable.
**Actor/trigger/outcome:** player standing on their own/NPC box runs `msfconsole --local <command>`
→ if a library the command links has a live CVE, an effect is rolled from that command's pool and
applied at the granted tier (a shell pushes a hop, a read/list/write/etc. runs); if not, the uniform
`msfconsole: no known vulnerability on <command>`.
**Class:** Behavior change.
**Decisions:** 63 (client-local on own + NPC boxes), 64 (highest-severity live CVE wins, ties by
`libraryDeps` order), 65 (effect seed = command+library+release, never machine), 66 (no tier
comparison), 68 (legacy's 17 pools as effect kinds only), 69 (realistic traces — `kern.log` crash
line on a miss, ordinary `auth.log` session line on a shell success, nothing else), 70 (all eight
effects, reusing slice 5's handlers), 73 (escalated shell inherits the caller's TTY state).
**Path:**
  - **Library interpreter** (the decision-25 second caller): a pure function taking a command, the
    box's `dpkg` versions, and the game day → the winning `(library, release, effect, tier)` or
    undefined. It walks `libraryDeps[command]`, calls `liveCve` per library, picks the highest
    severity (ties by link order, decision 64), floors the tier per decision 9's **library** rule
    (NOT `exploitEffect.ts`'s service `tierForSeverity`), and rolls the effect from the command's
    pool on seed `effect:local:${command}:${library}:${release.index}` (decision 65).
  - **The 17 pools** ported from legacy `systemCommandEffects.ts` into a `src/core/cve` module as
    **effect kinds only** (order + repetition load-bearing; legacy's baked `tier:'root'` dropped —
    decision 9 sets the tier now).
  - **`msfconsole --local`** branch: resolve the current box, read its `dpkg/status`, call the
    interpreter, apply the effect through slice 5's existing handlers (the machine is the one the
    caller stands on), inherit TTY state (decision 73), and run the phase output legacy already has.
  - **Traces** (decision 69): a `kern.log` crash line on a miss where a linked library exists but
    none is live (via a new best-effort `env.log.appendKernLog`, server-stamped time); the ordinary
    `auth.log` session line on a shell success (a new no-auth `AuthLogEvent` variant); nothing on a
    read/list/write success; nothing when the command links no library or the `.so` is missing
    (that's the uniform miss message — find-gaps routine item).
**Acceptance:**
- On a box whose `libpam` is inside a live-CVE window, `msfconsole --local su` escalates: a `high`
  CVE lands user, a `critical` lands root, with no password — and the same box a day before its
  window opens answers the miss message.
- The effect for a given `(command, library, release)` is identical across two different boxes on
  that release (seed carries no machine).
- When `su`'s two libraries are both live, the higher-severity CVE decides the tier; a tie falls to
  `libpam` before `libcrypt` (link order).
- A miss (linked library, none live) writes one `kern.log` line naming the command and the library;
  a command linking no library, or with the `.so` deleted, writes nothing and prints the miss
  message.
- A `shell_full` roll pushes a full hop from a TTY shell and a PTY-less hop from a backdoor/limited
  shell — the tier rises, the door does not (decision 73).
- A shell success leaves an `auth.log` session line with no password line before it; a
  read/list/write success leaves no log line.
- All eight effect kinds are reachable and behave as their slice-5 handlers do, the current box
  standing in for the remote target.
**RED:** an interpreter test for the highest-severity-wins pick and the library tier floor; a
`--local` command test that `su` escalates inside a window and misses outside it; a trace test that
a miss writes the crash line and a shell success writes the no-auth session line.
**Evidence:** RED-GREEN unit tests; mutation gate at PR readiness; **a solo browser run** (the
epic's PR4 evidence obligation): on a seeded box inside a window, `ldd su` then `msfconsole --local
su` reaches root at the prompt, and `cat /var/log/kern.log` shows a crash line after a miss. No
wire-check (client-local path touches no `api/`).

---

### PR5 — the local exploit crosses to another player's box (v0.239.0)

**Value:** The PvP face. B, holding a guest shell on A's stale workstation, escalates to root on it
with no password — and A closing the hole with `apt upgrade` is what stops them. The first route by
which one player takes root of another **through their libraries**, server-authorized so it cannot
be forged.
**Actor/trigger/outcome:** B (standing on A's registered workstation) runs `msfconsole --local
<command>` → a new signed action regenerates A's box, replays A's journal (so A's `apt upgrade`
history counts), recomputes the winning library CVE from A's manifest, and — if B's own session on
that box is still open and the `msfconsole` B ran is really on it — mints a row at the granted tier
and writes A's traces under A's writer key; otherwise the uniform refusal.
**Class:** Behavior change.
**Decisions:** 63 (server-authoritative on a player's workstation; **the caller's own open session
on that machine is the authorization**; an offline owner answers `No route to host`, writing
nothing), 71 (**the server checks the carried binary at the path the client ran**), 69 (server
writes both trace lines under the owner's writer key), 70 (reuses slice 5's server-side effect
handlers); routine: the row is an ordinary `exploit` / `exploit_limited` kind, no new session kind.
**Path:** a new `exploitLocalElevate` (name TBD) action in `api/sessions.ts`, modelled on
`suElevate` (`:940`) for how it finds A's box (occupancy by `machine_id`) and on
`exploitCreateSession.ts` for how it applies an effect server-side. What it adds over `suElevate`:
no password — instead it **requires the caller's session row on that machine to be open
(`ended_at IS NULL`), owned by the verified signer (player key from the envelope, never the body),
and on that exact machine**; its tier is irrelevant (decision 66). The library interpreter from PR4
is the shared pure core both client and server call. An offline owner (no occupancy row) → `404
host_unreachable` → `No route to host`, nothing written. **The binary check:** the request names
the path the client ran (`/usr/bin/msfconsole` for an installed copy, `/tmp/msfconsole` for a
carried one); on the replayed box that node must exist, its stub content must name `msfconsole`,
and the caller's session tier must hold its execute bit — else the same `No route to host`, nothing
written. **Verify at this PR's start** that a cross-player `scp`/`ftp put` onto A's box lands in
A's journal, so the replay sees the carried copy; if it does not, that is a finding to bring back
before code.
**Acceptance:**
- B with an open guest shell on A's box, A's `libpam` inside a live window, `msfconsole --local su`
  → B holds a root row on A's box; A's `auth.log` shows the no-auth session line under A's writer
  key.
- A runs `apt upgrade` to move `libpam` past the CVE → B's next `--local su` misses; A's `kern.log`
  carries the crash line.
- A caller naming a `machine_id` they hold **no open session on** is refused with `No route to host`
  and nothing is written (the authorization gap the grill closed).
- A caller whose session on that box was ended (e.g. by A's reboot, slice 7) is likewise refused.
- A's box with A disconnected (no occupancy row) → `No route to host`, nothing written.
- A request naming a path where A's replayed box holds no file, a file whose content is not
  `msfconsole` (a renamed `cat`), or one the caller's tier cannot execute → `No route to host`,
  nothing written (a forged client cannot skip carrying the tool in).
- A successful shell effect mints an `exploit` / `exploit_limited` row, not a new kind.
- The client sends address/session only; no version, CVE, effect or tier crosses the wire (the
  server recomputes all of it).
**RED:** a handler test that an open-session caller escalates and a no-session caller is refused
without a write; a handler test that an upgraded manifest turns a prior hit into a miss.
**Evidence:** RED-GREEN unit tests on the pure handler; mutation gate at PR readiness; **a
`scripts/test*.ts` wire-check** against `vercel dev` + supabase with two identities — B escalates on
A's box, then A upgrades and B misses — with negative controls (dropping the open-session check
lets a non-occupant escalate, and dropping the binary check lets a caller with no `msfconsole` on
A's box escalate, each turning a check red).

---

### PR6 — the dependency map covers the game's own toolchain (v0.240.0)

**Value:** A live library CVE reaches the game's own tools, not just the base system commands — so
the axis is as wide as legacy's, and a player can pick a payload by picking from a larger set of
commands (decision 12).
**Actor/trigger/outcome:** player runs `ldd nmap` (or any apt-installed client tool) → real linked
libraries; `msfconsole --local nmap` inside a window → an effect from that command's own pool.
**Class:** Behavior change.
**Decisions:** 12 (map extends, eight libraries kept, thematic grouping intact), 68 (**the boundary
is every apt-installed client tool and nothing else**; pool contents decided at this PR's
planning).
**Path:** add link entries to `libraryDeps` for every apt-installed client tool — `nmap`, `hydra`,
`john`, `nc`, `ftp`, `gpg`, `node`, `gobuster`, `lynx`, `dig`, `nslookup`, `mysql`, `redis-cli`,
`snmpwalk`, `snmpset`, the aircrack trio, `msfconsole` — from the existing thematic grouping
(network clients `libssl`, matchers/parsers `libpcre` or `libxml2`, prompt-driven `libreadline`),
reusing the eight libraries, no new library, no `/lib` re-roll; and a `SYSTEM_COMMAND_EFFECT_POOLS`
entry per added command (a mapped command with no pool is not exploitable, decision 12). Daemons
and the eight library-free system utilities (`mkdir`, `touch`, `man`, `ping`, `ifconfig`, `nmcli`,
`clear`, `whoami`) stay out, so an NPC box's local surface is unchanged. **Open until this PR's
planning:** each tool's exact library set and each pool's contents — in particular whether `node`
gets a pool at all (a `node` CVE yielding `script_exec` through the script runner is
near-circular); it is mapped either way, so `ldd node` answers. **Known consequence:** mapping a
tool turns on `wrapWithLibraryCheck` for it, so removing a `.so` it links (`rm /lib/libssl.so`)
starts breaking it — tests that stage a box without a library must expect that.
**Acceptance (shape; specifics set at this PR's planning):**
- Each newly mapped command's `ldd` lists its declared libraries.
- No daemon and none of the eight system utilities gains a link; an NPC box's `--local` surface is
  still legacy's seventeen.
- With a linked `.so` removed, a newly mapped tool refuses to run as the existing mapped commands
  already do.
- Each newly mapped command with a pool is exploitable via `--local` inside a window; each without
  one is not.
- The eight-library set is unchanged; no box's `/lib` is re-rolled.
- The decision on `node` (pool or library-free) is recorded before code.
**RED:** an `ldd`/interpreter test per newly mapped command; a test that a mapped-but-poolless
command misses.
**Evidence:** RED-GREEN unit tests; mutation gate at PR readiness. No wire-check, no browser run
(pure client, unit-observable) unless the pool decisions reach a cross-player path.

---

## Named risks

- **The library tier floor is a real fork from services.** `exploitEffect.ts`'s `tierForSeverity`
  floors `medium`/`low` at guest; decision 9 floors libraries at user. Reusing the service helper
  for `--local` would silently under-grant. PR4's interpreter must carry its own floor and a test
  that pins `medium → user` for a library.
- **Content-dispatch (PR2) touches every binary in the world.** The stamping function is one place,
  but generation, `apt install`, and any test fixture that hand-writes `BINARY_STUB` must all go
  through it, or a hand-written stub becomes an unrunnable file. A generation/codec test that every
  stamped binary yields a recoverable tool name is the guard.
- **The server authorization is the whole PvP safety story (PR5).** `suElevate` never checks its
  parent session because a password is its authority; `--local` has none. If the open-session /
  signer / machine check is wrong, any signed player takes root on any online box; if the carried-
  binary check is wrong, a forged client skips bringing the tool at all. The wire-check's
  negative control exists for exactly this.

## Out of scope (recorded, not forgotten)

- Firmware (slice 9) — the third axis; needs PR4's per-axis interpretation shape but is its own
  slice.
- `apt remove <library>` and library meta-packages (epic decision 22, deferred) — `rm /lib/<lib>.so`
  as root already breaks the linked commands.
- Any new content for the effects — slice 5 owns the effect handlers; this slice only routes library
  CVEs into them.

---
*Close per the repository lifecycle: on completion, retire this file's as-built into
`plans/legacy-parity-epic.md` as `### Phase 3 slice 8 — libraries fall`, the way slices 1–7 were,
and delete this file.*
