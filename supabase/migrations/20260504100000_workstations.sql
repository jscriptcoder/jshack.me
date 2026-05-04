-- workstations: server-side record of every player's own workstation.
--
-- Purpose: drive the L2 own-workstation base-FS backfill (chunk #1b).
-- Without this table, an intruder who cracks a session on Player A's
-- workstation can forge an envelope that bypasses L2 — A's machine_id
-- has zero rows in machine_filesystems, so enforceL2's leaf-only
-- fallback (`if (!fsResult.found) return null;`) permits the write
-- unchecked. Populating machine_filesystems requires the server to
-- regenerate the workstation FS deterministically; this table stores
-- only the fields strictly needed to do that regen.
--
-- Stored fields:
--   - player_key:        Ed25519 pubkey hex; PRIMARY KEY (one row per
--                        identity, idempotent on re-register).
--   - workstation_name:  the name the player chose at intro
--                        (e.g. 'skylab'). Combined with
--                        first-8-hex(sha256(player_key)) it forms the
--                        workstation_id / machine_id used everywhere
--                        else (patches, sessions, machine_filesystems
--                        rows on backfill).
--   - username:          the player's chosen Linux username. The ONLY
--                        field that structurally affects the FS — the
--                        invariant is locked in by
--                        src/generation/generateLocalhost.test.ts
--                        ("FS structure invariant under (seed,
--                        rootPassword, hostname)"). seed and
--                        rootPassword are NOT stored here because L2
--                        only consumes owner+permissions and content
--                        was dropped from machine_filesystems in
--                        20260503210309.
--   - created_at:        operational only.
--
-- Security posture (mirrors machine_filesystems and patches):
--   - No SELECT/INSERT/UPDATE/DELETE policies, so RLS denies anon and
--     authenticated by default. All access routes through the Vercel
--     function with service_role.
--   - service_role bypasses RLS. Never ship to client.
--
-- Idempotency: the API endpoint that registers a workstation does
-- INSERT ... ON CONFLICT (player_key) DO NOTHING and reads back the
-- existing row to compare — re-registering with the same name+username
-- is a no-op; differing inputs surface as a 409 to keep the per-player
-- machine_id stable.
--
-- See plans/l2-own-workstation-backfill.md for the full delivery plan.
-- See memory: project_l2_followups.md (chunk #1b).

CREATE TABLE workstations (
  player_key       TEXT        PRIMARY KEY,
  workstation_name TEXT        NOT NULL,
  username         TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workstations ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS
-- and is the only path that can read/write.
