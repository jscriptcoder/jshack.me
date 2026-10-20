-- talkit_comments and talkit_comment: a player comments on a thread at talkit.io, signed
-- as an emailit.io account, under the same 20-an-hour cap as a post.
--
-- A comment is numbered within its thread (#1, #2 ...) so players can point at one. The
-- number is the thread's comment_count once this comment is counted: the UPDATE that
-- counts it also locks the thread's row, so two comments on one thread queue for it and
-- are numbered one after the other, never the same. Numbering this way holds only while
-- nothing lowers the count, and a removed comment keeps its number.
--
-- The same UPDATE moves the thread's last_activity_at to now, so a comment bumps its
-- thread to the top of the list.
--
-- `author` and `body` hold the rules a thread's do, whatever function is writing: the
-- handle shape, and 1 to 4000 characters with no control character but a line break.
-- `thread_id` names a thread that exists. How a removed thread takes its comments with it
-- is decided where removal is.
--
-- It answers with JSON:
--
--   {"outcome": "commented", "number": <n>}  the comment is up, as #n on its thread.
--   {"outcome": "login_failed"} or {"outcome": "throttled"}  as the check answered.
--   {"outcome": "capped"}  the player has written 20 in the last hour. Nothing went up.
--   {"outcome": "no_thread"}  no thread has that id. Nothing went up, nothing counted.
--
-- The cap is talkit_post's, in its table: one talkit_writes row for every post and every
-- comment, by the key of the player who wrote it, under the same lock on the key.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as talkit_post's: RLS on the table with no policies, and EXECUTE on
-- the function taken from PUBLIC, anon and authenticated and granted to service_role alone.

CREATE TABLE talkit_comments (
  thread_id   BIGINT       NOT NULL REFERENCES talkit_threads (id),
  number      INTEGER      NOT NULL CHECK (number >= 1),
  author      TEXT         NOT NULL CHECK (author ~ '^[a-z][a-z0-9_-]{0,23}$'),
  body        TEXT         NOT NULL CHECK (
                             char_length(body) BETWEEN 1 AND 4000
                             AND body !~ '[\x01-\x09\x0B-\x1F\x7F]'
                           ),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, number)
);

ALTER TABLE talkit_comments ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.

CREATE FUNCTION talkit_comment(
  comment_handle        TEXT,
  comment_password_md5  TEXT,
  comment_player_key    TEXT,
  comment_thread_id     BIGINT,
  comment_body          TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  checked TEXT;
  comment_number INTEGER;
BEGIN
  checked := email_check_password(comment_handle, comment_password_md5, comment_player_key);
  IF checked <> 'ok' THEN
    RETURN jsonb_build_object('outcome', checked);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('talkit_write:' || comment_player_key, 0));

  DELETE FROM talkit_writes
    WHERE player_key = comment_player_key
      AND written_at <= now() - INTERVAL '1 hour';

  IF (SELECT count(*) FROM talkit_writes WHERE player_key = comment_player_key) >= 20 THEN
    RETURN jsonb_build_object('outcome', 'capped');
  END IF;

  UPDATE talkit_threads
    SET comment_count = comment_count + 1,
        last_activity_at = now()
    WHERE id = comment_thread_id
    RETURNING comment_count INTO comment_number;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_thread');
  END IF;

  INSERT INTO talkit_comments (thread_id, number, author, body)
  VALUES (comment_thread_id, comment_number, comment_handle, comment_body);
  INSERT INTO talkit_writes (player_key) VALUES (comment_player_key);

  RETURN jsonb_build_object('outcome', 'commented', 'number', comment_number);
END;
$$;

REVOKE EXECUTE ON FUNCTION talkit_comment(TEXT, TEXT, TEXT, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION talkit_comment(TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;
