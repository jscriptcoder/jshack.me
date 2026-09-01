# Plan: D9 — `node` scripting

**Branch**: `feat/d9-a-script-runs-the-tools` (slice 2a) — **cut 2026-09-01 off `main` @ cea7b5a3**
**Status**: Active — **slice 1 MERGED** as `cea7b5a3` (PR #475) at v0.196.0. **Slice 2a is planned
below and has no code yet.** Slices 2b, 3 and 4 remain unplanned.
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) → "D9 — resolved scope & decisions
(grill-me, 2026-09-01)", eleven locked decisions.

## Picking this up cold

1. Read the epic's D9 section — the eleven decisions and its "Deliberately NOT built" list.
   **Decision 5 carries an amendment dated 2026-09-01**; read the amendment, not just the table.
2. Read "Slice 1 — as built" below for what already exists and why it is shaped that way. Its
   acceptance criteria are closed; do not reopen them.
3. Read slice 2a top to bottom. **Its acceptance criteria are confirmed** — start at RED.
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
- `core/commands/types.ts` — `Command`, `CommandResult`, `CommandEnv`, `FlagSpec`.
- `core/shell/runLine.ts` — `prepareStage`, `collectStageOutput`, `hasTty`. Slice 2a is the script's
  version of the same three steps, and reuses two of them.
- Legacy `src/commands/node.ts` + `src/scripting/` are **reference only**. Their mechanism does not
  port (epic §"Forced rather than chosen"); read them for error wording and the shape of the
  problem, not for the design.

## Slice spine

| # | Slice | Observable | Status |
|---|-------|-----------|--------|
| 1 | a script runs and speaks | `node hello.js` prints; a broken one says so and exits 1 | **MERGED `cea7b5a3`, v0.196.0** |
| 2a | a script runs the tools | `await nmap(gw)` returns what the prompt shows; `ssh(…)` refuses | **planned below, no code** |
| 2b | a script speaks while it works | a sweep's `console.log` paints live; the spinner names `hydra`, not `node` | not planned |
| 3 | a script keeps what it found | `/root/sweep.js` chains `hydra` and captures to a file | not planned |
| 4 | a script is reusable and can be stopped | `process.argv`; Ctrl-C at every await; `sleep(ms)` | not planned |

The epic's slice 2 is **split into 2a and 2b** (owner decision, 2026-09-01). The call surface and
the liveness fix are separable and separately observable, and they fail differently: 2a is an
adapter plus a declared field across ten command modules, 2b is a producer/consumer streaming
bridge plus a new `CommandEnv` seam that reaches the UI. Flags stay **in** 2a — they are three lines
of the same `invoke()` loop and share every fixture, so splitting them would rewrite the function
2a just wrote. `withoutScript` also stays in 2a and cannot move: without it, 2a ships a script that
can call `ssh(…)` and produce exactly the lie decision 1 refuses.

Plan each later slice when its predecessor lands — D7 and D8 both found that later slices cost far
less than their plans assumed, because the seams they needed already generalized.

**No `api/` change in any slice, so the wire-check is `N/A` throughout** (epic §"Forced rather than
chosen"). The D9 close-out proof is a browser run targeting the beat the epic names: `ssh` into a
box already rooted, `apt install node` there, `nano` a script there, run it there.

---

## Slice 1 — as built (MERGED `cea7b5a3`, v0.196.0)

**What shipped**: `core/scripting/runScript.ts` (the pure host — block-wrapped `AsyncFunction` over
`(source, context)`), `core/scripting/format.ts` (the one value formatter), `core/scripting/console.ts`
(the injected `console`), `core/commands/node.ts`, and one registry entry. 19 behavior tests.

### The mechanism change it made — the epic's decision 5 carries the amendment

Decision 5 originally routed `console.log`/`error`/`debug` through `env.output`. **It does not.**
`env.output` appends straight to scrollback and bypasses the pipeline — `collectStageOutput` reads
`result.lines` — so `node sweep.js | grep OPEN` and `node sweep.js > out.txt` would both have seen
nothing, while real `node` pipes stdout like anything else. **A script's output is the `node`
command's own `CommandResult` lines.** The mapping is unchanged (`log`→`text`, `error`→`error`,
`debug`→`dim`); it is pipeable and redirectable for free. Verified in the browser: `>` captured
stdout while `debug`/`error` still printed, because only `text` pipes — real shell behaviour that
nobody wrote a line of code for.

