# Plan: D9 — `node` scripting

**Branch**: none open — cut the next one off `main`.
**Status**: Active — **slices 1, 2a and 2b are all MERGED and fully evidenced below**: `cea7b5a3`
(PR #475) at v0.196.0, `eee52ddf` (PR #476) at v0.197.0, `75d3af09` (PR #477) at v0.198.0.
**Slice 3 is the next work**: groundwork is gathered at the bottom of this file but it is NOT
planned and its decisions are NOT locked. Slice 4 is untouched.
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) → "D9 — resolved scope & decisions
(grill-me, 2026-09-01)", eleven locked decisions.

## Picking this up cold

1. Read the epic's D9 section — the eleven decisions and its "Deliberately NOT built" list.
   **Decision 5 carries an amendment dated 2026-09-01**; read the amendment, not just the table.
2. Read "Slice 1 — as built" below for what already exists and why it is shaped that way. Its
   acceptance criteria are closed; do not reopen them.
3. Slices 1, 2a and 2b are merged; read them for what exists and why, not as work to do. **Start at
   "Slice 3 — groundwork" at the BOTTOM of this file** — it lists what the codebase already settles
   and the open questions to resolve before planning.
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
| 2a | a script runs the tools | `await nmap(gw)` returns what the prompt shows; `ssh(…)` refuses | **MERGED `eee52ddf`, v0.197.0** |
| 2b | a script speaks while it works | a sweep's `console.log` paints live; the spinner names `hydra`, not `node` | **MERGED `75d3af09`, v0.198.0** |
| 3 | a script keeps what it found | `/root/sweep.js` chains `hydra` and captures to a file | **NEXT — groundwork below, not planned** |
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

## Slice 2a — as built (MERGED `eee52ddf`, v0.197.0)

*A script calls the machine's commands and gets back what the prompt would show.*

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

### Acceptance criteria — confirmed before any code, ALL MET

- [x] **AC-1** A script running `await echo('hi')` gets back `['hi']` — the same stdout the prompt
      shows for `echo hi`. The value is an ordinary array: `.join`, `.filter`, `.map` all work.
- [x] **AC-2** The returned array carries `.exitCode`: 0 for a command that succeeded, the
      command's own code when it failed (`cat` on a missing file → 1).
- [x] **AC-3** **A nonzero exit does not throw.** The script keeps running and can branch on
      `.exitCode`. Only genuine JS errors, refusals and flag failures stop it.
- [x] **AC-4** An inner command's `error` and `dim` lines reach the **terminal** and are **not** in
      the returned array, interleaved in the order they happened with the script's own
      `console.log`. This is decision 4's capture rule and the pipeline's stderr rule, agreeing.
- [x] **AC-5** Hyphenated commands are reachable by their camelCase identifier — `redisCli`,
      `aircrackNg`, `airodumpNg`, `newGame` — and the raw hyphenated name is not a binding.
- [x] **AC-6** Positional coercion: a number becomes its string (`nc(4444, {'-l': true})` listens
      on 4444); `undefined` and `null` throw `TypeError: <name>() argument <n> is undefined`.
- [x] **AC-7** A trailing plain object is the flags map, with dashed keys, validated against the
      command's own `FlagSpec`: `apt('list', {'--installed': true})` works; `{'-p': 2222}` coerces
      to `'2222'`; an undeclared flag throws `<name>: unrecognized option: --nope`; `true` passed to
      a `'string'` flag and a string passed to a `'boolean'` flag each throw. The script bypasses
      `bindFlags`, so without this it would have a silent failure mode the prompt does not have.
- [x] **AC-8** The ten `withoutScript` commands refuse — `ssh`, `su`, `nc` (connect form), `exit`,
      `reboot`, `nano`, `lynx`, `mysql`, `redis-cli`, `ftp` — throwing
      `<name>: cannot be run from a script`, printed bare, `node` exits 1, and everything the script
      printed first is kept. **The refusal happens before `execute`**: a refused `su` pushes no
      session and a refused `ssh` writes no `auth.log` line.
- [x] **AC-9** `nc`'s exemption works both ways: `nc('10.0.0.5', 4444)` refuses, and
      `nc(4444, {'-l': true})` runs and returns `['Listening on 0.0.0.0 4444']`. This is the
      function form of `withoutScript`, decided against Phase 3's `script_exec` beat.
