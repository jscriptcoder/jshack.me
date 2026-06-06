# Plan: `apt install` + `apt list` (Generator Epic — Story 1.5)

**Branch**: per-slice (`feat/v2-apt-install`, `feat/v2-apt-lib-deps`, `feat/v2-apt-list`)
**Status**: Proposed — awaiting approval of slices
**Parent epic**: `plans/network-generator-epic.md` → Story 1.5 (precedes the nmap scan)

## Goal

A player, online and root on their workstation, runs `apt install <pkg>` to install a tool's
binary (and its shared-lib deps) into the filesystem, and `apt list` to see what's installable
/ installed. This is the real reachability mechanism — it replaces the "preinstall in `/usr/bin`"
hack and unblocks every apt-gated tool (nmap next).

## Owner decisions (locked 2026-06-04)

1. **First-slice scope**: `apt install` **+ `apt list`** (update/remove/upgrade deferred).
2. **Privilege**: **root required** — as `user` you must `su` first (intro root password).
   Matches real apt; `/usr/bin` and `/lib` are root-owned.
3. **Install depth**: **binaries + their `/lib` shared-lib deps** (resolve the package's required
   libraries and write any that are missing).
4. **Online gate**: **required** — offline `apt install`/`apt list` errors (`env.network.isOnline()`).

## ⚠ Reachability dependency — `su` does not exist yet (found via live E2E 2026-06-05)

The root gate is correct, but **v2 has no `su` command** and the player starts as `user`
(`seed.ts`), with no elevation path. Verified in the running app (`localhost:3100`):
`apt install nmap` → correct "are you root?" gate; `su` → `bash: su: command not found`.
So `apt install`'s happy path is **unreachable by a real player until `su` ships**. The apt code
is correct (unit + cross-layer integration tests prove the install→availability flip with a root
session); the missing piece is the sibling `su` command. **Implement `su` before apt is "usable".**
`su` is foundational anyway (legacy had it; `libraryDeps` already lists `su: ['libpam','libcrypt']`;
`/bin/su` already exists in the base FS). Recommend a `su` slice/plan next.

## Context the plan rests on (verified)

- **Write path**: mutation routes through `env.patches` (PatchApi), never `FsView` (read-only).
  `env.patches.write(path, content, { isNew: true })` writes a file via a signed `/api/patches`
  POST; the client refetches the patch journal after each write, so installs **persist across
  reload** (`adapters/patchApi.ts`, `ui/state.ts → wrapWithRefetch`).
- **Binary resolution**: `availability.ts` searches `['/bin', '/usr/bin']`; a command is "installed"
  when `env.fs.stat('/usr/bin/<name>')` (or `/bin`) returns a file. So `apt install` must write
  `/usr/bin/<binary>` with the binary FileNode shape.
- **Binary stub shape**: `BINARY_STUB` (20-byte ELF header) + `owner:'root'`, perms
  `{read:[root,user,guest], write:[root], execute:[root,user,guest]}` (`generation/binaries.ts`).
- **Library model**: `/lib/<lib>.so` stubs (`generation/libraries.ts`, perms `execute:[]`);
  `libraryDeps` maps **command→libs** at runtime (`commands/libraryDeps.ts`). The 8 `SYSTEM_LIBRARIES`
  all ship on the workstation at cold start — so installing a lib **on your own box is a no-op**;
  the missing-lib payoff is observable only on a lib-incomplete machine (remote, later). No apt
  package maps to libs yet — that mapping is **net-new, ported from legacy**
  (`src/commands/availability.ts` `APT_PACKAGES` + `extraFiles`).
- **Catalog**: `commands/aptPackages.ts → APT_PACKAGES` (`{name, binaries?}`) + `packageForBinary`.
  Already drives the not-found install hint. `apt` binary stub already exists in `/bin`, but there
  is **no `apt` command** registered yet — this plan adds it.
