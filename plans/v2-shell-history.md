# Plan: v2 Shell Command History (ArrowUp/Down recall)

**Branch**: feat/v2-shell-history
**Status**: Complete

## Why this plan exists

Legacy has terminal command history — ArrowUp/ArrowDown walk through previously
entered commands (`src/hooks/useCommandHistory.ts` + `TerminalInput.tsx`). v2's
terminal input (`v2/src/ui/screens/terminal.tsx`) only handled `Enter`; there was
no recall. This brings the feature across, improving one behaviour over legacy.

## Locked decisions (2026-05-30)

1. **Bash-style draft restore** (improves on legacy). The first ArrowUp captures
   the half-typed line; ArrowDown past the newest entry restores it. Legacy wiped
   the draft to empty instead.
2. **Arrows only — no `history` command** (legacy parity). The recallable list is
   a UI affordance, not a printable command. Can be added later.
3. **In-memory only — resets on reload** (legacy parity). No localStorage; history
   is session-scoped UI state, not durable like the FS journal.
4. **No dedup / no max-size** (legacy parity). Blank/whitespace-only submissions
   are excluded; everything else is recorded verbatim.

## Architecture

- **Pure reducer** in `core/shell/commandHistory.ts` — framework-free, placed
  alongside `prompt.ts` (the established "pure shell logic the UI renders" pattern,
  which also puts it in Stryker's `src/core/**` mutation scope).
  - `navigateUp(history, nav, currentInput)` / `navigateDown(...)` → `{ nav, value }`.
  - `nav.index === -1` (HISTORY_IDLE) = at the live prompt; `nav.draft` is the
    line captured when navigation began. Up clamps at oldest; Down at the prompt
    is a no-op.
- **Signals** in `ui/state.ts` — `commandHistory` + `historyNav`, with
  `historyUp()`/`historyDown()` feeding the signals through the pure reducer.
  `runInput` records each non-blank line and resets the cursor; `resetTerminal`
  clears both.
- **Key handling** in `terminal.tsx` `onKeyDown` — ArrowUp/ArrowDown with
  `preventDefault` so the caret doesn't jump.

## Acceptance Criteria

- [x] ArrowUp recalls the previous command into the input.
- [x] Successive ArrowUp presses walk back to older commands, clamping at oldest.
- [x] ArrowDown walks forward; past the newest entry it restores the half-typed
      draft (bash-style) and returns to the live prompt.
- [x] Blank/whitespace-only submissions are not recorded in the recallable list.
- [x] History is in-memory and resets via `resetTerminal`.
- [x] Pure reducer at 100% mutation score (30/30 killed); UI seam covered by
      integration tests through the rendered `Terminal`.
- [x] `test:run` (480), `lint`, `build` all green; version bumped 0.10.0 → 0.11.0.

## Deferred / follow-ups

- Caret-to-end on recall (real shells place the cursor at the end of the recalled
  line; legacy didn't, and `preventDefault` already stops the jump-to-start).
- `history` command, dedup, max-size, and cross-reload persistence — all out of
  scope by decision; revisit if gameplay calls for them.
