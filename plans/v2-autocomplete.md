# Plan: v2 Tab auto-completion

**Branch**: feat/v2-autocomplete
**Status**: Active

## Why this plan exists

Legacy has Tab completion (`src/shell/complete.ts` + `complete.test.ts`, wired in
`Terminal.tsx`): press Tab and the shell completes the command, path, or flag at
the cursor, listing candidates when ambiguous. v2 has none — the input only
handles Enter / ArrowUp / ArrowDown. This ports it. (The richer manual shipped in
v0.14.0 was its documented prerequisite.)

## What legacy gives us (and how faithful the port is)

`src/shell/complete.ts` is already **pure and framework-agnostic** with a clean
`CompleteAdapter` seam — no React, no DOM. It ports to `core/shell/complete.ts`
almost verbatim:

- `classifyCursor(input, cursorPos)` — character-scan (quote-aware, pipe/redirect
  aware) that classifies the cursor as `command` / `path` / `flag` and extracts
  the token + bounds. **Verbatim** (does not use the v2 tokenizer; it needs
  cursor-position, mid-token, possibly-unterminated-quote analysis the tokenizer
  doesn't do).
- `complete(input, cursorPos, adapter)` — dispatches to `completeCommand` /
  `completePath` / `completeFlag`, returns a `CompletionOutcome`
  (`{ kind, matches, commonPrefix, replacement, newCursorPosition, displayText,
  addTrailingSpace }`).
- Longest-common-prefix advance; single-match adds a trailing space; directory
  entries decorated with `/`; quoted-token replacement preserves the quote char.

## Key differences (legacy → v2)

1. **Flag source = `command.flags`, NOT `manual.arguments`.** v2's authoritative
   flag set is the `FlagSpec` that `bindFlags`/`runLine` consume
   (`command.flags ?? {}`). `completeFlag` lists `Object.keys(command.flags ?? {})`
   filtered by the typed prefix. (Legacy read flag entries out of
   `manual.arguments`; v2 has a real flag spec, so use it.)
2. **No keyword-at-arg0 / `values`** (user decision, deferred again). Drop
   `completeKeyword`, `keywordsForArg0`, `positionalArgIndex`. No v2 command has a
   fixed-value first positional (no apt/git-style subcommands), so the feature has
   zero consumers; it lands with the first such command, together with the
   `CommandArgument.values` field.
3. **No nc/ftp/redis/mysql modes yet.** Legacy built mode-specific adapters; v2
   has only the default shell. One adapter, over the current session's FS.
4. **`CompleteAdapter` stays string-typed** (like legacy: `resolvePath(path:
   string) => string`, `listPath(abs: string) => readonly string[] | null`,
   `isDirectory(abs: string) => boolean`). `AbsPath` branding happens INSIDE the
   adapter impl in `ui/state.ts` (via `core/filesystem/path` + `fsView`), keeping
   the pure module a near-verbatim port and the brand enforced at the boundary.
5. **UI is Solid + jsdom, not React.** The input has no element ref today; the Tab
   handler needs one to read `selectionStart` and reposition the caret to
   `newCursorPosition` after replacing the line.

## Locked decisions (2026-05-30)

1. **Defer keyword-at-arg0 + `values`** (user). Port command + path + flag only.
2. **Single PR** (user) — pure core port (with its ported unit suite) + UI Tab
   wiring + a jsdom integration test, all together. Two TDD increments inside it.
3. **Flag completion sources from `command.flags`** (only authoritative set in v2).
4. **Single-Tab UX, faithful to legacy** — each Tab advances to the longest common
   prefix AND, when >1 match, lists candidates as one scrollback line. No
   bash-style double-Tab state.
5. **Multi-match display = one `text` scrollback line** of `displayText` (commands
   /flags: `matches.join(', ')`; paths: decorated entries joined by two spaces).
   No prompt re-echo (legacy parity).
6. **Caret repositioning lives in the UI** (`terminal.tsx`), not `core/` and not
   `state.ts` (no DOM in either). `state.ts` exposes `tabComplete(cursorPos):
   number | null` returning the new caret index (or `null` = no change); the UI
   sets the selection on the input ref.
7. **No Playwright.** v2 has no E2E harness; the Tab seam is integration-tested in
   `terminal.test.tsx` (jsdom + `@solidjs/testing-library` `fireEvent.keyDown`),
   matching the existing ArrowUp tests. Introducing Playwright is out of scope.

## Architecture

- `core/shell/complete.ts` (NEW) — pure port. Exports `complete`, `classifyCursor`,
  and types `CompletionKind`, `CompletionOutcome`, `CursorContext`,
  `CompleteAdapter`. `completeFlag` reads `command.flags`.
- `ui/state.ts` (MODIFY) — `buildCompleteAdapter()` materializes the current FS
  (`createFsView(applyPatches(seedFs(), patches()), { userType, cwd })`) and closes
  over `commandRegistry` + `cwd`, adapting `fsView.list`→`string[]|null`,
  `fsView.stat`→`isDirectory`, and `resolveAbsPath(cwd(), p)`→`resolvePath`.
  `tabComplete(cursorPos)` runs `complete(input(), cursorPos, adapter)`, applies
  `setInput(replacement)` when it changed, pushes the candidates line when
  `matches.length > 1`, and returns `newCursorPosition` (or `null`).
- `ui/screens/terminal.tsx` (MODIFY) — add an input element ref; in `onKeyDown`
  handle `Tab` (`preventDefault`, read `selectionStart`, call `tabComplete`, then
  reposition the caret on the ref to the returned index).

## Acceptance Criteria

- [x] Tab on a unique command prefix completes it and appends a space
      (`hel`+Tab → `help `); the caret sits after the inserted text.
- [x] Tab with multiple matches advances to the longest common prefix and lists
      the candidates on one scrollback line (`c`+Tab → `cat, cd`); a unique match
      does NOT also dump a candidate list.
- [x] Tab on a path argument completes against the current session FS: a unique
      entry completes fully; a directory entry gets a trailing `/` and no space
      (`cd /et`→`cd /etc/`); multiple entries advance to the common prefix and
      list decorated candidates (without auto-picking the first).
- [x] Tab on a flag prefix completes against `command.flags` (`ls -`+Tab lists
      `-a, -l`; `cat -`+Tab → `-n `), including in a piped stage.
- [x] Tab in command position after a pipe completes a command, not a path
      (`cat /x | cl`+Tab → `clear`).
- [x] Tab with no matches is a no-op (input unchanged, no scrollback line).
- [x] Completion reflects the patched FS / session tier — `buildCompleteAdapter`
      materializes `applyPatches(seedFs(), patches())` with the session tier,
      exactly as `runInput` does. (mkdir→complete through the UI not unit-tested:
      the write path needs the server, unmocked in jsdom — covered structurally.)
- [x] `core/shell/complete.test.ts` covers classifyCursor (incl. quote-state
      transitions) + command/path/flag completion (ported from legacy, keyword
      tests dropped); the Tab seam is covered in `terminal.test.tsx`.
- [x] `test:run` (550), `build`, `lint` green; v2 version bumped 0.14.0 → 0.15.0
      (`package.json` + `package-lock.json`).

## Slices

Single PR, RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. Two TDD increments inside it;
they ship together because the completer delivers no observable value until the
Tab key is wired, and the UI can't be exercised without the core.

### Slice 1: Tab completes the command / path / flag at the cursor

**Value**: A player presses Tab and the shell finishes the command, path, or flag
they're typing — or lists the options when it's ambiguous — instead of nothing.
**Actor / Trigger / Outcome**: Player → Tab in the terminal input → the input
advances to the completion (caret after it); on ambiguity, candidates print on a
scrollback line.
**Path**: `terminal.tsx` Tab keydown (reads `selectionStart`) → `state.tabComplete`
→ `buildCompleteAdapter` (registry + materialized `fsView` + `cwd`) →
`core/shell/complete` → `setInput` + candidates line → caret repositioned on the
input ref. Skipped/explicit: keyword-at-arg0 (deferred); nc/ftp/etc. modes (don't
exist yet).
**Required implementation skills**: Before code, load `tdd`, `testing`,
`mutation-testing`, `refactoring` (and a Solid/UI pass for the `terminal.tsx` ref +
caret work).
**Acceptance criteria**: all criteria above. **Present + confirm before coding.**

**RED (increment A — pure core)**: Port `complete.test.ts` into
`core/shell/complete.test.ts`, adapted to v2 — `classifyCursor` cases (command /
path / redirect / flag / quoted / boundaries) verbatim; command + path completion
verbatim; flag completion rebuilt around a `flags` FlagSpec fixture instead of
`manual.arguments`; keyword tests dropped. Fails (no `complete.ts`).
**GREEN (A)**: Port `complete.ts`; `completeFlag` reads `command.flags`.

**RED (increment B — UI seam)**: `terminal.test.tsx` — (a) `hel`+Tab → input
`help ` (or the right single match for the live registry); (b) ambiguous prefix
advances + lists candidates in scrollback; (c) path Tab completes a seed-FS entry;
(d) `ls -`+Tab lists flags; (e) no-match Tab is a no-op. Use `fireEvent.input` then
`fireEvent.keyDown({ key: 'Tab' })`, assert `inputField()` value + `findByText` for
the candidates line. Fails (no Tab handling).
**GREEN (B)**: Add the input ref + Tab branch in `terminal.tsx`; `tabComplete` +
`buildCompleteAdapter` in `state.ts`; caret reposition on the ref.

**MUTATE**: `mutation-testing` on `complete.ts` (primary) + the `tabComplete`
logic. Target: prefix-filter boundaries, longest-common-prefix loop, the
single-match-vs-multi branch (`addTrailingSpace`, trailing space/slash), the
classify boundaries (`|`/`>`/quote), the `replacement !== input` and
`matches.length > 1` UI guards, and `newCursorPosition` arithmetic.
**KILL MUTANTS**: Add boundary/branch assertions; ask the human on ambiguous
survivors; accept type-narrowing / static-data equivalents per the project rules.
**REFACTOR**: Assess only if it adds value (the port is already factored; resist
restructuring a faithful copy).
**Done when**: all criteria met, mutation report reviewed, version bumped
0.14.0 → 0.15.0, human approves commit.

## Deferred / follow-ups

- **Keyword-at-arg0 completion + `CommandArgument.values`** — lands with the first
  subcommand-style command (e.g. `apt`).
- **Mode-specific adapters** (nc/ftp/redis/mysql) — when those modes exist, add
  per-mode adapters like legacy (`listDirectoryFromMachine`, remote cwd).
- **Double-Tab list-only UX / descriptions in candidate lists** — not in legacy;
  only if desired later.

## Pre-PR Quality Gate

1. Mutation testing on `complete.ts` (+ touched UI logic).
2. Refactoring assessment.
3. `npm run build`, `lint`, `test:run` green (v2 has no Prettier — ESLint is the
   format gate).
4. Version bump in `package.json` + `package-lock.json`.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