- [x] **AC-10** `withoutTty` still applies from a script: in a session with no terminal behind it,
      `scp(…)` refuses with its own `withoutTty` string. `scp` is deliberately not in the
      `withoutScript` set, so this is the only thing standing between a pty-less session and a
      masked password prompt nobody can answer.
- [x] **AC-11** A command whose binary is not installed answers `bash: nmap: command not found.
      Install with: apt install nmap` as an error line with `.exitCode === 127`, and the script
      continues — the same thing the prompt does, which is decision 8's invariant.
- [x] **AC-12** A script may declare `const nmap = …` at its top level and it shadows the injected
      binding. Slice 1's block wrap, now carrying ~46 names.
- [x] **AC-13** **Registry invariant**: every registered command name derives a JS identifier that
      is valid, unique across the registry, and not a reserved word. The day someone adds a command
      named `class`, every script in the game dies with a `SyntaxError` the player cannot read, so
      this is pinned in `registry.test.ts` beside the existing name/category invariants.
- [x] **AC-14** `man node` documents the call surface this slice ships — that every command is
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

**RUN 2026-09-01 at v0.197.0 — PASSED.** Fresh player → `aircrack-ng` on `WEYLAND-NET` →
`nmcli connect` (192.168.139.27, gateway `.1`) → `su root` → `apt install nmap` + `apt install node`
→ `nano sweep.js` → `node sweep.js`. Four things held that no unit test can claim:

- **A script's `nmap` output is byte-identical to the prompt's.** Ran `nmap 192.168.139.1` at the
  prompt first as a control, then `const out = await nmap('192.168.139.1')` from a script.
  **Watch the count**: the script reported `lines:10` against a control that *looks* like 7 lines,
  which reads like a defect and is not. `JSON.stringify(out)` settles it — the array is
  `["Starting Nmap scan — …","","Nmap scan report for router01 (…)","Host is up.","","PORT     STATE
  SERVICE","22/tcp   open  ssh","161/udp  open  snmp","","Nmap done — 1 host up"]`: seven content
  lines plus **nmap's own three blank spacer lines**, which the DOM collapses in `innerText` for the
  typed command too. Count what a command EMITS, not what the page renders.
- **`out.filter(…)` works** — `console.debug('open: ' + out.filter(…).length)` printed `open: 2`,
  so the array-with-a-property really is an ordinary array to a player.
- **The refusal reads like the prompt's.** `node hop.js` printed `before the hop`, then
  `ssh: cannot be run from a script` **bare — no `Error:` prefix** — and the line after the `ssh`
  call never ran.
- **The availability gate reaches inside a script.** `await hydra(…)` on a box without hydra
  answered `bash: hydra: command not found. Install with: apt install hydra` and the script carried
  on to print `exit=127`. That is decision 8's invariant proved on a real box: a script does what
  the player could type, and nothing more.

Three sinks render distinctly, confirmed by computed style rather than by eye — `console.log` and
the captured command output share the plain text colour `rgb(245,158,11)`, `console.debug` carries
`text-[var(--theme-text-dim)]`, the refusal carries `text-[var(--theme-error)]`.

Two harness notes, neither a product defect:

- **`echo $?` is not a thing here** — the shell has no variable expansion, so it echoes `exit=$?`
  literally. A script's exit code is not observable in-game; the jsdom suite is what pins it.
- **The §7 nano trap fired again, and the reconfirm is what caught it.** After `^X` the
  "terminal is back" probe returned `true` on its FIRST check and then `false` twenty-four times
  running — the editor had never closed. Polling once would have typed the next shell command into
  the buffer. `^X` also needed two attempts on three of four files even with a real `click`
  immediately before the chord. **Poll for the terminal's return, then reconfirm after a pause, and
  treat a lone `true` as noise.**

### PR-ready when

AC-1…AC-14 met; `npm run typecheck` and `npm run lint` clean; the full non-watch test suite green;
the mutation gate closed or its survivors argued; the version bumped in both files; and the human
approves the commit.

