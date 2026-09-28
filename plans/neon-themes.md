# Plan: Neon themes

**Status**: Active. Decisions confirmed by the owner 2026-09-27.

- Slice 1 ✅ merged as #567 (`dd7e0ffd`, v0.279.0).
- Slice 2 ✅ merged as #568 (`122d5fa6`, v0.280.0). As built:
  - The mark is `data-look="neon"` on `<html>`, written by `applyTheme` from
    `ThemeDefinition.neonColors`.
  - The banner's `data-text` is the glitch hook, and scrollback lines carry a
    `data-kind` so prompt and error lines can glow harder.
  - The banner uses a `font-art` Tailwind font (the stock mono stack) while the
    neon look swaps `--font-mono`.
  - Deviation: switching to a plain theme removes the mark but leaves the neon
    colour tokens painted. Nothing reads them without the mark, so no test could
    tell.
  - Found in the browser: the flicker's 2px sideways shift flashed a horizontal
    scrollbar under the full-width banner, so the flicker is now brightness only.
  - The per-element glow colour (`color-mix` with `currentColor`, inherited) is
    verified in Chromium 149. Firefox was not available to check.
- Slice 3 ✅ merged as #569 (`64179ecd`, v0.281.0). As built:
  - `Hud.tsx` wraps everything `Terminal` renders. The wrapper is always there and
    only its frame and bars depend on the theme, so a `theme` switch never remounts
    the terminal.
  - The bars are a `<header>` and a `<footer>`, so a screen reader finds them as
    landmarks and the tests query them by role.
  - `state.ts` gained two readers, `linkOnline` and `connectedWireless`.
    `followLink` now uses the second instead of building the same view inline.
  - The frame colours are `frameA`/`frameB` (tokens `--theme-frame-a`/`-b`), named
    like `glitchA`/`glitchB` rather than the preview's `frame`/`frame2`.
  - Deviation from the preview: the values (`user@host`, the ESSID) keep their own
    case inside the upper-case bars, because they are things a player types back.
  - The barcode ornament from the preview stays. It is `aria-hidden` and claims no
    meaning.
  - Found in the browser: the HUD CSS has to sit in `@layer components`, or the
    bars' own `display: flex` beats Tailwind's `max-sm:hidden` and the narrow layout
    keeps every item.
  - Carried to slice 4: at 390px wide the prompt row already overflows the page on
    `main`, under any theme, because the input keeps its intrinsic minimum width.
    Slice 4 rebuilds that row.
- Slice 4 ✅ merged as #570 (`92e5b17f`, v0.282.0). As built:
  - The input and its drawn copy of the line share one `relative min-w-0 flex-1`
    wrapper under every theme. Under neon the input turns `opacity-0` and lies over
    the copy. The copy is `aria-hidden`, so a screen reader still reads only the
    input.
  - The caret is read back from `selectionStart` on keyup, click, a document
    `selectionchange` (a held arrow key sends no keyup), every new value (an effect
    on the input signal), and after a Tab completion repositions it.
  - The `(value, caret, masked) → segments` logic stayed inline as `drawnLine`. At
    six lines and one caller, it did not earn a module.
  - A masked answer draws the block alone at the start of the line. The native
    password input still takes the keys.
  - Hollow-when-unfocused is `input:not(:focus) + .prompt-mirror`. That, the blink
    and reduced motion are CSS, checked in Chromium, not jsdom.
  - The 390px overflow from slice 3 is gone: the input is `min-w-0` and its wrapper
    takes the row's remaining width. Checked under Neon and Amber.
  - Known limits, found in the browser:
    - The copy wraps a long line while the input scrolls, so a click on a wrapped
      second line places the caret by the input's single-line layout.
    - A selection made with Shift and the arrows is not drawn.
    - The output pane's horizontal scrollbar under the wide banner at phone width
      predates this slice.
  - IME and mobile keyboards were not checked; no such device was available.
- Slice 5 (the `effects` command) was added by the owner on 2026-09-27, after slice 1
  merged.
  **Visual reference**: the interactive preview at https://claude.ai/artifact/FTXG8EPT39Ek2TF6JFEmmt
  (private to the owner). Its palettes, glow, glitch, HUD and cursor are the target; its
  commands and HUD values are mock data.
