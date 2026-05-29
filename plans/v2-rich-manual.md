# Plan: v2 richer `ManualPage` (arguments + described examples)

**Branch**: feat/v2-rich-manual
**Status**: Active

## Why this plan exists

The `v2-man-command` plan shipped `man` against a deliberately-thin `ManualPage`
and left, under "Deferred / follow-ups", exactly this: _"Richer `ManualPage` (an
`arguments` field, per-example descriptions like legacy)."_ This picks that up.

Legacy's `CommandManual` (`src/components/Terminal/types.ts`) carried two things
v2 dropped on the port:

- **`arguments`** — `readonly CommandArgument[]`, each `{ name, description,
  required?, values? }`. v2 has none.
- **`examples`** — legacy `readonly CommandExample[]` (`{ command, description }`);
  v2 flattened these to bare `readonly string[]`, losing the per-example
  description.

Doing this now is cheap: v2 has only 12 commands. Every additional command
authored against the thin schema makes the eventual migration larger, so this is
"the moment." (Originating instruction, 2026-05-30.)

We are **deferring tab auto-completion** (the original request) — it is a
separate, larger feature. This plan only enriches the manual schema + renderer +
the command corpus, which is autocomplete's prerequisite anyway (the completer
will read `arguments`).

## Key shape difference (legacy → v2)

```ts
// v2 today (core/commands/types.ts)
type ManualPage = {
  readonly synopsis: string;
  readonly description: string;
  readonly examples?: readonly string[];   // bare command strings
};

// v2 target
type CommandArgument = {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  // NOTE: legacy's `values?: readonly string[]` is intentionally NOT ported
  // here — it only ever fed tab-completion and `man` never rendered it. It
  // lands with the autocomplete feature, alongside the code that consumes it.
};

type CommandExample = {
  readonly command: string;
  readonly description: string;
};

type ManualPage = {
  readonly synopsis: string;
  readonly description: string;
  readonly arguments?: readonly CommandArgument[];
  readonly examples?: readonly CommandExample[];   // now objects
};
```

Faithful legacy `man` rendering (`src/commands/man.ts`) is the target layout:

```
ARGUMENTS
    <name> (required)          ← or "(optional)" when required is falsy
        <description>

EXAMPLES
    <command>
        <description>
                               ← blank line after each example
```

Section order: NAME / SYNOPSIS / DESCRIPTION / **ARGUMENTS** / EXAMPLES.

## Locked decisions (2026-05-30)

1. **Defer `values`** — port `CommandArgument` as `{ name, description,
   required? }` only. Every field is rendered by `man` and covered by a test;
   no orphan field. `values` ships with autocomplete. (User decision.)
2. **Author `arguments` for all existing commands now** — not just the schema
   + renderer. (User decision.) Converting `examples` to objects is mandatory
   regardless (breaking type change); authoring `arguments` is the additive
   half, done across the corpus while it's only 12 commands.
3. **Faithful legacy layout** — `(required)`/`(optional)` marker exactly as
   legacy; argument description on its own line indented 8 spaces; each example
   renders `command` (4-space indent) then `description` (8-space indent) then a
   blank line, matching `src/commands/man.ts`. Exact layout pinned by golden
   tests.
4. **Sections omit when empty** — no ARGUMENTS header when `arguments` is absent
   or `[]`; no EXAMPLES header when `examples` is absent or `[]` (existing
   parity, preserved).
5. **No backward compatibility** — per the no-backward-compat rule, reshape
   `examples` in place; no transitional string-or-object union.
6. **`help` is untouched** — it reads only `synopsis`/`description`. Its tests
   don't reference `examples`. Verify it stays green; change nothing.
