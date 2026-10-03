# 11. Testing and quality gates

This chapter explains how the project proves its behaviour: the test layers and what each can and
cannot prove, the fixtures, how to write and run each kind of test, how to run mutation testing on
this repository without it hanging, and the testing rules the project has learned the hard way. Read
it before writing your first test here.

**There is no CI.** No workflow files exist, now or in git history. The only automatic check is
Vercel's build of every push, which runs the type check and the bundle-size budget. Everything else
is run by hand before opening or merging a pull request.

## The test layers

| Layer                                               | What it proves                                                                                                                                                                                     | What it cannot prove                                                                                                                  | How to run                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Core unit** (`src/core/**/*.test.ts`)             | Pure logic: commands through `execute(env, args, flags)`, generators, resolvers, server handlers called as `handleX(envelope, deps)` with injected fakes, permission walks, signature verification | Real database columns and constraints, whether `api/*.ts` routes to a handler, Vercel's module resolution, anything in a real browser | `npm run test:run`, or `npx vitest run <path>`                                              |
| **UI and adapter** (`src/ui/**`, `src/adapters/**`) | Solid components rendered in jsdom; the state module; adapters sending real signed envelopes to a stubbed `fetch`                                                                                  | Real keyboard focus, CSS and layout (Tailwind is not loaded in tests), timing, a real network                                         | same                                                                                        |
| **Wire-checks** (`scripts/test*.ts`)                | The `api/` runtime: envelope → handler → Supabase → status and body, and which rows land or do not land in tables                                                                                  | The client and the browser                                                                                                            | `npx dotenv -e .env.development.local -- npx tsx scripts/<name>.ts` with the local stack up |
| **Browser E2E** (`agent-browser`, the `e2e` skill)  | The playable loop through the real UI against the real server: the editor, keyboard, two-player journeys                                                                                           | Nothing is recorded or replayable; each run is driven by hand                                                                         | `.claude/skills/e2e/SKILL.md`                                                               |
| **Mutation** (Stryker)                              | That the tests would fail if the code changed                                                                                                                                                      | It produces hypotheses; survivors need hand-checking                                                                                  | the scoped recipe below                                                                     |
| **Budget** (`scripts/checkBudgets.ts`)              | Bundle size and per-box generation time                                                                                                                                                            | Timing is skipped on Vercel                                                                                                           | `npm run build`                                                                             |
| **Types** (`npm run typecheck` = `tsc -b`)          | `src/` (tests included), `api/`, `scripts/`, `vite.config.ts` under strict settings                                                                                                                | SQL column names (strings), swapped arguments of the same type                                                                        | `npm run typecheck`                                                                         |
| **Lint** (`npm run lint`)                           | ESLint recommended + TypeScript rules, Solid rules on non-test code, the `.js` import rule                                                                                                         | Formatting                                                                                                                            | `npm run lint`                                                                              |

Size as of 2026-09-27 (v0.278.0): **268 test files, 6,464 tests, about 110 seconds** for
`npx vitest run`; **79 wire-check scripts**. No `.skip`, `.only` or `.todo` anywhere. Nothing uses
`vi.mock`: everything is tested through dependency injection (`CommandEnv` for commands, a `deps`
object for server handlers, `fetchImpl` for adapters).

