-- email_inbox and email_read: an inbox, and one message in it, opened to whoever holds its
-- password.
--
-- The server keeps no mail session. Every request carries a handle and the md5 of a
-- password, checked here each time, so a changed password cuts off every holder of the
-- old one at once.
--
-- Wrong passwords are held back per guesser, not per account. email_login_failures keeps
-- one row for every failed check, by the key of the player who made it, whatever handle
-- it was for. A player with 5 failures in the last minute has every password check
-- refused until the oldest of them is a minute old: guessing online works, slowly, and
-- nobody can lock anybody else out of their mail by guessing at it. A refused check is
-- not a check, so it adds no failure. Rows older than a minute count for nothing and are
-- cleared as the player's next check runs.
--
-- email_check_password does the check for both functions, under a lock on the player's
-- key, so parallel guesses queue rather than all reading the same count and slipping
-- past it. It answers with a word:
--
--   ok            the password is the account's.
--   login_failed  the password is wrong, or nobody holds the handle. One answer for both,
--                 so a login cannot tell a free handle from a taken one. Counted.
--   throttled     the player has failed 5 times in the last minute. Nothing is checked.
--
-- email_inbox answers with JSON:
--
--   {"outcome": "opened", "messages": [...]}  the password is the account's. Every
--            message in the inbox, oldest first, as a list shows it: its number, sender,
--            subject, when it was delivered, and whether it has been read.
--   {"outcome": "login_failed"} or {"outcome": "throttled"}  as the check answered.
--
-- email_read answers with JSON:
--
--   {"outcome": "opened", "message": {...}}  the password is the account's and the inbox
--            holds a message by that number: its number, sender, subject, when it was
--            delivered, and its body. It is marked read in the same step, so everyone
--            holding the password sees it as read from now on.
--   {"outcome": "login_failed"} or {"outcome": "throttled"}  as the check answered.
--   {"outcome": "no_message"}  the inbox holds nothing by that number. Asked only after
--            the password, so it tells nobody without the password anything.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as email_signup's: RLS on the table with no policies, and EXECUTE on
-- every function taken from PUBLIC, anon and authenticated and granted to service_role
-- alone. The Vercel function is the only caller, and it calls only for a request whose
-- signature it has checked.

CREATE TABLE email_login_failures (
  player_key  TEXT         NOT NULL CHECK (player_key ~ '^[0-9a-f]{64}$'),
  failed_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX email_login_failures_player_key_idx
  ON email_login_failures (player_key, failed_at);

ALTER TABLE email_login_failures ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.

CREATE FUNCTION email_check_password(
  check_handle        TEXT,
  check_password_md5  TEXT,
  check_player_key    TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('email_login:' || check_player_key, 0));

  DELETE FROM email_login_failures
    WHERE player_key = check_player_key
      AND failed_at <= now() - INTERVAL '1 minute';

  IF (
    SELECT count(*) FROM email_login_failures WHERE player_key = check_player_key
  ) >= 5 THEN
    RETURN 'throttled';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM email_accounts
      WHERE handle = check_handle
        AND password_md5 = check_password_md5
  ) THEN
    RETURN 'ok';
  END IF;

  INSERT INTO email_login_failures (player_key) VALUES (check_player_key);
  RETURN 'login_failed';
END;
$$;

REVOKE EXECUTE ON FUNCTION email_check_password(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_check_password(TEXT, TEXT, TEXT) TO service_role;

CREATE FUNCTION email_inbox(
  inbox_handle        TEXT,
  inbox_password_md5  TEXT,
  inbox_player_key    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  checked TEXT;
BEGIN
  checked := email_check_password(inbox_handle, inbox_password_md5, inbox_player_key);
  IF checked <> 'ok' THEN
    RETURN jsonb_build_object('outcome', checked);
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'opened',
    'messages', COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'number', number,
                   'sender', sender,
                   'subject', subject,
                   'delivered_at', delivered_at,
                   'read', read
                 )
                 ORDER BY number
               )
          FROM email_messages
          WHERE handle = inbox_handle
      ),
      '[]'::jsonb
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION email_inbox(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_inbox(TEXT, TEXT, TEXT) TO service_role;

CREATE FUNCTION email_read(
  read_handle        TEXT,
  read_password_md5  TEXT,
  read_player_key    TEXT,
  read_number        INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  checked TEXT;
  opened email_messages;
BEGIN
  checked := email_check_password(read_handle, read_password_md5, read_player_key);
  IF checked <> 'ok' THEN
    RETURN jsonb_build_object('outcome', checked);
  END IF;

  UPDATE email_messages
     SET read = true
   WHERE handle = read_handle
     AND number = read_number
  RETURNING * INTO opened;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_message');
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'opened',
    'message', jsonb_build_object(
      'number', opened.number,
      'sender', opened.sender,
      'subject', opened.subject,
      'delivered_at', opened.delivered_at,
      'body', opened.body
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION email_read(TEXT, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_read(TEXT, TEXT, TEXT, INTEGER) TO service_role;