- Slice 5 (v0.283.0) in review on `feat/neon-effects`. As built:
  - The effect names have one owner, `EFFECT_NAMES` in `core/theme/effects.ts`.
    `effects` lists them, `on`/`off` go through one `stateWord` helper, and the
    seams are `env.currentEffects` and `env.setEffect(name, on)`.
  - The mark is `data-effects` on `<html>`, a space-separated list of the effects
    that are on, written by `applyTheme(id, effects)` only under a neon theme.
    `data-look="neon"` stays for the palette, so `effects glow off` keeps the font
    and the backdrop. The CSS reads `glow` and `glitch`, and the banner's halo moved
    to the glow, so each survives the other going off. The HUD pip's and the block
    cursor's halos went with the glow too.
  - The HUD and the cursor ask `effectShown(name)` in `state.ts`: the theme is neon
    and the effect is on. That replaced the two copies of the neon check that slice 4
    left in `Hud.tsx` and `Terminal.tsx`.
  - Stored under `jshack:effects` as the names of the effects that are off, so an
    effect added later comes up on. Any word that is not an effect means all on.
    `adoptStoredTheme` adopts it at boot beside the theme; the name was kept
    because the handbook refers to it.
  - Tab completion now reaches past the first positional: `arguments[N].values`
    completes the Nth word, so `effects glow <TAB>` offers `off, on`. No other
    command declares values beyond `arguments[0]`, so nothing else changed.
  - The Terminal suite resets every effect after each test: the signal outlives
    a test, as the theme's does, and `startGame` does not reset it.
  - Checked in Chromium: the listing, the switches, a reload, the dim line under
    Amber, both completions, glow off (no text shadow, neon font kept), glitch and
    HUD off, cursor off (native caret), and reduced motion stopping the flicker,
    the split copies and the blink with the glitch on.

## Goal

The terminal gains three Cyberpunk-style neon themes that glow, frame the screen in an
angular HUD and glitch the banner, and a new player starts in one of them.

## Decisions (owner-confirmed 2026-09-27)

1. **Three neon palettes ship**, `neon`, `redline` and `synth`, with the colours in the
   preview. Ids stay at 8 characters or fewer so `theme`'s padded id column
   (`id.padEnd(8)`) still lines up. No names from the Cyberpunk 2077 game itself
   (Night City, Arasaka, Netrunner), because they are trademarked.
2. **Amber, green, cyan and light stay exactly as they are**: no glow, no frame, no
   glitch, same font. They are the calm fallback for a player who finds neon tiring.
3. **Neon is the default** for a player who has never chosen. A stored choice still wins.
4. **No scanlines.** The owner judged them disturbing over a long session.
5. **The glitch is banner-only.** The banner goes away on `clear`, so the glitch
   never runs during play. Nothing else in the terminal animates beyond the cursor
   blink.
6. **Glow, the HUD frame and the block cursor ship as previewed.**
7. **A player can switch each effect on or off** with an `effects` command, added as
   slice 5 once all four effects exist. Each effect is its own switch rather than one
   master switch, because a player who dislikes the glitch may still want the glow.

Decided in planning, open to review:

- **The look belongs to the theme.** A neon theme carries its extra effect colours,
  and their presence is what switches the look on. There is no separate
  `effects: boolean` on a theme that could disagree with them. The player's
  per-effect switches (decision 7) are a separate preference that only narrows what
  a neon theme shows, and a plain theme still shows none of it.
- **Fonts are self-hosted** through `@fontsource` packages: Share Tech Mono for the
  terminal text and Rajdhani for the HUD labels (both OFL licensed). Loading from
  Google Fonts' CDN would send every player's IP to Google on every boot, which the
  Munich Regional Court held to breach the GDPR in 2022. Vite emits the woff2 files as separate
  assets, so the JS bundle budget in `scripts/checkBudgets.ts` is unaffected.
- **The banner keeps the system monospace stack.** It is drawn entirely in
  box-drawing and block glyphs, and if the primary font lacks them each glyph falls
  back on its own and the art shears. `help.ts` is the only other source of
  box-drawing characters, and its section rules are lines made only of `─`, so a
  fallback there changes a rule's length but never breaks alignment.
- **The HUD wraps the terminal and its full-screen apps** (nano, lynx, author). The
  intro and boot screens get the neon colours, font and glow but no frame, because
  before boot there is no session or network to report.
- **The HUD shows live game state only**, nothing decorative that pretends to mean
  something. The preview's `TTY 01` and `LINK SECURE` are dropped.
  - Top bar: the `JSHACK.ME` tab, `NET TERMINAL`, link state `ONLINE` or `OFFLINE`
    (from `isOnline(connectivity())`), and a local `HH:MM:SS` clock. The world clock
    (`core/cve/worldClock.ts`) runs on real time, so local wall time matches it.
  - Bottom bar: the active `user@host` (the same readers as the prompt, so it
    changes on `ssh` and `su`), `WLAN0 <ipv4>` or `WLAN0 DOWN` (from
    `connectedWlan0`), `ESSID <name>` or `ESSID —`, and the version.
  - Below 640px wide the bar keeps only `user@host`, the link state and the clock.
