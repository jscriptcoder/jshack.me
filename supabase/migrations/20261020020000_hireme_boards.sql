-- hireme_boards and hireme_apply: the contractor boards hireme.io mails out.
--
-- A board belongs to an emailit.io handle, not to a player: whoever holds the mailbox
-- holds the board. Its address is drawn once, in the 194 block nothing else in the world
-- answers from, and kept for good, so a re-sent mail names the address already held and
-- an address that leaked stays leaked. hireme.io's box is a machine like any other,
-- attackable and brickable, and a restore wipes only its journal, so nothing here is lost
-- with it.
--
-- `applied_at` is when the board was made; `mailed_at` is when its address was last
-- mailed, which is what the 24-hour window counts from.
--
-- hireme_apply decides an application in ONE transaction and answers with a word:
--
--   no_mailbox  no account holds the handle. Nothing is written.
--   recent      the handle was mailed in the last 24 hours. Nothing is written.
--   collision   the handle has no board, and somebody else's board is at the address
--               offered. Nothing is written; the caller draws another.
--   sent        the handle's board, found or made at the address offered, has its
--               address mailed as the inbox's next message.
--
-- The mail body arrives with `{address}` where the address goes, and the function writes
-- the board's own address there: on a re-send that is the address held, never the one just
-- offered. The mail is system mail, so the 100-message cap that `email_send` keeps does not
-- stop it.
--
-- The applicant's account row is locked while its next number is taken, as `email_send`
-- locks a recipient's, so two applications for one handle queue rather than both reading
-- no board and no recent mail, and a mail arriving at once takes another number. Two
-- handles offered one address at once are settled by the UNIQUE: one makes its board and
-- the other is told `collision`.
--
-- The CHECK is the rule that must hold whichever function writes: an address is
-- 194.<0-255>.<0-255>.<2-254>, the last octet as every host address in the world.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as email's: RLS on with no policies, so anon and authenticated are
-- denied, and EXECUTE on the function is taken from PUBLIC, anon and authenticated and
-- granted to service_role alone. The Vercel function is the only caller, and it calls only
-- for a request whose signature it has checked.

CREATE TABLE hireme_boards (
  handle      TEXT         PRIMARY KEY REFERENCES email_accounts (handle) ON DELETE CASCADE,
  address     TEXT         NOT NULL UNIQUE CHECK (
    address ~ '^194\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(25[0-4]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[2-9])$'
  ),
  applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  mailed_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE hireme_boards ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.

CREATE FUNCTION hireme_apply(
  apply_handle       TEXT,
  candidate_address  TEXT,
  mail_sender        TEXT,
  mail_subject       TEXT,
  mail_body          TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  applicant  email_accounts%ROWTYPE;
  board      hireme_boards%ROWTYPE;
BEGIN
  SELECT * INTO applicant FROM email_accounts WHERE handle = apply_handle FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_mailbox';
  END IF;

  SELECT * INTO board FROM hireme_boards WHERE handle = apply_handle;
  IF FOUND THEN
    IF board.mailed_at > now() - INTERVAL '24 hours' THEN
      RETURN 'recent';
    END IF;
    UPDATE hireme_boards SET mailed_at = now() WHERE handle = apply_handle;
  ELSE
    INSERT INTO hireme_boards (handle, address)
    VALUES (apply_handle, candidate_address)
    ON CONFLICT (address) DO NOTHING
    RETURNING * INTO board;
    IF NOT FOUND THEN
      RETURN 'collision';
    END IF;
  END IF;

  INSERT INTO email_messages (handle, number, sender, subject, body)
  VALUES (
    apply_handle,
    applicant.next_number,
    mail_sender,
    mail_subject,
    replace(mail_body, '{address}', board.address)
  );
  UPDATE email_accounts SET next_number = next_number + 1 WHERE handle = apply_handle;

  RETURN 'sent';
END;
$$;

REVOKE EXECUTE ON FUNCTION hireme_apply(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hireme_apply(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
