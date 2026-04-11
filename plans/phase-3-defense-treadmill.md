# Plan: Phase 3 — Single-Player Defense Treadmill

**Branch**: `plan/phase-3-defense-treadmill` (plan doc)
**Implementation branches**: feature branches off `multiplayer`, one per PR
**Base branch for all PRs in this phase**: `multiplayer` (NOT `main`)
**Status**: Active

## Context

Phase 1 (dynamic vulnerability lookup) and Phase 2 (unified access logging) established the substrate for defense gameplay. Phase 3 builds the actual **defense gameplay loop**: players actively maintain their machines by patching services, hardening routers, closing ports, and managing their logs, against a real-world pressure from newly published CVEs.

Without Phase 3, patching is a fiction — all the infrastructure exists but there's nothing for the player to _do_ with it. After Phase 3, the single-player game has a continuous maintenance cycle that rewards active play and punishes neglect.

The user has confirmed missions are allowed to break during this phase (same policy as Phases 1 and 2).

## Goal

Players gain **five new mechanics** that together turn single-player from a static puzzle into a continuous defense treadmill:

1. **`apt upgrade`** — patch running services to a version not matched by any current CVE. One-shot "close the vuln window" action.
2. **CVE time drift** — new CVEs get published over game time. A version that's safe today becomes vulnerable later. Patching is not a one-time chore.
3. **Player-controlled firewall** — open/close individual ports on the player's own machine. Reducing attack surface is a legitimate defense, at the cost of losing services.
4. **Router firmware as a first-class service** — routers gain a firmware version that can be targeted by CVEs and patched via `apt upgrade` like any other service.
5. **Log rotation + `shred` command** — logs don't grow forever, and attackers can erase specific entries to cover their tracks (at the cost of the `shred` action itself being loggable).

## Non-goals

Explicitly out of scope for Phase 3 and deferred to later phases:

- **Typed vulnerability effects** (file reads, password changes, directory listings) — Phase 4. Phase 3 still uses the "every exploit gives a shell" model. Only the time dimension changes.
- **CVE feed as a player-facing resource** — Phase 4. Phase 3 may surface "new CVE available" as a subtle ambient message (e.g., a motd line on login or a file in `/var/cve/latest`), but there's no dedicated feed UI.
- **Cross-player monitoring** — Phase 5+.
- **Automatic patching / unattended-upgrades** — out of scope forever; this is an active gameplay mechanic, not a background service.
- **Package dependency resolution for running services** — single-service upgrade only; no "this depends on that" graph.
- **Per-CVE severity tiers** — all CVEs are equal in Phase 3; severity is a Phase 4 concern.
- **IDS alerts / active defense monitoring** — Phase 5+.
- **Honeypot mechanics** — Phase 5+.

## Data model changes

Three additions to Phase 1's data model:

### 1. `publishedAt` on Vulnerability

```ts
export type Vulnerability = {
  readonly cve: string;
  readonly description: string;
  readonly serviceVersion: string;
  readonly attackPattern: AttackPattern;
  readonly publishedAt: number; // NEW — game day (epoch) when this CVE became active
};
```

`findVulnForService` takes an additional `gameTime: number` parameter and filters out CVEs where `publishedAt > gameTime`. All call sites pass the current game time.

### 2. Game-time model

A new `gameTime` primitive, stored in session state, representing "how far into the game world we are." Options evaluated below; the plan locks in **Option B — real-world-clock time, anchored at first game start**.

```ts
type GameTime = number; // days since the player started the game (Date.now() - startedAt) / msPerDay
```

Every CVE lookup, patch action, and log entry carries the current `gameTime`. This value is derived, not stored — the only persisted field is `startedAt`, already in session state (or added to it).

### 3. Firmware on routers

```ts
export type Port = {
  // existing fields
};

// New: routers get a firmware property separate from any port.
// This is conceptually a "service" that runs the whole box.
export type RouterFirmware = {
  readonly vendor: string;
  readonly version: string;
};

// Machines of role 'router' gain an optional firmware field:
export type GeneratedMachine = {
  // existing fields
  readonly firmware?: RouterFirmware; // present only on router-role machines
};
```

