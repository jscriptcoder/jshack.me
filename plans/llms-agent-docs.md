# Plan: llms.txt that keeps up with the game

**Status:** Grilled 2026-11-20. One slice, planned below.

`public/llms.txt` (PR #744, 2026-10-29) tells an LLM agent how to get into the game and how the
terminal behaves. It went stale within three weeks: it still says "there are no missions yet",
though the contract jobs have shipped since. This work refreshes it and adds pages, as the
[llmstxt.org](https://llmstxt.org/) format allows, that are generated from the code, so the parts
that change most often cannot drift.

---

## Grill record

1. **The scope is a refresh plus generated pages (2026-11-20).** Rejected: a hand refresh alone,
   which goes stale with the next epic; and a play surface that needs no browser (MCP server or
   text API), which is an epic of its own and against the file's current "the HTTP API is internal"
   stance. Left for a later grill.

2. **The generated reference covers every command in the registry (2026-11-20).** In-game `help`
   already lists the whole registry, installed or not, and `man` documents every entry. An agent
   reading the page learns exactly what a player learns by typing `help` on the first turn, so
   nothing is spoiled. The current text's "every command available to you right now" is wrong for
   the same reason and is corrected.

3. **Jobs get a hint, not a name (2026-11-20).** The refreshed text says contract work exists and
   pays in JSC, and that finding who is hiring is part of the game. It never names hireme.io or the
   boards. This keeps the file's stance that it tells agents how to get in, not how to win.
   Rejected: naming hireme.io, which hands agents a step human players find on their own; and
   saying nothing about jobs.

4. **Two generated files: `/llms/commands.md` and `/llms-full.txt` (2026-11-20).**
   `commands.md` is the `help` listing followed by every `man` page. `llms-full.txt` is
   `llms.txt` with that page inlined, for agents that fetch a single file. Both come from one
   render. `llms.txt` itself stays hand-written prose.

## Facts the plan rests on (measured 2026-11-20)

- `commandRegistry` loads under `tsx` with no browser globals: 71 commands. `formatCommandList`
  (`core/commands/help.ts`) and `formatManPage` (`core/commands/man.ts`) are pure and exported,
  and return the exact `TerminalLine`s the terminal prints.
- `vercel.json` has no SPA rewrite, so a file under `public/` is served as itself.
- `scripts/encode.ts` is the precedent for a build-time generated, gitignored file, run from the
  `pre*` npm hooks.

---

## Slice 1: llms.txt that keeps up with the game (v0.476.0)

**Value:** an agent that reads `llms.txt` is no longer told there is nothing to do, and can read
every command's manual before it opens a browser. The command reference rebuilds on every deploy.

**Acceptance criteria**

1. `https://jshack.me/llms/commands.md` serves markdown holding the `help` listing and one section
   per registry command with its `man` text, in the words the terminal prints.
2. `https://jshack.me/llms-full.txt` serves `llms.txt` verbatim followed by the command reference.
3. Both are built from the registry on every `npm run build` (and `npm run dev`). Neither is
   committed, so a command added, renamed or re-documented shows up at the next deploy with no
   hand edit.
4. `llms.txt` no longer says there are no missions. It hints that paid contract work exists
   without naming a site, says `help` lists every command (some need installing first), and links
   both generated files under the spec's link-list shape.
5. Every other claim in `llms.txt` is re-checked against the current game and corrected where
   it has drifted.

**Shape**

- A pure renderer in `src/core/commands/` (next to `help.ts` and `man.ts`, whose formatters it
  reuses): registry commands → the `commands.md` string, and `llms.txt` text + that string → the
  `llms-full.txt` string. `TerminalLine`s render as plain text inside fenced blocks, so the page
  reads like the terminal.
- `scripts/llms.ts` does the IO only: read `public/llms.txt`, write `public/llms/commands.md` and
  `public/llms-full.txt`. Both outputs go into `.gitignore` beside the encoded secrets.
- `predev` / `prebuild` run it after `encode` (the registry imports the encoded secrets).

**TDD**

- RED → GREEN on the renderer through its public function, fed the real `commandRegistry`:
  every command's name and `man` synopsis appear; the `help` listing leads; a command with no
  manual still gets its section; `llms-full.txt` starts with the `llms.txt` text unchanged.
- `llms.txt` and the npm hook are content/config: evidence is a local `npm run build` showing both
  files in `dist/` and a `curl` of each from the Vercel preview (status 200, markdown body).
- Mutation gate: Stryker scoped to the renderer file, json reporter (timeouts count as killed).

**Gates:** `npm run typecheck`, `npm run lint`, `npm run test:run`, version bump in `package.json`
and `package-lock.json`.

**Out of scope:** an MCP server or public text API; a `<link>` to `llms.txt` from `index.html`;
per-command `.md` files.
