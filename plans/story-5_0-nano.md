# Plan: `nano` editor (Story 5.0 — prerequisite primitive)

**Branch**: one per slice (e.g. `feat/v2-nano-edit`, `feat/v2-nano-newfile`, …)
**Status**: Active
**Parent**: `plans/multiplayer-crossplayer-epic.md` → "Story 5 — resolved scope & decisions" (5.0).

## Goal

Give v2 a working `nano <file>` — a full-screen terminal editor that opens a file, edits it, and saves
back through the shipped patch-write seam — so any file can be edited in-game (configs, `/etc/passwd`,
web content, scripts), and Story 5.1's `nano /etc/iptables/rules.v4` flow is unblocked.

## Why this is its own story (not folded into 5.1)

`nano` is a standalone, broadly-useful primitive, NOT cross-player NAT logic. It is **net-new in v2**:
the `ModeChange` type already declares `{ kind:'nano'; path; content }` (`core/commands/types.ts:91`)
and `runLine.ts` passes `mode_change` results through untouched, but there is **no `nano` command, no
editor UI, and `executeLine` silently ignores `mode_change`** (`ui/state.ts:721`, the `try` block only
handles `sync`/`async`). Building it cleanly on its own keeps the NAT story focused and gives the whole
game a file editor.

## Architecture (the seams nano plugs into)

- **Command** `core/commands/nano.ts` — `nano <file>` reads the target via `env.fs.read` and returns
  `{ kind:'mode_change', mode:{ kind:'nano', path, content } }`. Framework-agnostic, unit-testable.
  Model the read branches on `cat.ts` (the existing file-reader): existing file → content; `not_found`
  → empty buffer (a new file); `is_directory` → error result (NO mode change); missing operand →
  usage error.
- **UI mode signal** — a module-level `editorMode` signal in `ui/state.ts`
  (`{ path: AbsPath; content: string } | null`). `executeLine` gains a `mode_change` branch that, for
  `mode.kind === 'nano'`, sets it. (Other `ModeChange` kinds stay no-ops — out of scope.)
- **Editor screen** `ui/screens/nano.tsx` — a Solid component the **`Terminal` screen** renders via
  `<Show when={editorMode()} fallback={…terminal body…}><Nano …/></Show>`, so the editor replaces the
  prompt+scrollback while editing (the terminal input leaves the DOM → AC c) and the module-level
  signals persist underneath. Backs the live buffer with a native `<textarea>` (cursor/multiline/
  selection for free); only the **Ctrl-O** (write out) and **Ctrl-X** (exit) chords are custom. nano
  chrome: a title bar with the path + a footer with the shortcuts + a status line, matching legacy.
  Takes `onSave`/`onExit` as PROPS (not direct imports) so it is unit-testable with fakes; `Terminal`
  wires `onSave={saveEditor}` and `onExit={() => setEditorMode(null)}`.
- **Save seam** `saveEditor(content)` exposed from `ui/state.ts` — resolves `isNew` from the live FS
  view (`stat === null`, exactly like `validateRedirectTarget`, runLine.ts:142) and calls the
  module-level `patchApi.write(path, content, { isNew })`. Reuses `wrapWithRefetch` so an immediate
  `cat` reflects the save; permission/`no_session` errors surface as a `PatchResult` the editor shows.
  NOTE: the write hits the real server (`createPatchApi → fetch /api/patches`); jsdom has no server,
  so the full save→persist→`cat` loop is the agent-browser E2E (below), while jsdom tests assert the
  seam (that a write was issued with the right `isNew`) via the `fetch`-stub capture pattern.
- **Exit** — clears `editorMode` → back to the terminal screen.

## Decisions (locked 2026-06-16)

- **Preinstalled on EVERY machine, guest tier** — `availability:{ kind:'any-machine' }`,
  `tier:'guest'`, `category:'filesystem'` (like `cat`/`ls`). **Owner-decided**: nano ships on every
  box (realistic — a base editor is always present), so there is NO `apt install nano` gate. Opening is
  always allowed; **write permission gates the _save_** (the patch model returns
  `permission_denied`/`no_session`), never the open.
- **Slice 1 includes save** — **Owner-decided**: the first slice is the COMPLETE editor for existing
  files (open + edit + Ctrl-O save + Ctrl-X exit), not a view-only skeleton. It is a chunky-but-coherent
  single PR; new-file creation and error/edge states are the follow-up slices.
- **`<textarea>`-backed buffer** — no custom text-buffer/cursor logic; the editor owns a local buffer
  signal seeded from `editorMode().content`.
- **`isNew` resolved at save time** from the FS view — the `ModeChange.nano` payload stays
  `{ path, content }` (no schema change); the save recomputes new-vs-overwrite, so a file created
  between open and save still stamps correctly.
