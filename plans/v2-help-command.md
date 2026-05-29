# Plan: v2 `help` command (commands grouped by category)

**Branch**: feat/v2-help-command
**Status**: Implemented — awaiting commit approval

## Why this plan exists

Legacy has a `help` command (`src/commands/help.ts`) that lists every available
command grouped into labelled sections (General, Filesystem, Mission, Network,
WiFi), each row showing the command's synopsis padded against its short
description, footed by a hint to use `man <command>`. v2 has no `help` yet, and
its `Command` type carries no `category` field — so there is nothing to group by.
This brings the sectioned listing across to v2.

## Locked decisions (2026-05-30)

1. **Keep the `man <command>` footer** (user decision) even though `man` is not
   yet ported. Treated as the next thing to port; the hint matches legacy.
2. **`category` is a required field on `Command`** (matches legacy — forces every
   command to declare its section, no silent miscategorisation). The union is
   ported verbatim: `'general' | 'filesystem' | 'mission' | 'network' | 'wifi'`.
   Only `general` + `filesystem` are populated today; empty categories are
   filtered out of the output, so the unused members cost nothing.
3. **Category assignments** match legacy where a legacy command exists:
   - `filesystem`: cat, cd, grep, ls, mkdir, pwd, rm, touch
   - `general`: echo, identity (`identity` is v2-new; `touch` is v2-new →
     filesystem by obvious analogy)