- **Listing order**: `neon, redline, synth, amber, green, cyan, light`. The default
  is listed first, and `THEME_IDS` already treats order as a decision.

## Acceptance Criteria

- [ ] `theme` lists neon, redline and synth, and `theme <id>` switches to each one and
      remembers it across a reload.
- [ ] A player who has never chosen a theme boots in Neon. A stored choice of any
      theme, including amber, still wins.
- [ ] Before any script runs, the page paints Neon's colours, so a first-time
      player's first frame matches the theme they boot in.
- [ ] Under a neon theme the text glows, uses the neon font, and the banner glitches
      every few seconds. Under a plain theme none of that happens and the terminal
      looks as it does today.
- [ ] With `prefers-reduced-motion: reduce`, the banner does not flicker or glitch and
      the cursor does not blink.
- [ ] Under a neon theme the terminal and its full-screen apps sit inside the
      cut-corner HUD frame, whose bars show live link state, clock, `user@host`,
      wlan0 address, ESSID and version.
- [ ] Under a neon theme the caret is a solid block over the character it sits on. A
      masked prompt (su's `Password:`) never draws the typed characters.
- [ ] `effects` lists glow, glitch, hud and cursor with their state, and
      `effects <name> on|off` switches one. The choice survives a reload.

## Slices

Five independent PRs against `main`, in order: each starts after the previous one has
merged (no stack). Slices 2 to 4 build on the neon themes from slice 1, and slices 3
and 4 are only visible under the neon look that slice 2 introduces. Slice 5 switches
the effects that slices 2 to 4 add, so it comes last. Each slice bumps the minor
version in `package.json` and `package-lock.json`.

Common evidence route: jsdom tests prove the contracts (which themes exist, what is
painted onto the document, what the HUD shows, what the cursor draws). jsdom cannot
render glow, animation or fonts, so each slice from 2 onward also records a real-browser
check against `npm run dev` with `agent-browser`: a screenshot under Neon and one under
Amber, plus a reduced-motion pass where motion is involved.

### Slice 1: A player can switch to three neon palettes, and a new player starts in Neon

**Value**: every player can wear the new colours, and a first-time player meets them.
The glow and frame come later; this is the colour layer on its own.
**Path**: `theme` → `core/theme/themes.ts` (`THEMES`, `THEME_IDS`, `DEFAULT_THEME_ID`)
→ `ui/theme/applyTheme.ts` paints the tokens → `themePersistence` remembers the choice;
`src/index.css` `:root` is the pre-JS paint; `index.html` `theme-color` meta.
**Class**: Behavior change.
**Delivery**: independent PR, branch `feat/neon-palettes`.
**Required implementation skills**: `tdd`, `testing`, `refactoring`; `mutation-testing`
at PR readiness.
**Acceptance criteria**:

- `theme` lists the seven themes in the decided order with the active one marked, and
  the column still lines up.
- `theme redline` (and `neon`, `synth`) switches, says so, and survives a reload.
- A player with nothing stored boots in Neon; a stored `amber` still boots in Amber.
- The pre-JS palette in `index.css` equals Neon's painted tokens.
- `applyTheme` paints every token, with none left blank, for all three new ids.
  **RED**:
- `theme.test.ts`: the listing names neon, redline and synth in order.
- `state.test.ts`: the boot-default assertions at lines 113 and 137 move from
  `'amber'` to `'neon'`, so they fail first.
- A new drift guard reads `src/index.css`, parses the `--theme-*` values in its
  `:root` block, and compares them with what `applyTheme(DEFAULT_THEME_ID)` paints.
  Today the rule "change a colour in themes.ts, not there" lives only in a comment;
  this test makes a default change that forgets the fallback fail.
  **GREEN**: three `THEMES` entries with the preview's ten tokens each (`avatarBorder`
  = the text colour, as the existing themes do), the new `THEME_IDS` order,
  `DEFAULT_THEME_ID = 'neon'`, the `index.css` fallback block, and `theme-color` set to
  `#06070c`. Update the comments in `themes.ts` and `index.css` that name amber as the
  default.
  **PRE-PR MUTATION**: Stryker on `src/core/theme/themes.ts` and
  `src/core/commands/theme.ts` (json reporter, per conventions §4).
  **PR-ready when**: criteria met, `npm run typecheck`, `npm run lint` and
  `npm run test:run` green, owner approves the commit.

