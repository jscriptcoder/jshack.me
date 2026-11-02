-- hireme contracts: the board posts offers, a contractor accepts one, and drops it.
--
-- `ref` names an offer on its board. An offer's number IS its address, and an offer never
-- shows its address, so the Accept form posts the ref instead. Every offer a board posts
-- has one; the operator's directly accepted rows have none, so it is nullable. It is unique
-- per handle (NULLs are distinct, so the operator's rows never collide), and a page whose
-- offer has turned over is refused rather than accepting another job by its ref.
--
-- Each function decides in ONE transaction under the lock on the handle's `email_accounts`
-- row, the lock `hireme_apply` and `email_send` take, so a read, an accept and a drop for
-- one handle queue rather than interleave: two reads at once cannot post six offers, and
-- two accepts at once take one job and refuse the other.
--
-- hireme_post_offers tops a board up and answers with it as it now stands, as JSON:
--   { "offers": [{ "number": n, "ref": r }, ...], "current": n | null }
-- It burns the handle's offers posted 24 hours ago or more, then posts from the candidates
-- until the offers and the accepted job make three. A candidate whose number or ref is
-- already taken is skipped; a board left short is offered fresh candidates by the caller.
-- A burned number never becomes reachable (the lookup answers only accepted, completed and
-- abandoned numbers), and stays in the table so it is never drawn again.
--
-- hireme_accept answers with a word:
--   busy      the handle already holds an accepted job. Nothing is written.
--   gone      the number is not this handle's live offer (another's, burned, or posted 24
--             hours ago or more and not yet burned). Nothing is written.
--   accepted  the offer is the handle's job, and the briefing is the inbox's next message.
--
-- hireme_drop answers with a word:
--   no_contract  the number is not the handle's accepted job. Nothing is written.
--   dropped      the job is abandoned, and the client's line is the inbox's next message.
--
-- The mails are system mail, so the 100-message cap `email_send` keeps does not stop them,
-- as the board's own mail is not stopped.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as the boards': EXECUTE taken from PUBLIC, anon and authenticated and
-- granted to service_role alone. The Vercel function is the only caller, and it calls only
-- for a request whose signature it has checked.

ALTER TABLE hireme_missions ADD COLUMN ref TEXT;

CREATE UNIQUE INDEX hireme_missions_ref_per_handle ON hireme_missions (handle, ref);

CREATE FUNCTION hireme_post_offers(
  post_handle        TEXT,
  candidate_numbers  INTEGER[],
  candidate_refs     TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  slots_held  INTEGER;
  candidate   INTEGER;
BEGIN
  PERFORM 1 FROM email_accounts WHERE handle = post_handle FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE hireme_missions SET state = 'burned'
  WHERE handle = post_handle
    AND state = 'offered'
    AND posted_at <= now() - INTERVAL '24 hours';

  SELECT count(*) INTO slots_held
  FROM hireme_missions
  WHERE handle = post_handle AND state IN ('offered', 'accepted');

  FOR candidate IN 1 .. coalesce(array_length(candidate_numbers, 1), 0) LOOP
    EXIT WHEN slots_held >= 3;
    INSERT INTO hireme_missions (number, handle, state, ref)
    VALUES (candidate_numbers[candidate], post_handle, 'offered', candidate_refs[candidate])
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      slots_held := slots_held + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'offers', coalesce(
      (
        SELECT jsonb_agg(jsonb_build_object('number', number, 'ref', ref) ORDER BY posted_at, ref)
        FROM hireme_missions
        WHERE handle = post_handle AND state = 'offered'
      ),
      '[]'::jsonb
    ),
    'current', (
      SELECT number FROM hireme_missions WHERE handle = post_handle AND state = 'accepted'
    )
  );
END;
$$;

CREATE FUNCTION hireme_accept(
  accept_handle  TEXT,
  accept_number  INTEGER,
  mail_sender    TEXT,
  mail_subject   TEXT,
  mail_body      TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  contractor  email_accounts%ROWTYPE;
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

  INSERT INTO email_messages (handle, number, sender, subject, body)
  VALUES (accept_handle, contractor.next_number, mail_sender, mail_subject, mail_body);
  UPDATE email_accounts SET next_number = next_number + 1 WHERE handle = accept_handle;

  RETURN 'accepted';
END;
$$;

CREATE FUNCTION hireme_drop(
  drop_handle   TEXT,
  drop_number   INTEGER,
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
  SELECT * INTO contractor FROM email_accounts WHERE handle = drop_handle FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_contract';
  END IF;

  UPDATE hireme_missions SET state = 'abandoned', closed_at = now()
  WHERE number = drop_number AND handle = drop_handle AND state = 'accepted';
  IF NOT FOUND THEN
    RETURN 'no_contract';
  END IF;

  INSERT INTO email_messages (handle, number, sender, subject, body)
  VALUES (drop_handle, contractor.next_number, mail_sender, mail_subject, mail_body);
  UPDATE email_accounts SET next_number = next_number + 1 WHERE handle = drop_handle;

  RETURN 'dropped';
END;
$$;

REVOKE EXECUTE ON FUNCTION hireme_post_offers(TEXT, INTEGER[], TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hireme_post_offers(TEXT, INTEGER[], TEXT[]) TO service_role;

REVOKE EXECUTE ON FUNCTION hireme_accept(TEXT, INTEGER, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hireme_accept(TEXT, INTEGER, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION hireme_drop(TEXT, INTEGER, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hireme_drop(TEXT, INTEGER, TEXT, TEXT, TEXT) TO service_role;