- **Online**: `env.network.isOnline()` exists; no command gates on it yet — apt would be the first.

## Acceptance Criteria

- [x] As root + online, `apt install nmap` writes `/usr/bin/nmap` (verifiable via `ls /usr/bin`),
      reports the install, and the file survives reload. _(write proven by unit tests; reload/`ls`
      via the patch journal pending the UI E2E)_
- [x] Multi-binary packages install all their binaries (e.g. `apt install netcat` → `/usr/bin/nc`;
      `apt install aircrack` → airmon/airdump/aircrack).
- [x] As `user` (not root), `apt install` is refused with an apt-style "permission denied / are you
      root?" error and writes nothing.
- [x] Offline, `apt install` errors and changes nothing. _(`apt list` offline lands in Slice 3)_
- [x] `apt install <unknown>` → apt-style "Unable to locate package <unknown>"; no write.
- [x] Installed binaries are world-executable so the user-tier player can run them (folded-in
      `PatchApi.write` permissions override; binary stamped read+execute for all tiers, write root).
- [x] `apt install` of a package with lib deps writes the package's required `/lib/*.so` that are
      missing (proven on a lib-incomplete fixture); already-present libs are left untouched.
      _(Slice 2 SHIPPED — `installPackageLibraries(env, binaries, deps=libraryDeps)`, deps injectable
      for fixtures. No real apt tool maps to a lib yet, so it's a localhost no-op today; proven by 6
      fixture tests + 5/5 hand-mutation kills. Reuses the Slice-1 patch-write seam, so no new E2E.)_
- [ ] `apt list` shows installable packages; `apt list --installed` shows those whose binaries are
      present in `/bin`/`/usr/bin`.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing
test. Load `tdd`, `testing`, `mutation-testing`, `refactoring` before code. Run `npm run lint` in
`v2/` (no Prettier — `project_v2_no_prettier_format_gate`). Bump version (`package.json` +
`package-lock.json`) per slice. E2E the primitive through the UI before "done"
(`feedback_e2e_test_new_primitives`).

### Slice 1: `apt install <pkg>` installs a package's binaries (walking skeleton)

**Value**: Player (root, online) installs a tool's binary into `/usr/bin`; it persists.
**Path**: new `apt` command (`category:'network'` or `'general'`, `tier:'root'`) → parse
`install <pkg>` → gate: offline → error; non-root → apt "are you root?" error → look up `<pkg>` in
`APT_PACKAGES` (unknown → "Unable to locate package") → for each binary it ships,
`env.patches.write('/usr/bin/<bin>', BINARY_STUB, { isNew:true })` with the binary perms → report
`Setting up <pkg> ...`. Register in `registry.ts` `builtins[]`. Skipped: lib deps (Slice 2),
`apt list` (Slice 3), update/remove/upgrade.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `api-design`.
**Acceptance criteria**: the install/persist/multi-binary/non-root/offline/unknown-package criteria
above. **Confirm before code.**
**RED**: command tests — root+online install writes the expected `/usr/bin/<bin>` patch(es);
non-root refused + no write; offline refused; unknown package message + no write; multi-binary
package writes all. Mutator watch: the root-tier predicate, the online predicate, the
unknown-package branch, the per-binary loop (off-by-one / drop), the `isNew` flag.
**GREEN**: minimal `apt install` over `APT_PACKAGES` via `env.patches.write`.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met, mutation report reviewed, human approves commit.

### Slice 2: `apt install` also installs the package's `/lib` deps

