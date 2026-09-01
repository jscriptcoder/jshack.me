# Plan: D9 — `node` scripting

**Branch**: `feat/d9-a-script-runs-and-speaks` (slice 1) — **cut 2026-09-01 off `main` @ c3be1758**
**Status**: Active — **slice 1 is BUILT at v0.196.0: AC-1…AC-12 all met, typecheck and lint
clean, full suite green (4080 tests).** Still open before the PR: the pre-PR mutation gate and
the browser run. Slices 2-4 remain unplanned.
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) → "D9 — resolved scope & decisions
(grill-me, 2026-09-01)", eleven locked decisions.

## Picking this up cold

1. Read the epic's D9 section — the eleven decisions and its "Deliberately NOT built" list.
   **Decision 5 carries an amendment dated 2026-09-01**; read the amendment, not just the table.
2. Read slice 1 below, top to bottom. Its acceptance criteria are **already confirmed** — do not
   re-present them for approval.
3. The branch is cut and slice 1 is built and committed. What remains before its PR is the pre-PR
   mutation gate and the browser run — see "PRE-PR MUTATION" and "PR-ready when" below.
4. All commands run from `v2/`. Gates: `npm run typecheck`, `npm run lint`, the full non-watch test
   suite. Wait for commit approval before every commit.

## Goal

A player automates the game: they write JavaScript on a box, run it with `node`, and the script
drives the same commands they could type — capturing what it finds to a file — without ever
leaving the session it started in.

## Read before starting

- Epic §"D9 — resolved scope & decisions" — the eleven decisions, the five forced-rather-than-chosen
  entries, and the "Deliberately NOT built" list. **Do not re-litigate them here.**
