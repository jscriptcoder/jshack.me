-- L2 dual-write functions: upsert_patch_with_fs + remove_patches_with_fs.
--
-- L2 patch validation reads from machine_filesystems to walk permissions on
-- the active session's credentials. To keep machine_filesystems always
-- current, every successful patch mutation must dual-write to both tables in
-- a single transaction. These plpgsql functions are that transaction —
-- callers (the Vercel function in api/patches.ts) issue exactly one RPC and
-- the database guarantees atomicity.
--
-- Own-workstation bypass: a player's own workstation (machine_id of the
-- shape ${workstation_name}-${first-8-hex(player_key)}) is excluded from
-- machine_filesystems by design. The player owns their own box; L2 is
-- skipped there. The caller computes the bypass and passes p_dual_write =
-- false; the function honors it without re-deriving the suffix.
--
-- See the 20260502220000_machine_filesystems migration for the table this
-- projects onto.

-- upsert_patch_with_fs: write or replace a patch row, optionally projecting
-- onto machine_filesystems in the same transaction.
--
-- machine_filesystems has NOT NULL constraints on permissions and node_type
-- that patches doesn't. When the patch lacks explicit permissions, we skip
-- the dual-write — the L2 walker falls back to the base FS regenerated
-- permissions for paths with no machine_filesystems row.
CREATE OR REPLACE FUNCTION upsert_patch_with_fs(
  p_player_key  TEXT,
  p_machine_id  TEXT,
  p_path        TEXT,
  p_content     TEXT,
  p_owner       TEXT,
  p_permissions JSONB,
  p_is_new      BOOLEAN,
  p_node_type   TEXT,
  p_dual_write  BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO patches (
    player_key, machine_id, path, content, owner, permissions, is_new, node_type, updated_at
  ) VALUES (
    p_player_key, p_machine_id, p_path, p_content, p_owner, p_permissions,
    COALESCE(p_is_new, false),
    COALESCE(p_node_type, 'file'),
    NOW()
  )
  ON CONFLICT (player_key, machine_id, path) DO UPDATE SET
    content = EXCLUDED.content,
    owner = EXCLUDED.owner,
    permissions = EXCLUDED.permissions,
    is_new = EXCLUDED.is_new,
    node_type = EXCLUDED.node_type,
    updated_at = NOW();

  IF p_dual_write AND p_permissions IS NOT NULL THEN
    INSERT INTO machine_filesystems (
      machine_id, path, owner, permissions, node_type, content, updated_at
    ) VALUES (
      p_machine_id, p_path, p_owner, p_permissions,
      COALESCE(p_node_type, 'file'),
      p_content,
      NOW()
    )
    ON CONFLICT (machine_id, path) DO UPDATE SET
      owner = EXCLUDED.owner,
      permissions = EXCLUDED.permissions,
      node_type = EXCLUDED.node_type,
      content = EXCLUDED.content,
      updated_at = NOW();
  END IF;
END;
$$;

-- remove_patches_with_fs: hard-delete patches by exact path + descendants
-- (path-prefix LIKE), optionally cascading to machine_filesystems in the
-- same transaction.
--
-- Multi-player overlap caveat: machine_filesystems is shared across
-- players (one row per machine_id+path), but patches is per-player. If
-- two players hold patches at the same path and one deletes, the
-- machine_filesystems row goes away even though the other player's patch
-- still exists. The L2 walker treats absence as "fall back to base FS",
-- which under-permissions the next L2 check on that path until the
-- remaining player's next write re-projects. Acceptable for v1 — the
-- path requires coordinated multi-player edits on the same file. A
-- future reconcile step (recompute machine_filesystems from surviving
-- patches) closes the gap.
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
    WHERE player_key = p_player_key
      AND machine_id = p_machine_id
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

-- Lock down execution: only service_role can call these. The Vercel
-- function uses service_role; anon and authenticated have no path to
-- bypass RLS via the function.
REVOKE EXECUTE ON FUNCTION upsert_patch_with_fs(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION remove_patches_with_fs(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_patch_with_fs(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION remove_patches_with_fs(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