`findVulnForService` gains a companion `findVulnForFirmware(vendor, version, gameTime)`. Firmware CVE entries get their own pool or live alongside service CVEs with a distinct `kind` discriminator.

## Game-time model (design decision)

**Three options were considered. Locking in Option B.**

### Option A — game tick clock

Every player action advances a counter by 1. New CVEs drop every N actions. Simple but arbitrary and disconnects time from the real-world rhythm of play. Long sessions feel rushed, short sessions feel empty.

### Option B — real-world clock, anchored at first game start (chosen)

Game time = days since `startedAt`. Real-world hours and minutes feel meaningful: leaving the game for three days means catching up on three days of new CVEs when you log in. Matches how real system administration feels. Persisted as `startedAt: number` in session state; derived as `Math.floor((Date.now() - startedAt) / MS_PER_DAY)` at read time.

**Cadence**: CVEs publish at a rate of ~1-3 new entries per game day, drawn from a future-dated pool at generation time.

**Offline accrual**: time passes even when the game is closed. Log back in after a week → a week's worth of CVEs have dropped. This is realistic and creates genuine pressure.

**Reset on permadeath**: the permadeath model (from earlier brainstorming) already implies a fresh `startedAt` when a new game begins.

### Option C — explicit epochs, player-triggered

Player advances the clock manually or via in-game events. Too much player control removes the pressure.

## Feature overview and PR split

**Suggested 5 PRs, one per feature.** Each is independently mergeable; later PRs depend on earlier ones.

### PR A — `apt upgrade` command (foundation)

The simplest feature. No game-time model yet. `apt('upgrade')` with no arg upgrades every port on the current machine whose current `serviceVersion` matches a CVE, to a version that doesn't. Output mimics real `apt upgrade`. Requires root.

Implementation strategy:

- Add an `upgrade` subcommand handler to `apt.ts`.
- For each port on the current machine with a CVE-matching version, compute a "latest safe" version for that service. Easiest: iterate `vulnerabilityTemplates` for that service, find the lexicographically-highest version, bump one step beyond it (e.g., `Apache/2.4.49` → `Apache/2.4.60`). Or simpler: use `defaultServiceVersion(service)` which already returns `'latest'`.
- Mutate the port's `serviceVersion` in-place via a new filesystem patch mechanism or a session-level override. **Design question**: where does the new serviceVersion live? The `Port` type is readonly and ports come from generation. Options:
  - (i) Add a `portOverrides` map to `SessionContext` keyed by `(machineId, port) → serviceVersion`, applied when reading ports.
  - (ii) Apply via the existing IndexedDB patch mechanism — patch the generated machine's port array.
  - (iii) Store upgraded versions as files on the machine (e.g., `/var/lib/apt/versions/nginx` = `nginx/1.25.0`), consumed at read time.
  - **Lean**: (i) — session-level override map. Smallest footprint, no schema change to generation, trivially reversible via `apt upgrade`.

Scope: no time dimension. Every CVE is "live" in this PR. Patching closes every window at once.

### PR B — game-time model + `publishedAt` on CVEs

The architectural PR. Introduces the game clock and retrofits all existing CVE lookups.

- Add `startedAt: number` to session state (Date.now() at new game start).
- Add a `getGameTime()` helper that returns days-since-startedAt.
- Add `publishedAt: number` to every entry in `vulnerabilityTemplates`. Backfill with a distribution: ~half the CVEs are "already published" (publishedAt = 0), the rest spread across game days 1-30. This ensures a starting pool of CVEs that matter on day 1 plus a future pool that activates over the first month of play.
- Change `findVulnForService(service, version)` to `findVulnForService(service, version, gameTime)`.
- Update every call site (msfconsole, nmap, useNetworkCommands exploit callback).
- Write tests verifying that:
  - A CVE with `publishedAt > gameTime` is NOT returned by the lookup.
  - A CVE with `publishedAt <= gameTime` IS returned.
  - Patching via `apt upgrade` now respects the game clock (safe versions are chosen from CVEs currently active, not the full table).

