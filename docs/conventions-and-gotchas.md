# v2 — conventions, gotchas & invariants

Durable working knowledge for the v2 rewrite, graduated out of author-local `~/.claude` memory so
it survives and is shared: how work is done, the gates, the traps, and the rules the architecture
holds. Where the project stands is in [`project-status.md`](./project-status.md); what is
deliberately deferred is in [`backlog.md`](./backlog.md). Pairs with
[`cross-player-architecture.md`](./cross-player-architecture.md) and
[`world-content-architecture.md`](./world-content-architecture.md) (as-built systems). When this
doc and the code disagree, the code wins — fix the doc.

---

## 1. Working conventions (process + code)

(TDD, functional style, strict TypeScript, and the skill routing live in the root
`.claude/CLAUDE.md` — these are the project-specific additions.)

- **No backward-compat burden — until launch.** No live players, so freely rename / reshape
  / break schema, generators, IDs. **This rule SUNSETS at multiplayer announce** — after
  launch, schema/patches/CVEs/generators need migration discipline.
- **Ship-first on multiplayer security.** L1 (active-session gate) + targeted L3
  (gameTime / wallet / hop-chain) is enough to launch. Don't gold-plate L2 or a full
  smart-server. Scope creep kills indie multiplayer faster than security holes.
- **Shared world-state mutation is fine, not a tradeoff.** Defacement / bricking of shared
  networks is gameplay-renewable; don't gold-plate isolation/protection in shared-world
  systems.
- **Command names carry the real binary's name, hyphens included** — `redis-cli`,
  `redis-server`, `aircrack-ng`, `airmon-ng`, `airodump-ng`, `new-game`. Nothing in the
  shell constrains the shape: `isFlagToken` and completion test only a LEADING `-`, and
  the registry is keyed by the raw string. The module and its export take the camelCase
  form of the same name (`redisCli.ts` exports `redisCli`), and a hyphenated name used as
  an object key or a local has to be quoted or camelCased — `tsc` finds every one of those.
  **`node` scripting SHIPPED this and it works as predicted** (D9, `scriptIdentifier` in
  `core/scripting/commandContext.ts`): the sandbox keys its context by the camelCase
  identifier, so `redis-cli` answers to `redisCli` inside a script. Legacy built its sandbox
  as `new Function(...Object.keys(context), src)`, which makes every command name a formal
  parameter and a single hyphen a `SyntaxError` that takes down every script in the game.
  Older notes calling the no-hyphen rule "forced" predate this and are wrong.

- **No single-letter variable names.** Name lambda/predicate/reducer params after what they
  represent (`candidate`, `port`, `vuln`, `machine`), never `c`/`p`/`v`/`m`. Classic loop
  indices `i`/`j`/`k` are fine.
- **No Story/Slice/decision-number tags in code or test comments** (nor in `describe`/`it`
  titles). "Story 7.3" / "(D9)" / "slice 7.2a" rot into dangling refs once plans are
  deleted — state the WHY directly. When editing, clean only the refs in *your* change.
- **Don't reference `plans/` or memory files from committed code.** Plans are deleted on
  completion; memory is author-local. Inline the WHY in comments; for longer-form context
  that must survive, link an in-repo `docs/` doc (those code-comment links are allowed).
- **Bump the version on feature changes**, in BOTH `package.json` and
  `package-lock.json` (the latter via `npm install --package-lock-only`). The ASCII
  banner reads the version from `package.json` via Vite's `define`.
- **Command `flags` keys are dashed** — `'-p'`, never bare `p`. Hand-built flag-Map tests
  bypass `bindFlags` and hide the drift.
- **v2 command ports must match the legacy CLI interface.** When porting a command, read the
  legacy `src/commands/` FIRST; preserve its flag set + behaviours + error shape. Don't add
  or drop flags without explicit user opt-in.
- **Consolidate small related helpers** into one `<topic>Helpers.ts` (and a matching test
  file), not file-per-helper.
- **Minimize API projections** — drop fields no client call site consumes, even
  safe-to-expose ones (e.g. public keys).
- **Grep all call sites when replacing a pattern.** A plan that says "fix X in function Y"
  surfaces ONE site; sibling functions usually need the same fix. Grep the pattern shape
  codebase-wide before scoping.
- **Real network latency over fake delays.** When real server round-trips replace fake
  `setTimeout` pacing, take them; don't stack fake on top of real.
