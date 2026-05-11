# machine_filesystems

Server-side projection of the current FS state, used by L2 patch validation. Every successful patch dual-writes here in the same transaction; base-FS state for shared networks (home networks, world networks; missions still pending) is bulk-populated at provision time. The L2 walker reads from this table to decide allow/deny for every mutation.

The DB row is keyed on `(machine_id, path)`. Unlike `patches` (which is per-player journal), `machine_filesystems` is per-machine — one row per node regardless of who wrote it. Last-write-wins semantics are a property of the projection, not the journal. RLS denies anon by default; only `service_role` reads/writes.

See `docs/technology-choices.md` (Pattern A — eager denormalization) for the architecture decision.

## Files

| File                            | Description                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flattenFileNode.ts`            | Pure: walks a `FileNode` tree → `MachineFsRow[]` for bulk insert. Owner + permissions only (content/node_type were dropped from the projection in 20260503210309 — L2 only reads permissions).                                                                                                                      |
| `bulkInsertMachineFs.ts`        | Adapter: 500-row chunked bulk insert with first-error stop. Caller (api wiring) provides a `bulkInsertFn` that runs `.upsert(rows, { onConflict, ignoreDuplicates: true })`. Partial-success → ok:false (no half-populated state).                                                                                  |
| `populateHomeNetworkBaseFs.ts`  | Server-side helper: `regenHomeNetworkRows({ seed, publicIp })` — runs `generateHomeNetwork` deterministically, flattens to rows. Used by the join-handler post-create hook AND the home one-time backfill script.                                                                                                   |
| `populateWorldNetworkBaseFs.ts` | Server-side helper: `regenWorldNetworkRows({ row, allRows, selectGenerator })` — dispatches via the `ThemedGenerator` registry, flattens to rows. Used by the world-network backfill script. `allRows` snapshot lets findit.io build a stable peer index.                                                           |
| `populateWorkstationBaseFs.ts`  | Server-side helper: `regenWorkstationRows({ playerKey, workstationName, username })` — runs `generateLocalhost` with placeholder seed/rootPassword/hostname (validated by the `generateLocalhost` invariant test), flattens to rows. Used by the register-workstation endpoint AND the workstation backfill script. |
| `*.test.ts`                     | Unit tests for the pure helpers.                                                                                                                                                                                                                                                                                    |

## Wiring

| Site                                        | Role                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/join-home-network.ts:createNetwork`    | After the `home_networks` row inserts, calls `populateBaseFsBestEffort` → regen + bulk insert. Best-effort; failure logs but doesn't fail the join (the backfill script can re-run idempotently). |
| `api/register-workstation.ts`               | At workstation registration time (NEW GAME), calls `populateBaseFs` → regen + bulk insert. Same best-effort posture as the home create-hook.                                                      |
| `scripts/backfillHomeNetworkBaseFs.ts`      | One-time backfill for existing `home_networks` rows. Idempotent via `ON CONFLICT DO NOTHING` (preserves any live patches that dual-wrote in the meantime). Supports `--dry-run`.                  |
| `scripts/backfillWorldNetworkBaseFs.ts`     | One-time backfill for `world_networks` rows. Same idempotent semantics. Run after every new themed-network migration — world rows ship via SQL, not API, so there's no go-forward hook to mirror. |
| `scripts/backfillWorkstationBaseFs.ts`      | One-time backfill for `workstations` rows. Same idempotent semantics. Catches any populate misses from the register-workstation best-effort path.                                                 |
| `src/patchRegistry/handler.ts:enforceL2`    | Reader. Looks up `(machine_id, path)` and feeds the row's permissions to the shared walker.                                                                                                       |
| `src/patchRegistry/supabaseUpsert.ts` (RPC) | Writer. The `upsert_patch_with_fs` plpgsql function dual-writes to `patches` + `machine_filesystems` in one transaction.                                                                          |
| `src/patchRegistry/supabaseDelete.ts` (RPC) | Writer. The `remove_patches_with_fs` plpgsql function deletes from both tables (exact + prefix cascade) in one transaction.                                                                       |

## L2 coverage

| Network               | Coverage today                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workstation (own-box) | Full for non-owner access — `machine_filesystems` populated at register-workstation time + idempotent backfill. Owner writes still bypass via `isOwnWorkstationOnServer` (the suffix-derived shortcut for the player's own box). |
| Home network LANs     | Full — `machine_filesystems` populated from the regenerated base FS at create time + idempotent backfill for existing rows.                                                                                                      |
| World networks        | Full — `machine_filesystems` populated via `scripts/backfillWorldNetworkBaseFs.ts`. Re-run after each new themed-network migration row.                                                                                          |
| Mission machines      | Leaf-only — `mission_instances` aren't yet a server-side concept (decided 2026-04-23). Blocked on multiplayer-mission-instances landing.                                                                                         |

The "leaf-only" mode means: only paths that have ever been patched have rows in `machine_filesystems`, so L2 enforces on those forever but is permissive on truly-untouched paths. As soon as anyone touches a path once, L2 takes over.

## Why dual-write through SQL functions instead of two separate calls

Atomicity. The plpgsql functions (`upsert_patch_with_fs`, `remove_patches_with_fs`) wrap both writes in one transaction so a `patches` row never exists without its `machine_filesystems` projection (when applicable). A two-call JS approach would either need an explicit transaction (Supabase JS doesn't expose one cleanly) or risk skew on partial failure.

## Schema

```sql
CREATE TABLE machine_filesystems (
  machine_id  TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  owner       TEXT        NOT NULL,
  permissions JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (machine_id, path)
);

CREATE INDEX machine_filesystems_path_prefix_idx
  ON machine_filesystems (machine_id, path text_pattern_ops);
```

`node_type` and `content` were part of the original schema but were dropped in `20260503210309_drop_machine_fs_unused_columns.sql` — L2's walker only consumes `permissions`, and `content` duplicated bytes already stored in `patches`. `owner` is kept as a hedge for closing the chmod-via-forged-envelope gap (the client's chmod requires `userType === node.owner`; a future server-side parity check would need this column).

`text_pattern_ops` supports `LIKE 'prefix%'` index scans even under non-C UTF-8 collations — the cascade-delete path needs prefix-range queries.

RLS is enabled with **no policies** — anon/authenticated denied by default; only `service_role` (used by the Vercel function) reads/writes. Mirrors `patches` and `sessions`.
