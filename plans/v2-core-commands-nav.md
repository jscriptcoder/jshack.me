# Plan: v2 core navigation commands

**Branch**: feat/v2-core-nav-commands (per-slice child branches off the running feat branch, squash-merged)
**Status**: Active

## Goal

Give the terminal user real filesystem navigation — see where you are (`pwd`), move (`cd`), list contents (`ls` + `-a`/`-l`/`-la`). As a side-effect, exercise the per-command stacking infrastructure shipped in PR #177 with its first real consumer.

## Acceptance Criteria

- [ ] `pwd` prints the current absolute path as a single text line, exit 0
- [ ] `cd <dir>` changes the shell's cwd; subsequent commands resolve relative paths against the new cwd
- [ ] `cd` with no arg goes to the session's home directory
- [ ] `cd <not-found>` / `cd <file>` / `cd <perm-denied>` each report the appropriate error, leave cwd unchanged, exit 1
- [ ] Prompt displays the current cwd and re-renders when it changes
- [ ] `ls` lists the cwd's non-hidden entries, sorted, one per line
- [ ] `ls <path>` lists the named directory; `ls <file>` echoes the path (matches real `ls`)
- [ ] `ls -a` includes hidden entries; `ls -l` shows long format; `ls -la` (stacked) does both — and so do `ls -al` and `ls -l -a`
- [ ] `cat -na` is STILL rejected (no opt-in to stacking) — regression guard for the stacking infrastructure
- [ ] All behavior covered by mutation-tested unit tests; one integration assertion per slice in `terminal.test.tsx`

## Architectural decision: cwd seam

**Decision**: cwd is per-shell-session state owned by the UI layer (Solid signal in `ui/state.ts`). The `CommandEnv` exposes `setCwd(path: AbsPath): void` as a top-level method, and `FsView.cwd()` reads the current value via the injected reader. Tests pass a mock `setCwd` recorder.

**Rejected alternatives**:
- `env.fs.chdir(path)` — mixes mutation into FsView, which is otherwise a pure read projection
- Command returns a `mode_change`-style state diff — heavy mechanism for a single field write
- Keep cwd in FsView only and rebuild FsView per command — wasteful and couples FsView lifecycle to a session-state concern

**Why this shape**: matches real bash (`$PWD` is a shell variable, not an FS property), keeps `FsView` a pure read projection, lets the UI layer own persistent state, and keeps the command boundary narrow. Aligns with [[project-v2-framework-agnostic-core]] — `core/` stays framework-agnostic; the signal lives in `ui/`.

## Slices

Every slice follows RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR. No production code without a failing test. Before code changes begin in any slice, load `tdd`, `testing`, `mutation-testing`, and `refactoring`.

### Slice 1: `pwd` + `cd` + cwd-aware prompt

**Value**: terminal user can see where they are and navigate. Establishes the cwd seam every subsequent nav command depends on.
**Path**: input → tokenize → bindFlags (empty/minimal spec) → `runCommandLine` → command.execute. `pwd` reads `env.fs.cwd()`. `cd` resolves arg via `resolveAbsPath`, calls `env.fs.stat()` (or equivalent) to check existence/dir/perm, then `env.setCwd(absPath)`. UI's cwd signal updates → next `commandEchoLine` renders new cwd → next `buildCommandEnv` sees new cwd.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria**:
- `pwd` prints `env.fs.cwd()` exactly (one text line, exit 0)
- `cd /tmp` updates cwd; immediately `pwd` prints `/tmp`
- `cd` (no arg) sets cwd to the session's home directory (`/home/${username}` for `user`, `/root` for `root`, exact derivation TBD in GREEN — keep one source of truth)
- `cd ..` resolves correctly via existing `resolveAbsPath`
- `cd /nope` → `cd: /nope: No such file or directory`, exit 1, cwd unchanged
- `cd /etc/passwd` → `cd: /etc/passwd: Not a directory`, exit 1
- `cd /root` (as user-tier) → `cd: /root: Permission denied`, exit 1
- Prompt format changes from `alice@workstation>` to `alice@workstation:<cwd>$` (bash-style) and re-renders after `cd`
- `terminal.test.tsx`: typing `cd /tmp` then `pwd` shows `/tmp` in scrollback

