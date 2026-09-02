# Plan: D10 — polish + the long tail

**Branch**: `feat/d10-the-terminal-is-yours` (slice 1) — **not cut yet**
**Status**: Active — **slice 1 PLANNED and its acceptance criteria CONFIRMED by the owner
2026-09-02. NO CODE WRITTEN YET; nothing is in flight and the tree is clean.** The next action is
RED step 1 (below). Trunk is at **v0.200.0**; slice 1 bumps to **v0.201.0**.
**Epic**: [`legacy-parity-epic.md`](legacy-parity-epic.md) → "D10 — resolved scope & decisions
(grill-me, 2026-09-02)", fifteen locked decisions.

## Picking this up cold

1. Read the epic's D10 section — the fifteen decisions, the four forced-rather-than-chosen entries,
   and the "Deliberately NOT built" list. **`bash` is refused, not deferred**; do not port it.
2. Read slice 1 below, top to bottom. Its acceptance criteria are **already confirmed** — do not
   re-present them for approval.
3. Cut `feat/d10-the-terminal-is-yours` off an up-to-date `main` (check `git status -sb` for
   ahead/behind, per conventions §8) — the grill record and this plan land on `main` as a docs
   commit first, and §8 forbids only CODE straight on `main`.
4. All commands run from `v2/`. Gates: `npm run typecheck`, `npm run lint`, the full non-watch test
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
| 1 | the terminal is yours | `clear` + Ctrl-L, four themes that survive a reload, `whoami` | **planned** |
| 2 | the card and the second window | `author` opens the card; `xterm` opens a FRESH tab | not planned |
| 3 | the box answers questions | `find / passwd` finds it; `strings /bin/ls` reads the stub | not planned |
| 4 | permissions change hands | `chmod o+r` opens a file to a tier that could not read it | not planned |
| 5 | a file nobody else can read | `gpg -c` then `-d` round-trips; a wrong passphrase fails clean | not planned |

Only slice 1 is planned in full. Plan each later slice when its predecessor lands — D7, D8 and D9
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

- [ ] **AC-1** `clear` empties the scrollback **and hides the banner**, exit **0**. The command
      history is untouched — ↑ still recalls the line typed before the clear.
- [ ] **AC-2** **Ctrl-L clears the same way without submitting a line**, and whatever the player
      had half-typed is still in the input afterwards.
- [ ] **AC-3** A reload paints the banner again (the decision above): the cleared state is
      per-session, never persisted.
- [ ] **AC-4** `theme` with no argument lists the four palettes — amber, green, cyan, light — with
      `*` against the active one, exit **0**.
- [ ] **AC-5** `theme green` repaints the terminal (the eight `--theme-*` custom properties on
      `document.documentElement` take the green palette's values) and says which theme it switched
      to, exit **0**.
- [ ] **AC-6** `theme nope` reports an error naming the four available themes, exits non-zero, and
      **leaves the current theme unchanged**.
- [ ] **AC-7** The choice survives a reload: with green stored, the green palette is applied
      **before the first render**, so there is no frame of amber.
- [ ] **AC-8** An absent, empty or unrecognised stored value falls back to amber rather than
      throwing or painting nothing — a hand-edited `localStorage` cannot brick the boot.
- [ ] **AC-9** `new-game` returns the player to amber, because it clears the whole origin.
- [ ] **AC-10** `whoami` prints the ACTIVE session's username and nothing else: the base user at
      the prompt, `root` after `su root`, and the remote account after an `ssh` hop.
- [ ] **AC-11** `/bin/clear` and `/bin/whoami` exist on a generated workstation, remote host and
      router; after `rm /bin/whoami`, `whoami` answers `bash: whoami: command not found`, and
      restoring it makes the command work again.
- [ ] **AC-12** From a backdoor session (`nc`, no tty) **and** from inside a `node` script, `clear`
      and `theme` both refuse in their own words at exit **1** — an act on a terminal needs one
      that exists and one the player is looking at (epic decision 12).
- [ ] **AC-13** `man clear`, `man theme` and `man whoami` render; `help` lists `clear` and `theme`
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
*Delete this file at D10 close-out and fold the durable rules into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md), as D3–D9 each did.*