**Slice complete when** its PR lands. **LANDED** as `eee52ddf` (PR #476), 2026-09-01.

---

## Slice 2b — as built (MERGED `75d3af09`, v0.198.0)

*A sweep's output paints as it happens, and the busy bar names the tool that is actually running.*

**Value**: after 2a a script is SILENT for its whole run. `node` returns `kind: 'sync'`, so nothing
reaches the screen until the last line of the script has executed, and the busy bar reads `node`
from start to finish. A sweep over eight hosts shows a spinner and nothing else — the player cannot
tell a working script from a hung one. After 2b the script's own `console.log` paints as it is
called, an inner command's stderr paints as it arrives, and the bar names `hydra` while hydra is
cracking.

**Path**: `node <path>` → registry gate → `env.fs.read` → **open a line stream** → build the script
context, with `console` and every command adapter pushing into that stream instead of an array →
`streamedResult` over a generator that drains the stream → the script runs; each push is pulled and
`state.ts`'s async arm appends it to scrollback immediately → each `await <cmd>(…)` calls
`env.setChildCommand(name)` before `execute` and `null` in a `finally` → the script settles → the
stream closes and the generator returns the exit code.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk. No stack.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness, not per increment.

**Reduction program**: `N/A`. **Transition/terminal evidence**: `N/A`.

### Be precise about what becomes live — decision 4 is CAPTURE, not print

Three things become live and no more:

1. the script's own `console.log` / `error` / `debug`;
2. an inner command's `error` and `dim` passthrough (2a already routes these correctly and in the
   right ORDER — only their TIMING is deferred to the end);
3. the busy label.

**An inner command's STDOUT still never paints.** `await nmap(gw)` hands the scan back to the script
and shows nothing, because that is what capture means — the script decides whether to print it. A
reader who expects the scan to appear has misread decision 4, and AC-3 exists to stop a future
change "fixing" it.

### Five things the codebase already settles — do not redesign them

- **The UI already paints a streamed command line by line.** `state.ts:1668` is
  `for await (const streamed of result.lines) setScrollback(…)`. Switching `node` to `kind: 'async'`
  buys liveness for the script's console AND the inner passthrough in one move — there is no UI
  rendering work in this slice.
- **A UI-owned seam on `CommandEnv` is an established family, not a new question.** `setCwd`,
  `setInterface`, `pushSession`, `popSession` and `resetGame` are all documented "the UI owns the
  signal; commands call this"; `resetGame`'s comment says outright that "`core/` only knows there's
  a trigger". The busy label is the sixth member. **This is not an architecture decision to reopen.**
- **`buildCommandEnv` has two default conventions and the label wants the softer one.**
  `notWired(name)` throws for a seam whose absence is a bug (`resetGame`, `su.elevate`);
  `?? (() => undefined)` is for a benign one (`scp.end`, "fire-and-forget"). A cosmetic label must
  not make an unwired test env throw, so it takes the benign default.
- **Ctrl-C already reaches a streamed command and already has a rendering.** `state.ts:1671` catches
  the abort, prints `^C`, and keeps the partial output. `node` inherits that path by becoming async.
- **`collectStageOutput` drains `kind: 'async'` fully** (`runLine.ts:158`), so pipes and redirects
  keep working with no change — and correctly do NOT paint live, because a piped command's stdout
  belongs to the next stage, not the screen.

### One thing 2a shipped that this slice makes true

`man node` already tells the player *"Anything the command writes to stderr goes to the terminal as
it happens."* Today that is true in ORDER and false in TIMING — it arrives at the end with
everything else. 2b makes the sentence honest. **No manual rewrite is expected in this slice**; if
the browser close-out finds the page claiming anything else that is still deferred, fix it there.

### Decisions this slice made — CONFIRMED 2026-09-01

1. **The seam is `setChildCommand: (name: string | null) => void`, and `null` means "no child".**
   The UI resolves the label as `childCommand() ?? runningCommand()`, so `core/` never has to know
   or hardcode the string `'node'` — "what this line is called" stays in `commandNameOf`, where it
   already lives. The alternative (core pushes the literal `'node'` back) matches `setCwd`'s dumber
   shape but puts a command's own name inside the adapter that calls OTHER commands, and it breaks
   silently the day a second command hosts children.
2. **The label restores between calls** (owner-confirmed). While the script filters results, the bar
   says `node`, because no scan is in flight. The cost is accepted: a tight sweep flickers
   `node`→`nmap`→`node` per host, and that flicker is a truthful picture of what the script is doing.
