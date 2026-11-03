-- hireme completion: a contractor mails the key to the client's handle, and the client pays.
--
-- A client has no inbox. A mail to a client handle is read by the server as it is sent and
-- answered in the sender's inbox, so nothing here stores the mail itself; the missions table
-- is where completion lives, and the mint's own ledger row is the record of the payout.
--
-- email_count_send is the 20-sends-an-hour rule, moved out of email_send so a proof mail is
-- counted by exactly the rule any mail is: one row per send by the key of the player who
-- made it, a rolling hour, the count read and written under a lock on that key so parallel
-- sends queue rather than all reading the same count. It answers true when the send was
-- counted and false when the player has already sent 20 in the last hour (nothing counted).
-- email_send is redefined to call it and otherwise answers exactly as before.
--
-- hireme_proof_open checks the sender's password as email_send checks it, then counts the
-- send, and answers as JSON:
--   {"outcome": "opened", "jobs": [{"number": n, "state": "accepted" | "completed"}, ...]}
--   {"outcome": "login_failed"}, {"outcome": "throttled"} or {"outcome": "send_limited"}
-- Only accepted and completed jobs are listed: a dropped job is no contract.
--
-- hireme_complete closes a job as completed and answers with a word:
--   completed     the number was the handle's accepted job. It is now completed, the pay is
--                 minted to the wallet when one was given (an empty wallet is none), and the
--                 client's reply is the inbox's next message, all in one transaction. A mint
--                 the ledger refuses raises, taking the completion back with it.
--   already_done  the number is the handle's completed job. Nothing is written.
--   no_contract   anything else (another's job, a dropped one, an offer). Nothing is written.
-- It runs under the lock on the handle's `email_accounts` row that accepting and dropping
-- take, so two right mails sent together complete the job once: the second finds it
-- completed and answers already_done, and the job pays once.
--
-- hireme_client_reply delivers one of the client's other replies and answers `replied`.
--
-- Replies are system mail, so the 100-message cap `email_send` keeps does not stop them, as
-- the briefing is not stopped.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as the boards': EXECUTE taken from PUBLIC, anon and authenticated and
-- granted to service_role alone. The Vercel function is the only caller, and it calls only
-- for a request whose signature it has checked.

CREATE FUNCTION email_count_send(count_player_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('email_send:' || count_player_key, 0));

  DELETE FROM email_sends
    WHERE player_key = count_player_key
      AND sent_at <= now() - INTERVAL '1 hour';

  IF (SELECT count(*) FROM email_sends WHERE player_key = count_player_key) >= 20 THEN
    RETURN false;
  END IF;

  INSERT INTO email_sends (player_key) VALUES (count_player_key);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION email_send(
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

  INSERT INTO email_messages (handle, number, sender, subject, body)
  VALUES (send_to, recipient.next_number, send_handle || '@emailit.io', send_subject, send_body);
  UPDATE email_accounts SET next_number = next_number + 1 WHERE handle = send_to;

  RETURN jsonb_build_object('outcome', 'sent');
END;
$$;

CREATE FUNCTION hireme_proof_open(
  open_handle        TEXT,
  open_password_md5  TEXT,
  open_player_key    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  checked TEXT;
BEGIN
  checked := email_check_password(open_handle, open_password_md5, open_player_key);
  IF checked <> 'ok' THEN
    RETURN jsonb_build_object('outcome', checked);
  END IF;

  IF NOT email_count_send(open_player_key) THEN
    RETURN jsonb_build_object('outcome', 'send_limited');
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'opened',
    'jobs', coalesce(
      (
        SELECT jsonb_agg(jsonb_build_object('number', number, 'state', state) ORDER BY number)
        FROM hireme_missions
        WHERE handle = open_handle AND state IN ('accepted', 'completed')
      ),
      '[]'::jsonb
    )
  );
END;
$$;

CREATE FUNCTION hireme_complete(
  complete_handle  TEXT,
  complete_number  INTEGER,
  complete_wallet  TEXT,
  complete_pay     BIGINT,
  mail_sender      TEXT,
  mail_subject     TEXT,
  mail_body        TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  contractor  email_accounts%ROWTYPE;
BEGIN
  SELECT * INTO contractor FROM email_accounts WHERE handle = complete_handle FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_contract';
  END IF;

  IF EXISTS (
    SELECT 1 FROM hireme_missions
    WHERE number = complete_number AND handle = complete_handle AND state = 'completed'
  ) THEN
    RETURN 'already_done';
  END IF;

  UPDATE hireme_missions SET state = 'completed', closed_at = now()
  WHERE number = complete_number AND handle = complete_handle AND state = 'accepted';
  IF NOT FOUND THEN
    RETURN 'no_contract';
  END IF;

  -- Nested, not `AND`: SQL does not promise to test the wallet before minting to it.
  IF complete_wallet <> '' THEN
    IF wallet_mint(complete_wallet, complete_pay) IS NULL THEN
      RAISE EXCEPTION 'hireme_complete: the ledger refused to mint % to %',
        complete_pay, complete_wallet;
    END IF;
  END IF;

  INSERT INTO email_messages (handle, number, sender, subject, body)
  VALUES (complete_handle, contractor.next_number, mail_sender, mail_subject, mail_body);
  UPDATE email_accounts SET next_number = next_number + 1 WHERE handle = complete_handle;

  RETURN 'completed';
END;
$$;

CREATE FUNCTION hireme_client_reply(
  reply_handle  TEXT,
  mail_sender   TEXT,
  mail_subject  TEXT,
  mail_body     TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  contractor  email_accounts%ROWTYPE;
BEGIN
  SELECT * INTO contractor FROM email_accounts WHERE handle = reply_handle FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO email_messages (handle, number, sender, subject, body)
  VALUES (reply_handle, contractor.next_number, mail_sender, mail_subject, mail_body);
  UPDATE email_accounts SET next_number = next_number + 1 WHERE handle = reply_handle;

  RETURN 'replied';
END;
$$;

REVOKE EXECUTE ON FUNCTION email_count_send(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_count_send(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION hireme_proof_open(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hireme_proof_open(TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION hireme_complete(TEXT, INTEGER, TEXT, BIGINT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hireme_complete(TEXT, INTEGER, TEXT, BIGINT, TEXT, TEXT, TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION hireme_client_reply(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hireme_client_reply(TEXT, TEXT, TEXT, TEXT) TO service_role;
