# Plan: D1b — a player browses a page instead of reading its source

**Status**: **All slices built** — 1-3, 5 and 6 shipped, 7 built, 4 absorbed into 2. Every
acceptance criterion is ticked. What remains is the live E2E close-out, and then this file goes.
**Branch**: one per slice, cut off `main`. Slice 7: `feat/lynx-across-networks`.
**Epic**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) row **D1b**, Phase 1
**Base version**: v0.127.0

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
- [x] Links render numbered and selectable; Enter or Right Arrow follows the selected one and
      renders the page it names. *(slice 5, v0.127.0)*
- [x] Left Arrow or Backspace returns to the previous page. *(slice 6, v0.128.0)*
- [x] The target's `/var/log/access.log` gains one line per page **viewed**, sized and statused
      like any other fetch, naming the browsing player by the address the server derives.
      *(slices 2 and 5 on the LAN; slice 7 across the network, where the server derives it)*
- [x] A player browses another player's page across networks by public IP. *(slice 7, v0.129.0)*
- [x] `targetFs` and its neighbours are named once rather than three times. *(slice 3, v0.126.1)*

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

### Slice 2: A player reads a page as text and quits back to the terminal — ✔ SHIPPED v0.126.0 (#382)

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

### Slice 3: The target-resolution shape is named once, not three times — ✔ SHIPPED v0.126.1 (#384)

