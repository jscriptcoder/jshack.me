# Plan: Story 3 — B modifies A's filesystem (cross-player WRITE + the shared-journal PK flip)

**Branch**: feat/v2-crossplayer-write (per-slice branches below)
**Status**: **Active — Slice 1 ✅ SHIPPED (#242, `d45e98d`, v0.60.0); Slice 2 IMPLEMENTED on
`feat/v2-crossplayer-write-2` (v0.61.0, awaiting commit→PR→merge); NEXT: Slice 3**
**Parent epic**: `plans/multiplayer-crossplayer-epic.md` (Story 3 row)
**Authored**: 2026-06-14 (via `planning`, after grounding the v2 read+write paths)

> **RESUME POINTER (post-compaction — read this first).** Story 2 (cross-player READ) shipped
> (#237–#240). **Slice 1 (PK flip) ✅ MERGED** (#242, `d45e98d`, v0.60.0). **Slice 2 (first
> cross-player guest WRITE) IMPLEMENTED** on branch `feat/v2-crossplayer-write-2` (v0.61.0,
> awaiting commit→PR→merge): L2 (`remoteWritePermission.ts`) gained the **owner-materialized
> registry branch (D6)** — `enforceRemoteWriteL2` now resolves the target FS as (1) an NPC host
> on the caller's LAN (`hostForMachineId`, pure), else (2) a registered foreign workstation via
> the new `findRegistryByMachineId` dep → `buildRegisteredWorkstationFs` (exported helper, also
> adopted by `resolveCrossPlayerFs.materialize` for D6 single-source), else (3) fail closed →
> `permission_denied`; then `createFsView(tree,{userType:session.userType}).canWrite`. Dep
> threaded through `upsertPatch`+`removePatch`+`api/patches.ts`. Client: `wrapWithRefetch`
> (`ui/state.ts`) now calls `refreshServedRoot()` after a successful write so B's cross-player
> view shows its own change (self-guards: no-op on own box). 100% mut on new core
> (`remoteWritePermission` 40/40, read handler 62/62); suite 1295 green; **6/6 live wire**
> (`scripts/testCrossPlayerWrite.ts`) + read 7/7 + journal 4/4. **agent-browser two-identity UI
> E2E DEFERRED by owner choice** (the one untested line is the client `refreshServedRoot` glue —
> this project verifies `state.ts` reactive glue via agent-browser, not vitest).
>
> **NEXT = Slice 3 (cross-player write permission BOUNDARY).** Note Slice 2 already landed the
> deny GATE (the walker `canWrite` runs at the session tier on A's owner-materialized tree, and
> a guest-denied-on-`/etc/passwd` case is already tested + wire-proven). Slice 3 EXPANDS the
> boundary coverage: parent-dir traversal denials, `/home/<A>` denials, the **divergence proof**
> (a path writable on the CALLER's own box but NOT on A's is still denied → proves it
> materializes A's tree, not the caller's), and "wire leaks nothing on deny / no row written"
> across path types. Mostly additional tests over the existing branch; little/no new production
> code expected. Load `tdd`/`testing`/`mutation-testing`/`refactoring`; branch
> `feat/v2-crossplayer-write-3`; bump v0.61.0 → 0.62.0. Decisions D1–D8, the call-site map, the
> **Grounding reference**, and the **Commands & infra** block remain valid below.

## Goal

A second identity (B) holding a **guest** cross-player session on A's workstation can
create/edit/delete a file on A's box; the change persists to a **shared, chronologically-
ordered journal** keyed by the machine — so A (and every other authorized viewer) sees
B's change, attributed to B, combined in time order with everyone else's edits. L1
(session) + L2 (permission walker at the owner-materialized tier) are server-enforced.
su-to-root and bricking stay **Story 4**.

## The crux (why this story exists)

Today the READ and WRITE paths key the `patches` table **differently**, so cross-player
writes are **orphans**:

- **Story 2 READ** materializes A's box from the OWNER's rows: `player_key = owner_key`,
  `machine_id = A` (`api/network.ts:148-162`, `resolveCrossPlayerFs.ts`).
- **The WRITE path** stamps `player_key = the caller (B)` (`upsertPatch.ts:101-110`; PK
  `(player_key, machine_id, path)` — `20260529000000_patches.sql:19-31`).

So if B writes to A's box, the row lands at `(B, A_machine, path)` — but A's box and the
cross-player read only ever look at `(A, A_machine, …)`. **B's write is invisible to A and
to B's own cross-player view.** Story 3 makes cross-player writes converge on one shared
record so all viewers + the owner see them. (This is the gap Story 2 explicitly deferred.)

## Key design decisions (LOCKED — owner-confirmed 2026-06-14)

- **D1 — Shared, chronologically-ordered journal. New `patches` PK = `(machine_id, path,
  writer_key)`.** Multiple writers' edits to the same file **coexist** (one row per
  *(file, writer)*); materialization replays ALL rows for a machine in **chronological
  order** so later writes win and everyone sees everyone's changes, attributed. `writer_key`
  = the player who wrote that row (provenance), server-stamped from the verified envelope.
  Bounded (one row per writer per file; a re-edit upserts that writer's row and re-stamps
  its timestamp → moves it to "latest"). NOT a single-row last-write-wins (that loses
  provenance + the journal), NOT a full every-edit append-only log (unbounded gold-plating;
  `feedback_shared_world_mutation_fine`).
