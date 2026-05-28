# Plan: v2 Shell Parser (Tokenize + Flag Bind)

**Branch (per slice)**: `feat/v2-shell-parser-slice-N` — one PR per slice, squash-merge.
**Status**: Active

## Goal

Replace the interim `input.match(/\S+/g)` splitter in `v2/src/core/shell/runLine.ts` with a real two-phase shell parser, and start populating the `flags: ReadonlyMap<string, string | true>` map that `Command.execute` already accepts (currently always `NO_FLAGS`).

- **Phase 1 — TOKENIZE** (`v2/src/core/shell/tokenize.ts`): command-agnostic. Whitespace splitting, single + double quotes, surfaces an unterminated-quote error. Pipes/redirects out of scope.
- **Phase 2 — BIND** (`v2/src/core/shell/bindFlags.ts`): command-aware. Given the tokens after the command name plus the command's `FlagSpec`, returns `{ positional, flags }` or a strict error. Supports `'boolean'` and `'string'` flag types, per-command opt-in short-flag stacking, and the POSIX `--` end-of-options sentinel.

Each command declares its own `FlagSpec`; `runCommandLine` consults it before calling `execute`, so every command receives pre-classified args. The hardcoded `COMMANDS = new Map([['cat', cat]])` in `v2/src/ui/state.ts` grows by one entry per command this plan adds — a real registry is a separate chunk.

## Decisions (locked — confirm any you want to revisit before Slice 1)

| Decision | Posture |
|---|---|
| Unknown flag | strict — `<cmd>: unrecognized option: -xyz`, exit 2 |
| `'string'` flag with no value | error — `<cmd>: option requires an argument: -o`, exit 2 |
| `'string'` flag's value is dash-prefixed (`-o -l`) | value is `-l` (POSIX-consume-next) |
| `--key=value` syntax | NOT supported (defer) |
| Long-form `--port` aliases | NOT supported (defer) |
| `--` end-of-options sentinel | supported (Slice 5) |
| Short-flag stacking (`ls -la`) | **per-command opt-in** via `Command.stacking: true`; literal-match wins over expansion; stacked members must all be `'boolean'`-typed |
| Flag value types | `'boolean' \| 'string'` only |
| Flag-name case | case-sensitive (`-l` ≠ `-L`); matches real CLIs |
| Unterminated quote | tokenizer error — `bash: syntax error: unexpected end of file`, exit 2 |
| Escape sequences inside quotes (`\"`, `\n`) | NOT supported (defer) |
| Variable interpolation (`$HOME`), command substitution | NOT supported (defer) |
| Error reporting | `Result<T, string>` from both `tokenize` and `bindFlags`; `runCommandLine` converts to error-kind `TerminalLine` |

## Acceptance Criteria (cumulative across slices)

Heavy lifting in unit tests on the pure modules. Browser smoke per slice for the one user-observable behaviour.

- [x] `cat -n /etc/passwd` outputs each line prefixed with `   <N>\t` (Slice 1) ✅ PR #174
- [x] `cat -xyz` renders one error line `cat: unrecognized option: -xyz`, exit 2; the file is NOT read (Slice 1) ✅ PR #174
- [ ] `head -n 5 /etc/passwd` outputs the first 5 lines (Slice 2)
- [ ] `head -n` (no value) errors `head: option requires an argument: -n`, exit 2 (Slice 2)
- [ ] `echo "hello world"` outputs `hello world` as one line, quotes stripped (Slice 3)
- [ ] `echo "unterminated` errors `bash: syntax error: unexpected end of file`, exit 2; echo is NOT invoked (Slice 3)
- [ ] `cat -nE /etc/passwd` numbers each line AND appends `$` (Slice 4)
- [ ] `cat -- -n` tries to read a file literally named `-n` and reports `cat: -n: No such file or directory` (Slice 5)
- [ ] Preserved across all slices: empty input → exit 0 no output; unknown command (`frobnicate`) → `bash: frobnicate: command not found`, exit 127

## Slices

Every slice follows RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR. Before writing code for any slice, load `tdd`, `testing`, `mutation-testing`, `refactoring`.

---

### Slice 1: walking skeleton — boolean flags + strict unknown errors ✅ SHIPPED (PR #174)

