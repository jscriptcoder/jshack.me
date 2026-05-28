# Plan: v2 grep

**Branch**: per-slice child branches (`feat/v2-grep-slice-N`), squash-merged
**Status**: Active

## Goal

Port legacy `grep` to v2, preserving its CLI interface exactly: `grep <pattern> <path> [-l]` (or piped `grep <pattern>`). Case-insensitive regex matching, automatic directory recursion, binary-file skipping, silent permission-skip during recursion, `-l` for files-with-matches.

Authoritative source: `src/commands/grep.ts` + `src/commands/grep.test.ts` in legacy. See [[feedback-v2-match-legacy-command-interface]] — this plan is the rule's first explicit application.

## Acceptance Criteria

- [ ] `grep PATTERN FILE` emits matching lines verbatim; exit 0 if any match, 1 if none
- [ ] **Pattern is case-insensitive regex** (`new RegExp(pattern, 'i')`) — `.` matches any-char, `^`/`$` anchor, etc.
- [ ] `grep PATTERN DIR` recursively walks the directory tree, emitting `<filepath>:<line>` per match, sorted alphabetically by filepath; exit 0 if any match, 1 if none
- [ ] `grep PATTERN` (piped) reads stdin and emits matching lines; exit 0 if any match, 1 if none
- [ ] `-l` switches to files-with-matches mode (deduped filenames, no `<filepath>:` prefix); exit codes same as default mode
- [ ] **Binary files skipped** (content starting with `\x7fELF`) — silent skip in both single-file and recursive modes
- [ ] **Permissions during recursion**: root bypasses; non-root needs `perms.read.includes(userType)`; unreadable/untraversable files+dirs **silently skipped** (no error, no exit-code change)
- [ ] **Single-file mode**: ALSO honors `fs.read`'s `permission_denied` (v2's `fs.read` enforces perms — slight divergence from legacy where single-file mode bypassed checks; v2 is stricter here, matches `cat`/`ls` consistency)
- [ ] `grep` (no args) or `grep PATTERN` with no stdin and no file → `grep: usage: grep <pattern> <path> [-l]`, exit 2
- [ ] `grep PATTERN /nope` → `grep: '/nope': No such file or directory` (single quotes), exit 2
- [ ] Path resolution uses `resolveAbsPath(cwd, arg)` — `.`, relative, absolute all work
- [ ] Filename in `<filepath>:<line>` output uses the **resolved absolute path** during recursion (matches legacy; differs from cd/ls error-msg convention because recursion needs the full traversal path to be useful)
- [ ] All behavior covered by mutation-tested unit tests + 1 integration assertion in `terminal.test.tsx`

## Architectural notes

- **Pattern → RegExp**: `new RegExp(rawPattern, 'i')`. Invalid regex (e.g. `grep "[" file`) — legacy throws; v2 emits error line + exit 2. This was an undocumented legacy edge; v2 handles it explicitly.
- **Stdin**: `env.stdin` is `AsyncIterable<string>` (legacy was just `string`). Concatenate or iterate; same line-by-line filter.
- **Recursion**: implement as a generator-or-flatMap walker using `env.fs.list` + `env.fs.stat`. Silently skip when list returns `permission_denied`; binary check via stat-then-read.
- **Output ordering**: matches within a single file preserve file-internal order; across files in recursion, sort by filepath alphabetically (legacy: `Object.values(children).sort((a,b) => a.name.localeCompare(b.name))` at each level → effectively alphabetical-by-path traversal).
- **`-l` mode**: dedup by filepath (a file with N matches contributes one filename). Same exit-code semantics as default (0 if any match, 1 if none).

## Slices

Every slice follows RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR. No production code without a failing test. Before code changes begin in any slice, load `tdd`, `testing`, `mutation-testing`, and `refactoring`.

### Slice 1: single-file grep (case-insensitive regex) + errors

