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

Players gain **four new mechanics** that together turn single-player from a static puzzle into a continuous defense treadmill:

1. **`apt upgrade`** — patch running services to a version not matched by any current CVE. One-shot "close the vuln window" action.
2. **CVE time drift** — new CVEs get published over game time. A version that's safe today becomes vulnerable later. Patching is not a one-time chore.
3. **Player-controlled firewall** — open/close individual ports on the player's own machine. Reducing attack surface is a legitimate defense, at the cost of losing services.
4. **Router firmware as a first-class service** — routers gain a firmware version that can be targeted by CVEs and patched via `apt upgrade` like any other service.

Log rotation and the `shred` cover-your-tracks command were originally scoped here but are deferred to Phase 5+ (multiplayer). Shred's real value is in a PvP context where attackers cover tracks from other players; without an adversary reading your logs in single-player, shred is a dry run. Rotation alone is just memory optimization and can ride along with shred when it lands.

## Non-goals

Explicitly out of scope for Phase 3 and deferred to later phases:

- **Log rotation + `shred` command** — moved to Phase 5+ alongside multiplayer. Shred's gameplay value requires an adversary reading your logs, and without that adversary in single-player it's a dry run. Log rotation will ride along with shred.
- **Typed vulnerability effects** (file reads, password changes, directory listings) — Phase 4. Phase 3 still uses the "every exploit gives a shell" model. Only the time dimension changes.
- **CVE feed as a player-facing resource** — Phase 4. Phase 3 may surface "new CVE available" as a subtle ambient message (e.g., a motd line on login or a file in `/var/cve/latest`), but there's no dedicated feed UI.
- **Informed-tradeoff gameplay on severity** — Phase 4. Phase 3 populates the `severity` field but all four shell-producing tiers have identical mechanical outcomes. Players reflexively upgrade because there's no reason not to.
- **Cross-player monitoring** — Phase 5+.
- **Automatic patching / unattended-upgrades** — out of scope forever; this is an active gameplay mechanic, not a background service.
- **Package dependency resolution for running services** — single-service upgrade only; no "this depends on that" graph.
- **IDS alerts / active defense monitoring** — Phase 5+.
- **Honeypot mechanics** — Phase 5+.

## Data model changes

Four additions to Phase 1's data model.

### 1. 1:1 `(service, version) → CVE` invariant with version timelines

Each `(service, version)` pair has AT MOST one CVE entry. A version is either "has exactly one associated CVE" or "has no CVE yet." No second CVE is ever discovered against a version that already has one. This is a simplification of real-world CVSS but cleans up all the gameplay edge cases.

Instead of a flat CVE pool, services have **version timelines** — ordered sequences of versions, each with its own eventually-discovered CVE and a `publishedAt` value marking when that CVE becomes "known" to the game world:

```
http:
  Apache/2.4.49  → CVE-2021-41773  publishedAt: 0   (vulnerable from day 1)
  Apache/2.4.50  → CVE-2026-0001  publishedAt: 5   (publishes on game day 5)
  Apache/2.4.51  → CVE-2026-0002  publishedAt: 12  (publishes on game day 12)
  Apache/2.4.52  → CVE-2026-0003  publishedAt: 20  (publishes on game day 20)
  …
```

The treadmill cycle:

1. Player is on `Apache/2.4.49`, currently vulnerable to `CVE-2021-41773`.
2. `apt upgrade http` → player moves to `Apache/2.4.52` (the latest version whose CVE is still future-dated, `publishedAt > gameTime`).
3. Apache/2.4.52 is currently safe. Player has a breathing window.
4. On game day 20, `CVE-2026-0003` becomes active. Player's current version is now vulnerable.
5. Player runs `apt upgrade http` again → moves further along the timeline.
6. Treadmill continues indefinitely.

### 2. `publishedAt` and `severity` on Vulnerability

```ts
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Vulnerability = {
  readonly cve: string;
  readonly description: string;
  readonly serviceVersion: string;
  readonly attackPattern: AttackPattern;
  readonly publishedAt: number; // NEW — game day when this CVE becomes active
  readonly severity: Severity; // NEW — critical/high/medium/low/info
};
```

`findVulnForService(service, version, gameTime)` filters out CVEs where `publishedAt > gameTime`. Under the 1:1 invariant it returns either the single matching CVE or `undefined`. No multi-match ambiguity.

**Severity semantics in Phase 3**: the field is populated but most tiers have no mechanical effect yet. The four "shell-producing" tiers (`critical / high / medium / low`) all still produce the same outcome in Phase 3 — `msfconsole` gives a shell. The `info` tier is deferred:

- **`info`-severity CVEs are NOT exploitable via `msfconsole` in Phase 3.** `msfconsole` treats a port with only an `info` CVE as safe. No shell is produced.
- This is because `info` semantically means banner leaks, dir listings, username enumeration — outcomes that need typed effects to be meaningful.
- Phase 4 activates `info` alongside typed effects. When that lands, an `info` CVE will produce a specific non-shell outcome (e.g., `cat /etc/passwd` disclosure, directory listing).
- **Initial CVE backfill uses only `critical / high / medium / low`** — no existing CVE is labeled `info` because every existing CVE currently produces a shell. New `info` CVEs will be added in Phase 4.

### 3. Game-time model

A new `gameTime` primitive, derived from real-world time, representing "how far into the game world we are." Locking in **real-world-clock time anchored at first game start**:

```ts
type GameTime = number; // days since the player started the game
// Implementation: Math.floor((Date.now() - startedAt) / MS_PER_DAY)
```

The only persisted field is `startedAt`, added to session state. `gameTime` is derived at read time. Offline accrual is a feature: leave the game for a week, come back to a week's worth of new CVE publications.

Under the 1:1 invariant, **mission seed determinism holds naturally**. The same seed always produces the same machine with the same vulnerable version, which always maps to the same CVE. Missions don't need any special `gameTime` pinning — they're reproducible by seed because of the 1:1 constraint. A mission's vulnerable service is drawn from versions whose CVE has `publishedAt = 0` (classic, always-active vulns), ensuring the mission is solvable regardless of current game time.

### 4. Version overlay via filesystem files

When a player runs `apt upgrade http`, the new version has to be persisted somewhere that survives reloads. Three approaches were considered (session override map, new patch type in the IndexedDB stream, file-on-machine). **Locking in the file-on-machine approach.**

The upgraded version is stored as a file on the machine's filesystem:

```
/var/lib/apt/service_versions/http  →  "Apache/2.4.60"
/var/lib/apt/service_versions/ssh   →  "OpenSSH 9.7"
```

Port-version reads become overlay-aware: check the file first, fall back to the generated version. This reuses the existing IndexedDB filesystem patch stream for persistence — no new patch types needed, no new session-state structures.

**Realistic**: real Linux tracks installed package versions in `/var/lib/dpkg/status`. Players can `cat /var/lib/apt/service_versions/http` to see their current version. In-genre, discoverable, file-based.

**Permissions**: the files are root-owned and only writable by the `apt` command at the implementation level (or at least discouraged from manual editing). A root player could technically `nano` them, but that's in-genre (real sysadmins can do worse).

### 5. Firmware on routers