3. **`node` is ALWAYS streamed — no sync path is kept.** A script that calls nothing still returns
   `kind: 'async'`. One path has no second branch to disagree with the first, and the async arm is
   already correct for a zero-line script.
4. **Passthrough paints as it arrives, and ORDER survives by construction.** Everything — the
   script's console and every inner command's passthrough — is pushed into ONE queue, so paint order
   IS push order. 2a's ordering guarantee is not re-derived; it is the same guarantee, unbuffered.

### Acceptance criteria — CONFIRMED before any code (owner, 2026-09-01)

- [x] **AC-1** A script's `console.log` reaches the terminal BEFORE the script finishes: given
      `log('first')`, then an inner call that has not resolved, `'first'` is already available from
      `node`'s result stream. Today nothing is available until the last statement runs.
- [x] **AC-2** An inner command's `error`/`dim` passthrough paints as it arrives, still interleaved
      with the script's own console output in the exact order the calls happened.
- [x] **AC-3** An inner command's STDOUT is still **not** painted — `await nmap(gw)` with the result
      discarded shows nothing on screen, and the same lines are still what the call returned.
- [x] **AC-4** While an inner command runs, the busy label is that command's name: during
      `await hydra(…)` the label is `hydra`, and it is set **before** `execute` is called, not after
      it returns.
- [x] **AC-5** When the inner command returns, the label goes back to `node` for as long as the
      script does its own work, and to the next inner name on the next call.
- [x] **AC-6** A script that throws **inside** an inner call does not leave the bar stuck on that
      command — the label is released on the failing path too.
- [x] **AC-7** Pipes and redirects are unchanged: `node s.js | grep OPEN` and `node s.js > out.txt`
      capture exactly the stdout 2a captured, with the same exit code, and nothing paints live
      because a piped stage's output is not the screen's.
- [x] **AC-8** The exit code survives the stream — 0 for a clean run, 1 for a throw or a refusal —
      with everything printed before the failure kept and the error line last. This is slice 1's
      AC-7 and 2a's AC-8 re-proved through the new mechanism.
- [x] **AC-9** A script that calls no command at all still runs, prints and exits 0 through the same
      streamed path.
- [x] **AC-10** A refusal still prints bare and still stops the script (2a AC-8, through the stream).
- [x] **AC-11** **CORRECTED while building — there is no `^C`, and this slice does not add one.**
      The original wording claimed Ctrl-C would read like it does for `airodump-ng`. It does not, and
      never did: `node`'s stream cannot reject, because `runScript` is total and so the script's
      promise always resolves — which means the UI's abort `catch` never fires for a script. What
      actually happens is that an aborted inner `env.sleep` rejects with `signal.reason` (an
      `AbortError` DOMException), the script sees an ordinary throw, and `node` reports
      `AbortError: …` and exits 1, keeping everything printed before it. That is **unchanged from
      2a** — 2b neither improves nor regresses it. **Slice 4 owns making an interrupt read like an
      interrupt** (it already owns "Ctrl-C at every await"), and a script spinning in pure JS remains
      the accepted tab-hang slice 1 recorded, which `sleep(ms)` is what finally gives a yield point.

### Found while building — three things that changed the shape of the work

**AC-2 and AC-3 never went RED.** One queue delivered the passthrough's timing along with AC-1, and
capture-not-print was already true from 2a. Both are in as guard tests rather than as increments,
because a fast path added later for the script's own voice is exactly what would break them. The
plan predicted this ("ORDER survives by construction"); it is recorded so nobody reads those two
tests as evidence of work that was done.

**The live passthrough split was NOT built, on evidence.** `collectStageOutput` batches an inner
command's stderr until that command finishes, which looked like a gap against AC-2. It is not: every
streamed command that emits a passthrough line — `apt:244`, `daemon:167/184`, `systemctl:197`,
`scp:394` — does `yield errorLine(...); return N;`. The line is always the last thing before the
generator returns, so batching is INDISTINGUISHABLE from live and no test could tell the two apart.
Building it would have been structure nobody can observe. **What reopens this**: a streamed command
that emits passthrough and then keeps going.

