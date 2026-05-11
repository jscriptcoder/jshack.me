-- Drop the player_key filter from remove_patches_with_fs.
--
-- Before this migration, the DELETE was scoped to rows authored by the
-- calling player. That made gameplay sense only for the simplest case
-- (player deletes their own writes on their own machine). It silently
-- broke every cross-player scenario where root on machine M needs to
-- delete a file authored by someone else — e.g. Player A killing a
-- backdoor pidfile that Player B planted on A's own workstation via a
-- CVE: A's removePatch envelope was signed by A, so p_player_key = A,
-- but B's patch row had player_key = B → WHERE didn't match → no-op.
-- The kill appeared to succeed locally (optimistic), then a refresh
-- restored the backdoor from B's untouched row.
--
-- L1 (active session on the machine) and L2 (walker permission on the
-- path) already gate the delete inside the handler before this SQL
-- runs. The player_key filter was redundant defense-in-depth that
-- inverted gameplay semantics. After this migration the delete trusts
-- the handler's gates: if you have a session + write permission on the
-- path, you can delete the row regardless of who authored it (matching
-- real Unix semantics — root on the machine owns the filesystem).
--
-- Note: clear_owned_patches (used by `reset confirm`) is a SEPARATE
-- SQL function and intentionally still filters by player_key — that
-- one IS player-scoped by design (wipe MY rows on MY workstation, never
-- another player's writes on shared infrastructure). Not touched here.
--
-- The p_player_key parameter stays in the function signature for
-- telemetry/audit (callers still pass the verified pubkey, future
-- iterations could log it). Dropping the param entirely would cascade
-- through the TS adapter signatures with no benefit. Keep the noise
-- local to this one WHERE clause.
--
-- 2026-05-12 — surfaced in PR 8 in-game smoke (file_write, then
-- backdoor_port_open cleanup attempt).

CREATE OR REPLACE FUNCTION remove_patches_with_fs(
  p_player_key  TEXT,
  p_machine_id  TEXT,
  p_path        TEXT,
  p_path_prefix TEXT,
  p_dual_write  BOOLEAN
) RETURNS TABLE (deleted_path TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH deleted AS (
    DELETE FROM patches
    WHERE machine_id = p_machine_id
      AND (patches.path = p_path OR patches.path LIKE p_path_prefix || '%')
    RETURNING patches.path
  )
  SELECT deleted.path FROM deleted;

  IF p_dual_write THEN
    DELETE FROM machine_filesystems
    WHERE machine_filesystems.machine_id = p_machine_id
      AND (machine_filesystems.path = p_path
           OR machine_filesystems.path LIKE p_path_prefix || '%');
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_patches_with_fs(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_patches_with_fs(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
