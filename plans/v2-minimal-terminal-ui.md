# Plan: v2 Minimal Solid Terminal UI

**Branch**: feat/v2-minimal-terminal-ui
**Status**: Active (Draft — awaiting approval)

## Goal

A player types a command in a Solid-rendered terminal, presses Enter, and sees its output — running the existing `cat` command end-to-end through a real `CommandEnv` (core → `buildCommandEnv()` → Solid signals → DOM). This is the first framework-aware slice; it proves the one UI seam the whole architecture is designed around.

## Why this chunk matters

`core/` is already proven in isolation (the `cat` spike + mutation-tested filesystem/walker/path). What is **unproven** is the seam: `buildCommandEnv()` constructing a real env from UI state, a command running against it, and `TerminalLine`s flowing back into a Solid store and onto the DOM. Every React bug class in MEMORY.md (closure-capture, flushSync mid-flow, async cascades) lived in exactly this seam. Building it minimally now de-risks the riskiest part of the rewrite.

## Resolved scope decisions (the two forks)

**Fork 1 — where does `cat`'s filesystem data come from (no adapter/Supabase yet)?**
Seed a small in-memory `Directory` (a starter workstation FS: `/etc/passwd`, `/home/<user>/notes.txt`) in a `ui/` bootstrap module. Build the production `FsView` by **promoting the pure walker-backed builder** out of `test/factories/filesystem.ts` (`mockFsViewFromTree`) into `core/filesystem/fsView.ts` as `createFsView(tree, { userType, cwd })`, so test and prod share one implementation — no drift, walker stays single-source. The test factory then re-uses it. IndexedDB / Supabase / patches / `generation/` are explicitly deferred; the seed tree is a throwaway literal the generation+adapter chunk will replace.

**Fork 2 — command registry vs hardcode `cat`?**
Hardcode a tiny module-level lookup (`const commands = { cat }`) passed into the pure runner. Do **not** build the formal `core/commands/registry.ts` + `CommandRegistry` type yet — YAGNI with one command. The pure runner takes the lookup as a parameter, so swapping a literal for a typed registry later is a one-line change. The registry arrives in the "more core commands" chunk when there are ≥2 commands to register.

**Interim line parsing.** `input.trim().split(/\s+/)` → `[name, ...args]`. No quotes, pipes, redirects, or flags. This is an explicit placeholder for the future `core/shell/tokenizer.ts` + `parser.ts` chunk; flags are passed as an empty `ReadonlyMap`. Documented as interim in the runner.

## Architecture (respects core-contracts.md + decisions.md)

```
core/filesystem/fsView.ts     createFsView(tree, {userType, cwd}) — pure, walker-backed   [NEW, TDD]
core/shell/runLine.ts         parseLine(input) + runCommandLine(env, input, lookup)        [NEW, TDD]
                              (interim naive parser; pure; returns CommandResult)
ui/state.ts                   module-level signals: scrollback store, input signal,        [NEW]
                              session signal; runInput() thin wrapper over runCommandLine
ui/env.ts                     buildCommandEnv() — wires fs+session+time+output for real;    [NEW]
                              patches/remote/log/network are loud "not wired yet" stubs
ui/seed.ts                    seed Directory + seed Session (throwaway, replaced later)     [NEW]
ui/screens/terminal.tsx       dumb renderers: Terminal / TerminalInput / TerminalOutput    [NEW]
main.tsx                      render <Terminal/> instead of <Hello/>                        [EDIT]
```

Invariants honored: no reactive primitives in `core/` (runner + fsView are pure); `CommandEnv` is the only seam; walker stays the single source of truth (createFsView calls `canRead`); time is injected (`env.now()` / `env.gameTime()`); components are dumb renderers, logic lives in the pure runner (D2); all commands async (D3).

## Acceptance Criteria (chunk-level)