**A read error stays `kind: 'sync'`.** `node missing.js` never opens a stream, because no script
ran — it is a pre-flight failure like `command not found`, not a script that produced nothing.
Decision 3's "always streamed" is about scripts.

### RED — the order it was driven in

Each failed for the right reason before any production change. **Only 1 and 4-6 actually went
red**; see "Found while building" for why 2 and 3 were green on arrival.

1. **A line is available before the script finishes.** Script logs, then awaits a test-double
   command whose `execute` returns a promise the test controls. Pull ONE line from the result's
   iterator with the gate still closed; assert it is the logged line. Fails today because the result
   is `kind: 'sync'` and there is no iterator to pull. **This is the assertion the whole slice
   turns on** — a bridge that collects everything and yields at the end passes every other test here.
2. **Interleaving, live and in order** — log, then a command emitting an error line, then log again;
   assert `a, err, b` and that `a` arrived before the script completed.
3. **Inner stdout does not paint** — the guard on decision 4.
4. **The label names the inner command, set before `execute`** — a recording seam plus an ordering
   assertion, not just a value assertion.
5. **The label restores to `null` after the call returns**, and does so AFTER `execute` resolved.
6. **The label is released when the inner call throws.**
7. **Pipe/redirect regression** through `collectStageOutput`: same stdout, same exit code as 2a.
8. **Throw mid-script**: prior output kept, error line last, exit 1.
9. **A script that calls nothing** streams and exits 0.
10. **A refusal still prints bare and stops the script.**

**Mutants to design against** (test design only — the harness runs once at PR readiness):

- **The bridge collecting everything and yielding at the end.** Behaviourally identical to 2a and
  invisible to every test except RED 1. This is the slice's signature mutant.
- **`setChildCommand(null)` moved before `execute` instead of after** → RED 5's ordering assertion.
- **The restore not in a `finally`** → RED 6.
- **The restore dropped entirely** → RED 5.
- **Inner stdout pushed into the queue** → RED 3.
- **The exit code hard-coded to 0** — `streamedResult` exists precisely because a `for await` throws
  a generator's return value away (see `streaming.ts`'s own comment), so this is the documented trap
  → RED 8.
- **A settle condition that closes the stream before the queue drains** → the last `console.log`
  before a throw disappears; RED 8 asserts prior output is kept.
- **A settle condition that never closes** → a hang rather than a wrong answer; keep RED 9 cheap so
  a hang is obvious.

### GREEN — what shipped, in dependency order

1. **`core/scripting/lineStream.ts`** — the producer/consumer bridge. `emit(line)` pushes,
   `close()` ends it, `lines` is an `AsyncGenerator<TerminalLine, void>` that drains the queue and
   awaits the next push. ~25-30 lines. Lives in `core/scripting/` and NOT in
   `core/commands/streaming.ts`: `streamedResult` is the convention for a command narrating its own
   steps, this is a bridge for output arriving from arbitrary depth, and there is one caller.
2. **`core/commands/types.ts`** — `setChildCommand`, with a doc comment in the family's house style:
   the UI owns the signal, `null` means no child is running and the UI falls back to the submitted
   line's own name.
3. **`core/scripting/commandContext.ts`** — `env.setChildCommand(command.name)` before `execute`,
   `null` in a `finally`. Note the refusal gates run BEFORE this: a refused `ssh` must not flash a
   label for a command that never ran.
4. **`core/commands/node.ts`** — replace the `lines` array with the stream, return `streamedResult`
   over a generator that yields the drained lines and returns the exit code. The two exits (clean and
   thrown) both go through it.
5. **`ui/env.ts`** — `onChildCommand?: (name: string | null) => void` on the args type, wired as
   `setChildCommand: args.onChildCommand ?? (() => undefined)`.
6. **`ui/state.ts`** — a `childCommand` signal, wired into `buildCommandEnv`, cleared in the same
   `finally` that clears `runningCommand`; `Terminal.tsx`'s `busyLabel` resolves
   `childCommand() ?? runningCommand()`.
7. **Version bump** to `0.198.0` in `v2/package.json` + `v2/package-lock.json`
   (`npm install --package-lock-only`).

### Three things GREEN had to get right