4. **Synopsis fallback is `cmd.name`** (NOT legacy's `cmd.name + '()'`). v2 is a
   real shell (`ls -la`), not legacy's JS-function-call aesthetic. Every command
   already ships a `manual.synopsis`, so the fallback is defensive only.
5. **Output is `TerminalLine[]`**, not a joined string (v2 renderer contract).
   Section headers + command rows are `text`; the separator rule and the footer
   hint are `dim` (a tasteful v2 touch — legacy had no dim channel). Open to veto
   at review.
6. **`help` lists ALL registered commands regardless of tier/availability**
   (legacy parity). Filtering the listing by the current session's tier or by
   `availability` is deferred (see below).
7. **`help` ignores positional args** (legacy parity — detail lives in `man`).
   No flag spec.

## Architecture

- **Pure formatter** `formatCommandList(commands: readonly Command[]): readonly TerminalLine[]`
  exported from `core/commands/help.ts`. Framework-free, takes an injected command
  list (NOT the registry) so it is testable with small fixtures and decoupled from
  the live command set. Mirrors legacy's `formatCategory` logic: group by category,
  filter to non-empty categories in a fixed `CATEGORY_ORDER`, sort commands within
  a section alphabetically by name, compute one global synopsis-padding width across
  all commands for cross-section alignment.
- **`help` command object** wires the registry into the formatter:
  `formatCommandList([...commandRegistry.values()])`. Importing `commandRegistry`
  into `help.ts` is the intended design — the registry's own doc comment anticipates
  a "future `help` / `man` consumer [that] can iterate the builtins list directly".
  The import is circularly safe: `commandRegistry` is only read at runtime inside
  `execute`, never at module-load.
- **`category` field** added to the `Command` type in `core/commands/types.ts`
  alongside a new exported `CommandCategory` union, then populated on all 10
  command objects.

## Acceptance Criteria

- [x] `formatCommandList` groups commands under their category's label, in the
      fixed order General → Filesystem → Mission → Network → WiFi.
- [x] Categories with no commands produce no header (e.g. no "WiFi" header today).
- [x] Commands within a section are listed alphabetically by name.
- [x] Each command row shows its `manual.synopsis` (falling back to its `name`),
      left-padded to a single width shared across all sections, then its
      `description`.
- [x] Output ends with the `Use man <command> for detailed help.` footer.
- [x] Every command in `commandRegistry` declares a valid `CommandCategory`
      (registry invariant test) — so the live `help` listing is complete.
- [x] Running `help` returns a `sync` result, exit code 0, whose lines include a
      "General" and a "Filesystem" header with `echo`/`identity` under General and
      `ls`/`cat`/etc. under Filesystem.
- [x] `test:run`, `lint`, `build` all green; version bumped in `package.json` +
      `package-lock.json`.

## Slices

> The two slices below land in **a single PR**. Slice 1 is horizontal (a field with
> no consumer) and delivers no user value alone; Slice 2 is the observable behaviour
> that gives the field a purpose. They are inherently coupled — splitting into two
> PRs would leave a known-good but useless intermediate. Each remains its own
> RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR increment within the PR.

### Slice 1: Every command declares a category

**Value**: The command system can be grouped/sectioned — unlocks Slice 2 (and a
future `man`/availability-aware listing).
**Path**: `Command` type gains `category: CommandCategory` → all 10 command objects
populate it → registry invariant test proves none was missed. No user-visible change
yet; verified by typecheck + the invariant test.
**Required implementation skills**: Before code, load `tdd`, `testing`,
`mutation-testing`, `refactoring`.
**Acceptance criteria**: A test over `commandRegistry` asserts every command's
`category` is one of the `CommandCategory` members; project typechecks with the new
required field. **Present + confirm before coding.**
**RED**: In `registry.test.ts` (or a new test), assert that for every command in
`commandRegistry`, `category` ∈ the allowed set, and spot-check two known mappings
(`echo` → general, `ls` → filesystem). Fails because the field doesn't exist /
isn't populated.
**GREEN**: Add `CommandCategory` union + `readonly category` to `Command`; add the
correct `category` to each of the 10 command objects.
**MUTATE**: Run `mutation-testing` on `types.ts`/the touched commands (mostly data;
expect equivalents on literal category strings — categorisation is data, the
behaviour is exercised in Slice 2).
**KILL MUTANTS**: Strengthen the invariant/spot-check assertions if a literal flips
undetected; accept data-literal equivalents per project guidance.
**REFACTOR**: Assess only.
**Done when**: Invariant + spot-check tests pass, typecheck green, human approves.

### Slice 2: `help` lists commands grouped into sections

**Value**: A player typing `help` sees every command organised by category with a
one-line description and a pointer to `man`.
**Path**: terminal input `help` → `runCommandLine` → `help.execute` →
`formatCommandList([...commandRegistry.values()])` → sectioned `TerminalLine[]`
rendered in the terminal.
**Required implementation skills**: Before code, load `tdd`, `testing`,
`mutation-testing`, `refactoring`.
**Acceptance criteria**: All `formatCommandList` criteria above, plus
`help.execute` returns `{ kind: 'sync', exitCode: 0 }` with the expected sectioned
lines. **Present + confirm before coding.**
**RED**: Tests for `formatCommandList` using a `buildCommand` fixture factory:
(a) two commands in different categories produce two ordered, labelled sections;
(b) an empty category yields no header; (c) intra-section alphabetical sort;
(d) synopsis padding is the shared global width and falls back to `name` when
`manual` is absent; (e) the footer line is present and last. Plus a thin
`help.execute` test asserting `sync`/exit 0 and presence of General + Filesystem
headers from the real registry. All fail (no `help.ts`).
**GREEN**: Implement `formatCommandList` (group → filter empty → order → sort →
pad → rows → footer) and the `help` command object; register `help` in
`registry.ts` builtins.
**MUTATE**: Run `mutation-testing` on `help.ts`. Target the ordering, the
empty-category filter, the padding-width reducer (`Math.max`), the alphabetical
comparator, and the footer.
**KILL MUTANTS**: Add boundary/ordering assertions to kill survivors; ask the human
where a survivor's value is genuinely ambiguous.
**REFACTOR**: Assess (e.g. shared `CATEGORY_ORDER`/`CATEGORY_LABELS` constants);
only if it adds value.
**Done when**: All acceptance criteria met, mutation report reviewed, human
approves commit.

## Deferred / follow-ups

- **`man <command>`** — the detailed per-command page the footer points to. Next
  command to port; legacy `src/commands/man.ts` is the reference.
- **Tier / availability-aware listing** — hide commands the current session can't
  run, or mark them. Legacy listed all; revisit when tiers matter to UX.
- **`dim`/styling polish** of headers — currently headers are plain `text`; could
  be emphasised once the renderer grows a heading channel.

## Pre-PR Quality Gate

1. Mutation testing — run `mutation-testing` skill on `help.ts` (+ touched files).
2. Refactoring assessment — run `refactoring` skill.
3. `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all green.
4. Version bumped in `package.json` + `package-lock.json`.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
