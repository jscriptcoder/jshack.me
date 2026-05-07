-- Selective content projection on machine_filesystems.
--
-- 20260503210309_drop_machine_fs_unused_columns dropped the `content`
-- column because L2 enforcement consumes only `permissions` — projecting
-- content for every patched file was dead weight (the patches table is
-- the canonical content store, per-player).
--
-- Server-side userType validation (createSession; see plans/etc-passwd-
-- canonical.md step 5) needs the server to read the live /etc/passwd
-- content at session-create time. /etc/passwd is shared per machine
-- (machine_filesystems is the natural projection), but other paths
-- still don't need content.
--
-- Resolution: re-add content as nullable, gated by a TS-side allowlist
-- (src/machineFilesystems/projectedContentPaths.ts). The dual-write
-- function takes a new BOOLEAN parameter — true only when the caller
-- determined the path is in the allowlist. False keeps the column NULL.
--
-- The bulk of patched files (logs, configs, scripts) keeps content =
-- NULL and the original storage concern is preserved. Adding a new
-- path to the projection later is a one-line TS change — no migration.
--
-- See:
--   - src/machineFilesystems/projectedContentPaths.ts (allowlist)
--   - src/patchRegistry/supabaseUpsert.ts (TS caller passes the flag)
--   - src/sessionRegistry/* (consumer — step 5b)

-- Re-add the column, nullable. Existing rows get NULL.
ALTER TABLE machine_filesystems ADD COLUMN content TEXT;

-- Recreate upsert_patch_with_fs with an additional parameter that gates
-- the content projection. The patches table still receives full content
-- (it's the canonical content store); only the machine_filesystems
-- dual-write is gated.
--
-- Order: drop the old function first (different signature ⇒ different
-- function in Postgres). REVOKE/GRANT must be re-applied to the new
-- signature.
DROP FUNCTION IF EXISTS upsert_patch_with_fs(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT, BOOLEAN
);

CREATE FUNCTION upsert_patch_with_fs(
  p_player_key         TEXT,
  p_machine_id         TEXT,
  p_path               TEXT,
  p_content            TEXT,
  p_owner              TEXT,
  p_permissions        JSONB,
  p_is_new             BOOLEAN,
  p_node_type          TEXT,
  p_dual_write         BOOLEAN,
  p_project_fs_content BOOLEAN
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
      machine_id, path, owner, permissions, content, updated_at
    ) VALUES (
      p_machine_id, p_path, p_owner, p_permissions,
      CASE WHEN p_project_fs_content THEN p_content ELSE NULL END,
      NOW()
    )
    ON CONFLICT (machine_id, path) DO UPDATE SET
      owner = EXCLUDED.owner,
      permissions = EXCLUDED.permissions,
      content = EXCLUDED.content,
      updated_at = NOW();
  END IF;
END;
$$;

-- Lock down execution: only service_role can call. Mirrors the
-- 20260502230000_l2_dual_write_functions migration.
REVOKE EXECUTE ON FUNCTION upsert_patch_with_fs(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT, BOOLEAN, BOOLEAN
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_patch_with_fs(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT, BOOLEAN, BOOLEAN
) TO service_role;
