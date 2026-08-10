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

## Measured baseline (recounted 2026-08-09 at `624a65e`)

The diagnosis said 36 builder closures. **The real figure is 43** — the first count matched only 12
builder names and missed the 13th plus the closures whose signature wraps onto its own line. The
corrected numbers are below; both gates use this count, so before and after stay like-for-like.

| | baseline |
|---|---|
| dep-builder closures | **43** |
| distinct queries behind them | **13** |
| copies that are pure duplicates | **30** |
| `console.error` call sites | **45** |
| spellings of the journal `select` list | **6** |
| whole file | **770 lines / 635 code-only** |

Counting method: `const <name> = async` at any indent, whose body is a supabase query builder passed
as a handler dependency. Code-only strips blank and comment lines. Re-run the same method for the
mechanism gate.

The 13 distinct queries: `findPatches` ×6, `readAuthLog` ×7, `upsertPatch` ×7, `insertSession` ×6,
`listOccupantsByEssid` ×3, `listLeasesByEssid` ×3, `findNetworkByPublicIp` ×2,
`findHomeNetworkByOwnerKey` ×2, `findActiveSession` ×2, `listPathPatches` ×2, and one each of
`listSessions`, `endSession`, `findOccupantWorkstationByMachineId`.

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

## As built

Ten module-scope factories, each owning one query, plus a single `logFailure`. Three single-use
builders (`listSessions`, `endSession`, `findOccupantWorkstationByMachineId`) stayed inline where
they are used — they had nothing to deduplicate, and hoisting them would have relocated mechanism
rather than removed it.

```ts
const findPatchesVia =
  ({ supabase, label }: QuerySpec) =>
  async ({ machine_id }: { machine_id: string }) => { /* the one spelling */ };
```

**The labels survived intact**, all 45 of them. They are the only thing in a line that says which of
the ten actions failed, so they became an argument rather than a casualty. `logFailure` reassembles
the exact former string as `` `[sessions] ${label} error:` ``.

Two decisions worth recording, because both replaced a cast or a generic with something simpler:

- **`insertSessionVia` takes a union**, `SessionRow | AuthSessionRow | SuSessionRow`, not a type
  parameter. A generic `Row` cannot flow into supabase's `insert` (it rejects an unconstrained type
  argument), and a function accepting the union is assignable to each handler's narrower dep by
  ordinary parameter contravariance — so the union needs no cast and names exactly what this
  endpoint persists.
- **`listOccupantsByEssidVia` stayed generic in its row type.** `NatOccupantRow` and
  `OccupantConnectRow` are structurally identical, but they belong to different core modules and
  merging them is a `src/core/` change this slice deliberately excluded. The caller names the
  projection it expects, so the cast is visible at the call site instead of silently reinterpreting.

**Realized same-scope delta** (same counting method as the baseline table):

| | before | after |
|---|---|---|
| dep-builder declarations | 43 | **13** (10 factories + 3 single-use) |
| `console.error` call sites | 45 | **1** |
| journal `select` spellings | 6 | **1** |
| `upsert` spellings | 2 | **1** |
| whole file | 770 / 635 code-only | **547 / 400 code-only** |

Control flow unchanged: ten action branches before and after. No new state, caches, queues or locks.
New mechanism is one helper (`logFailure`) and two type aliases (`QuerySpec`, `PersistedSessionRow`),
each mapping to duplication it replaces. Nothing under `src/core/` changed, so the pure handlers and
their 2355 unit tests see nothing.

## Preservation evidence

**Mutation testing: `N/A`, by configuration.** `stryker.config.json` mutates `src/core/**/*.ts` only;
`api/` is outside that scope by design, since its correctness is a live-schema property that fakes
cannot establish. Nothing under `src/core/` changed. Proportionate alternate evidence took its place:

1. **Live wire-checks** — the whole risk of the slice, since `tsc` cannot see a column name.
   Ten of twelve pass; the two failures are pre-existing (below). Covering every action touched
   meant adding `testGatewayBrickLanAlive` and `testRouterBrick` to the planned list — the plan
   omitted `authCreateSession` (own-LAN ssh), which is one of the two plain-`upsert` sites.
2. **Log-label equivalence** — all 45 emit points extracted from both revisions and compared as
   multisets: none missing, none added.
3. **Dep-key equivalence** — the dependency object handed to each of the ten `handleX` calls parsed
   from both revisions; all ten key sets identical.
4. **Schema equivalence for the `upsert` collapse** — `20260614130000_patches_shared_journal.sql`
   makes the `patches` PK exactly `(machine_id, path, writer_key)`, and no competing unique index
   exists, so PostgREST's default conflict target and the explicit one are the same target.
5. `npx vitest run` 2355/2355, `npm run typecheck`, `npm run lint`, `npm run build` — all green.

**No version bump** — behaviour-preserving, matching `3af0b92`, the last refactor-only PR.

### Pre-existing failures, not caused by this slice

`testRouterBrick` (6/10) and `testCrossPlayerRouter` (7/8) fail **identically with and without this
change** — verified by stashing the change and re-running both, then diffing the verdict sets, which
are byte-identical. They are recorded green in `multiplayer-crossplayer-epic.md` (9/9 and 8/8), so
something regressed on `main` before this branch.

Both failures centre on a published NAT forward not appearing: `resolvePublicScan` returns 200 with
`ports=[]`, and the `:2222` login then 404s. That is `api/network.ts`, not this endpoint.
`testSharedApForwards` passes, so it is not a blanket forwards breakage. **This wants its own
diagnosis before D2.4 slice 3**, which builds directly on the forward path.

## Gates

**Behavior gate: PASS** — every wire-check that passes on `main` still passes; the two that fail,
fail identically; unit/type/lint/build green; no response body, status code, or log label changed.

**Mechanism gate: PASS** — recounted with the baseline's method: 43 → 13 declarations, 30 duplicate
copies gone rather than relocated, no call site grew, no `src/core/` type changed. Total ownership
fell: one journal column list instead of six.

There was **no temporary bridge**, so there is nothing to schedule for removal.

## Deliberately out of scope

- **`api/patches.ts` (3 more `findPatches`) and `api/network.ts` (4 more).** Three files is three
  times the wire-check surface, and sharing across them needs that structural decision above. Revisit
  once this slice proves the shape.
- Any change to routing, the noop nonce store, or the pure handlers.

---
*Reduction ledger + plan. Delete on close-out; fold the as-built into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md).*
