# Plan: D10 — polish + the long tail

**Status**: Active — **two of five slices SHIPPED**. Slice 1: `dd1cc5cf` (PR #481) at
**v0.201.0**, thirteen acceptance criteria. Slice 2: `dc1e294c` (PR #482) at **v0.202.0**, twelve
acceptance criteria and ten hand-applied mutants, all killed. Both close-outs are written up below
their sections. Trunk is at v0.202.0 and level with origin. **Slice 3 is planned, its thirteen
acceptance criteria are confirmed, and its branch is cut** — `find` + `strings`, plus the fix for
one finding the planning pass turned up: `strings /bin/ls` prints nothing today, on every machine.
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) → "D10 — resolved scope & decisions
(grill-me, 2026-09-02)", fifteen locked decisions.

## Picking this up cold

1. Read the epic's D10 section — the fifteen decisions, the four forced-rather-than-chosen entries,
   and the "Deliberately NOT built" list. **`bash` is refused, not deferred**; do not port it.
2. **Slices 1 and 2 are shipped and merged.** Read slice 2's close-out before planning slice 3 —
   it settles the `env.ui.*` question for good, records what the mutation gate found, and names the
   one thing slice 3's RED order should start from.
3. **The next action is slice 3's RED 1** on `feat/d10-the-box-answers-questions`. Its plan and
   thirteen confirmed ACs are below, including the decision that `BINARY_STUB` grows a readable
   tail so `strings` has something to print. Its scope is locked in the epic; do not re-grill
   the door.
4. Cut a fresh `feat/…` branch per slice off an up-to-date `main` — check `git status -sb` for
   ahead/behind, per conventions §8, which distinguishes ahead from level where
   `git pull --ff-only` does not.
5. All commands run from `v2/`. Gates: `npm run typecheck`, `npm run lint`, the full non-watch test
   suite. Wait for commit approval before every commit.

## Goal

The terminal stops being a fixture and starts being the player's: they clear it, colour it, ask it
who they are, search a box, read a binary, change what a file permits, and encrypt what they do not
want found — nine commands that legacy had and v2 has been missing since the rewrite began.

## Read before starting

- Epic §"D10 — resolved scope & decisions" — the fifteen decisions and the "Deliberately NOT built"
  list. **Do not re-litigate them here.**
- [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §2 (no single-letter names,
  no plan/decision tags in code), §3 (the gates), §4 (*"a command's mutation score is mostly its
  manual"*), §7 (the `env.fs.reload()` rule that slice 4 turns on).
- `core/commands/types.ts` — `Command`, `CommandEnv`, `CommandCategory`, `withoutTty`,
  `withoutScript`. Every slice here lives against these.
- `ui/env.ts` + `ui/state.ts` — `buildCommandEnv` and the `onResetGame` → `env.resetGame` seam.
  **That is the exact shape three new capabilities take in slice 1**; read it before inventing one.
- Legacy `src/commands/{clear,theme,author,xterm,whoami,find,strings,chmod,gpg}.ts` and
  `src/theme/` are **reference only** — read them for wording, palettes and the shape of the
  problem, not for the mechanism.

## Slice spine

| # | Slice | Observable | Status |
|---|-------|-----------|--------|
| 1 | the terminal is yours | `clear` + Ctrl-L, four themes that survive a reload, `whoami` | ✅ **shipped** — `dd1cc5cf` (PR #481), v0.201.0 |
| 2 | the card and the second window | `author` opens the card; `xterm` opens a FRESH tab | ✅ **shipped** — `dc1e294c` (PR #482), v0.202.0 |
| 3 | the box answers questions | `find / passwd` finds it; `strings /bin/ls` reads the stub | 📋 **planned** — 13 ACs confirmed, branch cut |
| 4 | permissions change hands | `chmod o+r` opens a file to a tier that could not read it | not planned |
| 5 | a file nobody else can read | `gpg -c` then `-d` round-trips; a wrong passphrase fails clean | not planned |

Slices 1 and 2 are built. Plan each remaining slice when its
predecessor lands — D7, D8 and D9 all found later slices cost far less than their plans assumed,
because the seams they needed had already generalized.

**No `api/` change in any slice, so the wire-check is `N/A` throughout** (epic §"Forced rather than
chosen"). Every close-out proof is a browser run — the vantage conventions §7 warns a green
wire-check cannot see, and the one that found four defects at D6's close-out.

---

## Slice 1: a player clears the terminal, colours it, and asks it who they are

**Value**: The first thing a new player does after the boot animation is look at a screen they
cannot clear, in a colour they cannot change, as a user the prompt names but no command confirms.
All three are one-line commands in every real shell. It also lays the `CommandEnv` → UI capability
seam that slice 2's `author` and `xterm` both need, so the two UI slices do not each invent one.

**Path**: `clear` / `theme [name]` / `whoami` → registry lookup → `wrapWithBinaryCheck` for the two
that are real binaries (`clear`, `whoami`), straight through for `theme` (a game command) → the
command reads `env.session` or calls `env.clearScreen()` / `env.setTheme()` → the UI signal changes
→ scrollback, banner or `document.documentElement`'s CSS variables repaint. Ctrl-L reaches
`clearScreen()` directly from the key handler, never through the shell.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk. No stack — nothing later starts before this lands, and
conventions §8 warns against stacking on a branch that will be squash-merged with
`--delete-branch`.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness, not per increment.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### The one thing this plan decides that the grill left open

The epic's "Open for planning" asks **whether a cleared banner survives a reload**. It does not:
`clear` hides the banner for the session, and a reload paints it again. The banner is boot chrome,
not player state, and persisting it would mean a player who cleared once never sees the game's
name again — while nothing about a real terminal survives a reload either. One signal, no storage.

### Acceptance criteria — CONFIRMED 2026-09-02, before any code

- [x] **AC-1** `clear` empties the scrollback **and hides the banner**, exit **0**. The command
      history is untouched — ↑ still recalls the line typed before the clear.
- [x] **AC-2** **Ctrl-L clears the same way without submitting a line**, and whatever the player
      had half-typed is still in the input afterwards.
- [x] **AC-3** A reload paints the banner again (the decision above): the cleared state is
      per-session, never persisted.
- [x] **AC-4** `theme` with no argument lists the four palettes — amber, green, cyan, light — with
      `*` against the active one, exit **0**.
- [x] **AC-5** `theme green` repaints the terminal (the eight `--theme-*` custom properties on
      `document.documentElement` take the green palette's values) and says which theme it switched
      to, exit **0**.
- [x] **AC-6** `theme nope` reports an error naming the four available themes, exits non-zero, and
      **leaves the current theme unchanged**.
- [x] **AC-7** The choice survives a reload: with green stored, the green palette is applied
      **before the first render**, so there is no frame of amber.
- [x] **AC-8** An absent, empty or unrecognised stored value falls back to amber rather than
      throwing or painting nothing — a hand-edited `localStorage` cannot brick the boot.
- [x] **AC-9** `new-game` returns the player to amber, because it clears the whole origin.
- [x] **AC-10** `whoami` prints the ACTIVE session's username and nothing else: the base user at
      the prompt, `root` after `su root`, and the remote account after an `ssh` hop.
- [x] **AC-11** `/bin/clear` and `/bin/whoami` exist on a generated workstation, remote host and
      router; after `rm /bin/whoami`, `whoami` answers `bash: whoami: command not found`, and
      restoring it makes the command work again.
- [x] **AC-12** From a backdoor session (`nc`, no tty) **and** from inside a `node` script, `clear`
      and `theme` both refuse in their own words at exit **1** — an act on a terminal needs one
      that exists and one the player is looking at (epic decision 12).
- [x] **AC-13** `man clear`, `man theme` and `man whoami` render; `help` lists `clear` and `theme`
      under **general** and `whoami` under **filesystem**.

### RED

Behavior tests, in this order — each must fail for the right reason before any production change:

1. **`clear` empties the scrollback and hides the banner** (AC-1). The sharpest RED: no `clear`
   command exists, so the line is `command not found`. Assert through the rendered terminal
   (`@solidjs/testing-library`), not by spying on a signal — the banner is a DOM element with a
   `data-testid`, and the scrollback's emptiness is observable.
2. **History survives the clear** (AC-1's second half) — clear, then ↑, and the previous line is
   back. A separate test, because the tempting implementation clears both.
3. **Ctrl-L** (AC-2) — dispatch the key on the input, assert the same two outcomes plus the
   preserved input value.
4. **The listing marks the active theme** (AC-4) — assert the `*` is on amber by default and moves
   after a switch.
5. **`theme green` repaints** (AC-5) — assert the custom properties on the document element, which
   is what a player actually sees; the signal's value would pass with the DOM never written.
6. **An unknown theme is refused without changing anything** (AC-6) — assert BOTH the error and
   that the properties still hold the previous palette.
7. **Persistence round-trips through injected storage** (AC-7/AC-8) — store green, read it back;
   then a garbage value and an absent key both read as amber. Injected `Storage`, per
   `connectionPersistence.ts`'s precedent, so no global is touched.
8. **The stored theme is applied before the app renders** (AC-7) — assert the properties are
   already set at the moment the terminal first appears, not after an effect runs.
9. **`whoami` follows the active session** (AC-10) — base, after `su`, after an `ssh` hop.
10. **The two binaries are stamped on all three generated filesystems, and gate their commands**
    (AC-11) — including the restore direction, so the gate is proven live rather than absent.
11. **Both refusals, both places** (AC-12) — no tty and in-script, for `clear` and `theme`.
12. **Manual + help placement** (AC-13).

**Mutants to design against** (from `mutation-testing`'s mutator rules — test design only; the
harness runs once at PR readiness):

- **Clearing the history along with the screen** must fail AC-1 — hence the separate ↑ test.
- **Leaving the banner up** must fail AC-1 — assert the banner element is gone, not just that the
  scrollback is empty.
- **Persisting the cleared state** must fail AC-3.
- **Writing the signal but never the DOM** must fail AC-5 — hence assertions on the custom
  properties.
- **Applying the theme inside an effect rather than before render** must fail AC-7 — that mutant is
  exactly the amber flash, and only an at-first-paint assertion catches it.
- **Falling back to "throw" or "paint nothing" on a bad stored value** must fail AC-8.
- **Switching the theme anyway on an unknown name** must fail AC-6 — hence asserting the unchanged
  palette, not only the error line.
- **Reading the BASE session instead of the active one** must fail AC-10 — hence the `su` and hop
  cases, not just the default.
- **Dropping either binary from `SYSTEM_UTILITY_NAMES`** must fail AC-11 on all three filesystems.
- **Swapping either refusal's exit code to 0**, or **declaring `withoutTty` but not
  `withoutScript`** (or vice versa), must fail AC-12 — hence both places asserted for both
  commands.

### GREEN — the minimum, in dependency order

1. **`core/theme/themes.ts`** — `ThemeId` (`amber | green | cyan | light`), `THEMES` (id, display
   name, and the **eight** tokens v2 paints), `DEFAULT_THEME_ID`, `isValidThemeId`. Pure data, no
   DOM, so `core/` stays framework-agnostic and the command can list what exists.
2. **`ui/theme/applyTheme.ts`** — writes the palette onto `document.documentElement` as
   `--theme-*` custom properties (legacy's camelCase→kebab helper ports as-is).
3. **`ui/themePersistence.ts`** — `readStoredTheme(storage)` / `storeTheme(storage, id)` over an
   injected `Storage`, mirroring `connectionPersistence.ts`. An absent or unrecognised value reads
   as `DEFAULT_THEME_ID`.
4. **`main.tsx`** — apply the stored theme **before** `render(...)`. This is AC-7's whole
   mechanism; anywhere later is a flash of amber.
5. **`ui/state.ts`** — a `bannerVisible` signal (starts true), `clearScreen()` (empty the
   scrollback, hide the banner, leave history alone), a `theme` signal seeded from storage, and a
   `setTheme` that applies **and** persists in one place, so the DOM and the stored value cannot
   disagree.
6. **`ui/env.ts` + `core/commands/types.ts`** — three new capabilities in the `onResetGame` shape:
   `env.clearScreen()`, `env.setTheme(id)`, `env.currentTheme()`. `notWired` defaults, per the
   file's own rule that silent no-ops hide missing wiring.
7. **`core/commands/clear.ts` / `theme.ts` / `whoami.ts`** — each with `tier`, `availability`, a
   `manual`, and — for `clear` and `theme` — `withoutTty` **and** `withoutScript`.
8. **`ui/screens/Terminal.tsx`** — wrap the banner in `<Show when={bannerVisible()}>`, and add the
   Ctrl-L branch to the handler that already owns ↑/↓/Tab.
9. **`core/generation/binaries.ts`** — `clear` and `whoami` into `SYSTEM_UTILITY_NAMES`
   (epic decision 15; the stamping rides with the commands it gates).
10. **`registry.ts`** — three imports, three entries; **`availability.ts`** — `theme` joins
    `GAME_COMMANDS` (no binary), while `clear` and `whoami` stay gated like every other real tool.
11. **Version bump** to `0.201.0` in `v2/package.json` + `v2/package-lock.json`
    (`npm install --package-lock-only`).

### Three things GREEN must get right

**One writer for the theme, or the DOM and storage drift.** `setTheme` applies the palette and
persists it in the same function; the command never touches the DOM (it cannot — it lives in
`core/`), and nothing else writes the storage key. The moment two places do either job, a reload
can disagree with the screen.

**`index.css`'s `:root` block stays, and stays amber — as the pre-JS fallback only.** It paints the
frame before any script runs; `main.tsx` takes over from the first render. Say so in a comment
above it, because it looks exactly like a second source of truth for the palette and the next
reader will otherwise either delete it or start editing it instead of `themes.ts`.

**`clear` hides the banner; it does not delete it.** A signal, not a mutation of the scrollback
model — the banner is boot chrome that a reload restores (AC-3), and a `TerminalLine` model that
had to represent "the banner" would be the renderable-line-kind mistake epic decision 10 already
refused for `author`.

### Deliberately not in slice 1

`author` and `xterm` (slice 2 — they need the same capability seam this slice lays, which is the
argument for landing this one first); `find`, `strings`, `chmod`, `gpg`; a cross-tab `storage`
listener so an open tab repaints when another switches theme (epic decision 9 — a new tab inherits
at boot, and that is enough); legacy's six unpainted palette tokens (epic decision 8) — the two
the author card needs arrive **with** the card, in slice 2.

### REFACTOR

Assess only if it earns its place. One live candidate to judge with the code in front of you: the
three new `CommandEnv` capabilities plus `resetGame` are all "the command asks the UI to do
something and gets nothing back" — if a fourth and fifth arrive in slice 2 (`author`'s overlay,
`xterm`'s tab), a grouped `ui` sub-API may read better than five flat members. **Do not pre-empt it
here**: at three it is speculative, and the owner has pruned speculative abstraction before.

### PRE-PR MUTATION

Run focused on the changed production files: `core/theme/themes.ts`, `core/commands/clear.ts`,
`core/commands/theme.ts`, `core/commands/whoami.ts`, `ui/themePersistence.ts`,
`ui/theme/applyTheme.ts`. `registry.ts` and `binaries.ts` are declaration lists already covered by
their own invariant/golden tests. Address valuable survivors and re-run within the same gate.
Expect the three manual pages to dominate the survivor count — conventions §4.

**Wire-check: `N/A`.** No `api/` path changes: every capability here is client-side UI state and
`whoami` reads a session the client already holds. Alternate evidence is the jsdom behavior suite
plus AC-11 proving the availability gate through the real registry wrapper.

### Browser close-out

Run the game (skill: `v2-e2e`) and drive the whole beat: clear a full screen, Ctrl-L on a
half-typed line, cycle all four themes, reload and confirm the colour survives with no amber
flash, `su root` then `whoami`, `ssh` to a box and `whoami` there, `rm /bin/whoami` and see the
gate fire, then `new-game` back to amber.

### PR-ready when

AC-1…AC-13 met; `npm run typecheck` and `npm run lint` clean; the full non-watch test suite green;
the mutation gate closed or its survivors argued; the browser close-out run; the version bumped in
both files; and the human approves the commit.

**Slice complete when** its PR lands.

---

## Slice 1 close-out — SHIPPED `dd1cc5cf` (PR #481), v0.201.0

### What actually went RED, and what did not

Seven of the planned twelve RED steps failed first, for the reason the plan predicted. Three
passed the moment they were written, and that is worth recording rather than hiding: the minimum
implementation for an earlier step had already satisfied them, so there was no smaller code for
them to drive out. Each was proven by applying the mutant it exists to catch, watching it fail,
and reverting — a test that has never been seen to fail is a decoration, not a guard.

| Test | First run | How it was proven |
|---|---|---|
| history survives the clear | green | `clearScreen` also emptying the history → ✗ `toHaveValue('clear')` |
| the banner returns on the next boot | green | `startGame` no longer restoring it → ✗ `Unable to find [data-testid=terminal-banner]` |
| the stored theme is applied before render | green | painting deferred to a `queueMicrotask` → ✗ `expected '' to be '#22c55e'` |

**One planned RED step was replaced by something better.** The plan asked for AC-7 to be asserted
"at the moment the terminal first appears", which no jsdom test can actually observe. What it
became instead is a claim that CAN fail: `adoptStoredTheme` paints **synchronously, on the very
next line** — no flush, no microtask, no effect. That is precisely the amber-flash mutant, and the
row above shows it dying.

**Two acceptance criteria had no numbered RED step and now have tests anyway.** AC-3 (a reload
paints the banner again) and AC-9 (`new-game` returns to amber) were carried only by mutant
bullets in the plan. Both are now falsifiable. AC-9's remains partial and is recorded as such
below.

### The design the existing suite corrected

The first version seeded the theme signal at module scope from `readStoredTheme(localStorage)`.
That failed `state.ts module import > does not read game config from storage at import time` — a
regression guard from the intro-screen work pinning that importing `state.ts` has no side effects.
The fix is better than the plan's sketch: the read became an explicit boot step,
`adoptStoredTheme()`, called from `main.tsx` before `render`. `setTheme` stays the only writer of
the stored value; `adoptStoredTheme` deliberately writes nothing back, because reading a choice is
not making one.

**`resetTerminal` was dead and wrong.** `ui/state.ts` already exported one, documented as
"doubles as the backing for a future `clear` command", with zero callers anywhere — and it wiped
the command history and reset the cwd, which AC-1 forbids. Replaced rather than left beside the
real thing.

**`availability.ts` pointed the wrong way.** Its `SHELL_BUILTINS` note read "grow this as builtins
land (legacy also had exit/clear/whoami/bash)". Following it would have put `clear` in the
always-available set and silently un-gated it, contradicting decision 15. Rewritten to say why
these two are real binaries here.

### What the mutation gate found

Focused on the six changed production files; `registry.ts` and `binaries.ts` excluded as
declaration lists with their own invariant tests. **Two real holes, both closed:**

- **`clear` could have printed anything and nothing would have noticed.** `lines: []` →
  `["Stryker was here"]` survived: the terminal test asserted the OLD output was gone, never that
  nothing new appeared. `clear.test.ts` now pins an empty result.
- **Nothing asserted that a theme painted at all.** Every colour of the light palette, and
  `colors: {}` wholesale, survived. `applyTheme.test.ts` now applies all four and requires each of
  the eight tokens to be non-blank. Its token list is written out rather than derived from
  `ThemeColors`, deliberately: it is the contract BETWEEN the palette and `index.css`, so a field
  renamed without renaming the CSS token has to fail. Deriving it from the object under test would
  agree with any rename and prove nothing.

**One piece of dead data removed.** Every `id: 'amber'` mutant survived because nothing reads
`ThemeDefinition.id` — the record key IS the id and `THEME_IDS` is the order. Ported from legacy,
which iterated definitions where this code iterates ids. Gone.

| File | Before | After |
|---|---|---|
| `core/theme/themes.ts` | 46.8% | **98.3%** |
| `ui/theme/applyTheme.ts` | 100% | **100%** |
| `ui/themePersistence.ts` | 100% | **100%** |
| `core/commands/clear.ts` | 47.8% | 52.2% |

The remaining survivors are classified, not waved through:

| Survivor | Verdict |
|---|---|
| `typeof value === 'string'` in `isValidThemeId` | **Equivalent.** A non-string is not in the set either way; the guard exists so `Set<string>.has` can take an `unknown` without an assertion. Documented in the code so nobody re-triages it. |
| manual prose, `description` | The expected family — conventions §4: a command's mutation score is mostly its manual. |
| `tier: 'guest'`, `availability` ×2 per command | The known repo-wide family already in conventions §9. Nothing reads `Command.tier`, and `AvailabilityRule` is declared but never enforced — `availability.ts`'s own comment admits it. Pre-existing; not this slice's to fix. |

Read the survivors from `reports/mutation/mutation.json` rather than the console: the captured log
was truncated to its last 72 lines and showed 8 of 77, which looked like a clean run and was not.

### Browser close-out — the whole beat, run twice

Against `vercel dev` + local supabase, banner checked at **v0.201.0** before driving anything.

| Beat | Result |
|---|---|
| `clear` a full screen | 5999 chars → **30**: the prompt alone. Banner gone, `clear`'s own echo gone |
| history after the clear | ↑ walked `clear` → `cat /etc/passwd` → `ls -la /etc` |
| Ctrl-L, half-typed | 262 chars → prompt only; **`cat /etc/pas` still in the box**, nothing submitted |
| four palettes | listing marked amber; green/cyan/light each repainted and named itself |
| `theme nope` | refused with all four names; palette and stored value untouched |
| reload | came back **light**, banner restored |
| `su root` → `whoami` | `alice` → `root` |
| `ssh root@192.168.102.1` → `whoami` | landed `root@ap-gw:/root#`, answered **`root`** |
| `rm /bin/whoami`, `rm /bin/clear` | both `command not found`, both restored and working |
| `new-game -y` | stored `light` → **`null`**, palette back to amber, intro screen |

**AC-7 was measured, not inferred.** The first attempt was worthless — the sample landed 650ms
after `DOMContentLoaded`, which says nothing about a flash. A temporary probe in `index.html`
(reverted; the file is untouched) sampled at parse, first frame, second frame and
`DOMContentLoaded`:

```
parse            60ms   --theme-text: (unset)   #root children: 0
frame 1          87ms   --theme-text: (unset)   #root children: 0
frame 2          89ms   --theme-text: (unset)   #root children: 0
DOMContentLoaded 2244ms --theme-text: #292524   #root children: 1
first-paint      2256ms
```

The browser's **first paint is 12ms after the palette is already light**. There is no amber frame
because there is no painted frame at all before the stored theme lands.

### Known gap, recorded rather than papered over

**AC-9 rests partly on untested pre-existing code.** `resetGame` is `localStorage.clear()` — the
whole origin — and has no test; only `new-game`'s call of the seam is covered. What is pinned is
that a wiped origin boots amber. What is NOT pinned is that `resetGame` still calls `clear()`: a
future "optimisation" that removed only game keys would strand a player in the colour of a game
they no longer have, and only the browser run would catch it. Not fixed here because the fix is a
test for a seam this slice does not own.

### PR-ready checklist

- [x] All 13 ACs met.
- [x] `npm run typecheck`, `npm run lint`, full non-watch suite: **4184 passed**, from `v2/`.
- [x] Mutation gate closed; every survivor killed or classified above.
- [x] Wire-check `N/A` — no `api/` path changes; every capability is client-side and `whoami`
      reads a session the client already holds.
- [x] Browser close-out run (twice) and written up.
- [x] Version bumped in both files to **0.201.0**.
- [x] Squash-merged as `dd1cc5cf` (PR #481); branch deleted, trunk level with origin.

### For slice 2

The `CommandEnv` → UI capability seam is laid: `clearScreen`, `currentTheme`, `setTheme` join
`resetGame` in the "command asks the UI to do something and gets nothing back" shape. `author`'s
overlay and `xterm`'s tab slot into it rather than each inventing one — which was the argument for
landing this slice first, and it held.

**The grouped `env.ui.*` refactor was assessed and declined at four members**, on the grounds that
grouping before slice 2's two exist would mean either forcing them into a shape chosen without
them or reshaping it twice. Judge it again at six, with the code in front of you.

Legacy's six unpainted palette tokens stay out (epic decision 8) — **but the author card needs
two of them**, so they arrive WITH the card in slice 2, and `applyTheme.test.ts`'s hardcoded token
list is the file that must grow alongside `ThemeColors`.


---

## Slice 2: the card and the second window

**Value**: Two commands legacy had that make the terminal feel like somewhere rather than
something. `author` is the game's only human voice — the person who wrote it, in his own words —
and it is the one screen a player reaches for on purpose rather than because a mission sent them.
`xterm` is what anybody does when they want two of a terminal: keep a shell on their own box while
the other one is three hops deep. Both answer `command not found` today.

`xterm` also pays off a hazard that already exists. A second tab opened by hand lands inside
whatever box the first tab is ssh'd into, and `exit` in one ends a row the other still believes it
holds. Nobody has hit it because nobody opens a second tab, which is precisely what this command
invites — so it ships with the fix, not after it.

**Path**: `author` → registry (an ungated game command) → returns a `mode_change` → `executeLine`
sets `overlayMode` → `Terminal`'s `Switch` matches a third variant → the `Author` screen takes the
keyboard, and ESC or `q` hands the terminal back. `xterm` → registry → `env.openTerminal()` →
`ui/state.ts` opens a tab at the origin carrying the fresh flag → that tab's `main.tsx` consumes
the flag and `startGame` skips hop rehydration.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk, cut from `main` at v0.201.0. No stack: slice 3 is
`find` + `strings`, which touches none of this.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness for the accumulated scope.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### The three things this plan decides that the grill left open

None of these reopens a locked decision; each is the implementation choice that decision implies.

**1. The fresh flag is one-shot.** Decision 13 records its own residual as *"if the fresh tab later
elevates, a RELOAD of either tab rebuilds one stack from both tabs' rows"* — which is only true if
the flag does not survive that reload. `window.open` sends the tab to `…?fresh`, and that URL is
what a reload re-requests. So the flag is **consumed at boot**: read it, strip it with
`history.replaceState`, then start the game. Leave it in place and a fresh tab that elevated and
reloaded would come back demoted with its own `su` row still open on the server — a worse outcome
than the residual the decision knowingly accepted, arrived at by accident.

**2. The `author` mode carries no payload.** `{ kind: 'author' }`, not
`{ kind: 'author', profile }`. `nano` and `lynx` carry content because theirs is different every
time; the card's copy is one constant, and piping it through the mode would leave `author.test.ts`
asserting only that a constant travelled. The copy lives with the screen that paints it — and
therefore **not** beside `themes.ts`, because nothing in `core/` reads it. (`theme` genuinely lists
its palettes, which is why those live in `core/`; the parallel is misleading and worth naming
before someone draws it.)

**3. Two new palette tokens, not three.** Legacy's card paints `--theme-link`,
`--theme-link-hover` and `--theme-avatar-border`. Decision 8 names two, and the third is avoidable:
the hover state uses `--theme-text-bright`, which all four palettes already define and half the
tree already paints. A `linkHover` token would be a ninth value whose whole job is to be a slightly
different shade of one we have — in four palettes, forever, with a test pinning each.

### Acceptance criteria — CONFIRMED 2026-09-02, before any code

- [x] **AC-1** `author` opens a full-screen card carrying the author's name, the bio paragraphs and
      the avatar image, plus **real anchors** for LinkedIn and GitHub — each with its `href`,
      `target="_blank"` and `rel="noopener noreferrer"`.
- [x] **AC-2** ESC or `q` closes the card and hands back the terminal with the scrollback intact.
      The card leaves **no line behind** — like `nano` and `lynx`, it was a screen, not output.
- [x] **AC-3** The card takes the keyboard the moment it opens: a player can quit without clicking
      into it first.
- [x] **AC-4** The copy is legacy's, verbatim — name, six paragraphs, avatar URL and both links.
- [x] **AC-5** `--theme-link` and `--theme-avatar-border` are painted on `document.documentElement`
      for **all four** palettes, and the card's links and avatar border read them: `theme green`
      while the card is open recolours it.
- [x] **AC-6** `xterm` opens a new browser tab at the game's origin, prints one line saying so, and
      exits **0**.
- [x] **AC-7** The new tab boots at the player's **own workstation as their own user**, even when
      the opening tab is inside an `ssh` hop or holding a `su` elevation — hop rehydration is
      skipped for that boot.
- [x] **AC-8** The flag is one-shot: after the fresh tab boots, the URL no longer carries it, so a
      **reload of that tab rehydrates normally**.
- [x] **AC-9** An ordinary boot — no flag — still rehydrates. A `su` elevation surviving a refresh
      is existing behaviour and this slice must not cost it.
- [x] **AC-10** From a backdoor session (`nc`, no tty) **and** from inside a `node` script, `author`
      and `xterm` each refuse in their own words at exit **1** (decision 12: an act on a terminal
      needs one that exists and one the player is looking at).
- [x] **AC-11** Both are **ungated game commands**: no `/bin/author` or `/bin/xterm` exists on a
      generated machine, and both work anyway — there is nothing to `rm`.
- [x] **AC-12** `man author` and `man xterm` render; `help` lists both under **general**.

### RED

Behavior tests in this order. Each must fail for the right reason before any production change —
and where one passes on arrival, prove it with the mutant it exists to catch and write that down
(slice 1's close-out has the shape).

1. **`author` opens the card** (AC-1). Sharpest RED available: no command exists, so the line is
   `command not found`. Assert through the rendered terminal — the name, a bio paragraph, and both
   anchors by `href`. Not by reading `overlayMode()`: a signal holding the right value with nothing
   on screen is the failure this test exists to catch.
2. **ESC and `q` hand the terminal back** (AC-2), and the scrollback still holds what it held. Two
   keys, one test body — `lynx`'s `quits()` already treats them as one question.
3. **The card has the keyboard on open** (AC-3) — assert `document.activeElement`, the claim
   `onMount(() => screen?.focus())` actually makes.
4. **The palette paints the two new tokens** (AC-5) — extend `applyTheme.test.ts`'s **hardcoded**
   `PAINTED_TOKENS` list. That list is deliberately not derived from `ThemeColors` (slice 1's
   close-out says why), so growing it by hand is the point, not an oversight.
5. **The card reads the tokens** (AC-5, second half) — the avatar's border colour and the anchors'
   colour resolve through `var(--theme-…)`, so a card hard-coding amber fails.
6. **`xterm` opens a tab and says so** (AC-6) — spy on the capability at the `CommandEnv` seam and
   assert the printed line and exit 0. `core/` never touches `window`.
7. **The capability opens the origin with the fresh flag** (AC-6/AC-7) — at the `ui/state.ts`
   layer, with `window.open` spied. This is the only test that knows the flag's spelling.
8. **A fresh boot skips rehydration** (AC-7). The behaviour claim: with server session rows saying
   the player is three hops deep, a fresh-flagged boot leaves them standing on their own
   workstation as their own user. Drive it through `startGame`, assert the prompt.
9. **An ordinary boot still rehydrates** (AC-9) — the same fixture without the flag, opposite
   outcome. Written second on purpose: it is the regression this slice can most easily cause.
10. **The flag is consumed** (AC-8) — after boot the location no longer carries it. Test the
    read-and-strip step over injected `location`/`history` fakes, the way `themePersistence` takes
    an injected `StorageLike`.
11. **Both refuse without a tty and inside a script** (AC-10) — the two arms `clear` and `theme`
    already have; follow their tests exactly.
12. **`help` and `man` pick both up** (AC-12), and **neither is stamped into `/bin`** (AC-11) — the
    inverse of slice 1's AC-11, and the assertion that keeps `GAME_COMMANDS` honest.

### GREEN — the minimum, in dependency order

1. `ModeChange` gains `{ kind: 'author' }`. This **breaks the build on purpose**: `OverlayMode` in
   `ui/state.ts` is `Extract<ModeChange, { kind: 'nano' | 'lynx' }>` and `setOverlayMode(result.mode)`
   stops compiling — the tripwire that comment claims. Widen the `Extract` and add the `Match`.
2. `core/commands/author.ts` — returns the mode change, `withoutTty` + `withoutScript`, category
   `general`, full manual. Register it; add `author` to `GAME_COMMANDS`.
3. `ui/screens/Author.tsx` — the card, holding legacy's copy, `tabIndex={-1}` + `onMount` focus +
   the `quits()` key handling, painted from CSS variables. `Lynx.tsx` is the template for all four.
4. `ThemeColors` gains `link` and `avatarBorder`; the four palettes gain their values (legacy's
   `theme/themes.ts` has all four, verbatim). `applyTheme` needs no change — it walks the object.
   Add the two to `index.css`'s pre-JS `:root` fallback so the frame before any script agrees.
5. `CommandEnv` gains `openTerminal: () => void`; `ui/env.ts` maps `onOpenTerminal` with a
   `notWired` stub; the test factory gets a default. Slice 1's `clearScreen` is the exact template.
6. `core/commands/xterm.ts` — calls it, prints the line, both refusals, category `general`, full
   manual. Register it; add `xterm` to `GAME_COMMANDS`.
7. `ui/state.ts` — `openTerminal()` opens `${origin}?fresh` in a new tab, and `startGame` takes an
   option that skips `rehydrateSessions`.
8. `ui/freshTab.ts` — read-and-strip over injected `location`/`history`. `main.tsx` calls it before
   `render` and hands the answer to `<App>`, which hands it to `startGame`. Same boot-step shape as
   `adoptStoredTheme()`, and for the same reason: it must happen before anything renders.

### Three things GREEN must get right

- **The avatar is a remote image.** `https://avatars.githubusercontent.com/u/613724` is the only
  outbound request the game makes for a decoration. It must not be able to break the card: give the
  `img` fixed dimensions so a slow or failed load does not reflow the text beside it, and let a
  broken image be a broken image — no fallback machinery for a picture.
- **`startGame`'s new option must default to rehydrating.** Every existing caller and every
  existing test passes nothing, and the behaviour they pin is the one that must not move. An option
  that defaults the other way turns AC-9 into a test nobody wrote.
- **Strip the flag before `startGame`, not after.** The strip is a `replaceState` on the same tick;
  ordering it after the boot leaves a window where a reload lands on the flag again. It reads like
  a nit and it is the whole of AC-8.

### Deliberately not in slice 2

`find`, `strings`, `chmod`, `gpg` (slices 3–5). The remaining four unpainted legacy tokens —
`accent`, `accentText`, `border`, `linkHover` — which still paint nothing here (decision 8). A
`storage`-event listener so an open tab repaints when another switches theme (decision 9: a new tab
inherits at boot, and that is enough) — worth re-reading now that `xterm` makes second tabs
ordinary, and still correct. Any attempt to make the two tabs share one session stack: decision 13
keeps them independent, and the reload lossiness is recorded, not solved.

Also inherited rather than decided: `author | grep` feeds `grep` nothing, because
`collectStageOutput` gives every `mode_change` an empty stdout. That is `runLine`'s existing answer
for `nano` and `lynx` and this slice neither changes nor tests it.

### REFACTOR

**The `env.ui.*` grouping comes up for judgement here, at five members.** `resetGame`,
`clearScreen`, `currentTheme`, `setTheme` and now `openTerminal` are all "the command asks the UI to
do something and gets nothing back". Slice 1 declined the grouping at four on the grounds that
grouping before the fifth existed would mean choosing a shape without it. The fifth now exists —
so make the call with the code in front of you, and note that `currentTheme` is the odd one (it
reads, the others act), which is an argument about what the group would actually be called.

Second candidate: `Author.tsx` and `Lynx.tsx` will both hold a `quits()` predicate and a
focus-on-mount. Two is not a pattern; judge it, do not pre-empt it.

### PRE-PR MUTATION

Focused on the changed production files: `core/commands/author.ts`, `core/commands/xterm.ts`,
`core/theme/themes.ts`, `ui/freshTab.ts`, and the `startGame` option. `registry.ts` and
`availability.ts`'s sets are declaration lists with their own invariant tests. Read survivors from
`reports/mutation/mutation.json`, never the console (conventions §4). Expect the two manual pages
to dominate the count, and expect `themes.ts` to need its new tokens covered the way slice 1's gate
had to cover the old ones — every colour of every palette survived until a test required each
painted token to be non-blank.

### Browser close-out

`vercel dev` + local supabase, banner version checked before driving anything. The beat worth
targeting: **`ssh` three hops deep, then `xterm`** — the new tab must come up on the player's own
workstation while the first tab stays where it was, and neither tab's `exit` may end the other's
row. Then `author` in the fresh tab, `theme cyan`, and confirm the card recoloured; ESC; reload the
fresh tab and confirm it rehydrates (AC-8) and keeps cyan (slice 1's AC-7, still true with a second
tab in play). Two sessions via `--session`, per the E2E runbook, so both tabs stay alive.

### PR-ready when

- All 12 ACs met, each by a test that has been seen to fail.
- `npm run typecheck`, `npm run lint`, and the full non-watch suite pass from `v2/`.
- Mutation gate closed: every survivor killed or classified in the close-out.
- Wire-check **`N/A`** — no `api/` path changes; both commands are pure client (epic "Forced rather
  than chosen").
- Browser close-out run and written up, including the two-tab beat.
- Version bumped in **both** `v2/package.json` and `v2/package-lock.json`.

---

## Slice 2 close-out — SHIPPED `dc1e294c` (PR #482), v0.202.0

### What actually went RED, and what did not

Nine of the twelve planned RED steps failed first, each for the reason the plan predicted. Three
passed the moment they were written, because the production code they describe had already been
written to satisfy an earlier step — `withoutTty`/`withoutScript` and the manuals both ride into
GREEN with the command that declares them. Each was proven by applying the mutant it exists to
catch, watching it fail, and reverting. **Ten mutants applied, ten killed.**

| Test | First run | How it was proven |
|---|---|---|
| an ordinary boot still rehydrates | green | `startGame` never rehydrating → ✗ `expected 'tester' to be 'root'` |
| `author`/`xterm` refuse without a tty | green | `withoutTty` removed from each, separately → ✗ ×2 |
| `author`/`xterm` refuse inside a script | green | `withoutScript` removed from each, separately → ✗ ×2 |
| `help`/`man` pick both up | green | each command's `manual` renamed away → ✗ ×2; `author.category` → `'filesystem'` → ✗ |
| neither is stamped into `/bin` | green | `author` added to `SYSTEM_UTILITY_NAMES` → ✗ |
| both work with no binary present | green | `author`/`xterm` dropped from `GAME_COMMANDS` → ✗ ×2 |

The sharpest REDs were the two module-resolution failures (`Failed to resolve import "./xterm"`,
`"./freshTab"`) and the one that named the actual bug the slice exists to prevent: a fresh boot
that rehydrated anyway, `expected 'root' to be 'tester'`.

**The compile-time tripwire fired as advertised.** Adding `{ kind: 'author' }` to `ModeChange`
broke the build at `ui/state.ts` before anything else was touched, because `OverlayMode` narrowed
to nano/lynx. That comment claimed a third variant would "fail to compile here rather than opening
a blank overlay"; it does, and it is now the second variant to have proven it.

### The three decisions the plan made, and how they held

All three were argued before code and none needed revisiting.

- **The flag is one-shot.** Proven live: the fresh tab's URL carries no `?fresh`, and reloading it
  brings it back at `root@ap-gw` — rehydrated, exactly as decision 13's recorded residual says.
- **The `author` mode carries no payload.** Nothing wanted one. `author.test.ts` would have had
  nothing to assert but "a constant travelled", and the browser proves the copy far better.
- **Two palette tokens, not three.** The hover borrows `--theme-text-bright`, and no test or beat
  missed the third.

### What GREEN cost, and what it did not

`author` needed **no new capability at all** — the plan predicted this and it held. A `mode_change`
travels the road `nano` and `lynx` already use, so the slice added exactly one seam, `openTerminal`,
in the shape `resetGame` established. The `CommandEnv` → UI family is now five.

**The type system found four assertions reading past a union.** `author` has no `content`, so
`overlayMode()?.content` stopped narrowing in `state.test.ts`. Rather than assert past it with a
cast, those go through an `overlayContent` helper that narrows to the apps which actually carry a
buffer.

**A test-isolation hole that had been latent since the first overlay shipped.** This slice's tests
are the first to leave a full-screen app open — the lynx tests close theirs with a keypress — and
`startGame` does not reset `overlayMode`. Nor should it: no player can start a game from inside an
overlay, because the app holds the keyboard and there is no prompt to type into. So the reset is
harness hygiene, and it is an `afterEach` rather than a line in `renderTerminal`, because the test
that broke hand-rolls its own `startGame` and a fix inside the helper would have missed it. Left
alone, a test that leaves an app open hands the NEXT one a terminal with no input field, which
reads as that test's own failure.

### What the mutation gate found

Focused on the four changed production files. `startGame`'s new condition was covered by the manual
mutant already applied at RED 9 rather than by mutating all two thousand lines of `state.ts`.

| File | Before | After |
|---|---|---|
| `ui/freshTab.ts` | — | **100%** |
| `core/theme/themes.ts` | — | **98.5%** |
| `core/commands/author.ts` | 52.2% | **65.2%** |
| `core/commands/xterm.ts` | 51.9% | **63.0%** |

**One real hole, in a test this slice had just extended.** `synopsis: ''` and the example object →
`{}` both survived, because `man.test.ts` asserted only that the `SYNOPSIS` and `EXAMPLES` HEADINGS
rendered. A page with a blank synopsis and one empty example passed as "a written manual, not a
generated stub" — which is precisely what you get when a command is added by copying another. Both
sections must now name the command they document. Six mutants died, and the same claim got stronger
for `clear`, `theme` and `whoami`.

The rest are the two families already classified:

| Survivor | Verdict |
|---|---|
| manual prose, the `help` one-liner, an example's hanging description | The expected family — conventions §4: a command's mutation score is mostly its manual |
| `tier: 'guest'`, `availability` ×2 per command | The repo-wide family in conventions §9. Nothing reads `Command.tier`; `AvailabilityRule` is declared but never enforced. Pre-existing |
| `typeof value === 'string'` in `isValidThemeId` | The equivalent mutant slice 1 documented in the code itself. Unchanged |

### REFACTOR — one candidate declined for good, one deferred

**The grouped `env.ui.*` is settled, not deferred again.** Slice 1 declined it at four members on a
counting argument and said to judge again at five or six. With the code in front of us the argument
is not about counting: **the set has no boundary that is not arbitrary.** `CommandEnv` carries
eleven flat members that all mean "the command asks the UI to do something" — `setCwd`,
`setInterface`, `prompt`, `pushSession`, `popSession` and `setChildCommand` sit right beside the
five this would gather. Grouping five of eleven carves the set along *"capabilities added since D10
slice 1"*, which is a fact about our git history. And every existing sub-API (`fs`, `patches`,
`scan`, `hydra`, `su`) is named for a DOMAIN; `ui` would name a LAYER, which is a different kind of
grouping with no natural edge. Grouping all eleven is large churn for no behaviour change, and
`env.prompt(...)` reads better than `env.ui.prompt(...)`. **Do not reopen this without a new
argument.**

**The duplicated `quits()` waits for a third.** `Author` and `Lynx` hold identical three-line
predicates. `Nano` was checked and does not make it three: its `declines` answers a y/n prompt and
merely happens to include `Escape`. Real nano exits on `^X`, so a shared helper would invite the
third screen to conform when it should not.

### Browser close-out — the two-tab beat

Against `vercel dev` + local supabase, banner checked at **v0.202.0** before driving anything.

| Beat | Result |
|---|---|
| `ls /bin` | no `author`, no `xterm` — and both run anyway |
| `author` | card takes the screen; `document.activeElement` is **MAIN**; the terminal input is **gone**, not covered |
| the card under amber | avatar border `#f59e0b`, links `#fbbf24` |
| ESC | terminal back, scrollback intact — the echo runs straight into the next prompt, **no line between** |
| `theme cyan`, reopen | border `#06b6d4`, links `#22d3ee` |
| three sessions deep | `alice@workstation` → `su root` → `ssh root@192.168.167.1` → `root@ap-gw:/root#` |
| **`xterm` from there** | second tab opens; tab 1 prints `Opening new terminal...` and **stays at `root@ap-gw`** |
| **the fresh tab** | `alice@workstation:/home/alice$` — own box, own user, hop chain skipped |
| its URL | `location.search` is `""` — the flag was spent at boot |
| its theme | inherited cyan (`jshack:theme` = `cyan`) |
| **reload it** | back at `root@ap-gw:/root#` — it rehydrates, so the flag really was one-shot; cyan survives |
| `help` | both listed under **General** with their descriptions |

The reload is the beat that matters: it proves AC-8 by CHANGING behaviour. Had the flag survived in
the URL, that tab would have come up at `alice@workstation` a second time.

### Recorded rather than papered over

**AC-10 was not re-run in the browser.** Driving the refusals live needs `apt install nodejs` plus a
script on disk, and they are pure `core/` logic with no UI involvement — the vantage a browser adds
is nil. They rest on tests at both seams (`runLine`'s tty arm, `commandContext`'s script arm) with
four killed mutants behind them. Stated here so nobody reads the beat table as covering it.

**The two-tab reload residual is by design, not a defect.** Once the fresh tab has its own
elevation, a reload of either tab rebuilds ONE stack from both tabs' rows. Epic decision 13 accepted
this knowingly; it is the same lossiness `sessionRehydrate` already documents for a refresh.

### PR-ready checklist

- [x] All 12 ACs met, every one by a test that has been seen to fail.
- [x] `npm run typecheck`, `npm run lint`, full non-watch suite: **4201 passed**, from `v2/`.
- [x] Mutation gate closed; every survivor killed or classified above.
- [x] Wire-check `N/A` — no `api/` path changes; both commands are pure client.
- [x] Browser close-out run and written up, including the two-tab beat.
- [x] Version bumped in both files to **0.202.0**.
- [x] Squash-merged as `dc1e294c` (PR #482); branch deleted, trunk level with origin.

### For slice 3

`find` and `strings`, and both binaries are **already stamped** into `SYSTEM_UTILITY_NAMES` — so
unlike slices 1 and 2 there is no generation half at all. It is pure command work against seams
that exist: `env.fs.read`, `env.fs.list` and the walker, exactly as `cat`, `ls` and `grep` use them.
No `CommandEnv` capability, no UI screen, no boot step.

Two things carry forward. The `env.ui.*` question is **settled above** — do not spend slice 3
re-deriving it. And `find`'s rule that it walks only what the session can traverse and read (epic
decision 14) means its RED order should start from the disagreement it exists to prevent: what
`find` reports and what `cat` will then open must not differ.

---

## Slice 3: the box answers questions

**Value**: Two tools for interrogating a machine you have just landed on. Every door the game has
shipped ends the same way — a player is standing in a filesystem they did not build, wanting to
know what is in it. Today they have `ls` one directory at a time and `grep` over content they must
already suspect. `find` is the question *"where is the thing called X"*, and `strings` is the
question *"this file is not text — what does it say anyway"*. Both answer `command not found`
today, on every machine, while `/bin/find` and `/bin/strings` sit right there in the listing.

That last part is the sharpest reason this slice is worth its own PR: the binaries have been
stamped since the generation work, so the game has been advertising two tools it does not have.
`ls /bin` promises them; running them denies them.

**Path**: `find` → registry (binary-gated, already stamped) → glob compiled from the positional
pattern → recursive walk over `env.fs.list` / `env.fs.stat` from the resolved start path → matching
absolute paths, directories suffixed `/`, alphabetical → stdout. `strings` → registry (same gate) →
`env.fs.read` → printable-run extraction at a fixed 4-character minimum → one terminal line per
line of each run.

**Class**: Behavior change.

**Delivery**: Independent PR against trunk, cut from `main` at v0.202.0. No stack: slice 4 (`chmod`)
touches the write path, which nothing here goes near.

**Required implementation skills**: `tdd`, `testing`, `refactoring`. Load `mutation-testing` at PR
readiness for the accumulated scope.

**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

### The three things this plan decides that the grill left open

**1. `strings /bin/ls` currently prints NOTHING, and the epic says it prints one line.** This is a
finding, not a preference. Decision 2 records the intended behaviour as *"`strings /bin/ls`
therefore prints one stub line on every machine until the content work lands, and that is the
correct amount of nothing."* Check it against the constant: `BINARY_STUB` is
`'\x7fELF\x02\x01\x01\x03\x3e\x01'`, and with legacy's 4-character minimum its longest printable
run is `ELF` — three characters. Every binary on every machine yields **zero lines**. The stub
`workstationFs.test.ts` already describes as *"`cat`/`strings` show ELF-ish bytes"* shows `strings`
nothing at all.

That matters more than it sounds. `strings /bin/<anything>` is the first thing a player will try,
because it is the only file on a fresh box that is not text — and silence is indistinguishable from
a broken command. The tool would ship dark in the literal sense.

**Recommendation: extend `BINARY_STUB` with the readable tail a real ELF binary carries** — the
interpreter path and a glibc version, e.g. `/lib64/ld-linux-x86-64.so.2` and `GLIBC_2.2.5`. Three
lines in `binaries.ts`, and it is explicitly *not* what decision 2 forbids: decision 2 forbids
**loot** — content carrying a usable credential, which belongs to the postponed harvest route. A
constant that is byte-identical on every machine and every `.so` carries no secret and rewards no
search. The file's own comment already calls these bytes cosmetic. Blast radius is small and
checked: nothing asserts the literal bytes (`grep.test.ts` keeps its own `ELF_STUB`), the
`\x7fELF` prefix that `grep` skips binaries by is unchanged, and the NUL-free rule that
`apt install`'s Postgres write depends on still holds.

The alternative — ship `strings` printing nothing on binaries and correct decision 2's sentence to
say so — is honest and cheaper, and it makes the slice's headline observable disappear.

**CONFIRMED 2026-09-02: extend the stub.** Verified before deciding, by running legacy's extraction
over the real constant: `runs (min 4)` is `[]` today; with the tail it is
`["/lib64/ld-linux-x86-64.so.2", "GLIBC_2.2.5"]`, still NUL-free and still `\x7fELF`-prefixed. The
epic's decision 2 has been amended with the finding, since it is the record the sentence was wrong
in.

**2. `find` decides from `list`, never from `stat` — because `stat` has no permissions.**
`createFsView`'s `stat` is `resolve(path).node`, returned unconditionally: no walker, no tier check.
That is right for what it is for, and it is a loaded gun for a command that walks a whole tree. A
`find` that enumerated with `stat` would report the contents of directories the session cannot
enter — turning a convenience tool into a permission oracle that tells a guest exactly what root is
hiding and where.

So the rule is: **a level is enumerated only if `env.fs.list` succeeds there**, and `stat` is used
only for the `kind` and `owner` of children a successful `list` has already revealed — facts
`ls -l` in that same directory would print anyway. This is `grep`'s `walkAndSearch` shape exactly,
and reusing it is most of why this slice is cheap.

**A correction to slice 2's close-out while it is fresh.** It said the invariant is *"what `find`
reports and what `cat` will then open must not differ"*. That overstates it: an unreadable file
inside a readable directory is visible to `ls` and refused by `cat`, and `find` naming it is
correct Unix behaviour, not a leak. The invariant that actually holds — and the one the first test
must pin — is narrower: **`find` reports nothing from behind a door the session cannot open.**

**3. `strings` loses legacy's `minLength` positional, and with it an error.** The folded-in decision
is *"legacy's fixed 4-character minimum and no `-n`"*. Legacy took an optional second positional and
validated it (`strings: minimum length must be between 1 and 100`). Dropping the argument drops the
error with it — worth writing down so it is not read later as an omission. `strings <file>` takes
exactly one operand.

### Acceptance criteria — CONFIRMED 2026-09-02, before any code

- [ ] **AC-1** `find <path> <pattern>` walks `<path>` recursively and prints every entry whose
      **name** matches, as an absolute path, one per line, **alphabetically**. Directories print
      with a trailing `/`; files do not.
- [ ] **AC-2** The pattern is a glob, not a regex: `*` is any run, `?` is one character, and every
      other regex metacharacter is **literal** — `find / *.txt` must not match `axtxt`.
- [ ] **AC-3** An optional third positional filters results by the file's `owner` string. It is a
      **display filter, never an authorization input** (decision 14): it changes what is listed and
      can never widen it.
- [ ] **AC-4** **A directory the session cannot enter contributes nothing** — no descendant names,
      no error, no exit-code change. What `find` shows at each level is exactly what `ls` there
      would show; a `user`-tier session finds nothing inside a root-only directory, while the
      directory's own name stays visible from its readable parent.
- [ ] **AC-5** Errors, each exit **1**: fewer than two operands →
      `find: usage: find <path> <pattern> [user]`; a start path that does not exist →
      `find: '<path>': No such file or directory`; a start path that is a file →
      `find: '<path>': Not a directory`.
- [ ] **AC-6** Relative starts resolve against the session's cwd (`find . passwd` from `/home/alice`
      searches `/home/alice`), and results are absolute regardless.
- [ ] **AC-7** No matches is not an error: no output, exit **0**.
- [ ] **AC-8** `strings <file>` prints every run of **four or more** printable characters, one
      terminal line per line, with `\n` and `\t` counted as printable so a text file reads back
      as itself.
- [ ] **AC-9** `strings /bin/ls` prints the binary stub's readable strings on any machine — the
      tool is demonstrable on a fresh box with no content work.
- [ ] **AC-10** `strings` errors, each exit **1**: no operand → `strings: missing file operand`;
      then `strings: <file>: No such file or directory`, `: Is a directory`, `: Permission denied`.
- [ ] **AC-11** Both are gated by their binaries like every other real tool: `rm /bin/find` makes
      `find` report `command not found`, and the same for `strings`. Neither joins `GAME_COMMANDS`.
- [ ] **AC-12** Both compose: `find / '*.conf' | grep etc` filters `find`'s lines, and both run
      inside a `node` script and from a no-tty backdoor session — unlike slice 2's pair, these are
      ordinary tools with **no `withoutTty` and no `withoutScript`**.
- [ ] **AC-13** `man find` and `man strings` render with a synopsis and examples that name the
      command; `help` lists both under **filesystem**.

### RED

In this order. Each must fail for the right reason before any production change; where one passes
on arrival, prove it with the mutant it exists to catch and record that in the close-out.

1. **A locked directory leaks nothing** (AC-4). First, because it is the claim the command is most
   able to get wrong invisibly. A tree with a root-only directory holding a file, a `user`-tier
   session, `find / '*'` — the file's path must be absent and `find` must still succeed. RED is
   `command not found`; the mutant it survives against later is swapping the `list` gate for `stat`.
2. **`find` finds a file by name** (AC-1), then **directories carry the trailing `/` and results
   sort** (AC-1).
3. **Globs and their literals** (AC-2) — `*.txt`, `passw?`, and the negative that `*.txt` does not
   match `axtxt`. The negative is the test; the positives are the demo.
4. **The owner filter** (AC-3), including that a non-matching owner hides a file the session could
   otherwise see, and that naming an owner never reveals one it could not.
5. **The three `find` errors and the empty result** (AC-5, AC-7) — usage, missing, not-a-directory,
   and no-match-is-exit-0.
6. **Relative and `.` starts** (AC-6).
7. **`strings` extracts runs of four or more** (AC-8): a synthetic buffer with a 3-character run
   (dropped), a 4-character run (kept), and non-printable separators. RED is `command not found`.
8. **`strings` on a real generated binary** (AC-9) — through `createBinaryEntries`/`BINARY_STUB`,
   not a hand-typed literal, so the test tracks the constant rather than a copy of it. This is the
   test that fails today for decision 1's reason, and the one that proves the fix.
9. **`strings`' four errors** (AC-10).
10. **Binary gating for both** (AC-11) — `/bin/find` removed → `command not found`.
11. **Composition** (AC-12) — `find` into a pipe, and both from a script context.
12. **`man` and `help`** (AC-13).

### GREEN — the minimum, in dependency order

1. `core/commands/find.ts` — glob→`RegExp` (escape, then expand `*`/`?`, anchored), the recursive
   walk over `env.fs.list` + `env.fs.stat`, the owner filter, the three errors. Register it. **No
   `availability.ts` change**: the binary is stamped and the command is not a game command, so the
   existing wrapper gates it with no new entry anywhere.
2. `core/commands/strings.ts` — printable-run extraction, `env.fs.read`, the error mapping.
   Register it. Same non-change to `availability.ts`.
3. `core/generation/binaries.ts` — extend `BINARY_STUB` (decision 1). Last, so the `strings` tests
   that need it are already red for the right reason.

### Three things GREEN must get right

- **The glob must escape before it expands.** Escape the regex metacharacters, *then* turn `*` into
  `.*` and `?` into `.`, then anchor `^…$`. In the other order the escaping eats the wildcards. And
  the reason the positional shape works at all: **v2's shell does no glob expansion**, so `*.txt`
  reaches the command as typed. Nothing else in the game relies on that; `find` will.
- **`strings` must split its runs into lines.** With `\n` printable, a text file is one giant run,
  and a single `TerminalLine` holding embedded newlines renders as one wrapped blob under
  `whitespace-pre-wrap` and — worse — arrives at a piped `grep` as **one line**, so
  `strings f | grep x` would return the whole file or nothing. Project each run through
  `splitContentLines`, the same helper `cat` and `grep` use.
- **Match each command's own error dialect, including the inconsistency.** Legacy quotes `find`'s
  paths (`find: '/nope': ...`) and leaves `strings`' unquoted (`strings: /nope: ...`). v2 already
  carries exactly this split — `grep` quotes, `cat` does not — so it is house style, not a bug to
  tidy. Exit **1** for both, which is what real `find` and `strings` return and what `cat`, `rm`
  and `touch` already use here (`ls` and `grep` use 2 to mirror their own GNU originals).

### Deliberately not in slice 3

`chmod` and `gpg` (slices 4 and 5). Real `find`'s `-name`/`-type`/`-maxdepth` parsing — decision 14
locked the positional shape and named the pre-release realism pass that owns the question. A `-n`
minimum length for `strings`. Any per-machine content that would make either tool find something
interesting — decision 2, and it belongs to the loot route. `strings` reading a file it cannot read
by asking the server: it uses the same view every other read command uses, and a denial is a
denial.

### REFACTOR

**One candidate, and it is a real one: the recursive walk.** `find` will hold a walk that is
structurally `grep`'s `walkAndSearch` — `list`, sort, `stat` each child, recurse into directories,
flat-map results — differing only in what it collects. Two implementations of a
permission-respecting tree walk is exactly the duplication that lets one of them quietly grow a
`stat`-based shortcut later. Judge it **after both are green**, with the shared shape visible: if
the extraction is a `walkTree(env, dir, visit)` that both call, it is worth it; if it needs options
to reconcile grep's binary-skipping with find's name-matching, it is not. Do not pre-extract.

Second candidate, smaller: `find` and `strings` each map an `FsReadResult`/`FsListResult` error to
a message, which `cat`, `cd` and `grep` already do four different ways — and `cat.ts` carries a
note from PR #175 saying to extract `fsReadHelpers.ts` "when `tail`/`grep` arrive". `grep` arrived
and it was not extracted, because the dialects genuinely differ (quoting, exit codes, which errors
are even reachable). Two more commands is the moment to either do it or delete the note. **Deleting
the stale note is a valid outcome** and is probably the right one.

### PRE-PR MUTATION

Focused on `core/commands/find.ts`, `core/commands/strings.ts`, and the `BINARY_STUB` constant.
Read survivors from `reports/mutation/mutation.json`, never the console, and never with the dev
server running (conventions §4). Expect the manual pages to dominate the count as always, and
expect two survivor families worth real attention rather than classification:

- **The glob translation.** Dropping the `^`/`$` anchors, or the metacharacter escape, both leave
  most tests green — AC-2's negative case is the one that kills them, which is why it is a test and
  not an example.
- **The minimum-length boundary.** `>=` → `>` in the run collector survives anything that does not
  assert a run of exactly four characters.

### Browser close-out

`vercel dev` + local supabase, banner version checked before driving anything. The beat worth
targeting is a box that is **not** the player's own, because that is where these tools are for:
`ssh` into the AP gateway, then `find / '*.conf'` and `find /etc passwd` from a root session, and
the same commands from a `user`-tier session on the workstation to see the walk stop at doors it
cannot open. Then `strings /bin/ls` on both boxes, `cat /bin/ls` beside it for contrast, and
`find / '*.log' | grep var` to prove the pipe. Finish with `rm /bin/find` and run it again — the
promise-in-`ls /bin` closing the loop.

### PR-ready when

- All 13 ACs met, each by a test that has been seen to fail.
- `npm run typecheck`, `npm run lint`, and the full non-watch suite pass from `v2/`.
- Mutation gate closed: every survivor killed or classified in the close-out.
- Wire-check **`N/A`** — no `api/` path changes; both commands read through the existing `FsView`
  (epic "Forced rather than chosen").
- Browser close-out run and written up, including the remote-box beat.
- Version bumped in **both** `v2/package.json` and `v2/package-lock.json`.

---
*Delete this file at D10 close-out and fold the durable rules into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md), as D3–D9 each did.*