### Slice 2: Neon themes glow, use the neon font, and glitch the banner

**Value**: the neon themes look like the preview rather than plain recolours; plain
themes are untouched.
**Path**: `ThemeDefinition` gains the optional neon effect colours (`glitchA`,
`glitchB`, `tint1`, `tint2`), present on the three neon themes only → `applyTheme`
paints them and marks the document (e.g. `data-look="neon"` on `<html>`), clearing the
mark for a plain theme → `index.css` rules keyed on that mark: glow `text-shadow`, the
`--font-mono` override to Share Tech Mono, the background tint, and the banner's
flicker and split-colour glitch → `Terminal.tsx` gives the banner its duplicate-text
attribute for the glitch layers and pins it to the system-mono stack →
`@fontsource/share-tech-mono` imported from `main.tsx`.
**Class**: Behavior change.
**Delivery**: independent PR, branch `feat/neon-look`, after slice 1 merges.
**Required implementation skills**: `tdd`, `testing`, `front-end-testing`,
`refactoring`, `typescript-strict`; `mutation-testing` at PR readiness.
**Acceptance criteria**:

- Switching to any neon theme marks the document neon and paints its effect colours;
  switching back to a plain theme removes the mark, so none of the neon rules apply.
- In a browser, under Neon, text glows, the font is Share Tech Mono, and the banner is
  intact (no sheared box art) and glitches periodically. Under Amber it matches today.
- With reduced motion, the banner is still.
  **RED**: `applyTheme.test.ts`: applying `neon` marks the document neon; applying
  `amber` after `neon` leaves no mark and no effect colour behind. `Terminal.test.tsx`:
  the banner exposes its full text to the glitch layers.
  **GREEN**: the optional colour group on the type, the mark in `applyTheme`, the CSS
  rules, the font import, and the banner attribute.
  **Browser evidence**: screenshots under Neon and Amber; a reduced-motion screenshot of
  a still banner; `help` output checked for rule lines.
  **Carried risks to check here, not assume**:
- Glow set once on an ancestor has to take each line's own colour. `text-shadow`
  with an omitted colour inherits as `currentcolor` and resolves per element, but a
  `color-mix(… currentColor …)` value may resolve at the ancestor in some engines.
  Check error and prompt lines in Chrome and Firefox.
- The scrollback is unbounded, and blurred text-shadow on thousands of lines may make
  scrolling slow. Flood the scrollback (repeated `help`) and scroll in the browser.
- The glyph coverage of Share Tech Mono for `—`, `…`, the braille spinner and `─`.
  **PRE-PR MUTATION**: Stryker on `src/ui/theme/applyTheme.ts` and
  `src/core/theme/themes.ts`. The CSS is `N/A`, and the browser screenshots stand in
  as its evidence.

### Slice 3: Under a neon theme the terminal sits in a HUD frame that reports live state

**Value**: the player sees their session, link and network at a glance, framed the way
the preview shows.
**Path**: a new HUD component wrapping `Terminal`'s root (prompt screen and overlays)
→ reads `promptUsername`/`promptHost`, `connectivity()` through `isOnline` and
`connectedWlan0`, the app version, and a one-second clock → shown only while the
document is neon (the theme signal, not a DOM read) → `frameA`/`frameB` colours join the
neon colour group (they arrive with the screen that paints them) → Rajdhani via
`@fontsource/rajdhani`.
**Class**: Behavior change.
**Delivery**: independent PR, branch `feat/neon-hud`, after slice 2 merges.
**Required implementation skills**: `tdd`, `testing`, `front-end-testing`,
`refactoring`; `mutation-testing` at PR readiness.
**Acceptance criteria**:

- Under Neon the HUD shows `user@host` and follows an `ssh` hop and `su`.
- It shows `ONLINE`, the wlan0 address and ESSID when associated, and `OFFLINE`,
  `WLAN0 DOWN` and `ESSID —` when not.
