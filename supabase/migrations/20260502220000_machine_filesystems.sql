-- machine_filesystems: server-authoritative current FS state per machine.
--
-- Eager-denormalization projection of the patches table, used by L2 patch
-- validation to walk filesystem permissions on the active session's
-- credentials before allowing a mutation. Without L2, a player holding a
-- guest-shell session on a remote machine could ask the server to delete
-- /etc/shadow or modify /root/* and the server would have no way to refuse
-- beyond the L1 "do you have a session" check.
--
-- This table is dual-written from src/patchRegistry/supabaseUpsert.ts and
-- supabaseDelete.ts in the same Postgres transaction as every successful
-- patch mutation, so the row here matches the row in patches at all times.
-- Storage is single-digit MB at indie scale (one row per touched path per
-- machine, regardless of how many players have touched it — this is not
-- per-player like patches).
--
-- Excluded by design: the player's own workstation. Machine_id for own
-- workstations follows ${workstation_name}-${first-8-hex(player_key)} and
-- the patches there are inherently player-owned with no shared multiplayer
-- surface. L2 is skipped for those; no row is written here. See memory:
-- project_workstation_id_model.md.
--
-- Natural key: (machine_id, path). One row per file the world has touched.
-- UPSERT on writes; cascade-DELETE on path-prefix when a directory is
-- removed (mirrors the LIKE 'path%' delete in patches).
--
-- Security posture (mirrors patches):
--   - No SELECT/INSERT/UPDATE/DELETE policies, so RLS denies access for
--     anon and authenticated roles by default. All reads/writes route
--     through the Vercel function with service_role.
--   - service_role bypasses RLS. Never ship to client.
--
-- See memory: project_l2_plan.md, project_multiplayer_security_model.md.

CREATE TABLE machine_filesystems (
  machine_id  TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  owner       TEXT        NOT NULL,
  permissions JSONB       NOT NULL,
  node_type   TEXT        NOT NULL,
  content     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (machine_id, path)
);

-- Cascade-delete-by-prefix lookup: when a directory is removed, every
-- descendant row needs to go in the same transaction. text_pattern_ops
-- supports LIKE 'path%' index scans even under non-C collations, which
-- the default UTF-8 collation otherwise prevents.
CREATE INDEX machine_filesystems_path_prefix_idx
  ON machine_filesystems (machine_id, path text_pattern_ops);

ALTER TABLE machine_filesystems ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS
-- and is the only path that can read/write. The L2 permission walker
-- runs server-side on this table after the L1 session check.