- **A command that does slow work streams its progress.** If the work takes real time (a
  server round-trip) — or its real-world counterpart does — the command returns
  `kind: 'async'` and announces each step BEFORE doing it, so the announcement paints while
  the work is pending instead of narrating work already finished. A line ending in `...`
  means "happening now"; the arrival of the NEXT line is what reports it finished; the last
  step is reported by the prompt coming back. **No `Done` / completion marker on the
  in-flight line** — real `apt` gets away with `Reading package lists... Done` only because
  it rewrites the line it already printed, and a terminal that only appends can't. Pace the
  steps with `env.sleep` (abort-aware, so Ctrl-C unwinds mid-sequence). Build the result with
  `streamedResult` from `core/commands/streaming.ts`: it forwards an
  `AsyncGenerator<TerminalLine, number>` and captures the generator's RETURN as the exit code,
  which a bare `for await` would throw away. Where a gate sits decides its shape — a refusal
  that never reached the slow work (apt's root/offline checks) stays `kind: 'sync'` with no
  preamble, while a failure only discoverable AFTER the work started (an unknown package)
  lands beneath the announcements the player has already seen.
- **No `/etc/shadow`.** In-game passwords live inline in `/etc/passwd`. `/etc/shadow` does
  not exist in this game — don't reference it in design or code.
- **Prefer fire-and-forget server calls** alongside existing optimistic state setters over
  making a sync state method async (the `wrapWithRefetch` shape).

---

## 2. Build / test / type gates

- **Type gate = `npm run typecheck` (= `tsc -b`)**. It covers `src/`,
  `api/`, AND `scripts/`. A plain `tsc --noEmit` is a NO-OP (root tsconfig has `files: []`)
  — do not use it.
- **`api/*.ts` Vercel functions are NOT typechecked locally and ESLint doesn't flag broken
  imports there.** Only `vercel dev` / deploy catches their type errors, and DB-column /
  constraint correctness needs a **wire-check** (§5). Keep `api/` handlers thin; push logic
  into the typechecked `src/core/`.
- **Format/lint gate = `npm run lint`** (ESLint).
- **The whole-world content tests sweep a fixed sample; each PR's gate sweeps everything once.**
  `ALL_ESSIDS` (`src/test/worldContent.ts`) holds every Ridgemont landmark and every key outside
  the catalog, but of the drawn networks only Millbrook and the corporations whole and, from every
  other town (Ridgemont's drawn networks included), the first network in key order of each shape
  it holds (category, subtype,
  profile, whether a branch, whether unlisted). A town adds dozens of networks that read alike,
  and sweeping them all doubled the suite when the city landed (607 s to 1175 s of file time).
  The sample is fixed, so a red run reproduces. It catches none of what one network or a
  coincidence breaks (the city's lone home with a mail server, its two access points of one
  make, name and subnet), so **before opening a PR that touches generated content, run
  `WORLD_SWEEP=full npx vitest run` once and record it**. `relations`, `webIndex` and `world`
  read the whole world either way: they are its cross-network rules.
- **Every relative import ends in `.js`, and lint enforces it.** `./x.js` resolves to `x.ts`.
  Vercel runs `api/` as plain Node ESM, which resolves a relative import only by its exact file
  name, so `./x` is `ERR_MODULE_NOT_FOUND` on every request. vite, vitest, tsx and `vercel dev` all
  guess the extension, which is why no local gate or wire-check could see it: the first deploy
  of v2's `api/` (2026-09-27) failed exactly this way on all three functions, as legacy's had in
  April. The rule covers every file, not just what `api/` loads, so no one has to know that
  boundary. `scripts/encode.ts` writes `__encoded.ts` with the same `.js` import for the same
  reason.
- **World budget gate = `npm run build`'s `postbuild` (`scripts/checkBudgets.ts`).** Vercel runs
  `npm run build`, so a deploy or preview fails on a **bundle** breach. The **timings** are
  skipped there (`VERCEL=1`): Vercel's build machine ran boxes at 3.1 ms/box against 0.85 ms
  locally, so they only mean something on a developer machine. Run `npm run build` locally before
  opening any PR that grows content. It fails the build when any cost of the generated world
  outgrows its ceiling:
  - **the gzipped main chunk exceeds 284,975 B**. That is the 134,975 B it weighed before world
    content, plus the 150 KB that content may add. The remedy is to trim pools; the allowance is
    fixed, not a number to raise.
  - **building the boxes of any one set averages over 2 ms per box**, the best of three timed
    passes after a warm-up pass (a loaded machine only ever adds time, so the quickest pass is
    the closest to what the boxes cost). The sets are Ridgemont's landmarks, each town the world draws, the
    corporations and Ridgemont's drawn networks, each timed on its own so a dear town cannot hide in the world's average. It was about 0.15 ms per box over 615 boxes before world content. Base trees
    are rebuilt on every lookup with no cache, so the remedy is a cache for the box builders,
    added for that measured reason and never before one. **Before reaching for the cache, look
    for a lookup made twice inside one build.** At v0.263.0 four gateway content builders each
    found where their gateway stands (the home LAN plus the whole `chainLinks` walk, ~0.34 ms)
    and the gate read 1.93–2.31 ms; finding it once in `buildGatewayBaseFs` and handing it down
    read 1.53–1.67, no cache needed. The gate is noisy near the line (one run of the same tree
    failed at 2.31 and the next passed at 1.93; at v0.302.0 Ashby's 121 boxes read 1.62–2.16 on
    one pass with nothing in Ashby changed), which is why it reads the best of three.
    **The one cache is the relations memo** (`memoised` in `relations.ts`, v0.301.0). Reading a
    network's leads walks every LAN of its town, so its cost grows with the town: Oakhurst's 47
    networks built at 2.53 ms a box. `relationsTo` and `relationsFrom` keep each key's answer, the
    world they read being fixed at load, and every set reads 0.78–1.04 ms.
  - **building findit's generated web from nothing takes over 1,000 ms**, the best of three
    timed passes after a warm-up pass. A server's first search builds every publisher's listing
    and keeps it; 283 publishers took 424 ms at v0.304.0, and a Vercel instance pays about 2 s.
  It is a script, not a vitest test, because Stryker runs the whole suite under instrumentation
  and aborts its dry run on any failure. A wall-clock assertion there would break mutation runs.
  To check without a full build, run `npx tsx scripts/checkBudgets.ts` after `vite build`.
- **v2 UI tests = jsdom + `@solidjs/testing-library`, NOT Browser Mode.** E2E =
  `agent-browser` vs `vercel dev` (port 3100).
- **E2E (Playwright/agent-browser) is reserved for browser-only behaviour** Vitest can't
  reach (keyboard/focus, the nano editor, full UI flows). Don't duplicate unit/integration
  coverage there.
- **E2E-test new primitives through the UI before calling them "done".** Unit tests prove
  layers in isolation; integration seams (effect → session → patch → L1 → DB) drift
  silently. Watch the network tab.
- **No metadata-existence tests** (`expect(cmd.name).toBe('foo')`). DO test metadata
  *preservation* through wrappers/HOFs and *consumption* by other commands (help/man).
- **A streamed (`kind: 'async'`) command is LAZY — `await command.execute(...)` performs
  NOTHING.** Its body doesn't start until something consumes the lines, so a test that
  executes and then asserts on `patches.write` calls sees an empty spy and passes or fails
  for the wrong reason. Drain the stream first. In the game every consumer already drains
  (the terminal renders each line as it arrives; a pipe or redirect collects them first), so
  this bites only in tests. The upside: pulling just the FIRST line leaves the command
  suspended mid-flight, which is how "the announcement is out before the work happens" is
  provable at all.
- **A `makeDeps(over)` helper must RETURN the mock that actually landed in `deps`.** The
  common shape — build default `vi.fn`s, then `{...defaults, ...over}` — returns the *default*
  mock even when `over` replaced it. A later `ctx.someDep.mockImplementation(...)` then
  retargets an orphan and the test passes vacuously. Resolve the override BEFORE building
  `deps` and return that value, or take the variation as a typed option on the helper.
- **A test that asserts an ABSENCE ("nothing was written / nobody was traced") is the easiest
  one to pass for the wrong reason.** Mutation testing is what catches it — a guard that
  survives deletion usually means the path was never reached. Before trusting such a test,
  prove the setup reaches the code by asserting the matching PRESENCE with the same inputs.

---

## 3. Mutation testing conventions

**A negative fixture must be negative for the REASON UNDER TEST, not negative in general.** Twice in
two slices a surviving mutant traced to the fixture rather than the assertion, so it is a rule now:

- **D6 slice 2** — pointing every catalog row's account source at the database killed 16 tests for
  `ssh`, 1 for `http`, and NONE for `ftp`. Its fixture box ran all three doors and both ladders
  began with an account called `root`, so the trace line was identical whichever file was consulted.
- **D6 slice 3** — pointing the `mysql` command's reachability check at ssh's port instead of 3306
  killed nothing. The "no database" fixture was the first machine running NO SERVICE AT ALL, and a
  box running nothing is refused on 3306 and on 22 alike, so no test could tell which port was read.

Both are the same shape: the negative case was over-negative, and agreed with the mutant by accident.
The fix is to pick a fixture where the two answers DIFFER — a box running ssh and no database, an
account file whose ladders do not share a name. Before trusting a refusal test, ask **what else is
also false about this fixture**, and whether the mutant would notice.

This is the sibling of the same-pool blind spot recorded below: there, an oracle read from the array
the generator reads moves with it; here, a fixture that fails every check agrees with every mutant.
In both cases the test is shaped so that nothing it could catch is left to catch.

**A `find` whose predicate the DATA ORDER already satisfies hides its own mutant.** D6 slice 6:
`accounts.find((account) => account.userType === 'root')` survived `ConditionalExpression → true`,
because `/etc/passwd` lists root first on every box the suite builds, so "the first root-tier row"
and "the first row" are the same row. The mutant was not equivalent — it diverges on a box whose
passwd has been edited, where it would have mirrored the player's own row, whose hash is empty. The
fix was not a test but the right question: the password being read is the one `su root` asks for, so
read it BY NAME through the same `accountIn` every auth gate uses. Third member of the family above
— this time it is the fixture's ORDER, rather than its negativity, that agrees with the mutant.

**A whole-suite dry run is the thing that makes a mutation battery unrunnable here — scope
the RUNNER, not just `--mutate`.** Stryker executes the entire suite under instrumentation
before it applies a single mutant. At 3400+ jsdom tests that never finished on this machine:
concurrency 15 blew the 5-minute dry-run limit, concurrency 4 tripped vitest's 5s per-test
default on `ui/state.test.ts`'s module import (hence `testTimeout: 30000` in
`vite.config.ts` — a timeout there is a correctness setting, exactly as `timeoutMS` is), and
raising `--dryRunTimeoutMinutes` merely hung for 79 minutes with no sandbox writes. What
works is a throwaway vitest config whose `include` lists ONLY the test files covering the
modules under mutation, pointed at via `"vitest": { "configFile": ... }` in a throwaway
stryker config: 180 tests in 3.5s instead of 3431 in 40s+, and the battery finishes in ~6
minutes. Anything a mutant needs that the narrowed `include` omits reports as **NoCoverage**
rather than as survived, so the narrowing is visible in the report rather than silent. Keep
both files out of the repo — the `mutate` and `include` lists are per-slice and would rot.

**"Keep both files out of the repo" means untracked-and-deleted, not "somewhere else on disk."**
Writing the throwaway vitest config to a scratch directory outside the project looks tidier and
does not work: node resolves `vite-plugin-solid` by walking up from the CONFIG FILE's own
directory, so a config under `AppData/Local/Temp` dies with `ERR_MODULE_NOT_FOUND` and a
`requireStack` naming the plugin — which reads exactly like a missing dependency and sends you to
`npm install`. Write both files at the v2 root, run, then `rm` them; `reports/` and `.stryker-tmp`
are already gitignored, so only those two need removing. Same for the `vitest.configFile` path
inside the stryker config: keep it project-relative, because Stryker copies the project into a
sandbox and an absolute path escapes it.

**That throwaway vitest config must carry what the real one supplies, or NOTHING runs.**
Copy `include` alone and the battery dies with `ConfigError: No tests were executed`, which reads
like a bad `--mutate` glob and is not. It needs `setupFiles: './src/test/setup.ts'`,
`define: { __APP_VERSION__ }`, and — the one that actually bites — `solid({ hot: false })`.
Stryker's runner does not set mode `'test'`, so solid-refresh stays enabled and its virtual module
is unresolvable under jsdom; every test file fails to transform and the runner reports zero tests
rather than an import error. For a rendered (`.tsx`) battery it also needs `globals: true`: without
it `@solidjs/testing-library` registers no automatic cleanup, every render piles onto the last, and
the dry run fails every test. Keep `testTimeout: 30000` and, when a theme test is in the battery,
`css: { include: [/src\/index\.css/] }`. Start from `vite.config.ts` and narrow `include`, rather
than writing a minimal config from scratch.

**A narrowed battery reports survivors the full suite kills.** Perturbative coverage only sees the
tests in `include`. Neon slice 5 first ran the `effects` command's mutants against its own test file
and the UI suites, and 28 survived; the category, the no-terminal refusal and the script refusal are
asserted in `help`, `man`, `availability`, `runLine` and `commandContext` tests, and a rerun with
those included killed them. Before calling a registry-level field a survivor, include the suites
that walk the registry.

**A hand-verification harness must restore the file in a `finally`, or it leaves a MUTANT in the
tree.** Hand-checking a module-load survivor means patching the source, running the tests and
putting the source back — and the putting-back is the step that gets skipped when the run itself
throws. On 2026-09-26 a verification loop died decoding Stryker's own output
(`subprocess` defaulting to cp1252 on Windows against ANSI colour bytes) *after* patching and
*before* restoring, and left `readPage.ts` holding a broken regex. Everything still passed, because
the mutant it left was the very one the loop was proving nothing covered — which is exactly the
shape that gets committed. Wrap the restore in `try/finally`, decode subprocess output with
`.decode('utf-8', 'replace')` rather than text mode, and re-grep the patched line afterwards.

**Read the mutation report from `reports/mutation/mutation.json`, not from captured stdout.** The
`clear-text` reporter prints its per-mutant list as it goes, and a captured run keeps only the tail
— a four-file run reported `124 survived` above a list showing 8, with no way to tell whether any
sat in the changed lines. Run scoped batteries as
`npx stryker run --mutate "<files>" --reporters json,progress` and read the JSON, which carries
every mutant's file, line, mutator and status. Note it overwrites the previous report in place, so
copy one you still need first.

**A TIMEOUT counts as KILLED, so a slower run scores HIGHER.** Stryker folds timeouts into the
kill count, which means a mutant that merely hung under load is indistinguishable in the score from
one a test actually caught — and the same code scores better the more loaded the run. Measured on
one file across two slices: `dpkgStatus.ts` read **86.27% with 7 timeouts** beside another file and
**77.27% with 0** measured alone; a slice later the same file read **94.52% on 5 timeouts**,
**89.04% on 7**, and **90.41% on 1**. Four numbers, one file, and the highest was the least true —
the hung mutants were real survivors the whole time. So: read the `# timeout` column beside every
score, treat `killed` as `killed + timeout` when judging, re-measure a suspicious file ALONE before
believing a number, and quote the run with the fewest timeouts when reporting one. A batch run is
for finding survivors quickly; a single-file run is for scoring.

**Run `npm run encode` before `npx stryker run`, or lose ten minutes to a blank error.**
The `test:mutation` script has a `pretest:mutation` hook that runs it; invoking Stryker directly to
pass `--mutate` skips the hook, and the run then dies with `Error: Something went wrong in the
initial test run` and NOTHING else — no failing spec, no missing-file message. The cause is
`src/core/secrets/__encoded.ts`, which is generated and gitignored. Either use the npm script or run
`npm run encode` first.

**A test that asks for "some" of a behaviour can pass with the behaviour deleted.** Slice 8a's
backup snapshots could revise a document between nights, and the test said "every later night adds
or changes something". It passed — and went on passing with `isRevisable` returning `false`, the
revision draw forced off, and the snapshot reading only a file's first version, because a forced
nightly *arrival* already satisfied "adds or changes". Stryker showed the whole revision path could
be removed. The fix was to ask for the specific thing: a file present in two snapshots with
different content, a later `ModDate` and the same `CreationDate`, every kind of document revised
somewhere, and most left untouched. When a rule has two ways to be satisfied, test each way on its
own.

**A test that reads the table it is checking cannot fail, and mutation testing is what tells
you.** Slice 7b's `pools/cronMail.ts` scored **30.95%** while every one of its tests passed. The
cause was not missing coverage: the test deciding which boxes keep a `/var/mail/root` asked
`CRON_OUTPUT` whether each job prints — the same table the mutants were editing — so it moved with
every mutant and flipping any job between silent and reporting was invisible. Restating the answer
in the test (the eleven reporting commands, written out by hand) took the file to **97.62%**. The
smell is general and worth hunting directly: **if a test imports the production constant that
decides its expected value, it is describing the code rather than checking it.** A low score on a
file that is mostly data is the usual way this surfaces, because there is nothing else there to be
under-tested.

**A surviving mutant is a hypothesis, not a hole — hand-check it before writing a test.**
`coverageAnalysis: "perTest"` decides which specs to run per mutant from an instrumented dry run,
and it can get that wrong: D10 slice 3 reported `find.ts`'s usage guard
(`startArg === undefined || patternArg === undefined` → `false`) as SURVIVED, while applying the
same edit by hand killed the suite outright with
`TypeError: Cannot read properties of undefined (reading 'startsWith')`. Believing the report
would have meant writing a second test for a gap that did not exist, and — worse — concluding the
existing one was weak when it was not. The check costs one scripted run. Do it for every survivor
outside the manual-prose family before treating it as work.

**Three times now, in three consecutive slices.** D10 slice 4 reported `applyPatches`'s new
directory guard (`patch.permissions === undefined || existingDir.kind !== 'directory'` → `false`)
as SURVIVED; slice 5 reported `gpg`'s `if (encrypted === null || encrypted.length < 4)` → `false`
the same way. Both kill the suite outright by hand. Three occurrences in three slices is a rate,
not an anomaly — treat a non-manual survivor as unproven until a hand run agrees with the report.

**A fourth, and the first that is not a usage guard.** The own-LAN scan slice reported `nmap`'s
routing condition (`single !== undefined && resolveSingle !== null` → `true`) as SURVIVED; by hand
it fails a dozen tests at once, because an always-taken branch hands the renderer an undefined host.
So the shape is not "guard clauses specifically" — it is any branch whose mutant makes LATER code
throw, which is exactly where `perTest` coverage mapping is least reliable.

**A fifth, on the SAME line, one slice later.** The gateway half of the own-LAN scan fix reported
that identical `nmap` routing condition as SURVIVED again — by hand it failed **46** tests. A line
that has produced a false survivor twice is not going to stop, so do not re-litigate it: hand-check
and move on. The hand-check is one scripted run and it has now been right five times out of five.

**A sixth, seventh and eighth — and the eighth is not a guard, a usage check or a routing
condition.** The mail slice reported three more: `In-Reply-To`'s array (killed 2 tests by hand),
the reply-quoting guard `previous === undefined || reply === undefined` → `false` (**107 tests**),
and — the new shape — `.sort((earlier, later) => earlier.sentAt - later.sentAt)` → `+`, an
ordinary comparator with no branch in it at all (2 tests). So the rule is not about guard clauses,
usage checks or routing: **`perTest` mis-maps any mutant whose effect surfaces in code that runs
LATER than the mutated line**, comparator included. Eight for eight. Budget one scripted
hand-check per non-prose survivor before writing a single test against it; the run that found
these took 30 seconds each and would otherwise have bought three tests for gaps that did not
exist.

**A ninth, and it is a whole method chain.** Slice 7b reported `printingRuns`'s
`crontab.split('\n').filter(...).flatMap(...).sort(...)` collapsed to `crontab.split('\n')` — a
`MethodExpression` mutant on a module-level helper, which would hand every caller raw strings where
it promised parsed records. Hand-mutating it fails **eight tests at once**, loudly. Nine for nine,
and the shapes now run guard clause, usage check, routing condition, array literal, sort comparator
and method chain — which is the point: the shape never mattered, only that the damage shows up
downstream of the line. Hand-check first, every time.

**The same slice shows the gate working, so do not read the above as "ignore the report."** That
run found the mail work's headline claims genuinely unproven: making `relayOf`'s `find` return
`undefined` — no network carries its own mail, every message arrives in one hop — passed all 5,730
tests, as did dropping the `* 1000` from a role mailbox's date (putting that mail in 1970) and
never quoting the message a reply answers. Six of seven hand-checked survivors were real. The
report is a hypothesis generator worth running; the hand-check is what turns a hypothesis into
work.

**A timeout is ambiguous in general but not always — check whether the mutant HANGS.** The mail
slice's 11 timeouts all sat on one weave loop, and applying one by hand hung past 60 seconds:
mutating `<` to `<=` in `while (atBusiness < business.length || atPersonal < personal.length)`
leaves both inner guards untouched, so neither counter advances. That is a deterministic
non-terminating loop, not a slow test, and counting it as killed is correct on any machine. One
hand-run separates this case from the load-dependent one the section above warns about — worth
doing before quoting a score that leans on timeouts.

**A codec tested only through its own round trip cannot see format drift — pin it with a vector
from the OTHER implementation.** Every encrypt/decrypt test writes and reads with the same code, so
a change to the key schedule, the checksum or the byte order round-trips perfectly and stays green
while locking every file the other implementation produced out of the game. D10 slice 5 generated
one ciphertext by running LEGACY's `src/utils/crypto.ts` with the md5-derived key and pasted it in
as a constant; it is the only test in that file that can fail on a format change, and the same
applies to any ported serializer, hash or wire encoding. Generate the vector from the source of
truth, never from the code under test.

**A hand-mutation harness owns the files it snapshots — don't edit them while it runs.** The
house pattern (a Python script that applies one mutant, runs the spec, restores) reads every target
file ONCE at startup and restores from that snapshot. Run it in the background and edit one of those
files in the meantime and the edit is silently reverted when the battery finishes; nothing errors,
because a restore is a plain write. A manual page written mid-battery vanished this way and only the
next full suite run caught it. Either wait for the battery, or edit files it does not touch.

**A mutant that survives a timeout stays applied.** The same harness restores in a `finally`, but a
tool-level timeout kills the process outright — so a battery that runs long leaves the CURRENT
mutant in the tree. Checking one marker is not enough (the control had been restored while a later
mutant had not). Re-run the affected specs, or `git diff`, before trusting a green.

**The harness must decode child output as UTF-8 explicitly.** Python's `subprocess` decodes with
the ANSI codepage on Windows (cp1252), and vitest prints the box-drawing characters this project's
goldens are made of — so the reader threads die with `UnicodeDecodeError` part-way through a
battery. The verdicts stay CORRECT, because `returncode` comes from the process rather than the
buffer, which is exactly what makes it dangerous: the run looks broken, the transcript is shredded,
and the control's verdict scrolls away in stack traces. Pass `encoding='utf-8', errors='replace'`.

**And the other half of that: Python's own stdout ENCODER dies on the same characters.** Decoding
the child correctly only to `print` it raises `UnicodeEncodeError: 'charmap' codec can't encode`,
because Python's stdout on Windows is cp1252 too — so a harness can read a verdict correctly and
then crash reporting it. The `finally` still restores, which is the whole reason it is a `finally`,
but the run reads as a failure. Strip the output to ASCII before printing
(`re.sub(r'[^\x20-\x7e]', '.', line)`) or set `PYTHONIOENCODING=utf-8`; either way, do not assume
that decoding the subprocess was the end of it.

**A large quoted heredoc silently writes nothing.** `cat > file <<'EOF'` with a body of roughly 150
lines or more fails the whole command with ``unexpected EOF while looking for matching `'`` and
leaves the target untouched — so the next command runs against stale content and the failure reads
as a logic bug in code that was never written. Hit twice in one session, on a test file and on a
patch script. Write the body to a file by other means and `cat` it into place, or keep heredocs
short; either way, check the line count before trusting the write.

**`python -c "…"` through bash is the same trap wearing a different hat.** A `\n` inside the
double-quoted argument is consumed by bash, so Python receives a REAL newline and writes it into
whatever string it was building. In D10 slice 3 that turned four `buildFile('decoy\n', …)` literals
into unterminated strings, and the failure surfaced as `Tests: no tests` with a transform error —
not a test failure, and nothing pointing at the edit that caused it. Hit twice in one slice, the
second time producing `not.toContain(\\0)` with no quotes at all. Put the patch in a `.py` file and
run that file. The rule generalises: **any string that has to survive bash AND python AND
TypeScript should travel in a file, not through three layers of quoting.**

**An inline heredoc also EATS backslash escapes, at any length.** A `\n` inside the body arrives in
the file as a real newline, so `join('\n')` in a patch script becomes `join('` + linebreak + `')`
and a regex loses its anchors — the file is written, the write reports success, and the corruption
surfaces later as an assertion failure in code that reads correctly on screen. Quoting the
delimiter does not save you. The rule is narrower and firmer than the length one above: **any body
containing a backslash escape goes through the Write tool**, whatever its size.

Provably-equivalent mutant classes — accept (don't chase) when they recur:

- **Type-narrowing defensive checks** — e.g. `raw === true` against a `string | true |
  undefined` Map value is unkillable.
- **Stryker static load-throw** — a mutant that throws at module load (`Map([undefined])`)
  makes the Vitest runner report "no tests ran" → Stryker counts SURVIVED. Verify the throw
  by hand, then accept as tooling-equivalent.
  **A describe-body population sweep has the same effect, and it reaches ACROSS blocks.**
  D7 slice 1: stubbing any generated-content generator to `() => undefined` takes the suite
  red — but the throw lands while a NEIGHBOURING block builds its own `POPULATION` eagerly,
  so Vitest reports zero tests and Stryker scores a caught mutant as survived. Making the
  new block lazy (compute once, on first use inside a test) flipped six of these to Killed
  and left eight, because the eager block next door still generates every box. Before
  believing a content generator "survived", stub it by hand: a suite that goes red is a
  kill however the runner scored it.
  **Module-scope fixtures mis-attribute `perTest` coverage the same way.** D7 slice 2: the
  `if (occupants.some(...)) return null` branch in `redisCli.ts` was reported Survived under
  a scoped runner, and applying that exact mutant by hand took TWO tests in the same file
  red. The fixtures those tests read (`generateHomeLan` results held in module-scope
  consts) are built at import rather than inside a test body, so Stryker attributes no test
  to the mutant and never runs the ones that would kill it. Same rule as above, and it is
  now the cheapest check in the triage: hand-apply any survivor that looks like it should
  already be covered before writing a test for it.
  **A memo hides every mutant behind it.** Stryker switches mutants inside one loaded
  module, so the relations memo (`memoised` in `relations.ts`) answers with what it read
  under an earlier mutant, and a mutant in anything `relationsTo` reads is scored Survived
  though its tests never saw it. 8c's battery reported the phone rule's three mutants
  survived; applied by hand in a fresh run, each took two to six tests red. Hand-apply every
  survivor under a memo.
  **Third instance, D7 slice 4**: `storeIn`'s `datadir === undefined || datadir.kind !== 'file'`
  in `redis/datadir.ts` reported Survived; forced to `false` by hand it took the "a box with
  no store gains one on its first write" test red immediately. The pattern to distrust is now
  specific enough to name — a survivor in a module the mutated file only IMPORTS, whose
  killing test builds its world from generator output rather than from a literal. Two of the
  three instances so far have been exactly that.
- **No-op type-re-narrowing `.filter(typeGuard)`** added only to satisfy types after a guard
  already guarantees the kind. Prefer reduce-append; else keep the imperative early-return
  loop.
- **A `=== -1` guard in front of an index read** — `array[-1]` is already `undefined` on a plain
  array, so mutating the guard to `false` changes nothing downstream that treats `undefined` as
  "not found". (`hydraCrack.ts` `credentialFrom`.)
- **A string literal in the ELSE arm of a two-value branch** whose consumer tests only for the
  other value — `outcome === 'success' ? A : B` means `''` and `'failure'` render identically.
  (`hydraCrack.ts` `traceOf` → `formatSshdAuthLine`.)
- **`?? []` mutated to `["Stryker was here"]`** where the next step reads a property the junk
  string does not have: `rows ?? []` then `.at(-1)?.content` yields `undefined` either way. The
  GUARD is still tested (the `??` → `&&` mutant dies); only the fallback's contents are
  unobservable. (`hydraCrack.ts` `wordlistOn`.)
- **A `StringLiteral → ""` on a literal typed as a string UNION is a compile error, not a
  survivor.** `stryker.config.json` runs no TypeScript checker, so Stryker executes mutants
  `tsc -b` would reject and scores them Survived. `exploitEffect.ts`'s effect pools are
  `readonly ExploitEffectKind[]`, and all 45 of their survivors are this class — applying one
  by hand fails with `TS2322: Type '""' is not assignable to type 'ExploitEffectKind'`. They
  were first written off as pool entries no box could reach; once the timeline walked past
  entry 0 they became reachable, and the score still did not move, because reachability was
  never what kept them alive. Hand-check one with `npx tsc -b` and accept the family. A test
  that killed them would restate the type, and a test that pinned each package's rolls would
  restate the pool.
- Plus per-slice equivalents documented in the relevant plan (e.g. discriminant-by-exclusion
  arms, a default value washed out downstream).

- **A generator invariant that makes a defensive branch unreachable.** Verified 2026-08-11 by
  enumerating the whole crackable ESSID pool: all 100 inner gateways run EXACTLY ONE open port and
  it is always ssh. So in `forwardsIntoDeepLayer` the `find(open => open.service === 'ssh')`
  predicate and the `?.port` short-circuit are both unkillable — with one daemon, "the ssh one" and
  "the first one" are the same port, and the optional never fires. Two of these were a real dead
  disjunct (`ownSshPort === undefined || …`) that collapsed into `?.port !== port`; the two that
  remain are genuinely equivalent. Same invariant retires the reached-port half of
  `hydraCrackInnerGateway`'s service check: a deep host is `FORCE_SSHD_PATCH`'d to one daemon and
  `servesInternalPort` already refused any forward to a port nothing serves, so the port and
  service halves cannot disagree there. **Enumerate the generator before calling such a branch
  equivalent** — one fixture proves nothing about a seeded population, and the enumeration is a
  dozen lines.
- **An early return whose fallthrough reaches the same answer.** `resolveInnerGatewayTarget`'s
  `if (served.kind === 'none') return UNREACHABLE` is a fast path: with the guard mutated away,
  `served.internalIp` is `undefined`, matches neither the deep host nor the child gateway, and the
  final `return UNREACHABLE` produces the identical result. Kept for readability, not behaviour —
  all three mutants on that line are equivalent.
- **A value computed only to be discarded.** `fromIp: target.sourceIp ?? ''` in
  `hydraCrackInnerGateway`: the sweep needs a string to format lines with, and when `sourceIp` is
  null those lines are never written, so the fallback is unobservable. `cracked` does not depend on
  `fromIp` at all.
- **Blank-line spacers in command output** — `yield text('')` between sections. Tests assert the
  content lines, so the empty string is unobservable.

**Known-equivalent inventory, so a re-run is not a mystery:** `hydraCrack.ts` scores 166/169 with
exactly the three above. `hydra.ts` scores 87/133 (2026-08-11, up from ~63/97 when the deep-layer
example and rewritten `-p` description grew the block): 44 of its 46 survivors are the declarative
`manual`/metadata block — the same shape `john.ts` established — and the other 2 are the blank-line
spacers. Its dispatch logic is fully killed. `hydraCrackInnerGateway.ts` 78/80,
`resolveInnerGatewayTarget.ts` 77/80 and `lanHostIdentity.ts` 135/137, each with only the
equivalents named above. All expected, not regressions.

**Read a survivor's `location` span before believing it is impossible.** Stryker mutates
SUB-EXPRESSIONS, and the clear-text/JSON `replacement` field shows only the fragment it swapped —
not the whole line. A `ConditionalExpression => "false"` reported on
`if (username === undefined || hash === undefined)` replaced *only* the first operand, leaving
`if (false || hash === undefined)`. Hand-testing "the same" mutant as `if (false)` killed it, which
looked like a harness bug and was not. Pull `location.start.column`–`location.end.column` out of
`reports/mutation/mutation.json` and slice the source line with it to see the real mutant:

```js
const span = line.slice(mutant.location.start.column - 1, mutant.location.end.column - 1);
```

That survivor turned out to be genuinely equivalent — `String.split` always returns at least one
element, so `username === undefined` is dead. The fix was to delete the operand, not to argue with
the report: an equivalent mutant is often dead code asking to be removed. Confirm with
`tsc -b --force` that a guard is not secretly load-bearing for types before deleting it.

**A mutation PERCENTAGE is the wrong instrument for judging a deduplication — diff the survivor
SETS.** When three copies of the web target-resolution block became one (`reachWebHost`), every
per-file score FELL — curl 81.43 → 76.99, gobuster 82.12 → 77.87, lynx 78.85 → 70.67 — and
nothing had got weaker. 37 KILLED mutants stopped existing along with the two redundant copies,
so the same 74 survivors sat over a smaller denominator. The check that actually answers "did the
tests get weaker" is the survivor set:

```bash
npx stryker run --mutate '<files>' --reporters clear-text > after.txt
grep -A2 '^\[Survived\]' after.txt | grep '^-' | sed 's/^-[[:space:]]*//;s/[[:space:]]*$//' \
  | sort > after.survivors
comm -13 before.survivors after.survivors   # anything listed here is a REAL regression
```

Capture the "before" from the pre-change code — `git stash push --include-untracked` the working
changes, run, then pop; the run is deterministic, so a correct baseline reproduces exactly.
**Never pipe the run through `tail`**: the summary table is the LAST thing printed, so `| tail -60`
looks complete while silently discarding every survivor listing above it. Redirect the whole run
to a file. (Also skip `--incremental` for a scoped run — it pollutes the report with cached
results from files outside the scope.)

**Extracting a welded-in string into a parameter silently unpins it.** `curl: (6) Could not
resolve host: …` used to be a single template literal, so a StringLiteral mutant emptied the whole
message and any `toContain('Could not resolve host')` killed it. Once the program name became an
argument — `reachWebHost({ program: 'curl', … })` — it is its own mutable literal, and every
assertion in all three command files turned out to be prefix-blind: `program: 'lynx'` → `""`
passed the entire suite. **Expect this survivor class from any extraction that turns literal text
into an argument**, and pin the parameter by asserting the full prefix
(`toContain('lynx: (6) Could not resolve host')`) rather than the shared remainder.

**Assembling a string from parts is the same move**, and it unpins the separator too. `lynx`'s
footer went from the literal `'↑↓ Select  ⏎ Follow  q Quit'` — where emptying it broke any
assertion on it — to parts joined by `'  '`, at which point `'↑↓ Select'` → `""` and
`join('  ')` → `join("")` both survived a `getByText(/Follow/)`. **When a rendered line becomes
composed, assert the whole line, not a word of it**: `getByText('↑↓ Select ⏎ Follow q Quit')`
kills both (single-spaced, because testing-library normalizes whitespace before comparing).

**A command's mutation score is mostly its manual.** Every string in `description`, `manual`,
`arguments` and `examples` is its own StringLiteral mutant and none of them is killable by a
behaviour test — so ADDING documentation prose lowers the score without any test getting weaker.
`lynx.ts` fell 70.67% → 63.01% for exactly that reason, and all 27 survivors sat at or below the
`export const lynx: Command = {` line while its executable half had none. **Before reading a
command's score as a regression, split the survivors at the metadata block**; `curl.ts` reads the
same way (24 of 25 in the manual, the 25th a pre-existing `.pid$` anchor).

The same move has a subtler second form: a helper's mutants can MIGRATE. `gobuster`'s and `lynx`'s
own `error` had its `kind: 'error'` killed by their connection-refused tests; once that message
came from the shared module, those tests killed the SHARED copy instead and each command's local
helper went unpinned. When behaviour moves into a shared module, check which tests moved with it —
a file can lose coverage it never stopped deserving.

**A branch that CHOOSES between two sources needs a fixture with distinct values on each, or the
branch mutants are unkillable no matter how strong the assertion.** Slice 4's origin derivation picks
between "the network you are standing on" and "the network you own"; in any fixture where the
standing box is on the caller's own network, both arms return the same string, so a mutant that swaps
them passes every assertion. Killing it required a THIRD network — attacker home, the network stood
on, and the target — with three different public IPs. The tell is that the survivor is a
`ConditionalExpression`/`EqualityOperator` on a branch you believe is well tested: check whether the
two arms can actually produce different observable values in the fixture before hunting for a missing
assertion. (`crossPlayerSourceIp.ts` `resolveVantageSourceIp`, 18/18 once the third network existed.)

**Put the interesting element in the MIDDLE of the fixture, never at the end.** A test that
asserts "the search stops as soon as it matches" proves nothing when the match is the last item:
stop-early and scan-everything produce identical output, and the boundary mutant survives. This
hid a real gap in hydra's sweep trace — with the matching password last in a two-word list,
`matchedAt + 1` mutated to `words.length` and the whole suite stayed green. Adding a third word
*after* the match killed it instantly. The same shape applies to `find`/`findIndex`/`some`/
`indexOf` and to any early-`return` in a loop: the fixture needs an element the correct
implementation must never reach.

**An injected fake can hide the real collaborator completely.** The lease allocator's tests
inject `redrawOctet`, so `drawLanOctet`'s NPC-exclusion `.filter(...)` — the entire point of
the change — could be DELETED with the whole suite green. Mutation was the only thing that
found it. Whenever a dep is faked in every test of its consumer, the real implementation needs
its own direct test, or it is effectively unverified.

**An entry no test ever DRAWS can be blanked without anything failing — assert over the POPULATION,
not over a sample.** Keying a content pool by role multiplies the entries a suite has to reach, and
a test that reads two hosts of a role reads 2 of that role's 5 templates: the other 3 mutate to `""`
and survive. The same trap was walked into twice in one epic — first with rare ROLES (`dns` is drawn
at 3%, so a handful of fixtures never meets one), then with unreached entries INSIDE a role's pool.
The fix has one shape: sweep the 253 host octets against each role's hostname prefix, collect the
distinct results, and assert on the SET — its width, its membership, and that no entry came back
empty. Six survivors and fifteen timeouts became 91/91 with none, and the run fell from 8 minutes to
3, because the sweep also replaced per-test regeneration with one shared pass.

**Generated TEXT in a fixed format is mutation-tested by a reader of that format, not by pinning
lines.** A config or page template's boilerplate lines (`!`, `}`, `<domain>…</domain>`) each mutate
to `""` or `"Stryker was here!"` and survive any test that only extracts the facts it cares about:
the gateway backups first scored 58% and the admin pages 45%. One well-formedness check per format
killed most of them without pinning a single line — IOS lines indented under a header and ending
`end`, RouterOS `add`/`set` under a `/section`, uci `option` under `config` under `package`, nvram
unique and sorted, XML tags balanced, EdgeOS braces balanced at four spaces a level, HTML a
doctype, balanced tags and full tables — lifting them to 90% and 93%. Break the production code on
purpose once per check to see it fail: a checker that parses nothing passes everything.

**Compute a population sweep ONCE per block, never per test.** Regenerating it inside each `it` is
fast in a normal run and slow enough under mutation instrumentation to race Stryker's timeout —
which silently converts a SURVIVING mutant into "killed by timeout" and makes the score depend on
how loaded the machine was. A deterministic read-only sample shared across a describe couples
nothing, and it is the reason the account and credential blocks in `remoteHostFs.test.ts` build
their sample in a block-level constant.

**A Stryker TIMEOUT is scored as a KILL, so `timeoutMS` is a correctness setting, not a patience
setting.** `stryker.config.json` ran at `30000` until 2026-08-20, which was under the budget the
generation suites need even when they are structured correctly. Raising it to **120000** converted
78 timeouts on `pools/database.ts` into 78 verdicts, and every single one of them was a SURVIVOR:
the killed count stayed at exactly 311 across both runs, so the masking was total rather than
partial. **Any mutation figure in this repo measured before that change is inflated by an unknown
number of survivors** and must be re-measured before it is cited as evidence. Read the `timeout`
column of a clear-text report first: a non-zero one means the score is not yet a fact.

**A population test over SYSTEMATIC seeds converges far slower than the sample size suggests.**
Measuring a probability knob across `NET-0`, `NET-1`, … looks like an n=400 sample and is not:
those strings differ by a few characters, so their FNV-1a hashes are correlated. A 0.40 knob read
35.8% / 43.5% / 37.0% across three seed namespaces at 400 draws, 37.0% / 38.9% / 38.7% at 2000,
and only reached 39.4-40.0% at 20000. The roll itself is fine — a fresh stream's FIRST draw is
uniform to within 0.3pp when seeds are unrelated (verified across four seed shapes × three
thresholds), so **do not "fix" an off-target rate by tuning the knob**. Either sample an order of
magnitude harder than feels necessary, or accept a band wide enough to hold the drift and say so
in the test.

**Assert over the whole record when a field is drawn from a small pool.** "A different seed
re-rolls the credentials" compared ONE `root` hash out of a ten-word password pool, so it
failed roughly one ESSID pair in ten — a real flake dressed up as a regression. Comparing the
whole `/etc/passwd` makes the same claim with three independent draws behind it. Any golden
pinned to a single pick from a short pool has this problem.

**A test that mints a RANDOM identity and asserts against SEEDED world state is flaky by
construction.** `generateIdentity()` draws fresh keys every run, while the world (NPC accounts,
LAN octets, hostnames) is seeded from the ESSID. Wherever those two spaces can collide, the test
fails at a rate set by the smaller one:

- guest passwords come from the crackable pool (**17 words** as of v0.262.0; it was 8 when this
  was first written), so two random identities share one about **1 run in 17** — which broke
  "Bob's password is refused on Alice's box": on a collision it was not a wrong password at all.
  The wire-check `testSharedApForwards` had the same shape (its "B's guest password on A's
  forwarded port is 401" check); since 2026-10-07 it draws B again until B's guest password differs
  from A's. Measured 2026-10-07: 58 of 1000 random pairs share one.
- a player's LAN octet is drawn from their pubkey while ~10 of 253 octets hold generated hosts,
  so **~1 run in 25** puts a real NPC at the "self" address — which broke `nmapScan`'s
  self-exclusion count (`hostsLogged: 1`, not 0).
- a player's own database draws its account passwords from the shared generated pool, so on
  **~1 run in 53** (measured 76/4000) a second account holds the same password as the known
  credential — which broke `hydraCrackPublic`'s "earns an account in a stranger's database":
  a one-word wordlist correctly cracked BOTH, so `cracked: [known]` found two entries.

**One of those latent instances has now been found**, and it cost a full gate cycle: `nmapScan`'s
"self still skipped" test called `generateIdentity()` directly while a sibling test in the SAME
file already used the `identityOffTheGeneratedLan()` helper written for exactly this. It failed
two consecutive Stryker dry runs while the full suite passed 13/13 — which reads like "the mutation
run broke something" and is really the 1-in-25 collision landing twice. When a dry run fails on a
test that passes standalone, check whether that test mints a random identity BEFORE assuming a
moving tree or tooling noise.

Fix by **drawing again** — recurse until the candidate identity does not collide — so the
failure mode is gone by construction rather than merely rarer. That is different from the
small-pool remedy below, which widens the ASSERTION; here the nondeterminism is in the fixture.
A THIRD case sits between them: when the collision does not INVALIDATE the scenario but changes
its result — the `hydraCrackPublic` database above, where cracking two accounts is the door
working — neither hide it by drawing again nor loosen the assertion. **Derive the expectation
from the same fixture the code reads** (there, filter the database's own credentials for the
wordlist's hash) so the golden moves with the seed and stays exact on membership and count.
Both instances above passed 8-10 consecutive isolated runs, so treat "it passes now" as no
evidence. Other files mint identities the same way (`resolvePublicScan`, `natHosts`,
`authCreateSessionSameLan`, `createSession`) and are latent until an assertion depends on the
draw; at least one further instance has been observed in a full-suite run without being
pinned to a file. **`authCreateSessionSameLan` has now fired** (2026-10-07, one full run of
#619's gate): "reports host_unreachable when B targets its OWN LAN IP" got `401` where it expects
`404`, then passed alone 3/3 and in the next full run. Same fix as above — draw B again until it
does not collide — still to do.

**A survivor masked by a LATER call is untested, not equivalent.** `withSelfHost`'s sort
survived because `mergeLanOccupants` re-sorts downstream — the mutant is invisible through
the consumer, but the module's own documented invariant (`HomeLan` = ascending octet order)
is real. Kill it with a direct test of that invariant rather than deleting the sort or
waving it through.

**A guard clause duplicated by an EARLIER guard also survives — and its test lies.** An added
`wlan0.ipv4 === null` check looked covered, but `env.network.isOnline()` had already rejected
that state, so the test passed via the wrong branch. Sibling of the vacuous-absence trap in
§4: construct the state that reaches ONLY the new guard (here: another interface addressed, so
the machine is online while `wlan0` is not).

**`stryker run --mutate <file>:<lines>` leaves STALE statuses in
`reports/stryker-incremental.json`** for the untouched mutants in that file — a range-scoped
run reported survivors that a full run had killed. After a scoped run, confirm any survivor by
hand-mutating the line and running the test file.

**A mutant that breaks MODULE LOAD is scored as a SURVIVOR here.** `aptPackages`'s
`pkg.binaries ?? [pkg.name]` mutated to `&&` makes the module throw while the map is being built,
so vitest reports `2 failed (2)` / `Tests no tests` — and with no failing TEST to see, Stryker
banks it as survived. Three of one gate's 63 survivors were this. It is the same "zero tests is not
evidence" trap the TDD rules name, firing inside the mutation harness rather than inside a watcher.
The tell is a survivor whose mutant obviously cannot work — a `??` guarding a `.map`, a callback
replaced by `() => undefined` at module scope. Hand-mutate it and read the RUNNER's output rather
than the test count: an import-time crash and a genuine survivor look identical in the report and
nothing alike on the console. Static mutants that merely produce junk (`{ name: 'gpg' }` → `{}`)
are scored honestly, so this is not "static mutants are unreliable" — it is specifically the ones
that throw.

**`reports/mutation/mutation.json` is NOT written by this repo's configured reporters.**
`stryker.config.json` sets `["html", "clear-text", "progress"]`, so that file silently persists
from whichever older run last had a json reporter enabled — it can be a different SCOPE
entirely. Parsing it after a scoped run yields a confident, fully-formatted classification of
somebody else's mutants; it named 44 survivors in `pools/database.ts` while the run that had
just finished was 13 survivors in `mysql/datadir.ts`. Read the FRESH `mutation.html` instead
(the payload is at `app.report = `, with `"+"` string splices to strip before `raw_decode`), or
work from the clear-text output. Check the file's mtime before trusting it.

**Generated content a player can carry home must fit one signed write — measure it in JSON.**
`ftp get`, `scp` and `cp` onto the player's own box persist through one `/api/patches` upsert, and
`signedEnvelopeSchema` caps its payload at **8192 characters of JSON**. JSON writes a control
character as six (`\u0001`), so content built from them balloons: slice 8a's first document
stubs were control-character noise, and a 2.3 KB spreadsheet became a 14 KB payload that failed
with `400 envelope_invalid`, which the client shows as `local: <path>: I/O error`. No unit test
and no wire-check saw it, because neither writes generated content to the patch store; the played
run did. The rule: binary-looking content uses characters JSON writes as themselves (Latin-1
`¡`–`ÿ` works — `strings` ignores it as well as it ignores control characters), and a test sends
the largest generated files through the real `createPatchApi` and checks each request against
`signedEnvelopeSchema`. `share.test.ts` holds the pattern.
It came back one PR later on a **log**: slice 8b wrote each upload to `vsftpd.log.1` as a whole
visit (CONNECT, OK LOGIN, OK UPLOAD), and a guest's `get` of it failed on most file servers at
4–13K characters; one line per arrival brought it to 2–6K, and the same test now covers every
transfer log. So the rule is not about binaries: **any generated file a tier can read is a file a
player may carry home**, and a slice that makes one grow with the world (a log spanning a share, a
spool, a data file) measures its largest instance in JSON. Measuring the whole world at 8b's
close-out found older files already over the cap — see `backlog.md`.

**To prove a slice moved no existing generator stream, diff the whole world — it costs one
minute.** "No existing stream gained a draw" is the claim every content slice makes and no unit
test states, because a shifted stream still produces valid output and every pinned test keeps
passing. Build every NPC box on `main` and on the branch, serialise `filesUnder(tree)` keyed by
`essid/ip/path`, and compare:

```bash
npx tsx ./probe.tmp.ts "$SP/world-after.json"
git checkout main -- src && npx tsx ./probe.tmp.ts "$SP/world-before.json"
git checkout HEAD -- src
```

Then classify every differing path and assert nothing falls outside the slice's own surface. Slice
7b's run read **31,801 files identical**, with the only surprise being one line each of
`/root/.bash_history` on 10 boxes — root now tails `mail.log.1`, because root's history is built
from `logPaths` and the box gained a log. That is correct, and it is exactly the kind of ripple
nothing else would have shown. The probe is untracked and deleted after; put it at the **v2 root**,
not in a scratch directory, for the same module-resolution reason the Stryker configs go there.

**Do NOT run Stryker and the v2 dev server at the same time.** A concurrent `vercel:dev`
(vite/3100) makes Stryker report **false survivors** (verify by hand-mutating) and silently
reloads the live app mid-E2E (resetting `su` elevation). Stop one before the other.

**Do not EDIT source while a Stryker run is in flight either** — same family as the rule
above. A run whose dry run overlapped an edit died with `There were failed tests in the
initial test run` naming a test that passes cleanly on its own. Treat a dry-run failure whose
test passes standalone as tooling noise from a moving tree, not a real regression: leave the
tree alone and re-run.

**An accepted "equivalent" mutant EXPIRES when a new caller reaches it.** `curl`'s
`{ userType: 'root' }` read was classified equivalent in the web surface's first slice, on the
sound reasoning that served pages are world-readable. The next slice added the player's own box
and quietly broke it: a file created under the web root is created BY root, and `patchApi.write`
stamps the creating tier's defaults (`defaultFilePermissions('root')` → `read: ['root']` only),
so reading as the caller would 404 a page the player had just published. Nothing about the read
changed; the WORLD around it did. Re-run mutation over an unchanged file whenever a new path
starts calling it, and treat each inherited classification as a claim about today's callers only.

**Stryker TIMEOUTS count toward the score, and their count drifts between runs.** The same
unchanged file reported 23 then 28 timeouts on consecutive runs here, moving four mutants from
`timeout` into `survived` and turning a "100%" into a visible survivor list. So a bare 100% means
"no survivors *identified this run*", not "no survivors". When a score matters — a keystone gate,
a security-load-bearing branch — read the survivor LIST, and be suspicious of a file whose
timeout bucket is a large fraction of its mutants.

**A file's score can DROP with no change to that file, and the lower number is the true one.**
`curl.ts` went 98.73% → 82.17% between two runs in the same slice: its timeouts collapsed 29 → 2,
so ~27 mutants that had been scoring as *killed by timeout* ran to completion and survived. The
trigger was unrelated — adding tests elsewhere changed the per-test coverage mapping (2.86 →
23.48 tests per mutant). **Never report a score movement as a regression before diffing the
survivor LINE NUMBERS against what the slice actually touched.** Here every survivor sat in the
`Command` metadata block or in two long-classified narrowing clauses, and none in the new code —
so the honest sentence is "the timeouts were masking these", not "this slice weakened the tests".

**A `Command`'s declarative block is an accepted survivor class — with ONE exception worth
knowing.** `description`, `tier`, `availability`, `manual.*` and `arguments[]` have no production
consumer (verified by grep), so their mutants survive and a test asserting them pins data rather
than behaviour. But **`flags` IS consumed** — `runLine.ts` parses argv against it, so
`flags: { '-i': 'boolean' }` → `{}` would send `curl -i http://x` off to fetch the URL `-i`.
It survives only because command tests call `command.execute(env, args, flagMap)` directly and
hand-build the flag map, bypassing the parser entirely. **Any claim about flag PARSING needs a
`runLine`-level test**; the command's own test file structurally cannot make it.

**The default 5s timeout was inflating scores here, so `stryker.config.json` now sets
`timeoutMS: 30000`.** This is the concrete instance behind the two timeout warnings below, and it
was large: `routerFs.ts` reported **95.83% with 46 timeouts against 46 kills**, and re-running the
same unchanged code at `--timeoutMS 60000` gave **87.50%** — timeouts fell 46 → 10 and survivors
rose **4 → 12**. Eight mutants scoring as "killed by timeout" were genuine survivors. The same run
turned `passwordPools.ts` from a clean 100% into 95.83% with one real (equivalent) survivor.

Two things make this file class prone to it: Stryker counts a timeout as a KILL, and `routerFs.ts`
is **64% static mutants** (module-level constants — hostname pools, config seeds, permission
objects), each of which forces a full module reload. Stryker warns about this itself and suggests
`ignoreStatic`. **Treat any file whose timeout bucket approaches its kill count as unscored** until
you re-run it with a raised timeout; the lower number is the true one.

**`prng.next() < chance` → `<=` is a provably equivalent mutant, and will be until a knob becomes
an exact multiple of 2^-32.** `next()` returns `k / 4294967296` for an integer `k` in
`[0, 2^32-1]`, so the two operators differ only when a draw lands EXACTLY on the threshold. No
current `CRACK_CHANCE` value is reachable: `1` would need `k = 2^32` (one past the maximum), and
`0.7` / `0.12` / `0.4` all give a non-integer `k`. Re-check this if a knob is ever set to a dyadic
rational like `0.5` (`k = 2147483648`) — then the mutant becomes killable in principle, though only
by a 1-in-4-billion draw.

**`npm run lint` reports hundreds of errors while a mutation run is in flight.** Stryker copies the
whole project into `.stryker-tmp/sandbox-<id>/` for the duration of a run. That path is in
`.gitignore` but NOT in the eslint config's ignores, so eslint walks the copy and reports every
problem twice over — 400+ errors here, all of them from `vite.config.ts` and generated files inside
the sandbox. Nothing is wrong with the project. Either wait for the run to finish (the sandbox is
removed on exit) or check that every reported path contains `.stryker-tmp` before believing it.

**A timeout is scored as a KILL, so a slow run can flatter the score.** Stryker counts `# timeout`
alongside `# killed` when computing the percentage. A module whose mutants mostly run as *static*
(evaluated at import, so Stryker cannot isolate covering tests and re-runs the whole file set) can
push ordinary runs past `timeoutMS` and bank them as detections. Measured on `commands/daemon.ts`
(55% static): **78.23% with 17 timeouts** at the default 30s, and **64.52% with 0 timeouts** at
`--timeoutMS 180000` — same code, same tests, 14 points of pure measurement artifact. If a run
reports timeouts where a comparable one reported none, re-run it long before trusting the number: a
real infinite loop still times out, a merely slow mutant resolves into an honest kill or survivor.

**A mutation percentage is not comparable across a de-duplication.** Collapsing N copies of a
well-tested function into one removes N-1 copies of its *killed* mutants while leaving the
un-oracled parts (per-instance prose, config literals) roughly constant, so the ratio falls even
though no test got weaker. `commands/daemon.ts` went 73.76% → 64.52% doing exactly this, with every
one of its 44 survivors in manual/description text and not one in the gate ladder it protects. The
comparison that means something is **which mutants survive**, not the percentage — a metric that
rewards copy-pasting a tested function is measuring duplication, not test strength.

**Stryker writes NO `mutation.json` unless you ask for it, and a stale one will answer instead.**
`stryker.config.json`'s `reporters` is `["html", "clear-text", "progress"]` — no `json`. So a
`reports/mutation/mutation.json` found on disk is whatever the last run that *did* request it left
behind, possibly weeks old and about entirely different files. It is read-plausible and wrong:
here it listed survivors in `apt.ts`/`sshd.ts` during a run scoped to the password pools. Pass
`--reporters json,clear-text` on any run whose survivor list you intend to read programmatically,
and sanity-check that the files named in the report are the files you mutated.

**"Unreachable in the product" is not the same as equivalent.** `deniedPortsFor`'s
`vantage.kind === 'switch'` survived because a router's tree carries no `acl.conf` in
practice, so always reading it changes nothing. But the discriminant is a real rule — a router
FORWARDS rather than filters — and a test can state it directly by handing a router vantage a
tree that does carry the file. Prefer stating the rule over arguing the input can't occur.

**A Stryker run that dies leaves a sandbox behind, and `npm run lint` then fails in it.** Stryker
copies the repo into `.stryker-tmp/sandbox-<id>/` and normally removes it; a run that exits
abnormally (a bad `--mutate` glob is enough — it throws `ConfigError: No tests were executed`)
does not. `.stryker-tmp` is in `.gitignore` but **not** in `eslint.config.js`'s `ignores`, which
is only `['dist', 'coverage']` — so the next `npm run lint` walks the sandbox and reports hundreds
of errors in instrumented copies of your own files, `@ts-nocheck` first among them. Hit on
2026-08-17: 394 errors, every one a phantom. **The tell is the paths** — if they start
`.stryker-tmp/`, the tree is fine; `rm -rf .stryker-tmp` and re-run. Adding `.stryker-tmp` and
`reports` to the eslint ignores would retire the trap for good; left undone deliberately, as a
config change riding along on an unrelated slice.

**A script that applies a mutant by hand MUST revert in a `finally`, and must decode the subprocess
explicitly.** Proving a passed-on-arrival test means editing a source file, running vitest, and
putting the file back — and on Windows the middle step is what breaks. Python's `subprocess.run`
with `text=True` decodes using the console codepage (`cp1252`), and vitest's output carries UTF-8
box-drawing and em-dashes, so the reader thread dies with `UnicodeDecodeError` and takes the script
down **between the edit and the restore**. Hit at D10 slice 2: it left `author.ts` with its
`withoutTty` deleted, which the next full run would have reported as a real failure. Pass
`encoding='utf-8', errors='replace'`, wrap the edit in `try/finally`, and check the tree afterwards
(`git diff` on each mutated file) before believing the verdicts.

---

### Porting a renderer: capture the oracle, do not retype it

When a v2 module claims to reproduce legacy output "verbatim" — an ASCII table, a log line, a banner
— **capture the expected blocks by running legacy's own code over the same fixture**. Legacy lives
at git tag `legacy-final`: extract it to a scratch directory outside the repo
(`git archive legacy-final | tar -x -C <dir>`), `npm ci` there, and add a throwaway
`src/**/__oracle.test.ts` that writes its output to a file (vitest swallows `console.log`; use
`writeFileSync`).

**Why:** hand-typed goldens make "ports verbatim" an assertion about arithmetic you did in your head.
Captured ones make it a measurement. When the two agree it costs five minutes; when they disagree you
have just found the bug before writing it.

### A golden-output fixture must vary in the dimension each rule acts on

A rendering rule is only tested if the fixture can tell it apart from its absence. Column alignment is
invisible when every cell happens to be exactly as wide as its header; a default-value column is
invisible when no column carries a default; case-insensitive matching is invisible when nothing is
referenced in the wrong case.

**Why:** these are not equivalent mutants, they are equivalent FIXTURES — the rule is real and
unprotected, and the mutation score reads clean because the harness cannot distinguish the two.
Mutation testing surfaces it; a coverage number never will.

**How to apply:** for each rule the renderer implements, ask what fixture value would make its absence
visible, and make sure one exists. Adding a second, deliberately awkward fixture beside the realistic
one is usually cheaper than reworking the realistic one — and it leaves the realistic goldens stable.

### Testing gotchas found at the rendered layer

- **⚠️ The theme and the neon effects are module signals that outlive a test, and `startGame`
  resets neither.** In a real browser `new-game` wipes the origin instead, so nothing in the game
  needs a reset. In `Terminal.test.tsx` a test that switched the HUD off handed every later test a
  terminal without it. The suite resets every effect in an `afterEach`; the theme is not reset,
  so **every test that depends on the palette names its own theme** (`setTheme('neon')` before
  rendering) rather than trusting whatever the previous test left.

- **jsdom moves no caret for a key or a click.** `selectionStart` stays where the last
  `setSelectionRange` or value change put it, so a test of anything that follows the caret (the
  neon block cursor) places it with `setSelectionRange` and then fires the event the browser sends
  afterwards: `keyUp` for an arrow, `click` for a click, `selectionchange` on `document` for a held
  key. A test that fires only the key proves nothing about where the caret went.

- **⚠️ The script sandbox runs in the HOST realm, so an uninjected global silently resolves
  to the test runner's own.** `runScript` builds an `AsyncFunction`, which closes over
  whatever the environment already has. `process` is the first injected name that collides
  with a real Node global, and under vitest an uninjected `process.argv` is NODE'S — two
  entries long, so `expect(process.argv.length).toBe(2)` passed against a `node` that
  injected nothing at all. **Assert the CONTENTS of anything the sandbox is supposed to
  provide, never its shape or length.** No browser has `process`, so the game is fine; only
  the test lies. Any future injected name sharing a Node global (`Buffer`, `global`,
  `setImmediate`, `require`) inherits this exactly.

- **⚠️ A test that stubs a global and never restores it makes its NEIGHBOURS pass.**
  `vitest` is configured without `unstubGlobals`, so a `vi.stubGlobal('fetch', …)` survives
  to the end of the file. `Terminal.test.tsx`'s nmcli test had no stub of its own and was
  green only on the airodump-ng test's leaked one; the first test in that file to clean up
  after itself took the lease away and failed it with `the network is unreachable` — a
  failure in a test the change never touched. **Pair every `vi.stubGlobal` with
  `onTestFinished(() => { vi.unstubAllGlobals(); })`**, and when a neighbour then fails,
  give IT a stub rather than restoring the leak.

- **⚠️ A test `FsView` reloads to the tree it already has, so `reload()` is INVISIBLE in
  vitest.** `createFsView` (aliased as `mockFsViewFromTree`) only re-reads through its
  optional `onReload`; without one, a cached read and a live one are indistinguishable and a
  test asserting "composes against the machine" passes against code that never reloads. This
  is how D9 slice 3 shipped a `readFile` that could not see its own writes with a green
  suite. **Any claim about reading or writing the machine as it STANDS must build the view
  with `createFsView(staleTree, { onReload: async () => freshTree })`** and assert the fresh
  content — never that reload was called.

- **A masked prompt has no `textbox` role.** `Terminal.tsx` renders `type={masked ? 'password' :
  'text'}`, and `<input type="password">` has NO implicit ARIA role — so
  `getByRole('textbox', { name: /terminal input/i })`, which every other test in that file uses,
  cannot find the field a password is typed into. Use `getByLabelText(/terminal input/i)` there.
- **Wait on WHICH prompt is pending, not on the field appearing.** A credential prompt keeps the
  input mounted, so finding it proves nothing about whose question it is holding — and between two
  prompts the busy bar takes it away for a beat. Wait on `pendingPrompt()?.masked`, then re-find.
- **The prompt renders `whitespace-pre`, so its trailing space is a rendered character.** Testing
  Library's default matcher collapses whitespace, so `findByText('mysql>')` passes against
  `'mysql>  '`. Assert `.textContent` exactly when the constant's spacing is the claim.

**⚠️ Stryker's config file is a POSITIONAL argument — `-c` is `--concurrency`.** Cost 75 minutes
on 2026-09-01 and it is silent in both directions, so check this before letting any battery run:

```bash
npx stryker run stryker.mutation.json --concurrency 4     # right
npx stryker run -c stryker.mutation.json                  # WRONG — see below
```

`-c <file>` sets concurrency to the FILENAME. That fails validation with
`Config option "concurrency" must match pattern "^(100|[1-9]?[0-9])%$"` — an error naming the
wrong option, which sends you off adjusting concurrency instead of looking at the flag. Supply
`--concurrency 4` to satisfy the validator and it proceeds happily: **the throwaway config was
never loaded at all**, so Stryker falls back to the committed `stryker.config.json` and mutates
every file it lists. On this repo that is **219 files and 15,975 mutants instead of 183**, four
cores pegged, no output (the `progress` reporter writes nothing to a redirected stream), and it
reads exactly like a slow machine. **The tell is the instrumenter's own first line** —
`Instrumented 2 source file(s) with 183 mutant(s)` is right, `Instrumented 219` is not. A properly
scoped battery here finishes in under a minute; if one runs past a few minutes, check that line
before waiting.

**Baseline the narrowed suite before trusting a battery's runtime.** `npx vitest run --config
vite.mutation.config.ts` takes ~2s for a scoped include. Multiply by mutants ÷ concurrency and you
have the expected wall time; anything wildly above it is a scope or hang problem, not patience.

**Read survivors from `reports/mutation/mutation.json`, never from the captured console output.**
A backgrounded Stryker run's log was truncated to its last 72 lines and listed 8 of 77 survivors —
all from one file, which read like a clean run with one weak spot and was not. The summary table
is always right; the `[Survived]` blocks above it are the part that gets cut. Run with
`--reporters json,progress` and parse the JSON, which also carries each mutant's `replacement` —
the only way to tell which of the three mutants Stryker generates for an `a && b` condition
actually lived.

**A battery piped through `tee` reports a success it never earned.** `npx stryker run … | tee
run.log` yields `tee`'s exit status rather than Stryker's, so a run that died in config validation
— before a single mutant — surfaced as `completed (exit code 0)`, and in a BACKGROUNDED run that
notification is the first thing you read. Same mechanism as the wire-check runner's false `32/32`
in §5 (`$?` after a pipeline is the LAST stage's status), and it compounds with the `-c` trap
above: the wrong flag kills the run in a second and the pipe scores it a pass, which together read
as a battery that finished impossibly fast rather than as one that never started. `tee` is the
tempting one precisely because it KEEPS the output, so it feels safer than `tail` — it is not.
Don't pipe a gate at all (the `progress` reporter writes nothing to a redirected stream anyway);
confirm a battery really ran from the instrumenter's own `Instrumented N source file(s)` line and
a fresh `mutation.json` mtime, never from the exit status. Hit on 2026-09-16.

**A golden that compares a generated tree against the list it was generated from agrees with any
list.** `workstationFs.test.ts` and `routerFs.test.ts` assert `/bin`'s keys equal
`SYSTEM_UTILITY_NAMES`, and both generators build `/bin` from that same constant — so dropping a
name from it changed nothing either test could see. Two binaries were added at D10 slice 1 and
pinned BY NAME on all three filesystems as well; the goldens still earn their place (they catch a
stray extra entry), but a by-name assertion is what catches a removal. The same shape applies
anywhere a fixture and the code under test read one constant.

**A test that has never been seen to fail is a decoration.** Three of D10 slice 1's planned RED
steps passed the moment they were written, because the minimum implementation for an earlier step
had already satisfied them — which is the honest outcome, not a reason to skip them. Each was
proven by applying the mutant it exists to catch, watching it fail, and reverting. Write that down
in the close-out rather than reporting a green test as if it had driven anything.

**A test that leaves a full-screen app open hands the NEXT test a terminal with no input field.**
`overlayMode` is a module signal and `startGame` does not reset it — nor should it, because no
player can start a game from inside an overlay: the app holds the keyboard and there is no prompt
to type into. So the reset belongs to the harness, and it goes in an `afterEach` rather than in the
`renderTerminal` helper, because the tests that hand-roll their own `startGame` need it just as
much — the one that broke at D10 slice 2 was exactly that kind. The failure surfaces in an
unrelated test, several `describe`s later, as `Unable to find role="textbox"`, so it reads as that
test's own bug. Applies to any module-level signal a test can leave set.

## 4. Operational gotchas

- **Tailwind utilities lose to unlayered CSS.** Tailwind v4 puts its utilities in a cascade layer,
  and any rule in `index.css` outside a layer beats every layered rule whatever its specificity.
  The neon HUD bars set `display: flex` unlayered, and `max-sm:hidden` on their items did nothing
  until the HUD rules moved into `@layer components`. Put component CSS that Tailwind classes on the
  same element must be able to override in `@layer components`; leave unlayered only what must win.
- **Several files on `main` are not Prettier-clean** (`ui/state.ts`, `ui/env.ts`,
  `core/commands/types.ts` and a handful of tests, as of 2026-09-28). `npm run lint` is ESLint and
  does not check formatting, so nothing fails. Running `prettier --write` on one of them reformats
  far more than the change and buries it in the diff; before formatting a file, check whether its
  `main` version is clean (`git show main:<path> | npx prettier --stdin-filepath <path> --check`),
  and format only files the branch made dirty.
- **A cp1252 em-dash byte gets committed and breaks every UTF-8 reader of the file.** An `—`
  written through some tool paths lands as the single byte `0x97` instead of UTF-8's three, and
  nothing in the normal loop notices: `tsc`, `eslint` and `vitest` all read the file happily, and
  `git diff` shows a replacement character at worst. It surfaces as an unrelated-looking crash in
  any tool that decodes strictly — `UnicodeDecodeError: 'utf-8' codec can't decode byte 0x97 in
  position N` from a Python helper reading the source, which reads like a broken script. Five files
  carried one before 2026-09-26 (`generateHomeLan.ts`, `resolveHttpFetch.ts` + its test,
  `resolvePublicScan.ts` + its test), all from slice-1c-era edits. To find and fix them all:
  ```python
  for path in pathlib.Path('src').rglob('*.ts'):
      data = path.read_bytes()
      try: data.decode('utf-8')
      except UnicodeDecodeError: path.write_bytes(data.replace(bytes([0x97]), '—'.encode('utf-8')))
  ```
  Related: *Edit tools unescape unicode* and *Python text mode writes CRLF* — the same class of
  silent byte-level damage, which is why the check is a byte scan rather than a grep.
- **3100 `vercel dev` squatter (recurs).** Killing the `npm run vercel:dev` background task
  does NOT kill its child vite/function process → it orphans on 3100 (502) → a fresh
  `vercel:dev` sees "port in use" and silently falls back to **vite-only on 3101** (no API →
  wire-checks hang on 502). Before restarting, kill the squatter:
  ```powershell
  Get-NetTCPConnection -LocalPort 3100,3101 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }
  ```
  Then `npm run vercel:dev`, and confirm `/api/<fn>` returns non-502 (a 400 to an empty
  `{}` body = serving).
- **A `vercel dev` started any way but `npm run vercel:dev` manufactures a PASSING check.** That
  script wraps the binary in `dotenv -e .env.development.local`; the binary alone does not read the
  file, and every endpoint then answers `500 {"error":"not_configured"}`. The server is otherwise
  healthy — it starts, prints `Ready!`, serves the app — so nothing announces the fault. It surfaced
  as `testSnmpFilter` reporting **1/13**, and the one PASS is the tell: check 5 asserts that a
  FILTERED port answers word for word as a STOPPED one, and two identical env errors satisfy that
  equality perfectly. Any check whose claim is "these two answers are the same" passes hardest when
  the server has stopped answering at all. Hit 2026-08-31. Read a failing wire-check's DETAIL column
  before believing the score, and treat a uniform `not_configured` as an env fault, never a product
  one.
- **A same-arity signature change is INVISIBLE to `tsc`.** Re-keying
  `computeInnerGatewayId(ownerKey, octet)` to `(essid, octet)` still typechecks at every call
  site, because a key and an ESSID are both `string`. The compiler is a reliable sweep only for
  arity changes; for a same-arity re-key, grep every call site — otherwise the wrong argument
  silently computes a wrong id, and the failure surfaces as ~35 unrelated-looking test
  failures. The same trap sits in the `scripts/` wire-checks, which `tsc -b` does cover but
  cannot help with here.
- **Don't run Stryker and `npm run lint` / `vercel dev` at the same time.** The in-flight
  `.stryker-tmp/sandbox-*` is inside the lint root, so `npm run lint` reports hundreds of
  `@ts-nocheck` errors from generated code that vanish when the run finishes; the same sandbox
  churn can crash `vercel dev`'s functions (`exit code 3221225794` = Windows
  `STATUS_DLL_INIT_FAILED`). Both usually clear up on their own — re-check before believing
  either. **But "usually" is not "always": a sandbox can be left behind** (a killed or
  timed-out run, or several scoped `--mutate` runs in a row), and then `npm run lint` keeps
  failing with hundreds of errors in paths under `.stryker-tmp/sandbox-*` that are not yours.
  Read the paths in the lint output before debugging your own diff; the fix is
  `rm -rf .stryker-tmp`. It is gitignored, so nothing is at risk.
- **`commandRegistry.get(name)` is NOT the command module's export.** `registry.ts` wraps every
  non-builtin command in `gate()` (binary check outside, library check inside), so the map holds
  a wrapper. Two consequences that both look like bugs in your own code:
  `expect(commandRegistry.get('curl')).toBe(curl)` fails with *"Compared values have no visual
  difference"* — which reads exactly like a duplicated module instance and is not one; and
  executing the registry's entry runs the **binary gate first**, so a test tree without
  `/usr/bin/<name>` gets `bash: <name>: command not found. Install with: apt install <name>`
  rather than the command's own output. A command test that goes through the registry has to
  install the binary (`BINARY_STUB`, world-executable, as `apt` stamps it); one that goes
  straight to `command.execute` does not. Assert registration by BEHAVIOUR — run it and check
  what it does — never by identity.
- **`vercel dev` injects cloud-scoped env vars at runtime.** If a local function sees cloud
  values despite `.env.development.local`, suspect Vercel's "Development" scope first — uncheck
  Development on local-only vars so `vercel dev` doesn't inject them.
- **Supabase local CLI uses `sb_publishable` / `sb_secret` keys**, not legacy
  anon/service_role JWTs. Function code reads them under the existing `SUPABASE_*_KEY` env
  names; `@supabase/supabase-js` accepts either format.
- **Prod shares the dev Supabase until launch** (legacy note — v2 has its own Supabase
  project). DB resets affect prod until a dedicated prod project is cut over at launch.
- **Windows case-only `git mv` clobbers import edits.** A case-only rename + same-change
  import edits can ship a PascalCase filename with lowercase imports; `tsc`/tests pass on
  Windows but break on Linux/Vercel. Grep-verify import casing after any case rename.
- **The terminal runs commands SERIALLY** (`runInput` → `commandChain` in `ui/state.ts`). Do
  NOT reintroduce concurrent `runInput` — it races on a stale FS view. Since the busy bar
  landed, the prompt input is UNMOUNTED for the whole of `executeLine`, so type-ahead is no
  longer reachable from the UI at all; `commandChain` stays as the guarantee for programmatic
  submissions (and for the microtask between submit and execute).
- **A command is still running after its last output line paints.** `executeLine` streams the
  final line, then awaits `exitCode()` — so a Terminal test that submits the next command
  straight after `findByText(<last line>)` now hits the busy bar instead of an input and fails
  with "unable to find role textbox". Await the prompt's RETURN as well (`awaitPrompt()` in
  `Terminal.test.tsx`), and await it AFTER the output line — called immediately after
  `runCommand` it resolves against the prompt the command has not taken over yet.
- **An apt-installed binary is ABSENT for the first few ticks of a game.** `startGame`
  fire-and-forgets the journal refetch (`void refetchPatches()`), and an installed tool lives in
  that journal — so a `ui/state` test that stubs `fetch` to serve `/usr/bin/<tool>` and then runs
  the tool immediately gets `bash: <tool>: command not found. Install with: apt install <tool>`,
  and the assertion fails on a downstream symptom (a mode that never opened, output that never
  arrived) rather than on the real cause. Wait ONE macrotask before the first command:
  `await new Promise((resolve) => setTimeout(resolve, 0))`. That is an ordering guarantee, not a
  sleep — every promise in the refetch chain is already resolved and none waits on a timer or
  real I/O, so the microtask queue drains completely before any macrotask runs. Don't reach for a
  polling `waitFor` here, and don't lengthen the delay: if one tick is not enough, something in
  the chain has started doing real work and that is the thing to look at.
- **Coming back online in a test needs BOTH halves, not just the ESSID.** `restoreConnection`
  returns the COLD state unless the stored ESSID *and* a remembered lease are present, so a test
  that seeds only `CONNECTED_ESSID_KEY` starts offline and every network command answers
  `network is unreachable` — which reads as a broken command rather than a broken fixture. Seed
  the lease too: `lanLeaseCacheIn(storage).remember(essid, ip)` before `startGame`, with an
  address no generated host occupies. This is the unit-test twin of the wire-check rule below.
- **A wire-check clean-slate must clear PERMANENT tables, not just the per-session ones.**
  `network_lan_leases` deliberately outlives occupancy, so a script
  that only deletes `home_network_occupants` leaves a lease holding an octet forever. Every
  re-run then either fails its `UNIQUE (essid, octet)` insert (silently — the scripts don't
  check insert errors) or forces the allocator to redraw, which moves an address the script
  hard-coded. Symptom: a script passes alone and fails in the full sweep, or passes once and
  fails on the second run. Delete the lease rows in BOTH setup and teardown.
- **A wire-check that seeds occupancy directly must seed the lease too.** A real join
  allocates the lease BEFORE writing the occupancy row, so occupancy-without-lease is a state
  the server never produces — and since 3b-i the handlers refuse it (`not_an_occupant`: you
  hold no address here). Scripts that join through the real endpoint should read the issued
  lease back rather than re-deriving an address.
- **`nmap` scan targets: `X.Y.Z.1-254`, not `X.Y.Z.0/24`.** CIDR is not a parsed target form —
  `parseScanTarget` returns not-ok, the handler quietly logs nothing, and a test asserting
  "nothing was traced" passes for the wrong reason. If a scan test asserts an ABSENCE, first
  prove the target parses by asserting a presence with the same string.

---

- **Every `api/*.ts` file is a Vercel ENDPOINT.** There is no `vercel.json`, and `api/` holds
  exactly `network.ts`, `patches.ts`, `sessions.ts` — three files, three serverless functions. A
  helper module dropped in there (`api/deps.ts`, `api/shared.ts`) does not just sit quietly; it
  publishes a bogus function. Shared server-side helpers belong at module scope inside the endpoint
  that uses them, or somewhere outside `api/` entirely.
- **`upsert(row)` and `upsert(row, { onConflict: 'machine_id,path,writer_key' })` are equivalent on
  `patches` — but only by coincidence of the schema.** PostgREST defaults its conflict target to the
  primary key, and `20260614130000_patches_shared_journal.sql` made that PK exactly that triple.
  `api/sessions.ts` now spells it explicitly everywhere (v0.119.0): the explicit form documents the
  dependency instead of relying on it silently, and it stops a future reader "fixing" the wrong copy.
- **One spelling per query in `api/sessions.ts`** (PR #372). Ten signed actions share that endpoint,
  and each used to build its supabase dependencies inline — six copies of the journal column list,
  seven of the auth.log read. **A column name is a string `tsc` cannot check**, so a read that
  drifted in one action shipped green through every local gate and surfaced only in whichever
  wire-check happened to cover it. Ten module-scope factories (`findPatchesVia`, `readAuthLogVia`, …)
  now own one query each; add a seam by calling one, never by pasting a query.
  - The operator label is an **argument**, not a casualty: `logFailure` emits
    `[sessions] <label> error:`, and with ten actions sharing one function log that label is the only
    thing saying which failed.
  - Three single-use builders stay inline where they are used. They had nothing to deduplicate, and
    hoisting them would relocate mechanism rather than remove it.
  - `insertSessionVia` takes the **union** `SessionRow | AuthSessionRow | SuSessionRow`, not a type
    parameter: a generic cannot flow into supabase's `insert`, and a function accepting the union is
    assignable to each narrower dep by parameter contravariance — so it needs no cast.

**Two players NEVER share a WiFi neighbourhood, so they never meet on a gateway.** Each player's
scan is generated for them: D10 slice 5's close-out minted a second identity and its `airodump-ng`
returned seven ESSIDs with not one in common with the first player's six. Since the AP gateway's
machine id derives from the ESSID, two players connected to "their" networks are on different
gateway machines. The ONLY cross-player route is the public-IP path — the other player's public IP,
a forward, a service, a cracked credential — which is the whole D1/D2/D5 loop. Budget for that
before promising a close-out beat that needs one player to see another's box, and reach for a direct
journal query (§5) when what the beat actually proves is what got STORED.

## 5. Wire-check infrastructure

`api/` runtime correctness (DB columns, constraints, the signed-envelope path) is not
caught by `tsc`, so each `api/` path has a `scripts/test*.ts` wire-check that drives the
real endpoints against `vercel dev` + local supabase.

- Prereqs: local supabase (`http://127.0.0.1:54421`, per `supabase/config.toml`) + `vercel dev`
  (port 3100) both up (see the 3100 gotcha above). "Serving" = an empty `{}` POST returns 400
  (not 502/000).
- **Send that probe with `curl.exe`, not Windows PowerShell's `Invoke-WebRequest`.** On
  2026-09-11 `Invoke-WebRequest -Method POST -Body '{}'` got an empty-bodied **500** from every
  endpoint while `curl.exe -X POST -d "{}"` got the healthy `400 {"error":"envelope_invalid"}`
  from the same server. GET answered 405 either way, which is the tell that the handler is up and
  only the POST is wrong. A 500 there reads exactly like the `not_configured` fault below, and
  restarting a stack that was never broken is the cost of believing it.
- **Start it with `npm run vercel:dev`, never a bare `npx vercel dev`.** That script is
  `dotenv -e .env.development.local -- vercel dev --listen 3100`, and the dotenv wrapper is
  load-bearing: `vercel dev` does NOT read `.env.development.local` into the function runtime by
  itself, so a bare invocation serves happily on 3100 while EVERY request returns
  `500 {"error":"not_configured"}` from the `SUPABASE_URL`/`SERVICE_ROLE_KEY` guard. The tell is
  that `{}` returns 500 instead of 400 — check that before blaming the seed data or the handler.
- **`.env.development.local` must set `JSHACK_ADMIT_LAB_NETWORKS=1`.** The server refuses a
  join to any network outside Ridgemont or undeclared by the world
  (`403 network_not_joinable`), and most wire-checks join a made-up network (`LEASE-TEST-NET`,
  `MYSQL-LAB-3`, …) so each run starts on a gateway nobody has written to. The flag admits the
  undeclared ones on local `vercel dev` only; another town's networks stay refused. It is set on
  neither Preview nor Production, so a wire-check pointed at a deployment gets 403 on every
  lab join. Only the exact value `1` counts.

**Windows can silently reserve supabase's whole port block.** Symptom: `npx supabase start`
reports success and `npx supabase status` prints the usual URLs, but every request to the REST
API returns `000`/`fetch failed` — and `docker ps --format '{{.Names}}\t{{.Ports}}'` shows the
containers with **no host port mapping at all** (`8000/tcp`, not `0.0.0.0:54421->8000/tcp`). A
restart then fails outright with *"bind: An attempt was made to access a socket in a way
forbidden by its access permissions."*

Cause is not Docker: Hyper-V/WinNAT grabs dynamic TCP ranges at boot, and `54352-54451` covers
every port in `config.toml` (54420-54429). Confirm with:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

Two fixes. The proper one is `net stop winnat; net start winnat` from an **elevated** shell,
which releases the reservations. Without elevation, temporarily remap the ports in
`supabase/config.toml` **and** `SUPABASE_URL` in `.env.development.local` to a block above the
highest excluded range (55600+ was clear), `supabase start`, **restart `vercel dev`** so it picks
up the new URL, run the check, then restore both files. Back them up first — reverting from
memory is how a temp port ends up committed.

The remap path was walked again on 2026-08-09 and works exactly as written; three details worth
having. `net stop winnat` answers **"Access is denied"** in a normal shell — that is the missing
elevation, not a broken service, and it is the cue to take the remap path rather than hunt for a
service problem. Neither CLI is installed here, so drive both through npx (`npx -y supabase start`,
and `npm run vercel:dev`, which resolves `vercel` from `@vercel/node`). `supabase stop
--project-id jshack-me` before remapping, or the old containers linger on the old ports.
Restore by copying the backups back and confirm with `git status` — `config.toml` is TRACKED, so a
forgotten temp port is a committed one.

**Check the ranges before assuming you need the remap — they are re-drawn on every boot.** On
2026-08-13 the reservations had moved to `59635-60720` and the whole 544xx block was clear, so the
remap was unnecessary. Two minutes of `netsh interface ipv4 show excludedportrange protocol=tcp`
beats editing two tracked-adjacent files on faith. The reverse also bites: containers left running
from a remapped session **auto-restart on the old ports** while `config.toml` says otherwise, and
the mismatch reads as a dead stack. `docker ps --format '{{.Names}}\t{{.Ports}}'` shows it at once;
`supabase stop --project-id jshack-me` then `start` rebinds them to whatever the file now says.
- Run: `npx dotenv -e .env.development.local -- npx tsx scripts/<name>.ts`.
  Exits 0 on all-pass.
- The script seeds the DB via the service-role client, drives the endpoints, asserts, and
  cleans up. Examples: `testDeepChainReach.ts`, `testDeepSwitchChain.ts`,
  `testSameLanConnect.ts`, `testRouterBrick.ts`, `testHttpFetch.ts`.

**A wire-check that asserts on a SHARED machine's journal must clean that machine at SETUP and
assert on the DELTA.** Both halves were wrong in the first draft of the deep hydra check and each
produced a green PASS on its own:

1. *Stale rows outlive the run.* Deep hosts, gateways and AP boxes are ESSID-seeded, so their
   `machine_id` is identical across runs even though each run generates a fresh identity. The
   trace assertion passed against an auth.log row written the PREVIOUS DAY, while every other
   check in the same run was failing. Cleaning up at the END is not enough — a crashed or
   half-failing run leaves rows the next run reads as its own. Delete the target machine's
   patches at setup, not only at teardown.
2. *A sibling path writes the same sentence.* `ssh` and `hydra` both append
   `Failed/Accepted password for <user> from <ip>` to the same file on the same box, so an
   `includes()` over the whole log is satisfied by the ssh checks that ran earlier in the script
   regardless of whether the sweep wrote anything. Snapshot the content before the action and
   assert on `after.slice(before.length)`.

The general rule: an assertion that would pass if the code under test did NOTHING is not a check.
On shared, deterministically-named machines that is the default outcome, not an edge case.

**The 45 checks are individually clean and NOT sweep-safe — run them one at a time.** Driving
the whole directory back-to-back in one loop produced three RED scripts
(`testCrossPlayerConnectionTrace` 3/7, `testCrossPlayerRead` 6/7, `testCrossPlayerRouter` 6/8)
that were **7/7, 7/7 and 8/8 when each was run alone**. Nothing was wrong with the code or the
checks: this is the stale-row rule above at suite scale. Machines are ESSID-seeded, so scripts
share `machine_id`s and gateway journals, and each one's setup-time cleanup only covers the machines
IT knows about. A close-out sweep is therefore a series of individual runs, and **a RED from a
back-to-back loop must be re-run alone before it is believed** — the count in a sweep report means
"scripts that passed individually", not "scripts that pass in sequence".

**`testDeepChainReach` poisons its own next run — it is not even RE-RUN-safe.** Its last check
bricks an intermediate gateway, and the brick is a row that outlives the process. Run it a second
time and the same gateway is already bricked, so every earlier step fails `403 no_session` while
the brick check itself passes — 1/6, with the one PASS being the tell. This survives a
`supabase stop`/`start`, because stopping backs the data up to the docker volume and starting
restores it: **a database is weeks old unless somebody reset it.** `npx supabase db reset` returns
it to 6/6. A red script whose FINAL check leaves state behind should be suspected of this before
it is suspected of a regression — and the test that settles it is a reset, not a re-run.

**Selecting a generated LAN host by "not `.1`" picks an INNER GATEWAY, not an ordinary box.**
`generateHomeLan` returns `kind: 'machine' | 'router' | 'switch'` in ascending-octet order, and a
router or switch above `.1` is an inner gateway whose base FS is a ROUTER tree — not the
`buildRemoteHostFs` box an "NPC host" check means. `testRemoteAptInstall.ts` was written with a
`!ip.endsWith('.1')` filter and silently asserted against `core-rtr` (`inner-gw-…`); it passed, so
nothing pointed at the wrong tree. **Select on `kind === 'machine'`** for an ordinary sibling, and
use `isInnerGateway(host)` when a gateway is what you actually want. The two resolve through
different arms of `resolveTargetBaseFs`, so a check on one proves nothing about the other.

**SEED INSERTS MUST FAIL LOUDLY — a rejected seed is a check that tests nothing.** A bare
`await sr.from('patches').insert([...])` swallows its error, so a row the schema refuses leaves
the scenario un-built while the check still runs and "passes" against the *unmodified* world.
This cost real time in `testHttpFetch.ts`: two bricking checks returned 200 because the tombstone
rows were rejected and nothing was ever bricked. Wrap every seed so a failure exits:

```ts
const seed = async (table: string, rows: readonly Record<string, unknown>[], label: string) => {
  const { error } = await sr.from(table).insert(rows);
  if (error) { console.error(`FATAL: ${table} insert (${label}) failed:`, error.message); process.exit(1); }
};
```

**A RUNNER that reads the wrong exit code reports a false pass** — the same lesson one layer out.
There is no committed all-checks runner, so running the suite means an ad-hoc loop, and the obvious
shape is wrong:

```bash
out=$(npx dotenv -e .env.development.local -- npx tsx "$f" 2>&1 | tail -2); code=$?   # WRONG
```

`$?` after a pipeline is the LAST stage's status — `tail` always succeeds — so every script counts
as passing and the loop cheerfully prints `32/32`. Assign without the pipe and capture `$?` on the
next line (or read `${PIPESTATUS[0]}`). Hit on 2026-08-10; the false `32/32` was caught only because
the number looked too good for a run that included a just-changed resolver.

**A wire-check that reaches a network by address stands on a declared network** and aims at
`publicAddressOf(key)` (`scripts/publicAddressOf.ts`), the address the world derives, never a
hand-written one. A lab network (`LEASE-TEST-NET`, `MYSQL-LAB-3`, …) has no public address, so it
serves only checks that use a network's own machines. An address where nobody answers is a `.1`
inside a declared block (`87.1.0.1`, `193.0.0.1`): no network ever answers at a `.1`.

The rule replaced a stored-address fixture whose silent failures cost real time on 2026-08-09:
`testRouterBrick` (6/10) and `testCrossPlayerRouter` (7/8) sat at a **false red** that read exactly
like a NAT-forward regression, because a stale row held the ESSID at a different address and the
seed insert was swallowed. **A red wire-check is not evidence of a code regression until its
fixture is proven to have been built.**

**The specific trap behind that one: a `/boot` tombstone keeps `node_type: 'file'`.** `content:
null` is the deletion marker; `node_type` is NOT NULL, so an explicit `null` there is a rejected
row rather than a brick. (`testBrickedDark.ts` says so in a comment — worth reading before
hand-rolling tombstone rows.)

Live browser E2E (agent-browser vs `vercel dev`) is covered by the project skill
**`e2e`** (`.claude/skills/e2e/SKILL.md`) — load it before writing any agent-browser
command. It holds the preflight, recipes for reaching a given in-game state (fresh player →
connected with nmap; a shell on the AP gateway; the two-identity cross-player loop), the
terminal/nano DOM quirks, and how to derive seeded secrets offline. Add a recipe whenever a
state costs you more than one wrong attempt.

---

## 6. Architecture invariants

- **Generated content obeys the world-content rules.** Any change that writes into a generated
  base tree follows [`world-content-architecture.md`](./world-content-architecture.md) "The
  rules": never a player workstation, never a working in-game secret, every in-network reference
  true, version-free (no decimal that reads as a version), history only in `.1` rotations ending
  at `WORLD_EPOCH`, and **a new concern draws on a new stream** — adding a draw to an existing
  one re-rolls everything after it, including pinned passwords. Prove the last with the world
  byte-diff that doc describes.

- **Spend realism where the player READS; spend legibility where the player AUTHORS.** The rule
  that settled the long-running "is `rules.v4` too simple, or is SNMP too complex" question at
  v0.195.0 — the two are not on one axis, and neither had to move toward the other. A player
  never types an OID line, so `snmpwalk`'s block can afford texture a real tool would have; a
  player DOES hand-author `/etc/iptables/rules.v4` in `nano` against a LENIENT parser that skips
  malformed lines in silence, so real `iptables-save` grammar there would turn one wrong character
  into no error and no effect. That file's seed header is a tutorial (`# One rule per line:
  forward <public_port> to <internal_ip>:<internal_port>`) and it only works because the grammar
  is one line. Neither is a placeholder awaiting realism; ask which side of the read/write line a
  surface sits on before adding fidelity to it.

- **What a walk PRINTS is what a set TAKES, on every line.** `snmpwalk` used to render
  `NAT-MIB::natForward.2222` while `SET_OID_RE` accepted `natForward.2222` alone, so a player
  pasting the device's own output back was refused with `noSuchName (The name does not exist in
  the MIB)` — for a name the device had just printed, naming a MIB module it never showed them.
  The module prefixes and the type column are gone for that reason rather than for taste, and
  `snmp/walk.ts` is the single owner of every object name (`forwardOid`, `aclPortOid`,
  `inputPortOid`) precisely so the read and the write cannot drift apart again. `set.ts` and the
  server's own `OBJECT_OF` refusal both spell a name by importing it from there — never inline.
  The port table's name is `forward`, matching the verb `rules.v4` already uses under `nano`: one
  fact reached two ways does not need two words.

- **What a generated box IS gets DERIVED, and read back off its NAME — nothing about a role
  travels.** `generation/machineRole.ts` draws the role from the box's coordinates; everything
  downstream — `hostServices`, the `/etc` config, the page it serves, the account it carries —
  reads it BACK off the hostname through the one reverse lookup, `pools/hostnames.ts`'s
  `roleOfHostname`. Not as an optimisation: re-deriving is impossible at that layer, because a
  deep-layer NPC's role is drawn from `${essid}-${parentMachineId}`, a seed the host-fs builder
  cannot see. Two consequences. **The prefix pools are load-bearing** — renaming a prefix silently
  re-roles every box wearing it, and `DEVICE_TYPES` is the `workstation` pool itself rather than a
  copy, so it is not edited casually. And **a name no role claims is an ordinary case, not a gap**:
  such a box draws a generic account, keeps no `/etc` config, and serves the general page. Every
  role-keyed lookup has to answer for `undefined`, and the honest answer is usually a fallback
  rather than a guard.

- **`prng.pick` consumes exactly ONE `next()` whatever the pool's width — which is what let an
  epic of content ship for free.** `pick` is `items[nextInt(0, items.length - 1)]`, so replacing a
  flat pool with a role-keyed one of any length leaves the stream identical and every value drawn
  after it exactly where it was. Adding a DRAW does the opposite: it re-rolls everything
  downstream, and in the LAN generator's stream that moves the NPC octets `api/network.ts` feeds
  the lease allocator as an exclusion set — issuing an occupant an address an NPC already holds.
  Hence the rule every content pool follows: **new content takes its OWN seed stream**
  (`etc-config-…`, `web-page-…`, `backdoor-…`), never an append to a shared one.
  - **The one exception is the opposite of what it looks like.** The NPC username is drawn from
    the host-fs stream immediately before the three passwords, so `pickUsername` takes the
    CALLER's prng rather than a seed of its own — giving it one would REMOVE that draw from the
    sequence and re-roll every credential in the world. D5b's plan had this backwards and booked
    the re-roll as an accepted cost; measuring the generator says it was never charged. A test in
    `remoteHostFs.test.ts` holds it hash for hash against the nameless box at the same address.

- **Five tables key off `DrawnRole`, and they are five tables on purpose.** Hostname prefixes,
  service placement, `/etc` configs, web pages and usernames share a key and nothing else: the
  cells are a string list, a per-service probability record, a filename-plus-templates record, a
  sparse string list and a string list with its own fallback; two are sparse and three total; and
  no requirement moves two of them at once, because adding a hostname prefix implies nothing about
  accounts. Merging them was assessed when the fifth landed and declined — it would create one
  table every generation module depends on, with every cell typed separately anyway. The shared
  key is `DrawnRole`, and that already has one home.

- **Generated content may not claim what the game cannot honour.** Four forms of one rule, each
  learned by shipping the violation first. A page must not **link a path its host does not serve**
  (`/admin/`, `/metrics` — the recon the page invited always dead-ended). A page must not **hint at
  a mechanic that does not exist** — "default password unchanged" sends a player after nothing, the
  same sin as the dead link. A config or an account must not **name a daemon this world cannot
  run**: legacy put `postgres` under a `mysql.cnf` and `samba` beside a `vsftpd.conf`, and an
  account is weaker evidence than a config stanza but is read the same way. And **no account name
  belongs to two roles**, the generic pool included — a name that could have come from two kinds of
  box is not evidence, which is the whole reason the pool is keyed.

- **A daemon is a DESCRIPTOR, not a module — adding one is a catalog row plus a `Daemon`.**
  `commands/daemon.ts` is one implementation behind four front doors (`sshd`, `vsftpd`, `nginx`,
  `apache2`); it was three near-identical modules until D4 slice 0 collapsed them. The descriptor
  carries only what differs — the command name, the catalog row it binds, the `Starting <banner>`
  line, the already-running wording, availability, and the manual prose. The gate ladder
  (**root → port validity → already-running**, in that order), the pidfile write, the
  `STARTUP_DELAY_MS` beat and the streamed shape are shared, because a second door that refused
  differently from the first would be a second set of rules to learn for no gain. Do not add a
  fifth daemon module; add a row to `DAEMONS`.
  - **A catalog row that NAMES a daemon is a claim `DAEMONS` has to honour, and nothing checks
    that they agree.** `redis` declared `daemons: ['redis']` from D7 slice 1, so the binary landed
    in `/usr/sbin` and `which redis` answered — while `DAEMONS` had no entry, so
    `systemctl start redis` did nothing whatsoever. The two tables sat out of step for five slices
    with nothing to notice, because until a player had to START one, nobody ever had.
    **It then happened AGAIN one table further along, and shipped.** `DAEMONS` was fixed; the
    `UNITS` table in `systemctl.ts` — a THIRD declaration of the same fact — was not, so
    `systemctl start redis` answered `Unit redis.service could not be found` on a box where the
    store was installed and the bare `redis` command started it fine. Caught by playing the game
    on 2026-08-26, not by a test: no test in `systemctl.test.ts` named redis, and every other
    player-facing path worked. Fixed at v0.183.0. Three tables now state which daemons exist
    (`SERVICE_CATALOG[...].daemons`, `DAEMONS`, `UNITS`) and NOTHING enforces that they agree —
    when the sixth door lands, add all three in one change and assert the unit, because the gap
    is invisible from every direction except the idiomatic one a player actually reaches for.
    **`systemctl.test.ts` now holds that check** — three assertions comparing NAMES, so a failure
    says which daemon is stranded and in which table: every daemon a package installs can be
    started, every daemon that can be started can be stopped, and every catalog door names a
    daemon a player can act on. Both historical bugs were re-injected to prove it bites. D8 should
    add its `DAEMONS` and `UNITS` rows in the same change as the catalog row and let the guard
    confirm it, rather than discovering the gap months later through a player's own hands.
  - **`hostServices` governs `machine` hosts ONLY — an offline oracle built on it will invent
    doors the game never shows.** `resolveLanHostIdentity` has four branches (edge router at `.1`,
    inner-gateway router, switch, machine) and only the machine branch runs the `remoteHostFs`
    builder that turns a placement into pidfiles and a datadir. Routers and switches get
    `buildRouterBaseFs`/`buildSwitchBaseFs` and never consult the placement table at all. A scan
    reads the host's actual filesystem, not the table — so the two cannot disagree in the player's
    view. Cost a false defect report on 2026-08-26: an oracle that called `hostServices` for every
    host measured "33% of advertised redis doors have no store", all of them routers or switches;
    the live scans showed no `6379` on any of them. Restricted to `machine` hosts — the only kind
    that consumes it — advertised and furnished agree **29/29, zero bare**. When writing an oracle,
    filter to `kind === 'machine'` or read the same filesystem the game reads.
  - **`nginx` and `apache2` are two programs for ONE service.** They bind the same `http` catalog
    row (apache2 through `otherPrograms`), each with its own pidfile, so whichever starts first
    owns the port and the other is refused. The refusal names the CONFLICT ("web server already
    running"), never the program, because "apache2 is already running" is false when nginx was
    the one that came up. What is DATED and FIRED is the running program's package, never the
    row's (`vulnerability-architecture.md` "One service, two programs: the web").
  - Real Unix reserves ports below 1024 for root, which is tempting to model here. Don't: the root
    gate fires before a port is ever parsed, so the rule would be an unreachable branch.
- **`pidfile.ts` owns the ONLY answer to "what is running here".** `readRunningProcesses` walks
  `/var/run` and is the single policy; `readOpenPorts` is a projection of it for callers that want
  a port scan's view, and `daemonName` is the name both the pidfile line and `ps`'s COMMAND column
  use. A second walk anywhere would let a scan of a box and a survey run on it disagree about what
  is up. Two rules that live there and must not be re-litigated per caller: an unrecognised
  `/var/run` entry is skipped, and a **DIRECTORY** wearing a pidfile's name is not a running daemon
  — `mkdir /var/run/sshd.pid` is something a root player can really do, and reading it as a service
  would let anyone fake a serving box, or bar their own door, with one command.
  - **`/var/run` holds a UNION, and a listener joined it as a variant rather than a catalog row.**
    D5's `nc -l` backdoor is a `RunningProcess` of `kind: 'listener'` beside the daemons — it has
    no service to bind, no banner to serve and no `SweepLog`, so a `SERVICE_CATALOG` row would have
    been four empty columns and a fifth door for every consumer to special-case. The projection is
    what keeps the two honest: `nmap` shows a listener's port `open` with SERVICE `unknown` for
    free, because it reads the same walk.
  - **A listener's PID is DERIVED where it is consumed, never stored.** `listenerPid(machineId,
    port)` computes it; `readRunningProcesses` keeps its one-argument signature and returns no
    `pid`. Storing one would let a planter's own client author the number a defender then types,
    and would fan the machine id through `readOpenPorts`, which has no use for it. **`kill`
    therefore resolves a pid by matching `listenerPid` across the walk, not by reading a field** —
    and must check the `kind` discriminator first, or it reports success for a `/var/run/nc-22.pid`
    that never existed and tells a defender they shut a door that is still open.
- **`systemctl` has one unit per PROGRAM.** `nginx` and `apache2` are two units for the one
  web port, each titled with its own systemd description (`apache2.service - The Apache HTTP
  Server`), as real systemd has them. `systemctl stop nginx` while apache2 runs answers that nginx
  is inactive and stops nothing, so a stop can never claim a program that was not running.
  (Until v0.331.0 both names resolved to one shared `nginx` unit.)
  - **Resolving a unit checks the BINARY, or `systemctl` is an apt bypass.** The binary gate lives
    on the `nginx`/`apache2` commands; delegating around it would open port 80 on a box that never
    installed a web server. `unitFor` gates on `binaryExists`, which is also what makes the
    unknown-unit and not-installed answers collapse into one sentence — told apart, they would let
    a guest enumerate a box's packages by probing.
  - **`systemctl` never calls `popSession`.** A stop shuts the door without emptying the room:
    live sessions survive and only new logins are refused, as real sshd does.
- **A service is a UNIT and a listener is a PROCESS — that is why there are two verbs.**
  `systemctl stop <name>` is the only way to shut a daemon and `kill <pid>` the only way to remove
  a backdoor, and neither answers for the other: `ps` prints `-` in the PID column for a service,
  so no number a player can type resolves to one, and `kill sshd` answers
  `kill: sshd: use "systemctl stop sshd"` — echoing the name AS TYPED, because each program is
  its own unit and naming any other would hand the player a program they never mentioned. **`kill` checks argument shape before privilege**, so a guest gets the
  pointer rather than a root refusal that would be advice they cannot take. Success is silent, as
  the real thing is. The split is not arbitrary: sshd forks a child per session, so a stop leaves
  the room full, while netcat is the one process that both listens and serves — which is why only
  `kill` evicts.
- **The admin tools are planted, not apt-installable.** `systemctl` ships in `/usr/bin` on every
  machine via `SERVICE_CONTROL_TOOLS` — a box you have rooted must be controllable with what is
  already on it, or stopping a service would depend on the box having internet. `ps` was already in
  `SYSTEM_UTILITY_NAMES` (`/bin`), and note it **also links `libpcre`** in the legacy-inherited
  `libraryDeps` map, so it sits behind the linker gate as well as the binary one. Both are
  world-executable and gate on root at RUNTIME where a rule exists at all.
- **A cross-player read is a PROJECTION of what the viewing session may see, not the box.**
  `resolveCrossPlayerFs` returns a tree filtered by the viewer's tier: `/root` is simply absent for a
  guest, and taking guest read off a directory removes that directory from that viewer's tree
  entirely. So "absent from a cross-player tree" means "invisible to this tier", NEVER "not on the
  machine" — and a wire-check asserting absence has to say which tier is looking. D10 slice 4 lost an
  hour to a check that read `tmp=absent` and looked exactly like a dropped patch; the patch had
  worked, and B had locked itself out with its own `chmod`. The disappearance is now the assertion,
  with a restore step proving the contents were there all along.
- **`patches.write` stamps the SESSION as owner unless the caller names one, and resets permissions
  to the tier defaults unless the caller passes them.** Right for every writer that means "this is
  mine" — `nano`, `touch`, a `>` redirect — and a trap for any writer that edits somebody else's
  file: root moving one bit on a user's file would silently transfer it, and a rewrite that omitted
  `permissions` would reset the node while claiming to change one thing. Any new writer over an
  EXISTING node must pass `owner: node.owner` and explicit `permissions`, and name `baseContent` so a
  fellow occupant's edit is refused rather than reverted.
  **Omitting `permissions` means "keep" only on the SERVER.** A fire the server lands
  (`exploitCreateSession.ts`, `exploitLocalElevate.ts`) sends an overwrite's row without them and
  the fold keeps the file's own; the client adapter (`createPatchApi`) instead fills in the shell
  tier's defaults. `msfconsole --local` copied the server's shape onto `env.patches.write` and reset
  the mode of every file it overwrote until v0.348.0, so on the client an overwrite names them.
- **The shell's `>>` is the model append (`runLine.ts` `applyAppend`).** It validates the target
  against the held tree BEFORE the command runs (as `>` does), then composes on the MACHINE
  (`fs.reload()`), keeps an existing node's owner and permissions, and names `baseContent`, so a
  raced write is refused with `File changed on disk`. It separates with ONE `\n` unless the base is
  empty or already ends in one — every file here, generated ones included, ends WITHOUT a newline,
  so a raw append would weld the first new line onto the last old one — and a command that printed
  nothing appends nothing. A file the session may write but not read refuses rather than composing
  on an empty base; no generator makes one (`boxSurface.test.ts` holds that across the world).
- **Adding a method to `PatchApi` is a dozen-file change, and one of them is production.** The type
  is implemented by ad-hoc object literals in ~11 test files (each a type error until it gains the
  method) plus `mockPatchApi` in the factory — but the one that matters is `ui/state.ts`, where every
  method is wrapped in `afterWrite`. Miss that wrapper and the write persists while the local
  journal, the served root and the other tabs never hear about it, so the change appears only after
  a reload.
- **A command whose name predates its implementation inherits gates it never declared — check
  BOTH lists before writing its tests.** `find`, `strings` and `chmod` were stamped into
  `SYSTEM_UTILITY_NAMES` and listed in `COMMAND_LIBRARY_DEPS` long before any of them existed,
  because generation and the library-CVE chain were ported from legacy's full command set. So the
  moment `find` was registered its tests went red a second time with
  `find: error while loading shared libraries: libpcre.so` — nothing wrong with the command, a
  `/lib` missing from the test tree. Two consequences worth knowing up front: a test tree for one of
  these needs `/bin/<name>` AND `/lib/<dep>.so`, and `rm /lib/libpcre.so` is a live way to break
  `ls`, `cat`, `grep`, `find`, `strings`, `chmod` and `ps` in one stroke.
  **But the reservation is not universal — check, do not pattern-match.** `node` and `gpg` are
  deliberately absent from `SYSTEM_UTILITY_NAMES` (`binaries.ts` says so in a comment) and live in
  the apt catalog instead, so they install rather than ship. Three slices in a row finding their
  binaries pre-stamped made that look like a rule; it is not.
- **A need that belongs to a FORM rather than to a command is declared as a function, not a
  string.** `withoutScript` (since `nc`) and `withoutTty` (since `gpg`) both accept
  `(args, flags) => string | undefined`, answering `undefined` for the form they permit. `nc -l`
  plants a listener and returns, so a script may run it while the connect form hops; `gpg -c f pass`
  asks nobody anything, so a pty-less backdoor shell may run it while the prompting form cannot.
  Both rules are evaluated by ONE shared helper each — `refuseFromScript` in `commandContext.ts`,
  `refuseWithoutTty` beside `hasTty` in `runLine.ts` — because the shell and the script path both
  enforce them, and two copies would let a script reach a prompt a player could not.
- **`Command.availability`, `Command.tier` and `Command.description` are DOCUMENTATION — nothing
  reads them at runtime.** The binary gate resolves `/bin`, `/usr/bin`, `/usr/sbin` by the command's
  NAME, and the `apt install <pkg>` hint comes from `packageForBinary(name)` reading the apt
  catalog, so `availability: { kind: 'installed-package', packageName: 'gpg' }` changes nothing if
  it is deleted. `types.ts` already admits this happened to `AvailabilityRule`; D10 slice 5's
  mutation run measured it (five survivors, all on those three fields, all unkillable by any
  behaviour test). Two consequences: do not write tests asserting those literals — that is coverage
  theatre — and do not trust a declaration to enforce anything. Gating is filesystem-driven, by
  design, so removing a binary is what makes a command not-found.
- **`env.fs` is a POINT-IN-TIME SNAPSHOT. A command that patches and then re-reads sees the
  world as it was before its own write.** `buildCommandEnv` calls `createFsView(args.root, …)`
  once, with `root: activeRoot()` evaluated at build time — the comment on `commandChain` in
  `ui/state.ts` says so outright, and command execution is serialized precisely so the next
  command gets a fresh one. Within a single command the snapshot never moves. Any gate that
  re-reads `env.fs` after an `env.patches.*` call is therefore reading stale state. This is not
  theoretical: `systemctl restart` removes the pidfile and then brings the daemon back up, and
  routing the second half through the daemon's own front door left its already-running gate
  staring at the file the same command had just deleted — a restart that would have refused
  itself and left the service DOWN. The rule: a command that changes the filesystem must carry
  what it learned forward in a variable, never re-derive it from `env.fs`. `daemon.ts` splits
  along exactly this line — `bringUp` is the gate-free write, and the gates live in the callers
  that still have a valid view.
- **HTTP confines itself to the document root — the filesystem walker must never be trusted
  to do it.** `resolveWebPath` (`core/network/http.ts`) NORMALIZES the request path and returns
  `null` when it escapes `/var/www/html`. It looks redundant, because `fsView.read` resolves
  through `segmentsOf` and so treats `..` as a literal directory name that never exists — but
  that is an accident of which path helper is on the read path, not a guarantee: `resolveAbsPath`
  normalizes everywhere else (it is how `cd ..` works). Three `..` above the web root is `/`,
  which puts `/etc/passwd` one hop from a caller holding **no session on the box at all**. If a
  walker ever starts normalizing, this function is the only thing standing in the way. An
  escaping path must report the SAME 404 a missing file does — confirming a traversal was
  spotted is itself a hint. Every HTTP reader shares this one function, so the client `curl` and
  the (coming) cross-player server handler cannot disagree about what a URL may name.
- **The wire IS the threat surface.** The trust boundary is the Vercel function + Supabase
  RLS, never the client (Burp/ZAP/a custom client are all the same threat). Patch validation
  is zero-trust; identity is proven by a **signed Ed25519 envelope** on every request, and a
  client never claims its own identity (the server uses the verified pubkey). Defense layers:
  **L1** (caller holds an active session on the target), **L2** (the session's tier may
  write the path — the server regenerates the target FS and asks the shared walker), **L3**
  (server-side game-logic re-run — mostly deferred).
- **Framework-agnostic `core/`.** `core/` has zero framework imports; `CommandEnv` is the
  only seam; the FS walker is shared client + server. This is the rule the whole
  architecture exists for — keep `core/` pure and push framework/IO to the edges
  (`adapters/`, `api/`, `ui/`). Commands stay JS-callable (`execute(env, args, flags) →
  CommandResult`) for a future `node` command.
- **`workstation_id` MUST go through `computeWorkstationId`** — suffix =
  `sha256('ed25519:' + playerKeyHex)[0..8]`. The `ed25519:` prefix is load-bearing; a
  raw-playerKey derivation diverges and silently breaks auth/L1/L2. Routers/gateways have
  their own prefixed namespaces (`ed25519-router:` / `ed25519-inner-gw:` /
  `ed25519-deep-gw:`).
- **Two separate keypairs.** Identity (Ed25519) in browser localStorage, never auto-wiped
  (identity reset = an explicit "new game"). The wallet key lives in the in-game filesystem,
  lost on permadeath or theft — wallet defense is gameplay, not crypto.
- **Game time is a SERVER authority** (ADR D13). A signed event is stamped with the server's
  own UTC clock; there is no forgeable client `gameTime()`. Future CVE eligibility gates on
  game time, so it must be unforgeable.
- **Being on a WiFi is what makes a machine reachable — not whether a player is playing.**
  A box joined to an ESSID is running and attackable around the clock; closing the browser,
  logging out, or simply going away changes nothing. The ONLY thing that takes a machine off
  a network is an explicit in-game `nmcli disconnect` (or `reboot`, which disconnects on the
  way down), and a machine on no network is unreachable by every path — there is no "power
  off" mechanic to distinguish. This is why the defender role works: a player hardens their
  box (`rules.v4`, service state, `/etc/passwd`) and that hardening keeps standing while they
  are away, because the patch journal is never cleaned up on disconnect and the LAN lease is
  permanent. `home_network_occupants` is therefore the source of truth for reachability —
  its rows mean "on this WiFi", not "currently at the keyboard", and no identity or
  reachability lookup may gate on player presence.
- **`home_network_occupants` is the single source for "whose machine is this, and is it
  reachable".** Every cross-player by-`machine_id` resolver reads it and nothing else — there
  is no registry to consult first and no fallback to arbitrate. Its row means "this machine is
  on that WiFi", which is exactly the reachability test, so a machine with no row fails closed
  everywhere. **AP gateways are the one exception, and they need no lookup at all**: a gateway
  has no occupant (it belongs to the access point), its id is a pure function of the ESSID, and
  the only way to touch one is to hold a session on it — so it is resolved from
  `sessions.essid`, which also prevents reaching another network's gateway by claiming its id.
  Note `lanBaseFsForMachineId` deliberately skips octet `.1`, so the gateway always needs its
  own arm rather than falling out of the LAN walk. The table's PK is `(essid, owner_key)`,
  which cannot serve that reverse lookup — `home_network_occupants_workstation_machine_id_idx`
  exists for it and must survive any future reshaping of the table.
  See `cross-player-architecture.md`.
- **L1 asks whether you hold a session, never which KIND.** `authorizeMachineAccess` looks up
  any active `(player_key, machine_id)` row, so an `ftp` session opens the same journal an
  `ssh` hop does — proven live by `scripts/testFtpRemoteRead.ts`, since every unit test fakes
  `findActiveSession`. This is deliberate (a door is not an authorization dimension), and it
  is what every later parallel session — `nc`, `mysql`, `redis` — will inherit for free. The
  consequence to keep in view: **the remote READ is L1-only**, so the tier filter on what a
  session can see is CLIENT-side (`createFsView` + the shared walker), exactly as it is for an
  `ssh` hop. A server-side read filter is a separate, still-deferred plan.
- **A PARALLEL session needs its own journal, and the answer must be checked on arrival.**
  The shell's `patches()` follows the shell; an ftp session addresses a second machine at the
  same time, so it carries `ftpPatches` beside it. The fetch is fire-and-forget, which makes
  the guard load-bearing: when it resolves, compare the SESSION ID it was fetched for against
  the one now held and drop it otherwise. Without that, quitting one box and opening another
  before the first answer lands renders one stranger's files under another stranger's name.
  `state.test.ts` pins both orders (a late answer with a different box open, and with none).
- **A door adds no authorization dimension — and the way to keep it that way is to reuse the
  client, not to teach the server.** `put` writes to another player's box by pointing the
  SHIPPED `createPatchApi` at the ftp session's machine; `authorizeMachineAccess` and
  `remoteWritePermission` were not touched, and never learn a second protocol exists.
  `sessions.kind` is data the gate does not read. If a new door ever *does* require a change
  in either module, that is the signal to stop and re-open the design rather than widen the
  gate — proven live by `scripts/testFtpPut.ts`, one destination refusing a `guest` credential
  and accepting a `root` one over the same door.
- **A client must not pre-check a permission the server owns.** `put` sends the write and
  renders whatever comes back. A client that refuses on its own behalf is one that could
  permit on its own behalf, and worse for tests: a local pre-gate makes every unit test pass
  without the server claim ever being made. The consequence is honest naming — a vitest
  refusal proves what the COMMAND does with an answer, so the tier contrast lives in the
  wire-check and the unit test is named for the message, not the tier.
- **Whose box it is decides whose ROW a trace lands in, and a foreign box's log is never
  keyed to its visitor.** A generated host's log is per-player and caller-keyed; another
  player's is shared, so a visitor-keyed line lands in a different row from the login that
  preceded it and the journal's last-write-wins replay hands the defender half a visit —
  the second visitor erasing the first. **The "caller-keyed" half now describes
  `recordFtpTransfer` alone.** Every door that goes through the reach files an ownerless
  box under the ESSID's own stable key instead, because a generated host is shared by every
  occupant and caller-keying it splits one log into a row per attacker — the same failure
  this bullet names, one level out. See the shared-box entry in `backlog.md`.
  `recordFtpTransfer` decides with ONE occupancy
  lookup (`findOccupantWorkstationByMachineId`): a hit means the owner's row and a
  server-derived address, `null` means a generated host and the caller's own row with the
  address they reported. When that lookup fails it writes nothing rather than guessing —
  a line under the wrong key is worse than a line that never arrives.
- **A cross-player write of DATA lands under the TARGET's key too, for a sharper reason than a
  trace does.** `patches` is keyed `(machine_id, path, writer_key)`, so a row per attacker does
  not accumulate — it FOLDS to whichever was written last, and the loser's content is gone. On a
  log that costs a defender half their evidence; on the mysql datadir it silently drops the rest
  of their database. So `mysqlStatement` writes the datadir under the box owner's key, the same
  key the owner's own edits land under, and the two meet in one file that behaves like what it
  is: a document several people are editing. The shared-file write-wipe this accepts is real but
  far smaller here than in `nano` — the door re-materializes on EVERY statement, so the window is
  one in-flight request rather than one editing session.

- **"Re-materializes on every statement" has to be true of the OWNER's door too, and for one
  release it was not — corrected 2026-08-23.** The claim above held for every vantage the SERVER
  answers and silently failed for the one the client answers. The own-box door composed its two
  whole-file writes — the datadir and `/var/log/mysql.log` — from the tree this client was
  holding, which is refreshed on start, on a write of its own, and on a cross-TAB hint, and never
  by another player. So the window was not one in-flight request, it was the owner's whole
  session: a live browser run had a neighbour's `UPDATE` revert to its old value, and the
  neighbour's line vanish from the log, the moment the owner ran a statement of their own. The
  direction is what makes it bad — the writer being reverted is the intruder, but the file being
  shortened is the DEFENDER's evidence, destroyed by their own routine use of their own box.
  `env.fs.reload()` is the fix and the general rule it stands for: **a whole-file write to a path
  somebody else can write must compose against the MACHINE, never against the client's copy of
  it.** A shell may trust its own tree because the player is the only one editing; the moment a
  file is reachable through a daemon, that stops being true. The reload deliberately keeps the
  existing tree when the read FAILS — an unreachable server is not a box whose files went away,
  and blanking it would hand that writer an empty datadir to overwrite the real one with, which
  is why `readOwnPatches` reports whether the read HAPPENED and `fetchOwnPatches` (whose `[]` is
  fine for a reader) is now expressed in terms of it.

- **The same rule caught a SECOND caller at D9 slice 3, and there it had to cover READS too.**
  A script's `fs.writeFile`/`appendFile` are the second thing in the game to compose a
  whole-file write, so an append reloads and names its `baseContent` — a write landing between
  the two is refused rather than flattened. `fs.readFile` needed the rule for a reason the
  mysql door never had: **a script WRITES during the line.** `env` is built once per submitted
  line, so a script that appended twice and then read its own report was handed the content
  from before the run — the journal held four lines and the script said two. Not an error a
  player could notice, just a wrong answer, and invisible to vitest because a test `FsView`
  has nothing behind it and reloads to the tree it already has. So the rule generalizes:
  **a shell may read its own copy because it is rebuilt per line and the player is the only
  editor; anything that is neither — a daemon-reachable file, or a caller that writes DURING
  the line — must ask the machine.** Found by the browser close-out, not by the suite.

- **The VANTAGE is decided from the ADDRESS, server-side, and ONE function decides it for EVERY
  data door.** `reachServiceHost` routes four of them — public IP, a fellow occupant of the
  caller's own ESSID, a port that addresses the layer behind an inner gateway, and a generated
  sibling — and every one of them ends in the same `openServiceOn`: same boot gate, same "is the
  named daemon on the port you REACHED", same refusals. Nothing a client says about where it is
  standing selects a branch. Which daemon is a PARAMETER rather than a second copy of the file,
  which is what let D7's key-value door inherit all four vantages the day it started sharing the
  resolver — and why the last door to be built paid nothing for reach, while nothing said the
  evidence for it was missing.
  Routing in the reach rather than in a second pair of handlers is what keeps a login and every
  statement behind it agreeing about reachability by construction, which is what lets a defender
  stopping a daemon (or pulling a forward, or leaving the WiFi) drop an intruder on their next
  statement with no session row to invalidate.

- **A real occupant BEATS the generated sibling standing on the same octet, and every tool has to
  answer by that rule.** A lease is issued from the whole `/24` and nothing reserves the octets the
  ESSID's seeded NPCs already fill, so the collision is ordinary rather than exotic. `nmap` merges
  the host list, `ssh` and `nc` check occupants first — and any tool that resolves its target from
  `generateHomeLan().hosts` ALONE cannot see a player at all, which is what `hydra` did until D6
  slice 7. The merge belongs to the target RESOLUTION, never to one service: fixing it for the
  database door only would have left one tool answering by a different rule depending on which
  service was named. The rule in full: occupancy is the LAN boundary (you reach a box on a WiFi by
  being on it), the LEASE is the address, self is excluded, and an occupancy or lease read that
  FAILS refuses rather than falling through — quietly dropping to the generated world would sweep,
  or write to, a seeded box standing where a real player is. When a player leaves, the sibling
  underneath answers again.
  - **The merge covers a neighbour's PORTS too, and only since v0.182.0.** Merging the host list
    made a player VISIBLE; it did not make them legible, because a generated sibling's ports come
    off a filesystem keyed on the host IP and a real occupant's cannot. For four slices `nmap`
    answered a neighbour with `Host is up.` and no port table — correct, since falling through
    would have reported the NPC that octet rolled as the neighbour's own services, but it left a
    door onto a box a player had to GUESS was there. `resolveOccupantScan` resolves it server-side
    from the occupant's own journal, boot-gated, and it is generic to every service for the same
    reason the merge is: one tool must not answer by two rules depending on which service was
    named. It resolves ONE address, lazily — a single-IP scan of an occupant returns early beside
    the inner-gateway branch, so the client's sync port resolver never sees an occupant at all,
    and a RANGE renders no port table for anybody and asks nothing.

- **A failed round-trip is not an answer about the target, and a seam that conflates the two makes
  the tool lie.** `resolvePublic` collapses every failure — non-ok, malformed, thrown — into
  `found: false`, and that is honest THERE: nothing local ever established that a public IP has a
  host behind it, so "down" is the truthful shape of "we could not find one". It is wrong for a
  fellow occupant, because the occupant list has already placed that box on the LAN — reporting it
  down would blame a live neighbour for our own outage. So `resolveOccupant` keeps three outcomes
  where the public seam keeps two: `found: true` carries the ports, `found: false` is a RESOLVED
  host-down (bricked, or the occupant left), and `null` is "we could not ask" and renders as the
  host listed with no port table. The same distinction `fetchPublicPage` already draws between
  `host_unreachable` and `network_error`, and for the same reason.

- **Across somebody else's NAT and inside your own network, a door refuses DIFFERENTLY on
  purpose.** A forward onto a stopped daemon answers `host_unreachable` from a public address but
  `service_not_running` down your own chain or on a shared WiFi. That is not drift: from outside a
  stranger's NAT, a forward onto a dead port and a forward that was never opened are the same
  silence — the only thing the gateway can actually observe — and a door that told them apart would
  be telling an outsider which services a box behind that NAT has stopped. Inside the network the
  caller is inside, so the specific answer is the honest one. This is a STRONGER rule than "depth
  must not change the words a player reads", and it is the exception that rule has.

- **The indistinguishability rule binds the SCAN, not only the door.** A port a box filters must go
  DARK from the network — absent from the scan, one silence with an address bearing no network, a
  bricked box, a stopped daemon and a service the box fronts elsewhere — never labelled "filtered".
  A scan that still listed it would hand a stranger the one signal every other dark state hides: a
  pointer to the port worth a wordlist. `portsOpenToNetwork(hostFs)` = `readOpenPorts` −
  `parseInputDenies` is the single view EVERY remote reader judges by — both the public and the
  same-LAN vantage read the filter — while the OWNER's own view keeps reading the pidfiles
  directly. That split is exactly what makes a filter beat `systemctl stop`: the daemon still runs
  and `127.0.0.1` still reaches it, but the world sees nothing.
- **An INPUT rule governs traffic a box TERMINATES, never traffic it passes through.** A gateway's
  own filter closes the gateway's OWN ports; a forward it merely passes through is closed only by
  the TARGET box's filter — so a stranger denying a public port on a gateway does NOT close a
  forward an occupant opened onto their workstation, and the forward's target denying its own port
  DOES. Precedence between an own service and a forward on the same public port is decided by what
  the box RUNS (`readOpenPorts`), not by what its filter lets it answer: otherwise a denied port
  the router serves would re-open through somebody else's forward while the reach, routing on the
  pidfiles, went on refusing it — a scan advertising a door nobody can walk through, the same lie
  as hiding one that works.

- **A caller's claimed VANTAGE is checked, not believed** (`standingVantage`, beside the L1
  gate). Naming the box you operate from is what lets a trace record the network the target
  actually saw, so a caller naming a box they hold no session on is refused rather than
  written up as that network's owner. Naming none means the caller's own workstation — no
  row, no borrowed network, the address they own. That is why `ssh`, which names no box,
  kept its behaviour byte-for-byte when the vantage resolver replaced the home-address one.
- **A service's secret may belong to the SERVICE rather than to an account, and the contract says
  which.** `ServiceSpec.accountsOn` returns `{ username, hash }` and a redis `requirepass` is
  neither — so the spec carries a `secretOn` sibling instead, and a sweep that finds one reports it
  with NO login field. Faking a username there would have reprised D6 slice 2's shipped bug: the
  right name against the wrong secret. Two consequences worth knowing before designing the next
  door. A locked store discloses NOTHING through the statement door until the secret is spent —
  the lock is on every question, not on the connection, so connecting and being told nothing is
  the honest shape. And a PLAYER's store mirrors their own root password with no opt-out, which
  makes `hydra <player> redis` a DEAD END by design between players: a chosen password is in no
  wordlist the game hands out.
  - **That dead end is currently TOTAL between players, and an earlier version of this entry
    claimed otherwise.** It said the route was `ssh guest@them` → their root hash out of
    `/etc/passwd` → crack the md5 externally → `AUTH`. **That route does not exist.**
    `PASSWD_FILE` grants `read: ['root', 'user']` — a guest cannot read `/etc/passwd` on ANY box,
    by design, because it holds the account names and inline hashes a player is meant to earn.
    Verified live 2026-08-26: on a player's own box the owner sees `/etc/passwd`, and a second
    player holding a guest session on that same box sees only `/etc/redis`.
    The other half is what closes it. Against an NPC, `hydra <host> ssh` enumerates the box's real
    accounts and can return `root` or a `user` — tiers that DO read `/etc/passwd`, which is why
    the classic crack-the-hash route works there. Against a PLAYER's workstation the only account
    in any wordlist is `guest`, whose password is drawn from the crackable pool; the owner's is
    chosen. So a guest session is the ceiling, and the hash behind the store is unreachable.
    This is consistent with the CVE arc being the planned second way in — an uncrackable
    credential is not a design gap — but until it ships, one player's store is not reachable by
    another at all. Do not write a route into this file that has not been walked.

- **`SweepLog` is where a SERVICE says how it records being knocked on** — path, owner,
  permissions, `formatAttempt`, and an optional `formatArrival` for a daemon that records
  reaching the door separately from getting through it (vsftpd does; sshd's first line already
  *is* the attempt, so an arrival there would be an invention). It hangs off `ServiceSpec`, so
  a login, a hydra sweep and a cross-network break-in against one service cannot disagree about
  which file the defender reads. Two rules travel with it. **Arrival and attempt land in ONE
  append** — they are one event to the box, and two appends are two read-modify-writes racing
  over the same file. And **the name stays**: it carries logins as well as sweeps, but nothing
  a *transfer* writes goes through it (that is `formatVsftpdTransferLine` on its own endpoint),
  so the rename considered at slices 4 and 5 was closed rather than deferred a third time.
- **A parallel sub-shell is a restricted command MAP, not a screen, and not a hop.** `ftp` set
  the shape every later one (`nc`, `mysql`, `redis`) should follow: a signal the terminal reads
  to dispatch elsewhere, `enter`/`leave` as siblings of `pushSession`, no `OverlayMode` arm, and
  an unknown command refused rather than falling through to the real shell. Two consequences.
  `rehydrateSessionStack` rebuilds only HOP kinds (`ssh`/`su`) — an **allowlist**, so the next
  parallel door needs no second exclusion — and everything else comes back `abandoned` for the
  boot sweep to close, since a lingering active row is a silent write grant on someone else's
  box (sessions have no TTL). `end_reason` is a closed enum (`user_exit` | `abandoned`) so a row
  the player quit is distinguishable from one a refresh dropped. **Do not build a generic
  sub-shell mechanism until a third caller earns it** — one instance is not a pattern.
- **Inside a sub-shell, DATA commands delegate and CONTROL commands do not.** `ls`/`lls` run the
  real `ls` with `{ ...env, fs: <binding>.fs }`, which is what makes the flags, the sort, the
  long format and the permission refusal identical on both machines — "refused exactly as it
  would be over ssh" is not re-implemented, it IS that refusal. `cd`/`pwd` answer in the
  protocol's own numbered responses (`250`/`550`/`257`) because they are control-channel
  commands, and the `l`-prefixed trio speaks unnumbered because nothing it does touches the
  control channel.
- **A backdoor shell is a real hop minus what needs a TTY, and the gates that say so run BEFORE
  the line is parsed.** `nc` is not a sub-shell: it lands a session at the tier its pidfile records
  and everything runs there, except the six commands a raw socket cannot carry — `su`, `nano`,
  `ssh`, `scp`, `ftp`, `lynx`. That is the mechanic, not a limitation to route around: a root-planted
  listener can brick a box while a user-tier one cannot be escalated in place, because `su` is
  exactly what needs a pty. **The eviction check sits beside the no-TTY check**, same seam, same
  shape of rule (*this session cannot do that*), and running both before the parse is what makes a
  typo into a dead backdoor answer `nc: connection closed by foreign host` rather than `command not
  found` — nothing the player typed reached the box, so the box was never there to have looked. It
  also covers pipelines uniformly: `ls | grep x` can no more slip past a dead socket than `su | grep
  x` can past a missing pty.
  - **Eviction is a PULL, not a push.** The intruder learns the socket died by writing to it, as a
    real terminal does. `Session` gained a `port` for it, and only a backdoor sets one — every
    other door spends its port reaching the box and never needs it again, while a backdoor is the
    one that has to keep asking whether it is still there. No push channel, and no widening of
    `endSession`, which is deliberately scoped so a caller can only end their OWN rows.
- **Ending a row and ending a MACHINE's rows are two actions with two authorities.** `endSession`
  stays scoped to the caller's own `player_key`, and that scoping IS its authorization — it is why
  no door has ever needed to ask who may close a session. `rebootMachine` is the other shape: the
  update names the machine and nothing else, so it reaches every player's rows on that box, and
  because scoping no longer authorizes anything the authority is asked as its own question,
  server-derived from the verified pubkey — the caller owns the box (the `isOwnWorkstation` suffix
  match, through the shared `authorizeMachineAccess`), or holds a live session on it at root. Two
  things to know before a third action of either shape is written: a machine-scoped update must
  check its authority BEFORE it touches anything, because a machine id travels on every row and in
  every hop and is therefore not a capability; and the owner arm cannot be conditioned on a session
  row, because an owner's base login is not a row — a box whose owner is sitting at their own
  prompt has no tier to read, and a second reboot of a box whose rows are already all closed still
  has to work.
- **A session is armed against the box when it ARRIVES, not on the first line it runs — and the
  test that types a line first can never see the difference.** The boot-id gate compares what the
  session recorded against what the box now carries, so a session that reads the box for the first
  time AFTER the reboot records the new id as though it had always held it and is never evicted.
  That is the ordinary case, not an edge one: an intruder who breaks in and waits has typed
  nothing, which is most of them. Worse, the shell they keep is not even the one they had — their
  rows are closed, so the box now serves them the externally-observable allowlist, and their next
  command comes back `command not found` because `/bin` is no longer in the tree they are handed.
  A silent tier downgrade is precisely the answer the gate exists to replace with a line saying the
  box went down. So the stamp happens in `acquireTree`, the moment the client holds that machine's
  tree, and the per-line stamp is only the fallback for a session that reached the prompt by
  another road. **Every unit test written for this gate passed with the hole in place**, because
  each of them typed a line to establish the reading — it took a two-player browser run to notice,
  and that is the argument for keeping one in the evidence line for anything that evicts a player.
- **A closed row does not close the shell on your OWN box, and that is priced rather than broken.**
  `needsFreshTree` exempts your own workstation, so the boot-id gate never runs there: an `su` row
  of yours that somebody else's reboot closed server-side leaves you standing in that root shell
  until you reload, when rehydrate declines to bring it back. It costs nothing defensively — you
  own the box, and `su` is yours to run again — and closing it would put a network round trip on
  every line typed on your own machine, which is the one thing the re-pull rule has refused to do
  since it was first priced. Reopen the trade only if a session on your own box ever needs a
  server-side eviction to be visible before a reload.
- **D2.4's `reachedPort` rule binds the LOGIN gate too, and did not until v0.136.0.** hydra
  had checked the service on the reached port since v0.120.0; `authCreateSessionPublic` never
  had, so a forward to :22 was an `ftp` door and a forward to :21 an `ssh` one. Both now
  refuse with `service_not_running`. Reach for `reachedPort` whenever a new door is added to
  that handler — the check belongs to whoever knows which daemon was knocked on. **Completed at
  v0.142.0 (D4 slice 3):** the two paths that still disagreed now obey it too — the own-LAN
  handler's `ssh` exemption is gone, and the same-LAN handler compares the SERVICE on the reached
  port instead of merely finding something open there. All four login gates now ask one question.
- **A session's `kind` is PROVENANCE; the service it rides is a separate lookup.**
  `SERVICE_BY_DOOR = { ssh: 'ssh', ftp: 'ftp', scp: 'ssh' }` (`authCreateSession.ts:57`,
  exported and indexed by BOTH login gates) is the entire mechanism. `scp` is stored as `scp`
  so a row records which command opened it, but it has **no `SERVICE_CATALOG` row and must
  never get one** — it is not a service. That one indirection makes three things true by
  construction instead of by discipline: a transfer is gated on sshd listening, its trace goes
  through the ssh sweep log, and **there is no scp log line to forget to suppress**. A future
  door that is not a daemon adds a row here, not a column anywhere. The asymmetry this once
  produced is **gone as of v0.142.0**: the own-LAN gate was `payload.kind !== 'ssh' && !listening`,
  which refused `scp` against a box with sshd down while letting plain `ssh` through. D4 slice 3
  dropped the exemption, so all three doors are refused by the same `!listening` — `scp` and `ssh`
  ask the same daemon the same question, which is what made the shared lookup right in the first
  place.
- **A remote read must decide LOCAL-or-SERVER before it resolves, because the local resolver
  fails by handing back YOUR OWN box.** `resolveActiveRoot` falls back to `ownBaseFs` when the
  ESSID cannot generate the target (`activeRoot.ts:45`) — correct for a machine this client
  can build (an NPC on the player's LAN, their own deep layer) and silently wrong for another
  player's workstation, where it does not error but returns the CALLER's file tree under the
  target's name. So every remote read asks `isCrossPlayerWorkstation` first and sends a
  stranger's box to `resolveCrossPlayerFs` (server-materialized, tier-pruned before it crosses
  the wire), the same call an ssh hop's `refreshServedRoot` makes; `scpTargetTree`
  (`state.ts:590`) is that split. A door that reads a remote box and skips the check has a bug
  no type can catch and no unit test with a stubbed resolver can see — it took a live
  wire-check to prove, which is why it is written here rather than in a comment.
- **`is_new` on a patch is INERT — do not adopt it for symmetry, and do not believe
  `ftpShell.ts`'s comment about it.** Checked exhaustively when `scp` had to decide whether to
  send one: `applyPatches` and `materializeMachineFs` never read it; `removePatch` deletes the
  patch tree and tombstones with `is_new: false` regardless, so it does **not** decide "a later
  `rm` deletes it" the way that comment claims; the only live read is inside `upsertPatch`'s
  `rejectModifiedSinceOpen` guard, which early-returns when no `base_hash` is sent. Both `scp`
  directions omit it deliberately — the flag asserts "no base-FS file stood here" and the
  upload never looks at the target, so sending one would be a guess. A flag no test can fail is
  a claim nobody is keeping true. The stale comment is a behavior-neutral cleanup left for a
  slice already in that file.
- **A command that awaits the NETWORK must read `env.signal.aborted` itself.** Everywhere else
  Ctrl-C surfaces by rejecting an in-flight `env.sleep`, so a paced tool unwinds for free; a
  transfer awaits a round-trip instead and would otherwise land its bytes after the player
  abandoned it. `scp` is the codebase's only reader, checking at the two moments nothing has
  landed yet — before the transfer starts, and (download only, where a read-then-write gap
  exists) between the remote read and the local write. Any later door holding a session across
  a round-trip inherits the requirement. Related shape: an abort generator with nothing to
  yield is an eslint `require-yield` error, which is why `scp`'s early exits return plain sync
  results and only the path that actually waits paints `Connecting to <host>...`.
- **A log line that names an ACCOUNT reads it off the session row, never off the payload.**
  The client says what it did (`recordFtpTransfer` sends the path, the byte count and the direction); who it
  is comes from the `(player_key, machine_id)` row the L1 gate just looked up. A defender's log
  a visitor can author is not evidence — and the same rule already covers the clock (server
  `now()`) and provenance (`writer_key` stamped from the verified pubkey). Two consequences
  worth stating: `ActiveSession` therefore carries `username`, and a handler that needs an
  identity must **refuse the own-workstation L1 BYPASS**, which returns `session: null` and so
  can name nobody. Proven live by `scripts/testFtpTransferTrace.ts`, which claims `impostor`
  and reads the real account back out of the box's own log.
- **`ActiveSession` is the L1 projection; take a `Pick` of it when you only need the tier.**
  `remoteWritePermission` answers a permission question, which needs `userType` + `essid` and
  no name at all — so it takes `Pick<ActiveSession, 'userType' | 'essid'>`. Without that, every
  field added to the projection for one consumer breaks every fixture of every other one
  (adding `username` broke ~35 call sites; 20 were that module's).
- **The player's OWN box answers its own database — the server door is for other people's.**
  `commands/mysqlOwnBox.ts` runs the whole `mysql` conversation client-side when the target is
  the box the player is standing on: the credential check, `runStatement`, the datadir rewrite
  and the `/var/log/mysql.log` lines. It is not a second implementation — every decision is the
  same shared function `handleMysqlConnect`/`handleMysqlStatement` call, so what differs is
  where it runs. The reason the server exists at all is to stop a client writing to a box it
  does not own, and on your own box there is nothing to protect: you are root, the datadir is a
  file you can open in an editor. Addressing follows the web door: `localhost`, `127.0.0.1` and
  the leased LAN address are ONE address, and the source recorded is loopback or that address
  (`network/interfaces.ts` owns `LOOPBACK_NAMES`, shared by both doors). The cross-player
  direction stays server-side — that is where `reachMysqlHost` learns about player-owned boxes.
- **A SYSTEM write on the player's own box names its own owner.** `PatchApi.write` takes an
  `owner` override for exactly this: a daemon's log line and the datadir it keeps are root's
  whichever tier the shell that triggered them sits at. Without it a user-tier player running an
  `UPDATE` would rewrite `/var/lib/mysql/data.json` as themselves and hand their own ordinary
  account the hashes a sweep is supposed to have to work for. The server has always accepted the
  field on `upsertPatch` (own-machine writes are authorized by machine, not by owner), so this
  needed no `api/` change — it is the CLIENT that used to have no way to say it.
- **A generated box carries the packages for the services it runs — additively.** For each
  running service it gets every apt package that either shares that service's name or ships its
  daemon (`binariesForService`, `packages/aptPackages.ts`), each binary landing where apt itself
  would put it: tools in `/usr/bin`, daemons in `/usr/sbin`. That union is why the two services
  whose daemons come with the base image need no case of their own — nothing in the catalog
  claims `sshd` or `vsftpd`, so ssh matches nothing, ftp matches on its NAME and gets only the
  client, and http and mysql match on their daemon. The daemon's name is always
  `daemonName(spec)` off the pidfile, never a second catalog field, because that is already the
  one name `ps`, `nmap` and `systemctl` agree on.
  - **The base image never shrinks.** `SYSTEM_DAEMON_NAMES` stays on every box whether it serves
    those doors or not, because a binary present with NO pidfile is a service installed and
    stopped — the ordinary condition of a real machine, and what `systemctl status` prints `○`
    for. Planting only what each box runs would strip `sshd` from the ~60% of hosts that draw no
    ssh and erase that state from the world.
  - **Binaries only, never a package's `extraFiles`.** The `mysql` package ships a datadir drawn
    from the PLAYER's identity; a generated box already holds its own, seeded per
    `(essid, host.ip)`. Laying the package's over it would overwrite every NPC database.
  - Why it matters: `unitFor` resolves a unit only when its binary is present, so before this a
    rooted NPC webserver had no way to shut port 80 — `systemctl stop nginx` found no unit and
    `kill` refuses unit names outright.
- **`core/packages/` imports nothing from `core/commands/` — and neither does `core/generation/`.**
  The apt catalog is world DATA, not a command's private table: the world generator reads it to
  decide what a box carries. Its one tie upward was `AptExtraFile.content`, which now takes a
  narrowed `PackageFileContext` (`identity.publicKeyHex`, `hostname`, `fs.root()`) instead of the
  whole `CommandEnv`; `CommandEnv` satisfies it structurally, so `apt` passes its own env through
  unchanged. Keep it that way — a package whose bytes could reach the shell would make world data
  depend on the layer above it.
  - Residual, and deliberately not chased: `packages/` still imports `generation/baseFs` and
    `mysql/ownDatabase`. There is NO module cycle — those edges reach generation's primitives,
    never back to a composer like `remoteHostFs` — so it is a diamond, not a loop. The shape is
    pre-existing: `generation/` holds primitives and composers in one directory.
- **The scripting host (D9) grants no capability — it removes typing.** `runScript` is pure over
  `(source, context)`: it knows nothing about commands, the terminal or `CommandEnv`, so a caller
  that is not `node` reuses it rather than building a second sandbox. There is ONE mode and it is
  async. The body is wrapped in a BLOCK, not used as the function body, so a script's own
  `const console = …` is a legal shadow instead of a redeclaration `SyntaxError`.
  - **Every command reaches a script through `buildCommandContext`, in the SHELL's own order** —
    peel the trailing flags object, coerce positionals, bind and validate flags against the
    command's real `FlagSpec`, ask `withoutScript`, check the tty — and only then `execute`. The
    order is `prepareStage`'s and matters for its reason: a refusal arriving after `execute` would
    arrive after `ssh` had already written a line into somebody's auth.log. So a script runs at the
    same tier, through the same walker, with the same refusals as typing would.
  - **Four names are injected LAST, after the registry spread: `console`, `fs`, `process`,
    `sleep`.** Ordering is the whole protection — a command named `fs` would otherwise silently
    shadow the filesystem for every script on the box. `registry.test.ts` pins
    `identifiers.length + 4`; grow that number with any fifth name.
  - **"Aborted" is a property of the RUN, not of the error.** `node` asks `env.signal.aborted` after
    `runScript` returns — whether the script failed OR finished — and throws `env.signal.reason`.
    Checked on success too because the defensive loop a player actually writes
    (`for (const host of hosts) { try { await nmap(host) } catch {} }`) swallows the abort along
    with the failures it was written for and comes back `ok`; a check scoped to the failure branch
    would let Ctrl-C exit 0 in silence. Matching an `AbortError` by name instead would let a script
    forge an interrupt by throwing its own.
  - **`node` THROWS the interrupt; `state.ts` owns the only `^C`.** The marker is a `text` line —
    stdout — so a command printing it itself would write `^C` into `node sweep.js > out.txt` and
    pipe it into `grep`, and an interrupted pipeline would complete as though the sweep had
    finished. The throw lands AFTER the drain, so everything the script printed survives.
  - **Guards run before AND after every command invocation, and before each `fs` method** — all via
    the standard `env.signal.throwIfAborted()`. They do different jobs: *after* withholds the result
    of a command that finished as the key went down; *before* stops NEW work reaching the server,
    which is the half a script's own `try/catch` cannot defeat — it may swallow every throw, but
    nothing further executes. The `fs` guards are also the only interruption point a loop that
    touches files and never calls a command has. Never post-check a write: once the journal holds
    it, throwing would deny something that actually happened.
  - **A synchronous infinite loop is an accepted tab-hang.** An `AbortSignal` cannot interrupt
    synchronous JavaScript on the main thread; the real fix is a Web Worker with `terminate()`,
    which turns every command call into a postMessage RPC across a boundary `CommandEnv` does not
    serialize. `sleep(ms)` is what gives a computational script a yield point instead.
  - **`node` declares no flags, so `--` is how a script gets a dashed argument**
    (`node sweep.js -- -v 10.0.0.5`). The shell binds flags before `node` sees anything, so it
    cannot do real node's stop-at-the-operand parsing; `bindFlags` already implements the sentinel,
    so this costs no shell mechanism.

- **WHICH sessions re-read the box before a line is a named rule, and it is not "all of them".**
  `needsFreshTree` (`ui/activeRoot.ts`) owns it: a backdoor always, and any session standing on a
  machine that is not your own workstation. Your own box is deliberately outside it — its tree is
  local and its base login is not a session row, so nothing can close it without you — which is
  what keeps the priced claim that *a command on your own box issues no requests at all*. That
  claim has a test that spends the line rather than reading its output
  (`state.test.ts`, "pays the re-pull only on a box that is not yours"), because an unconditional
  re-pull changes no output at all and survives everything else.

  It widened from "a backdoor" to this at v0.232.0, when the boot-id gate needed the marker a
  reboot leaves to actually reach a shell already standing on the box. Two things generalize:

  - **The SOURCE and the TRIGGER are two questions.** `isCrossPlayerHop` answers where the fresh
    tree comes from (served vs journal); `needsFreshTree` answers whether to go and get one.
    Collapsing them looks natural and is wrong in both directions: an own-LAN hop needs a journal
    re-pull and is not a cross-player hop, and a sub-shell line (`ftp>`, `mysql>`, `redis>`) never
    reaches `runCommandLine` at all.
  - **An eviction that must land on the ACTOR's own screen cannot wait for the next line.**
    `reboot` re-reads the box once on a successful evict, as part of the act the player ran, so a
    Ctrl-C mid-animation resolves on their next line even on their own box — which is never
    re-asked per line. Per-reboot, not per-line: the priced claim is untouched.

- **A plan that quotes this document can quote the conclusion and drop the guard around it.**
  Slice 7's decision 53 asserted the boot-id gate "costs zero new round trips" because
  "`executeLine` already re-pulls the active tree before every line". It did not: the re-pull was
  `kind === 'nc'` only, which the entry it was drawn from says in its very next bullet
  ("it costs a round trip only in a backdoor" — a priced, tested claim). The gate as planned would
  have worked for backdoor shells and silently for nothing else, which is most of what the slice is
  about. Caught at the seam while writing GREEN, not by a test, and only because the condition had
  to be read to be changed. **When a plan justifies a design by what the code "already does", open
  the code at that line before building on it** — a cost argument inherited from a doc is the one
  kind of claim no test in the repository is checking.

- **Known deferred gap (L3 smart-server):** a client with a valid keypair can mint an
  `effect_one_shot`/root session via `createSession` and call `exploitRead` directly,
  skipping the in-game CVE flow. Accepted per the security model; real fix = server-side
  game-logic re-run.

---

## 7. PR / git conventions

- **Squash-merge:** `gh pr merge <#> --squash --delete-branch`.
- **Conventional Commits** with scoped prefixes (`feat(v2):`, `fix(v2):`, `docs(v2):`,
  `test(v2):`). The `(#N)` suffix is appended automatically on squash.
- Commit messages end with the `Co-Authored-By` trailer; PR bodies end with the Claude Code
  generation trailer (see root `.claude/CLAUDE.md` harness rules).
- **Never write "+ the working tree" in a plan header.** It is true for the minutes between writing
  the plan update and committing it, and false forever after — sending whoever picks the work up
  hunting for uncommitted changes in a clean tree. Twice now in one slice. A plan update committed
  ALONGSIDE the work it describes cannot name its own hash, so name only the commits that already
  exist and let the next update add this one.
- Cut a branch per slice off `main`; never commit straight to `main` for code.
- **Do not stack a PR on a branch that will be squash-merged with `--delete-branch`.** Merging
  the base deletes its branch, and GitHub then **closes** the stacked PR instead of retargeting
  it — a closed PR whose base is gone cannot be reopened (`Cannot change the base branch of a
  closed pull request`) and cannot be rebased in place. Squash makes it worse: the base's commits
  never become ancestors of `main`, so a naive reopen would show the base's work as new. Recovery
  is `git rebase --onto origin/main <old-base-sha>`, verify the tree is byte-identical
  (`git diff <pre-rebase-sha> HEAD` empty), re-run the gates on the new base, `push
  --force-with-lease`, and open a replacement PR. Prefer avoiding it: merge the base **without**
  `--delete-branch`, or just wait and branch the follow-up off the merged `main`.
- **`git pull --ff-only` prints "Already up to date" when local is AHEAD of origin, not only
  when it is level.** A docs commit made on `main` at the end of one session was never pushed;
  the next session's `/continue` ran `git pull --ff-only`, read "Already up to date" as "in
  sync", and cut the slice branch off the unpushed commit. The squash-merge then folded that
  commit into the PR (so nothing was lost) but left local `main` diverged by one commit each
  way, and `gh pr merge`'s own post-merge pull died with `fatal: Not possible to fast-forward`
  **after** the remote merge had already succeeded — which reads like a failed merge and is not
  one. Check `git status -sb` (or `git rev-list --left-right --count main...origin/main`), which
  distinguish ahead from level; and if that error appears, confirm with
  `gh pr view <#> --json state,mergeCommit` before touching anything. The recovery is
  `git reset --hard origin/main`, but verify first that the squash really contains the orphaned
  commit (`git diff origin/main <sha>` should show only later additions).