- [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §2 (the camelCase-identifier
  rule for a scripting host, the no-single-letter rule) and §3 (the gates).
- `core/commands/types.ts` — `Command`, `CommandResult`, `CommandEnv`, `FsReadResult`. The whole
  slice lives against these.
- Legacy `src/commands/node.ts` + `src/scripting/` are **reference only**. Their mechanism does not
  port (epic §"Forced rather than chosen"); read them for the error wording and the shape of the
  problem, not for the design.

## Slice spine

| # | Slice | Observable | Status |
|---|-------|-----------|--------|
| 1 | a script runs and speaks | `node hello.js` prints; a broken one says so and exits 1 | **built, pre-PR** |
| 2 | a script runs the tools | `await nmap(…)` returns what the prompt shows; `ssh(…)` refuses | not planned |
| 3 | a script keeps what it found | `/root/sweep.js` chains `hydra` and captures to a file | not planned |
| 4 | a script is reusable and can be stopped | `process.argv`; Ctrl-C at every await; `sleep(ms)` | not planned |

Only slice 1 is planned in full. Plan each later slice when its predecessor lands — D7 and D8 both
found that later slices cost far less than their plans assumed, because the seams they needed
already generalized.

**No `api/` change in any slice, so the wire-check is `N/A` throughout** (epic §"Forced rather than
chosen"). The close-out proof is a browser run, targeting the beat the epic names: `ssh` into a
box already rooted, `apt install node` there, `nano` a script there, run it there.

---

## Slice 1: a player writes a JavaScript file, runs it with `node`, and sees what it printed

**Value**: The walking skeleton for every later slice, and it closes a promise the game already
makes and does not keep. `{ name: 'node' }` has been in `APT_PACKAGES` since the connectivity arc,
so `apt install node` today lays down a world-executable `/usr/bin/node`, lists it under
`apt list --installed` — and typing `node` answers `bash: node: command not found`, because no
command has ever been behind it.

**Path**: `node <path>` → registry lookup → `wrapWithBinaryCheck` (binary present + tier may
execute it) → `env.fs.read(path)` through the shared walker → the script host (block-wrapped
`AsyncFunction`, context `{ console }`) → each `console.*` call becomes a `TerminalLine` →
`CommandResult` → scrollback.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk. No stack — nothing later starts before this lands, and
conventions §8 warns against stacking on a branch that will be squash-merged with
`--delete-branch`.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness, not per increment.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### The one mechanism change this plan made — APPROVED 2026-09-01

Epic decision 5 originally routed `console.log`/`error`/`debug` through `env.output`. **It does
not.** `env.output` appends straight to scrollback and bypasses the pipeline — `collectStageOutput`
reads `result.lines` — so `node sweep.js | grep OPEN` and `node sweep.js > /root/out.txt` would
both see nothing, while real `node` pipes stdout like anything else.

**A script's output is the `node` command's own `CommandResult` lines.** The user-visible mapping is
unchanged (`log`→`text`, `error`→`error`, `debug`→`dim`); it is now pipeable and redirectable for
free. `env.output` is not used by this feature at all.

**Slice 1 therefore returns `kind: 'sync'`** — collect the lines, return them. Nothing in slice 1 is
slow (no commands, no `sleep`), so streaming buys nothing and would cost a ~25-line
producer/consumer bridge, because `console.log` is called from arbitrary depth inside the script and
cannot `yield`. **Slice 2 switches to `streamedResult` (`core/commands/streaming.ts`)** when
commands make liveness real; that is also where decision 4's live busy label lands. The epic's
decision 5 carries this amendment.

### Acceptance criteria — CONFIRMED 2026-09-01 before any code, ALL MET

- [x] **AC-1** On a box where `node` is installed, a file containing `console.log('hello')` run as
      `node /root/hello.js` puts `hello` in the terminal and exits **0**.
- [x] **AC-2** `console.log('host:', '10.0.0.5')` joins its arguments with a single space. An object
      argument renders as JSON, never `[object Object]`. An array of strings renders one element
      per line.
- [x] **AC-3** The three sinks are distinguishable: `console.log` is a `text` line, `console.error`
      an `error` line, `console.debug` a `dim` line.
- [x] **AC-4** A script may declare `const console = …` (or any injected name) at its top level and
      it **shadows** rather than throwing `Identifier 'console' has already been declared`. This is
      the block wrap, pinned here before slice 2 injects forty command names behind it.
- [x] **AC-5** **The execute bit is not consulted.** A file carrying the default permissions a
      `user` gets from `nano` — `read: ['root','user']`, `execute: ['root']` — runs for that user.
      A file the tier cannot **read** is refused: `node: /root/secret.js: Permission denied`,
      exit 1.
- [x] **AC-6** The three file errors match the house style `cat` sets, each exit 1:
      `node: missing file operand`; `node: <path>: No such file or directory`;
      `node: <path>: Is a directory`.
- [x] **AC-7** A script that throws reports `<ErrorName>: <message>` as an **error** line and exits
      **1**, and everything it printed before throwing is still there.
- [x] **AC-8** A script with a syntax error is reported the same way (`SyntaxError: …`, exit 1)
      rather than taking the terminal down.
- [x] **AC-9** An empty or whitespace-only script is a no-op: no output, exit **0**.
- [x] **AC-10** A script may `await` — `await Promise.resolve('x')` works — because there is one
      always-async mode, not a sync path that gets upgraded.
- [x] **AC-11** Before installation, `node hello.js` answers
      `bash: node: command not found. Install with: apt install node` — the hint the registry entry
      unlocks, which the bare not-found message could not give.
- [x] **AC-12** `man node` renders the manual and `help` lists `node` under `filesystem`. The manual
      is the whole discoverability story until the tutorial work lands (epic decision 11), so it
      carries the API surface this slice ships and names what later slices add.

### RED

Behavior tests, in this order — each must fail for the right reason before any production change:

1. **`console.log('hello')` reaches the terminal.** The sharpest RED: no `node` command exists, so
   the line is `command not found`. Assertions read the **returned `CommandResult.lines`**, not an
   `env.output` spy — that is the approved mechanism above, and it is what makes the pipe work.
2. **The three sinks** — assert the line KIND, not just the content.
3. **Formatting** — two arguments with a space; an object as JSON; a `string[]` one per line.
4. **The block wrap** — a script whose first statement is `const console = …`. Must use `const`;
   `var` would pass without the wrap and prove nothing.
5. **Permissions, both directions** — the default-perms file RUNS for a `user`; an unreadable one
   is refused.
6. **The three file errors + exit codes.**
7. **A throw**: prior output retained, error line, exit 1.
8. **A syntax error**: same shape.
9. **Empty script**: no output, exit 0.
10. **`await` works.**

**Mutants to design against** (from `mutation-testing`'s mutator rules — test design only; the
harness runs once at PR readiness):

- **Re-introducing the execute check** must fail AC-5. That is why AC-5 asserts the POSITIVE case
  against a file whose `execute` is explicitly `['root']` while the session is `user` — a test that
  only checked the read refusal would pass with the bug restored.
- **Swapping `error` for `text`** on the failure path must fail AC-3/AC-7 — so assert the sink.
- **Flipping any error's `exitCode` 1 → 0** must fail — so every error AC asserts its exit code.
- **Dropping the block wrap** must fail AC-4 — hence `const`, not `var`.
- **Joining `console.log` arguments with `''`** must fail AC-2 — hence a two-argument assertion.
- **The formatter falling back to `String(value)`** must fail AC-2's object case.
- **Returning exit 0 after a throw** must fail AC-7.

### GREEN — the minimum, in dependency order

1. **`core/scripting/format.ts`** — one formatter, shared with `fs` in slice 3: a `string` passes
   through, a `string[]` joins with a newline, anything else is JSON. The array rule is deliberate
   and is what makes `console.log(await hydra(…))` print captured output as lines in slice 2,
   rather than as a JSON array.
2. **`core/scripting/runScript.ts`** — the host. A pure function over `(source, context)`:
   block-wrap the source, build an `AsyncFunction` keyed by the context's own keys, await it,
   and return `{ ok: true } | { ok: false, error: unknown }`. It knows nothing about commands, the
   terminal, or `CommandEnv` — which is what lets Phase 3's `script_exec` reuse it instead of
   duplicating the sandbox the way legacy's `utils/remoteScriptRunner.ts` did.
3. **`core/scripting/console.ts`** — builds a `console` whose three methods format their arguments
   and push `TerminalLine`s onto a collector the caller owns. Slice 2 swaps that collector for the
   streamed emitter without touching this module's contract.
4. **`core/commands/node.ts`** — the `Command`: `tier: 'guest'`, `category: 'filesystem'`,
   `availability: { kind: 'installed-package', packageName: 'node' }`, the manual, and an `execute`
   that validates the operand, reads the file, runs the host, and maps the outcome to a
   `CommandResult`.
5. **`registry.ts`** — one import, one entry in `builtins`.
6. **Version bump** to `0.196.0` in `v2/package.json` + `v2/package-lock.json`
   (`npm install --package-lock-only`).

### Three things GREEN must get right

**`console` must be INJECTED, and that is the feature — not a convenience.** `console` is a real
browser global, so an `AsyncFunction` body that does not shadow it sends every `console.log`
to devtools and the player sees an empty terminal. The injection is what makes the script's output
the game's output.

**The block wrap is load-bearing from day one, though only one name is injected today.** Slice 2
injects a name per command, and that is when a player's `const cat = …` would start killing scripts
with a `SyntaxError` they cannot see. Pinning it here with AC-4 means slice 2 inherits it proven
rather than discovering it.

**Do not add the execute check, and say why in the code.** Its absence is epic decision 8 — real
`node` opens a script for reading, and v2 has no `chmod` to escape a default `execute: ['root']`.
A reviewer will otherwise read the missing check as an oversight and "fix" it, hard-blocking every
non-root player from running a script they just wrote.

### Deliberately not in slice 1

Command injection, the `withoutScript` refusals, the flags object, `fs`, `process.argv`, `sleep`,
Ctrl-C handling, and the live busy label — each belongs to the slice that first makes it
observable. **Browser globals other than `console` are not shadowed** (`fetch`, `localStorage`,
`window`): a player who reaches for them in their own script is doing it as deliberately as the
accepted tab-hang, and a blocklist is always incomplete. **This stops being true if Phase 3's
`script_exec` ever runs a script one player wrote inside another player's client** — record that
condition with the feature rather than discovering it there.

### REFACTOR

Assess only if it earns its place. The one live candidate: `cat.ts:30-34` maps the same three
`FsReadResult` errors to the same three messages, and `nano.ts:25-27` maps two of them. A shared
`fsReadError(command, target, error)` would serve three call sites — but `grep` quotes its target
(`grep: '<target>'`), so the family is not uniform and consolidating it may cost more clarity than
it buys. Decide with the code in front of you; the owner has pruned speculative abstraction before.

### PRE-PR MUTATION

Run focused on the changed production files: `core/scripting/format.ts`,
`core/scripting/runScript.ts`, `core/scripting/console.ts`, `core/commands/node.ts`. `registry.ts`
is a declaration list already covered by its invariant test. Address valuable survivors and re-run
within the same gate. Expect the manual page to dominate the survivor count — conventions §4:
*"a command's mutation score is mostly its manual."*

**RESULT 2026-09-01: 105 mutants, 101 killed (96.2%), 4 survivors accepted.** First pass killed 86
of 105. The prediction held exactly — 16 of the 19 survivors were the manual block, and none sat in
the executable half. Two rounds of killing:

- **The manual (16).** Killed by asserting whole rendered `man node` LINES rather than words of
  them, the way `man.test.ts` pins `ls` — the NAME line, the argument and its description, and
  both examples with their descriptions. Not a ceremony: the manual is the whole discoverability
  story for scripting until the tutorials land, so what the player reads is worth pinning.
- **`format.ts` (3).** These were real gaps, and each became a test of behavior a player will hit:
  `every` → `some` and `typeof element === 'string'` → `true` both survived because no test used a
  MIXED array (`['open', 22]` must be JSON, not two lines), and the `JSON.stringify` fallback
  survived because nothing printed a value JSON has no answer for (`console.log(undefined)` must
  print `undefined`, not a blank line).

**The 4 accepted survivors are `tier: 'guest'` and the three parts of
`availability: { kind: 'installed-package', packageName: 'node' }`** — declared-but-unenforced
metadata. Neither field has a runtime consumer anywhere in `src/` (`.tier` matches only unrelated
code; `.availability` only `daemon.ts` forwarding it), because the real gate is
`wrapWithBinaryCheck` reading the live filesystem, which AC-11 covers. `types.ts` already records
this about `AvailabilityRule`: *"a field nobody had to fill in is a field that can be declared
without being enforced."* Every command in the registry carries the same unkillable pair; a test
asserting the literal back would pin a field nothing reads.

Run with a throwaway `vite.mutation.config.ts` + `stryker.mutation.json` (both deleted after, per
conventions §4 — their `include`/`mutate` lists are per-slice and would rot): the narrowed
`include` made the dry run 17 tests in 3s instead of 4080, and each battery finished in ~32s.

**Wire-check: `N/A`.** No `api/` path changes. The host is pure client, `env.fs.read` is a local
walker read, and nothing in this slice reaches a server. Alternate evidence is the jsdom behavior
suite plus AC-11 proving the availability gate through the real registry wrapper.

### PR-ready when

AC-1…AC-12 met; `npm run typecheck` and `npm run lint` clean; the full non-watch test suite green;
the mutation gate closed or its survivors argued; the version bumped in both files; and the human
approves the commit.

**Slice complete when** its PR lands.

---
*Delete this file at D9 close-out and fold the durable rules into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md), as D3–D8 each did.*
