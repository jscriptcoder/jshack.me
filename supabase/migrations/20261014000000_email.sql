-- email_accounts, email_messages and email_signup: the mail kept at emailit.io.
--
-- These tables are the truth about every address and every message. emailit.io's box
-- is a machine like any other, attackable and brickable, and a restore wipes only its
-- journal, so nothing here is lost with it.
--
-- An account is a handle and the md5 of its password, nothing more. `signed_up_by` is
-- the key of the player who made it, kept only to count their sign-ups: the address
-- belongs to whoever holds its password, not to that player.
--
-- A message lives in exactly one inbox. `number` is its place in that inbox, taken from
-- the account's `next_number` when it arrives and never reused, so a number a reader has
-- seen always means the same message.
--
-- email_signup opens an account and delivers its welcome as message 1 in ONE
-- transaction, so an address that exists always has its welcome waiting. It answers
-- with a word:
--
--   created  the account is open.
--   capped   the player has opened 3 accounts in the last 24 hours. Checked first, so
--            a capped player is told so whatever handle they ask for.
--   taken    somebody holds the handle. Of two sign-ups for one handle at once, exactly
--            one opens it and the other is told this.
--
-- Only an account that opens counts toward the 3. The count and the insert happen under
-- a lock on the player's key, so parallel sign-ups by one player queue rather than all
-- reading the same count and slipping past it.
--
-- The CHECKs are the rules that must hold whichever function is writing: a handle is a
-- lowercase name of 1 to 24 characters as the Intro form allows; a password hash is 32
-- lowercase hex characters; a key is 64; a subject is at most 80 characters and a body
-- at most 4000, counted as characters.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as the wallet's: RLS on with no policies, so anon and authenticated
-- are denied, and EXECUTE on the function is taken from PUBLIC, anon and authenticated
-- and granted to service_role alone. The Vercel function is the only caller, and it
-- calls only for a request whose signature it has checked.

CREATE TABLE email_accounts (
  handle         TEXT         PRIMARY KEY CHECK (handle ~ '^[a-z][a-z0-9_-]{0,23}$'),
  password_md5   TEXT         NOT NULL CHECK (password_md5 ~ '^[0-9a-f]{32}$'),
  signed_up_by   TEXT         NOT NULL CHECK (signed_up_by ~ '^[0-9a-f]{64}$'),
  signed_up_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  next_number    INTEGER      NOT NULL DEFAULT 1 CHECK (next_number >= 1)
);

CREATE INDEX email_accounts_signed_up_by_idx ON email_accounts (signed_up_by, signed_up_at);

ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.

CREATE TABLE email_messages (
  id            BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handle        TEXT         NOT NULL REFERENCES email_accounts (handle) ON DELETE CASCADE,
  number        INTEGER      NOT NULL CHECK (number >= 1),
  sender        TEXT         NOT NULL,
  subject       TEXT         NOT NULL CHECK (char_length(subject) <= 80),
  body          TEXT         NOT NULL CHECK (char_length(body) <= 4000),
  delivered_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  read          BOOLEAN      NOT NULL DEFAULT false,
  UNIQUE (handle, number)
);

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.

CREATE FUNCTION email_signup(
  signup_handle        TEXT,
  signup_password_md5  TEXT,
  signup_player_key    TEXT,
  welcome_sender       TEXT,
  welcome_subject      TEXT,
  welcome_body         TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('email_signup:' || signup_player_key, 0));

  IF (
    SELECT count(*)
      FROM email_accounts
      WHERE signed_up_by = signup_player_key
        AND signed_up_at > now() - INTERVAL '24 hours'
  ) >= 3 THEN
    RETURN 'capped';
  END IF;

  INSERT INTO email_accounts (handle, password_md5, signed_up_by, next_number)
  VALUES (signup_handle, signup_password_md5, signup_player_key, 2)
  ON CONFLICT (handle) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'taken';
  END IF;

  INSERT INTO email_messages (handle, number, sender, subject, body)
  VALUES (signup_handle, 1, welcome_sender, welcome_subject, welcome_body);

  RETURN 'created';
END;
$$;

REVOKE EXECUTE ON FUNCTION email_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
