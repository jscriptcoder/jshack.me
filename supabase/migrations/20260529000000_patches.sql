-- patches: server-authoritative filesystem patch journal.
--
-- One row per (player_key, machine_id, path) — a single mutation a player has
-- made to a machine's filesystem (write, create, base-fs deletion marker,
-- permission change). Patches replay over a regenerated base FS to materialize
-- the player's current view. UPSERT on writes; DELETE on isNew cleanup.
--
-- v2 starts from the eliminated-localhost model: a player's own workstation is
-- stored under its computeWorkstationId, NOT the legacy 'localhost' literal, so
-- there is no localhost-based transient index here. The cross-player read index
-- on machine_id lands with cross-player reads (a later plan), not now.
--
-- Security posture (zero-trust; mirrors the blueprint §4.4.3):
--   - RLS enabled, NO policies → anon + authenticated denied by default.
--   - service_role bypasses RLS and is the only path that reads/writes, always
--     via the Vercel function, which verifies the Ed25519 envelope and stamps
--     player_key from the verified pubkey (never a client claim).

CREATE TABLE patches (
  player_key  TEXT        NOT NULL,
  machine_id  TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  content     TEXT,                                   -- null = base-fs deletion marker
  owner       TEXT        NOT NULL,
  permissions JSONB,
  is_new      BOOLEAN     NOT NULL DEFAULT false,
  node_type   TEXT        NOT NULL DEFAULT 'file',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_key, machine_id, path)
);

-- listPatches WHERE player_key = me is served by the PK prefix scan.

ALTER TABLE patches ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is
-- the only path that can read/write, mediated entirely by the Vercel function.