Slice 1 returns `kind: 'sync'`. **Slice 2b** moves to `streamedResult`.

### Acceptance criteria — all met

AC-1 print + exit 0 · AC-2 space join, object→JSON, `string[]` one per line · AC-3 the three sinks
are distinct line kinds · AC-4 a top-level `const console = …` shadows rather than throwing
(the block wrap) · AC-5 **the execute bit is not consulted**, read permission is the whole gate ·
AC-6 the three file errors in `cat`'s house style, each exit 1 · AC-7 a throw keeps prior output,
reports `<ErrorName>: <message>`, exits 1 · AC-8 a syntax error the same way · AC-9 an empty script
is a no-op at exit 0 · AC-10 `await` works · AC-11 before install, the registry hint fires ·
AC-12 `man node` renders and `help` lists it under Filesystem.

### The three decisions worth not rediscovering

- **`console` is INJECTED, and that is the feature.** It is a real browser global, so a body that
  did not shadow it would send every `console.log` to devtools and leave the player watching an
  empty terminal.
- **The body runs inside a BLOCK.** Injected names are the sandbox function's own parameters, so a
  top-level `const console = …` would be a redeclaration `SyntaxError` that kills the script before
  its first line. Pinned with one name injected; **slice 2a is where it starts earning its keep**,
  with ~46 command names behind it.
- **No execute check, deliberately.** `nano` stamps `execute: ['root']` on everything a user writes
  and the game has no `chmod`, so an execute check would stop every non-root player running the
  script they just wrote. Proved live: `-rwxrw---- alice 48 mine.js` ran for a `user`-tier session.
  A reviewer will otherwise read the missing check as an oversight and "fix" it.

### Still true, and still forward-looking

**Browser globals other than `console` are not shadowed** (`fetch`, `localStorage`, `window`): a
player who reaches for them is doing it as deliberately as the accepted tab-hang, and a blocklist is
always incomplete. **This stops being true if Phase 3's `script_exec` ever runs a script one player
wrote inside another player's client** — that is the condition that reopens it.

### Evidence

Mutation: 105 mutants, **101 killed (96.2%)**. 16 of the 19 first-pass survivors were the manual
block — killed by asserting whole rendered `man node` lines, the way `man.test.ts` pins `ls`. Three
real `format.ts` gaps became tests of behaviour a player hits: a MIXED array (`['open', 22]` must be
JSON, not two lines) kills both `every`→`some` and `typeof`→`true`, and `console.log(undefined)`
must print `undefined` rather than a blank line. **The 4 accepted survivors are `tier` and the three
parts of `availability`** — declared-but-unenforced metadata with no runtime consumer anywhere in
`src/`; every command in the registry carries the same unkillable pair. Wire-check `N/A`. Browser
close-out passed on the AP gateway.

One E2E-harness note, not a product defect: the conventions §7 nano trap fired again — after `^X`
the "terminal is back" probe reported true **twice** while the editor was still open, so two shell
commands were typed into the buffer. **Do not discard `send.sh`'s typed-value echo** — it is the
only signal distinguishing "the command ran" from "the command was typed into a file".

---

## Slice 2a: a script calls the machine's commands and gets back what the prompt would show

**Value**: the capability the whole feature exists for. Today a script can only talk to itself —
it cannot reach a single tool on the box it is running on. After this, `await nmap(gateway)` hands
back the scan's stdout as a `string[]` carrying `.exitCode`, `hydra` and `curl` and `grep` are
callable the same way, and the commands that would lie about where the script is standing refuse
instead — in the same words the prompt would use.

