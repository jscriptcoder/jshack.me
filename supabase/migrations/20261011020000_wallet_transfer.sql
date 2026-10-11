-- wallet_transfer: how coins move from one address to another.
--
-- It debits the sender, credits the destination and records the transfer in ONE
-- transaction, so no coin is ever in neither place or in both. It answers with a
-- word: `moved`, or why it left everything as it was.
--
--   stale_sequence        the sequence number named is not the sender's next one.
--                         This is what stops a transfer that was accepted once
--                         from being accepted again, and what lets only one of two
--                         transfers signed at the same sequence land.
--   insufficient_balance  the sender holds less than the amount. An address the
--                         ledger has never seen holds nothing, at sequence 0.
--   destination_full      the credit would take the destination past
--                         9007199254740991.
--
-- The sequence number is judged before the balance, so a transfer sent a second
-- time is always `stale_sequence`, whatever the sender still holds.
--
-- Only what has to be decided in the same transaction that moves the coins is
-- decided here. Whose key signed, the shape of an address, an amount of at least
-- one and a destination other than the sender are the endpoint's to check, and
-- the tables' CHECKs refuse them too: a transfer row of nothing, or to the address
-- it came from, fails and takes the debit and the credit back with it.
--
-- Both rows are locked before either is read, lower address first. Two transfers
-- at one sequence therefore queue, and the second sees the first one's sequence
-- number; and two transfers crossing between the same two addresses take their
-- locks in the same order, so neither waits on the other forever.
--
-- A sender's sequence number rises by one for each transfer out and for nothing
-- else. A destination the ledger has never seen is created at sequence 0.
--
-- STRICT: a missing argument answers NULL and nothing runs.
--
-- Security posture, as wallet_mint: EXECUTE is taken from PUBLIC, anon and
-- authenticated and granted to service_role alone. The endpoint is the only
-- caller, and it calls only for a transfer whose signature it has checked.

CREATE FUNCTION wallet_transfer(
  transfer_from      TEXT,
  transfer_to        TEXT,
  transfer_amount    BIGINT,
  transfer_sequence  BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql
STRICT
SET search_path = public
AS $$
DECLARE
  held BIGINT;
  expected BIGINT;
  credited BIGINT;
BEGIN
  PERFORM 1
    FROM wallet_balances
    WHERE address IN (transfer_from, transfer_to)
    ORDER BY address
    FOR UPDATE;

  SELECT balance, next_sequence INTO held, expected
    FROM wallet_balances
    WHERE address = transfer_from;
  IF NOT FOUND THEN
    held := 0;
    expected := 0;
  END IF;

  IF transfer_sequence <> expected THEN
    RETURN 'stale_sequence';
  END IF;
  IF held < transfer_amount THEN
    RETURN 'insufficient_balance';
  END IF;

  INSERT INTO wallet_balances AS ledger (address, balance)
  VALUES (transfer_to, transfer_amount)
  ON CONFLICT (address) DO UPDATE
    SET balance = ledger.balance + EXCLUDED.balance
    WHERE ledger.balance <= 9007199254740991 - EXCLUDED.balance
  RETURNING ledger.balance INTO credited;

  IF credited IS NULL THEN
    RETURN 'destination_full';
  END IF;

  UPDATE wallet_balances
    SET balance = balance - transfer_amount,
        next_sequence = next_sequence + 1
    WHERE address = transfer_from;

  INSERT INTO wallet_transfers (from_address, to_address, amount)
  VALUES (transfer_from, transfer_to, transfer_amount);

  RETURN 'moved';
END;
$$;

REVOKE EXECUTE ON FUNCTION wallet_transfer(TEXT, TEXT, BIGINT, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wallet_transfer(TEXT, TEXT, BIGINT, BIGINT) TO service_role;