**RED**:
- `pwd.test.ts`: prints cwd verbatim; covers `/`, `/home/alice`, `/tmp/sub` (catches StringLiteral mutators on the read path)
- `cd.test.ts`: successful chdir calls `env.setCwd` with the **resolved AbsPath** (not the raw arg); covers absolute, relative, `..`, no-arg→home for both user and root; each error case (not_found, not_directory, permission_denied) — each error returns exit 1 AND does NOT call `setCwd` (mutator-aware: ConditionalExpression flips on the result-check branch)
- `prompt.test.ts`: `commandEchoLine` includes cwd in its output; same prompt with different cwds renders different strings (catches StringLiteral/property-access mutators)
- `state.test.ts` (extended): cwd signal initializes from `SEED_HOME`; calling exposed setCwd updates the signal; `runInput`'s env reflects the current signal value
- `terminal.test.tsx`: integration — `cd /tmp` + `pwd` shows `/tmp`; `cd /nope` shows the error and `pwd` still reports the original cwd

**GREEN**:
- Extend `CommandEnv` with `setCwd(path: AbsPath): void`
- Refactor `buildCommandEnv` to accept `onCwdChange` (writer) + `cwd: () => AbsPath` (reader). Existing `cwd: AbsPath` constant-prop callers in tests are updated by way of the `mockCommandEnv` factory adding an optional `setCwd` mock
- Add `cwd` signal in `state.ts`; `runInput` reads it, threads writer through `buildCommandEnv`
- Implement `pwd.ts`, `cd.ts` in `core/commands/`
- Extend `commandEchoLine` signature to include cwd; update the one caller in `state.ts`
- Register `pwd`, `cd` in the `COMMANDS` Map

**MUTATE**: Stryker on `core/commands/cd.ts`, `core/commands/pwd.ts`, `core/shell/prompt.ts` (re-run for the latter — adding a field).

**KILL MUTANTS**: per report. Expected equivalent-by-design:
- Metadata fields on the new commands (name/description/manual/tier)
- Type-narrowing defensive code in cd's error switch (per `feedback_type_narrowing_defensive_equivalent`)

**REFACTOR**: Assess whether cd's three error-case formatter is worth lifting into a shared helper. Default: keep inlined (consistent with cat's PR #179 "1 consumer = inline" rule).

**Done when**: all ACs met, mutation report reviewed, lint + tsc + tests clean in `v2/`, human approves commit.

### Slice 2: `ls` (no flags)

**Value**: terminal user can see what's in a directory.
**Path**: input → parser → `ls` → `env.fs.list(absPath)` → format names → emit text lines.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria**:
- `ls` (no args) lists the cwd's non-hidden entries (names NOT starting with `.`), alphabetically sorted, one per line, exit 0
- `ls /tmp` lists `/tmp`'s entries (absolute path)
- `ls some/sub` resolves relative against cwd
- `ls /etc/passwd` (file target) → echoes `/etc/passwd` (matches real `ls`), exit 0
- `ls /nope` → `ls: cannot access '/nope': No such file or directory`, exit 2
- `ls /root` (perm denied) → `ls: cannot open directory '/root': Permission denied`, exit 2
- Empty directory → no output, exit 0
- (Multiple args deferred to Slice 3 follow-up if needed — out of scope unless trivially free in implementation)

**RED**:
- `ls.test.ts`:
  - Lists names sorted (catches ArrayDeclaration → empty, MethodExpression on `.sort()`)
  - Filters hidden entries by default — directory with `.hidden` and `visible` shows only `visible` (catches BooleanLiteral flip on `startsWith('.')`)
  - Single absolute, single relative path
  - File-target echoes the input path (catches the file-vs-dir branch)
  - not_found error → exit 2 + exact message (catches StringLiteral on the message)
  - perm_denied error → exit 2 + exact message
  - Empty directory → zero text lines + exit 0 (catches ArrayDeclaration filling the result)

**GREEN**:
- Add `FsListResult` discriminated union if not already on FsView: `{ ok: true; entries: readonly DirEntry[] } | { ok: false; error: 'not_found' | 'not_directory' | 'permission_denied' }`. `DirEntry = { name: string; kind: 'file' | 'directory' | ... }` — exact shape TBD against existing walker
- Add `env.fs.list(absPath)` if absent; otherwise consume existing
- Implement `core/commands/ls.ts` with no flags yet
- Register in COMMANDS

**MUTATE**: Stryker on `core/commands/ls.ts` (and on the new `FsView.list` if added, but only the ls-visible behavior matters for the report).

**KILL MUTANTS**: per report.

**REFACTOR**: If cat and ls both have `formatXxxError` shaped helpers, assess extracting a shared `formatFsError(command, target, error)` per the cat-Slice-1 docstring's re-extraction hint. Triggers the 2-consumers rule.