- The clock advances each second.
- Under Amber there is no HUD.
- nano and lynx open inside the frame.
- In a browser, the cut-corner frame and bars match the preview, and the narrow-width
  layout drops the wide items.
  **RED**: `Terminal.test.tsx` (or the HUD's own test): each bullet above as a rendered
  assertion, with the clock under fake timers.
  **PRE-PR MUTATION**: Stryker on the HUD component and any formatting helpers it gains.

### Slice 4: Under a neon theme the caret is a blinking block

**Value**: the terminal's cursor matches the look. Plain themes keep the native caret.
**Path**: `Terminal.tsx` prompt row: the real `<input>` stays and keeps focus,
keyboard handling and its `aria-label`; under neon it is made invisible and a drawn
mirror shows the text before the caret, a block over the character at the caret (or a
space), and the text after it, updated on input, key, click and selection changes.
**Class**: Behavior change.
**Delivery**: independent PR, branch `feat/neon-cursor`, after slice 3 merges.
**Required implementation skills**: `tdd`, `testing`, `front-end-testing`,
`refactoring`; `mutation-testing` at PR readiness.
**Acceptance criteria**:

- Under Neon the block sits on the character at the caret, and moves with arrow keys,
  Home/End, clicks, history recall and tab completion.
- A masked prompt draws nothing of what is typed.
- With the input unfocused, the block turns hollow.
- With reduced motion, it does not blink.
- Under Amber the native caret is used and no mirror is drawn.
- Every existing `Terminal.test.tsx` behaviour stays green.
  **RED**: rendered assertions for the block's position after typing and after moving the
  caret, and for a masked prompt drawing nothing.
  **Carried risk**: jsdom may not fire `selectionchange` for inputs, so drive the mirror
  from explicit events the tests can dispatch. Check the real browser for IME and mobile
  keyboards.
  **PRE-PR MUTATION**: Stryker on the mirror logic, which is worth extracting as a
  pure `(value, caret, masked) → segments` function if it earns its place.

### Slice 5: A player can switch each neon effect on or off with `effects`

**Value**: a player who likes a neon palette but not one of its effects keeps the
palette and loses only that effect. Before this, the only way out was a plain theme.
**Path**:

- `effects`, a new game command shaped like `theme`: always available,
  `category: 'general'`, `tier: 'guest'`, the same `withoutTty` and `withoutScript`
  refusals, and a manual entry. Its arguments complete to the effect names, then to
  `on` and `off`.
- New command-env seams, read and write, beside `currentTheme` and `setTheme` in
  `ui/env.ts`.
- `ui/state.ts` holds an effects signal and persists it under its own key, next to
  `jshack:theme`.
- The single neon mark from slice 2 splits into one mark per effect that is on. The
  HUD (slice 3) and the cursor (slice 4) read their switch from the signal.

**Class**: Behavior change.
**Delivery**: independent PR, branch `feat/neon-effects`, after slice 4 merges.
**Required implementation skills**: `tdd`, `testing`, `front-end-testing`,
`refactoring`, `typescript-strict`; `mutation-testing` at PR readiness.
**Acceptance criteria**:

- `effects` with no argument lists `glow`, `glitch`, `hud` and `cursor`, each
  `on` or `off`, column-aligned like `theme`.
  - Under a plain theme the listing ends with a dim line saying the effects show
    only under the neon themes. The settings are still kept, and still apply when
    the player next switches to a neon theme.
- `effects glitch off`:
  - stops the banner glitch;
  - leaves glow, HUD and cursor as they were;
  - says what it did;
  - survives a reload.
- `effects glitch on` brings the glitch back.
- `effects hud off` removes the frame and its bars. The terminal fills the screen as
  it does under a plain theme.
- `effects cursor off` goes back to the native caret.
- `effects glow off` removes the glow. The neon font and colours stay, because they
  belong to the palette.
- Refusals exit 1 and change nothing:
  - an unknown effect names the ones there are;
  - a missing or unrecognised state prints the usage line.
- Nothing stored, or an unreadable stored value, means every effect on (the same
  fallback rule as the theme). `new-game` wipes the origin, so a fresh game starts
  with every effect on.
- Reduced motion still stops the glitch and the blink whatever `effects` says.
  `effects` can only take effects away, never force motion back on.

**RED**:

- `effects.test.ts`: the listing, each switch, and the refusals, through
  `mockCommandEnv`.
- `ui` persistence tests over an injected storage.
- A rendered test per effect: glitch mark gone, HUD gone, native caret back.

**Browser evidence**: a screenshot under Neon with the glitch and HUD off, and glow and
cursor still on.
**PRE-PR MUTATION**: Stryker on the command, its persistence module and the parts of
`applyTheme` that write the marks.

## Out of scope

- `public/og-image.*` and the meta and OG descriptions in `index.html` still show and
  describe the amber terminal. Refreshing the social preview is a separate job once the
  look lands.

## Pre-PR Quality Gate

Per slice: mutation gate as listed, `npm run typecheck`, `npm run lint`,
`npm run test:run` (watchers stopped), the browser evidence for slices 2 to 4, version
bumped, and owner approval before every commit.

---

_Delete this file when the last slice merges, after moving any durable learning into
`docs/conventions-and-gotchas.md`._