- **D2 — Ordering uses a SERVER-stamped timestamp, never client-supplied.** Replay orders by
  the DB-stamped `updated_at` (bumped server-side on every write, e.g. a `BEFORE UPDATE`
  trigger), tiebroken deterministically by `writer_key`. A client cannot forge its write to
  appear earlier/later. Aligns with this project's server-authoritative-time anti-cheat
  posture (game time is already server-stamped — `project_v2_session_api`, ADR D13).
- **D3 — Ordering happens in `core/`, not SQL.** The read handler sorts rows by
  `(updated_at, writer_key)` before `applyPatches`, so the chronological-combine rule is
  unit-tested + mutation-covered (the SQL may also `ORDER BY` as an optimization, but core
  re-sorts deterministically — `api/*` is not typechecked/tested locally).
- **D4 — `machine_id` already encodes the owner** (suffix = `sha256('ed25519:'+ownerKey)[0..8]`,
  `computeWorkstationId`), and NPC LAN hosts have **viewer-distinct** machine_ids by
  construction (`hostMachineId(host, essid)` over a per-viewer-generated host). So
  `(machine_id, …)` is a sound shared key: it does NOT merge per-viewer NPC boxes, and no
  separate `owner_key` column is needed in the row. The existing `owner` column stays (that's
  the in-game *file* owner for `ls -l` — a different thing from `writer_key`).
- **D5 — Destructive migration.** Drop + recreate `patches` with the new PK + `writer_key`.
  No live players (`feedback_no_backward_compat`); old per-viewer rows would collide under the
  new key anyway. Zero-risk pre-launch. (Rule sunsets at multiplayer announce.)
- **D6 — Cross-player L2 regenerates from the OWNER's identity via the registry.** For a
  foreign workstation, `buildRemoteHostFs(caller)` / `hostForMachineId(caller,…)` return null
  (it's not on the caller's LAN). The write's L2 must rebuild A's tree the way the READ does —
  `buildWorkstationBaseFsFromIdentity` from the registry row + A's owner journal — then run the
  shared walker `canWrite` at the **server session's** `userType`. Single source of truth with
  the read; no client/server drift.
- **D7 — Slice the flip as a regression-verified enabler first.** The flip touches every
  read/write call site; Slice 1 lands it behavior-preserving (verified by the full suite + the
  live E2E loop + Story-2 wire check still green), then Slices 2-4 add the new cross-player
  write behaviors on top. Smaller, reviewable, revertable PRs.
- **D8 — Story 3 ceiling = guest writes.** Guest writes a guest/world-writable path (`/tmp` is
  `write:['root','user','guest']`); guest is denied off the guest-writable set; guest can `rm`
  a guest-writable file. **su-to-root + bricking = Story 4** (uses the obtained root password).