**Path**: `node <path>` → registry gate → `env.fs.read` → **build the script context**: `console`
(slice 1) plus one adapter per registry command, keyed by the camelCase identifier derived from its
name → block-wrapped `AsyncFunction` → each `await <cmd>(…)`: split the trailing flags object,
coerce positionals, validate flags against the command's own `FlagSpec`, check `withoutScript` then
`withoutTty` **before** `execute` → `command.execute(env, args, flags)` → `collectStageOutput` →
stdout returns to the script as `string[]` + `.exitCode`, passthrough lines go onto `node`'s own
line collector → `CommandResult` → scrollback.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk. No stack — 2b starts after this lands, and conventions
§8 warns against stacking on a branch that will be squash-merged with `--delete-branch`.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness, not per increment.

**Reduction program**: `N/A`. **Transition/terminal evidence**: `N/A`.

### Four things the codebase already settles — do not redesign them

- **The registry back-edge is solved.** `help.ts:78` and `man.ts:93` reach the registry through a
  runtime `await import('./registry')` inside `execute`, precisely because `registry.ts` statically
  imports them. `node.ts` does the same. **No new `CommandEnv` field for the command set.**
- **`runScript.ts` does not change.** It is already pure over `(source, context)`. Slice 2a only
  builds a bigger context. The epic's `(source, env, commands)` phrasing describes the *caller*.
- **`collectStageOutput` (`runLine.ts:147`) already is the result adapter** — it drains an async
  result, splits `text` (stdout) from everything else, and returns the exit code. `hasTty`
  (`runLine.ts:74`) is the tty predicate. Both are private today; **export them rather than writing
  a second copy**, and do not invent a shared module to hold them until a third caller exists.
- **`prepareStage` (`runLine.ts:98`) is the ordering model**: found → flags bound → refusal, all
  before `execute`. Decision 2 requires exactly that order for the same reason `prepareStage` has
  it — `ssh` authenticates against the server and writes a real line into the target's `auth.log`
  before it returns, so a refusal that lands after `execute` has already happened.

### Decisions this plan made — CONFIRMED 2026-09-01

1. **The epic's slice 2 splits into 2a and 2b** (see the spine note above).
2. **`undefined` and `null` positionals throw; everything else coerces.** `nc(4444, {'-l': true})`
   sends `'4444'`; `cat(hosts[5])` on a short array throws `TypeError: cat() argument 1 is
   undefined` instead of asking the filesystem for a file called `undefined`. An out-of-range index
   is the commonest scripting bug, and the permissive form reports it as a *filesystem* error,
   pointing the player at the wrong thing. Real node's `execSync` throws `ERR_INVALID_ARG_TYPE` on
   the same input, and decision 7 already establishes the throwing posture for shell-level mistakes.

Two smaller calls recorded so they are not re-litigated:

- **Shell-originated errors print BARE, without node's `Error: ` prefix.** Decision 10 says a
  refusal "reads identically to a refusal at the prompt", and `apt --nope` at the prompt says
  `apt: unrecognized option: --nope`, not `Error: apt: …`. So refusals and flag-validation failures
  throw a `ShellError` that `node.ts` renders as its bare message; every other throw keeps slice 1's
  `describeScriptError` shape. `node` still exits **1** either way — the script died, and that is
  node's exit code, not the inner command's.
- **`env` passes through to inner commands untouched, `stdin` included.** `echo hi | node s.js`
  therefore lets the script's first stdin-reading command consume the pipe, exactly as real node
  inherits stdin to a child. It is single-use, so a second reader gets nothing — which is what an
  inherited fd does.

### Acceptance criteria — CONFIRM BEFORE ANY CODE

- [ ] **AC-1** A script running `await echo('hi')` gets back `['hi']` — the same stdout the prompt
      shows for `echo hi`. The value is an ordinary array: `.join`, `.filter`, `.map` all work.
- [ ] **AC-2** The returned array carries `.exitCode`: 0 for a command that succeeded, the
      command's own code when it failed (`cat` on a missing file → 1).
- [ ] **AC-3** **A nonzero exit does not throw.** The script keeps running and can branch on
      `.exitCode`. Only genuine JS errors, refusals and flag failures stop it.