**Pivot recorded mid-slice**: the plan typed `tokenize` as `Result<{tokens}, error>` for Slice 3 forward-compat. Mutation testing surfaced 7 NoCoverage + 1 surviving mutant in the unreached error branch of `runLine.ts`. Pivoted to strict TDD — `tokenize` returns `readonly string[]` directly. Slice 3 absorbs the signature reshape (see its Files-touched note).


**Value**: Player gets `cat -n /etc/passwd` numbered output; typos fail loudly with exit 2 instead of being silently absorbed.

**Path**: terminal input → `tokenize` (whitespace only, error branch typed for Slice 3) → `commands.get(name)` → `bindFlags(args, command.flags ?? {})` → `cat.execute(env, positional, flags)` → numbered or plain output.

**Files touched**:
- NEW: `v2/src/core/shell/tokenize.ts` + `.test.ts` — `(input: string) => { ok: true; tokens: readonly string[] } | { ok: false; error: string }`. Slice 1 only needs `\S+` matching; the error branch is typed but unused.
- NEW: `v2/src/core/shell/bindFlags.ts` + `.test.ts` — `(args, spec, opts?) => Result<{ positional; flags }, string>`. `FlagSpec = Record<string, 'boolean' | 'string'>` exported here.
- MOD: `v2/src/core/commands/types.ts` — `import type { FlagSpec } from '../shell/bindFlags'`; extend `Command` with `flags?: FlagSpec` (`stacking?` arrives in Slice 4).
- MOD: `v2/src/core/commands/cat.ts` + `.test.ts` — declare `flags: { '-n': 'boolean' }`; when `flags.get('-n') === true`, prefix each output line with `String(i + 1).padStart(6) + '\t'` (matches GNU `cat -n` width).
- MOD: `v2/src/core/shell/runLine.ts` + `.test.ts` — replace `parseLine` with `tokenize` + `bindFlags`; on bind error return one error-kind line + exit 2; delete `NO_FLAGS`.

**Acceptance criteria for this slice** (confirm with human BEFORE coding):
- AC1: `cat -n /etc/passwd` lines are prefixed `<6-space-pad N><tab><line content>` matching `cat -n`
- AC2: `cat -xyz /etc/passwd` → one error line `cat: unrecognized option: -xyz`, exit 2; the file is NOT read (verify by reading a path that would normally produce its own error and confirming we get the parser's error, not cat's)
- AC3: `cat /etc/passwd` (no flag) unchanged from today
- AC4: `cat -n` (flag, no positional) preserves current "missing file operand" behaviour (`flags` populated, `positional` empty, cat falls through to its existing no-arg branch)
- AC5: empty / whitespace-only input → exit 0 no output (preserved)
- AC6: unknown command (`frobnicate`) → `bash: frobnicate: command not found`, exit 127 (preserved)

**RED** — write failing tests first; mutator-scan boundaries (load `mutation-testing` for `resources/mutator-rules.md`). Concrete coverage:
- `tokenize.test.ts`: empty → `{ ok:true, tokens:[] }`; whitespace-only → same; `'cat /etc/passwd'` → two tokens; leading/trailing whitespace trimmed; multiple internal spaces collapsed; tabs treated as whitespace
- `bindFlags.test.ts`: empty args + empty spec; positional-only; boolean flag before positional; boolean flag after positional; multiple positionals around a flag; unknown flag → `{ ok:false, error:'unrecognized option: -xyz' }`; empty spec rejects any dash-prefixed token; bare `-` (single dash) treated as positional (POSIX convention for stdin)
- `runLine.test.ts`: existing tests stay green; ADD unknown-flag returns error line + exit 2; ADD `cat -n file` calls cat.execute with `flags.get('-n') === true`
- `cat.test.ts`: existing tests stay green; ADD with `-n` set, lines numbered; ADD without `-n`, lines unchanged; ADD `-n` with no file still produces "missing file operand"

**GREEN** — minimum impl. tokenize is the existing `\S+` matcher wrapped in `{ ok: true, tokens }`. bindFlags is a linear walk: each token, if dash-prefixed → spec lookup → boolean type sets `flags.set(name, true)` else unknown error; else push to positional. cat reads `flags.get('-n')` and conditionally numbers.

**MUTATE** — scope Stryker to the four touched files. Likely danger zones: pad-length boundary in cat (`padStart(6)`), dash-prefix test in bindFlags (`token.startsWith('-')`), the unknown-flag error template, exit-code constants.

