# Plan: D2.5 — `john`, the silent crack

**Branch**: `feat/john-the-silent-crack`
**Status**: Slice 1 GREEN — awaiting commit approval

## As built

`v2/src/core/commands/john.ts` (+ `john.test.ts`, 26 tests), `parseWordlist` added beside
`formatWordlist` in `defaultWordlist.ts`, and the registry entry. 2318 tests / 135 files green;
`tsc -b` and eslint clean; version 0.115.0.

**Mutation: 109 mutants, 84 killed, 25 survived — every survivor inside the command's declarative
`manual` block (line 151+; the last executable line is 147). 84/84 logic mutants killed.** Man-page
prose is the same survivor class hydra carries 36 of; asserting it would only pin copy-editing.

Three real gaps the first run exposed, all now closed:

1. **The whole `.filter(blank && !comment)` line was dead** — a blank line has no `:` and fell to
   the missing-hash guard anyway, so six mutants over it survived. The comment half *was*
   load-bearing but only for a comment containing a colon, which no test had. Fixed by making the
   fixture's comment `# harvested from 192.168.4.31:22` and collapsing the pipeline to a single
   guard inside the `flatMap`.
2. **`cracked += 1` → `-= 1` survived** because `toContain('1/2 …')` also matches `'-1/2 …'`. A
   substring assertion cannot catch a sign error. Fixed with one test asserting the complete line
   sequence, which also killed both unasserted blank separators.
3. **`username === undefined` was dead code** — `String.split` always returns at least one element.
   Verified not type-required with `tsc -b --force`, then deleted rather than documented as
   equivalent.

**A survivor that looks impossible is worth a second look at its span, not at the harness.** The
line-3 mutant replaced only the first operand of a two-operand condition; hand-testing the whole
condition as `if (false)` killed it and briefly looked like a Stryker bug. It was not. Recorded in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §4.

**One deviation from the approved criteria**: the summary pluralises on the TOTAL, following legacy
— `0/1 password hash cracked`, `1/2 password hashes cracked`. The approved criterion quoted
`0/1 password hashes cracked`, which is simply wrong English for a total of one.
**Parent**: [`d2-credential-layer.md`](./d2-credential-layer.md) row D2.5 · epic
[`legacy-parity-epic.md`](./legacy-parity-epic.md) Phase 1, D2
**Version**: 0.114.0 → 0.115.0

## Goal

A player cracks password hashes from a file against their own wordlist, without sending a single
packet at the box those hashes came from.

## Why this is worth building now

D2.3 made a hydra sweep the loudest thing a player can do to a box: ~110 `auth.log` lines per run,
appended forever. `john` cracks the *same* hashes with the *same* wordlist and the *same* `md5` —
its result set is identical to hydra's, and always will be. **Silence is the entire product
difference**, and it only became a difference once the noise existed. That is why the split's
original ordering was wrong and D2.3 went first.

## Grounding (read 2026-08-09, every line verified in the shipped code)

| Fact | Where | Consequence for this slice |
|---|---|---|
| `john` is already an apt package, binary-only | `aptPackages.ts:49` | The `command not found. Install with: apt install john` path works today. Only the command is missing. |
| The binary check is the *only* runtime availability gate | `availability.ts:93-106` | Nothing else needs wiring: drop the module in, register it, and `apt install john` makes it runnable. |
| `su` already compares `md5(typed)` to the passwd hash | `su.ts:201` | The hash → plaintext → `su root` chain needs nothing but `john` itself. |
| `env.fs.read` resolves against the CURRENT machine | `cat.ts:50-56`, `PatchApi` docs at `types.ts:118-128` | `john` reads the box it is standing on, for free. No gate to write, and none to remove later. |
| `accountsIn` parses a `Directory`, not a string | `passwdAccount.ts:25-48` | Not reusable here — `john` is handed a *file path*, not a machine. It needs its own passwd-line parser over content. |
| `formatWordlist` exists; its inverse does not | `defaultWordlist.ts` | Add `parseWordlist` beside it. `hydraCrack.ts`'s private `wordsIn` is the same knowledge — flagged to converge later, **not** touched here. |

### ⚠️ Finding 1 — `AvailabilityRule` is declared everywhere and read nowhere

