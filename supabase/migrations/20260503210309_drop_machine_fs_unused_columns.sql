-- Drop content + node_type from machine_filesystems.
--
-- L2 patch validation only consumes `permissions` from this table — the
-- walker (src/filesystem/permissionWalker.ts) makes its allow/deny
-- decision purely from the target's read/write/execute allowlists and
-- the requester's userType. `owner` is also unconsumed by L2 today but
-- kept as a hedge for closing the chmod-via-forged-envelope gap (the
-- client's chmod requires userType === node.owner, and a future server-
-- side parity check would need it).
--
-- Dropping content removes the bulk of the per-row payload: every
-- patched file's full body was being duplicated from `patches` into
-- this projection for no L2 use. Dropping node_type removes the only
-- other column that findMachineFs SELECTs but enforceL2 never reads.
--
-- Order matters: the upsert_patch_with_fs function references both
-- columns in its INSERT/UPDATE list. Recreate the function FIRST
-- without the column references, THEN drop the columns. Otherwise the
-- ALTER TABLE will fail because Postgres detects the function depends
-- on the columns.
--
-- See:
--   - src/patchRegistry/handler.ts (enforceL2 — only reads permissions)
--   - src/filesystem/permissionWalker.ts (walker target shape)
--   - api/patches.ts (findMachineFs SELECT projection)

-- Recreate upsert_patch_with_fs without content / node_type in the FS-
-- side INSERT and UPDATE. The function still receives those parameters
-- because the patches table keeps both columns — they flow through to
-- the patches insert unchanged. The dual-write to machine_filesystems
-- now only carries (machine_id, path, owner, permissions).
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
      machine_id, path, owner, permissions, updated_at
    ) VALUES (
      p_machine_id, p_path, p_owner, p_permissions, NOW()
    )
    ON CONFLICT (machine_id, path) DO UPDATE SET
      owner = EXCLUDED.owner,
      permissions = EXCLUDED.permissions,
      updated_at = NOW();
  END IF;
END;
$$;

-- Drop the columns now that no function references them.
ALTER TABLE machine_filesystems DROP COLUMN content;
ALTER TABLE machine_filesystems DROP COLUMN node_type;