7. **Single PR** (user decision, 2026-05-30) — the breaking `examples` reshape
   and the additive `arguments` are the same conceptual change ("enrich the
   manual") and the reshape already forces touching every command, so splitting
   buys little. Delivered as one PR with two TDD increments (examples, then
   arguments) inside it.

## Architecture

- `core/commands/types.ts` — add `CommandArgument` and `CommandExample` types;
  change `ManualPage.examples` to `readonly CommandExample[]`; add optional
  `ManualPage.arguments`.
- `core/commands/man.ts` — `formatManPage` (already pure) gains an ARGUMENTS
  section builder and a richer EXAMPLES builder. A shared `BODY_INDENT` (4) plus
  a new deeper indent (8) for descriptions. No change to `execute`, errors, or
  the no-manual fallback.
- Each command's `manual` object updated in place (mechanical).
- No new files; no UI changes; no registry changes.

## Acceptance Criteria

- [x] `ManualPage.examples` is `readonly CommandExample[]`; `CommandArgument`
      and `CommandExample` types exist and are exported.
- [x] `man <cmd>` renders each example as the command line (4-space indent)
      followed by its description (8-space indent), then a blank line.
- [x] `man <cmd>` renders an ARGUMENTS section (between DESCRIPTION and EXAMPLES)
      listing each argument as `<name> (required|optional)` + an indented
      description line.
- [x] ARGUMENTS section is omitted entirely when a command has no `arguments`
      (absent or empty); EXAMPLES omission behaviour is unchanged.
- [x] All 11 non-`man` commands (cat, cd, echo, grep, help, identity, ls, mkdir,
      pwd, rm, touch) carry described examples and authored `arguments`; `man`'s
      own manual uses the new shape too. (grep's stale "(Slice 3 will add … the
      -l flag.)" clause trimmed — `-l` is implemented, now documented.)
- [x] `man ls` (live registry) shows its `-a`/`-l`/`path` arguments and a
      described example, proving end-to-end consumption.
- [x] `help` output is unchanged (reads only synopsis/description; tests green).
- [x] `test:run` (499), `build`, `lint` green (v2 has no Prettier — ESLint is the
      format gate); v2 version bumped 0.13.0 → 0.14.0 (`package.json` +
      `package-lock.json`).

## Slices

Single PR, following RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code
without a failing test. Read CLAUDE.md and testing rules before starting. The
slice carries two TDD increments (examples, then arguments); each is its own
RED-GREEN cycle, but they ship together because the `examples` reshape already
forces touching every command.

### Slice 1: `man` renders described examples and an ARGUMENTS section

**Value**: A player running `man <cmd>` sees what each example *does* (not just
the command) and a full ARGUMENTS list (name, required/optional, meaning) — the
manual metadata legacy had and v2 dropped on the port.
**Actor / Trigger / Outcome**: Player → `man ls` → EXAMPLES show each command
with an indented description; an ARGUMENTS section (between DESCRIPTION and
EXAMPLES) lists `-a`/`-l`/`path` each with a required/optional marker and
description.
**Path**: reshape `ManualPage.examples` to `CommandExample[]` + add optional
`arguments: CommandArgument[]` → `formatManPage` gains a richer EXAMPLES builder
(command + description + blank) and an ARGUMENTS builder (`name
(required|optional)` + indented description) → migrate all 11 commands' + `man`'s
manuals to the new shape and author their `arguments`.
**Required implementation skills**: Before code, load `tdd`, `testing`,
`mutation-testing`, `refactoring`.
**Acceptance criteria**: all criteria above. **Present + confirm before coding.**

**RED (increment A — examples)**: `formatManPage` fixture tests — (a) golden
exact-output for a manual whose `examples` are `{command, description}`,
asserting the 4-space command line, 8-space description line, and trailing blank
per example; (b) absent/empty `examples` still omits the section. `man ls`
integration test updated to assert a described example renders. Fail (type change
+ renderer not updated).
**GREEN (A)**: Reshape the type; update the EXAMPLES builder; migrate every
command's `examples` to objects (required to compile).

**RED (increment B — arguments)**: `formatManPage` fixture tests — (c) golden
exact-output for a manual with `arguments`, asserting the `<name> (required)` /
`(optional)` marker, the 8-space description line, and placement before EXAMPLES;
(d) absent/empty `arguments` omits the section header. `man ls` integration test
asserting its argument rows. Fail (no ARGUMENTS rendering yet).
**GREEN (B)**: Add `CommandArgument` type + optional `arguments` field; implement
the ARGUMENTS builder; author `arguments` for every command.

**MUTATE**: `mutation-testing` on `man.ts`. Target the indentation literals
(4 vs 8), the per-example blank line, the `examples?.length` / `arguments?.length`
presence guards, the `required` ternary (`(required)` vs `(optional)`), and
section ordering.
**KILL MUTANTS**: Add boundary/branch assertions (required-vs-optional branch,
empty-section omission); accept static command-metadata survivors per the
no-metadata-tests rule (and the load-throw / type-narrowing equivalence rules
where they recur).
**REFACTOR**: Assess folding ARGUMENTS + EXAMPLES into one parameterised
"labelled detail block" builder and a shared indent constant; only if it removes
real duplication.
**Done when**: all acceptance criteria met, mutation report reviewed, version
bumped 0.13.0 → 0.14.0 (`package.json` + `package-lock.json`), human approves
commit.

## Deferred / follow-ups

- **Tab auto-completion** — the originally-requested feature, deferred here.
  Legacy lives at `src/shell/complete.ts` (pure, with a `CompleteAdapter` seam) +
  `src/shell/complete.test.ts`; ports to `core/shell/complete.ts`. v2 flag
  completion will read `command.flags` (FlagSpec keys), NOT `manual.arguments`.
  The keyword-at-arg0 feature consumes `CommandArgument.values`, which lands with
  this feature. UI wiring needs a Tab handler + an input element ref for caret
  repositioning (legacy used `requestAnimationFrame` + `setSelectionRange`).
- **`values` field** — add to `CommandArgument` when autocomplete consumes it.

## Pre-PR Quality Gate

Before each PR:
1. Mutation testing on `man.ts` (+ touched files).
2. Refactoring assessment.
3. `npm run build`, `lint`, `format`, `test:run` green.
4. Version bump in `package.json` + `package-lock.json`.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