**Risk**: determinism. Session replays, seed reproducibility, and deterministic tests now depend on game time. For tests, injectable clock; for production, Date.now() at session start.

### PR C — player firewall command

New command `iptables` (or maybe `ufw` — decide during implementation; `iptables` is more realistic but harder to use, `ufw` is simpler).

- Player can list current rules, allow/deny ports on their own machine.
- Closing a port makes that port show as `closed` in nmap from external machines (and blocks inbound traffic).
- Opening a port makes it show as `open`. (Players typically want to keep ports closed to reduce attack surface, but some ports must stay open — their wallet receive port, contract delivery port, etc.)
- Firewall state lives in the session override map (same mechanism as PR A's version overrides).
- Tests: after `iptables_allow(80)` on localhost, a remote `nmap` shows port 80 open. After `iptables_deny(80)`, it shows closed.

Design question: do firewall rules persist across reboots? **Lean yes** — real firewall rules do (via iptables-persistent). Stored in the same session override mechanism.

### PR D — router firmware as a first-class service

- Add `firmware: RouterFirmware` to router-role machines at generation time.
- Add a small pool of router firmware templates (e.g., `Cisco IOS 15.6`, `Mikrotik RouterOS 6.45`, `DD-WRT v24 sp2`).
- Add firmware CVEs (5-10 entries) in a new `firmwareVulnerabilityTemplates` pool. Each has `publishedAt` same as service CVEs.
- `findVulnForFirmware(vendor, version, gameTime)` looks up firmware CVEs.
- `msfconsole` against a router's admin port (SSH, HTTPS, OpenVPN — depending on role) checks firmware CVEs in addition to per-port service CVEs.
- `apt upgrade` when run on a router includes firmware. The syntax becomes `apt('upgrade', 'firmware')` or `apt('upgrade')` upgrades everything including firmware.
- Tests: vulnerable firmware → exploitable via msfconsole → `apt upgrade` closes the window.

### PR E — log rotation + `shred` command

Two features bundled:

**Log rotation**: every log file has a max line count (e.g., 500 lines). When a write would exceed the limit, the oldest lines are dropped. Applies at write time in `appendToMachineLog`. Realistic rotation (moving to `.1`, `.2`, `.gz`) is overkill for this phase — just trim.

**`shred` command**: removes specific log entries.

- `shred(path)` — destroys an entire file (wipes + overwrites). Obvious cover-up. Loggable as a `shred: file destroyed` entry in syslog.
- `shred(path, grep)` — removes all lines in `path` matching the `grep` regex. Subtler cover-up. Loggable too, but the attacker can then shred the shred log... paradox mitigated by: shred is itself logged in a separate root-only file that shred cannot target (e.g., `/var/log/kern.log` kernel-level audit of file-deletion syscalls). Design detail TBD in implementation.

Tests:

- `shred('/var/log/auth.log')` → file gone, root-only audit entry created.
- `shred('/var/log/access.log', 'source-ip-pattern')` → matching lines removed, others intact.
- Log rotation: writing 600 entries to a file with limit 500 leaves exactly 500 entries.

## Acceptance Criteria

Behaviour-driven; observable from the terminal and from filesystem reads:

- [ ] `apt('upgrade')` on a machine with CVE-vulnerable services mutates `port.serviceVersion` to a value that `findVulnForService` returns `undefined` for at the current game time.
- [ ] `apt('upgrade', 'nginx')` upgrades only the matching service, not others.
- [ ] On a fresh game (gameTime = 0), CVEs with `publishedAt > 0` do NOT make their target ports exploitable.
- [ ] After advancing game time past a CVE's `publishedAt`, that CVE's target ports become exploitable.
- [ ] `iptables` (or `ufw`) can close a port on the current machine. A remote `nmap` from another machine then sees that port as `closed`.
- [ ] `iptables_allow` / `iptables_deny` rules persist across `reboot()`.
- [ ] Router machines have a `firmware` field at generation time. Some firmware versions are vulnerable, others are safe.
- [ ] Exploiting a router via `msfconsole` can trigger on firmware vulnerabilities in addition to port-service vulnerabilities.
- [ ] `apt upgrade` on a router updates firmware.
- [ ] A log file that hits its rotation limit drops the oldest lines on the next write.
- [ ] `shred(path)` removes the target file and writes a root-only audit entry.
- [ ] `shred(path, pattern)` removes matching lines from the target file without touching other lines.
- [ ] All new commands have permission checks (root required where realistic).
- [ ] `npm run build`, `npm run lint`, `npm run format:check`, and `npm run test:run` all pass.
- [ ] Mission test breakage, if any, is documented in each PR description.

## Pre-PR Quality Gate

Before each PR:

1. **Mutation testing** — `mutation-testing` skill on the files touched in that PR.
2. **Refactoring assessment** — `refactoring` skill on the touched files.
3. **Full verification loop** — build, lint, format:check, test:run.
4. **Documentation** — update `src/commands/README.md`, `src/logging/README.md`, and `.claude/docs/architecture.md` as features land. When PR B changes the `findVulnForService` signature, that's a load-bearing doc update.
5. **Mission breakage report** — list any failing mission tests in the PR description and tag them for the eventual mission rework.

## Risks & open questions

- **Game time vs mission seeds**. Missions are seeded and deterministic. If `findVulnForService` takes `gameTime`, mission generation at seed X may produce different exploitability at different times. This is either a feature (missions drift with real-world time) or a bug (missions should be reproducible by seed alone). **Decision needed**: does mission generation pin `gameTime = 0` to stay deterministic, or does it use the current time like player machines? My lean: **pin missions to gameTime = 0** so they remain reproducible by seed, and only the _home network / player machine_ feels time drift. Mission CVEs are all "classic" vulns that have been around since day 1; only the home network gets the treadmill.
- **Offline accrual could feel punishing**. Log in after a two-week vacation to find your box is now vulnerable to fourteen new CVEs. Mitigation: cap the rate of CVEs the player actually has to respond to on a single login (e.g., "14 CVEs queued but only 3 are critical to your running services"). Or: slow the publication rate. We'll tune this after PR B lands.
- **Firewall UX vs. wallet gameplay**. If players can close all ports they'll want to close everything. But the future wallet-as-file mechanic needs some port open to receive crypto. Tension between defense and playability. Resolution: specific ports (wallet, contract delivery) refuse to be firewalled, or player accepts the tradeoff of losing income to gain safety. Decide in PR C.
- **`apt upgrade` feels anticlimactic if it's a one-shot trivial command**. Mitigation: add an install time (async, 5-10 seconds of fake download), a chance of failure requiring a retry, or a cooldown. We'll see how it feels after PR A.
- **Log rotation may break existing tests** that assume log files grow unbounded. Audit on PR E.
- **`shred` cover-up paradox**. If `shred` is loggable, the attacker can shred the shred log. The chain has to terminate somewhere. Proposed termination: `/var/log/kern.log` entries for file deletions are written at the "kernel" level and cannot be targeted by `shred` (in-game constraint, not a real filesystem constraint). Realistic: audit daemon integrity.

## Suggested ordering

1. **PR A** — `apt upgrade` (foundation, no time dimension)
2. **PR B** — game-time model + `publishedAt` on CVEs (the architectural PR)
3. **PR C** — firewall command (independent, but makes more sense after the treadmill is established)
4. **PR D** — router firmware (builds on PR A's upgrade path)
5. **PR E** — log rotation + `shred` (the cover-up mechanic)

PRs A, B, D form the backbone. PR C and PR E are parallelizable but ordering them last keeps the defense features in logical build-up order.

---

_Delete this file when Phase 3 is complete. If `plans/` is empty, delete the directory._