**KILL MUTANTS** — strengthen tests. Ask human if a survivor exposes an undecided rule (e.g., should leading whitespace be a tokenize error or silent strip? Currently: silent strip).

**REFACTOR** — assess after mutation clean. Suspect: tokenize wrapper might compress; resist extracting bindFlags helpers until Slices 2/4 add real branching.

**Done when**: All ACs pass, scoped mutation report clean, `cd v2 && npm run lint && npm run test:run && npm run build` green, human approves commit.

---

### Slice 2: string-valued flags — `head -n N`

**Value**: Commands can take options that carry values (the path for every real CLI argument shape). Player gets `head -n 5 file` to preview large files without paging.

**Path**: as Slice 1, plus `bindFlags` consumes the next token as the value of a `'string'`-typed flag; missing-value and invalid-value are strict errors.

**Files touched**:
- MOD: `v2/src/core/shell/bindFlags.ts` + `.test.ts` — handle `'string'` type; emit `option requires an argument` on missing value
- NEW: `v2/src/core/commands/head.ts` + `.test.ts` — `flags: { '-n': 'string' }`; default 10 lines; parse `flags.get('-n')` to int with strict validation
- MOD: `v2/src/ui/state.ts` — register `head` in `COMMANDS`

**Acceptance criteria** (confirm BEFORE coding):
- AC1: `head -n 5 /etc/passwd` outputs the first 5 lines
- AC2: `head /etc/passwd` outputs the first 10 lines (default)
- AC3: `head -n` (no value) → `head: option requires an argument: -n`, exit 2
- AC4: `head -n foo /etc/passwd` → `head: invalid number of lines: 'foo'`, exit 2 (negative + non-integer both fail)
- AC5: `head -n 0 /etc/passwd` → empty output, exit 0
- AC6: `head -n 999 /etc/passwd` (N > file lines) → entire file, exit 0
- AC7: `head` (no args) — confirm what current no-arg behaviour should be (likely usage error; for now match cat's "missing file operand" shape)
- AC8: `head -n` followed by another flag-like token — POSIX-consume-next: `head -n -1` is `head` with `-n=-1` → AC4 invalid-number error path

**RED** — extend `bindFlags.test.ts` with string-flag cases (next-token-as-value, dash-prefixed next token still consumed per AC8, missing-value at EOL, missing-value when next token is also a string-typed flag that needs ITS own value — POSIX rules say consume anyway). New `head.test.ts` covering AC1-AC8. `terminal.test.tsx` smoke for AC1.

**GREEN** — bindFlags grows one state: `expecting-value`. head parses with `Number.parseInt(value, 10)` + finite + non-negative guards.

**MUTATE / KILL** — danger zones: N=0 / N=1 / N=lines boundaries in head; the consume-next branch in bindFlags (mutant: consume → don't); validation gate ordering (mutant: `< 0` ↔ `<= 0`).

**REFACTOR** — likely candidates: tiny `parseLineCount` in head; apply only if it actually reduces nesting (per refactoring skill's no-extract-for-testability rule).

**Done when**: All ACs pass, mutation clean, gates pass, human approves.

---

### Slice 3: quoted tokens + `echo`

**Value**: Player can pass strings containing whitespace. Unblocks any future command taking free-form text (search patterns, messages, file paths with spaces).

**Path**: tokenize understands `"..."` and `'...'`, strips the outer quote pair, treats inner content as one token. Errors on unterminated quote.

**Files touched**:
- MOD: `v2/src/core/shell/tokenize.ts` + `.test.ts` — state machine (outside / inside-double / inside-single). **Reshape return type to `{ ok: true; tokens: readonly string[] } | { ok: false; error: string }`** — Slice 1's pivot left it as `readonly string[]`; this slice's unterminated-quote test demands the discriminator now.
- NEW: `v2/src/core/commands/echo.ts` + `.test.ts` — joins positional with `' '`, outputs one `text` line; no flags
- MOD: `v2/src/ui/state.ts` — register echo
- MOD: `v2/src/core/shell/runLine.ts` — add the `!tokenized.ok` branch to surface `bash: <error>` lines at exit 2 (this is the branch Slice 1 dropped pre-emptively).

**Acceptance criteria** (confirm BEFORE coding):
- AC1: `echo "hello world"` → one line `hello world`
- AC2: `echo 'hello world'` → same
- AC3: `echo a b c` → one line `a b c`
- AC4: `echo "a" "b"` → one line `a b` (two tokens joined with single space)
- AC5: `echo ""` → one empty line (empty-string token preserved)
- AC6: `echo` (no args) → one empty line (real `echo`'s default)
- AC7: `echo "unterminated` → `bash: syntax error: unexpected end of file`, exit 2; echo NOT invoked
- AC8: `cat "-n" /etc/passwd` ≡ `cat -n /etc/passwd` (quotes around a flag don't suppress it — real-bash semantics; tokenizer strips quotes, binder doesn't see them)
- AC9: `echo "hello\"world"` — escape sequences out of scope; the `\` is literal, so this is an unterminated-quote error. Document the limitation.

**RED** — `tokenize.test.ts` cases for AC1-AC9; mutator-scan the quote-state transitions especially (resources/mutator-rules.md → conditional-boundary mutants on `inQuote` flag); `echo.test.ts`; `runLine.test.ts` for AC7's error wiring; `terminal.test.tsx` smoke for AC1 + AC7.

**GREEN** — tokenizer becomes a small state machine. On EOF inside a quote, return error result.

**MUTATE / KILL** — focus areas: unterminated-quote detection (mutant: error → silent close), empty-quote-as-token (mutant: emit-empty → skip), single vs double quote handling (mutant: swap matchers).

**REFACTOR** — assess. The state machine may want named helpers; defer extraction unless it crosses ~30 lines.

**Done when**: ACs pass, mutation clean, gates pass, human approves.

---

### Slice 4: per-command stacking — `cat -nE` proof

**Value**: Players who type `cat -nE` get the union of `-n` and `-E`, matching muscle memory from real UNIX tools. Other commands (future `nmap -sV`) keep multi-char flags unambiguous because stacking is per-command opt-in.

**Path**: `bindFlags` receives `command.stacking ?? false`; when literal-lookup misses AND stacking is true, attempt to expand `-abc` → `-a`, `-b`, `-c`; succeeds only when every char is a single-letter `'boolean'`-typed flag in the spec.

**Files touched**:
- MOD: `v2/src/core/commands/types.ts` — add `Command.stacking?: boolean`
- MOD: `v2/src/core/shell/bindFlags.ts` + `.test.ts` — stacking fallback after literal miss
- MOD: `v2/src/core/commands/cat.ts` + `.test.ts` — add `-E: 'boolean'`, set `stacking: true`; when `flags.get('-E') === true`, suffix each output line with `$`

**Acceptance criteria** (confirm BEFORE coding):
- AC1: `cat -nE /etc/passwd` — numbered AND `$`-suffixed lines
- AC2: `cat -En /etc/passwd` — same result (order in stack doesn't matter)
- AC3: `cat -n -E /etc/passwd` (unstacked) — same result
- AC4: `cat -nX /etc/passwd` → `cat: unrecognized option: -nX`, exit 2 (stack expansion is all-or-nothing — partial match must fail or the error message is misleading)
- AC5: bindFlags unit: literal-first wins — hypothetical spec `{ '-nE': 'boolean', '-n': 'boolean', '-E': 'boolean' }` with `stacking: true` resolves `['-nE']` to literal `'-nE'`, not stacked
- AC6: bindFlags unit: with `stacking: false`, `['-nE']` against `{ '-n':'boolean', '-E':'boolean' }` → unknown-flag error (live cat sets stacking: true; this AC proves the opt-in)
- AC7: bindFlags unit: stack containing a `'string'`-typed flag → unknown-flag error (POSIX `tar -xzf` shape is out of scope for v2 launch). Spec `{ '-n':'boolean', '-F':'string' }`, args `['-nF']`, stacking: true → error
- AC8: case-sensitive: `cat -N` → unknown (`-N` not in spec, `-n` is); covered by bindFlags unit

**RED** — `bindFlags.test.ts` grows substantially; `cat.test.ts` covers `-E` alone, `-n -E`, `-nE`, `-En`; `terminal.test.tsx` smoke for AC1.

**GREEN** — extend bindFlags: on literal miss with stacking, slice `'-abc'` into `['-a', '-b', '-c']`, look up each, require all boolean; on any failure roll back and emit unknown-flag error using the ORIGINAL token (`-nX`, not `-X`).

**MUTATE / KILL** — danger: chunking loop (mutant: off-by-one in slice), all-or-nothing gate (mutant: any-success accept), type-check (mutant: `'boolean'` → `'string'`), the "roll back to original token in error" branch.

**REFACTOR** — assess. bindFlags now has positional + literal-boolean + literal-string + stacking + (Slice 5) sentinel modes. A small `tryExpandStack` helper may earn its keep. Apply only if it reduces nesting.

**Done when**: ACs pass, mutation clean, gates pass, human approves.

---

### Slice 5: `--` end-of-options sentinel

**Value**: Player can pass dash-prefixed positionals when filenames or other args contain leading dashes. Small but cheap to bake in cleanly before more commands depend on the binder.

**Path**: in `bindFlags`, on encountering `'--'` outside a value-expecting state, switch to "remaining-is-positional" mode; subsequent tokens go to `positional` verbatim, including any leading dashes.

**Files touched**:
- MOD: `v2/src/core/shell/bindFlags.ts` + `.test.ts` — sentinel branch

**Acceptance criteria** (confirm BEFORE coding):
- AC1: bindFlags `['--', '-n', 'file']` spec `{'-n': 'boolean'}` → `{ positional: ['-n', 'file'], flags: {} }`
- AC2: bindFlags `['-n', '--', '-n']` spec `{'-n': 'boolean'}` → `{ positional: ['-n'], flags: { '-n': true } }`
- AC3: bindFlags `['--', '--', 'foo']` → `{ positional: ['--', 'foo'], flags: {} }` (only the FIRST `--` is consumed; subsequent `--` are positional)
- AC4: bindFlags `['--']` → `{ positional: [], flags: {} }`
- AC5: bindFlags `['-o', '--']` spec `{'-o': 'string'}` → `'--'` is consumed as the VALUE of `-o`, not as the sentinel — POSIX-correct. Confirm with human.
- AC6: terminal smoke: `cat -- -n` → reads file literally named `-n`, gets `cat: -n: No such file or directory` (the seed FS has no such file; the error proves the sentinel worked because without it, the parser would error out before cat ever ran)

**RED** — `bindFlags.test.ts` per AC; `terminal.test.tsx` smoke for AC6.

**GREEN** — single branch in the binder loop, gated on "not currently expecting a value".

**MUTATE / KILL** — boundaries: "first vs all `--`", "inside vs outside value-expecting state".

**REFACTOR** — assess. Binder is now feature-complete for this plan; consider whether the state machine reads well or wants a small refactor.

**Done when**: ACs pass, mutation clean, gates pass, human approves.

---

## Pre-PR Quality Gate (per slice)

1. Scoped mutation testing on the touched core files (load `mutation-testing` for the recipe; the harness is set up per the v2 Stryker config)
2. `refactoring` assessment
3. `cd v2 && npm run lint && npm run test:run && npm run build` all green
4. Browser smoke at `localhost:5174` for the slice's user-observable AC (per `feedback_e2e_scope`, this stays manual — committed v2 Playwright E2E is a separate open question on `project_v2_rewrite.md`)

## Out of Scope (named explicitly so it doesn't sneak in)

- Pipes (`|`), redirects (`>`, `<`, `>>`), command substitution (`$(...)`, backticks)
- Environment variable interpolation (`$HOME`, `${VAR}`)
- Escape sequences inside quotes (`\"`, `\n`, `\\`)
- Long-form flags (`--port 80`) and `--key=value` syntax
- Stacked string-flags (`tar -xzf file.tar` shape)
- Globbing / wildcards (`*.txt`)
- Tab completion, input history (separate UI plan)
- A real command registry — `state.ts`'s hardcoded `Map` grows by one entry per command this plan adds; registry pattern is a separate chunk
- Numeric flag types — every value is a `string`; commands parse internally (AC4 in Slice 2 is the proving ground)

## When the plan is complete

- All five slices merged to `main`
- Bump `package.json` + `package-lock.json` minor version per [bump-on-feature memory](MEMORY.md)
- Update `MEMORY.md` line 49 (active theme) to reflect the shipped parser + new commands (head, echo)
- Update `project_v2_rewrite.md`:
  - "Current state" — list shipped tokenizer + binder + new commands
  - Remove the "interim `input.match(/\S+/g)` splitter" line from "What's NOT in v2 yet"
  - Add `head`, `echo` to the shipped commands list
- Delete this plan file. If `plans/` is then empty, delete the directory.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