**Value**: hacker player can search a single file with regex — walking skeleton of grep.
**Path**: input → tokenize → bindFlags (empty spec) → `runCommandLine` → `grep.execute`. Validate args, parse pattern as regex, resolve path, `fs.read` content, skip if binary, split into lines, filter by regex, emit text lines.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria**:
- `grep` (no args) → `grep: usage: grep <pattern> <path> [-l]`, exit 2
- `grep root /etc/passwd` (matches) → emits matching lines verbatim, exit 0
- `grep zzzzz /etc/passwd` (no matches) → no output, exit 1
- **Case-insensitive**: `grep password /config` matches `Password=`, `password=`, `PASSWORD=` all in one pass
- **Regex syntax**: `grep "1.2.3.4" file` — `.` is any-char (regex), so `1X2X3X4` would ALSO match (catches "we used `.includes` instead of RegExp" mutant); use a test that distinguishes regex vs literal
- `grep "[abc]" file` (regex char class) — matches lines containing a, b, or c
- `grep "" file` (empty pattern) — `new RegExp('', 'i')` matches every line position → emits every line, exit 0
- `grep PATTERN` (only pattern, no file, no stdin) → `grep: usage: ...`, exit 2 (slice 3 will replace with stdin path when stdin is set)
- `grep PATTERN /nope` (missing) → `grep: '/nope': No such file or directory` (single quotes), exit 2
- `grep PATTERN /root/secret` (perm-denied for user) → `grep: '/root/secret': Permission denied` (v2 enforces; legacy didn't on single-file mode), exit 2
- `grep PATTERN /etc` (directory, no recursion yet in slice 1) → defer; emit `grep: '/etc': Is a directory`, exit 2 (slice 2 replaces with recursion)
- Binary file: `grep foo /bin/ls` (content starts `\x7fELF`) → no output, exit 1 (silent skip, no match)
- Invalid regex: `grep "[" /etc/passwd` → `grep: invalid regex: '['`, exit 2 (v2-explicit; legacy threw)

**RED**:
- `grep.test.ts`: each criterion above as a behavior test
- Mutator-aware:
  - ConditionalExpression on the exit-code branch (0 vs 1 vs 2)
  - StringLiteral on each error message
  - Regex vs literal distinction: a separate test with a `.` that should match more than just the literal `.`
  - Binary skip: assert no output AND exit 1 (not 0) — distinguishes "matches found" from "skipped"
- `terminal.test.tsx`: 1 integration — `grep alice /etc/passwd` from seed shows the alice line

**GREEN**:
- `core/commands/grep.ts` with `execute(env, args, flags)`
- Helpers (inline): `splitLines`, `formatReadError`, `isBinary(content)`, `compilePattern(raw)` (returns `RegExp | null` for invalid)
- `formatReadError` shape divergent from cat (single-quoted path, no `cat:` prefix) — keep local; do NOT extract `fsReadHelpers` yet (different error shape; not the same knowledge)
- Register `grep` in `COMMANDS` Map

**MUTATE**: Stryker on `core/commands/grep.ts`.

**KILL MUTANTS**: per report.

**REFACTOR**: Assess pattern-compilation extraction. If `isBinary` is a one-liner inlined, keep.

**Done when**: all ACs met, mutation report reviewed, lint + tsc + tests clean, human approves commit.

### Slice 2: directory recursion + binary-skip + silent perm-skip in walk

**Value**: `grep PATTERN /` becomes a real search tool — walks the entire tree.
**Path**: detect directory target via `fs.list` returning `ok` (vs error `not_a_directory`). Recurse using `list` + `stat`; for each file: skip if binary, skip if unreadable (root bypass), else filter lines + emit `<filepath>:<line>`. Sort by filepath alphabetically.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria**:
- `grep PATTERN DIR` recurses; emits `<filepath>:<line>` per match
- Sort by filepath alphabetically (`/etc/...` before `/home/...`)
- `grep PATTERN /` over a tree with matches in multiple files → all matches present, sorted
- Non-matching files contribute zero lines
- Binary files (ELF prefix) silently skipped during recursion
- Unreadable file (perms): silently skipped, NO error line, exit code reflects only matches found
- Untraversable directory (read-denied): contents silently skipped; siblings still searched
- Root user bypasses perm checks during recursion
- `grep PATTERN .` (current dir) resolves via `resolveAbsPath(cwd, '.')` and recurses
- `grep PATTERN /etc/passwd` (file target) — Slice 1's single-file behavior preserved (regression)
- Empty directory or directory with only non-matching files → no output, exit 1

**RED**:
- `grep.test.ts`: each criterion. Mutator-aware:
  - Sort order: insert files in non-alphabetical order, assert alpha output (catches `.sort()` drop)
  - Filepath prefix: assert exact `<filepath>:<line>` separator (catches StringLiteral on `:`)
  - root bypass: parametrize with root vs user, assert root sees a root-only file's matches; user does not
  - Untraversable: assert siblings present + denied subtree absent
  - Recursive vs single-file: split a fixture across nested dirs, assert recursion finds all

**GREEN**:
- Add a recursive walk helper (likely `walkAndSearch(env, absPath): readonly Match[]`)
- Dispatch in execute: `fs.list(target)` `ok` → recurse; `not_a_directory` → single-file path (slice 1); other errors → error line
- `Match = { filepath: AbsPath; line: string }`
- Binary check uses content read via fs.read (returns permission_denied for unreadable → skip silently)

**MUTATE**: Stryker. Expected real survivors: zero if tests cover sort + binary + perm skip explicitly.

**KILL MUTANTS**: per report.

**REFACTOR**: Assess walk helper extraction. Probably worth keeping inline if it's ~15 LOC. Promote to its own file only if it grows.

**Done when**: all ACs met, mutation clean, lint + tsc + tests clean, human approves commit.

### Slice 3: stdin support + `-l` (files-with-matches)

**Value**: pipes work (`cat /var/log/syslog | grep error`); `-l` is the second-most-common grep idiom.
**Path**: when args.length === 1 AND env.stdin is set, iterate stdin and emit matching lines (no filepath prefix). `-l` flag switches output projection: collect filepaths with ≥1 match, dedup, emit one per line.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria**:
- **Stdin path**:
  - `grep PATTERN` with `env.stdin` set: emits matching lines from stdin, no filepath prefix, exit 0/1
  - Stdin tests use `async function*` generators
  - `grep PATTERN file` IGNORES stdin (file mode wins — matches legacy `fnShell` behavior)
  - `grep PATTERN` with empty stdin generator → no output, exit 1
- **`-l` flag**:
  - `grep -l PATTERN file` (single file with match) → emits `<filepath>` only, exit 0
  - `grep -l PATTERN file` (no match) → no output, exit 1
  - `grep -l PATTERN dir` (recursive) → emits ONE filepath per matched file (deduped), sorted, exit 0
  - `grep -l PATTERN dir` (no matches anywhere) → no output, exit 1
  - `-l` does NOT include `:line` content
  - `-l` flag arg can appear before or after the path (legacy parsed `flags.some(f => f.includes('l'))` from args[2+]; v2 uses bindFlags which already handles positional/flag interleaving)
- Stdin + `-l` (legacy quirk): legacy didn't implement stdin+`-l`; v2 — DECISION: emit `(standard input)` if any match, nothing if not, matches real GNU grep. Document in plan since this is a v2-defined behavior.

**RED**:
- `grep.test.ts`:
  - Stdin tests (async iterable generator)
  - `-l` per criterion
  - Stdin+`-l` documented behavior
  - Regression: slice-1 + slice-2 behaviors unchanged

**GREEN**:
- Add `flags: { '-l': 'boolean' }` to grep Command
- Dispatch: if `args.length === 1 && env.stdin`, stdin path; else file/dir path
- Output projection: matches → either lines mode (`<filepath>:<line>` or just `<line>` if single source) or filepaths mode (deduped, sorted)

**MUTATE**: Stryker. Expected metadata + possibly the stdin defensive check.

**KILL MUTANTS**: per report.

**REFACTOR**: Assess split of `execute` into smaller mode-handlers if it sprawls.

**Done when**: all ACs met, mutation clean, lint + tsc + tests clean, human approves commit. **Plan complete** → delete `plans/v2-grep.md`; if `plans/` empty, delete the dir.

## Pre-PR Quality Gate

Each slice's PR:
1. Mutation testing — Stryker on changed files; surviving mutants documented as equivalent or killed
2. Refactoring assessment — only refactor if it adds value
3. `npm run build` + `npm run lint` + `npm run test:run` from `v2/` all clean
4. Squash-merge per established convention

## Out of scope (deferred, matching legacy)

- `-i` flag: case-insensitive is the default; no flag needed
- `-n`, `-v`, `-c`, `-w`, `-x`, `-r`, `-A`/`-B`/`-C`: legacy doesn't have them; deferred
- Multi-file args: legacy uses single path; multi-file deferred (would need to coexist with the dir-recursion path-arg semantics)
- Color output, `--color`

## v2-specific divergences (called out explicitly)

| Item | Legacy | v2 | Why |
|---|---|---|---|
| Single-file perm check | Bypassed | Enforced via `fs.read` | Consistency with `cat`/`ls`; the legacy bypass is a quirk, not a feature |
| Invalid regex | Throws Error | Error line + exit 2 | v2's command boundary handles errors explicitly |
| Errors | `throw new Error(...)` | TerminalLine + exit code | v2's command-result discriminated union |
| Stdin shape | `string` | `AsyncIterable<string>` | v2 architecture |
| Stdin + `-l` | Unimplemented | `(standard input)` per real grep | Fills an undefined legacy edge |

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
