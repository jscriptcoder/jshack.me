-- A briefing may carry one file: an infiltrate job's client sends the file it wants put on the
-- target with the briefing itself, so accepting is the one step that lays both.
--
-- hireme_accept takes the file as two more arguments and stores them on the briefing, as
-- email_send stores a sent file. It stays STRICT, so a missing argument still answers NULL and
-- runs nothing: a briefing with no file is accepted with an empty name, which no file may have,
-- and both are stored as NULL. The words it answers are unchanged.

DROP FUNCTION hireme_accept(TEXT, INTEGER, TEXT, TEXT, TEXT);

CREATE FUNCTION hireme_accept(
  accept_handle            TEXT,
  accept_number            INTEGER,
  mail_sender              TEXT,
  mail_subject             TEXT,
  mail_body                TEXT,
  mail_attachment_name     TEXT,
  mail_attachment_content  TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  contractor  email_accounts%ROWTYPE;
  carries     BOOLEAN := mail_attachment_name <> '';
BEGIN
  SELECT * INTO contractor FROM email_accounts WHERE handle = accept_handle FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'gone';
  END IF;

  IF EXISTS (
    SELECT 1 FROM hireme_missions WHERE handle = accept_handle AND state = 'accepted'
  ) THEN
    RETURN 'busy';
  END IF;

  UPDATE hireme_missions SET state = 'accepted', accepted_at = now()
  WHERE number = accept_number
    AND handle = accept_handle
    AND state = 'offered'
    AND posted_at > now() - INTERVAL '24 hours';
  IF NOT FOUND THEN
    RETURN 'gone';
  END IF;

  INSERT INTO email_messages (
    handle, number, sender, subject, body, attachment_name, attachment_content
  )
  VALUES (
    accept_handle, contractor.next_number, mail_sender, mail_subject, mail_body,
    CASE WHEN carries THEN mail_attachment_name END,
    CASE WHEN carries THEN mail_attachment_content END
  );
  UPDATE email_accounts SET next_number = next_number + 1 WHERE handle = accept_handle;

  RETURN 'accepted';
END;
$$;

REVOKE EXECUTE ON FUNCTION hireme_accept(TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hireme_accept(TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
