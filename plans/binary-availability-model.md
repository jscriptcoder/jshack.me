# Plan: Command Binary + Availability + Library Model

**Branch**: feat/v2-binary-availability-model
**Status**: Active — draft; confirm decisions + Slice 1 acceptance criteria before RED.
**Arc**: [project-v2-connectivity-arc] — the foundational system that must exist before the
WiFi-connect flow (aircrack/ifconfig/nmcli) can be gated realistically.

## Goal

Commands are gated by a **binary file on the current machine's filesystem** (legacy model):
system utilities live in `/bin`, apt-installable tools in `/usr/bin`, and shared libraries in
`/lib/*.so`. A missing binary, a missing execute permission, or a missing linked library makes
the command fail with the exact Linux-style error — turning the filesystem into the source of
truth for "what can I run here." Build the **system only**; do not implement new commands.

## Why this slice / why now

The whole connectivity arc needs it: `airmon`/`airdump`/`aircrack` are *pre-installed* tools in
`/usr/bin`; `ifconfig`/`nmcli` are system utilities in `/bin`; later `nmap` is gated behind
`apt install`. None of that is meaningful until binaries gate execution. Story 1 deliberately
deferred `/bin` tools — this is where that debt comes due. It's observable **today** through the
existing FS commands (`ls /bin`, and removing a binary/library breaks `ls`/`cat`/`grep`).

## Legacy reference (port + simplify, like md5/prng)

- `src/commands/availability.ts` — `SYSTEM_UTILITY_NAMES`, `APT_TOOL_NAMES`,
  `LOCALHOST_PREINSTALLED_TOOLS`, `RESTRICTED_EXECUTE`, `APT_PACKAGES`, `BINARY_STUB`,
  `createBinaryEntries`, `createLibraryEntries`, `findBinary`, `checkCommandAccess`,
  `wrapWithAccessCheck`, `binaryToPackage`.
- `src/commands/libraryDeps.ts` — `libraryDeps` manifest + `wrapWithLibraryCheck`.
- `src/generation/pools/systemLibraryTemplates.ts` — the 8 libraries (`SystemLibrary`).

## Decisions (recommendations — CONFIRM before RED)

1. **FS-presence gating, not a declarative field** (legacy model). Classification lives in a
   data module (name lists + sets), mirroring legacy `availability.ts` — NOT a new field on every
   `Command`. The existing `Command.availability` stub (`AvailabilityRule`) is left untouched for
   now (cleanup later); this system is decoupled from it. **Rec: yes.**
2. **FS population extends `buildWorkstationBaseFs`** — `/bin`, `/usr/bin` (pre-installed only),
   `/lib` become part of the workstation base tree (they belong there). Grows the Story-1
   skeleton; the "exactly minimal skeleton" test updates to include them. **Rec: yes.**
3. **Execute-perm gating uses the binary file's `perms.execute`** (legacy), not `Command.tier`.
   Most binaries world-executable; a `RESTRICTED_EXECUTE` few are root-only. **Rec: yes.**
4. **Wrappers applied at registry build** — `buildCommandRegistry` maps each non-always-available
   command through `wrapWithBinaryCheck` then `wrapWithLibraryCheck`; the wrappers read `env.fs`
   at execution (per-machine, mutable). **Rec: yes.**
5. **Scope cuts (DEFER):** no `apt` command (install path lands with `nmap`, post-connect); no
   `/usr/sbin` admin binaries (no admin commands yet); no library versions / CVEs / dpkg / `apt
   upgrade` / `ldd` / `msfconsole --local` / libc. Just file-presence + perms + linker error.
6. **Apt-install hint is data-only now**: the "command not found → `apt install <pkg>`" hint is
   produced from `binaryToPackage`, even though `apt` isn't implemented — the message is correct
   and forward-compatible. **Rec: yes.**
7. **`node` + `gpg` are apt-installable, NOT pre-installed** — deliberate deviation from the
   legacy README (which pre-installs them on localhost). Realistic: a fresh box doesn't ship a
   JS runtime or GPG. So `LOCALHOST_PREINSTALLED_TOOLS = ['airmon', 'airdump', 'aircrack']` only;
   `node`/`gpg` stay in `APT_PACKAGES`/`binaryToPackage` (hint + future `apt install`) but are
   NOT placed in `/usr/bin` at generation. Don't "restore" them to pre-installed later.

