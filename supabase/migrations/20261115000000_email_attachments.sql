-- A message may carry one file: its name and its content, kept on the message itself, so a
-- delete takes the file with it and the spool reads both in the same row.
--
-- The name is a name and never a path, and the content is at most 8,000 characters. The
-- handler checks both before the store is asked (`handleResolveMail`); the constraints here
-- hold whatever reaches the table. A message carries both or neither. System mail (the
-- welcome, the boards' and the clients' replies) inserts neither and carries nothing.
--
-- email_send takes the file as two more arguments. It stays STRICT, so a missing argument
-- still answers NULL and runs nothing: a message with no file is sent with an empty name,
-- which no file may have, and both are stored as NULL. An empty content is a file, an empty
-- one.
--
-- email_read answers the file with the message, as {"name", "content"}, or null for a
-- message that carries none.

ALTER TABLE email_messages
  ADD COLUMN attachment_name    TEXT,
  ADD COLUMN attachment_content TEXT,
  ADD CONSTRAINT email_messages_attachment_whole
    CHECK ((attachment_name IS NULL) = (attachment_content IS NULL)),
  ADD CONSTRAINT email_messages_attachment_name
    CHECK (attachment_name <> '' AND position('/' IN attachment_name) = 0),
  ADD CONSTRAINT email_messages_attachment_size
    CHECK (char_length(attachment_content) <= 8000);

DROP FUNCTION email_send(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION email_send(
  send_handle              TEXT,
  send_password_md5        TEXT,
  send_player_key          TEXT,
  send_to                  TEXT,
  send_subject             TEXT,
  send_body                TEXT,
  send_attachment_name     TEXT,
  send_attachment_content  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  checked TEXT;
  recipient email_accounts;
  carries BOOLEAN := send_attachment_name <> '';
BEGIN
  checked := email_check_password(send_handle, send_password_md5, send_player_key);
  IF checked <> 'ok' THEN
    RETURN jsonb_build_object('outcome', checked);
  END IF;

  IF NOT email_count_send(send_player_key) THEN
    RETURN jsonb_build_object('outcome', 'send_limited');
  END IF;

  SELECT * INTO recipient FROM email_accounts WHERE handle = send_to FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_mailbox');
  END IF;

  IF (SELECT count(*) FROM email_messages WHERE handle = send_to) >= 100 THEN
    RETURN jsonb_build_object('outcome', 'mailbox_full');
  END IF;

  INSERT INTO email_messages (
    handle, number, sender, subject, body, attachment_name, attachment_content
  )
  VALUES (
    send_to,
    recipient.next_number,
    send_handle || '@emailit.io',
    send_subject,
    send_body,
    CASE WHEN carries THEN send_attachment_name END,
    CASE WHEN carries THEN send_attachment_content END
  );
  UPDATE email_accounts SET next_number = next_number + 1 WHERE handle = send_to;

  RETURN jsonb_build_object('outcome', 'sent');
END;
$$;

REVOKE EXECUTE ON FUNCTION email_send(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_send(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION email_read(
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
      'body', opened.body,
      'attachment', CASE
        WHEN opened.attachment_name IS NULL THEN NULL
        ELSE jsonb_build_object(
          'name', opened.attachment_name,
          'content', opened.attachment_content
        )
      END
    )
  );
END;
$$;
