-- email_inbox and email_read: an inbox, and one message in it, opened to whoever holds its
-- password.
--
-- The server keeps no mail session. Every request carries a handle and the md5 of a
-- password, checked here each time, so a changed password cuts off every holder of the
-- old one at once.
--
-- email_inbox answers with JSON:
--
--   {"outcome": "opened", "messages": [...]}  the password is the account's. Every
--            message in the inbox, oldest first, as a list shows it: its number, sender,
--            subject, when it was delivered, and whether it has been read.
--   {"outcome": "login_failed"}  the password is wrong, or nobody holds the handle. One
--            answer for both, so a login cannot tell a free handle from a taken one.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as email_signup's: EXECUTE is taken from PUBLIC, anon and
-- authenticated and granted to service_role alone. The Vercel function is the only
-- caller, and it calls only for a request whose signature it has checked.

CREATE FUNCTION email_inbox(
  inbox_handle        TEXT,
  inbox_password_md5  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM email_accounts
      WHERE handle = inbox_handle
        AND password_md5 = inbox_password_md5
  ) THEN
    RETURN jsonb_build_object('outcome', 'login_failed');
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

REVOKE EXECUTE ON FUNCTION email_inbox(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_inbox(TEXT, TEXT) TO service_role;

-- email_read: one message opened to whoever holds the inbox's password, and marked read.
--
-- email_read answers with JSON:
--
--   {"outcome": "opened", "message": {...}}  the password is the account's and the inbox
--            holds a message by that number: its number, sender, subject, when it was
--            delivered, and its body. It is marked read in the same step, so everyone
--            holding the password sees it as read from now on.
--   {"outcome": "login_failed"}  as email_inbox answers it.
--   {"outcome": "no_message"}  the inbox holds nothing by that number. Asked only after
--            the password, so it tells nobody without the password anything.

CREATE FUNCTION email_read(
  read_handle        TEXT,
  read_password_md5  TEXT,
  read_number        INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  opened email_messages;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM email_accounts
      WHERE handle = read_handle
        AND password_md5 = read_password_md5
  ) THEN
    RETURN jsonb_build_object('outcome', 'login_failed');
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

REVOKE EXECUTE ON FUNCTION email_read(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_read(TEXT, TEXT, INTEGER) TO service_role;