## Forward design (OUT OF SCOPE here — but shapes the library layer)

`/lib/*.so` is not just "present or broken." In the future, **libraries carry a version + a CVE
timeline; a live library CVE is an exploitable privilege-escalation vector** (legacy
`msfconsole --local <command>` resolves the command's linked libs via `libraryDeps`, finds a live
CVE, and rolls a `shell_full {tier: root}` effect). Keeping libraries up to date (`apt upgrade`)
is the defender move that closes the window. We DEFER all of that (versions, CVEs, dpkg,
`apt upgrade`, `msfconsole --local`) — but two things must be true so it bolts on without rework:

- **Presence-check stays orthogonal to versioning.** The version/CVE layer attaches to the `.so`
  (content/metadata or a future `/var/lib/dpkg/status`) without changing the presence model.
- **Port `libraryDeps` + the 8-library set FAITHFULLY** (su→libpam/libcrypt, systemctl/reboot/kill
  →libsystemd, ls/find/grep/cat/strings/rm/chmod/ps→libpcre, nano→libreadline, ssh→libssl+
  libreadline, scp/curl→libssl, apt→libz/libxml2). Those mappings are the future exploit surface
  — the 8 libs were chosen to cover all exploit-effect kinds through their linked commands. Do
  NOT invent or simplify the mappings.

## Acceptance Criteria (overall)

