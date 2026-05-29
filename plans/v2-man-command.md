# Plan: v2 `man` command (per-command manual pages)

**Branch**: feat/v2-man-command
**Status**: Active

## Why this plan exists

Legacy has `man <command>` (`src/commands/man.ts`) rendering a manual page
(NAME / SYNOPSIS / DESCRIPTION / ARGUMENTS / EXAMPLES). v2 has no `man` yet —
and the just-shipped `help` footer points players at it (`Use man <command> for
detailed help.`). This ports `man`, making that hint real.

## Key shape difference (legacy → v2)

v2's `ManualPage` is simpler than legacy's `CommandManual`:

```ts
// v2 (core/commands/types.ts) — already exists
type ManualPage = {
  readonly synopsis: string;
  readonly description: string;
  readonly examples?: readonly string[]; // plain command strings
};
```

Legacy had `arguments?: CommandArgument[]` and `examples?: CommandExample[]`
(`{ command, description }` objects). v2 has **no `arguments`** and **examples
are bare strings**. So the v2 `man` renders NAME / SYNOPSIS / DESCRIPTION /
EXAMPLES only, with each example as a single indented command line (no
per-example description). No `ManualPage` reshaping — render the data we have.

## Locked decisions (2026-05-30)

1. **Match legacy `man` interface**: `man <command>`, single positional (first
   arg; extra args ignored), `category: 'general'`, no flags.
2. **Errors as `CommandResult` error lines** (v2 returns, never throws):
   - No arg → two error lines `man: missing command name` + `Usage: man <command>`,
     `exitCode 2` (usage error — matches grep's `USAGE` convention).
   - Unknown command → error line `man: no manual entry for '<name>'`,
     `exitCode 1` (lookup failure — matches cat's not-found).
3. **No-manual fallback**: a command without a `manual` renders the header +
   NAME section + `No detailed manual available for this command.`, `exitCode 0`
   (legacy parity).
4. **EXAMPLES omitted** when `examples` is absent or empty (legacy parity). No
   ARGUMENTS section at all (v2 has no argument metadata).
5. **Output is `TerminalLine[]`**, all `text` lines (a man page is plain text).
   Indentation: section headers unindented; section body 4 spaces. Exact layout
   pinned by a golden test.
6. **Registry access via runtime `import('./registry')` inside `execute`** —
   same load-order-cycle fix as `help` (`man` will be a builtin the registry
   statically imports). Pure `formatManPage(command)` does the rendering so it's
   testable with fixtures; `execute` does arg-parse + lookup + error handling.
7. **`help` is unchanged** — its `man` footer simply becomes accurate.

## Architecture

- `formatManPage(command: Command): readonly TerminalLine[]` — pure, exported
  from `core/commands/man.ts`. Renders header (`NAME(1)` uppercased), NAME,
  then SYNOPSIS / DESCRIPTION / EXAMPLES from `command.manual` (or the fallback
  line when `manual` is undefined).
- `man` command object: `execute` reads `args[0]`; emits the no-arg usage error
  or the unknown-command error; otherwise `import('./registry')`, look up the
  command, and return `formatManPage(found)` as a `sync` result.
- Register `man` in `registry.ts` builtins (between `ls` and `mkdir`
  alphabetically? — builtins are import-sorted; insert to keep the list tidy).

## Acceptance Criteria

- [ ] `man ls` renders `LS(1)`, a NAME line `ls - List directory contents`,
      SYNOPSIS (`ls [-a] [-l] [path]`), DESCRIPTION, and an EXAMPLES section
      listing each example command on its own indented line.
- [ ] `man` with no argument returns an error result (exit 2) whose lines
      include `man: missing command name` and `Usage: man <command>`.
- [ ] `man nonesuch` returns an error result (exit 1) with line
      `man: no manual entry for 'nonesuch'`.
- [ ] A command whose `manual` is undefined renders the header + NAME +
      `No detailed manual available for this command.` (exit 0), and no
      SYNOPSIS/DESCRIPTION/EXAMPLES.
- [ ] A command with no `examples` (or `examples: []`) renders no EXAMPLES header.
- [ ] `man` is registered, so `man help` and `man man` both work.
- [ ] `test:run`, `build`, `lint`, `format` green; v2 version bumped 0.12.0 →
      0.13.0 (`package.json` + `package-lock.json`).

## Slices

> Single PR. `man` is one read-only command; the edge behaviours (no-arg,
> unknown, no-manual, empty-examples) are TDD increments within the one slice.

### Slice 1: `man <command>` renders a command's manual page

**Value**: A player runs `man <command>` and reads its synopsis, description,
and examples — the detail `help` points them to.
**Path**: terminal `man ls` → `runCommandLine` → `man.execute` → arg-parse +
`import('./registry')` lookup → `formatManPage(found)` → `TerminalLine[]`
rendered. Skipped/explicit: no-arg, unknown-command, and no-manual states are
covered as their own criteria below.
**Required implementation skills**: Before code, load `tdd`, `testing`,
`mutation-testing`, `refactoring`.
**Acceptance criteria**: All criteria above. **Present + confirm before coding.**
**RED**: Tests for `formatManPage` with `buildCommand` fixtures —
(a) full page (header/NAME/SYNOPSIS/DESCRIPTION/EXAMPLES) golden exact-output;
(b) no-`manual` fallback; (c) absent/empty `examples` omits the section. Plus
`man.execute` tests — (d) `man ls` against the live registry returns sync exit 0
with `LS(1)`; (e) no-arg → exit 2 with the usage lines; (f) unknown → exit 1
with the no-entry line. All fail (no `man.ts`).
**GREEN**: Implement `formatManPage` + the `man` command; register it.
**MUTATE**: Run `mutation-testing` on `man.ts`. Target the section-presence
conditionals (`manual` undefined, `examples?.length`), the error exit codes
(2 vs 1), the uppercasing, and the indentation literals.
**KILL MUTANTS**: Add boundary/branch assertions; accept static command-object
metadata survivors per the no-metadata-tests rule.
**REFACTOR**: Assess (shared section-builder helper, indentation constants);
only if it adds value.
**Done when**: All acceptance criteria met, mutation report reviewed, human
approves commit.

## Deferred / follow-ups

- **Richer `ManualPage`** (an `arguments` field, per-example descriptions like
  legacy) — only if gameplay needs it; current commands carry synopsis +
  string examples, which is enough.
- **Tier/availability awareness** — `man` shows any registered command's page
  regardless of whether the session could run it (parity with `help`).

## Pre-PR Quality Gate

1. Mutation testing on `man.ts` (+ touched files).
2. Refactoring assessment.
3. `npm run build`, `lint`, `format`, `test:run` green.
4. Version bump in `package.json` + `package-lock.json`.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
