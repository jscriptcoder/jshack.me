# Plan: L2 base-FS coverage on world networks

**Branch**: feat/l2-world-networks
**Status**: Active

## Goal

Close the leaf-only gap on world networks by populating `machine_filesystems` with the base FS for every `world_networks` row, mirroring Step 7 of the home-network L2 work. After this lands, L2 enforces on every path of every world-network machine — not just paths that have ever been patched.

## Background

L2 patch validation shipped 2026-05-03 (PR #98) with **full coverage on home networks** but **leaf-only on world networks and missions**. Leaf-only means: paths only land in `machine_filesystems` after they've been patched, so untouched base-FS files fall back to the permissive "no row → allow" path. A guest player who never triggered a write on `/etc/shadow` of a world-network machine would not have an L2 row to enforce against.

Home networks closed this by regenerating the FS server-side at `home_networks` create time (`api/join-home-network.ts`) + an idempotent backfill script for pre-existing rows. World networks need the same shape with two adaptations:

1. **No API hook**: world networks are seeded via SQL migrations, not API calls. The "go-forward" path becomes a backfill-after-migration convention rather than an API hook.
2. **Different generator**: world networks use the `ThemedGenerator` registry (`src/themedNetworks/generators/registry.ts`) — `selectGenerator(theme)(row, ctx)` returns a `MissionNetwork`. The default (playground) wraps `generateMissionNetwork`; `search-engine` (findit.io) has a custom generator. Both produce `MissionNetwork.fileSystems: Readonly<Record<string, FileNode>>` — same shape as home networks, so `flattenFileSystemsToRows` works unchanged.

References:

- `project_l2_followups` memory — flagged this as the immediate next chunk
- `project_l2_plan` memory — Pattern A architecture, coverage table
- `reference_l2_verification_scripts` memory — forged-envelope tooling

## Acceptance Criteria

- [ ] After running the backfill script against a fresh DB, every `world_networks` row has matching `machine_filesystems` rows for every node in every machine's FS.
- [ ] Re-running the backfill produces zero new inserts (idempotent — `ON CONFLICT DO NOTHING` preserves any patch rows that landed since).
- [ ] A guest player attempting to write a root-only file on findit.io's machine via forged envelope receives `403 permission_denied` from L2 (was previously a permissive allow on untouched paths).
- [ ] The L2 plan memory and coverage table reflect "✅ full" for world networks.
- [ ] CLAUDE.md debug scripts list includes the new backfill script.

## Steps

Every step follows RED → GREEN → MUTATE → KILL MUTANTS → REFACTOR. Sub-PRs squash-merged into `feat/l2-world-networks`; final integration PR merges to main.

### Step 1: `regenWorldNetworkRows` helper

**RED**: A failing test that asserts the helper, given a world_networks row + the full rows array, returns one `MachineFsRow` per FileNode in every machine of the generated network. Cover at least: (a) playground row (default generator), (b) findit.io row (search-engine generator), (c) confirms `allRows` is forwarded to the generator context.

**GREEN**: `regenWorldNetworkRows({ row, allRows, selectGenerator })` calls `selectGenerator(row.theme)(row, ctx)` with `ctx.allocateIp = async () => row.public_ip` and `ctx.allRows = allRows`, then runs `flattenFileSystemsToRows(network.fileSystems)`. `selectGenerator` is injectable for unit tests; production callers pass the registry's selector.

**MUTATE**: Run the mutation-testing skill against the new module. Focus on operator/branch mutants in the small wiring layer.

**KILL MUTANTS**: Address any survivors that reflect realistic bugs.

**REFACTOR**: Assess if the helper can share a common substrate with `regenHomeNetworkRows` (probably not — different input shape — but check).

**Done when**: tests pass, mutations killed, types clean, sub-PR squash-merged.

### Step 2: One-time backfill script

**RED**: Manual integration test against local Supabase — assert that running the script against a freshly-reset DB inserts the expected number of rows for each `world_networks` row. (Pure integration, not unit; tracked as a manual gate per project precedent — `verifyDualWrite.ts` is the same model.)

**GREEN**: `scripts/backfillWorldNetworkBaseFs.ts` mirrors `backfillHomeNetworkBaseFs.ts`:

- SELECT every row from `world_networks`
- For each row, call `regenWorldNetworkRows({ row, allRows, selectGenerator })`
- Bulk-insert via `createBulkInsertMachineFs` with `onConflict: 'machine_id,path', ignoreDuplicates: true`
- `--dry-run` support, summary output, exit code reflects failure count

**MUTATE**: N/A for the script (orchestration glue around tested helpers); the helpers from Step 1 carry the unit coverage.

**Done when**: Script runs against local DB, both findit.io and playground get populated, re-running shows zero inserts. Manual log-output sanity check.

### Step 3: Cross-player forged-envelope verification

**RED/GREEN**: Adapt `scripts/testL2Bypass.ts` (or write a parallel `testL2BypassWorld.ts`) to target a world-network machine. Three scenarios on a root-only file from a world-network base FS:

- A: forged upsertPatch with no session → expect `403 no_session`
- B: forged upsertPatch with guest session → expect `403 permission_denied` (the headline test — was previously a permissive allow)
- C: forged upsertPatch with root session → expect `200`

**Done when**: All three scenarios pass against a populated world network in local Supabase.

### Step 4: Documentation + memory

**RED/GREEN**: Update:

- `src/machineFilesystems/README.md` — mention world networks alongside home networks
- `CLAUDE.md` — add the new backfill script to the Debug Scripts list
- `project_l2_plan` memory — flip world networks to ✅ full in the coverage table; update the load-bearing facts list
- `project_l2_followups` memory — strike chunk #1; leave #2 (mission_instances) and #3 (server-side userType) queued
- `reference_l2_verification_scripts` memory — add the new world-network bypass script if Step 3 produced one

**Done when**: All docs/memory consistent with shipped reality. CLAUDE.md formatted via `npm run format`.

### Step 5: Integration smoke + merge to main

**RED/GREEN**: On `feat/l2-world-networks` (after Steps 1–4 squash-merged via sub-PRs):

- `npx tsc -b` clean
- `npm run lint` clean
- `npm run test:run` green
- `npm run build` succeeds
- Local DB reset → run backfill → run forged-envelope tests against home + world networks
- Two-browser cross-player smoke on findit.io: Player A writes root-only file (legit), Player B (guest, real session) tries forged write → 403

**Done when**: Final integration PR (this branch → main) merges, version bump committed (`chore(version): bump to 0.117.0 — L2 on world networks`), local branch deleted.

## Pre-PR Quality Gate

Before each sub-PR:

1. Mutation testing — run `mutation-testing` skill on the changed code
2. Refactoring assessment — run `refactoring` skill if anything feels organic
3. `tsc -b`, `eslint`, `prettier --check`, `vitest run` all green
4. For Steps 2–3: smoke against local Supabase before opening PR

## Risks & exit ramps

- **Generator runs server-side and pulls heavy mission-generation code**: same risk as home networks — mitigated by the determinism cross-check (Step 1 of the original L2 plan). World networks reuse the same generator infrastructure, so determinism already holds. If a divergence surfaces, narrow the scope to leaf-only and document.
- **`allRows` interdependency in findit.io's index builder**: the search-engine generator reads peer rows to build its index. `regenWorldNetworkRows` must pass the **same** `allRows` set every time or the generated `/etc/findit/index.json` will drift across runs. Mitigation: backfill script reads all rows once and passes the snapshot to every per-row regen.
- **No go-forward hook (only backfill-after-migration)**: differs from the home-network pattern. Document the convention in CLAUDE.md so future themed-network migrations get the backfill rerun.

## Out of scope

- Mission machines (blocked on `mission_instances` server-side concept — see `project_l2_followups` chunk #2)
- Server-side userType validation against `/etc/passwd` (see `project_l2_followups` chunk #3)

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
