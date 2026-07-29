# Plan: An editor save never destroys content the player was not shown

**Branch**: feat/overwrite-unseen-confirm (slice 2) · slice 1 shipped on feat/modified-since-open
**Status**: Slice 1 **merged** (#342, 61b1e07, v0.101.0) · Slice 2 **complete, awaiting commit approval**
**Version at start**: 0.100.0 → **0.101.0 at slice 1** → **0.102.0 at slice 2**

## Slice 2 — as built

`confirms`/`declines` predicates + a `confirmingOverwrite` signal in `Nano.tsx`; a branch ahead of the
two chords that owns the keyboard while the question stands; `readOnly` bound to it; an
`overwriteUnseen` option on `saveEditor` that omits `baseContent` (and therefore `base_hash`) entirely.
No server change, no new wire-check.

Four things the implementation forced that the plan did not anticipate:

- **The save has two call sites, not one shared helper with an optional argument.** `onSave(content)`
  and `onSave(content, { overwriteUnseen: true })` are separate calls because
  `toHaveBeenCalledWith(content)` fails against a call of `(content, undefined)` — routing both through
  one call site would have silently broken slice 1's assertion. The result handling is shared instead.
- **"Typing cannot reach the buffer" is not testable by typing.** jsdom does not perform the browser's
  text insertion, so `fireEvent.input` + assert-unchanged passes against NO implementation at all. The
  guarantee is asserted on the textarea's `readonly` state, which is what actually implements it.
- **The status line needed `role="status"` to make its ABSENCE observable.** Two mutants
  (`setStatus('')` → non-empty, and the signal's initial `''` → non-empty) are unkillable without a way
  to ask "is any status showing?". The role is correct ARIA for the element, so this is a real
  improvement rather than test plumbing — but it was driven by a mutant, and its own RED came from the
  positive twin (a successful save's status IS the status region).
- **The forced save is not privileged.** A `permission_denied` on the retry reports through the status
  line rather than re-asking; the question is only ever about unseen content.

Evidence: 2021 unit tests green; `tsc -b` and `eslint` clean; Stryker **96.70%** on `Nano.tsx` (88
killed, 3 survived, 0 no-coverage) and **92.31%** on `saveEditor`'s range (24 killed, 2 survived, 0
no-coverage, down from 4 uncovered). Eight survivors killed, five of them pre-existing gaps this work
surfaced: an ordinary keystroke was not pinned as neither-save-nor-exit, an emptied buffer reported one
line instead of zero, `no_session` had no wording test, and `saveEditor`'s early return was entirely
uncovered. Accepted survivors: `textarea?.focus()` (the ref is always set by `onMount`),
`spellcheck={false}` (presentational), and `SAVE_ERROR_REASON.modified_since_open` (unreachable by
design — predicted before RED), plus two pre-existing in `saveEditor` (`mode === null || false` needs a
non-null editor with no patch API, which cannot occur; and `createFsView`'s options object, which needs
a userType-dependent stat).

Browser E2E: three real players at v0.102.0, both halves confirmed — declined save left the outsider's
`nmap` showing B's forward, confirmed save removed it. Transcript in
`v2/docs/e2e-shared-network-verification.md` §6.

## Slice 1 — as built (merged)

Merged shape: `core/patches/contentHash.ts` (sha256 hex, shared by both ends); `base_hash` as an
optional upsert field; `rejectModifiedSinceOpen` in `handleUpsertPatch`, placed **after** the L1/L2
gates so an unauthorized caller cannot learn the file changed; `listPathPatches` as a path-scoped
dep (own-workstation writes bypass L2 entirely, so the machine-wide read was not available);
`baseContent` on `PatchApi.write` — the caller passes the content it was shown and the ADAPTER
fingerprints it, keeping the hash out of the UI layer; 409 → `modified_since_open` in
`toPatchResult`; `saveEditor` sending the opened content and advancing the base on success only.

Three things the implementation forced that the plan did not anticipate:

- **`PatchResult`'s error union is exhaustively mapped in five places** (`touch`, `mkdir`, `rm`,
  `sshd`, `runLine`), so adding a member made `tsc` demand a wording from each. They are NOT
  identical — `mkdir` says `service unavailable` where the others say `I/O error` — so the apparent
  duplication is per-command wording, not one piece of shared knowledge, and extracting it was
  assessed and rejected. All five now read `File changed on disk`; the outcome is unreachable there
  (those paths send no base) but the type is total.
- **`exactOptionalPropertyTypes` rejects `base_hash?: string`** against a zod-parsed payload whose
  optional is `string | undefined`. The helper's parameter type carries the explicit `| undefined`.
- **The chain-door fixture, not `remoteTarget()`, is the right test host for `rules.v4`** — a plain
  NPC machine host has no `/etc/iptables/` for the create to land in, so the write 403s on the
  container before the guard is ever consulted.

Evidence: 2003 unit tests green; `tsc -b` and `eslint` clean; Stryker **100%** on `upsertPatch.ts`
+ `contentHash.ts` (93 killed, 0 survived, 0 no-coverage) after killing two real gaps — an unscoped
`listPathPatches({})` query and an uncovered `data ?? []`; every changed line in `patchApi.ts` and
`saveEditor` killed, with the remaining survivors there all pre-existing (`nmapScanDeep`,
`fetchOwnPatches`, the `saveEditor` early-return guard). Wire-check `scripts/testModifiedSinceOpen.ts`
**7/7** against live `vercel dev` + supabase, including the real defect: a refused save left the
other writer's forwards intact. Regressions `testUpsertPatch` 12/12 and `testCrossPlayerWrite` 12/12.

## Goal

A `nano` save that would overwrite content another occupant wrote after the editor opened is
rejected by the server, and the player is asked before any deliberate overwrite.

## Background — the defect, and why it needs a decision

Found live at v0.99.0 (the E2E runbook's Act 4), reproduced end to end on a shared AP gateway:

```
B (on the gateway):  nano rules.v4 → append `forward 4444 to <B>:22` → ^O ^X → cat shows 3 forwards
A (session opened BEFORE that write):  nano rules.v4 → buffer holds only 2 forwards
A:                   append a comment → ^O ^X
C (outsider):        nmap <public IP> → 22, 2222, 3333.   B's 4444 is GONE from the world.
```

A session standing on a foreign machine fetches that machine's journal on the hop and refetches
after its **own** writes. Nothing else invalidates it — the `patches-changed` sync channel is
workstation-scoped — so a player on a shared gateway never learns another occupant wrote to it.
`nano` then saves the **whole buffer**, and last-writer-wins replay drops the newer rules.

A fresh `ssh` hop refreshes the view; repeated reads inside the existing session do not. Unlike the
v0.98.0 hop race, this does **not** self-heal. Full repro + journal rows:
`v2/docs/e2e-shared-network-verification.md` §6.

## Decisions (resolved by `grill-me`, 2026-07-28 — do not re-open while implementing)

1. **The promise: you can clobber another occupant's file, but only deliberately, never blindly.**
   Last-writer-wins stays the world model — that is what `iptables-restore` does. The bug is the
   invisibility, not the contest. This rules out line-merge and per-writer replay layering: an
   attacker must remain able to *remove* a defender's forward.
2. **The guarantee lives on the server**, not in the client. A client-side check still lets two
   simultaneously-open editors clobber each other, and a client-enforced invariant in a
   server-authoritative game is no invariant at all — least of all in this game.
3. **The base is a content hash**, not a revision timestamp. The editor already holds the content it
   opened with, so this needs no `updated_at` plumbing through `listPatches` → journal → editor, and
   it says exactly what the promise says: unseen **content**. A no-op rewrite by another occupant
   does not falsely reject.
4. **The failure mode is nano's own y/n confirm** — real GNU nano asks *"File was modified since you
   opened it, continue saving? (y/n)"*. `n` keeps the buffer, `y` overwrites deliberately.
5. **Editor saves only.** `>`, `touch`, `apt`, `sshd` and `rm` never showed the player content, and
   `>` genuinely *means* truncate-and-replace. They stay unconditional — by construction, not by a
   special case: an absent `base_hash` is an unconditional write.
6. **All machines, no own-vs-foreign branch.** Cheaper (no branch), and a cross-player attacker
   writing to your own box is precisely the case most worth guarding. It also closes the documented
   own-box cross-tab editor race as a side effect.
7. **Name: `modified_since_open`** — named for the outcome in the tool's voice, like its
   `permission_denied` and `network_error` siblings. "Stale base" stays the *design* phrase for the
   mechanism in prose; it is not an identifier.

**Explicitly not in this work:** an editor-open refetch (rejects will be routine, not rare — accepted);
a machine-scoped invalidation channel (needs Supabase Realtime + a publish-authorization model that
does not exist); `echo x > rules.v4` as a wipe vector (deliberate by nature — goes to the backlog);
`^X` after a rejected save still discarding the buffer silently (pre-existing, untouched).

## The server rule, specified

`newestFor(machine_id, path)` = the **last element of `orderPatchesForReplay(rows for that path)`** —
`updated_at` then `writer_key` as the same-instant tiebreak.

| Case | Verdict |
|---|---|
| `base_hash` absent | **accept** — unconditional write (today's behaviour; also the force path) |
| no rows for the path | **accept** — nobody has written since generation, so nothing is unseen |
| newest row `content === null` (tombstone) and `is_new` is true | **accept** — both agree the file is absent |
| newest row `content === null` (tombstone), `is_new` absent | **reject** — it was deleted under the editor |
| otherwise | **accept** iff `sha256(newest.content) === base_hash`, else **reject** |

Rejection is `409 { error: 'modified_since_open' }`.

**Why "no rows → accept" is sound:** no rows means nothing has been written to that path since world
generation, and the base FS is deterministic and identical for every viewer. The server cannot see
the base FS and does not need to — there is no unseen *write* to protect against.

**Why the newest row must come from `orderPatchesForReplay` and not `max(updated_at)`:** that
function is what the read path uses to decide which row wins, including its `writer_key` tiebreak for
the same-instant case. A hand-rolled "latest timestamp" here could compare against a different row
than the one the player was actually shown, turning the guard into a source of false rejects.

## Load-bearing facts (verified 2026-07-28 — do not re-derive)

- Rows are keyed `(writer_key, machine_id, path)`, so a co-occupant's content is **shadowed at
  replay, not deleted** from the table. The loser's row survives.
- `editorMode()` is `{ path, content }` where `content` is what the editor **opened with**
  (`ui/state.ts:198`, set at `:904`); `saveEditor` reads it at `:618`. No new plumbing needed.
- `sha256` from `@noble/hashes/sha2.js` + `bytesToHex` from `core/identity/hex` is the established
  hashing idiom (`core/identity/workstation.ts:18-23`, `core/network/wifi.ts`). No new dependency.
- `readFilter.ts` **prunes nodes and never alters surviving content** (`:39`), so a foreign save's
  hash compares cleanly against the row the served tree was built from.
- **Own-box saves bypass L2 entirely** (`upsertPatch.ts:109-110` — `access.session` is null there),
  so `listMachinePatches` is *not* already on that path. The check needs its own dep. Scope it to a
  single `(machine_id, path)` read rather than reusing the machine-wide L2 list.
- `toPatchResult` (`adapters/patchApi.ts:73-77`) currently maps 403 → `no_session` and everything
  else non-ok → `network_error`, so a 409 would silently read as "I/O error" without a new branch.
- `Nano.tsx` maps a failed save through `SAVE_ERROR_REASON` (`:31-35`) to its status line.

## Acceptance Criteria

- [x] A save whose opened content no longer matches what the world holds writes **nothing**, and the
      other occupant's content survives — proven in the journal by the slice 1 wire-check. The
      *visible from outside* half (their NAT forward still answers an outsider's `nmap`) is slice 2's
      browser E2E.
- [x] The player is told the file was modified since they opened it, naming the file.
- [x] A save whose opened content still matches succeeds exactly as before.
- [x] Two consecutive `^O` saves in one editor session both succeed (the base advances on save).
- [x] Confirming the prompt overwrites deliberately: the write lands and the other occupant's line is
      gone.
- [x] Declining the prompt leaves the buffer intact and writes nothing.
- [x] `>`, `touch`, `apt` and `sshd` writes are unaffected — they carry no base and are never rejected.
- [x] The guard applies on the player's own workstation and on a foreign machine alike, with no
      own-vs-foreign branch in the code.

## Slices

### Slice 1: A save is rejected when the file changed since the editor opened it — DONE (#342)

**Value**: A player editing a shared file can no longer silently destroy another occupant's rules —
the defect's actual harm. The overwrite path is not yet available, so a player who *wants* to
overwrite must `^X`, re-open and redo the edit; that is a usable checkpoint, not a broken state.
**Path**: `Nano` `^O` → `saveEditor` (hashes `editorMode().content`) → `PatchApi.write` → signed
envelope → `/api/patches` → `handleUpsertPatch` (newest-row comparison) → `409 modified_since_open`
→ `toPatchResult` → `PatchResult` → `Nano` status line. Nothing is persisted.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`. `refactoring` — assess
after green; expected `N/A` (this adds a guard, it does not restructure). `reduce-system-complexity`
— `N/A`, this adds mechanism deliberately.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (present and confirm before writing code):
- A save carrying a base hash that does not match the newest row for that path returns 409
  `modified_since_open` and persists nothing.
- A save carrying a matching base hash succeeds.
- A save carrying **no** base hash succeeds regardless of what the newest row holds.
- No rows for the path → the save succeeds.
- Newest row is a tombstone: succeeds when the save claims `is_new`, rejected otherwise.
- The rejection reaches nano as `modified_since_open` and its status line names the file.
- A second `^O` in the same editor session succeeds after the first one wrote.

**RED**: Behavior tests first, in this order —
1. `core/patches/upsertPatch.test.ts`: a base hash that does not match the newest row for the path
   returns 409 `modified_since_open` **and never calls `deps.upsertPatch`**. Per the conventions'
   absence-test warning, pair it with the matching-hash case asserting the upsert **did** happen with
   the same setup, so the rejection cannot pass by never reaching the code.
2. The table above, case by case: absent hash, no rows, tombstone + `is_new`, tombstone without.
3. `orderPatchesForReplay` selection: two rows with the **same `updated_at`** and different
   `writer_key` — the guard must compare against the one replay would land on.
4. `adapters/patchApi.test.ts`: a 409 response maps to `{ ok: false, error: 'modified_since_open' }`
   (currently it would fall through to `network_error`).
5. `ui/state.test.ts`: `saveEditor` sends the hash of the content the editor **opened with**, and
   after a successful save a second save sends the hash of what was just written.
6. `Nano` component test: a `modified_since_open` result renders a status line naming the file.

**GREEN**: `core/patches/contentHash.ts` (sha256 hex of a string, the `workstation.ts` idiom);
`base_hash` as an optional field on the upsert schema plus the rule table in `handleUpsertPatch`,
reading the path's rows through a new narrowly-scoped dep and selecting with `orderPatchesForReplay`;
`baseHash` as an optional `PatchApi.write` option threaded to `base_hash`; `modified_since_open` added
to the `PatchResult` error union and to `toPatchResult`'s 409 branch; `saveEditor` hashing
`editorMode().content`; a `SAVE_ERROR_REASON` entry.

**The base must advance on a successful save.** `^O` keeps the editor open, so `editorMode().content`
is still the *pre-save* content — a second `^O` would send a hash the server has already superseded
by the row it just wrote, and reject a save that nothing raced. On success, re-point `editorMode` at
the content just written. This is criterion 7 above and is easy to miss.

**MUTATE**: Run Stryker on `core/patches/`. The comparison is dense mutant territory — equality flip
on the hash compare, the `content === null` branch, the `is_new` condition, and the absent-`base_hash`
early accept. A survivor on the early accept would mean `>`/`touch` are not actually exercised through
the guard; add the case rather than accepting it.
**KILL MUTANTS**: Address survivors; ask before accepting any as equivalent.
**REFACTOR**: Assess; expected `N/A`.

**Wire-check** (mandatory — `api/` is not typechecked or unit-tested locally):
`v2/scripts/testModifiedSinceOpen.ts`, run as
`npx dotenv -e .env.development.local -- npx tsx scripts/testModifiedSinceOpen.ts` from `v2/`. It must
seed two writers' rows on one machine/path via the service-role client, then drive the real endpoint:
a stale-hash save gets 409 and leaves the table unchanged; a matching-hash save gets 200; a
no-hash save gets 200. Clean up after itself.

**Done when**: all criteria met, `npm run typecheck` and `npm run lint` pass, the wire-check exits 0,
the version is bumped in `v2/package.json` + `v2/package-lock.json` (0.101.0), and the human approves
the commit.

### Slice 2: The player can confirm the overwrite and clobber deliberately

**Value**: Restores the deliberate-clobber path the promise preserves — an attacker rewriting a
defender's rules is a designed game action, and after this slice it costs one informed keystroke
instead of an exit-and-retype.
**Path**: `Nano` `^O` → rejected as in slice 1 → status line asks `(y/n)` → `y` re-sends the same
buffer **without** the base hash → the unconditional write path already accepted by the server →
persisted, other occupant's line gone. `n` → status clears, buffer intact, nothing written.
**Class**: Behavior change.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`. `refactoring` — assess.
**Reduction program**: `N/A`.
**Transition/terminal evidence**: `N/A`.

**Acceptance criteria** (confirmed 2026-07-29 — the three open calls are resolved below):
- A rejected save puts nano into a confirm state reading **`File was modified since you opened it,
  continue saving? (y/n)`** — real GNU nano's wording, **without** the path. The header bar names the
  file permanently and only one file is ever open, so repeating it is noise. (This supersedes the
  earlier draft of this criterion, which named the path and contradicted decision 4.)
- **The confirm replaces the error status line**; the two are never shown together. One message, as
  real nano does. Consequence to expect, not to fix: `SAVE_ERROR_REASON.modified_since_open` becomes
  unreachable through `^O`, since a forced save carries no base and cannot be refused for that reason.
  It stays in the map because the `Record` is exhaustive over the union, and its wording — shipped one
  slice ago — is effectively superseded here.
- `y` **or `Y`** re-sends the SAME buffer with the force option; the write lands; the confirm clears;
  the status reads `[ Wrote N lines ]`; the base advances to what was just written, so an immediate
  second `^O` is not refused against the row this save created.
- `n`, **`N`, `Esc` or `^C`** clears the confirm, writes nothing, and leaves the buffer byte-identical.
  Any other key leaves the confirm up.
- While the confirm is up, ordinary typing does not reach the buffer, `^X` does not exit, and `^O`
  does not re-fire the save.
- `saveEditor` with the force option omits `base_hash` **entirely** — not an empty string, which the
  server would compare and reject.
- A forced save that fails for a different reason (permission, network) reports through the ordinary
  status line, not the confirm.
- No server change: the forced save is the existing no-hash request.

**RED**: `Nano` component tests (jsdom + `@solidjs/testing-library`, **not** Browser Mode) — a
`modified_since_open` result renders the confirm **and no error status line**; `y` calls `onSave` a
second time with the force option and the same buffer; `n` calls it not at all and leaves the buffer
intact; the uppercase and `Esc`/`^C` answers; an unrecognised key leaves the confirm up; typing, `^X`
and `^O` are captured while it is up. Plus `ui/state.test.ts`: `saveEditor` with the force option
omits the base hash entirely.

Per the conventions' absence-test warning, every "does not happen" here (`n` writes nothing; typing
does not reach the buffer) needs its positive twin on the same setup, or it passes by never arriving
at the code.
**GREEN**: A confirm signal local to `Nano.tsx`; a key handler branch ahead of the chords; an
`overwriteUnseen` option on `saveEditor` that omits `base_hash`.
**MUTATE**: Run Stryker on the touched UI/state modules. Expect survivors on presentational strings —
accept those; a survivor on the *branch* that decides whether typing reaches the buffer is real.
**KILL MUTANTS**: Address survivors; ask before accepting any as equivalent.
**REFACTOR**: Assess; the key handler grows a third branch — check it still reads as three chords and
not a state machine.

**Browser E2E** (this is the closing proof — the confirm is keyboard-and-editor behaviour Vitest
cannot reach, which is exactly what E2E is reserved for here). Load the `v2-e2e` skill first, then
re-run the runbook's §6 repro: two occupants root on one AP gateway, B appends a forward, A saves a
stale buffer → **A is asked**; A declines → an outsider's `nmap` of the public IP still shows B's
port. Then A saves again and confirms → B's port is gone, deliberately.

**Docs** (fold into this PR, since this is where the defect closes):
- `v2/docs/e2e-shared-network-verification.md` §6 — OPEN → FIXED, keeping the repro and recording
  what the guard does; update the failure-table row that currently says "do NOT save an editor over it".
- `v2/docs/conventions-and-gotchas.md` §9 — strike the open backlog item, add the as-built to §1, and
  **add the `echo x > rules.v4` wipe vector as a new deferred item** so it is not lost.
- `plans/multiplayer-crossplayer-epic.md` — retire candidate 1 from "Next action", leaving #6.

**Done when**: all criteria met, typecheck + lint pass, the browser run confirms both halves, the
version is bumped (0.102.0), and the human approves the commit.

## Pre-PR Quality Gate

Per PR: mutation evidence (or a reviewed `N/A` with proportionate alternate evidence);
refactoring assessment; `npm run typecheck` + `npm run lint` from `v2/`; version bumped in both
`package.json` and `package-lock.json` (`npm install --package-lock-only`); slice 1's wire-check
exits 0 against `vercel dev` + local supabase; no Story/Slice/decision tags and no `plans/` references
in committed code or test comments.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
