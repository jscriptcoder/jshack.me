# Plan: System Library CVEs

**Branch**: feat/system-library-cves
**Status**: Active

## Goal

Introduce shared system libraries (`libpam`, `libcrypt`, `libsystemd`, `libreadline`, `libssl`, `libz`, `libxml2`, `libpcre`) as a new CVE surface with full treadmill + patch-delay behaviour. Pre-installed `/bin/` and `/usr/sbin/` commands link to these libraries; a live CVE on a linked library makes the command locally exploitable via `msfconsole --local <command>`. Defenders patch via `apt upgrade <library>` or via meta-package bundles (`auth-libs`, `crypto-libs`, `system-libs`, `data-libs`). Removing a library file breaks every command that depends on it, emitting the canonical glibc dynamic-linker error.

## Background

Today all CVEs target network-exposed services (service version on a port) and router firmware. Once an attacker has a shell on a machine, there is no programmatic way to escalate privileges or gain new capabilities — the game has no local-exploitation gameplay. This feature adds local exploitation by pushing CVEs one level below commands, into the shared libraries that real-world commands actually link against.

**Scope decisions (from design discussion — captured in memory under `project_multiplayer_defense_pressures.md`):**

- **System libraries only for v1.** Apt-installable tools (nmap, hydra, mysql, etc.) are assumed to ship with their own bundled libraries as a separate feature (#4, poisoned-response counter-attack). Pre-installed `/bin/` and `/usr/sbin/` commands are this feature's scope.
- **8 libraries chosen for realism + effect coverage:** libpam, libcrypt, libsystemd, libreadline, libssl, libz, libxml2, libpcre. libc intentionally skipped (blast radius too broad for v1).
- **4 meta-packages:** auth-libs, crypto-libs, system-libs, data-libs. Coarser than real Debian but matches the attack taxonomy.
- **Library file model:** each library is a file in `/lib/<libname>.so`, root-owned. Before a dependent command runs, the dispatcher verifies every linked `.so` exists; if not, emits the glibc-style error `<command>: error while loading shared libraries: <lib>.so: cannot open shared object file: No such file or directory`. `apt remove <library>` deletes the file and breaks dependents.
- **Effect dispatch:** each command carries its own effect pool (`effectPicker.ts` pattern). When a library CVE triggers exploitation, the effect is rolled from the _command's_ pool, not the library's. One libpcre CVE produces `dir_list` via `ls`, `file_read` via `grep`, `file_read`/`dir_list` via `find`.
- **`ldd` command** ships alongside the runtime check — flavour/debug utility showing each command's linked libraries and whether the `.so` is present.
- **Command → library manifest:**

  | Command     | Libraries           | Effect pool                                       |
  | ----------- | ------------------- | ------------------------------------------------- |
  | `su`        | libpam, libcrypt    | `shell_full { root }`, `password_reset`           |
  | `systemctl` | libsystemd          | `shell_full`, `backdoor_port_open`, `script_exec` |
  | `nano`      | libreadline         | `file_read`, `file_write`                         |
  | `ls`        | libpcre             | `dir_list`                                        |
  | `find`      | libpcre             | `file_read`, `dir_list`                           |
  | `grep`      | libpcre             | `file_read`                                       |
  | `apt`       | libz, libxml2       | `file_read`, `file_write`, `script_exec`          |
  | `ssh`       | libssl, libreadline | `shell_full`, `shell_limited`, `script_exec`      |
  | `scp`       | libssl              | `file_read`, `file_write`, `shell_limited`        |
  | `curl`      | libssl              | `file_read`, `shell_limited`                      |

  Commands not in this table (`cat`, `strings`, `rm`, `chmod`, `mkdir`, `echo`, `ping`, `ifconfig`, `nmcli`, `man`, `reboot`, `ps`, `kill`, etc.) link only libc in reality and are left unmodelled in v1 — they still run, they just aren't attack surface until libc joins later.

- **All 8 effects covered:** `shell_limited` (libssl, libreadline), `shell_full` (libpam, libsystemd, libssl), `file_read` (libpcre, libreadline, libxml2, libssl, libz), `dir_list` (libpcre), `file_write` (libreadline, libxml2, libssl), `password_reset` (libpam + libcrypt), `backdoor_port_open` (libsystemd), `script_exec` (libsystemd, libxml2, libreadline).

## Acceptance Criteria

- [ ] Eight system libraries (libpam, libcrypt, libsystemd, libreadline, libssl, libz, libxml2, libpcre) each have a `VersionTemplate` and procedurally walked version timeline with patch delay, identical shape to the existing service/firmware timelines.
- [ ] Every machine's filesystem contains `/lib/<libname>.so` for each library, root-owned, readable by all users, with version metadata readable via `/var/lib/dpkg/status` or equivalent.
- [ ] When any linked `.so` file is missing, the dependent command fails with the glibc-style error and does not execute its body.
- [ ] `ldd <command>` prints each library's resolved path (or `not found`) with stable fake addresses.
- [ ] `msfconsole --local <command>` on a breached machine checks the command's library manifest → looks up any active library CVE → if found, rolls an effect from the command's effect pool. No live CVE → "no known vulnerability" (same copy as the network path).
- [ ] `apt upgrade <library>` upgrades a single library to the latest safe version (respecting patch delay). `apt upgrade <meta-package>` upgrades every library in the bundle in one command.
- [ ] `apt list -u` output includes one row per library / meta-package alongside existing services and firmware, with the same three status variants already shipped.
- [ ] `apt install <library>=<version>` pins a specific version (including deliberately-vulnerable downgrades, same semantics as service pinning).
- [ ] `apt remove <library>` deletes the `.so` file; subsequent invocations of any dependent command fail with the dynamic-linker error.
- [ ] Every existing test suite that exercises a pre-installed command still passes — either because the command has no libraryDeps entry, or because the test fixture includes the necessary `/lib/*.so` files.
- [ ] `README.md`, `src/generation/README.md`, `src/commands/README.md`, `.claude/docs/infrastructure-design.md`, and `.claude/docs/mission-variations.md` updated.
- [ ] Version bumped in `package.json` + `package-lock.json` (minor).

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test. Each step is a single PR-ready commit.

### Step 1: Library templates + CVE lookup + filesystem integration

**Acceptance criteria**:

- New `src/generation/pools/systemLibraryTemplates.ts` with `VersionTemplate` entries for all 8 libraries.
- New `src/generation/systemLibraryLookup.ts` exports `findLibraryCve(library, version, gameTime)` and `findLatestSafeLibrary(library, gameTime)`, both mirroring the firmware lookup API and reusing the existing walker + `CVE_TIMING_CONFIG`.
- Filesystem generator populates `/lib/<libname>.so` on every machine (including localhost) with an empty binary-stub file, root-owned, permissions `{ read: all, write: root, execute: [] }`.
- The starting library version (at gameTime 0) comes from the template's `startTuple`, recorded in `/var/lib/dpkg/status` so existing dpkg-aware tooling can read it.
- Purely plumbing step — no gameplay change yet. Existing tests continue to pass. No command references a library's presence yet.

**RED**: Tests that verify (a) `findLibraryCve` returns a vulnerability for a known procedural version at/after its publishedAt and undefined before; (b) `findLatestSafeLibrary` returns undefined during the patch-delay gap and the next version after it elapses (mirroring firmware tests); (c) a newly-generated home network's router machine has `/lib/libpam.so` with root owner and a readable dpkg status entry carrying libpam's version.
**GREEN**: Build the pool, the lookup, and extend the filesystem generator to emit library files + dpkg entries.
**MUTATE**: Run `mutation-testing` on `systemLibraryLookup.ts` and the timeline-gap branches.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Check whether `systemLibraryLookup.ts` can share more with `firmwareLookup.ts` (they should end up nearly identical).
**Done when**: full suite green, `/lib/` visible in dumped networks, CVE lookup works at arbitrary gameTimes.

### Step 2: Runtime library dependency check + `ldd` command

**Acceptance criteria**:

- New `src/commands/libraryDeps.ts` exports the 10-command → libraries manifest (exact table from Background).
- Central helper in command dispatch runs before any command with a `libraryDeps` entry executes. If any linked `.so` is missing from `/lib/`, throw `<command>: error while loading shared libraries: <lib>.so: cannot open shared object file: No such file or directory`.
- Commands with no `libraryDeps` entry are unaffected — runtime check is opt-in per-command.
- New `ldd <command>` command prints each linked library, resolved path under `/lib/`, and stable fake load address. Missing libraries show `not found`.
- No attacker exploitation yet — this step is purely the "libraries gate command execution" mechanic.

**RED**: Tests that (a) running `su` with `/lib/libpam.so` deleted throws the dynamic-linker error containing "libpam.so" and "No such file or directory"; (b) running `cat` (no libraryDeps entry) succeeds even with `/lib/` wiped; (c) `ldd su` lists libpam and libcrypt with paths, returns "not found" when one is missing; (d) `ldd` on a command without libraryDeps prints an empty dependency list or a sensible message.
**GREEN**: Wire the check into the dispatch path, add `libraryDeps.ts`, implement `ldd`.
**MUTATE**: Run `mutation-testing` on the dependency check + ldd output.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: The check probably duplicates existing patterns for "command needs WiFi" etc.; look for a shared guard abstraction.
**Done when**: deleting a library breaks every dependent command with the right error; ldd reflects reality; no unrelated test breaks.

### Step 3: `msfconsole --local <command>` — offensive local exploitation

**Acceptance criteria**:

- `msfconsole` accepts a new `--local <command>` invocation that runs against the current machine instead of resolving an IP/port.
- Resolution flow: load the command's library manifest → for each library, call `findLibraryCve(library, version, gameTime)` → if any returns a live CVE, pick the first (or a deterministic choice) → roll an effect from the command's effect pool using a PRNG seeded by `(machineId, command, cve)` → apply the effect exactly as network exploits do.
- No live CVE in any linked library → same "no known vulnerability" message that network msfconsole prints.
- Effect application reuses existing logic — `shell_full` opens the same shell overlay, `file_write` uses the same scp-style third argument, etc. Nothing new in the effects layer.
- A per-command effect pool (`systemCommandEffects.ts` or similar) drives the roll, seeded per command from the manifest in Background.

**RED**: Integration tests at three gameTimes around a known libpam CVE: before publishedAt (`msfconsole --local su` → no vulnerability), inside patch gap (libpam vulnerable, `--local su` succeeds, rolls `shell_full` or `password_reset`), after `apt upgrade auth-libs` (libpam patched, `--local su` → no vulnerability). Plus a test verifying the same libpam CVE can be exploited via `su` on one run and that the effect stays stable (determinism).
**GREEN**: Add `--local` parsing to msfconsole, the library-resolution path, the per-command effect pool, and the roll.
**MUTATE**: Run `mutation-testing` on the resolution + effect roll.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Look for duplication between `findExploitableCve` (network) and the new local resolver. Likely some; extract shared helper if clean.
**Done when**: a player with a shell on a machine can `msfconsole --local <cmd>` and either escalate/gain capability or hit "no known vulnerability," based entirely on the library CVE state at game time.

### Step 4: apt integration — upgrade, list, pin, remove for libraries + meta-packages

**Acceptance criteria**:

- `apt upgrade <library>` upgrades one library's `/lib/*.so` file + dpkg entry to `findLatestSafeLibrary`'s result.
- `apt upgrade` (bare) upgrades every vulnerable library on the current machine alongside existing services/firmware.
- Meta-packages `auth-libs`, `crypto-libs`, `system-libs`, `data-libs` are recognised: `apt upgrade auth-libs` upgrades libpam + libcrypt in one invocation.
- `apt list --upgradable` / `-u` output includes a row per library and per meta-package, reusing the existing three status variants (`[upgradable → <version>]`, `[vulnerable, no fix yet — ETA ~N days]`, `[up to date]`). Meta-package row aggregates child statuses (worst status wins).
- `apt install <library>=<version>` pins a specific library version, writing the `.so` file and dpkg entry at the pinned version. Validates the pinned version is reachable in the procedural timeline (mirrors service pinning).
- `apt remove <library>` deletes `/lib/<libname>.so`. Subsequent dependent-command invocations hit the Step 2 dynamic-linker error.

**RED**: Tests for: upgrade single library; upgrade meta-package (verifies every child library bumped in one call); `apt list -u` showing libraries interleaved with services; pinning via `apt install libpam=<old version>`; `apt remove libpam` deletes file and breaks `su`.
**GREEN**: Extend `collectUpgradeCandidates`, `resolveServiceCandidate`/`resolveFirmwareCandidate` pattern to libraries. Add meta-package resolution. Extend `handleList` upgradable rendering. Add library removal path.
**MUTATE**: Run `mutation-testing` on the extended apt paths.
**KILL MUTANTS**: Address survivors.
**REFACTOR**: Apt now handles services, firmware, and libraries — look for opportunities to unify the three `resolve*Candidate` helpers.
**Done when**: players can upgrade, list, pin, and remove libraries + meta-packages end-to-end, with all three patch-delay status variants represented.

### Step 5: Documentation + version bump

**Acceptance criteria**:

- `README.md` mentions the library-CVE layer, `msfconsole --local`, `ldd`, and meta-packages.
- `src/commands/README.md` updates apt for the new library/meta-package handling and adds msfconsole `--local` + ldd entries.
- `src/generation/README.md` documents `systemLibraryTemplates`, `systemLibraryLookup`, and the library timeline.
- `.claude/docs/infrastructure-design.md` adds the library layer alongside services and firmware.
- `.claude/docs/mission-variations.md` extends the "Procedural CVE Timing" section to include libraries.
- `package.json` + `package-lock.json` bumped (minor).
- `npm run format` applied to all `*.md` changes.

**RED**: N/A for pure docs + version bump. Still run full check suite (`build`, `lint`, `format:check`, `test:run`).
**GREEN**: Edit docs and bump version.
**MUTATE**: N/A.
**KILL MUTANTS**: N/A.
**REFACTOR**: N/A.
**Done when**: docs accurate, version bumped, full verification green, PR opened.

## Pre-PR Quality Gate

Before each step's commit:

1. `npm run build`
2. `npm run lint`
3. `npm run format:check` (or `npm run format`)
4. `npm run test:run`
5. Mutation testing — `mutation-testing` skill on files touched in the step.
6. Refactoring assessment — `refactoring` skill.

## Decisions locked in

- `apt list -u` **default-shows** libraries + meta-packages alongside services and firmware. Treadmill visibility is the point.
- Starting library versions are **uniform across all machines** — day-0 libraries use the template's `startTuple`, matching how service versions are currently assigned.
- **Localhost is on the same treadmill** as remote machines. Same 8 libraries in `/lib/`, same patch obligations, no special-casing.
- `ldd` is **universally runnable** (does not require root), matching real Linux.
- Local exploit entry point is `msfconsole --local <command>` — a simplification consistent with the existing unified msfconsole abstraction (real Metasploit would use per-CVE local modules).

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