- [ ] `npm run dev` (from `v2/`) serves a terminal; typing `cat /etc/passwd` + Enter renders the seeded passwd contents in the scrollback.
- [ ] `cat /nope` renders a red error line `cat: /nope: No such file or directory`; `cat` alone renders the missing-operand hint.
- [ ] An unknown command (`foo`) renders `bash: foo: command not found` (error-styled).
- [ ] The prompt shows `user@host>` derived from the seeded session, not hardcoded in the renderer.
- [ ] Successive commands accumulate in the scrollback (output history); each is echoed under its prompt; the view auto-scrolls to the newest line.
- [ ] `core/filesystem/fsView.ts` and `core/shell/runLine.ts` are pure (zero framework imports), unit-tested, and pass Stryker mutation testing (per PR #170 setup).
- [ ] Existing `cat` / walker / path tests stay green after the `mockFsViewFromTree` → `createFsView` promotion.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test. Per D10: `core/` gets TDD + mutation testing; UI declarative rendering does **not** get unit tests — it is smoke-tested through the browser (Vitest Browser Mode for the one end-to-end behavior, plus a mandatory manual `npm run dev` smoke before "done", per memory `feedback_e2e_test_new_primitives`).

### Slice 1: Terminal runs `cat` end-to-end in the browser

**Value**: A player can type `cat <file>` in the live Solid terminal and see the file's contents — the first observable proof that core → CommandEnv → DOM works.
**Path**: `TerminalInput` (input signal) → Enter → `runInput()` → `runCommandLine(env, line, { cat })` (pure) → naive `parseLine` → `cat.execute(env)` against `createFsView(seedTree)` → `CommandResult.kind === 'sync'` lines → appended to scrollback store → `TerminalOutput` renders each line via `<For>`, dispatching on `line.kind` (text / error / dim / prompt) to a CSS class. Prompt shows `user@host>`.
**Intentionally skipped states (later slices / chunks)**: command echo + multi-command accumulation + autoscroll (Slice 2); empty/whitespace input (Slice 2); input-recall history, tab-complete, Ctrl-C, async/streaming results, `mode_change` overlays, persistence, themes, boot/intro screens (out of chunk).
**Required implementation skills**: Before code, load `tdd`, `testing`, `mutation-testing`, `refactoring`, and `front-end-testing` (Vitest Browser Mode).
**Acceptance criteria** (confirm before coding):
- `runCommandLine(env, 'cat /etc/passwd', { cat })` returns a `sync` result whose lines are the passwd contents (exit 0).
- `runCommandLine(env, 'cat /nope', { cat })` returns an `error` line + exit 1.
- `runCommandLine(env, 'foo', { cat })` returns a single `error` line `bash: foo: command not found` + non-zero exit.
- `runCommandLine(env, '', { cat })` / whitespace-only returns no lines and runs nothing.
- `createFsView(seedTree, { userType, cwd })` reads a readable file, denies an unreadable one (walker-enforced), and reports `not_found` / `is_directory` correctly.
- Browser smoke: typing `cat /etc/passwd` + Enter shows the passwd lines; `foo` shows command-not-found.
**RED**: Unit tests for `parseLine` (split, trim, empty → null/empty), `runCommandLine` (dispatch hit, dispatch miss → not-found line, empty → no-op, error-line passthrough from `cat`), and `createFsView` (read ok / permission_denied / not_found / is_directory). Mutator-aware: cover the empty-args boundary, the `ok` discriminant on `FsReadResult`, the not-found string equality, and exit-code 0-vs-1 (StringLiteral, ConditionalExpression, EqualityOperator mutants per `mutator-rules.md`).
**GREEN**: Promote `mockFsViewFromTree` → `core/filesystem/fsView.ts` `createFsView`; have the test factory import it. Implement `parseLine` + `runCommandLine`. Wire `ui/state.ts` signals, `ui/env.ts` `buildCommandEnv` (real fs+session+time+output sink → scrollback; loud-throw stubs for patches/remote/log/network), `ui/seed.ts`, dumb `terminal.tsx`, swap `main.tsx`.
**MUTATE**: Run Stryker on `core/` (config from PR #170) for `fsView.ts` + `runLine.ts`.
**KILL MUTANTS**: Strengthen tests for survivors; ask when value is ambiguous.
**REFACTOR**: Assess (e.g., shared parent-chain helper between fsView and walker tests) only if it adds value.
**Done when**: All criteria met, mutation report reviewed, manual `npm run dev` smoke watched (network tab N/A — no server yet), human approves commit.
**Fallback split**: if the diff exceeds ~400 lines, land the two pure core modules (`fsView.ts`, `runLine.ts`) as a precursor PR (independently unit + mutation tested; reserved by the contract), then the UI wiring as a second PR.

### Slice 2: Scrollback session feel — echo, accumulation, autoscroll

**Value**: The terminal behaves like a real session — your typed command is preserved above its output, successive commands stack into a readable history, and the view follows the newest line.
**Path**: `runInput()` first pushes a `prompt`-kind line echoing `user@host> <typed command>` into the scrollback, then appends the command's result lines; `TerminalOutput` keeps a bottom-anchored scroll (Solid `createEffect` + `onMount` ref → `scrollTop = scrollHeight` on scrollback change); empty/whitespace input pushes only a fresh prompt line and runs nothing.
**Intentionally skipped**: input-recall history (ArrowUp/Down), tab-complete, Ctrl-C — all deferred out of this chunk.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `front-end-testing`.
**Acceptance criteria** (confirm before coding):
- The pure echo-line builder produces `{ kind: 'prompt', content: 'user@host> cat /etc/passwd' }` from a session + raw line.
- Running two commands leaves both their echoed prompts and outputs in scrollback, in order.
- Empty/whitespace Enter adds exactly one prompt line and zero result lines.
- Browser smoke: run three commands; all six+ lines visible in order; view scrolled to bottom.
**RED**: Unit test the pure echo-line builder (prompt formatting from session.username + host + raw input; whitespace-only still echoes a bare prompt). Mutator-aware: exact prompt string (`@`, `>`, spacing — StringLiteral mutants), the empty-input branch (ConditionalExpression).
**GREEN**: Add the echo-line builder (pure, in `core/shell/runLine.ts` or a small `ui` formatter if it depends on host display only — prefer pure core if it's just string assembly); wire `runInput()` to prepend it; add the autoscroll effect to `TerminalOutput`.
**MUTATE**: Stryker on the new/changed core function.
**KILL MUTANTS**: Strengthen survivors.
**REFACTOR**: Assess only if valuable.
**Done when**: All criteria met, mutation report reviewed, manual `npm run dev` smoke watched, human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — run `mutation-testing` skill (Stryker) on changed `core/` modules.
2. Refactoring assessment — run `refactoring` skill.
3. `npm run build` + `npm run lint` pass in `v2/`.
4. One manual smoke run through `npm run dev` before the slice is "done" (D10 + `feedback_e2e_test_new_primitives`).
5. PR ≤ ~400 lines (D10); squash-merge via `gh pr merge --squash --delete-branch` (Conventional Commits, scoped prefix, `(#N)` suffix) per `feedback_pr_squash_merge_convention`.

## Explicitly deferred (NOT in this chunk)

Shell tokenizer/parser (pipes, redirects, quotes, flags); typed command registry; input-recall history; tab-completion; Ctrl-C / `AbortSignal` cancellation wiring; async/streaming `CommandResult` handling; `mode_change` overlays (nano, lynx, nc, ftp, mysql, redis); IndexedDB/Supabase persistence; patch model; multiplayer/cross-player; themes; boot/intro/rework-notice screens; `adapters/` layer.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