**One queue, and push order is paint order.** That single fact is the whole of AC-2. Two queues, or
a fast path that bypasses the queue for console output, and the ordering guarantee 2a established
quietly breaks.

**The settle condition is "the script has settled AND the queue is empty".** Closing on the script's
promise alone loses whatever was logged in the same tick as a throw — which is exactly the output a
player needs most when their script died.

**The label restore is a `finally`, and the seam is called after the refusal gates.** A throw from
`execute` must still release the bar, and a refused command must never have claimed it.

### REFACTOR

Assess only if it earns its place. The standing candidate from 2a is unchanged: `prepareStage` and
the script adapter still perform the same three steps in a different shape, and unifying them is
still speculative. **The new candidate to resist**: moving `lineStream` next to `streamedResult`
because they both say "async". They serve different callers and one of them has exactly one. Revisit
if slice 3 or 4 produces a second.

### PRE-PR MUTATION

Run focused on `core/scripting/lineStream.ts`, `core/scripting/commandContext.ts` and
`core/commands/node.ts`. `ui/` is not in the mutate set. Expect a small battery — no manual rewrite
is planned, and the manual block dominated slice 1's survivor count.

⚠️ **Re-read the `-c` warning in slice 2a's mutation section before invoking Stryker.** The config
file is a POSITIONAL argument: `npx stryker run stryker.mutation.json --concurrency 4`. Check the
instrumenter's own line says `Instrumented 3 source file(s)` and not `Instrumented 219` before
letting it run.

⚠️ **Apply any survivor in `commandContext.ts` by hand before believing it.** Slice 2a had two false
survivors in that file from `perTest` mis-attribution (conventions §4) — one took ten tests red when
applied manually. A suite that goes red is a kill however the runner scored it.

**RESULT 2026-09-01: 199 mutants, 190 killed + 3 timeout = 193 detected (97.0%), 6 survivors, all
accounted for and ZERO real test gaps.** The battery ran in about two minutes at concurrency 4, with
the instrumenter reporting the expected `Instrumented 3 source file(s)`.

**The one thing the gate actually changed was `lineStream.ts`, and it found a bug in the fix.** The
first pass left two survivors there, both tracing to the same cause: the drain read
`queue.shift()` and then guarded `if (next === undefined) break`, a branch that exists only to avoid
a non-null assertion and that `while (queue.length > 0)` makes unreachable. Unreachable code cannot
be mutated detectably, so the pair was a smell rather than an equivalence to accept. Rewriting the
drain to `queue.splice(0)` removes the guard — and **broke five tests**, which is the valuable part:
a line pushed WHILE a batch is being yielded arrives after the snapshot, so draining once and then
checking `closed` drops it. The per-iteration re-check was load-bearing and nothing had said so. The
shipped form keeps both — `while (queue.length > 0) { for (const next of queue.splice(0)) … }` — and
carries the reason in a comment. Both survivors are gone and the re-check is now killed.

**Six survivors remain, none of them a gap:**

- **`tier: 'guest'` and the three parts of `availability` (4 mutants, `node.ts:110-111`)** — the same
  family slices 1 and 2a accepted, and re-confirmed independently this time rather than cited.
  Applying `availability: {}` by hand leaves the FULL 4113-test suite green, and the reason is
  visible in `availability.ts`: `wrapWithBinaryCheck` gates on `resolveBinary(env, command.name)` —
  by NAME — so the declared availability is never consulted. `grep -rn "\.availability" src/` finds
  exactly one non-test reference, `daemon.ts:198`, which copies it rather than reading it.
- **`SHELL_ERROR_NAME = 'ShellError'` → `''` (`commandContext.ts:53`)** — equivalent for the reason
  2a recorded: the tag is written by `shellError` and read by `isShellError` through the same
  constant, so both sides move together.
- **`commandContext.ts:185` `ConditionalExpression → true` (the tty gate)** — reported Survived,
  **hand-applied it takes 16 tests red**. The `perTest` mis-attribution family again, in the same
  file and on the same line as in 2a. The rule above earns its place a second time.

**Wire-check: `N/A`.** No `api/` path changes.

### Browser close-out

The claim is about timing, and timing is the one thing a jsdom test proves least convincingly.
On the player's own workstation with `nmap` installed: a script that logs a banner, sweeps three
hosts in a loop with a `console.log` per host, and logs a summary.