```ts
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

`findVulnForFirmware(vendor, version, gameTime)` looks up firmware CVEs. Firmware CVEs live in a separate pool (not the service CVE table) with their own version timelines per vendor. Upgraded firmware is stored in `/var/lib/apt/service_versions/firmware` on the router, parallel to the service-version mechanism.

## Version timeline generation and tuning

The per-service version timelines are generated at game start (or on first access) from a pool of version strings per service. `publishedAt` values are assigned with randomized gaps:

```ts
// src/generation/pools/cveTiming.ts (new module)
export const CVE_TIMING_CONFIG = {
  minSafeWindowDays: 3, // shortest time between one CVE publishing and the next for the same service
  maxSafeWindowDays: 21, // longest
  initialVulnerableCount: 2, // how many versions start with publishedAt = 0 (vulnerable from day 1)
};
```

Generation walks the version pool for each service and assigns `publishedAt` values by accumulating random gaps. The first N versions (`initialVulnerableCount`) get `publishedAt = 0` so the player has "classic" CVEs to work with on day 1; subsequent versions get progressively later `publishedAt` values.

All tuning knobs live in `CVE_TIMING_CONFIG` so post-launch playtesting can tweak cadence without code changes.

### Offline accrual and permadeath

Time passes even when the game is closed. Log back in after a week → a week of CVE publications have activated. Realistic, creates genuine pressure.

Permadeath (from earlier brainstorming) resets `startedAt` naturally when a new game begins — the treadmill restarts from day 1 with a fresh CVE timeline.

## Feature overview and PR split

**Suggested 4 PRs, one per feature.** Each is independently mergeable; later PRs depend on earlier ones. (Log rotation + `shred` were originally scoped as PR E here but are deferred to Phase 5+.)

### PR A — `apt upgrade` command (foundation)

Adds a full set of apt subcommands for running-service management plus the file-based version overlay mechanism. No game-time model yet (PR B) — every CVE is "live" in this PR. Every CVE in the timeline that matches the current version is treated as a current threat; patching closes it.

**Subcommand surface** (matches real apt semantics):

```
apt('list')                              # existing — list installable player tools
apt('install', 'nmap')                   # existing — install a player tool
apt('upgrade')                            # NEW — upgrade ALL running services on current machine
apt('upgrade', 'http')                    # NEW — upgrade a specific service to its latest safe version
apt('install', 'http=Apache/2.4.49')      # NEW — install a specific version of a running service (for targeted upgrade or downgrade)
```

No separate `apt downgrade` subcommand. Downgrading is `apt('install', 'service=older-version')` — matches real apt's `apt install package=version` syntax exactly.

**Parsing rules**:

- Single string arg with `=` → service install. Split at first `=`. Left side must be a known service in the machine's running services; right side must exist in that service's version timeline.
- Single string arg without `=` → tool install (if the name is in `APT_PACKAGES`) or service upgrade (if the name matches a running service).
- Invalid service name → `E: Unable to locate service 'http'`
- Valid service, invalid version → `E: Version Apache/9.9.9 not available for service 'http'`
- Valid service, version equal to current → `http is already at Apache/2.4.49` (no-op)
- Root required for all service operations.

**File-based version overlay**:

Upgraded versions are written to `/var/lib/apt/service_versions/<service>` on the target machine's filesystem (the one running `apt`, which in Phase 3 is always localhost). The existing IndexedDB filesystem patch stream persists these files across reloads with no new patch type.

**Read-side integration**:

A new helper `getServiceVersion(machineId, port)` reads the overlay file first and falls back to the generated `port.serviceVersion`. All call sites that currently read `port.serviceVersion` directly switch to this helper — `msfconsole`, `nmap -sV`, the exploit callback, any test fixture that constructs a port.

**Realistic output**: `apt upgrade` simulates a fake download/install with jitter delays and realistic `apt` text (matches the existing tool-install async output). ~5-10 seconds to upgrade a typical machine feels right.

**Version selection logic**:

For `apt upgrade` / `apt upgrade <service>`, the target version is "the newest version in the service's timeline whose CVE has `publishedAt > 0`" (in PR A, since no game-time yet, `gameTime = 0` is assumed). In PR B, this changes to "whose CVE has `publishedAt > currentGameTime`."

**Out of scope for PR A**:

- Game-time model (PR B)
- CVE publication drift over time (PR B)
- Router firmware (PR C — was PR D)
- ~~Firewall rules~~ (deferred to Phase 5+ multiplayer prep)

### PR B — game-time model + `publishedAt` + `severity` on CVEs

The architectural PR. Introduces the game clock, retrofits all CVE lookups, and adds the severity field.

**Game-time plumbing**:

- Add `startedAt: number` to session state (Date.now() when a new game begins).
- Add a `getGameTime()` helper returning `Math.floor((Date.now() - startedAt) / MS_PER_DAY)`.
- Expose `gameTime` as a derived value in the session context, available to command contexts that need it.

**Data model updates**:

- Add `publishedAt: number` and `severity: Severity` fields to `Vulnerability`.
- Enforce the 1:1 `(service, version) → CVE` invariant in `vulnerabilityTemplates`. Audit the current 38 entries for any duplicate `(service, version)` pairs (I don't expect any — all existing entries have distinct versions per service).
- Backfill every existing CVE with `publishedAt = 0` (classic vulns, always active) and a realistic severity (`critical / high / medium / low`, no `info`).
- Add a new `src/generation/pools/versionTimelines.ts` module containing per-service version pools and the `CVE_TIMING_CONFIG` tuning knobs. Each service's timeline is built from its pool entries at generation time by walking forward with randomized gaps.

**Lookup refactor**:

- Change `findVulnForService(service, version)` to `findVulnForService(service, version, gameTime)`.
- Filter out CVEs where `publishedAt > gameTime`. Also filter out `info`-severity CVEs in Phase 3 (they produce no shell outcome, so `msfconsole` treats them as absent).
- Update every call site (`msfconsole`, `nmap` version column + CVE block, exploit callback, and the new `apt upgrade` target-version picker from PR A).

**Apt upgrade picker update**: PR A's version-selection logic assumed `gameTime = 0`. PR B changes it to "the newest version whose CVE has `publishedAt > currentGameTime`." Now the player can only upgrade to currently-unpublished CVEs — so the breathing window is finite and depends on the game clock.

**Tests**:

- A CVE with `publishedAt > gameTime` is NOT returned by the lookup; `msfconsole` reports "no known vulnerability."
- A CVE with `publishedAt <= gameTime` IS returned; `msfconsole` exploits it.
- An `info`-severity CVE is NOT returned even when `publishedAt <= gameTime`.
- After advancing game time past a CVE's `publishedAt`, the same port becomes exploitable.
- `apt upgrade http` picks the newest version in the timeline whose CVE is still future-dated, respecting the current game time.

**Risk**: determinism. For tests, the game clock needs to be injectable (mock `Date.now` via vitest `vi.useFakeTimers` or a dedicated clock abstraction). Production reads `Date.now()` at session start.

### ~~PR C — player firewall command~~ (deferred)

**Deferred to Phase 5+ (multiplayer prep).** In single-player the defensive value is thin:

- The player can already "close" router-forwarded ports by rooting their home router and editing `/etc/iptables/rules.v4` (removing a `forward` rule). Crude but functional.
- On internal machines, killing a service is already a natural way to close the port behind it.
- Local INPUT-chain firewalling only earns its keep when another player is scanning you — i.e., multiplayer.

When we pick this back up, real iptables INPUT semantics (DROP/ACCEPT), a player-facing `iptables` command, and extending the existing NAT-only parser to handle both rule types will all need fresh consideration.

### PR C — router firmware as a first-class service

- Add `firmware: RouterFirmware` to router-role machines at generation time. Populated with a randomly-picked vendor + version from a new pool.
- New `src/generation/pools/firmware.ts` with firmware templates (e.g., `Cisco IOS 15.6`, `MikroTik RouterOS 6.45`, `DD-WRT v24 sp2`, `OpenWRT 19.07`, `pfSense 2.5`).
- New `firmwareVersionTimelines.ts` with per-vendor version timelines paralleling service timelines. Each has its own CVEs with `publishedAt` and `severity`.
- `findVulnForFirmware(vendor, version, gameTime)` companion lookup.
- `msfconsole` against a router's admin port (SSH, HTTPS, OpenVPN — role-dependent) also checks firmware CVEs. If either the port-service CVE or the firmware CVE matches, the exploit succeeds.
- `apt upgrade` on a router includes firmware. Subcommand surface:
  - `apt('upgrade')` on a router → upgrades services AND firmware to the latest safe values
  - `apt('upgrade', 'firmware')` → firmware only
  - `apt('install', 'firmware=MikroTik RouterOS 6.48')` → specific firmware version
- Firmware overlay lives at `/var/lib/apt/service_versions/firmware` on the router — same mechanism as service versions.
- Tests: vulnerable firmware → exploitable via msfconsole → `apt upgrade firmware` closes the window → CVE advances → vulnerable again.

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

- **Mission determinism under game-time drift**. Resolved by the 1:1 `(service, version) → CVE` invariant combined with "mission vulnerable services draw only from `publishedAt = 0` CVEs." Same seed → same vulnerable version → same CVE (always published) → same mission experience, forever. No pinning required.
- **Phase 3 trade-offs feel shallow without typed effects**. All four Phase 3 severity tiers produce the same mechanical outcome (a shell). Players will reflexively run `apt upgrade` whenever a CVE publishes because there's no reason not to. The strategic "should I live with this CVE?" decision arrives in Phase 4 with typed effects. Phase 3 is the infrastructure phase; Phase 4 makes the choices mean something.
- **Offline accrual could feel punishing**. Log in after a two-week vacation to find your box is vulnerable to several new CVEs across multiple services. Mitigation options: slow the `avgPublishCadence` tuning knob, cap "critical CVEs queued since last login" on the login screen, or add a short grace period after a long idle. We'll tune this after PR B lands.
- **Firewall UX vs. wallet gameplay**. If players can close all ports they'll want to close everything. But the future wallet-as-file mechanic (Phase 5+) needs open ports to receive income. Tension between defense and playability. Deferred to Phase 5+ since there's no wallet yet in Phase 3 — noted here so we don't forget it.
- **`apt upgrade` may feel anticlimactic if it's a one-shot trivial command**. Mitigation: fake async download time with realistic apt output (already in the plan for PR A), chance of failure requiring a retry, or a cooldown. Evaluate after PR A plays.
- **Service-version file and manual edits**. A root player could `nano /var/lib/apt/service_versions/http` to set their version to anything they want, including a safe version we didn't intend. In Phase 3 this is acceptable (in-genre, matches real Linux), but it's a potential cheat vector if not constrained. Phase 5+'s server-authoritative multiplayer model will naturally fix this via patch validation.

## Suggested ordering

1. **PR A** — `apt upgrade` + file-based version overlay (foundation, no time dimension)
2. **PR B** — game-time model + `publishedAt` + `severity` + 1:1 invariant (architectural)
3. **PR C** — router firmware as first-class service
4. ~~PR D~~ — firewall command (deferred to Phase 5+ multiplayer prep)

PRs A, B, C form the backbone of the treadmill. The firewall (originally PR C) was deferred because its defensive value only materializes once a second player is scanning your box.

---

_Delete this file when Phase 3 is complete. If `plans/` is empty, delete the directory._