> **Done 2026-08-13.** The extraction is `core/commands/webHost.ts` — `reachWebHost`, returning
> `{ ok: true, host } | { ok: false, failure }`. It takes the WHOLE step rather than the four
> named helpers, because the order is the part worth protecting: a caller that resolved before
> mapping `localhost` onto its leased address would read a different tree and key its trace to a
> different machine while still sharing every helper. `sourceIp` came along as a fifth item —
> it is derived from the `isLoopback` the step computes, so leaving it behind would have kept
> `LOOPBACK_NAMES` at three call sites and failed the slice's own criterion.
>
> **The criterion held: 2491/2491 green with zero test files touched.** That was captured before
> anything else, because it is the evidence that behaviour did not move.
>
> Mutation then found something the refactor had newly exposed. The program name used to be
> welded into the same string literal the tests assert (`toContain('Could not resolve host')`);
> as a parameter it is independently mutable, and **every assertion in all three files was
> prefix-blind** — `program: 'lynx'` → `""` passed the entire suite. Four survivors, plus two
> more where the `kind: 'error'` literal in `gobuster`'s and `lynx`'s own `error` helpers lost
> its killing test to `webHost`'s copy. Six one-line assertion changes killed all six; no test
> case was added, removed or weakened.
>
> **Evidence: the survivor sets before and after are byte-identical** (147 lines, empty diff both
> ways), and `webHost.ts` is 100% (48/48) — the extracted step is fully pinned by the three
> commands' existing behaviour tests, with no test of its own. The percentages fell
> (curl 81.43 → 76.99, gobuster 82.12 → 77.87, lynx 78.85 → 70.67) purely because 37 killed
> mutants stopped existing when three copies became one; the same 74 survivors now sit over a
> smaller denominator. Score-as-percentage is the wrong instrument for a deduplication —
> the survivor-set diff is the right one.
>
> Both lessons — the survivor-set diff, and how extracting a welded-in string silently unpins it —
> are now durable in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §4 (#385),
> so slices 5-7 do not have to rediscover them.

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

### Slice 5: A player follows a link — ✔ SHIPPED v0.127.0 (#386)

> **Done 2026-08-13.** Four decisions taken with the owner before RED, all four as
> recommended:
>
> 1. **A line is segments, not a string.** `renderPage({html, url})` returns lines made of
>    `{kind:'text'}` / `{kind:'link', url, index}` runs, so the screen can highlight the run a
>    reader is about to follow. The 13 existing renderer tests kept their assertions verbatim
>    through a `asLines()` helper that flattens segments back to text.
> 2. **Selection clamps rather than wraps** — a reader holding a key comes to rest at the end
>    of the page instead of being thrown back to the other end of it.
> 3. **Only followable hrefs are numbered.** `mailto:`, `https:`, `#anchor`, an empty href and
>    a bare `<a>` with no href render as text. A number is a promise that Enter goes
>    somewhere, and slice 1 spent a whole slice removing exactly that broken promise.
> 4. **A refused follow does not move the reader** — the page stays, the footer says why. That
>    matches the log: a page and a 404 both mean the box ANSWERED (both leave a line), and a
>    host that was never reached leaves none.
>
> **Where the fetch went.** Following a link needs the request the command already makes, from
> the opposite side of the app — so it extracted to `core/commands/webPage.ts` (`fetchWebPage`
> → `page` | `not_found` | `unreachable`), and `state.ts` grew `followLink`, handed to the
> screen as a prop the way `saveEditor` is handed to `Nano`. `reachWebHost` narrowed from a
> whole `CommandEnv` to the one field it reads (`root: Directory`), which is what let the UI
> call it at all. `lynx.ts` lost 22 lines and gained nothing.
>
> **Mutation drove one simplification rather than a contrived test.** The selection highlight
> and `aria-current` were two independent copies of `segment.index === selected()`, so a mutant
> could flip one and leave the other — a page whose highlight and reported position disagree.
> Asking once and spending it twice made that unrepresentable. Scores: `webPage.ts` **100%
> (25/25)**; `renderPage.ts` 90.73 → **95.56%** (19 survivors → 8); `Lynx.tsx` 81.55 →
> **93.07%** (19 → 7); `http.ts` 96.19 → **97.14%** (4 → 3, and all three left are pre-existing
> `parseHttpUrl` regex-anchor mutants, untouched by this slice). The survivors that remain are
> defensive `??` fallbacks on paths that cannot be undefined, and `defer`/optional-chaining
> shapes whose mutants land on state the component already holds.
>
> **One test caught the world, not the code**: a follow aimed at `unoccupiedIp()` came back OK
> because that IS the address this game leases the player — so the link had hit their own box.
> The fixture now asks for a second free address.

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

### Slice 6: A player goes back — ✔ BUILT v0.128.0

> **Done 2026-08-13, and the decision is what made it small.** Because back re-fetches, back IS a
> follow to a remembered address: it calls the same `onFollow` the screen already had, so
> `state.ts`, `webPage.ts` and `lynx.ts` are untouched and the whole slice is `Lynx.tsx` plus
> tests. The extra `access.log` line nobody wrote is the decision paying for itself.
>
> **The trail lives in the screen**, beside the selection it restores — a stack in the parent
> would have made the selection travel out through `onFollow` and back through props to reach the
> same place. It starts empty on mount, so quitting and reopening begins a reading rather than
> resuming one.
>
> **Two orderings carry the feature, and they point opposite ways.** The page being left is read
> BEFORE the fetch, because by the time it answers the props are already the new page. The
> selection is restored AFTER it, because arriving anywhere sends the selection back to the first
> link and that reset has already run by then. Both are one line each and neither is guessable
> from reading the other.
>
> **Mutation caught the slice-3 lesson coming the other way.** The footer used to be one literal,
> so emptying it broke any assertion on it; splitting it into parts made `'↑↓ Select'` and the
> `join('  ')` separator independently mutable, and both survived a `getByText(/Follow/)`.
> Asserting the whole line killed both. The other two real survivors were worth more: `slice(0,
> -1)` → `slice(0, +1)` leaves a one-deep trail unemptied, so the first page stays behind itself
> forever — killed by walking a chain to its end and pressing back once more; and the back-key
> guard → `if (true)` makes *any* key go back — killed by pressing a meaningless key once there
> IS somewhere to go back to, which the pre-existing "any other key" tests could not do because
> their history was empty.
>
> **Scores: `Lynx.tsx` 92.81% → 95.68%** (10 survivors → 6), above the 93.07% it carried out of
> slice 5 — the new code is better pinned than the file was before it. All six left are
> pre-existing: the `screen?.focus()` optional chain, the `defer: true` pair, the `on` dependency
> array's content half, `tabIndex={-1}`, and `restOn`'s linkless guard — that last one equivalent,
> since without it a linkless page's selection becomes 0, which nothing renders and any arrival
> resets.
>
> **Refactor assessed.** `restOn` and `hint()` earned their names during GREEN: the clamp is one
> question asked by both moving and restoring, and the footer now has three independent parts. A
> `navigate()` wrapper over the three-line alert protocol that `follow` and `back` share was
> rejected — it would trade a named `FollowOutcome` for a bare boolean to save three lines.

> **Owner decision 2026-08-13: going back RE-FETCHES.** The open question was what the *defender*
> sees, not what the reader does: a re-fetch writes another `access.log` line, a cached render
> writes none. Re-fetching keeps ONE rule for the log — a line per page viewed, already an
> acceptance criterion this feature has held to since D2.3 — where caching would have needed a
> second rule saying when a view does not count. Caching was the quieter option and matched the
> legacy overlay; it lost to not having two rules for one log.
>
> **What that decision buys: back is a follow to a remembered address.** It goes through the same
> `onFollow` the screen already has, so there is no second fetch path, no new prop, and the extra
> log line is a consequence of the design rather than a feature anyone has to write. It also means
> the reader sees the page as it is NOW — if its author edited it, or it has since stopped being
> served, going back shows that. Which is why the selection has to survive a page that changed
> under it (below).

**Value**: Navigation that does not trap you.
**Path**: rendered link registry → history of visited addresses → Left Arrow/Backspace → the same
fetch path a follow takes → re-render the previous page → a further `access.log` line.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`. `refactoring` — assess
after green.
**Reduction program**: `N/A`.
**Acceptance criteria**:
- Left Arrow or Backspace returns to the previous page, and the page shown is **fetched again**,
  not remembered — evidenced at the screen's own interface as the follow it makes, since the log
  line that follow leaves is already proven where the fetch lives.
- At the first page there is nowhere back to, and pressing it **does nothing** — in particular it
  does not quit, and it does not fetch.
- The selection is restored to the link the reader left by, not reset to the first one.
- A back that never reached the host leaves the reader on the page they were reading, says why,
  and **keeps** the step in history — the same rule a refused follow already lives by, because a
  reader who could not go back has not gone back.
- Going back onto a page that has fewer links than when it was left comes to rest on its last
  link rather than pointing at one that is no longer there.
- The footer names the way back only once there is somewhere to go back to.
- Quitting and reopening the browser starts with no history — a new session, not a resumed one.

**RED**: At the screen. A two-page fixture, follow, then Left Arrow: assert the follow the screen
makes names the first page's address, and that the reader lands back on the link they left by.
Then the ones that are easy to write and easy to get wrong — first page does nothing, a refused
back stays put and keeps its step, a shortened page clamps.
**GREEN**: A stack of visited `{url, selected}` in the screen — it belongs beside the selection it
restores, and a stack in the parent would need selection to travel out and back through props for
no gain. Back pops it and calls `onFollow`.
**MUTATE**: on the stack's push/pop boundaries and the restore clamp — off-by-one and
empty-history guards are where mutants live, and `Lynx.tsx` mutates cleanly (93.07% after slice 5).
**KILL MUTANTS**: expect survivors around "does nothing at the first page" if the only assertion is
that `onExit` was not called; assert the follow did not happen either.
**REFACTOR**: Assess. The clamp is now wanted in two places (moving and restoring), which is the
same knowledge — where a selection may come to rest — rather than two lookalikes.
**Done when**: a three-page chain walks forward and back, the log shows every view including the
repeats, and the human approves the commit.

---

### Slice 7: A player browses another player's page — ✔ BUILT v0.129.0

> **Done 2026-08-13.** `fetchPageAcrossNetwork` lives in `webPage.ts` beside `fetchWebPage`,
> returning the same three outcomes, and `curl`, `lynx` and `followLink` each map that one union
> into their own shape. `curl` lost its private copy; **its entire test suite passed untouched**,
> which is the preservation evidence that its behaviour was moved and not redesigned.
>
> **`webPage.ts` is 100% (48/48)** — up from 25 mutants at slice 5, every one killed, with no test
> of its own. The same result `webHost.ts` got in slice 3, for the same reason: a step that three
> callers exercise is pinned by their behaviour tests.
>
> **Mutation found the slice-3 survivor class twice more, and a third form of the score trap.**
> The `program` literal survived in BOTH of `followLink`'s branches — my new cross-network test
> and slice 5's local one each asserted `{ok: false}` and never the sentence — so both now name
> the message in full. That range went 75.47% → **81.13%**.
>
> The third form is worth more than the fix: **a command's mutation score is mostly its manual.**
> `lynx.ts` fell 70.67% → 63.01% and every single one of its 27 survivors sits in the metadata
> block below `export const lynx` — its executable half has none. The score dropped because this
> slice ADDED manual prose (the public-IP door, the navigation keys, a third example), each string
> an unkillable-by-design literal. `curl.ts` reads the same way: 24 of its 25 survivors are manual,
> the 25th a pre-existing `.pid$` anchor. Recorded in
> [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §4 beside the other two
> forms, because a reader comparing scores across slices would call this a regression.
>
> **A test corrected me about the world again.** I asserted a followed link to an unleased LAN
> address would read `(7) Failed to connect`; it reads `(6) Could not resolve host`, because
> nothing holds that address at all — there is no host whose port could refuse. The assertion now
> says what the game says.
>
> **Named, not fixed:** `followLink` still has no test for the offline branch (4 no-coverage
> mutants) and none for a non-lynx overlay being open. Both are slice 5's, both predate this
> slice, and neither is named by a criterion here — so they stay listed rather than quietly
> absorbed.

> **Owner decision 2026-08-13: all three callers share one cross-network fetch.** `curl` held
> `fetchAcrossNetwork` privately — the round-trip plus the mapping from `host_unreachable` /
> `not_found` / `network_error` to what a player reads. `lynx` needs that identical mapping under
> a different program name, and `followLink` needs it a third time. Leaving `curl`'s copy in place
> would recreate exactly the divergence slice 3 was written to remove, so it moves into
> `webPage.ts` beside `fetchWebPage`, returning the same three-outcome `PageResult`, and all three
> call sites map that one union into their own shape. The alternative — extract for the two new
> callers and leave `curl` alone until a follow-up — was rejected for letting a second copy of the
> failure mapping exist in the meantime.
>
> **No `api/` change, so no wire-check.** `state.ts` already holds `fetchPublicPageFn`, the very
> function it wires into `env.remote.fetchPublic`, so the browser screen can reach across the
> network without a new endpoint. That is the alternate evidence this slice records in place of a
> live `scripts/test*.ts` run.

**Value**: Closes the loop D1 opened — the browser reaches across networks, not just the LAN.
**Path**: `lynx http://<public IP>` → the shared cross-network fetch → server-side resolution →
render; and the same path again for every link followed from that page.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Reduction program**: `N/A`.
**Acceptance criteria**:
- A player browses another player's page by public IP with no session and no credential, as
  `curl` already may. The "cross-network browsing is not supported yet" refusal is gone.
- The target's log names the browser by the address **the server derives**, never one the client
  sends — the request carries only `{target, port, path}`, so there is no field an address could
  travel in.
- An unforwarded and an unknown public IP are indistinguishable — the same collapsed
  `host_unreachable` the D1 cross-player half already proves. `network_error` stays a different
  sentence from a refusal: the target never answered because we never asked.
- Following a link on a cross-player page fetches across the network too, rather than falling
  back to the local tree.
- Going back to a cross-player page fetches across the network too — slice 6 composed with this.
- A cross-network failure reads where the reader is: the terminal when the command failed and the
  browser never opened, the footer when a followed link failed. The split slice 5 settled.
- `curl`'s every existing test passes untouched. Its cross-network behaviour is preserved, not
  redesigned — a test that needed editing means behaviour moved and the extraction is wrong.
- `lynx`'s manual names the public-IP door and shows it, as `curl`'s does.

**RED**: At the command, mirroring `curl`'s cross-network fixture — a stubbed `fetchPublic` that
captures what was asked, so the request shape is pinned as a contract rather than assumed. Then at
`state.ts` for a followed link and a back, where the branch that must NOT fall through to the local
tree lives.
**GREEN**: Move the round-trip and its mapping into `webPage.ts`; branch on `isPublicIp` in the
three callers.
**MUTATE**: on the new branch and the error mapping. Assert full program prefixes
(`lynx: (7) Failed to connect to …`), never the shared remainder — the extraction turns `program`
into an independently mutable literal, which is the survivor class slice 3 documented.
**REFACTOR**: This slice is partly one. `curl`'s preserved test suite is the evidence.

**Wire-check**: `N/A` — no `api/` change. `fetchPublicPage` and its endpoint are reused unchanged;
the seam `state.ts` already wires is the one the browser now calls.

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