`types.ts:632-635` defines `localhost-only` / `any-machine` / `installed-package`, and ten command
modules declare one. **No production code reads the field.** `registry.ts:89` wraps commands with
`wrapWithBinaryCheck` + `wrapWithLibraryCheck` only, and no test asserts a behavioural consequence
of the rule. It is inert metadata.

So `apt` is declared `localhost-only` (`apt.ts:281`) but in fact already runs on an NPC box, gated
only by root — which is exactly the owner's principle, already true. And hydra's real restriction
is not its declared `localhost-only` at all: it is the hand-written `isOwnWorkstation` check at
`hydra.ts:101`. **`john` must declare `any-machine` and add no check** — that is the whole of
honouring the principle here, and it costs nothing.

### 🐛 Finding 2 — reinstalling hydra silently destroys a curated wordlist

`apt install` has **no already-installed short-circuit**: `handleInstall` (`apt.ts:246`) goes
straight to `installPackage`, which writes every `extraFile` unconditionally (`apt.ts:230`). So
`apt install hydra` a second time overwrites `/usr/share/wordlists/passwords.txt` with
`formatWordlist(DEFAULT_WORDLIST)` and **every word the player harvested is gone**, with no warning.

D2.6's entire progression is that one file. This is a real bug, it predates this slice, and it gets
worse the moment a second tool depends on the list. **Out of scope here** — it belongs to `apt`, not
`john`, and folding it in would make this PR two unrelated reviews. **Logged as the next small
slice**; see "Follow-ups".

## Decisions taken at planning

1. **The argument is a FILE, not a hash** — `john <file>`, matching legacy (`src/commands/john.ts`
   synopsis). It works today by copy-paste (`cat /etc/passwd` on the cracked box → `nano
   hashes.txt` at home), *and* it is the exact command the player will run on an NPC box once `scp`
   lands and they can carry the wordlist over. One shape serves both, so there is nothing to
   redesign later. A bare-hash argument would be a second shape that the end-state does not want.
2. **`john` ships NO wordlist of its own.** It reads the shared
   `/usr/share/wordlists/passwords.txt` that `apt install hydra` installs. One list means one
   progression (D2.6). Giving `john` its own `extraFiles` entry at the same path would make
   `apt install john` a second way to wipe a curated list (finding 2).
3. **Reads the current machine, always.** Both the target file and the wordlist go through
   `env.fs.read`. No `isOwnWorkstation` gate — per the owner's locked decision in the parent split.
4. **No `api/` change, and therefore no wire-check.** `john` is the one tool in this epic that never
   talks to the server. That is not an implementation detail — it *is* the feature.

## Acceptance Criteria

**Present to the owner and get confirmation before writing any code.**

- [ ] A player with `hashes.txt` holding a passwd-format row whose password is in their wordlist
      runs `john hashes.txt` and sees `<username>:<password>`, then `1/1 password hash cracked`
- [ ] A row whose password is **not** in the wordlist prints no credential line and is counted in
      the denominator — `0/1 password hashes cracked` — so "held" and "never tried" stay
      distinguishable, as they are in hydra
- [ ] Running `john` changes **nothing** on any machine: no filesystem write, and no request to the
      server. It completes with the network down
- [ ] `john` runs on a machine that is not the player's own workstation, reading that box's file and
      that box's wordlist
- [ ] With no wordlist on the current box, `john` reports the missing path and how to get it, and
      cracks nothing
- [ ] Each refusal names its own cause and exits non-zero: missing operand, no such file,
      is-a-directory, permission denied, and a file holding no usable hashes
- [ ] A row with a placeholder hash (`x`, `*`, `!!`, empty) is skipped entirely — not reported, and
      not counted as a hash that held
- [ ] The run is streamed and abort-aware, like `hydra` and `aircrack`

## Slices

### Slice 1 (only): `john <file>` cracks passwd-format hashes offline against the wordlist on the box you are standing on

**Kept as one PR deliberately.** The parts — parse, crack, stream, refuse — are one behaviour with
one entry point; splitting them would produce an intermediate that cracks nothing or reports
nothing. It is strictly smaller than D2.1, which shipped a server action, the `extraFiles` seam and
a streaming command together.

**Value**: the attacker gets a way to turn a stolen hash into a password that leaves no trace on the
victim — the silent counterpart to the sweep D2.3 made loud.
**Path**: `john hashes.txt` → `wrapWithBinaryCheck` (binary present + executable) → `env.fs.read`
the target file → parse passwd rows → `env.fs.read` the wordlist → `md5(word)` compare per row →
streamed credential lines + summary. No state change, no network, no observability side-effects —
the absence of the last two is the point.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
`reduce-system-complexity` is `N/A` — nothing is being retired.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria**: the list above, in full.

