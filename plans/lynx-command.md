# Plan: `lynx` command — terminal HTML browser

**Branch**: `feat/lynx-command`
**Status**: Active

## Goal

Add a `lynx <url>` command that fetches a themed-network page through the same machinery as `curl` and renders the response as terminal-readable text — heading underlines, wrapped paragraphs, bullet lists, linearised tables, inline numbered link references with a footer references block, and form-field placeholders. Plain-text responses (`robots.txt`, `.bak`, etc.) pass through verbatim.

## Why lynx (vs w3m / links)

`lynx` is the canonical text-mode browser (1992) — the one a hacker would actually have installed. Its `-dump`-style output (numbered inline link refs, dashed dividers, `References:` block at the bottom) maps cleanly to single-column terminal output. We are NOT building interactive arrow-key navigation in this plan — players follow links by typing a new `lynx <url>` with the URL from the references block. That matches how `lynx -dump` is used and keeps scope tight.

## Authoring constraints we already enforce

Themed-network HTML pages are already required to be semantic HTML with no `<script>`, `<style>`, `class=`, `id=` (see `project_themed_network_html_validity`). The renderer can therefore be a deterministic walk of semantic tags — we do not need a CSS engine, JS sandbox, or layout solver.

## Acceptance Criteria

- [ ] `lynx http://techparts.io/` renders the landing page: header, nav links numbered inline, sections with heading dividers, bullet lists for "Why TechParts Global?", footer disclaimer text, and a `References:` block at the bottom listing every `<a href>` in order.
- [ ] `lynx http://techparts.io/catalog.html` renders categories as H2 dividers and product list items as numbered links.
- [ ] `lynx http://techparts.io/robots.txt` outputs the raw text verbatim (no HTML rendering) because the manifest entry is `kind: 'text'` and the served `Content-Type` is `text/plain`.
- [ ] `lynx http://techparts.io/does-not-exist` shows a brief 404 block rendered from the server's 404 HTML response.
- [ ] Connection failures (no machine, port closed, non-HTTP service) error with the same Linux-style message shape as `curl`.
- [ ] Links inside a page rendered as `[N]anchor text` inline; the `References:` block at the end lists `  N. <resolved URL>` for each anchor, in document order, with duplicates dedupe-merged to one entry.
- [ ] Tables render row-by-row with header row first (cells space-padded). Forms render each `<input>` / `<textarea>` / `<button>` as a labelled placeholder so the player can see field names without a form engine.
- [ ] `lynx` honours the same NAT, DNS, handler dispatch, and async jitter as `curl` (real network latency, no fake setTimeout layered on top).
- [ ] Unit tests cover the renderer in isolation (pure function over raw HTML → rendered lines + references). Integration tests cover the full command flow on a techparts page. Browser/Playwright tests are NOT added — `jsdom` already provides `DOMParser` for the renderer, and the techparts integration test exercises the end-to-end command path through the existing test harness.

## Out of scope (deferred)

- Interactive navigation (arrow keys, link selection, history stack) — separate plan if we ever want it.
- POST/form submission from inside `lynx` — players use `curl -X POST` for that.
- `lynx -dump` / `lynx -source` flags — defaults already behave like `-dump`; we may add the flags as aliases later but they don't change behaviour.
- HTML5 media tags (`<video>`, `<audio>`, `<canvas>`) — not used in themed networks.
- Cookie jar, redirects (3xx) — the curl pipeline doesn't model these either; if added later, both commands inherit it.

## Steps

Every step follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR.

### Step 1: Extract `performHttpRequest` helper from `curl.ts`

**Acceptance criteria**:
- A new pure module (likely `src/network/http.ts`) exports a `performHttpRequest(context, urlStr)` function that does URL parsing, DNS resolution, NAT translation, port/service validation, handler-or-static dispatch, and returns an `HttpResponse` plus the resolved target (IP/port/method) needed for `onHttpRequest` logging.
- `curl.ts` becomes a thin command that calls this helper, formats the response (with/without headers), and calls `onHttpRequest`.
- All existing curl tests continue to pass with no changes to their assertions or shape.
- New unit tests cover the helper directly for: successful static-file GET, successful handler-driven response, 404 fallback, NAT-translated filesystem read, DNS-resolved hostname, IP-only host, missing port, closed port, non-HTTP service.
- No new behaviour visible to players.

**RED**: New tests in `src/network/http.test.ts` describing the helper's contract (input shape → output shape). They fail because the module doesn't exist yet.
**GREEN**: Move the relevant logic out of `curl.ts` into the helper; rewire `curl.ts` to call it.
**MUTATE**: Run mutation testing on `src/network/http.ts` and `src/commands/curl.ts`.
**KILL MUTANTS**: Strengthen tests for surviving mutants.
**REFACTOR**: Only if a clear simplification surfaces — this step is itself a refactor, no further reshuffling.
**Done when**: All curl tests still pass, new helper tests pass, mutation report reviewed, human approves commit.

### Step 2: Pure HTML→terminal renderer

