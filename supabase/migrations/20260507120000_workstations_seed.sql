-- Add `seed` to workstations + pre-launch DB wipe.
--
-- Background (PR 1 of plans/cross-player-base-fs-replication.md):
-- Today's `populateBaseFs` calls regenWorkstationRows with PLACEHOLDER_SEED
-- and PLACEHOLDER_ROOT_PASSWORD, so machine_filesystems.content for
-- /etc/passwd on every workstation holds *wrong* hashes. Server-side
-- userType validation (createSession, PR #122) works because it inspects
-- username/userType columns only — but cross-player password validation
-- (this chunk's PR 2) needs the *real* hash to compare against the
-- player's submitted password. Fix: registration envelope carries `seed`
-- (persisted here) and `rootPassword` (used at register-time, discarded).
--
-- Why a wipe: workstations gets a NOT NULL column with no sensible
-- default for existing rows (seed is per-player, generated at NEW GAME).
-- Pre-launch posture (memory: feedback_no_backward_compat.md) makes the
-- wipe acceptable: no live players, no persistent state to preserve.
-- Players re-register on next NEW GAME; NPC home/world networks survive
-- and their machine_filesystems rows are repopulated by the backfills.
--
-- Tables wiped (all player-stateful tables to keep state consistent):
--   - workstations            (the schema-changing table)
--   - machine_filesystems     (workstation rows had wrong content; NPC
--                              rows get repopulated by backfill scripts)
--   - patches                 (player-generated content keyed on
--                              machine_id; orphaned without workstations)
--   - sessions                (active sessions reference deleted rows)
--   - home_network_occupants  (player presence on shared LANs)
--   - public_ips              (player IP allocations)
--
-- NOT wiped (no player state):
--   - home_networks    (NPC seeds)
--   - world_networks   (themed networks, e.g. findit.io)
--
-- This migration is one-shot: re-running migrations on a fresh DB
-- truncates these tables, but they would be empty anyway. Sunsets at
-- multiplayer launch — post-launch schema changes need migration
-- discipline (memory: feedback_no_backward_compat.md).

TRUNCATE TABLE
  workstations,
  machine_filesystems,
  patches,
  sessions,
  home_network_occupants,
  public_ips
CASCADE;

ALTER TABLE workstations ADD COLUMN seed TEXT NOT NULL;
