-- email_send: a message from whoever holds a password, delivered into another inbox.
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
-- Security posture, as email_inbox's: EXECUTE taken from PUBLIC, anon and authenticated
-- and granted to service_role alone.

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