**Acceptance criteria**:
- New module `src/commands/lynx/render.ts` exports `renderHtml(rawHtml: string, opts: { width: number }): { lines: readonly string[]; references: readonly string[] }`.
- Uses `DOMParser` (jsdom in tests, real DOMParser in browser) — no manual tokenising, no regex over markup.
- Renders h1 with `===` underline, h2 with `---` underline, h3-h6 with no underline but blank lines around.
- `<p>` wraps to `opts.width` columns, paragraph break = one blank line.
- `<ul>` items prefixed `   * `, `<ol>` items numbered `   1. ` `   2. ` etc., nested lists indent one level.
- `<a href>` inline replaced with `[N]text`; URLs accumulated into `references` in document order; identical URLs collapse to one number.
- `<table>` linearised row-by-row; first row of `<thead>` (or first `<tr>` if no thead) rendered as a header row separated from body with `---` line; cells space-padded to align columns within a single table.
- `<form>` renders each `<input>`/`<textarea>` as `[Field name (type): ___]` and `<button>` as `[Button: label]`, using `name=` and surrounding `<label>` text.
- `<br>` → newline within current block. `<hr>` → row of `_` chars to `opts.width`.
- `<strong>`, `<em>`, `<small>`, `<code>`, `<cite>` — children rendered inline, no decoration in this iteration.
- `<head>`, `<script>`, `<style>` content dropped entirely.
- Unknown tags: render children, drop the wrapper.
- HTML entities (`&mdash;`, `&amp;`, etc.) decoded via the DOMParser (don't write a custom entity table).
- Pure function: no fetch, no command context, no I/O. Same input → same output.

**RED**: `src/commands/lynx/render.test.ts` with table-driven cases — one test per element class, plus a "kitchen sink" fixture (a hand-crafted page exercising headings, links, lists, tables, forms, entities). All fail.
**GREEN**: Implement a recursive walker over `document.body`, emitting line tokens, with a final pass that flattens to strings of at-most-`width` columns and appends `References:` block.
**MUTATE**: Run mutation testing on `src/commands/lynx/render.ts`.
**KILL MUTANTS**: Strengthen weak cases (especially link numbering, dedupe, table header detection, list nesting).
**REFACTOR**: Look for natural seams — a `walk(node, ctx)` recursion with a `RenderContext` accumulator object is the obvious shape. Keep it functional (immutable returned line arrays from each child).
**Done when**: All renderer tests pass, mutation report reviewed, human approves commit.

### Step 3: `lynx` command wired to the fetch pipeline

**Acceptance criteria**:
- New `src/commands/lynx.ts` exports `createLynxCommand(context)` mirroring the curl context shape.
- The command:
  - Validates the URL (uses the same `parseUrl` from `src/network/http.ts`).
  - Calls `performHttpRequest(context, urlStr)` — async with the same `jitter(500)` cadence as curl, same `createCancellationToken` plumbing.
  - On 2xx with `Content-Type: text/html`: feeds `response.body` to `renderHtml` and emits the rendered lines plus a blank line plus the `References:` block.
  - On 2xx with non-HTML content-type: emits the body verbatim (line-split, no rendering).
  - On non-2xx HTML: still renders the body — server-side error pages are HTML, lynx renders them.
  - On non-2xx non-HTML: emits the body verbatim with a one-line status header (e.g. `[404 Not Found]`).
  - Calls `context.onHttpRequest` on every successful request (same payload shape as curl).
  - On DNS / connect / closed-port failures, throws the same Linux-style error messages as curl.
- `useNetworkCommands.ts` wires `lynx` into the command registry with the same `wrapWithBrickedCheck(wrapWithWifiCheck(...))` wrappers as curl.
- `help` and `man lynx` show the command with a synopsis, description, arguments, and at least three examples.
- An integration test in `src/commands/lynx.test.ts` boots a minimal fake context with a techparts-style page in the filesystem and asserts the rendered lines contain expected anchors of the page (heading text, a list item, a numbered link, the `References:` line).
- A negative integration test confirms 404 / closed-port / unknown-host produce the same error shape as curl.

**RED**: Write `src/commands/lynx.test.ts` first — both happy path and error paths. They fail (module doesn't exist).
**GREEN**: Implement `createLynxCommand`. Wire to `useNetworkCommands.ts` and update `help` / `man` metadata.
**MUTATE**: Run mutation testing on `src/commands/lynx.ts`.
**KILL MUTANTS**: Strengthen anything weak.
**REFACTOR**: If curl and lynx end up with duplicated jitter/cancellation/onHttpRequest plumbing, factor a tiny shared async-request scaffold — only if the duplication is real and bothersome.
**Done when**: All tests pass (existing + new), command works manually via `npm run dev` against techparts.io, `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all green, mutation report reviewed, human approves commit.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing on touched modules — run `mutation-testing` skill.
2. Refactoring assessment — run `refactoring` skill.
3. `npm run build && npm run lint && npm run format:check && npm run test:run` all pass.
4. Update `README.md` and `src/commands/README.md` (if it exists) with the new command. Verify no other docs need updating (`docs/architecture.md`, etc.).
5. Bump `package.json` and `package-lock.json` to the next minor (feature bump) per the project's version-bump convention.

## Open questions for human

1. **Terminal width** — what value to pass for `opts.width`? Real lynx defaults to 80 columns. The game's terminal is wider on desktop. Should the renderer accept a runtime-detected width from the terminal component, or hardcode 80 for now and revisit later?
2. **Page title display** — real lynx puts the `<title>` text on the top status line. Our terminal has no status line; should we prepend the title as a banner above the rendered body, or drop it?
3. **PR splitting** — three PRs (extract helper / pure renderer / wired command) feels right per the "small independently mergeable units" rule. Confirm or push back if you'd rather collapse PRs 2+3.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
