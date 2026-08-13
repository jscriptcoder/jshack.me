# Plan: D1b — a player browses a page instead of reading its source

**Status**: **Slices 1-2 built; slice 4 absorbed into 2.** Slice 3 is the next thing to build.
**Branch**: one per slice, cut off `main`. Slice 3: `refactor/target-resolution-once`.
**Epic**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) row **D1b**, Phase 1
**Base version**: v0.126.0

> **Picking this up cold?** Read "The decision this plan starts from" — it explains why slice 1
> deletes content rather than adding it, and why that choice makes slice 5 harder. Then read the
> slice you are on. The legacy implementation (`src/commands/lynx.ts`, `src/commands/lynx/`,
> `src/components/Terminal/LynxBrowser.tsx`) is reference material, not a thing to copy: it is
> 1216 lines including tests, and most of it renders markup this game's pages never produce.

## Goal

`lynx <url>` opens a full-screen text browser over the terminal: the page renders as readable
text, its links are numbered and followable, and the target's `/var/log/access.log` gains one
line per page viewed — exactly as a `curl` would.

## The decision this plan starts from

**Settled by slice 1 — recorded here because slices 5 and 7 still live with the consequences.**

Every page in `pools/webPages.ts` used to link `/admin/`, `/status`, `/server-status`,
`/.well-known/security.txt`, `/api/health` or `/metrics`, and every one of those 404d. Two
committed decisions disagreed about that fact: the epic called it a **shipped D1 defect** ("a
player doing the recon the page invites is told the server lies"), while `defaultDirlist.ts`'s
docstring called the same thing **deliberate**, keeping those words in the sweep wordlist so "a
default sweep starts finding them the moment the content epic grows those pages."

`curl` shows you source, so a dead link is a shrug. **A browser makes it the headline
interaction** — links render numbered, following one is the whole point, and every one would
fail. So it gets resolved before the browser exists, not after.

**Owner decision 2026-08-13: prune the promises.** The pooled pages lose their `<a href>` markup
and keep everything else — hostname, version strings, the careless comments. Serving the promised
pages instead was rejected for the same reason D1c refused to: it would set the pool shape,
per-box volume and variation model that the generated-content epic owns
([`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §9).

**Two consequences, accepted with it — do not rediscover these as bugs:**

1. **Generated hosts render linkless**, so slice 5 cannot demonstrate link-following against an
   NPC box. It is proven against a page the player makes with `nano`, exactly as D1c proved
   discovery. That is the accepted cost of not pre-empting the content epic.
2. **`lynx` on a generated page is thin** — no links to follow, and comments deliberately not
   rendered, so it shows less than `curl` does. That is correct, not a regression: source and
   rendered text are different views, and the difference is why both commands exist. The world
   gets thick when the content epic lands, and `lynx` needs no change when it does.

## Acceptance criteria

- [x] No generated page links a path its host does not serve — a property that holds over the
      whole pool, not a fix applied four times. *(slice 1, v0.125.0)*
- [x] `lynx http://<host>` replaces the terminal with a full-screen rendering of the page as
      text; `q` or Escape returns to the terminal with the scrollback intact. *(slice 2)*
- [x] The rendered page shows headings, paragraphs and lists as text, wrapped to the viewport,
      and **omits HTML comments** — the source-only recon that keeps `curl` worth running.
      *(slice 2 — wrapping is CSS, see the note there)*
- [ ] Links render numbered and selectable; Enter or Right Arrow follows the selected one and
      renders the page it names.
- [ ] Left Arrow or Backspace returns to the previous page.
- [ ] The target's `/var/log/access.log` gains one line per page **viewed**, sized and statused
      like any other fetch, naming the browsing player by the address the server derives.
- [ ] A player browses another player's page across networks by public IP.
- [ ] `targetFs` and its neighbours are named once rather than three times.

## Slices

Slice 1 stands alone and could ship on its own merit. Slices 2-7 build the browser.

---

### Slice 1: Generated pages stop promising paths that do not exist — ✔ SHIPPED v0.125.0 (#381)

> **Done 2026-08-13.** Six paths removed across four pages, not five — the epic had undercounted,
> missing `/.well-known/security.txt`. Mutation on `webPages.ts` found a real survivor (the nginx
> page could be replaced with `""` and the suite stayed green); the criterion-3 test killed it,
> 83.33% → 100% (6/6). The property test cannot itself be mutated by Stryker, so its non-vacuity
> was proven by hand — breaking the `href` regex made it fail — and a guard test pins the pool at
> four templates so an emptied pool cannot pass it vacuously.

**Value**: A player reading a generated host's page is no longer invited to probe five paths that
cannot answer. Actor: anyone running `curl` or, later, `lynx` against an NPC host.
**Path**: `pickWebPage` → the page content a generated host serves → what `curl` prints.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`. `refactoring` — assess
after green; expected `N/A`, this is a content change.
**Reduction program**: `N/A`.
**Acceptance criteria**:
- Every `href` in every pooled page resolves to a path the generated host actually serves. Stated
  as a property over the pool so a fifth page cannot reintroduce the defect.
- The recon value that does not promise anything is untouched: hostname interpolation, version
  strings (`nginx/1.24.0`, `Node.js v18.17.0`, `Build 4.2.1`) and the comments all survive.
- `defaultDirlist.ts`'s docstring no longer justifies its wordlist entries by "the pages its own
  markup promises" — that justification dies here. **The entries themselves stay**: they are
  ordinary dirlist words that a real sweep would try, and D1c has a test pinning their presence.
- The epic's D1 defect note is retired, and the content epic's §9 entry says what changed.

**RED**: A test over `WEB_PAGES` that extracts every `href` and asserts each one resolves against
a generated host's tree via `resolveWebPath`. Fails today on all four pages — five distinct paths.
**GREEN**: Remove the `<a href>` elements from the four pooled pages, and the now-empty `<p>`/
`<ul>` wrappers with them.
**MUTATE**: Run on `webPages.ts`. Expect low value — it is data — so the real evidence is the
property test failing before and passing after. Record the result either way rather than assuming.
**KILL MUTANTS**: The href-extraction regex in the test is the part worth mutating; if it survives
being broken, the property is vacuous and the test is worthless.
**REFACTOR**: Assess; expected `N/A`.
**Done when**: the property holds, no page lost its non-promising recon, and the two docs that
described the old state agree with the new one. Human approves the commit.

---

### Slice 2: A player reads a page as text and quits back to the terminal — ✔ BUILT v0.126.0

> **Done 2026-08-13, and it absorbed slice 4.** Four decisions taken with the owner before RED,
> all of which shaped what got built:
>
> 1. **The command fetches; the screen only renders.** A refused connection has to read in the
>    TERMINAL as `curl`'s does, which is impossible once the overlay owns the screen. So
>    `ModeChange`'s lynx variant grew a `content` field and `lynx.ts` reuses `curl`'s resolution
>    step for step. Slice 5's followed links are the opposite case — the browser is already open
>    by then, so *their* failures render as a page.
> 2. **`editorMode` became `overlayMode`**, one signal holding a discriminated union, so two
>    overlays open at once is unrepresentable. The `Extract<ModeChange, …>` on it means widening
>    to an app with no screen fails to COMPILE.
> 3. **The renderer uses `DOMParser`, in the UI layer.** Entity decoding, comment/script/style
>    dropping and malformed-markup tolerance come from the platform, which is most of what the
>    legacy renderer's 401 hand-rolled lines did. It sits in `ui/` because `core/` is
>    framework-free on purpose.
> 4. **No width parameter — CSS wraps.** `renderPage(html) → lines`, and each line carries the
>    same `whitespace-pre-wrap break-words` the terminal's own output uses. This deleted the
>    wrapping arithmetic, its boundary tests, and **most of slice 4** with it; the rest of slice 4
>    (blank-line spacing, nested indentation, entity decoding) landed here.
>
> Mutation drove three simplifications rather than three contrived tests: the container-level
> `SILENT_TAGS` skip was redundant with `inlineText`, `flush`'s empty guard was unobservable
> because `normalize` collapses what it emits, and `normalize`'s leading-trim was dead because
> the collapse rule already drops a leading blank. `inlineText` now neutralizes source newlines
> only (`/\n/`), leaving the space-collapsing to `toLines` — which turned a redundant pair of
> regexes into one load-bearing one and exposed a real bug the tests had missed: a newline with
> no indentation around it fused two words.

**Value**: The walking skeleton — a real browser screen over a real fetch. Actor: a player who
wants to read a page rather than its markup.
**Path**: `lynx <url>` → `parseHttpUrl` → own-LAN target resolution → `resolveWebPath` → render to
text → full-screen overlay replaces the terminal → `q` restores it.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Acceptance criteria**:
- `lynx http://localhost` replaces the terminal with the page rendered as text.
- Headings, paragraphs and list items render as readable lines, wrapped to the viewport.
- **HTML comments do not render.** `curl` still shows them; that difference is the point.
- `q` or Escape returns to the terminal with scrollback and prompt focus intact.
- A host not serving http refuses exactly as `curl` does — same message, because it is the same
  check.
- The fetch lands in the target's `access.log` as one line, indistinguishable from a `curl` of the
  same path.

**RED**: Start with the renderer as a pure function — `render(html, width)` → lines — because it
carries the most behavior per test and needs no DOM. Then the screen: mount `lynx`, assert the
terminal is gone and the rendered text present; press `q`, assert the terminal is back.
**GREEN**: A renderer covering only what this world's pages contain — `h1`-`h6`, `p`, `ul`/`ol`/
`li`, `br`, text, and dropping comments/`script`/`style`. **Not** tables or preformatted blocks:
no page in the pool has either, and the legacy renderer's table code is the bulk of its 401 lines.
The screen follows `Nano`'s shape exactly — a signal in `Terminal.tsx` swaps the whole view, which
the existing comment there already anticipates ("a full-screen overlay (nano, future apps)").
**MUTATE**: Run on the renderer — it is dense branching logic and the place mutants will survive.
The screen is jsdom + `@solidjs/testing-library`, per the project's UI testing rule.
**KILL MUTANTS**: Expect survivors in wrapping arithmetic. Width boundaries deserve explicit tests.
**REFACTOR**: Assess. The renderer will want small private functions behind one entry point.
**Done when**: a page reads as text, `q` gets you out, and the target logged the visit.

---

### Slice 3: The target-resolution shape is named once, not three times

**Value**: `lynx` is the third consumer of ~15 lines that `curl` and `gobuster` each carry a copy
of. The divergence risk is real: this block decides which tree a request reads, so two copies
drifting is a security-shaped bug, not a tidiness one.
**Path**: preserved surface — `curl`, `gobuster` and `lynx` keep their exact observable behavior.
**Class**: Pure refactor.
**Required implementation skills**: `testing`, `mutation-testing`, `refactoring`. `tdd` is `N/A` —
no behavior changes, so there is no honest RED; the baseline is the existing suite.
**Reduction program**: `N/A` — this names a shape, it does not retire a mechanism. No net-reduction
claim.
**Acceptance criteria**:
- `targetFs`, `LOOPBACK_NAMES`, the port check and `connectError` exist once and all three commands
  call it.
- Every existing `curl`, `gobuster` and `lynx` test passes untouched. A test that needed editing
  means behavior moved, and the slice is wrong.
- Mutation scores on the three commands do not drop.

**Preservation baseline**: the full suite plus the current mutation scores for `curl.ts`,
`gobuster.ts` and slice 2's `lynx.ts`, captured **before** any code moves.
**Preservation change**: extract to one module; no signature the commands expose changes.
**MUTATE**: Re-run the same three scopes and compare against the captured baseline.
**REFACTOR**: This is the refactor.
**Done when**: three callers, one definition, identical behavior, and the recorded owner decision
of 2026-08-12 — "a shape named at three callers beats one named at two" — is discharged.

> Why this is its own PR rather than slice 2's refactor step: a three-way extraction is easier to
> review against a green baseline than tangled with a new screen. It must not wait longer than
> this — the standing instruction is not to let a fourth consumer arrive first.

---

### Slice 4: The page reads like a page — ✔ ABSORBED INTO SLICE 2

**Value**: Rendering quality — the difference between text that is legible and text that is a
wall. Actor: any reader.
**Path**: renderer only; no new fetch path.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**: blank-line handling between blocks, nested list indentation, long-word
and long-URL wrapping that does not overflow the viewport, and entity decoding (`&amp;`, `&lt;`).
**RED**: rendered-output tests per case, against the pure renderer.
**MUTATE**: same scope as slice 2.
**Done when**: a real pooled page and a player-written page both read cleanly at narrow and wide
viewports.

> **Folded, as this note allowed.** Blank-line spacing, nested indentation and entity decoding
> shipped in slice 2. The wrapping half of it stopped existing when the renderer lost its width
> parameter: long words and long URLs break at the viewport in CSS, so there is no arithmetic
> left to test at narrow and wide widths.

---

### Slice 5: A player follows a link

**Value**: The thing that makes it a browser rather than a viewer.
**Path**: rendered link registry → selection state → Enter → resolve href against the current URL
→ the same fetch path as slice 2 → render the new page → a second `access.log` line.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:
- Links render numbered and one is selected; Up/Down moves the selection.
- Enter or Right Arrow follows the selected link and renders the page it names.
- Relative hrefs resolve against the current page's URL; absolute ones are honoured.
- A link to a path that does not exist renders the 404 as a page, not as a crash.
- **Each page viewed is its own `access.log` line** — following three links leaves four lines,
  because volume is the behavior, exactly as D2.3 and D1c settled it.

**RED**: Proven against a page the player wrote with `nano`, since slice 1 left generated pages
linkless. Set that fixture up in the test rather than reaching for a pooled page — and when the
live E2E runs, build it the same way.
**MUTATE**: on link resolution and selection bounds — first/last wraparound is where mutants live.
**Done when**: a two-page site the player made is navigable, and the log shows both visits.

---

### Slice 6: A player goes back

**Value**: Navigation that does not trap you.
**Path**: history stack → Left Arrow/Backspace → re-render the previous page.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`.
**Acceptance criteria**: Left Arrow or Backspace returns to the previous page; back at the first
page it does nothing (it does not quit); the selected link is restored, not reset.

> **Open decision, resolve before RED: does going back re-fetch?** It changes what the defender
> sees — a re-fetch writes another `access.log` line, a cached render does not. Re-fetching is
> more honest about the fiction (a text browser without a cache) and keeps one rule: a line per
> view. Caching is quieter and matches how the legacy overlay behaved. **Recommendation:
> re-fetch**, because "one line per page viewed" is already an acceptance criterion above and two
> rules for one log are worse than a slightly chattier one.

---

### Slice 7: A player browses another player's page

**Value**: Closes the loop D1 opened — the browser reaches across networks, not just the LAN.
**Path**: `lynx http://<public IP>` → `fetchAcrossNetwork` (`curl.ts:130`) → server-side
resolution → render.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`.
**Acceptance criteria**:
- A player browses another player's page by public IP with no session and no credential, as
  `curl` already may.
- The target's log names the browser by the address **the server derives**, never one the client
  sends.
- An unforwarded and an unknown public IP are indistinguishable — the same collapsed
  `host_unreachable` the D1 cross-player half already proves.
- Following a link on a cross-player page fetches across the network too, rather than falling
  back to the local tree.

**Wire-check**: only if `api/` changes. If `fetchAcrossNetwork` is reused unchanged, none is
needed and the reason is recorded as the alternate evidence.

---

## Close-out: prove it the way a player would

Not a slice. Load the `v2-e2e` skill and drive it live: make a two-page site with `nano`, browse
it, follow a link, go back, quit — then read the box's own `access.log` and count the views.
Record it in `e2e-shared-network-verification.md` as Act 9.

The skill's §7 quirks land squarely on this feature: this is a keyboard-driven full-screen overlay
and the traps are chord delivery, focus, and polling for a screen's absence. Read §7 before
driving, not after.

## Deferred — named, not planned

- **Forms, POST, images, CSS, multi-tab** — the epic's D1b row defers all four.
- **Tables and preformatted blocks in the renderer** — no page in the pool has either. Add them
  when content does, not before.
- **Generated content with real internal links** — the content epic. When it lands, slice 5's
  behavior starts working on NPC hosts with no change to `lynx`.
- **`AvailabilityRule` is still inert** — `lynx` will declare one like every other command and
  nothing will read it. The backlog entry stands.

## Pre-PR quality gate (per slice)

1. Mutation testing where meaningful; otherwise explicit `N/A` plus proportionate evidence
2. Refactoring/reduction assessment; `N/A` when neither applies
3. `npm run typecheck` (`tsc -b`) and `npm run lint` — from `v2/`
4. Version bumped in `v2/package.json` **and** `v2/package-lock.json`
   (`npm install --package-lock-only`)
5. Any `api/` change needs a `scripts/test*.ts` wire-check run live
6. No Story/Slice/decision tags in code or test comments; no references to this file from
   committed code

---

*Delete this file when the plan is complete.*
