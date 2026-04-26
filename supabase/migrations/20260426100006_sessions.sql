-- sessions: server-authoritative session registry.
--
-- Each row represents an active or ended terminal session: a player's
-- presence on a specific machine with specific credentials. The server
-- (not the client) is the source of truth for "does player X have an
-- active session on machine Y?" — patch authorization, hop-chain realism,
-- and cross-player visibility all depend on this table.
--
-- Hop chain: parent_session_id forms a tree where each child session was
-- opened *from* the machine of its parent. The access.log source-IP
-- realism rule reads source_ip (denormalized from the parent's
-- machine_id) so logs record the immediate hop, not the originating player.
--
-- Lifecycle: rows are inserted on session creation (push) and updated
-- (not deleted) on end — ended_at + end_reason capture how each session
-- terminated. Cascade-end of children when a parent ends is handled at
-- the application layer (recursive UPDATE in the Vercel function), not
-- via FK action — we want UPDATE, not DELETE.
--
-- Security posture (mirrors public_ips):
--   - No SELECT/INSERT/UPDATE/DELETE policies, so RLS denies access for
--     anon and authenticated roles by default. All reads/writes route
--     through the Vercel function with service_role, which filters by
--     the verified Ed25519 pubkey from each signed envelope.
--   - service_role bypasses RLS. Never ship to client.
--
-- See memory: project_multiplayer_sessions.md, project_multiplayer_security_model.md.

CREATE TABLE sessions (
  session_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_key        TEXT        NOT NULL,
  machine_id        TEXT        NOT NULL,
  credentials       JSONB       NOT NULL,
  parent_session_id UUID        REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_ip         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  end_reason        TEXT
);

-- Active-session lookup: "what sessions does this player currently have?"
-- Partial index — only indexes rows where ended_at IS NULL, keeping it
-- small as the table grows with historical sessions.
CREATE INDEX sessions_active_by_player_idx
  ON sessions (player_key)
  WHERE ended_at IS NULL;

-- Cascade-end traversal: "find all children of this parent session."
CREATE INDEX sessions_parent_idx
  ON sessions (parent_session_id)
  WHERE parent_session_id IS NOT NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS
-- and is the only path that can read/write. All access mediated by the
-- Vercel function, which verifies the Ed25519 signature and stamps
-- player_key from the verified pubkey (never trust client claims).