**Value**: An installed tool's shared-lib deps are present, so it won't hit the dynamic-linker
error on a machine that lacks them.
**Path**: add a **package→libraries** mapping (port legacy `APT_PACKAGES.extraFiles` / derive from
`libraryDeps` for the package's binaries) → on install, for each required `<lib>`, if
`/lib/<lib>.so` is missing, `env.patches.write('/lib/<lib>.so', BINARY_STUB, { isNew:true })` with
library perms (`execute:[]`); present libs untouched. Skipped: non-lib extraFiles (configs/shares),
version/CVE metadata.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: on a **lib-incomplete fixture**, installing a package with lib deps writes
exactly the missing `.so`(s) with correct perms; already-present libs are not rewritten; on the
full workstation it's a no-op for libs. **Confirm before code.** _Note: observable end-to-end only
on lib-incomplete machines (remote, later); proven now via fixture + unit tests._
**RED**: lib-resolution tests on the fixture (missing lib written; present lib skipped; perms
`execute:[]`; multi-lib package). Mutator watch: the "missing?" predicate, the present-skip branch,
perms array, the per-lib loop.
**GREEN**: package→lib resolution + conditional writes.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met, mutation report reviewed, human approves commit.

### Slice 3: `apt list` (+ `--installed`)

**Value**: Player discovers what's installable and what's already installed.
**Path**: `apt list` renders `APT_PACKAGES`; `apt list --installed` filters to packages whose
binaries resolve in `/bin`/`/usr/bin` (reuse the availability resolver). Online-gated. Skipped:
versions, descriptions, `apt search`.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: `apt list` lists the catalog; `--installed` shows only present-binary
packages; offline → error. **Confirm before code.**
**RED**: list renders catalog; `--installed` reflects FS state (install one, it appears); offline
errors. Mutator watch: the `--installed` filter predicate, the flag parse.
**GREEN**: list rendering + installed filter.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met, mutation report reviewed, human approves commit.

### Slice 4: keyword tab-completion for apt's operation (`install` / `list`)

**Value**: Player presses Tab on `apt <TAB>` and gets the operation keywords (`install`, `list`)
completed — legacy parity. Today v2's completion treats arg0 after a command as a PATH, so
`apt in<TAB>` wrongly looks for files; and `CommandArgument` has no `values` to declare the set.
**Why after Slice 3 (DECIDED 2026-06-05)**: apt is v2's FIRST command with a fixed-value first
positional — exactly the case `core/shell/complete.ts` deferred ("no v2 command has a fixed-value
first positional yet"). Running this after `list` ships means keyword completion lands against the
COMPLETE operation set (`install` + `list`) in one slice, not added twice.
**Path**: re-add `values?: readonly string[]` to `CommandArgument` (`commands/types.ts`) — the field
legacy used, dropped until a consumer existed; apt is that consumer → declare its `operation` arg
`values: ['install', 'list']`. Extend `complete.ts`: classify the arg0-after-command position and a
new `completeKeyword` that completes against the resolved command's first-argument `values` (via the
existing `CompleteAdapter.getCommand`). Update the stale comments in `complete.ts` and `types.ts`.
This is a shell-level capability any future fixed-value-positional command reuses (apt = first).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: `apt <TAB>` → `install`, `list`; `apt in<TAB>` → `install ` (keyword, NOT a
filesystem lookup); `apt install <TAB>` still completes packages/paths as before (arg1 unaffected);
a command WITHOUT declared `values` is unchanged (no regression to path/flag completion).
**Confirm before code.**
**RED**: completion tests — arg0 keyword matches + common-prefix + single-match trailing space;
no-`values` command still path-completes. Mutator watch: the arg0-position classification predicate,
the `values` lookup, the prefix filter.
**GREEN**: `values` field + apt declaration + `completeKeyword` path.
**MUTATE / KILL MUTANTS / REFACTOR**: per skills.
**Done when**: criteria met, mutation report reviewed, human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing (`mutation-testing`) — report reviewed.
2. Refactoring assessment (`refactoring`).
3. `npm run lint` + typecheck + `npm run test:run` pass in `v2/`.
4. E2E through the UI: `su` to root → `apt install nmap` → `ls /usr/bin` shows it → reload → still
   there → `apt list --installed` shows it.

---

_Delete this file when all four slices ship. The nmap scan (Story 2) consumes `apt install nmap`._
