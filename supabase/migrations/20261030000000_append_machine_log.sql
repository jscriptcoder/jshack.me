-- append_machine_log: the system adds a line to a machine's log without dropping a line
-- another append wrote at the same moment.
--
-- A log line goes on the end of the log as a READER sees it: the latest row at the path
-- across every writer (a root's wipe under the root's own key included), so a wiped log
-- stays wiped and the next line builds on it. Read in the server and written back, two
-- appends at once built on the same copy and the later one dropped the earlier line.
-- Here the read and the write happen under one lock on the log's (machine_id, path), so
-- parallel appends queue and each builds on the one before.
--
-- The latest row is picked as `orderPatchesForReplay` (src/core/patches) picks it:
-- updated_at, then writer_key on a same-instant tie. That tiebreak is a JS code-unit
-- compare; COLLATE "C" makes Postgres compare bytes, so a tie breaks the same way here.
-- A deletion marker (content IS NULL) is no log: the line starts a new one.
--
-- VOLATILE (the default) on purpose: under READ COMMITTED a volatile function takes a
-- fresh snapshot for each statement, so the read after the lock sees the append that held
-- it. Marked STABLE, the read would use the snapshot from before the wait and drop that
-- line all over again.
--
-- updated_at is stamped by clock_timestamp() from here on, by the trigger and the column
-- default alike. NOW() is the transaction's START: an append that waited on the lock
-- would otherwise stamp its row earlier than the row it built on, and a reader would rank
-- it below. Every other write goes through PostgREST as a transaction of its own, so it
-- stamps what it stamped before.
--
-- Security posture, as talkit_post's: EXECUTE taken from PUBLIC, anon and authenticated
-- and granted to service_role alone, which the Vercel function calls with.

CREATE OR REPLACE FUNCTION patches_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE patches ALTER COLUMN updated_at SET DEFAULT clock_timestamp();

CREATE FUNCTION append_machine_log(
  append_machine_id   TEXT,
  append_path         TEXT,
  append_writer_key   TEXT,
  append_owner        TEXT,
  append_permissions  JSONB,
  append_text         TEXT
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  current_log TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('machine_log:' || append_machine_id || ':' || append_path, 0)
  );

  SELECT content INTO current_log
    FROM patches
    WHERE machine_id = append_machine_id AND path = append_path
    ORDER BY updated_at DESC, writer_key COLLATE "C" DESC
    LIMIT 1;

  INSERT INTO patches (machine_id, path, writer_key, content, owner, permissions, node_type)
  VALUES (
    append_machine_id,
    append_path,
    append_writer_key,
    COALESCE(current_log, '') || append_text,
    append_owner,
    append_permissions,
    'file'
  )
  ON CONFLICT (machine_id, path, writer_key) DO UPDATE SET
    content = EXCLUDED.content,
    owner = EXCLUDED.owner,
    permissions = EXCLUDED.permissions,
    node_type = EXCLUDED.node_type;
END;
$$;

REVOKE EXECUTE ON FUNCTION append_machine_log(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION append_machine_log(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  TO service_role;