- [ ] **AC-4** An inner command's `error` and `dim` lines reach the **terminal** and are **not** in
      the returned array, interleaved in the order they happened with the script's own
      `console.log`. This is decision 4's capture rule and the pipeline's stderr rule, agreeing.
- [ ] **AC-5** Hyphenated commands are reachable by their camelCase identifier — `redisCli`,
      `aircrackNg`, `airodumpNg`, `newGame` — and the raw hyphenated name is not a binding.
- [ ] **AC-6** Positional coercion: a number becomes its string (`nc(4444, {'-l': true})` listens
      on 4444); `undefined` and `null` throw `TypeError: <name>() argument <n> is undefined`.
- [ ] **AC-7** A trailing plain object is the flags map, with dashed keys, validated against the
      command's own `FlagSpec`: `apt('list', {'--installed': true})` works; `{'-p': 2222}` coerces
      to `'2222'`; an undeclared flag throws `<name>: unrecognized option: --nope`; `true` passed to
      a `'string'` flag and a string passed to a `'boolean'` flag each throw. The script bypasses
      `bindFlags`, so without this it would have a silent failure mode the prompt does not have.
- [ ] **AC-8** The ten `withoutScript` commands refuse — `ssh`, `su`, `nc` (connect form), `exit`,
      `reboot`, `nano`, `lynx`, `mysql`, `redis-cli`, `ftp` — throwing
      `<name>: cannot be run from a script`, printed bare, `node` exits 1, and everything the script
      printed first is kept. **The refusal happens before `execute`**: a refused `su` pushes no
      session and a refused `ssh` writes no `auth.log` line.
- [ ] **AC-9** `nc`'s exemption works both ways: `nc('10.0.0.5', 4444)` refuses, and
      `nc(4444, {'-l': true})` runs and returns `['Listening on 0.0.0.0 4444']`. This is the
      function form of `withoutScript`, decided against Phase 3's `script_exec` beat.
- [ ] **AC-10** `withoutTty` still applies from a script: in a session with no terminal behind it,
      `scp(…)` refuses with its own `withoutTty` string. `scp` is deliberately not in the
      `withoutScript` set, so this is the only thing standing between a pty-less session and a
      masked password prompt nobody can answer.
- [ ] **AC-11** A command whose binary is not installed answers `bash: nmap: command not found.
      Install with: apt install nmap` as an error line with `.exitCode === 127`, and the script
      continues — the same thing the prompt does, which is decision 8's invariant.
- [ ] **AC-12** A script may declare `const nmap = …` at its top level and it shadows the injected
      binding. Slice 1's block wrap, now carrying ~46 names.
- [ ] **AC-13** **Registry invariant**: every registered command name derives a JS identifier that
      is valid, unique across the registry, and not a reserved word. The day someone adds a command
      named `class`, every script in the game dies with a `SyntaxError` the player cannot read, so
      this is pinned in `registry.test.ts` beside the existing name/category invariants.
- [ ] **AC-14** `man node` documents the call surface this slice ships — that every command is
      callable, awaited, returns `string[]` with `.exitCode`, takes a trailing flags object with
      dashed keys, that spreading the array drops `.exitCode`, and that the pivot commands refuse —
      and names what is still missing (`fs`, `process.argv`, `sleep`).

### RED

Behavior tests in this order; each must fail for the right reason before any production change.

1. **`await echo('hi')` returns `['hi']`.** The sharpest RED: `echo is not defined`, a
   `ReferenceError` from the sandbox. `echo` is a shell builtin with no binary gate, so nothing but
   the missing binding can be the reason it fails.
2. **`.exitCode`** — success, then a failing `cat` for the nonzero case.
3. **Nonzero does not throw, and stderr is split** — assert the error line reached the result's
   lines and is *absent* from the array.