- [ ] `buildWorkstationBaseFs` emits `/bin` (system-utility stubs), `/usr/bin` (only the
      localhost pre-installed tools: **airmon, airdump, aircrack** — `node` and `gpg` are NOT
      pre-installed, they're apt-installable), and `/lib` (the 8 `*.so` stubs) — observable via
      `ls /bin` / `ls /usr/bin` / `ls /lib`; tree still byte-deterministic per identity.
- [ ] A system command runs only when `/bin/<name>` exists; removing it →
      `bash: <name>: command not found`.
- [ ] A binary whose `perms.execute` excludes the session tier → `bash: <name>: Permission denied`.
- [ ] Shell builtins (cd/echo/pwd/help/…) + game commands (identity) always run — no binary.
- [ ] A known apt-installable tool that isn't installed →
      `bash: <name>: command not found. Install with: apt install <pkg>`.
- [ ] A command linking a library whose `/lib/<lib>.so` is missing →
      `<name>: error while loading shared libraries: <lib>.so: cannot open shared object file: No such file or directory`.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. Load `tdd`, `testing`,
`mutation-testing`, `refactoring` (+ `typescript-strict`, `functional`) before any code.

### Slice 1: System binaries in `/bin` gate execution (presence + execute-perm)

**Value**: Player — a system command only runs when its `/bin` binary exists and their tier may
execute it; otherwise the real Linux error. The walking skeleton of the whole model.
**Path**: `buildWorkstationBaseFs` emits `/bin` stubs (`createBinaryEntries(SYSTEM_UTILITY_NAMES)`)
→ `core/commands/availability.ts` (`checkCommandAccess` resolves `/bin/<name>` + execute-perm) →
`wrapWithBinaryCheck` HOF → applied in `buildCommandRegistry` (always-available set skips) →
runtime: a removed/again-present `/bin/ls` flips `ls` between not-found and working.
Intentionally skipped: `/usr/bin`, `/lib`, apt hint (Slices 2–3).
**Acceptance criteria**: subset of the list above (the `/bin` population, presence gating,
execute-perm gating, builtins/game always-run). **Present + confirm before RED.**
**RED**: (1) command runs when its `/bin` binary present; (2) returns command-not-found when the
binary is removed; (3) Permission denied when a root-only binary is run as `user`; (4) a builtin
runs with no binary in `/bin`. Mutator watch: the `/bin` path-prefix literal, the `found`/
`permitted` booleans, the `userType === 'root'` bypass, the always-available set membership.
**GREEN**: port `BINARY_STUB` + `createBinaryEntries` + `RESTRICTED_EXECUTE` + the resolver +
`wrapWithBinaryCheck`; wire `/bin` into the base FS and wrapping into the registry.
**MUTATE / KILL / REFACTOR**: per skills. **Done when**: criteria met, report reviewed, approved.

### Slice 2: Pre-installed apt tools in `/usr/bin` + apt-install hint

**Value**: Player — pre-installed WiFi tools (airmon/airdump/aircrack) resolve from `/usr/bin`; a
known-but-uninstalled apt tool (e.g. `node`, `gpg`, `nmap`) reports the exact `apt install <pkg>`
hint.
**Path**: `buildWorkstationBaseFs` adds `/usr/bin` = `createBinaryEntries(LOCALHOST_PREINSTALLED_TOOLS)`
(= airmon/airdump/aircrack only) → resolver searches `/bin` then `/usr/bin` → `binaryToPackage`
(from `APT_PACKAGES`) drives the hint in the not-found branch. Observable via `ls /usr/bin`; the
hint is unit-tested on the wrapper now (no apt-tool command exists yet — full end-to-end lands
with `aircrack`/`nmap`).
**Acceptance criteria**: `/usr/bin` pre-installed population; resolver finds `/usr/bin` binaries;
not-found for a mapped apt tool yields the install hint; not-found for an unmapped name yields the
plain message. **Present + confirm before RED.**
**RED**: (1) `ls /usr/bin` lists exactly the pre-installed set; (2) resolver resolves a `/usr/bin`
binary; (3) hint message for a mapped-but-absent tool; (4) plain message for an unmapped name.
Mutator watch: the `/usr/bin` prefix, the `binaryToPackage` lookup, the hint string.
**GREEN**: port `LOCALHOST_PREINSTALLED_TOOLS` + `APT_PACKAGES` + `binaryToPackage`; extend
resolver + the not-found branch.
**MUTATE / KILL / REFACTOR**: per skills. **Done when**: criteria met, report reviewed, approved.

### Slice 3: Library dependency check (`/lib/*.so`)

**Value**: Player — a command whose linked library was removed fails with the canonical
dynamic-linker error; a populated `/lib` lets the linked commands run.
**Path**: `buildWorkstationBaseFs` adds `/lib` = `createLibraryEntries(SYSTEM_LIBRARIES)` →
`core/commands/libraryDeps.ts` (`libraryDeps` manifest + `wrapWithLibraryCheck`) → applied in
`buildCommandRegistry` after the binary check → runtime: `rm /lib/libpcre.so` then `ls`/`cat`/
`grep`/`rm` emit the linker error; restoring it lets them run.
**Acceptance criteria**: `/lib` population (8 `*.so`); a command in `libraryDeps` with a missing
linked `.so` → linker error naming the lib; a command NOT in `libraryDeps` runs regardless;
present + all libs → linked commands run. **Present + confirm before RED.**
**RED**: (1) `ls` fails with the linker error when `/lib/libpcre.so` is removed; (2) `ls` runs
when present; (3) a no-deps command (e.g. `mkdir`) runs even with `/lib` emptied. Mutator watch:
the `/lib/<lib>.so` path literal, the error string, the per-lib loop, the no-deps pass-through.
**GREEN**: port `SystemLibrary`/`SYSTEM_LIBRARIES` (names only), `createLibraryEntries`,
`libraryDeps`, `wrapWithLibraryCheck`; wire `/lib` + the wrap.
**MUTATE / KILL / REFACTOR**: per skills. **Done when**: criteria met, report reviewed, approved.

## Pre-PR Quality Gate (per slice / PR)

1. Mutation testing — `mutation-testing` skill (note v2 Stryker quirks: load-throw + root-bypass
   equivalents per project memory).
2. Refactoring assessment — `refactoring` skill.
3. Typecheck + lint — **v2 has no Prettier; `npm run lint` is the format gate.**
4. Bump version (`v2/package.json` + lock) per the feature-bump preference.
5. Update the Story-1 `workstationFs.test.ts` "exactly minimal skeleton" assertion as the tree
   grows (`/bin`, `/usr/bin`, `/lib` added) — keep it an explicit allow-list, not loosened.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
