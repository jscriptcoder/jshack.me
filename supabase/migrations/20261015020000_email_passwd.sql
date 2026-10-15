-- email_passwd: an account given a new password by whoever holds the old one.
--
-- The old password is checked as every mail request checks it (email_check_password, the
-- guess throttle included), so a wrong one counts as a failed guess. The server keeps no
-- mail session: once the hash changes, every holder of the old password is cut off at
-- their next request, a saved ~/.mailrc anywhere included. Messages, their numbers and
-- their read marks stay as they were.
--
-- Two changes at once: the account's row is locked before the check, so the second waits
-- for the first, then checks its old password against the hash the first left. Whoever
-- changes it first keeps the account, and the second is told its login failed.
--
-- It answers with JSON:
--
--   {"outcome": "changed"}       the account's hash is now new_md5.
--   {"outcome": "login_failed"} or {"outcome": "throttled"}  as the check answered.

CREATE FUNCTION email_passwd(
  passwd_handle        TEXT,
  passwd_password_md5  TEXT,
  passwd_player_key    TEXT,
  passwd_new_md5       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  checked TEXT;
BEGIN
  PERFORM 1 FROM email_accounts WHERE handle = passwd_handle FOR UPDATE;

  checked := email_check_password(passwd_handle, passwd_password_md5, passwd_player_key);
  IF checked <> 'ok' THEN
    RETURN jsonb_build_object('outcome', checked);
  END IF;

  UPDATE email_accounts
     SET password_md5 = passwd_new_md5
   WHERE handle = passwd_handle;

  RETURN jsonb_build_object('outcome', 'changed');
END;
$$;

REVOKE EXECUTE ON FUNCTION email_passwd(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_passwd(TEXT, TEXT, TEXT, TEXT) TO service_role;
