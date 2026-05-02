# machine_filesystems

Server-side projection of the current FS state, used by L2 patch validation. Every successful patch dual-writes here in the same transaction; base-FS state for shared networks (home networks, eventually world networks and missions) is bulk-populated at machine-provision time. The L2 walker reads from this table to decide allow/deny for every mutation.

The DB row is keyed on `(machine_id, path)`. Unlike `patches` (which is per-player journal), `machine_filesystems` is per-machine — one row per node regardless of who wrote it. Last-write-wins semantics are a property of the projection, not the journal. RLS denies anon by default; only `service_role` reads/writes.

See `docs/technology-choices.md` (Pattern A — eager denormalization) and `plans/l2-patch-validation.md` for the architecture decision and step-by-step delivery plan.

## Files

| File                           | Description                                                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flattenFileNode.ts`           | Pure: walks a `FileNode` tree → `MachineFsRow[]` for bulk insert. Sanitizes NUL bytes (U+0000 → U+FFFD) — Postgres TEXT rejects NUL with 22P05, and binary placeholders carry them. Matches the patch handler's `sanitizeContent`. |
| `bulkInsertMachineFs.ts`       | Adapter: 500-row chunked bulk insert with first-error stop. Caller (api wiring) provides a `bulkInsertFn` that runs `.upsert(rows, { onConflict, ignoreDuplicates: true })`. Partial-success → ok:false (no half-populated state). |
| `populateHomeNetworkBaseFs.ts` | Server-side helper: `regenHomeNetworkRows({ seed, publicIp })` — runs `generateHomeNetwork` deterministically, flattens to rows. Used by the join-handler post-create hook AND the one-time backfill script.                       |
| `*.test.ts`                    | Unit tests for the pure helpers.                                                                                                                                                                                                   |

## Wiring

| Site                                        | Role                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/join-home-network.ts:createNetwork`    | After the `home_networks` row inserts, calls `populateBaseFsBestEffort` → regen + bulk insert. Best-effort; failure logs but doesn't fail the join (the backfill script can re-run idempotently). |
| `scripts/backfillHomeNetworkBaseFs.ts`      | One-time backfill for existing `home_networks` rows. Idempotent via `ON CONFLICT DO NOTHING` (preserves any live patches that dual-wrote in the meantime). Supports `--dry-run`.                  |
| `src/patchRegistry/handler.ts:enforceL2`    | Reader. Looks up `(machine_id, path)` and feeds the row's permissions to the shared walker.                                                                                                       |
| `src/patchRegistry/supabaseUpsert.ts` (RPC) | Writer. The `upsert_patch_with_fs` plpgsql function dual-writes to `patches` + `machine_filesystems` in one transaction.                                                                          |
| `src/patchRegistry/supabaseDelete.ts` (RPC) | Writer. The `remove_patches_with_fs` plpgsql function deletes from both tables (exact + prefix cascade) in one transaction.                                                                       |

## L2 coverage

| Network               | Coverage today                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Workstation (own-box) | Bypassed by design — player owns their own box.                                                                                            |
| Home network LANs     | Full — `machine_filesystems` populated from the regenerated base FS at create time.                                                        |
| World networks        | Leaf-only (only patched paths enforced). Deferred follow-up because the world-network generator uses a separate `ThemedGenerator` pattern. |
| Mission machines      | Leaf-only — `mission_instances` aren't yet a server-side concept (decided 2026-04-23). Blocked on multiplayer-mission-instances landing.   |

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
  node_type   TEXT        NOT NULL,         -- 'file' | 'directory'
  content     TEXT,                          -- null for directories
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (machine_id, path)
);

CREATE INDEX machine_filesystems_path_prefix_idx
  ON machine_filesystems (machine_id, path text_pattern_ops);
```

`text_pattern_ops` supports `LIKE 'prefix%'` index scans even under non-C UTF-8 collations — the cascade-delete path needs prefix-range queries.

RLS is enabled with **no policies** — anon/authenticated denied by default; only `service_role` (used by the Vercel function) reads/writes. Mirrors `patches` and `sessions`.