- **Save chord = Ctrl-O; exit = Ctrl-X** (legacy nano). The modified-buffer "Save modified buffer?"
  prompt on Ctrl-X is **deferred to slice 3** (ship-first: Ctrl-X exits, Ctrl-O saves).
- **Test infra (CORRECTED 2026-06-17 against the real v2 setup)** — v2 has NO Vitest Browser Mode and
  NO Playwright. UI is tested with `@solidjs/testing-library` + jsdom + `fireEvent` (the
  `terminal.test.tsx` convention); E2E is `agent-browser` against the live `npm run dev` server. The
  save→persist→`cat` loop needs a real server, so it lives ONLY in the agent-browser E2E; jsdom tests
  cover the command/state/component seams with `fetch`/`localStorage` stubs.
- **Editor placement = Terminal-level overlay** — `Terminal` renders `<Show when={editorMode()}>` over
  its body (NOT an App-level branch). Keeps the existing `renderTerminal()` test style, hides the
  prompt while editing, avoids an App unmount/remount.
- **`nano` read branches** — readable → editor w/ content; `not_found` → editor w/ empty buffer;
  `is_directory` → `nano: <path>: Is a directory` (exit 1, NO editor); `permission_denied` →
  `nano: <path>: Permission denied` (exit 1, NO editor); missing operand → `nano: missing file
operand` (exit 1). Only `ok`/`not_found` enter the editor.

## Acceptance Criteria (whole story)

- [x] `nano <existing-file>` opens a full-screen editor showing the file's content; the terminal
      prompt is not visible while editing; **Ctrl-X** returns to the terminal.
- [x] Editing the buffer and pressing **Ctrl-O** writes it back to the file; a subsequent
      `cat <file>` shows the new content. _(agent-browser E2E: edited `/home/neo/notes-e2e.txt`,
      `cat` reflected it through the real `/api/patches` + Supabase round-trip.)_
- [x] `nano <new-path>` (parent dir exists + writable) opens an empty buffer; **Ctrl-O** creates the
      file; `ls`/`cat` then show it. _(E2E created the file from a `not_found` buffer with `is_new=true`.)_
- [x] `nano <directory>` errors (`nano: <path>: Is a directory`) and does NOT enter the editor.
      _(Also: `permission_denied` read → error, no editor.)_
- [x] A save the session's tier may not perform surfaces an in-editor error (nano status line) and
      does NOT corrupt or partially write; the file is unchanged. _(`<Nano>` maps the failed
      `PatchResult` → `[ Error writing <path>: Permission denied | I/O error ]`, keeps the buffer, and
      stays open; the patch model guarantees a rejected write persists nothing.)_