**Done when**: all ACs met, mutation clean, lint + tsc + tests clean, human approves commit.

### Slice 3: `ls -a`, `ls -l`, `ls -la` — stacking infrastructure's first real consumer

**Value**: power-user listing; **proves the per-command stacking infrastructure from PR #177 works end-to-end with a real command**.
**Path**: parser sees `-la`, tries literal first (no match), `tryExpandStack` splits to `-l -a` (since `ls.stacking = true` AND both single-char members are boolean in spec); ls reads both bools from flags Map; long-format branch formats perms/owner/size/name per entry.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria**:
- `ls -a` includes entries starting with `.` (including `.` and `..` per real ls)
- `ls -l` long format: each line is `<perms-string> <owner> <size> <name>` (exact spacing per real ls or v2-decided, but must be parseable + stable)
- `ls -la` (stacked) does both
- `ls -al` (stacked, alt order) also does both — semantic equivalence
- `ls -l -a` (separate) is equivalent
- Permission string maps tier-allowlist `FilePermissions` to a 10-char `drwxrwxrwx`-style string (legacy mapping: `r` if `read.includes('guest')`, `w` if `write.includes('guest')`, etc. — exact world/user/group mapping TBD against decisions.md)
- `cat -na` STILL rejected (`cat` does NOT opt into stacking) — regression test in `runLine.test.ts`
- `ls -x` → `ls: unrecognized option: -xyz`-style error per existing parser convention

**RED**:
- `ls.test.ts`:
  - `-a` includes dotfiles AND `.` / `..` (catches BooleanLiteral flip on the hidden filter)
  - `-l` format snapshot for one file: perms-string mapping exhaustively covered by a separate per-permission-combo test on a `formatPermsString` helper (catches StringLiteral on the rwx characters, ArithmeticOperator on index math)
  - `-l` size + owner come from `DirEntry` (catches property-access mutators)
  - `-la` does both
  - `-al` does both (semantic equivalence)
  - `-l -a` does both
- `runLine.test.ts`: cat-with-stacked-flags STILL rejected — `cat -na file` returns `cat: unrecognized option: -na` (regression guard for opt-in stacking)

**GREEN**:
- Add `flags: { '-a': 'boolean', '-l': 'boolean' }` + `stacking: true` to `ls`
- Pure `formatPermsString(perms: FilePermissions, kind: DirEntryKind): string` helper
- Long-format renderer: pure function over `DirEntry[]`
- Branch in `ls.execute` on `flags.get('-a')` and `flags.get('-l')`
- Hidden-filter: skip when `-a === true`

**MUTATE**: Stryker on `core/commands/ls.ts` (with new helper). Verify long-format helper has ArithmeticOperator + StringLiteral coverage on the padding/joiner.

**KILL MUTANTS**: per report. Expected equivalents:
- Metadata
- Type-narrowing defensive code on flags.get() reads (per `feedback_type_narrowing_defensive_equivalent`)

**REFACTOR**: Assess `formatPermsString` extraction to its own `lsLongFormat.ts` if it grows beyond ~15 LOC. Default: keep inlined unless extracted helper has independent tests.

**Done when**: all ACs met, mutation clean, lint + tsc + tests clean, human approves commit. **Plan complete** → delete `plans/v2-core-commands-nav.md`; if `plans/` empty, delete the directory.

## Pre-PR Quality Gate

Each slice's PR:
1. Mutation testing — Stryker on changed files; surviving mutants documented as equivalent-by-design or killed
2. Refactoring assessment — only refactor if it adds value (per `refactoring` skill)
3. From `v2/`: `npm run build` + `npm run lint` + `npm run test:run` all clean
4. Squash-merge per established convention (`gh pr merge --squash --delete-branch`)
5. Conventional Commit subject: `feat(v2): <slice summary>` with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer

## Out of scope (deferred)

- `grep` — content-based, pairs better with `tail`/`find` in a later chunk
- `cd -` (previous dir), `cd ~`, `cd ~user` — bash-isms requiring `$OLDPWD` and tilde expansion in the parser
- `ls -h`, `ls -R`, `ls --color`, sort flags — polish; not load-bearing for v2 launch
- `ls -l` numeric IDs, mtime column — v2 has no inode-number / mtime concept yet
- Multiple-arg `ls` with `<arg>:` headers — Slice 3 follow-up only if trivially free

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