- **Lines appear one at a time** as each host is scanned, not all at once at the end.
- **The busy bar reads `nmap` during each scan and `node` between them.**

Both are transient, and skill §2 is explicit that a single `eval` costs 1-2s and will miss them.
**Drive and observe inside one async IIFE that polls** — dispatch the command, then sample
`document.body.innerText` and the busy label every 100ms into an array, and return the samples. A
sample series showing the label changing `node`→`nmap`→`node` is the evidence; a screenshot is not.

**RUN 2026-09-01 at v0.198.0 — PASSED.** Fresh player → `aircrack-ng` on `TYRELL-CORP` →
`nmcli connect` (192.168.102.31, gateway `.1`) → `su root` → `apt install nmap` + `apt install node`
→ `nano sweep.js` → `node sweep.js`, sampling the busy label and the printed-line count together.

- **Output paints as it is produced.** The line count climbed `@2 → @3 → @4` across the run rather
  than jumping to its total at the end, which is the before/after of this whole slice.
- **The bar named the scan, not the script.** It read `nmap...` while the submitted line was
  `node sweep.js`. Before 2b it would have read `node...` for the entire sweep.
- **An inner command's stdout still never painted**, on a real box with a real registry: the
  transcript holds only the script's own five lines (`sweep starting`, three host lines, the
  summary) and not one line of nmap's three scan reports, which the script had captured and counted
  (`-> 2 open`, `-> 1 open`, `-> 0 open`). Decision 4's capture rule, proved outside jsdom.
- **The pipe still pipes.** `node sweep.js | grep open` dropped `sweep starting` and passed the four
  matching lines, so a streamed `node` feeds a next stage exactly as the collected one did.

⚠️ **A back-to-back sweep NEVER shows `node` between calls, and that is CORRECT — do not read it as
a broken restore.** The first run's sample series was `nmap... → nmap... → nmap... → PROMPT` with no
`node` anywhere, which looks exactly like a missing release. It is not: the gap between one `nmap`
returning and the next starting is sub-millisecond, both signal writes land in the same tick, and
Solid renders once — so there is no interval to paint. **An interval of zero length cannot be
sampled at any rate**, and chasing it with a faster poller is wasted time.

To see the restore you need a script that genuinely does something of its own between calls. A
second script — `nmap`, then `await new Promise((resolve) => setTimeout(resolve, 1200))`, then
`nmap` — sampled at 50ms gives the series the AC asks for:

    nmap... @2  ->  node... @3  ->  nmap... @4  ->  PROMPT @5

`setTimeout` is reachable from a script because only `console` is shadowed (slice 1's recorded
position), which is what makes this probe possible before slice 4 ships `sleep(ms)`.

**Harness note, not a product defect:** §7's `^X` trap fired once more — the second file needed two
attempts even with a real `click` immediately before the chord. The reconfirm-after-a-pause rule
caught it both times and nothing was typed into a buffer.

### Shipped

