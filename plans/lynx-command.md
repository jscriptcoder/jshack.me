# Plan: `lynx` command — full-screen terminal HTML browser

**Branch**: `feat/lynx-command`
**Status**: Active

## Goal

Add a `lynx <url>` command that opens a full-screen interactive browser overlay (same architectural pattern as `nano`), fetches the requested page through the same machinery as `curl`, renders the response as terminal-readable text, and lets the player navigate hyperlinks with arrow keys / Enter / back / quit.

## Why lynx (vs w3m / links)

`lynx` is the canonical text-mode browser (1992) — the one a hacker would actually have installed. The full-screen TUI (title bar with URL, rendered body, status bar, key-bindings help bar) maps cleanly onto the existing `NanoEditor` overlay pattern in `src/components/Terminal/NanoEditor.tsx`. Visually we gain "hacker pressing arrows through a CRT-styled browser," which suits the game's aesthetic.

## Architecture

This plan follows the same shape as `nano`:

1. **Command** (`src/commands/lynx.ts`) — synchronously validates the URL (parseable, scheme is `http`/`https`) and returns `{ __type: 'lynx_open', url }`. No fetch happens at the command layer.
2. **Overlay component** (`src/components/Terminal/LynxBrowser.tsx`) — full-screen React component, mounted by `Terminal.tsx` when it sees `lynx_open`. Owns the fetch lifecycle, page state, link cursor, history stack, and keyboard handling. Receives an `onFetch: (url: string) => Promise<HttpResponse>` callback (provided by the wiring layer) and a pure `renderHtml` from Step 2.
3. **Renderer** (`src/commands/lynx/render.ts`) — pure function that turns raw HTML into `{ lines, references }`. Reused unchanged whether the renderer ever lands in a `-dump` flag later.
4. **HTTP helper** (`src/network/http.ts`) — extracted from curl in Step 1, shared by curl and the lynx overlay's fetch callback.

This keeps each concern testable in isolation: the renderer is a pure unit-tested function, the overlay is tested against a mock `onFetch`, the command is a one-line discriminator returner, and the HTTP helper has its own test file.

## Authoring constraints we already enforce

Themed-network HTML pages are already required to be semantic HTML with no `<script>`, `<style>`, `class=`, `id=` (see `project_themed_network_html_validity`). The renderer can therefore be a deterministic walk of semantic tags — we do not need a CSS engine, JS sandbox, or layout solver.

## Acceptance Criteria

