# Plan: T1 Slice 2 — A Defender Reads the End of a Log

**Epic:** `plans/legacy-parity-epic.md`, T1 slice 2, the last of T1's spine. The grill record is under
"T1 — text tools — resolved scope & decisions" (decisions 106–113, 2026-09-27); decisions 108–111 set
this slice's behavior and 112 its scope. Slice 1's as-built (`>>`, v0.277.0, #563) is in the same
section. The decisions made at planning on 2026-09-27 (114–115) are listed below.

**Branch:** `feat/text-readers`
**Status:** Active — decisions and acceptance criteria confirmed by the owner 2026-09-27.

---

## Decided at planning (2026-09-27)

**Owner decisions:**

114. **`head`, `tail` and `wc` link no library.** They join `mkdir`, `touch`, `man`, `whoami` and the
     other group-less utilities in `libraryDeps.ts`, not the `libpcre` file readers: none of them
     matches a pattern, which is the reason that group exists. So the local-exploit surface of
     every box is unchanged, and deleting `/lib/libpcre.so` disables `cat` but not `tail`.
     Rejected: linking `libpcre` like `cat` — no new library in the base set, but three more
     binaries that fire it.
115. **Generated histories keep their `tail -f` lines.** Replaying one prints
     `tail: unrecognized option '-f'`, as `less`, `vim` and `htop` lines already fail: a history is
     what a person typed, not a script the game promises will run. No world content changes and no
     snapshot moves. Rejected: dropping `-f` from the pools (content churn for one flag while its
     neighbours still fail), and accepting `-f` as print-once (a follow that does not follow,
     contradicting 109).

**Derived from existing code and conventions (no owner decision needed):**

- **No file and no stdin is `<cmd>: missing file operand`, exit 1** — `cat`, `nano`, `strings` and
  `node` already say exactly that, and 110 said "as `cat` does".
- **A file argument wins over stdin**, as it does for `cat` and `grep`.
- **A file's lines are `splitContentLines`' lines** — what `cat` shows, so a trailing `\n` is not a
  line (111's rule applies to `head`/`tail` too). Stdin's lines are the lines the upstream stage
  printed, one per iteration.
- **`-n` is a `'string'` flag**, so the binder consumes the next token: `-n 5` works and `-n5` is
  `unrecognized option '-n5'` (strict binder, 109). Its value must match `^\d+$`; anything else is
  `<cmd>: invalid number of lines: '<value>'`, exit 1.
- **`wc` opts into stacking** (`stacking: true`, as `ls` does), so `-lw` ≡ `-l -w`.
- **Joining `SYSTEM_UTILITY_NAMES` is all the `/bin` work**: `routerFs.test.ts` already asserts a
  router's `/bin` equals that list, every generator reads it, and `localExploit.test.ts`'s base
  library set is unchanged by 114.
- **A node script gets `head`, `tail` and `wc` for free** as camelCase globals returning `string[]`
  (`tail('/var/log/auth.log', { '-n': '5' })`); nothing to build, one test to pin it.
- **No `api/` change**, so no wire-check applies.

## Goal

A defender reads the end of a log without scrolling the whole file:
`grep Failed /var/log/auth.log | tail -n 5` shows the last five failed logins, and
`grep Accepted /var/log/auth.log | wc -l` counts who got in.

## Acceptance Criteria

- [ ] `tail f` prints the last 10 lines of `f`, `head f` the first 10; a file shorter than that
      prints whole.
- [ ] `tail -n 3 f` / `head -n 3 f` print 3; `-n 0` prints nothing; `-n abc` and `-n -1` print
      `<cmd>: invalid number of lines: '<value>'` and exit 1.
- [ ] With no file, each reads the piped input: `cat f | tail -n 2`, `grep x f | head -n 1`.
- [ ] `wc -l f` → `<lines> f`; `wc -w f` → `<words> f`; `wc f` and `wc -lw f` → `<lines> <words> f`;
      `… | wc -l` → the bare count. Lines are the lines `cat` shows: `a\nb\nc` is 3, an empty file
      0, `a\nb\n` 2.
- [ ] A second file is `<cmd>: extra operand '<name>'`, exit 1. No file and no piped input is
      `<cmd>: missing file operand`, exit 1.
- [ ] A missing file, a directory or an unreadable file prints `<cmd>: <path>: No such file or
      directory` / `Is a directory` / `Permission denied`, exit 1.
- [ ] `tail -5 f`, `tail -f f` and `wc -c f` are `unrecognized option`.
- [ ] Every machine carries `/bin/head`, `/bin/tail` and `/bin/wc`; `rm /bin/tail` makes `tail`
      `command not found`. Removing `/lib/libpcre.so` leaves all three working.
- [ ] `man tail` and `help` list them.

## Slices

### Slice 2: a defender reads the end of a log

**Value:** Behavior change. A player can read the end of any log or file, and count lines and words,
on every machine, from a file or a pipe.

**Path:**
1. `commands/head.ts`, `tail.ts`, `wc.ts` — each takes one file or stdin.
2. `commands/registry.ts` registers them; `generation/binaries.ts` adds them to
   `SYSTEM_UTILITY_NAMES`; `libraryDeps.ts` is untouched (114).
3. `help` and `man` read the new `manual` blocks with no change.

**Class:** Behavior change (three new commands).
**Delivery:** Independent PR against trunk (`main`), no stack (112).
**Required implementation skills:**
- Before code: `tdd`, `testing`, `refactoring`, `functional`; the `v2-e2e` runbook for the browser run.
- At PR readiness: `mutation-testing`.

**Reduction program:** N/A.
**Transition/terminal evidence:** N/A.

**RED → GREEN increments.** Each test is written first and fails for the stated reason. Assertions
are on the terminal lines and exit code a player sees, through `execute` with a real `FsView`
tree, and through `runCommandLine` wherever the claim is about a pipe.

1. **`tail` prints the end of a file** (`tail.test.ts`). A 12-line file: `tail f` → lines 3–12;
   `tail -n 3 f` → 10–12; `-n 0` → nothing; `-n 20` → all 12; a file ending in `\n` has no phantom
   last line. Fails: no `tail` module.
2. **`tail` reads a pipe** (`runLine.test.ts` or `tail.test.ts` with `stdin`). `cat f | tail -n 2`
   → the last two; a file argument wins over stdin; no file and no stdin →
   `tail: missing file operand`, exit 1.
3. **`tail` refuses** (`tail.test.ts`). `-n abc`, `-n -1` (the binder hands `-1` over as the
   value), a second file, a missing file, a directory, a file the tier cannot read — each its line
   and exit 1. `-f` / `-5` refusals are the binder's and pinned once through `runCommandLine`.
4. **`head` prints the start** (`head.test.ts`) — the mirror of 1–3. Expected to go RED only on
   "no `head` module"; if the refusals share `tail`'s code after the REFACTOR below, their cases
   still run against `head`'s own name in the messages.
5. **`wc` counts** (`wc.test.ts`). `a\nb c\n` → `wc -l` `2`, `wc -w` `3`, `wc` `2 3`, `-lw` `2 3`,
   with ` f` appended for a named file; an empty file `0 0 f`; piped `… | wc -l` the bare count;
   the refusals as 3 with `wc:`; `wc -c` unrecognized. Fails: no `wc` module.
6. **Every machine carries them** (`binaries.test.ts`, which already iterates a workstation, a LAN
   host, an AP gateway and a switch): `/bin/head`, `/bin/tail`, `/bin/wc` exist, world-executable.
   Fails: not in `SYSTEM_UTILITY_NAMES`.
   - *GREEN:* the three names; `registry.ts` entries.
7. **The binary is the tool, the library is not** (`registry` or `availability` tests, beside the
   existing `rm /bin/whoami` case): with `/bin/tail` removed, `tail f` is
   `bash: tail: command not found`; with `/lib/libpcre.so` removed, `tail f` still prints while
   `cat f` fails with the linker error — the presence half proves the fixture removed the library.
8. **A script can call them** (`node.test.ts`, beside the command-global tests):
   `console.log(tail('notes.txt', { '-n': '1' }))` prints the last line. Expected green from 6 —
   a guard.

**REFACTOR:** assess after green, labelled Critical/High/Nice/Skip. Known candidate:
- **"One file or stdin, in `cat`'s words"** is identical in all three commands once `wc` lands:
  arity check, missing-operand refusal, file read with the error mapping, stdin collection. A
  helper in `contentHelpers.ts` taking the command name is **High** at the third copy — three call
  sites, one rule (110), and a drift between them would be a visible inconsistency. Propose it
  collapsed into that one function, not a module per concern. The `-n` parse shared by `head` and
  `tail` rides in the same helper file only if it stays a one-liner; otherwise **Skip**.
- `cat`'s own `formatReadError` is **Skip**: its comment records why the file readers do not share
  one (different reachable errors and exit codes), and `cat` takes many files.

**PRE-PR MUTATION or alternate evidence:**
- **Mutation:** a scoped Stryker run (dev server DOWN, `npm run encode` first, json reporter,
  throwaway configs at the v2 root per conventions §4) over `head.ts`, `tail.ts`, `wc.ts` and any
  new helper in `contentHelpers.ts`. Boundary mutants on `slice`/`-n` and the word split are the
  ones to kill.
- **Alternate evidence:** no `api/` change, so no wire-check; the browser run below; the full unit
  suite, typecheck and lint.

**Browser run** (the `v2-e2e` runbook; one session, `alice`, own box — no network needed):
1. `head -n 2 /etc/passwd`; `wc /etc/passwd`.
2. `su root` (so `auth.log` gains a line), `exit`, then `tail -n 3 /var/log/auth.log` and
   `grep su /var/log/auth.log | wc -l`.
3. `tail -f /var/log/auth.log` → `unrecognized option '-f'`; `head a b` → `extra operand 'b'`;
   `tail -n x f` → `invalid number of lines: 'x'`.
4. `man tail` renders; `help` lists all three.

**Also in the PR:**
- The version goes to 0.278.0 (`package.json` + lock).
- `v2/docs/conventions-and-gotchas.md` §9: the "`tail` is a command the world talks about and nobody
  can run" item is resolved — keep its `grep -c` finding as its own line, since that is still open.

**Done when:**
- All acceptance criteria are met.
- Increments 1–8 are green (8 as a guard).
- The full unit suite, `npm run typecheck` and `npm run lint` are clean.
- Mutation has run on the three commands and any helper, survivors triaged.
- The browser run is recorded.

## Pre-PR Quality Gate

1. Implementation complete, refactor assessed.
2. Mutation as above (the dev server must be DOWN for the run).
3. `npm run typecheck`, `npm run lint` and `npx vitest run` are green.
4. The browser run is done.
5. No DDD glossary. Words match the epic's: head, tail, wc, line, word, wordlist, log.

## Risks

- **`-n -1` reaches the command as a value, not a flag.** The binder consumes the token after `-n`
  whatever it looks like, so `-1` arrives as the string `-1` and must fail the `^\d+$` check —
  increment 3 pins it. A `Number()`-based parse would accept `-1`, `1e3` and `0x10`.
- **Stdin lines vs file lines.** A pipe hands over lines already split; a file hands over content.
  Both must go through the same "what `cat` shows" rule, or `cat f | wc -l` and `wc -l f` disagree —
  increment 5 asserts both on the same content.
- **A bare `wc` column order is ours, not GNU's** (111: lines then words, no bytes). The man page
  must say so, or a player expecting three columns reads the second as bytes.
- **Replayed `tail -f` history lines fail by design** (115). A bug report saying so is answered by
  that decision, not by accepting `-f`.