4. **camelCase bindings** — `redisCli` resolves; assert the raw name is not a binding.
5. **Coercion** — a number positional; `undefined` throws.
6. **Flags** — accepted and mapped, then the three throw cases.
7. **`withoutScript`** — the refusal wording and exit 1, **plus a no-side-effect assertion**
   (`su` pushed no session). A test that only checked the message would pass with the check moved
   after `execute`.
8. **`nc` both ways.**
9. **`withoutTty` from a script** in an `nc`-kind session.
10. **`command not found` inside a script**, exit 127, script continues.
11. **`const nmap = …` shadows.**
12. **The registry identifier invariant.**
13. **`man node`** — whole rendered lines, as slice 1's mutation gate established.

**Mutants to design against** (mutator rules, test design only — the harness runs once at PR
readiness):

- **Dropping the `withoutScript` check**, or **moving it after `execute`** → RED 7's side-effect
  assertion is the only thing that catches the second.
- **Returning every line instead of only `text`** → AC-4.
- **`.exitCode` hard-coded to 0** → AC-2's failing case.
- **Coercing `undefined` to `'undefined'`** → AC-6.
- **Skipping flag validation entirely** → AC-7's three cases.
- **`nc`'s function form always refusing, or never refusing** → AC-9 needs both directions.
- **The camelCase derivation returning the raw name** → this one is loud rather than subtle:
  `aircrack-ng` as a formal parameter is a `SyntaxError` that takes every script test down at once.
- **Throwing on a nonzero exit** → AC-3.

### GREEN — the minimum, in dependency order

1. **`core/commands/types.ts`** — `withoutScript?: string | ((args, flags) => string | undefined)`,
   with a doc comment carrying decision 2's argument (the value IS the refusal; the `nc` function
   form exists because the listen/connect split is already the first line of `nc`'s `execute`).
2. **Ten command modules** — one `withoutScript` line each; `nc`'s is the function.
3. **`core/shell/runLine.ts`** — export `collectStageOutput` and `hasTty`. No behaviour change.
4. **`core/scripting/commandContext.ts`** — the adapter. Derives the identifier, splits the trailing
   flags object, coerces positionals, validates flags, applies the two refusal gates, invokes, and
   shapes the result. Exports `ShellError`.
5. **`core/commands/node.ts`** — build the context (`console` + the commands), and render a
   `ShellError` as its bare message.
6. **`registry.test.ts`** — the identifier invariant.
7. **Version bump** to `0.197.0` in `v2/package.json` + `v2/package-lock.json`
   (`npm install --package-lock-only`).

### Two things GREEN must get right

**The returned value is an array with an extra property, not a wrapper object.**
`String.prototype.match` returns exactly this shape, so it is canonical JS rather than a trick, and
it is what makes `fs.writeFile(path, out)` work unchanged in slice 3. The cost — spreading the array
drops `.exitCode` — belongs in the manual (AC-14), not in a defensive mechanism.

**The refusal is checked before `execute`, and a test must be able to tell.** Assert a side effect
that did *not* happen, not just the message.

### REFACTOR

Assess only if it earns its place. The live candidate: after exporting `collectStageOutput` and
`hasTty`, `runLine.ts`'s `prepareStage` and the script adapter perform the same three steps in the
same order against different inputs. **Do not unify them speculatively** — the shapes genuinely
differ (tokens vs. JS values, a returned error vs. a thrown one) and the owner has pruned
speculative abstraction before. Revisit only if slice 2b or 3 produces a third caller.

### PRE-PR MUTATION

Run focused on `core/scripting/commandContext.ts` and `core/commands/node.ts`; `runLine.ts` changes
only its export keywords and `registry.ts` is a declaration list already covered by its invariant
test. Address valuable survivors and re-run within the same gate. Expect the manual page to dominate
the survivor count (conventions §4) and kill it the way slice 1 did — whole rendered `man node`
lines. Use a throwaway `vite.mutation.config.ts` + `stryker.mutation.json` and delete both after.