## Call sites the flip re-keys (grep-confirmed — `feedback_grep_all_call_sites`)

All move from `player_key`-scoped to `machine_id`-scoped reads + `writer_key`-stamped writes:

- own-box read `fetchOwnPatches` (`adapters/patchApi.ts:186-196`) → machine_id-scoped.
- `listPatches` endpoint (`api/patches.ts:142-150`).
- `listMachinePatches` for L2 (`api/patches.ts:110-139`).
- cross-player read `findPatches` (`api/network.ts:148-162`) → drop the `owner_key` scope,
  key on machine_id only (its rows ARE the machine's rows now).
- `removePatch` delete/tombstone keying (`api/patches.ts:161-187`, `removePatch.ts`).
- `appendAuthLog` read-modify-write (`api/patches.ts:204-214`, `appendAuthLog.ts`).
- `upsertPatch` row build (`upsertPatch.ts:101-110`) → stamp `writer_key = verified pubkey`.
- `appendMachineLog` / `nmapScan` system writes (`appendMachineLog.ts`, `api/patches.ts:241-247`).

## Grounding reference (so Slice 1 can start cold — verified 2026-06-14)

**Current `patches` schema** (`v2/supabase/migrations/20260529000000_patches.sql`) — to be
replaced by the flip:

```sql
CREATE TABLE patches (
  player_key  TEXT NOT NULL, machine_id TEXT NOT NULL, path TEXT NOT NULL,
  content TEXT,                 -- null = base-fs deletion marker (tombstone)
  owner TEXT NOT NULL,         -- in-game FILE owner (ls -l), NOT the player
  permissions JSONB, is_new BOOLEAN NOT NULL DEFAULT false,
  node_type TEXT NOT NULL DEFAULT 'file',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_key, machine_id, path)
);
ALTER TABLE patches ENABLE ROW LEVEL SECURITY;  -- NO policies: anon/authenticated denied; service_role only
```

**New schema (D1/D2/D5):** drop+recreate with `writer_key TEXT NOT NULL`, PK `(machine_id,
path, writer_key)`, `updated_at` bumped server-side on every write (a `BEFORE UPDATE` trigger
`SET updated_at = now()`). RLS unchanged (service_role only). No data migration.

**`applyPatches(base, patches)`** (`core/filesystem/applyPatches.ts`): folds the patch list
**left-to-right; last write per path wins**, so the **read must hand it rows pre-sorted by
`(updated_at asc, writer_key)`** (D3 — sort in core, not SQL). `Patch` shape =
`{ path, content: string|null, owner, permissions?, nodeType?: 'file'|'directory' }`. `content:
null` = tombstone; `nodeType:'directory'` = mkdir (no-op if path exists).

**L1 — `authorizeMachineAccess(publicKey, machineId, findActiveSession)`**
(`core/patches/authorizeMachineAccess.ts`): `isOwnWorkstation(machineId, publicKey)` → bypass
(`session:null`); else look up an active `sessions` row `(player_key=publicKey, machine_id)` →
`{ok, session:{userType, essid}}` or `403 no_session`. **Already works for cross-player** (B's
ssh session on A resolves). No change needed for the write's L1.

**L2 — `enforceRemoteWriteL2` / `isRemoteWriteAllowed`** (`core/patches/remoteWritePermission.ts`):
regenerates the host via `hostForMachineId(publicKey, essid, machineId)` + `buildRemoteHostFs` +
`applyPatches(prior)`, then `createFsView(tree,{userType}).canWrite(path)`. **⚠️ For a foreign
workstation `hostForMachineId(caller, essid, A_machine)` returns `null` → `isRemoteWriteAllowed`
returns `false` → `permission_denied`.** So cross-player writes are DENIED today — Slice 1 keeps
that (behavior-preserving); **Slice 2 adds the owner-materialized L2 branch (D6)** that resolves
A's owner via the registry and runs the walker against A's real tree at the session tier.

**The READ precedent to mirror for the write (D6)** —
`core/network/resolveCrossPlayerFs.ts` + `api/network.ts:110-171`: deps `findRegistryByMachineId`
(reverse-lookup `network_registry` by `workstation_machine_id` → `{owner_key,
workstation_username, workstation_root_hash}`), `findActiveSession`, `findPatches({player_key:
owner_key, machine_id})`; rebuild via `buildWorkstationBaseFsFromIdentity({ ownerKeyHex,
username, rootPasswordHash })`; filter via `core/patches/readFilter.ts`. **After the flip
`findPatches` keys on `machine_id` only** (owner_key scoping drops out — the machine's rows ARE
the owner's box now).

**Identity** (`core/identity/workstation.ts`): `computeWorkstationId(name, pubkeyHex)` returns
`name-<first 8 hex of sha256('ed25519:'+pubkeyHex)>`; `isOwnWorkstation(machineId, pubkey)`
matches that suffix. NPC LAN host ids = `hostMachineId(host, essid)` (viewer-distinct via the
per-viewer-generated host) → `(machine_id,…)` never merges NPC boxes.

**`network_registry`** (after Story 1+2): PK `public_ip`; `owner_key`, `workstation_machine_id`
(idx `20260614120000`), `router_machine_id`, `forward_table` JSONB, `essid`,
`workstation_username`, `workstation_machine_name`, `workstation_root_hash`, timestamps.

**Write endpoints** (`api/patches.ts`): actions `upsertPatch` (default; row build
`upsertPatch.ts:101-110` — **stamp `writer_key` here**), `removePatch` (`removePatch.ts` —
hard-delete if `is_new` else tombstone; Slice 4 → tombstone-always), `appendAuthLog`,
`nmapScan`. Client write = `adapters/patchApi.ts` (`write`/`mkdir`/`remove`), `machine_id` from
the active session, signed by the caller's identity. Own-box read = `fetchOwnPatches`
(`patchApi.ts:186-196`, `player_key=me` → re-key to `machine_id`).

## Commands & infra (v2 — run from `C:\Users\User\Projects\jshack.me\v2`)

- Tests (watch off): `npx vitest run [path]` · full suite `npx vitest run`
- Mutation (dev server DOWN): `npx stryker run --mutate src/<file>.ts`
- Lint (the format gate — **no Prettier in v2**): `npm run lint` · Build gate: `npm run build`
- Local Supabase: `npx supabase status` (URL `http://127.0.0.1:54421`; service key via status or
  `.env.development.local` — has `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`); migrations in
  `v2/supabase/migrations/`, apply with `npx supabase migration up --local` (or `db reset`).
- Vercel dev (api routes, :3100): `npm run vercel:dev` (backgrounds; confirm via curl — the
  `&`+bg wrapper reports "completed" but the port responds). Kill: find LISTENING pid on 3100,
  `taskkill //PID <pid> //F`. **Don't run Stryker while vercel:dev is up** (false survivors).
- Wire E2E: extend `scripts/testCrossPlayerRead.ts` pattern → a `testCrossPlayerWrite.ts` (seed
  two identities via service_role, drive `/api/patches`, assert the shared journal). Run:
  `npx dotenv -e .env.development.local -- npx tsx scripts/<f>.ts`.
- UI E2E: `agent-browser` (two identities; v2 has NO Playwright). `api/*` is NOT typechecked
  locally — keep handlers thin, logic in `core/`, verify via the live wire/UI check.

## Acceptance Criteria (Story-level)

- [ ] After the flip, **every existing behavior is unchanged**: own-box edits persist across
      reload; NPC-LAN ssh writes persist; the Story-2 cross-player read still passes 7/7; full
      suite + live E2E green. (Slice 1 regression.)
- [ ] Two writers' rows for the same `(machine_id, path)` materialize **combined in
      chronological order** (later server-stamped write wins; both rows preserved + attributed).
- [ ] B (guest cross-player session) writes `/tmp/<file>` on A's box → the row persists to A's
      shared journal (machine_id = A, `writer_key` = B); **A reloads and sees it**, and B's own
      cross-player view sees it too.
- [ ] B (guest) is **denied** writing a non-guest-writable path on A's box (e.g. `/etc/*`,
      `/home/*`) — L2 runs the walker against A's **owner-materialized** tree at B's
      server-session tier; the wire returns `403 permission_denied`, no row is written.
- [ ] B (guest) can `rm` a guest-writable file on A's box → a tombstone lands on the shared
      journal; A reloads and sees it gone; a later owner re-create wins (chronological).
- [ ] Every new pure unit at 100% mutation; cross-identity behavior proven via **agent-browser**
      two-identity UI + a scripted two-identity wire check (v2 has no Playwright).
- [ ] No root/su, no bricking (Story 4); no real iptables/multi-machine (Story 5).

## Slices

Every slice runs the full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR cycle. Before code on any
slice, load `tdd`, `testing`, `mutation-testing`, `refactoring`. Read `.claude/CLAUDE.md` + the
v2 gotchas (lint is the format gate; `api/*` not typechecked locally — keep it thin, logic in
`core/`; don't run Stryker with the dev server up). Squash-merge per slice; bump version on
feature slices.

---

### Slice 1: Flip `patches` to the shared chronological journal (enabler) — ✅ SHIPPED (#242, v0.60.0)

> Done: `orderPatchesForReplay` (100% mut); all patches-table handlers + api glue re-keyed to
> `writer_key`/machine-scope; migration `20260614130000_patches_shared_journal.sql` (PK trio +
> `BEFORE UPDATE` trigger). 1289 suite green, 100% mut on changed pure code, 28/28 live wire
> checks (`testSharedJournal` 4/4, `testUpsertPatch` 12/12, `testCrossPlayerRead` 7/7,
> `verifyPatchesRls` 5/5). Cross-player writes remain L2-denied (Slice 2 lifts that).

**Value**: Establishes the shared-journal storage model that every cross-player write depends
on, WITHOUT changing any observable behavior — a clean migration + mechanical re-key that
unblocks Slices 2-4 and is independently verifiable (this is a legitimate horizontal enabler
per the planning rules: it names the slice it unlocks, leaves the app deployable, and has
observable verification).
**Actor / trigger / outcome**: existing actors (own-box editor, NPC-LAN operator, cross-player
reader) — their flows are byte-for-byte unchanged; the new *capability* is that the machine's
journal now combines multiple writers' rows chronologically.
**Path**: destructive migration (drop+recreate `patches`, PK `(machine_id, path, writer_key)` +
`writer_key` column + `updated_at` bump trigger) → re-key ALL reads to machine_id-scope and sort
by `(updated_at, writer_key)` in `core/` before `applyPatches` → stamp `writer_key` on writes →
own-box/NPC/cross-player-read/L2-read/rm/list/auth-log all updated.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): (a) **regression** — full vitest suite green,
own-box edit persists across reload, NPC-LAN ssh write persists, Story-2 cross-player read wire
check still 7/7, live E2E loop intact; (b) **new capability** — given two rows for the same
`(machine_id, path)` with different `writer_key` + server `updated_at`, the materialization
(read handler) replays them in chronological order (later `updated_at` wins; equal → `writer_key`
tiebreak), proven by a pure core test; (c) writes stamp `writer_key` from the verified pubkey
(never a client claim); (d) the ordering key is the **server** `updated_at`, not anything client-
supplied (a forged client timestamp can't reorder).
**RED**: core materialization/sort test — a list of multi-writer rows (shuffled, distinct
`updated_at`) replays so the latest write to a path wins and both writers' rows are retained;
equal-`updated_at` tiebreak is deterministic. `resolveCrossPlayerFs` + own-box-read handler tests:
rows are sorted by `(updated_at, writer_key)` before `applyPatches` (mutator focus: the comparator
direction, the tiebreak, the asc/desc). `upsertPatch` test: the persisted row carries
`writer_key = verified pubkey`; a smuggled `writer_key`/`player_key` is refused.
**GREEN**: migration `…_patches_shared_journal.sql` (drop+recreate; PK trio; `writer_key TEXT NOT
NULL`; `BEFORE UPDATE` trigger bumping `updated_at = now()`); a small pure `orderPatchesForReplay`
(sort by `updated_at` asc, tiebreak `writer_key`); thread `updated_at`+`writer_key` through the
read projections + `OwnerPatchRow`/`Patch` mapping; re-key the call sites listed above; stamp
`writer_key` in `upsertPatch`.
**MUTATE**: Stryker on `orderPatchesForReplay` + the changed core handlers.
**KILL MUTANTS**: comparator/tiebreak/asc-desc, writer_key passthrough, refine survivors.
**REFACTOR**: if own-box and cross-player reads now share the materialize+sort sequence, unify in
one helper (assess; the read filter already exists from Story 2).
**Done when**: ACs met, 100% mutation on new pure code, full regression green (suite + live E2E +
Story-2 7/7), human approves commit.

---

### Slice 2: First cross-player guest WRITE — B writes A's box, A sees it (walking skeleton) — ✅ IMPLEMENTED (v0.61.0, awaiting merge)

> Done: L2 registry-fallback branch (D6) in `remoteWritePermission.ts` (`enforceRemoteWriteL2`
> NPC→registry→fail-closed; new `findRegistryByMachineId` dep + `RegistryWorkstation`/
> `FindRegistryByMachineId` types + exported `buildRegisteredWorkstationFs`); dep threaded
> through `upsertPatch`+`removePatch`+`api/patches.ts`; `resolveCrossPlayerFs.materialize`
> refactored to reuse `buildRegisteredWorkstationFs` (D6 single-source); client
> `wrapWithRefetch`→`refreshServedRoot()` after write (`ui/state.ts`). 100% mut
> (`remoteWritePermission` 40/40, read 62/62); 1295 suite green; tsc+lint clean; **6/6 live wire**
> (`scripts/testCrossPlayerWrite.ts`) + read 7/7 + journal 4/4. agent-browser two-identity UI
> E2E DEFERRED by owner choice (only the client `refreshServedRoot` glue line is unverified —
> that layer is agent-browser-verified in this project, not vitest). Slice 3 lifts the full
> deny-boundary coverage.

**Value**: The headline new behavior — the first time one player's change to another player's
machine actually persists and is seen. Proves the shared-journal write path end to end.
**Actor / trigger / outcome**: **B** (guest cross-player ssh session on A's box from Story 2b),
runs `touch /tmp/pwned` (or `echo … > /tmp/pwned`) → server writes to A's shared journal →
**A reloads and sees `/tmp/pwned`**; B's own cross-player view (Story-2 served root) shows it too.
**Path**: B's client write (`patchApi.write`, machine_id = A's `workstation_machine_id`, signed by
B) → `/api/patches` `upsertPatch` → L1 `authorizeMachineAccess` (B's active ssh session on A —
already works for remote) → **L2 cross-player branch (D6)**: resolve A's owner via registry by
machine_id → rebuild A's tree (`buildWorkstationBaseFsFromIdentity` + A's owner journal) → walker
`canWrite('/tmp/pwned')` at the **server session** `userType` (guest) → allowed (/tmp world-
writable) → upsert row `(A_machine, /tmp/pwned, writer_key=B)` with server `updated_at` → A's
own-box read (machine_id-scoped) + B's `resolveCrossPlayerFs` both replay it.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): B (guest session on A) writing `/tmp/<f>` →
`200`, a row persists keyed `(A_machine, path, B)` with `writer_key = B` and a server timestamp;
A's machine-scoped read includes it; B's cross-player read includes it; the client never claims a
tier (userType comes from B's server session); writing with no session → `403 no_session`; an
unregistered/foreign machine that isn't resolvable → the existing remote-miss shape.
**RED**: pure cross-player L2 resolver test — registered machine + guest session + guest-writable
path → allowed, regenerated from the OWNER's identity (prove with A's real username in the
materialized tree, not a caller regen); the write handler routes a foreign-workstation target to
the registry-based L2 (not `buildRemoteHostFs`); the persisted row carries `writer_key = B`,
`machine_id = A`. Mutator focus: the owner-resolve branch selector, the tier source (session not
client), the writer_key stamp.
**GREEN**: extend the write path with a cross-player branch — registry reverse-lookup (reuse
Story-2's resolver pieces) → owner-identity regen → shared walker `canWrite` at session tier →
upsert with `writer_key`; `api/patches.ts` wires the registry + owner-journal deps (thin).
**MUTATE**: Stryker on the cross-player L2 resolver + the write-handler branch.
**KILL MUTANTS**: owner-resolve, tier-source, allow/deny, writer_key survivors.
**REFACTOR**: factor the shared "resolve owner + materialize A's tree" step used by BOTH
`resolveCrossPlayerFs` (read) and this write path (assess; D6 single-source).
**Done when**: ACs met, 100% mutation, agent-browser two-identity (B `touch /tmp/pwned` on A's
box → A reloads → sees it) + scripted wire check (row keyed to B on A's machine; A's read sees
it), human approves commit.

---

### Slice 3: Cross-player write permission boundary — guest denied off the guest-writable set

**Value**: Closes the write boundary so a guest can't scribble anywhere on A's box — the
permission half of cross-player write, enforced server-side against A's REAL tree.
**Actor / trigger / outcome**: **B** (guest session on A) tries `touch /etc/x` or
`echo … > /home/<A>/x` (non-guest-writable) → **denied** (`403 permission_denied`); no row is
written; A's box is unchanged.
**Path**: same write path as Slice 2; the L2 walker (run against A's owner-materialized tree at
guest tier — D6) denies a path whose perms/parent-chain forbid guest write.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): B (guest) writing a non-guest-writable path on A's
box → `403 permission_denied`, **no** patches row created; the denial runs the shared walker
`canWrite` at the **server session** tier against A's owner-materialized tree (NOT the caller's
regen, NOT a client tier); a guest-writable path still succeeds (Slice 2 regression); the wire
leaks nothing about the denied path beyond the error.
**RED**: cross-player L2 test — guest + non-guest-writable target (e.g. perms `write:['root']`,
or a parent dir guest can't traverse) → denied; guest + guest-writable target → allowed; the tier
comes from the session row, not the payload; a path that's writable on the CALLER's own box but
not on A's is still denied (proves it materializes A's tree, not the caller's). Mutator focus:
the `canWrite` boundary (write bit, parent execute), the deny status/shape, the tier source.
**GREEN**: ensure the Slice-2 cross-player L2 branch returns the walker's deny verdict with the
correct status; no new endpoint — this is the deny path of the same resolver.
**MUTATE**: Stryker on the L2 deny path.
**KILL MUTANTS**: write-bit, parent-traverse, status-code, tier-source survivors.
**REFACTOR**: assess (likely none — reuses the shared walker).
**Done when**: ACs met, 100% mutation, agent-browser (B denied on `/etc`, allowed on `/tmp`) +
scripted wire check (no row on deny), human approves commit.

---

### Slice 4: Cross-player `rm` — B deletes a guest-writable file on A's box (tombstone on the journal)

**Value**: Completes "modify" with delete — and corrects delete semantics for the shared journal
(a delete must be a timestamped tombstone, so chronological replay handles "B deleted, then A
re-created" correctly).
**Actor / trigger / outcome**: **B** (guest session on A) runs `rm /tmp/<f>` (a guest-writable
file) → a tombstone row lands on A's shared journal → **A reloads and sees it gone**; if A later
re-creates the file, A's later write wins (file back).
**Path**: B's `rm` → `/api/patches` `removePatch` → L1 + cross-player L2 (guest can write the
parent) → **tombstone** row `(A_machine, path, writer_key=B, content=null)` with server
`updated_at` (NOT a hard delete — hard delete loses the "deleted at t" event and breaks multi-
writer chronological replay) → A's machine-scoped read replays the tombstone (latest → gone).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): B (guest) `rm`-ing a guest-writable file on A's box
→ a tombstone row keyed `(A_machine, path, B)` with `content=null` + server timestamp; A's read
materializes the file as **gone**; a subsequent owner write to the same path (later `updated_at`)
**wins** (file reappears) — proving chronological delete-then-recreate; `rm` of a non-guest-
writable path → `403 permission_denied`, no tombstone; `rm -r` tombstones descendants under the
writer.
**RED**: core test — replaying `[ownerWrite@t1, callerTombstone@t2]` → file absent;
`[callerTombstone@t1, ownerWrite@t2]` → file present (chronological); the removePatch handler
writes a tombstone keyed to the caller's `writer_key` (not a hard delete) on a shared machine.
Mutator focus: tombstone vs hard-delete branch, the content=null marker, descendant keying, the
order-sensitivity.
**GREEN**: rework `removePatch` to tombstone-always for the shared journal (keep own-box single-
writer behavior equivalent), keyed `(machine_id, path, writer_key=caller)`; descendant tombstones
via the existing path-prefix logic, re-keyed.
**MUTATE**: Stryker on the removePatch tombstone path.
**KILL MUTANTS**: tombstone marker, writer keying, descendant-prefix, order survivors.
**REFACTOR**: assess (unify tombstone-write with upsert if they converge).
**Done when**: ACs met, 100% mutation, agent-browser (B `rm /tmp/<f>` on A's box → A sees gone;
A re-creates → back) + scripted wire check, human approves commit.

## Open confirms for implementation (resolve at the relevant slice, not now)

- **`updated_at` bump mechanism** — confirm a `BEFORE UPDATE` trigger (or equivalent) bumps
  `updated_at = now()` server-side on every upsert, so the ordering key can't be client-forged.
  Verify the Supabase upsert path actually triggers it (Slice 1).
- **Equal-timestamp tiebreak** — `writer_key` lexical is the proposed deterministic tiebreak;
  confirm acceptable (rare; same-ms multi-writer). (Slice 1.)
- **Own-box `rm` under tombstone-always** — confirm reworking `removePatch` to always-tombstone
  keeps own-box behavior equivalent (single writer → tombstone replays same as the old hard-
  delete + base-tombstone). (Slice 4; or keep the is_new hard-delete only when the caller is the
  sole writer — decide in Slice 4.)
- **Shared owner-resolve helper** — confirm the registry reverse-lookup + owner-tree
  materialization is factored once and reused by `resolveCrossPlayerFs` (read) and the cross-
  player write L2 (D6). (Slice 2.)
- **`writer_key` on system writes** — `appendMachineLog`/`nmapScan`/`appendAuthLog` stamp a
  sensible `writer_key` (the acting player, or the owner for own-box auth.log). Confirm mapping.
  (Slice 1.)

## Pre-PR Quality Gate (each slice)

1. `mutation-testing` on the slice's new pure code (dev server DOWN).
2. `refactoring` assessment.
3. `npm run lint` + `npm run test:run` (in `v2/`); `npm run build` green (tsc is a self-imposed
   gate).
4. agent-browser two-identity E2E for the slice's observable + scripted two-identity wire check.

## Out of scope (explicit deferrals)

- su-to-root + root-tier writes + bricking → **Story 4** (uses the persisted root-hash).
- Real iptables NAT / multi-machine / multi-layer → **Story 5**.
- Cross-player scan/connection trace (kern.log/auth.log re-key onto the shared record; the
  `writer_key` provenance this story lands is what the trace will read) → **Story 6**.
- Same-wifi shared-LAN occupancy → **Story 7**.
- Full every-edit append-only history / collaborative text merge (we keep one row per writer per
  file, last-chronological-write wins) — not planned.

---

_Delete this file when Story 3 is complete; reconcile `plans/multiplayer-crossplayer-epic.md`
(mark Story 3 ✅, point Next at Story 4). If `plans/` is empty, delete the directory._