- [x] No regression: existing terminal flows (commands, prompts, Ctrl-C, redirect) behave unchanged
      when not in editor mode. _(Full suite: 1376/1376 green.)_

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test.
Read `.claude/CLAUDE.md` + the `testing` rules before each slice. UI interaction is tested with
**`@solidjs/testing-library` + jsdom + `fireEvent`** (the actual v2 convention — see `terminal.test.tsx`;
v2 has NO Browser Mode/Playwright); a **single `agent-browser` E2E** covers the full save→persist→`cat`
loop against the live `npm run dev` server (per `feedback_e2e_scope` / `feedback_e2e_test_new_primitives`
— E2E the new primitive end-to-end, don't duplicate unit coverage there). v2 gates: `npm run lint`
(no Prettier) + `npm run typecheck` (`tsc -b`).

### Slice 1: `nano <existing-file>` opens a full-screen editor; edit + Ctrl-O saves; Ctrl-X exits

**Value**: A player edits any readable file and persists it — the complete editor for existing files.
Proves the whole `command → mode_change → editorMode → editor → save → exit` path end-to-end and
stands up all the UI-mode infrastructure.
**Path**: `nano /etc/hosts` → `nano.ts` reads via `env.fs.read` → `mode_change:nano` → `executeLine`
sets `editorMode` → `App` renders `<Nano>` (title bar + content in a `<textarea>` + footer) → type →
**Ctrl-O** → `saveEditor(content)` resolves `isNew=false` → `patchApi.write(path, content)` →
`wrapWithRefetch` refetches → status line "[ Wrote N lines ]" → **Ctrl-X** clears `editorMode` →
`cat /etc/hosts` shows the edit.
**Required implementation skills**: `tdd`, `testing`, `front-end-testing`, `mutation-testing`,
`refactoring`.
**Acceptance criteria**:

- (a) `nano.ts` returns `mode_change` with the file's content for an existing readable file; a
  `not_found` target yields an empty-content buffer; a directory yields an `error` result (NO mode
  change); a missing operand yields a usage error.
- (b) `executeLine` sets `editorMode` on a `nano` `mode_change` and leaves other `ModeChange` kinds
  no-ops.
- (c) The `<Nano>` screen renders the path + content and is shown INSTEAD of the prompt while
  `editorMode` is set (terminal prompt not visible).
- (d) Typing updates the buffer; **Ctrl-O** calls the write seam with the buffer content and
  `isNew=false`, renders a wrote-confirmation, and leaves the editor OPEN.
- (e) **Ctrl-X** clears `editorMode` → terminal; a subsequent `cat` reflects the saved edit.
- **Present to human, confirm before coding.**

**RED**:

- `nano.test.ts` (vitest, pure core): readable file → `mode_change` whose `content` equals the read
  content; `not_found` → `mode_change` with `content === ''`; directory → `error` result (NOT a
  `mode_change`); permission-denied → `error` result; no arg → usage `error`. (Mutator targets: the
  read-result branch conditionals — kill "not_found returns error" vs "returns empty" swaps, and the
  `is_directory`/`permission_denied` guards.)
- `state.test.ts` (jsdom, the `startTestGame` `fetch`/`localStorage`-stub pattern): a `nano`
  `mode_change` from `executeLine`/`runInput` sets `editorMode` (non-nano kind does not); `saveEditor`
  issues a write with `isNew=false` for an existing path and `isNew=true` for an absent one (asserted
  via the captured `fetch` write request). (Mutator: the `stat === null` boolean.)
- `nano.test.tsx` (jsdom, `@solidjs/testing-library`): given a `mode`, the `<Nano>` component shows
  path + content; typing updates the buffer; Ctrl-O calls the `onSave` prop with the edited content and
  renders the wrote-status while staying mounted; Ctrl-X calls the `onExit` prop.
- **agent-browser E2E**: full real flow against `npm run dev` — readable file → `nano f` → edit →
  Ctrl-O → Ctrl-X → `cat f` shows the edit. (The one integration-seam test; needs the real server.)

**GREEN**: minimal `nano.ts`; the `editorMode` signal + `executeLine` `mode_change` branch;
`saveEditor` in `state.ts`; the `<Nano>` component (title + `<textarea>` + footer + status line) wired
into `Terminal` via `<Show when={editorMode()}>`; Ctrl-O + Ctrl-X handlers.
**MUTATE**: run `mutation-testing` on `nano.ts` + the new state seams (`editorMode` dispatch,
`saveEditor`).
**KILL MUTANTS**: read-result kinds, mode-change dispatch, `isNew` resolution, success/failure status,
"Ctrl-O does not exit / Ctrl-X does".
**REFACTOR**: assess only if it adds value (e.g. extract `formatNanoError` once a second error case
appears in slice 3 — otherwise inline).
**Done when**: all AC met, mutation report reviewed, human approves commit.

### Slice 2: `nano <new-path>` opens an empty buffer; Ctrl-O creates the file

**Value**: Create-and-edit in one step (the common "make a new config" flow — e.g. seeding a fresh
`rules.v4` in Story 5.1).
**Path**: `nano /tmp/new.conf` (parent exists + writable) → empty buffer (slice 1 already returns empty
content for `not_found`) → type → Ctrl-O → `saveEditor` resolves `isNew=true` (`stat === null`) →
`patchApi.write(path, content, { isNew:true })` → `ls`/`cat` show the new file.
**Required implementation skills**: `tdd`, `testing`, `front-end-testing`, `mutation-testing`,
`refactoring`.
**Acceptance criteria**: A `nano` on a non-existent path opens an empty buffer; saving stamps
`isNew=true` so the new row is created (and a later `rm` deletes the row rather than tombstoning —
consistent with redirect's `is_new`). After save, `ls` lists it and `cat` returns its content.
**Present to human, confirm before coding.**
**RED**: `state.test.ts` — `saveEditor` resolves `isNew=true` when `stat === null` and forwards the
flag to `write`. E2E — `nano /tmp/x` → type → Ctrl-O → Ctrl-X → `ls /tmp` shows `x`, `cat` shows
content. (Mutator: the `isNew` true-branch; flag forwarding.)
**GREEN**: ensure `saveEditor` forwards `{ isNew }` (the `stat === null` resolution likely already
lands in slice 1 — this slice's value is the NEW-FILE behavior proven end-to-end; keep it a distinct
PR for the create-path test coverage even if the production delta is small).
**MUTATE / KILL / REFACTOR**: as above.
**Done when**: AC met, report reviewed, human approves.

### Slice 3: Error + edge states (directory target, unwritable save, optional modified-exit prompt)

**Value**: Robust, non-confusing failures — the editor never silently loses work or corrupts a file.
**Path**: `nano /etc` → command-level `Is a directory` error (no editor). Save where the tier can't
write → `patchApi.write` returns `permission_denied`/`no_session` → editor status shows the error, file
unchanged, editor stays open. _(Optional)_ Ctrl-X with unsaved changes → "Save modified buffer?"
prompt (Y/N/cancel).
**Required implementation skills**: `tdd`, `testing`, `front-end-testing`, `mutation-testing`,
`refactoring`.
**Acceptance criteria**: `nano <dir>` prints `nano: <path>: Is a directory`, exit 1, no `mode_change`
(strengthened from slice 1). A denied save shows the error in the status line and leaves the file
unchanged. _(If included)_ Ctrl-X on a modified buffer prompts before discarding.
**Present to human, confirm before coding.**
**RED**: `nano.test.ts` — directory → error, not mode_change (assert exit code + message).
`state.test.ts`/`nano.browser.test.tsx` — a `write` returning `permission_denied` renders the error
status and keeps the buffer. (Mutator: error-message mapping; the failure branch keeping the editor
open vs exiting.)
**GREEN**: error mapping + status rendering; (optional) modified-flag + exit prompt.
**MUTATE / KILL / REFACTOR**: as above.
**Done when**: AC met, report reviewed, human approves.

## Open questions / notes

- **Editor placement — RESOLVED (Terminal-level)**: `Terminal` renders `<Show when={editorMode()}>`
  over its body (not an `App` branch), so the existing `renderTerminal()` test style applies and the
  prompt leaves the DOM while editing.
- **`binaries.ts` / `libraryDeps.ts` already reference `nano`** (grep hits) — since nano is
  preinstalled (`any-machine`), confirm in slice 1 that no `apt`/binary-gate wiring is needed (or align
  the binary list with the always-present decision).
- **Footer/title chrome fidelity** — match legacy nano's look enough to be recognizable; exact styling
  is polish, not gated by AC.
- **No Ctrl-C handling inside the editor** beyond standard textarea behavior (Ctrl-C is the terminal's
  abort; in editor mode there's no running command). Confirm Ctrl-X is the only exit.

## Pre-PR Quality Gate (each slice)

1. `mutation-testing` skill — report on the slice's new code.
2. `refactoring` skill — assess.
3. `npm run typecheck` (`tsc -b`) + `npm run lint` pass.
4. The E2E runs green (added in slice 1); no duplicated unit coverage pushed into Playwright.

## Resume pointer (post-compaction)

- **What this plan is**: building `nano` (5.0), the prerequisite editor for Story 5 (cross-player home
  router NAT). Decisions locked above; Story 5's full design is in
  `plans/multiplayer-crossplayer-epic.md` → "Story 5 — resolved scope & decisions".
- **Key gap nano fills**: `executeLine` (`ui/state.ts`) currently DROPS `mode_change` results; there is
  no editor UI. `ModeChange.nano = { path, content }` already exists in `core/commands/types.ts`.
- **Build status (2026-06-17)**: the **complete nano editor is implemented + E2E-verified** in one
  coherent PR (effectively slices 1+2 + the read-error guards from slice 3). New files
  `core/commands/nano.ts` (+test), `ui/screens/nano.tsx` (+test); edits to `ui/state.ts`
  (`editorMode` signal, `mode_change` branch in `executeLine`, `saveEditor`), `ui/screens/terminal.tsx`
  (the `<Show>` overlay), `core/commands/registry.ts` (register nano). Gates: typecheck + lint clean;
  full suite 1376/1376; `nano.ts` mutation 93.44% (only the 4 manual-example string survivors, accepted
  as metadata per project rules); live agent-browser E2E proved the full
  `nano → edit → Ctrl-O → Ctrl-X → cat` round-trip (create + overwrite + rm-delete) against
  `vercel dev` + Supabase.
- **ALL whole-story AC met (2026-06-17)**: the denied-save error display landed (`<Nano>` maps a failed
  `PatchResult` → `[ Error writing <path>: Permission denied | I/O error ]`, keeps the buffer, stays
  open; +2 component tests; full suite 1378/1378). The only thing NOT done is the **optional** "Save
  modified buffer?" Ctrl-X prompt — explicitly optional, never an AC. **5.0 is complete**: on merge of
  `feat/v2-nano-edit` (PR #256), delete this file and return to the epic for **Story 5.1** (router as a
  real journal-backed machine + player NAT; `nano /etc/iptables/rules.v4` now unblocked).

---

_Delete this file when 5.0 is complete (all slices merged). Then return to the epic and plan Story 5.1._
