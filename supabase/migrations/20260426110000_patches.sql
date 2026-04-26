-- patches: server-authoritative filesystem patches.
--
-- Each row represents a single mutation a player has made to a machine's
-- filesystem (file write, file/dir create, deletion of a base-fs file,
-- permissions change). Patches replay on top of regenerated filesystems
-- to materialize the player's current view of the world.
--
-- Today (single-player) patches live in IndexedDB as one big JSON blob
-- under (db='jshack-db', store='filesystem', key='patches'). For
-- multiplayer they need to follow `player_key` across browsers/devices,
-- so the table becomes the source of truth and IndexedDB drops to a
-- local cache for fast initial paint.
--
-- Natural key: (player_key, machine_id, path). One row per file the
-- player has touched. UPSERT on writes; hard-DELETE on isNew-cleanup
-- (file the player created via a patch and then removed — never existed
-- in the base fs, so no "deletion" patch is needed). Two bulk-DELETE
-- shapes drive the existing client-side cleanup hooks:
--   - clearTransientPatches: mission/home scene change drops everything
--     except machine_id='localhost' (mirrors PERSISTENT_MACHINE_KEYS in
--     FileSystemContext.tsx).
--   - clearAllPatches: `reset confirm` wipes the player's full set
--     before page reload, defeating ghost-rehydration.
--
-- Security posture (mirrors public_ips, sessions):
--   - No SELECT/INSERT/UPDATE/DELETE policies, so RLS denies access for
--     anon and authenticated roles by default. All reads/writes route
--     through the Vercel function with service_role, which stamps
--     player_key from the verified Ed25519 pubkey on every envelope
--     (never trust client claims).
--   - Patch *validation* (does this player have an active session on
--     this machine? are the credentials authorized to write this path?)
--     is a follow-up PR — this table records authoritatively but does
--     not yet enforce the session/permission boundary.
--   - service_role bypasses RLS. Never ship to client.
--
-- See memory: project_multiplayer_security_model.md, project_multiplayer_sessions.md.

CREATE TABLE patches (
  player_key  TEXT        NOT NULL,
  machine_id  TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  content     TEXT,
  owner       TEXT        NOT NULL,
  permissions JSONB,
  is_new      BOOLEAN     NOT NULL DEFAULT false,
  node_type   TEXT        NOT NULL DEFAULT 'file',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_key, machine_id, path)
);

-- listPatches WHERE player_key = me is served by the PK prefix scan;
-- no extra index needed for that path.

-- clearTransientPatches: "drop everything except localhost for this
-- player." Partial index keeps it small as the table grows — most rows
-- will be transient (mission + home machines), localhost is the
-- minority. Predicate matches the DELETE filter exactly.
CREATE INDEX patches_transient_by_player_idx
  ON patches (player_key)
  WHERE machine_id <> 'localhost';

ALTER TABLE patches ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS
-- and is the only path that can read/write. All access mediated by the
-- Vercel function, which verifies the Ed25519 signature and stamps
-- player_key from the verified pubkey (never trust client claims).
