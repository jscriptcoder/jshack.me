# Plan: Neon themes

**Status**: Active. Decisions confirmed by the owner 2026-09-27; no slice started.
**Visual reference**: the interactive preview at https://claude.ai/artifact/FTXG8EPT39Ek2TF6JFEmmt
(private to the owner). Its palettes, glow, glitch, HUD and cursor are the target; its
commands and HUD values are mock data.

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

Decided in planning, open to review:

- **The look belongs to the theme.** A neon theme carries its extra effect colours,
  and their presence is what switches the look on. There is no separate
  `effects: boolean` that could disagree with them, and no player-facing on/off. A
  player who wants no effects picks a plain theme.
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

## Slices

Four independent PRs against `main`, in order: each starts after the previous one has
merged (no stack). Slices 2 to 4 build on the neon themes from slice 1, and slices 3
and 4 are only visible under the neon look that slice 2 introduces. Each slice bumps the
minor version in `package.json` and `package-lock.json`.

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
document is neon (the theme signal, not a DOM read) → `frame`/`frame2` colours join the
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

## Out of scope

- `public/og-image.*` and the meta and OG descriptions in `index.html` still show and
  describe the amber terminal. Refreshing the social preview is a separate job once the
  look lands.
- Any in-game setting to turn effects off separately from the theme. Plain themes are
  that setting.

## Pre-PR Quality Gate

Per slice: mutation gate as listed, `npm run typecheck`, `npm run lint`,
`npm run test:run` (watchers stopped), the browser evidence for slices 2 to 4, version
bumped, and owner approval before every commit.

---
*Delete this file when the last slice merges, after moving any durable learning into
`docs/conventions-and-gotchas.md`.*
