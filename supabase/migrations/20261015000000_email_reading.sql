-- email_inbox: an inbox opened to whoever holds its password.
--
-- The server keeps no mail session. Every request carries a handle and the md5 of a
-- password, checked here each time, so a changed password cuts off every holder of the
-- old one at once.
--
-- It answers with JSON:
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