AC-1…AC-10 met and AC-11 corrected; typecheck and lint clean; **4113 tests green across 191 files**;
mutation **193/199 detected (97.0%)**; wire-check `N/A`; browser close-out passed at v0.198.0.
**LANDED** as `75d3af09` (PR #477), 2026-09-01, squash-merged with the branch deleted.

---

## Slice 3 — groundwork, gathered but NOT yet planned

Facts established while building 2b, recorded so slice 3's planning starts from them rather than
rediscovering them. **This is not a plan** — no acceptance criteria are confirmed and no decisions
are locked. Resolve the open questions first.

**What slice 3 is for.** The epic's row: *`fs.readFile` / `writeFile` / `appendFile` + the shared
stringify*, with its own acceptance being that `/root/sweep.js` chains `hydra` across hosts and
**captures the results to a file**. Today a script can find things and say them, and that is all —
close the terminal and the sweep is gone. `man node` currently ends with "Scripts cannot yet read
and write files, take arguments of their own, or sleep"; slice 3 deletes the first clause.

**Reading is already solved and needs no new mechanism.** `node.ts` reads its own script with
`env.fs.read(resolveAbsPath(env.fs.cwd(), target))` → `FsReadResult`, and the three error cases
(`not_found`, `is_directory`, `permission_denied`) already have house-style wording there. A
script's `fs.readFile` is the same call with the same three errors.

**Writing has a precedent rather than a new mechanism — copy the redirect, do not invent.**
`runLine.ts:180` `validateRedirectTarget` then `runLine.ts:212`
`env.patches.write(target, content, { isNew })` is exactly "write this string to that path as this
player". Read both before designing anything. What the validator already gets right:

- it rejects an existing **directory**, a **missing parent** directory, and a location the tier
  cannot write, each with `bash:`-style wording;
- the writable check is asymmetric on purpose — an **overwrite** checks the file itself, a **new
  file** checks the parent directory;
- it reports `isNew`, which the write needs so a freshly-created file is stamped `is_new` while an
  overwrite leaves the stored flag intact;
- it runs **before** the command does, because bash opens redirects before exec. A script's write
  has no such ordering constraint, but the validation itself is the part to reuse.

`env.fs.canWrite(path)` is the gate the write commands (`mkdir`, redirect, `rm`) already share.

⚠️ **`appendFile` carries a hazard the redirect does not, and it is the one genuinely new thing in
this slice.** `FsView.reload()` exists precisely because a whole-file write composed from the
CACHED tree does not merely miss a concurrent write — **it reverts it**. Its doc comment is explicit
that the cached view stops being right the moment a file on this box is one somebody else can write,
because nothing pushes their writes here. An append is a read-modify-write, so on any box a fellow
occupant can reach (the AP gateway, a shared LAN box, anything cross-player) it has to compose
against `reload()` rather than against the tree the client already has. A sweep appending one line
per host is the exact shape that would silently eat another player's edit.

**The return shape from 2a was designed for this and needs no change.** A command call hands back
`readonly string[] & { readonly exitCode: number }` specifically so `await fs.writeFile(path, out)`
works unchanged — 2a's plan says so in as many words. Whatever `writeFile` accepts, an ordinary
`string[]` has to be one of the things it accepts.

**The stringify is already written.** `core/scripting/format.ts` is slice 1's one value formatter,
the thing that makes `console.log` render an object as JSON and a `string[]` one per line. A
`writeFile` given a non-string should go through the same function, or the same value will render
two different ways depending on whether the player printed it or saved it.

**`fs` becomes the second reserved identifier.** `registry.test.ts` pins that every command name
derives a valid, unique, non-reserved JS identifier, and it counts `console` as already taken.
Adding an `fs` namespace to the script context means adding `fs` to that set — otherwise the day
someone registers a command named `fs`, it silently shadows the filesystem for every script.
`node.ts` also injects `console` LAST so no command name can displace it; whatever slice 3 injects
needs the same treatment.

**Open questions, none of them answered:**

- **Namespace or bare functions?** `fs.readFile(…)` versus `readFile(…)`. A namespace costs one
  reserved identifier instead of three and reads like real node; bare functions match how every
  command is already injected.
- **What does a failed read or write DO?** 2a set the posture that shell-originated errors throw a
  bare `ShellError` and that a nonzero exit is data rather than an exception. A missing file is
  arguably the second kind (a script wants to branch on it), a permission denial arguably the
  first. `cat` returns exit 1 for both, but `fs.readFile` is not a command.
- **Does `writeFile` create missing parent directories,** or fail the way the redirect does? The
  house already has a precedent and it points one way: conventions §D3b records that **`scp` does
  not create parents, as real scp does not**, and the redirect refuses a missing parent too. A
  `writeFile` that quietly made directories would be the odd one out.
- **Is `appendFile` a core read-modify-write, or does it need a `PatchApi` verb of its own?** The
  answer decides whether the reload hazard above is handled once inside the seam or is left to
  every caller — and leaving it to callers means leaving it to *players*, which is not a real
  option.
- **Is `writeFile` given a `string[]` joined with `\n`,** matching what the redirect does with
  stdout, and does it add a trailing newline?

**Version**: next feature bump is `0.199.0`. **Wire-check**: `patches.write` reaches the journal, so
unlike every earlier D9 slice this one **may genuinely need a `scripts/test*.ts` wire-check** — that
is the first thing to settle when planning, not an afterthought.


---
*Delete this file at D9 close-out and fold the durable rules into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md), as D3–D8 each did.*
