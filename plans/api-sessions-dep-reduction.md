# Plan: one spelling per query in `api/sessions.ts`

**Branch**: `refactor/one-spelling-per-query`, cut from `main` at `624a65e`.
**Status**: **Active** — authorized 2026-08-09 to land *before* D2.4 slice 3, so slice 3 adds its
dep builders to the collapsed shape rather than adding a tenth copy to the old one.
**Class**: terminal reduction (single slice, within the selected file).
**Skill**: load `reduce-system-complexity`; this file IS the conservation ledger.

## Why this exists

`api/sessions.ts` builds its supabase dependencies inline in each of 9 signed-action blocks. Every
new seam adds another copy — D2.4 slice 2 alone added nine — and the file is now **half dep
builders**. The cost that matters is not length: it is that **the journal column list has six
spellings**, and `tsc` cannot see a column name. One drifting `select` ships green through every
local gate and is caught only by the one wire-check that happens to cover that action.

## Measured baseline (2026-08-09, at `9b431d7`)

| | |
|---|---|
| dep-builder closures | **36** |
| lines they occupy | **391 of 770 (50%)** |
| substantive variants once `console.error` labels are normalised | **13** |
| copies that are pure duplicates | **23** |
| spellings of the journal `select` list | **6** here, ~13 across `api/` |

Counting method: match `const <name> = async` for the 12 builder names, take each block to its
matching `};` at the same indent, strip blank/comment lines, normalise the `console.error` label and
the `…Public` binding suffix, then group. Re-run the same method for the mechanism gate.

**Only three builders genuinely differ**, and none blocks the work:

1. `insertSession` — two different row types (`SessionRow` vs `AuthSessionRow`). Real, type-level.
2. `listOccupantsByEssid` — identical query and identical columns, two different casts
   (`OccupantConnectRow[]` vs `NatOccupantRow[]`). Type-level.
3. `upsertPatch` — with and without `onConflict: 'machine_id,path,writer_key'`. **Equivalent**, and
   worth understanding rather than assuming: PostgREST defaults its conflict target to the primary
   key, and `20260614130000_patches_shared_journal.sql` made the `patches` PK exactly that triple.
   Two spellings of one behaviour is the defect — collapse to the explicit form, which documents the
   dependency instead of relying on it silently.

## The constraint that decides the shape

**Every `api/*.ts` is a Vercel endpoint.** There is no `vercel.json`, and `api/` holds exactly
`network.ts`, `patches.ts`, `sessions.ts` — three files, three functions. A new `api/deps.ts` would
publish a bogus serverless function.

So the factories go at **module scope inside `api/sessions.ts`**. Zero new modules. A genuinely
shared module would need a home outside `api/`, which is a structural decision that should wait for
a second consumer to justify it.

## What to build

One factory per distinct query, taking the client and the operator label:

```ts
const findPatchesVia = (supabase: SupabaseClient, label: string) =>
  async ({ machine_id }: { machine_id: string }) => { /* the one spelling */ };
```

**Keep the labels.** They are the only way to tell which of nine actions failed in one function log,
so they become an argument rather than a casualty. Losing them would be exporting burden to whoever
next reads a production log.

**Expected same-scope delta**: 36 → ~10 declarations; ~391 → ~120 lines; 6 → 1 spelling of the
journal column list; 2 → 1 upsert spelling. Control flow unchanged (9 action branches, still 9).
No new state, caches, queues or locks. `src/core/` dep *types* unchanged, so the pure handlers and
their 2355 unit tests see nothing.

## Preservation obligations — the whole risk of this slice

**All 9 wire-checks must run live**, because `tsc` cannot see the DB schema and the unit tests inject
fakes. This is the one thing that makes the slice risky at all, and the one thing that makes it safe.

- `testHydraOwnLan.ts`, `testHydraCrossPlayer.ts`, `testCrossPlayerRouter.ts`,
  `testSharedApForwards.ts`, `testSameLanConnect.ts`, `testInnerGatewayReach.ts`,
  `testDeepChainReach.ts`, `testCrossPlayerSuElevate.ts`, `testSharedJournal.ts`
  (confirm the list against the actions actually touched before starting).
- Bring the stack up per `v2/docs/conventions-and-gotchas.md` §6 — including the WinNAT port remap,
  which has now been needed on two consecutive sessions.
- Plus `npx vitest run`, `npm run typecheck`, `npm run lint`.

**No version bump** — behaviour-preserving, matching `3af0b92`, the last refactor-only PR.

## Gates

**Behavior gate**: every wire-check green live; unit/type/lint green; no response body, status code
or log label changed.

**Mechanism gate**: recount the table above with the same method; confirm no call site grew, no
`src/core/` type changed, and the 23 duplicate copies are gone rather than relocated.

Both must pass before claiming realized reduction. There is **no temporary bridge** in this plan, so
there is nothing to schedule for removal.

## Deliberately out of scope

- **`api/patches.ts` (3 more `findPatches`) and `api/network.ts` (4 more).** Three files is three
  times the wire-check surface, and sharing across them needs that structural decision above. Revisit
  once this slice proves the shape.
- Any change to routing, the noop nonce store, or the pure handlers.

---
*Reduction ledger + plan. Delete on close-out; fold the as-built into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md).*
