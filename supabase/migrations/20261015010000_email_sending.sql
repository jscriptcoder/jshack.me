-- email_sends and email_send: a message from whoever holds a password, delivered into
-- another inbox, and no more than 20 an hour from any one player. And email_read, which
-- learns to open a message without marking it read, for a reply to quote.
--
-- The sender proves the address by its password, checked as email_inbox checks it
-- (email_check_password, the guess throttle included), so a send is one more thing a
-- stolen password buys. The message is stored as from `<handle>@emailit.io`; the sender
-- names nothing else about it, and the server stamps when it arrived.
--
-- A message lives in the recipient's inbox alone: there is no Sent folder, and the
-- sender keeps no copy.
--
-- It answers with JSON:
--
--   {"outcome": "sent"}          delivered, at the recipient's next number.
--   {"outcome": "login_failed"} or {"outcome": "throttled"}  as the check answered.
--   {"outcome": "no_mailbox"}    nobody holds the recipient's handle. A system sender
--            (`noreply`) holds no account, so a reply to one ends here.
--   {"outcome": "mailbox_full"}  the recipient's inbox already holds 100 messages.
--   {"outcome": "send_limited"}  the player has sent 20 in the last hour. Nothing went.
--
-- Sends are counted per sender, not per account: email_sends keeps one row for every
-- send by the key of the player who made it, from whichever address. A player with 20 in
-- the last hour has every send refused until the oldest is an hour old, a rolling window
-- with no reset on the hour to time a script against. A bounce is a send and counts, so
-- probing handles by mailing them is held to 20 an hour as well. A failed or throttled
-- login is no send and counts nothing; a refused send counts nothing either. Rows older
-- than an hour count for nothing and are cleared as the player's next send runs, under a
-- lock on the player's key, so parallel sends queue rather than all reading the same
-- count and slipping past it.
--
-- The cap is a rule of player mail only. System mail is written by other functions
-- (email_signup's welcome) that never look at it, so nobody can fill an inbox to keep a
-- system message out.
--
-- The recipient's account row is locked while its number is taken, so two messages
-- arriving at once take two numbers, and the count against the cap cannot be read by both
-- before either lands.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as email_inbox's: RLS on the table with no policies, and EXECUTE on
-- the function taken from PUBLIC, anon and authenticated and granted to service_role
-- alone.

CREATE TABLE email_sends (
  player_key  TEXT         NOT NULL CHECK (player_key ~ '^[0-9a-f]{64}$'),
  sent_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX email_sends_player_key_idx ON email_sends (player_key, sent_at);

ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.

CREATE FUNCTION email_send(
  send_handle        TEXT,
  send_password_md5  TEXT,
  send_player_key    TEXT,
  send_to            TEXT,
  send_subject       TEXT,
  send_body          TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  checked TEXT;
  recipient email_accounts;
BEGIN
  checked := email_check_password(send_handle, send_password_md5, send_player_key);
  IF checked <> 'ok' THEN
    RETURN jsonb_build_object('outcome', checked);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('email_send:' || send_player_key, 0));

  DELETE FROM email_sends
    WHERE player_key = send_player_key
      AND sent_at <= now() - INTERVAL '1 hour';

  IF (SELECT count(*) FROM email_sends WHERE player_key = send_player_key) >= 20 THEN
    RETURN jsonb_build_object('outcome', 'send_limited');
  END IF;

  INSERT INTO email_sends (player_key) VALUES (send_player_key);

  SELECT * INTO recipient FROM email_accounts WHERE handle = send_to FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_mailbox');
  END IF;

  IF (SELECT count(*) FROM email_messages WHERE handle = send_to) >= 100 THEN
    RETURN jsonb_build_object('outcome', 'mailbox_full');
  END IF;

  INSERT INTO email_messages (handle, number, sender, subject, body)
  VALUES (send_to, recipient.next_number, send_handle || '@emailit.io', send_subject, send_body);
  UPDATE email_accounts SET next_number = next_number + 1 WHERE handle = send_to;

  RETURN jsonb_build_object('outcome', 'sent');
END;
$$;

REVOKE EXECUTE ON FUNCTION email_send(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_send(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- email_read, again, with read_mark: whether opening the message marks it read. `mail
-- read` marks it; a reply that only quotes the message it answers does not, so replying
-- leaves the inbox's marks as it found them. Otherwise as before: the password is
-- checked first, and a number the inbox does not hold answers no_message.

DROP FUNCTION email_read(TEXT, TEXT, TEXT, INTEGER);

CREATE FUNCTION email_read(
  read_handle        TEXT,
  read_password_md5  TEXT,
  read_player_key    TEXT,
  read_number        INTEGER,
  read_mark          BOOLEAN
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

  IF read_mark THEN
    UPDATE email_messages
       SET read = true
     WHERE handle = read_handle
       AND number = read_number
    RETURNING * INTO opened;
  ELSE
    SELECT * INTO opened
      FROM email_messages
     WHERE handle = read_handle
       AND number = read_number;
  END IF;
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

REVOKE EXECUTE ON FUNCTION email_read(TEXT, TEXT, TEXT, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_read(TEXT, TEXT, TEXT, INTEGER, BOOLEAN) TO service_role;
