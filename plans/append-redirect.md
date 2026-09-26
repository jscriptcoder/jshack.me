# Plan: T1 Slice 1 — An Append Adds a Line

**Epic:** `plans/legacy-parity-epic.md`, T1 slice 1. The grill record is under "T1 — text tools —
resolved scope & decisions" (decisions 106–113, 2026-09-27); decisions 106 and 107 set this slice's
behavior and 112 its scope.

**Branch:** `feat/append-redirect`
**Status:** Active — decisions and acceptance criteria confirmed by the owner 2026-09-27.

---

## Decided at planning (2026-09-27)

**Derived from existing code and conventions (no owner decision needed):**

- **The tokenizer emits one `append` token for two ADJACENT `>`s.** `a>>b` and `a >> b` are
  `word, append, word`; `a > > b` stays `word, redirect, redirect, word`, which the parser already
  rejects (`` syntax error near unexpected token `>' ``, 107). Adjacency is a scanner-state fact —
  whitespace between the two `>`s flushes nothing, so "the last token is a redirect" cannot tell
  `>>` from `> >`. `>>>` is `append, redirect` and is refused by the same extra-token rule that
  refuses `> f g`. Inside quotes `>>` stays literal, as `>` does.
- **The pipeline carries the mode on the redirect it already has**: `redirect: { path, append }`,
  not a second optional field. One trailing redirect, either operator, under the existing
  "last two tokens only" rule; the error symbol for an `append` token is `>>`.
- **Validation before the run is unchanged and shared.** `validateRedirectTarget` runs for both
  operators against `env.fs`, so a directory, a missing parent or a denied write refuses before any
  stage executes — the existing "does not run the command when the redirect target is invalid" test
  gains an append case.
- **The append composes on the MACHINE, not on `env.fs`** (107): `env.fs.reload()`, re-resolve the
  target, read the base (`not_found` ⇒ `''`; any other read error is the refusal in `cat`'s words,
  prefixed `bash: <path>:`), compose, write with `{ isNew, baseContent: base }`. A `409` maps through
  the existing `PATCH_ERROR_REASON` to `bash: <path>: File changed on disk`, exit 1.
- **The separator rule (106) is one pure function** — the base and the final stage's stdout lines →
  composed text — so its cases are table-tested without a pipeline. It takes LINES, not a joined
  string, because "printed nothing" and "printed one empty line" both join to `''`, and only the
  first must leave the file untouched.
- **No `api/` change.** The base check the append relies on (`rejectModifiedSinceOpen`) already
  ships and is proven live by `scripts/testModifiedSinceOpen.ts`.

**Measured at planning — the write-without-read case the grill parked:**

- The server's base check passes when **no patch row exists** for the path, because the generated
  file is the same for every viewer (`upsertPatch.ts`, `rejectModifiedSinceOpen`). So a file a tier
  may write but NOT read, never patched, would be pruned from that caller's view, look new, compose
  from `''`, and pass the check — **replacing** the generated content with the appended line.
- Once a path HAS a row (a `chmod` writes one, with content), the check compares hashes and refuses
  with `File changed on disk` — misleading, not destructive.
- So the only destructive shape is a **generator** granting write without read. Increment 6 turns
  that into a property test over generated worlds. If it is green, the case is closed as
  "chmod-only, refused"; if a generator does grant it, **stop and bring it to the owner** before
  changing anything — it is a generator defect, and script `appendFile` shares it today.

## Goal

A player can add a line to a file from the prompt. `echo hunter2 >> /usr/share/wordlists/passwords.txt`
puts `hunter2` on its own line under the last word, and the next `hydra` or `john` run tries it.

## Acceptance Criteria

- [ ] `echo hunter2 >> /usr/share/wordlists/passwords.txt` leaves the shipped words intact and adds
      `hunter2` as the last line; `cat` shows it on its own line.
- [ ] `echo a > f; echo b >> f` → `cat f` prints `a` then `b`. On a missing file `>>` creates it with
      no leading blank line; on an empty file it adds no leading newline; on a file already ending in
      `\n` it inserts no second one.
- [ ] `cat x | grep y >> out` appends the last stage's stdout; an intermediate stage's errors still
      reach the terminal, as with `>`.
- [ ] `>>` onto a directory, under a missing parent, or onto a file the session may not write
      refuses in bash's words **before** the command runs, exactly as `>` does.
- [ ] If the file changed on the server since the reload, `>>` prints
      `bash: <path>: File changed on disk`, exits 1, and writes nothing.
- [ ] `echo a > > f`, `echo a >>> f`, `>> f` and `echo a >>` are syntax errors; `echo "a>>b"` prints
      `a>>b`.
- [ ] Tab after `>> ` completes a path, as after `> `.
- [ ] A word appended with `>>` opens a login that the shipped wordlist could not (the D2.6a proof,
      re-run through the operator instead of `nano`).

## Slices

### Slice 1: an append adds a line

**Value:** Behavior change. The wordlist-growth mechanic becomes one line at the prompt instead of an
editor session, and every loot file a player keeps can be added to without being rewritten.

**Path:**
1. `tokenize` — two adjacent `>` → `{ kind: 'append' }`.
2. `parsePipeline` — `extractRedirect` accepts either operator; `Pipeline.redirect` gains `append`.
3. `runCommandLine` — validate the target as today; on the final stage, `append` routes to the
   machine-composed write (107) with the separator rule (106), `>` keeps `applyRedirect` as is.
4. `complete` — confirm `>>` already classifies as path position (it ends with `>`); a test pins it.

**Class:** Behavior change (shell grammar + one write path).
**Delivery:** Independent PR against trunk (`main`), no stack (112).
**Required implementation skills:**
- Before code: `tdd`, `testing`, `refactoring`, `functional`; the `v2-e2e` runbook for the browser run.
- At PR readiness: `mutation-testing`.

**Reduction program:** N/A.
**Transition/terminal evidence:** N/A.

**RED → GREEN increments.** Each test is written first and fails for the stated reason. Assertions
are on what the player observes: the tokens/pipeline the parser returns, the content the machine
holds after the line, and the terminal lines.

1. **`>>` is one operator** (`tokenize.test.ts`). `echo a>>f` and `echo a >> f` → `word, word,
   append, word`; `echo a > > f` → two `redirect`s; `echo "a>>b"` → one word. Fails: the scanner
   emits two `redirect` tokens.
   - *GREEN:* the `append` token kind and an adjacency flag in `ScanState`.
2. **The parser carries the mode** (`pipeline.test.ts`). `echo hi >> f` →
   `redirect: { path: 'f', append: true }`, `>` → `append: false`; a leading `>>`, a target-less
   `>>`, `>> f g` and `>>>` are syntax errors naming `>>`/`>`/`g`/`newline` as bash does. Fails: no
   `append` token is understood.
   - *GREEN:* `extractRedirect` over both kinds; `symbolOf` learns `>>`.
3. **The separator rule** (a pure-function table test beside the runLine redirect tests), over the
   base and the final stage's stdout LINES: `('', ['x'])` → `x`; `('a', ['x'])` → `a\nx`;
   `('a\n', ['x'])` → `a\nx`; `('a', ['x', 'y'])` → `a\nx\ny`; `('a', [])` → `a`. The last row is
   a command that printed nothing (`grep nomatch f >> out`): it appends nothing and the base is
   unchanged, as in bash — a join-then-separate over `''` would instead leave a stray trailing `\n`.
   A missing target is still created (empty) by that line, as bash creates it. Fails: the function
   does not exist.
4. **`>>` appends through the machine** (`runLine.test.ts`, a new `describe('append redirection
   (`>>`)')` beside the `>` one). With a `reload()` that returns a tree holding `a`:
   `echo b >> f` writes `a\nb` with `baseContent: 'a'`; a missing file writes `b` with `isNew: true`
   and `baseContent: ''`; the terminal shows nothing; the exit code is the command's. A second case
   has the cached `env.fs` hold a STALE `old` while `reload()` holds `a` — the write is `a\nb`, which
   is the whole point of 107. Fails: `>>` is a syntax error today.
   - *GREEN:* the append branch in `runCommandLine`.
5. **Refusals** (same `describe`). A directory / missing parent / denied write refuses before the
   command runs (the existing invalid-target test, append case); a write answered
   `modified_since_open` prints `bash: f: File changed on disk`, exit 1; a base read that fails with
   `permission_denied` refuses in those words and writes nothing.
6. **No generator grants write without read** (a property test in the generation suite that
   already walks whole generated worlds — pick the one the world-content doc names for tree-wide
   invariants). For every node of a player workstation, an NPC host of every role and a gateway:
   `perms.write ⊆ perms.read`. Expected green on first run — record it as a **guard**, not a RED.
   If it fails, stop (see "Measured at planning").
7. **Completion** (`complete.test.ts`, "redirect target"): `cat x >> /us<Tab>` is path position.
   Expected green already — a guard.

**REFACTOR:** assess after green, labelled Critical/High/Nice/Skip. Known candidate:
- `fs.appendFile` (`scripting/fsApi.ts`) and the `>>` branch both do reload → resolve → read the base
  → write naming it. Extracting that step is **Nice at most**: the two differ in their separator
  (Node's raw append vs 106) and in how they report (throw vs a terminal line), so a shared helper
  takes both as parameters. Propose the collapsed (inline) version first; extract only if the
  duplicated block is more than the two call sites' differences.

**PRE-PR MUTATION or alternate evidence:**
- **Mutation:** a scoped Stryker run (dev server DOWN, `npm run encode` first, json reporter,
  capped concurrency) over `tokenize.ts`, `pipeline.ts` and the changed lines of `runLine.ts`.
  Kill valuable survivors; the separator function should score 100%.
- **Alternate evidence:**
  - `scripts/testModifiedSinceOpen.ts` re-run live (no `api/` change; it proves the base check `>>`
    relies on).
  - The browser run below.
  - The full unit suite, typecheck and lint.

**Browser run** (the `v2-e2e` runbook; one session, `alice`):
1. `echo one > ~/f; echo two >> ~/f; cat ~/f` → `one`, `two`.
2. `echo x >> /etc` → `bash: /etc: Is a directory`; `echo a >>> f` → the syntax error.
3. On a LAN host whose password the shipped list misses (derive one offline, runbook §6): `hydra`
   fails; `echo <password> >> /usr/share/wordlists/passwords.txt`; `hydra` succeeds; `ssh` lands.
   `tail` does not exist yet — confirm the file with `cat` or `grep <password>`.

**Also in the PR:**
- The version goes to 0.277.0 (`package.json` + lock).
- `man`/`help`: wherever the shell's `>` is documented to the player, `>>` is documented beside it.
- `v2/docs/conventions-and-gotchas.md`: one line under the shell section — `>>` separates with a
  newline and composes on the machine, and why.

**Done when:**
- All acceptance criteria are met.
- Increments 1–7 are green (6 and 7 as guards).
- The full unit suite, `npm run typecheck` and `npm run lint` are clean.
- Mutation has run on the changed shell files, survivors triaged.
- `testModifiedSinceOpen` is green live.
- The browser run is recorded.

## Pre-PR Quality Gate

1. Implementation complete, refactor assessed.
2. Mutation as above (the dev server must be DOWN for the run).
3. `npm run typecheck`, `npm run lint` and `npx vitest run` are green.
4. `testModifiedSinceOpen` is green live, and the browser run is done.
5. No DDD glossary. Words match the epic's: redirect, append, base, wordlist.

## Risks

- **The adjacency flag is the whole grammar.** A tokenizer that decides `>>` by "the last token is a
  redirect" also merges `> >`. Increment 1's `> >` case is the guard; do not drop it.
- **Stale-cache revert is invisible in a single-player test.** Only increment 4's stale-`env.fs`
  case proves the append reads the machine; a test that gives `env.fs` and `reload()` the same tree
  passes against the wrong implementation.
- **An appended empty line does not survive.** `echo "" >> f` on `a` gives `a\n`, which `cat` shows
  as just `a` (the no-trailing-newline convention reads a final `\n` as a terminator), and the next
  append sees the `\n` and adds no separator — so the blank line bash would keep is gone. It follows
  from 106 and costs nothing in play; recorded so nobody "fixes" it into a second rule.
- **Write-without-read** — see "Measured at planning"; increment 6 closes or escalates it.

## Progress (2026-09-27)

Implementation complete on `feat/append-redirect`, awaiting commit approval and the PR.

**What changed from the plan while building it:**
- **The separator rule is tested through `runCommandLine`, not as its own export.** Every case in
  increment 3 (no trailing newline, trailing newline, missing file, empty file, several lines,
  no output) is a `>>` line the player could type, so the table lives in the `>>` describe and
  `appendedContent` stays private.
- **`>>` keeps an existing file's owner and permissions.** Not in the plan, found against
  conventions §7's rule that any writer over an existing node must pass both: without them
  `patches.write` stamps the session's name and tier defaults, so a user appending to a root-owned
  shared file would take it. A test pins it, and the browser run confirmed the wordlist stays
  `-rw-r--r-- root` after an append.
- **A script's `fs.appendFile` has that same gap.** It is out of this slice, so it is recorded in
  conventions §9 rather than fixed here.
- **Increment 6 is a guard, as expected** (`boxSurface.test.ts`: no file on any generated box —
  workstation, every LAN and deep NPC, every gateway — lets a tier write what it cannot read).
  Inverting its filter fails it, so the empty result is not vacuous.

**Evidence:**
- RED → GREEN per increment: tokenizer (3 failing: `>>` emitted two redirects), parser (9 failing),
  runner (8 failing: `>>` overwrote), owner/permissions (1 failing). Completion and the generator
  guard green on first run, recorded as guards.
- Full suite 265 files / 6386 tests; `npm run typecheck` and `npm run lint` clean.
- Mutation (tokenize.ts, pipeline.ts, the changed runLine.ts lines): 290 killed / 4 survived,
  98.6%. Two survivors kill-tested away (stderr kept under `>>`; the machine's target turning into
  a directory after validation). The rest: two on unchanged loop lines, one `?.` on a token that
  always exists when the previous character is `>`, and a `redirect: undefined` that every reader
  treats as absent — equivalent.
- `testModifiedSinceOpen` 7/7 live.
- Browser (v0.277.0): `echo one > f; echo two >> f; cat f` → two lines; `echo x >> /etc` →
  `Is a directory`; `echo a >>> f` → the syntax error; `grep nomatch f >> f` leaves `f` unchanged.
  As root on WEYLAND-NET: `apt install hydra john`; the shipped list cracks `guest:letmein`;
  `echo zzz >> passwords.txt` grows it 285 → 289 bytes and it stays `-rw-r--r-- root`;
  `echo nothing > passwords.txt` → john 0/2; `echo letmein >> passwords.txt` → `cat` shows
  `nothing`/`letmein` and john cracks `guest:letmein`.
