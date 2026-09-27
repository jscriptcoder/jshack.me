-- sessions: server-authoritative hop chain.
--
-- One row per PUSHED shell session (today only `su`; `ssh` and friends land
-- later). The player's base login session is implicit and NOT stored here — only
-- elevations/hops are persisted, and replayed on boot to rebuild the stack so a
-- `su` survives a browser refresh.
--
-- `session_id` is CLIENT-minted (the in-memory Session.id) so a later endSession
-- can target the exact row without the client awaiting a server-generated id.
-- `player_key` is server-stamped from the verified Ed25519 pubkey (never a client
-- claim). `parent_session_id` records the session beneath on the stack — plain
-- TEXT, NO foreign key: the base parent ('seed-session') has no row, and cascade
-- semantics are a later (ssh) concern. `ended_at IS NULL` marks an active session.
--
-- Security posture (zero-trust; mirrors patches):
--   - RLS enabled, NO policies → anon + authenticated denied by default.
--   - service_role bypasses RLS and is the only path that reads/writes, always
--     via the Vercel function, which verifies the envelope and confirms the
--     target is the caller's OWN workstation before touching a row.

CREATE TABLE sessions (
  session_id        TEXT        PRIMARY KEY,
  player_key        TEXT        NOT NULL,
  machine_id        TEXT        NOT NULL,
  credentials       JSONB       NOT NULL,            -- { username, userType }
  parent_session_id TEXT,                            -- session beneath on the stack (no FK)
  source_ip         TEXT,                            -- denormalized parent machine (ssh; null for su)
  kind              TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,                     -- null = active
  end_reason        TEXT
);

-- listSessions reads the caller's active sessions on a machine, oldest first.
CREATE INDEX sessions_active_by_player_machine_idx
  ON sessions (player_key, machine_id, created_at)
  WHERE ended_at IS NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write, mediated entirely by the Vercel function.