**RESULT 2026-09-01: 183 mutants, 177 killed (96.7%), 6 survivors, all accounted for.** First pass
killed 173. The prediction about the manual was wrong this time — only ONE manual mutant survived
(the new example's description), because slice 1's whole-rendered-line habit was already in the
test. Three real gaps became tests of behaviour a player hits:

- **A string value for a string flag.** `typeof value !== 'string'` → `typeof value !== ''` survived
  because every test passed `-p` a NUMBER (`{'-p': 2222}`), and the mutant only diverges on a
  string. `{'-p': 'ssh'}` is the commoner call of the two.
- **The tty rule's positive direction.** `!hasTty(…) && withoutTty !== undefined` → `||` survived
  because no test drove a `withoutTty` command from a script that HAD a terminal — which is exactly
  `scp`, deliberately not in the refusal set. The two conditions collapsed into `or` would refuse
  the one command the split exists to permit.
- The manual example's description line.

**Two survivors are accepted as equivalent, both hand-verified rather than argued:**

- **`tier: 'guest'` and the three parts of `availability` (4 mutants)** — declared-but-unenforced
  metadata with no runtime consumer anywhere in `src/`, the same unkillable pair slice 1 accepted
  and every command in the registry carries.
- **`SHELL_ERROR_NAME = 'ShellError'` → `''`** — the tag is written by `shellError` and read by
  `isShellError` through the same constant, so both sides move together. Hand-applied: suite stays
  green. A test asserting the tag would pin an implementation detail, not the behaviour, which is
  already covered by "a refusal prints bare and a JS throw prints prefixed".

**One reported survivor is a FALSE survivor and was hand-verified as a kill.** Line 185's
`ConditionalExpression → true` (the tty gate) is still reported Survived; applying it by hand takes
**10 tests red**. Same for line 106 → `true` on the first pass, which took 1 test red. This is the
`perTest` mis-attribution family §4 already records — the tests build their commands from
module-scope consts, so Stryker attributes the wrong tests to those lines. **Before believing a
survivor in this file, apply it by hand: a suite that goes red is a kill however the runner scored
it.**

⚠️ **`-c` IS `--concurrency`, NOT the config file.** The config file is a POSITIONAL argument:
`npx stryker run stryker.mutation.json --concurrency 4`. Getting this wrong is silent and expensive:
`-c stryker.mutation.json` sets concurrency to the filename, which fails validation with
`Config option "concurrency" must match pattern "^(100|[1-9]?[0-9])%$"` — an error that names the
wrong option and sends you off adjusting concurrency. Passing `--concurrency 4` then satisfies the
validator, the throwaway config is **never loaded**, and Stryker silently falls back to the
committed `stryker.config.json` and mutates all of `src/core` — **219 files, 15,975 mutants**
instead of 183. It ran 75 minutes at four pegged cores before being killed, and reads exactly like a
slow machine. The tell is the instrumenter's own line: `Instrumented 2 source file(s) with 183
mutant(s)` is right, `Instrumented 219` is not. **Check that line before letting a battery run.**
Correctly invoked, this battery takes **under a minute**.

**Wire-check: `N/A`.** No `api/` path changes. Every inner command is invoked through the same
`Command.execute` with the same `env` the prompt would have handed it, so anything that reaches a
server does so through a path already proven. Alternate evidence is the jsdom behaviour suite plus
AC-11 proving the availability gate through the real registry wrapper.

### Browser close-out

Smaller than slice 1's, because the beat the epic names belongs to slice 3. On the player's own
workstation, with `nmap` installed: a script that runs `await nmap(gateway)` and `console.log`s
what it found, proving the returned lines are the scan the prompt shows; then a script whose first
line is `await ssh('root@' + gateway, 'pw')`, proving the refusal reads like the prompt's and the
script stops there. Both are claims about ~46 real commands wired to a real registry, which is
exactly where a jsdom fixture could be lying.

### PR-ready when

AC-1…AC-14 met; `npm run typecheck` and `npm run lint` clean; the full non-watch test suite green;
the mutation gate closed or its survivors argued; the version bumped in both files; and the human
approves the commit.

**Slice complete when** its PR lands.

---
*Delete this file at D9 close-out and fold the durable rules into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md), as D3–D8 each did.*