`npm run format:check` is **not** a gate and does not pass today (hundreds of files differ from
Prettier's output). `npm run lint` does not check formatting.

## Runner setup

`vite.config.ts` configures Vitest: `globals: true`, `environment: 'jsdom'` for every file,
`setupFiles: './src/test/setup.ts'` (which only adds the jest-dom matchers), `testTimeout: 30000`,
and `include: ['src/**/*.test.{ts,tsx}']`. The 30-second timeout is a correctness setting: under
Stryker's instrumentation the default 5 seconds failed the dry run, so no mutants ran at all.
Solid's hot reload is off under test (its virtual module does not resolve in jsdom), and Tailwind is
not loaded. `__APP_VERSION__` is defined in tests too.

`npm test` and `npm run test:run` run `npm run encode` first. A bare `npx vitest` does not; on a fresh
clone run `npm run encode` once.

## Fixtures

### `mockCommandEnv`

`src/test/factories/commandEnv.ts` exports `mockCommandEnv(overrides)`, a complete `CommandEnv` with
sensible defaults. Override only what the test cares about. Its defaults follow one rule:

- **Load-bearing seams throw** (`mockCommandEnv: <method> not implemented in spike mock`) until the
  test stubs them. A silent default would read as a real game fact (a bad password, a closed port)
  instead of a missing stub.
- **Fire-and-forget seams** (log and trace writes) are no-ops; pass a spy if you care.
- **Additive reads** default to empty.

`mockFsViewFromTree(tree, {userType, cwd})` **is** the production `createFsView`, so tests use the
real permission checks. `mockNetworkViewFromConnectivity(state)` makes the network view read a real
connectivity state.

### Filesystem builders

`src/test/factories/filesystem.ts`: `buildFile(content, {owner, perms})`,
`buildDirectory({name: node, ...}, {owner, perms})`, `buildHomeFs(username)`, `ownerTier(owner)`.

### The world is the fixture

When a test needs "a box serving a database" or "a credential that works", it **searches the
generator's own output** instead of hand-writing one, because a hand-written host proves only that
the handler agrees with the fixture:

- `src/test/factories/lanDatabase.ts`, `lanStore.ts`: find generated boxes serving a database or
  store and recover a usable credential by hashing the generator's pool.
- `src/test/worldContent.ts`: `lanBoxes`, `deepBoxes`, `gatewaysOn`, `filesUnder`, `serialise`, and
  `falsehoodIn` (says why a generated line would not work if a player replayed it).
  `ALL_ESSIDS` is what the whole-world content tests sweep: every Ridgemont landmark and
  uncatalogued key, but of the 612 declared networks only a **fixed sample** (Millbrook and the
  corporations whole, and from every other town the first network of each shape it holds).
  `WORLD_SWEEP=full npx vitest run` sweeps every declared network instead, about twice as long;
  run it once before a PR that changes generated content, since the sample misses what one
  network or a coincidence breaks.
- `src/test/deviceBoxes.ts`: device populations and 120 synthetic networks for rare kinds.

UI tests start from `startGame(SEED_CONFIG)` (`alice@workstation`, root password `hunter2`).

## Writing tests

### A command

```ts
const tree = buildDirectory({
  home: buildDirectory({
    alice: buildDirectory({ 'notes.txt': buildFile('hi', { owner: 'alice' }) }),
  }),
});
const env = mockCommandEnv({
  fs: mockFsViewFromTree(tree, { userType: 'user', cwd: asAbsPath('/home/alice') }),
});
const result = await cat.execute(env, ['notes.txt'], new Map());
// sync: assert result.kind, exitCode and lines
// async: drain `for await (const line of result.lines)`, then `await result.exitCode()`,
//        BEFORE asserting on spies (a streamed command is lazy)
```

Test flag parsing through `runCommandLine(env, 'cmd -x arg', commandRegistry)`, because hand-built
flag maps bypass `bindFlags`. A test that goes through the registry must first install the command's
binary stub in the tree.

### A server handler

Sign a real envelope with `signRequest(generateIdentity(), '<action>', payload)`, call
`handleX(envelope, deps)` with injected fakes, and assert the `{status, body}` and the calls made to
the fakes. If you write a `makeDeps(over)` helper, **return the mock that actually landed in `deps`**
(resolve `over.dep ?? vi.fn(...)` first), or `ctx.dep.mockImplementation(...)` will retarget an
orphan and the test passes vacuously. Most existing helpers do not do this yet.

### A UI test

1. Reset the singleton: clear the stored connection, `startGame(SEED_CONFIG)`,
   `render(() => <Terminal />)`, and `afterEach(() => setOverlayMode(null))`.
2. Drive the DOM: `fireEvent.input(field, {target: {value}})` then
   `fireEvent.keyDown(field, {key: 'Enter'})`. A masked prompt has no `textbox` role; use
   `getByLabelText(/terminal input/i)`.
3. Await output with `findByText`, then wait for the prompt to return before the next command.
4. Stub `fetch` for anything that calls the server, and restore it with
   `onTestFinished(() => vi.unstubAllGlobals())`.
5. Wait one macrotask after `startGame` before running an installed binary (the journal load is
   fire-and-forget). To start online, store both the ESSID and a lease.

### A wire-check

Copy `scripts/testSameLanConnect.ts` (or `testUpsertPatch.ts` for `/api/patches`), and add the
seed-error checks it predates (step 4). The anatomy:

1. A header comment: what is new under test, each expected outcome, the usage line, and exit codes
   (0 all pass, 1 any fail, 2 missing environment).
2. An environment guard (`process.exit(2)`), a service-role Supabase client, a `check(name, pass,
detail)` helper, and a `post()` helper.
3. Identities from `generateIdentity()`; every id, address and password from the production
   derivations, never hand-written constants.
4. **Clean at setup**, including permanent tables (`network_lan_leases`), then **seed loudly** (check
   every insert's `error` and exit on failure). Seed a lease together with occupancy. Aim at a
   declared network's address through `scripts/publicAddressOf.ts`.
5. Drive the real endpoint with signed envelopes; assert status, error code and the resulting rows.
   On shared machines, snapshot before and assert on the difference.
6. Clean up, print `N/M checks passed`, and exit 0 only if all passed.

Run: start the stack (chapter 2), then
`npx dotenv -e .env.development.local -- npx tsx scripts/testX.ts`.

Wire-check rules:

- **Run them one at a time.** They share deterministic machine ids and are not safe to sweep in a
  loop; re-run any failure alone before believing it. There is no committed runner.
- **Some leave state behind.** `testDeepChainReach` bricks a gateway; the brick survives
  `supabase stop`/`start`. `npx supabase db reset` clears it.
- **A uniform `500 not_configured` means the environment is missing**, and it can make a check of the
  form "these two answers are equal" pass. Start the server with `npm run vercel:dev`.
- **`testSharedApForwards` is known to be flaky** (about 1 run in 17, from random identities
  colliding). Re-run before treating it as a regression.
- Many older scripts still ignore seed-insert errors. Treat a suspicious pass as "was the fixture
  really built?" first.

## Mutation testing

`stryker.config.json` mutates `src/core/**/*.ts` with the Vitest runner and per-test coverage. A
**whole-suite run never finishes on this repository** (Stryker's dry run of the full suite under
instrumentation is too slow), so every real run is a scoped battery. Run it once per phase, at the
end, before the pull request, not on every change.

### Recipe: mutation-test one file

Stop `vercel dev` and make no edits while it runs.

1. `npm run encode`
2. Create `vite.mutation.config.ts` **at the repository root** (a config in a temp directory cannot
   resolve `vite-plugin-solid`):

   ```ts
   import { defineConfig } from 'vitest/config';
   import solid from 'vite-plugin-solid';
   import { readFileSync } from 'node:fs';

   const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

   export default defineConfig({
     define: { __APP_VERSION__: JSON.stringify(pkg.version) },
     plugins: [solid({ hot: false })],
     test: {
       globals: true,
       environment: 'jsdom',
       setupFiles: './src/test/setup.ts',
       testTimeout: 30000,
       include: ['src/core/commands/wc.test.ts'], // every test file covering the target
     },
   });
   ```

3. Create `stryker.mutation.json` at the root:

   ```json
   {
     "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
     "testRunner": "vitest",
     "vitest": { "configFile": "vite.mutation.config.ts" },
     "coverageAnalysis": "perTest",
     "timeoutMS": 120000,
     "concurrency": 4,
     "reporters": ["json", "clear-text", "progress"],
     "mutate": ["src/core/commands/wc.ts"]
   }
   ```

4. Baseline the narrowed suite: `npx vitest run --config vite.mutation.config.ts` (seconds).
5. Run with the config file as a **positional** argument, output to a file, no pipe:
   `npx stryker run stryker.mutation.json > stryker.log 2>&1`. (`-c` means `--concurrency`, not
   "config".)
6. Check the first `Instrumented N source file(s) with M mutant(s)` line matches your scope, and that
   `reports/mutation/mutation.json` is fresh and names only your files.
7. Read the JSON. For each survivor, slice the source with its `location` columns.
8. Delete both throwaway files and `stryker.log`; `rm -rf .stryker-tmp` if a run died.

### Reading the results

- **A timeout counts as killed**, so a loaded machine scores higher. Read the timeout column and
  quote the run with the fewest timeouts.
- **A survivor is a hypothesis.** Per-test coverage mis-maps mutants whose effect shows up later
  than the mutated line. Apply every non-trivial survivor by hand and run the tests before writing a
  new test.
- **A command's score is mostly its manual page.** Every string in `description`, `manual` and
  examples is an unkillable mutant. `flags` is the exception: it is consumed by the parser.
- **Compare survivor sets, not percentages**, across a refactor.
- **Fixtures built at module scope hide coverage.** Build inside the test.

## Durable testing rules

These come from real bugs and mutation runs; the full history is in
[`conventions-and-gotchas.md`](../conventions-and-gotchas.md) §3–§4.

1. **Test behaviour, never metadata existence** (`expect(cmd.name).toBe('foo')` is banned). Do test
   metadata that is consumed (`help`, `man`, flags).
2. **A negative fixture must be negative for the reason under test.** A box running nothing refuses
   every port, so it cannot tell which port a check read. Ask "what else is also false about this
   fixture?".
3. **An absence assertion needs a matching presence assertion** with the same inputs, to prove the
   setup reaches the code.
4. **Data order can satisfy a predicate by accident** (root is always first in `/etc/passwd`). Read by
   name.
5. **Do not compute the expected value from the production table under test.** State it by hand.
6. **Assert over the whole population** for pools and generated content.
7. **A streamed command is lazy**; drain it before asserting side effects.
8. **Pair every `vi.stubGlobal` with a restore.**
9. **Random identities against seeded state collide sometimes.** Redraw until they do not.
10. **A test never seen to fail is decoration.** If a planned failing test passes on arrival, apply
    the mutant it should catch and watch it fail.

## Browser E2E

Reserved for what only a browser can show: keyboard and focus, the editor, full journeys. The runbook
is the `e2e` skill at `.claude/skills/e2e/SKILL.md` (it drives the `agent-browser` CLI), plus the long
two-player journeys in [`e2e-shared-network-verification.md`](../e2e-shared-network-verification.md).
Before a run: unit tests and relevant wire-checks green; nothing on ports 3100/3101;
`npm run vercel:dev`; an empty `POST` to `/api/network` returns 400; **the banner version matches
`package.json`** (the cheapest guard against a stale server). Each browser session is one player,
because the identity lives in that session's `localStorage`.

The most dangerous trap: typing the next shell command before `nano` has really closed writes it into
the file. Wait until the terminal input exists twice in a row.

## Process

- **Branches.** One branch per piece of work off `main`; code never goes straight to `main`. Planning
  and documentation commits (`docs(v2):`) may go directly to `main`.
- **Commits.** Conventional Commits with scopes (`feat(v2):`, `fix(v2):`, `docs(v2):`, `test(v2):`,
  `chore:`).
- **Merging.** Squash-merge: `gh pr merge <number> --squash --delete-branch`. Do not stack a pull
  request on a branch that will be squash-merged and deleted.
- **Versioning.** Feature changes (and, in practice, most merged `fix` pull requests) bump the **minor** version in both `package.json` and
  `package-lock.json` (`npm install --package-lock-only`). There are no release tags and no changelog;
  squash commit messages are the release notes.
- **Before a pull request**, run by hand: `npm run typecheck`, `npm run lint`, `npm run test:run`,
  `npm run build`, the wire-checks for any `api/` path you touched, and a scoped mutation run at the
  end of the phase.
- **Test-driven development** is the house practice for behaviour changes: a failing behaviour test
  first, then the smallest code to pass it, then refactor.
