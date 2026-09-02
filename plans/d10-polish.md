# Plan: D10 — polish + the long tail

**Status**: Active — **slice 1 is SHIPPED**: `dd1cc5cf` (PR #481) at **v0.201.0**, all thirteen
acceptance criteria met, every gate passed, and its close-out written up at the bottom of the
slice. Trunk is at v0.201.0 and level with origin. **The next action is to plan slice 2**
(`author` + `xterm`), which starts from the `CommandEnv` → UI capability seam slice 1 laid.
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) → "D10 — resolved scope & decisions
(grill-me, 2026-09-02)", fifteen locked decisions.

## Picking this up cold

1. Read the epic's D10 section — the fifteen decisions, the four forced-rather-than-chosen entries,
   and the "Deliberately NOT built" list. **`bash` is refused, not deferred**; do not port it.
2. **Slice 1 is shipped and merged.** Read its close-out at the bottom of this file before planning
   slice 2 — it records the seam slice 2 builds on, the three tests that passed on arrival and how
   they were proven, what the mutation gate found, and one gap left open on purpose.
3. **The next action is to plan slice 2** (`author` + `xterm`) with `/plan`. Its decisions are
   already locked in the epic; what it needs is acceptance criteria, a RED order and a GREEN
   sequence. Do not re-grill the door.
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
| 2 | the card and the second window | `author` opens the card; `xterm` opens a FRESH tab | not planned |
| 3 | the box answers questions | `find / passwd` finds it; `strings /bin/ls` reads the stub | not planned |
| 4 | permissions change hands | `chmod o+r` opens a file to a tier that could not read it | not planned |
| 5 | a file nobody else can read | `gpg -c` then `-d` round-trips; a wrong passphrase fails clean | not planned |

Only slice 1 has been planned and built. Plan each later slice when its predecessor lands — D7, D8 and D9
all found later slices cost far less than their plans assumed, because the seams they needed had
already generalized.

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
at boot, and that is enough); legacy's five unpainted palette tokens (epic decision 8) — the two
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

Legacy's five unpainted palette tokens stay out (epic decision 8) — **but the author card needs
two of them**, so they arrive WITH the card in slice 2, and `applyTheme.test.ts`'s hardcoded token
list is the file that must grow alongside `ThemeColors`.


---
*Delete this file at D10 close-out and fold the durable rules into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md), as D3–D9 each did.*
