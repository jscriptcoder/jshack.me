-- talkit_writes and talkit_post: a player starts a thread on talkit.io, signed as an
-- emailit.io account, and no player writes more than 20 posts and comments an hour.
--
-- The poster proves the handle by its password, checked as email_inbox checks it
-- (email_check_password, the guess throttle included), so a post is one more thing a
-- stolen password buys. The thread is signed with that handle and nothing else the
-- poster names; the server stamps when it went up, and it starts the list's activity.
--
-- The title and body arrive already checked by the handler (one line of 1 to 80
-- characters, 1 to 4000, no control character but a body's line breaks) and are stored
-- as typed. talkit_threads' CHECKs hold the same rules whatever calls this, so a post
-- that slipped past the handler fails here and stores nothing.
--
-- It answers with JSON:
--
--   {"outcome": "posted", "id": <n>}  the thread is up, as thread n.
--   {"outcome": "login_failed"} or {"outcome": "throttled"}  as the check answered.
--   {"outcome": "capped"}  the player has written 20 in the last hour. Nothing went up.
--
-- Writes are counted per player, not per handle: talkit_writes keeps one row for every
-- post by the key of the player who made it, under whichever handle, so stolen handles
-- buy no extra. Comments will count in the same table. A rolling window, as email_send's
-- is: rows older than an hour count for nothing and are cleared as the player's next post
-- runs, under a lock on the player's key, so parallel posts queue rather than all reading
-- the same count and slipping past it. A failed or throttled login is no post and counts
-- nothing.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as emailit's: RLS on the table with no policies, and EXECUTE on the
-- function taken from PUBLIC, anon and authenticated and granted to service_role alone.

CREATE TABLE talkit_writes (
  player_key  TEXT         NOT NULL CHECK (player_key ~ '^[0-9a-f]{64}$'),
  written_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX talkit_writes_player_key_idx ON talkit_writes (player_key, written_at);

ALTER TABLE talkit_writes ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.

CREATE FUNCTION talkit_post(
  post_handle        TEXT,
  post_password_md5  TEXT,
  post_player_key    TEXT,
  post_title         TEXT,
  post_body          TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  checked TEXT;
  posted_id BIGINT;
BEGIN
  checked := email_check_password(post_handle, post_password_md5, post_player_key);
  IF checked <> 'ok' THEN
    RETURN jsonb_build_object('outcome', checked);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('talkit_write:' || post_player_key, 0));

  DELETE FROM talkit_writes
    WHERE player_key = post_player_key
      AND written_at <= now() - INTERVAL '1 hour';

  IF (SELECT count(*) FROM talkit_writes WHERE player_key = post_player_key) >= 20 THEN
    RETURN jsonb_build_object('outcome', 'capped');
  END IF;

  INSERT INTO talkit_threads (author, title, body)
  VALUES (post_handle, post_title, post_body)
  RETURNING id INTO posted_id;
  INSERT INTO talkit_writes (player_key) VALUES (post_player_key);

  RETURN jsonb_build_object('outcome', 'posted', 'id', posted_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION talkit_post(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION talkit_post(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