- [ ] Typing `lynx http://techparts.io/` opens a full-screen overlay (terminal hidden), shows a "Getting http://techparts.io/..." status while fetching, then renders the landing page in the body with the page `<title>` displayed in the title bar.
- [ ] Arrow Up / Arrow Down move a visual link cursor through the page's anchors in document order. The selected link is highlighted (theme-accent background). The body auto-scrolls to keep the selected link in view.
- [ ] Enter (or Right Arrow) on a selected link fetches the target URL — resolving relative URLs against the current page's URL — and pushes the new page onto a history stack. The status bar shows "Getting <url>..." during the fetch.
- [ ] Left Arrow (or Backspace) pops the history stack and re-displays the previous page (without refetching — page bodies are cached in the stack).
- [ ] `q` or Escape closes the overlay and returns to the terminal prompt.
- [ ] HTML responses are rendered via the pure renderer (headings with underlines, paragraphs wrapped to the overlay's pixel width converted to columns, bullet/numbered lists, linearised tables with header row separation, form fields shown as labelled placeholders, `<a>` shown highlighted inline). Non-HTML responses (`text/plain`, `text/css`, etc.) display verbatim in the body, preformatted.
- [ ] Connection failures (no machine, closed port, unknown host) surface in the status bar as a brief lynx-style alert ("Alert!: Unable to connect to remote host"). The overlay does not crash — the player can press `q` to exit or `b` to go back if history is non-empty.
- [ ] Server-side error responses (4xx / 5xx) render whatever HTML/text the server returned — same as a normal page. The status bar shows the HTTP status (e.g. `HTTP/1.1 404 Not Found`).
- [ ] The command exits cleanly: opening `lynx`, navigating two links, going back, and pressing `q` returns to a normal terminal prompt with no residual state.
- [ ] Help bar at the bottom shows the key bindings, lynx-style: e.g. `↑↓ Links  ↵ Follow  ← Back  q Quit`.
- [ ] Unit tests cover the renderer pure function in isolation. Component tests cover the overlay against a mock `onFetch` (page renders, arrow keys move cursor, Enter triggers fetch with correct URL, history stack works, `q` quits). Integration test wires the real command + overlay + fetch helper against an in-memory techparts machine and asserts a full flow.

## Out of scope (deferred)

- POST/form submission — `<form>` inputs render as labelled placeholders but submit is not wired. Players use `curl -X POST` for actual API calls.
- `lynx -dump` / `lynx -source` flags — easy follow-up once the core ships.
- `/` in-page search, `g` go-to-URL prompt, bookmarks, cookie jar, redirects (3xx). Real lynx has them; the curl pipeline doesn't model 3xx either, so neither does lynx for now.
- Mouse support, copy/paste of link URLs from inside the overlay (the player can re-run `lynx <url>` from the prompt).
- HTML5 media tags (`<video>`, `<audio>`, `<canvas>`) — not used in themed networks.
- Page-up / page-down scrolling beyond what auto-scroll-to-selected-link provides. Can add later if needed.

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
- `<ul>` items prefixed `  *`, `<ol>` items numbered `  1.` `  2.` etc., nested lists indent one level.
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

### Step 3: `<LynxBrowser>` overlay component (mock `onFetch`)

**Acceptance criteria**:

- New `src/components/Terminal/LynxBrowser.tsx` exports the overlay component. Mirrors `NanoEditor.tsx`'s layout shape: fixed-inset full-screen container, title bar at the top, scrollable body in the middle, status bar + key-bindings help bar at the bottom.
- Props: `{ initialUrl, onFetch, onClose }` where `onFetch: (url: string) => Promise<HttpResponse>`. No real network: tests use a mock `onFetch`.
- Internal state: history stack (`{ url, response, renderedLines, references }[]`), selected link index, loading flag, error message.
- Lifecycle:
  - On mount, sets loading state, calls `onFetch(initialUrl)`, on resolve pushes the page onto the history stack and renders it.
  - On link follow: resolves the link's `href` relative to the current page URL, calls `onFetch`, pushes onto stack.
  - On back: pops the stack, no refetch.
- Keyboard:
  - Up / Down arrows: move the selected link index. The selected `<a>` is highlighted in the rendered body.
  - Enter or Right Arrow: follow the selected link.
  - Left Arrow or Backspace: pop history (no-op when stack depth ≤ 1).
  - `q` or Escape: call `onClose`.
- Title bar shows the page `<title>` and the current URL.
- Status bar shows the current activity: `Getting <url>...` during fetch, `HTTP/1.1 <status>` after success, or the error alert ("Alert!: Unable to connect to remote host: ...") on failure.
- Help bar shows the key bindings.
- Auto-scrolls the body so the selected link stays visible.
- Body uses `renderHtml(rawHtml, { width })` for HTML responses (`Content-Type: text/html`); for non-HTML responses, displays the body verbatim with `<pre>`-like formatting.
- Component-level tests (`LynxBrowser.test.tsx`) cover: initial render shows "Getting...", resolved fetch renders heading + body, arrow keys move the link cursor, Enter triggers `onFetch` with the resolved URL, back pops history without refetch, `q` calls `onClose`, fetch rejection surfaces in the status bar without crashing.

**RED**: Write `LynxBrowser.test.tsx` first — happy path (mount → resolves → renders), navigation (arrows + Enter), back, quit, error path. All fail.
**GREEN**: Implement the component.
**MUTATE**: Run mutation testing on `LynxBrowser.tsx`.
**KILL MUTANTS**: Strengthen weak cases (especially link-index bounds, history pop-without-refetch, error-status-bar wording, URL resolution).
**REFACTOR**: Extract small pure helpers if state-management logic becomes dense (`resolveRelativeUrl(base, href)`, `clampSelectedLink(index, totalLinks)`).
**Done when**: All overlay tests pass, mutation report reviewed, human approves commit.

### Step 4: `lynx` command + Terminal.tsx wire-up

**Acceptance criteria**:

- New `src/commands/lynx.ts` exports `createLynxCommand(context)`.
  - Synchronously validates the URL: must parse via `parseUrl`. Throws lynx-style error message ("lynx: invalid URL: <input>") on failure. Throws "lynx: missing URL argument" with no arg.
  - On success, returns `{ __type: 'lynx_open', url }` — no fetch at this layer.
- New `LynxOpenData` type in `src/components/Terminal/types.ts` with corresponding `isLynxOpen` guard. Added to the `CommandResult` union.
- `Terminal.tsx` detects `lynx_open`, mounts `<LynxBrowser>` with:
  - `initialUrl` from the command payload.
  - `onFetch` callback that calls `performHttpRequest` against the live context (DNS, NAT, handler dispatch, real jitter).
  - `onClose` that unmounts the overlay and returns focus to the terminal prompt.
- `useNetworkCommands.ts` registers `lynx` with the same `wrapWithBrickedCheck(wrapWithWifiCheck(...))` wrappers as curl.
- `help` and `man lynx` show synopsis, description, arguments, examples (at minimum: `lynx http://techparts.io/`, `lynx 192.168.1.1`).
- README and `src/commands/README.md` (if it exists) updated.
- `package.json` and `package-lock.json` bumped (minor version).
- Manual smoke: `npm run dev`, open the game, `lynx http://techparts.io/` — overlay opens, page renders, arrows navigate links, Enter follows, `q` returns to prompt.

**RED**: `src/commands/lynx.test.ts` first — command returns correct discriminator, throws on missing/invalid URL. Plus a small integration test that wires the real command + overlay against an in-memory techparts machine and asserts the overlay can fetch and render the landing page.
**GREEN**: Implement the command, add the type + guard, wire into `Terminal.tsx` and `useNetworkCommands.ts`.
**MUTATE**: Run mutation testing on `src/commands/lynx.ts` and the new wire-up sites.
**KILL MUTANTS**: Strengthen.
**REFACTOR**: If the lynx and nano wire-up shapes start to feel duplicated, factor a small overlay-dispatcher helper — only if duplication is concrete and bothersome.
**Done when**: All tests pass (existing + new), manual smoke succeeds, `npm run build && npm run lint && npm run format:check && npm run test:run` all green, mutation report reviewed, human approves commit.

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing on touched modules — run `mutation-testing` skill.
2. Refactoring assessment — run `refactoring` skill.
3. `npm run build && npm run lint && npm run format:check && npm run test:run` all pass.
4. Update `README.md` and `src/commands/README.md` (if it exists) with the new command. Verify no other docs need updating (`docs/architecture.md`, etc.).
5. Bump `package.json` and `package-lock.json` to the next minor (feature bump) per the project's version-bump convention.

## Resolved decisions

- **Rendering width**: derived from the overlay container at mount via measured pixel width ÷ monospace char width, re-measured on window resize. No hardcoded 80.
- **Loading-state visual**: status-bar-only — "Getting <url>..." appears in the status bar while the previous page (if any) stays visible in the body. Matches real lynx behaviour. Initial load (empty history) shows a blank body during the first fetch.
- **PR splitting**: four PRs as proposed — (1) extract HTTP helper, (2) pure renderer, (3) overlay component, (4) command + wire-up.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
