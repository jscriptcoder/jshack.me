-- patches: server-authoritative filesystem patch journal — SHARED across writers.
--
-- Story 3 (cross-player write) flips the PK from the per-viewer
-- (player_key, machine_id, path) to a SHARED journal keyed
-- (machine_id, path, writer_key): one machine's journal can hold rows from
-- MULTIPLE writers (the owner + cross-player visitors). `writer_key` is the
-- PROVENANCE of a row (who wrote it), server-stamped from the verified pubkey.
-- Reads scope by machine_id (the workstation id already encodes the owner, so a
-- machine-scoped read does not merge other machines) and replay every writer's
-- rows in chronological `updated_at` order, so the latest write to a path wins
-- and all edits stay attributed.
--
-- Destructive recreate: there are no live players pre-launch, and the old
-- per-viewer rows would collide under the new key anyway. No data migration.
--
-- Ordering is server-authoritative: `updated_at` is bumped by a BEFORE UPDATE
-- trigger (NOT a client value), so a forged client timestamp can't reorder a
-- write. The column DEFAULT covers INSERT; the trigger covers the upsert's
-- ON CONFLICT DO UPDATE path (whose SET does not include updated_at).
--
-- Security posture unchanged (zero-trust; mirrors the blueprint §4.4.3):
--   - RLS enabled, NO policies → anon + authenticated denied by default.
--   - service_role bypasses RLS and is the only path that reads/writes, always
--     via the Vercel function, which verifies the Ed25519 envelope and stamps
--     writer_key from the verified pubkey (never a client claim).

DROP TABLE IF EXISTS patches;

CREATE TABLE patches (
  machine_id  TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  writer_key  TEXT        NOT NULL,                   -- provenance: who wrote this row
  content     TEXT,                                   -- null = base-fs deletion marker
  owner       TEXT        NOT NULL,                   -- in-game FILE owner (ls -l), NOT the player
  permissions JSONB,
  is_new      BOOLEAN     NOT NULL DEFAULT false,
  node_type   TEXT        NOT NULL DEFAULT 'file',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (machine_id, path, writer_key)
);

-- A read filters by machine_id then orders by (updated_at, writer_key); the PK's
-- leading machine_id column serves the prefix scan.

-- Server-stamp updated_at on every UPDATE (including the upsert's ON CONFLICT DO
-- UPDATE), so a client cannot forge a write to replay earlier/later.
CREATE OR REPLACE FUNCTION patches_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER patches_set_updated_at
  BEFORE UPDATE ON patches
  FOR EACH ROW
  EXECUTE FUNCTION patches_set_updated_at();

ALTER TABLE patches ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is
-- the only path that can read/write, mediated entirely by the Vercel function.