**RED**: `v2/src/core/commands/john.test.ts`, driving the command through its public `execute` with
a factory-built `CommandEnv`. First failing test: a file holding one passwd row whose password is in
the wordlist yields `<username>:<password>` and `1/1 password hash cracked`. Then, one behaviour per
test: the uncracked denominator; the missing-wordlist refusal; each read refusal; the placeholder
skip; the any-machine case; the offline case.

**Mutation-aware test planning** — the likely survivors, from `mutator-rules.md`, and the tests that
kill them up front:
- `matched/total` summary arithmetic and its singular/plural boundary → assert exact summary strings
  for a 0-of-1, a 1-of-1 and a 1-of-2 file, not just a match count
- the placeholder filter list → one test per placeholder shape rather than one test with `x`
- `md5(word) === hash` inverted or made non-strict → include a row whose hash is a **prefix** of a
  real one, and a wordlist whose matching word is neither first nor last (D2.3's mutation run
  survived exactly this: a match in the final position hid an off-by-one)
- the blank-line / comment-line filters → a file with a trailing newline, a blank interior line and a
  `#` comment

**GREEN**: `v2/src/core/commands/john.ts` — a `Command` with `category: 'filesystem'`,
`tier: 'guest'`, `availability: { kind: 'any-machine' }`, a `manual` carrying the legacy synopsis and
examples, and a streamed `execute` via `streamedResult` + `env.sleep`. Plus `parseWordlist` beside
`formatWordlist` in `defaultWordlist.ts`, and the registry entry.

**MUTATE**: `npx stryker run --mutate src/core/commands/john.ts --reporters json,clear-text`, from
`v2/`, with the dev server down. `hydraCrack.ts`'s 98.67% is the bar. Classify every survivor as
real or provably equivalent, and record the argument for each equivalent one.

**KILL MUTANTS**: strengthen tests for real survivors; ask the owner where value is ambiguous.

**REFACTOR**: assess only. Two candidates are already known and both are **deliberately deferred** —
converging `hydraCrack.ts`'s private `wordsIn` onto the new `parseWordlist`, and the seven duplicate
`auth.log` appenders from D2.3. Each opens files this behaviour has no reason to touch.

**Done when**: every acceptance criterion holds, mutation evidence is presented, `npm run typecheck`
and `npm run lint` are clean, the version is bumped in both `v2/package.json` and
`v2/package-lock.json`, and the owner approves the commit.

## Pre-PR Quality Gate

1. `npx vitest run` — full suite green (2292 tests / 134 files at 0.114.0; expect the file count +1)
2. `npx stryker run --mutate src/core/commands/john.ts --reporters json,clear-text` — survivors
   classified
3. `npm run typecheck` (`tsc -b`) and `npm run lint` — clean, with no `.stryker-tmp` residue
4. Wire-check: **`N/A`, and that is the feature.** `john` adds no `api/` surface and issues no
   request. Alternate evidence: the module imports nothing from `core/sessions` or the adapters, and
   the offline acceptance test passes with `isOnline()` false
5. Refactoring assessment recorded, including why both known candidates stayed out

## Follow-ups this slice deliberately leaves open

- **🐛 `apt install <pkg>` re-writes `extraFiles` over a curated file** (finding 2). Small, isolated,
  and it protects the whole D2.6 progression. Strong candidate for the very next PR.
- **`hydra` refuses to run off the player's workstation** (`hydra.ts:101`, mirrored server-side at
  `hydraCrack.ts:211`). Lifting it is the owner's locked principle, has a server half, and is its own
  slice.
- **`AvailabilityRule` is inert metadata** (finding 1). Either enforce it in `registry.ts` — which
  would make hydra's inline check redundant and would need `apt`'s and `su`'s stale declarations
  corrected first — or delete the field. A `reduce-system-complexity` candidate, not a behaviour
  change.
- **`wordsIn` / `parseWordlist` duplication** — converge once this ships.
- **9 pre-existing `routerFs.ts` mutation survivors** and the **55 Dependabot advisories** (20 high,
  26 moderate, 9 low) both still stand.

---
*Delete this file on close-out; fold the as-built into `d2-credential-layer.md`.*
