-- wallet_transfers: every movement of coins the ledger has made, one row each.
-- wallet_mint: how coins come to exist.
--
-- A transfer names the address the coins left, the address they reached, how many,
-- and when. Like the balances it names no player, machine or session. A MINT is a
-- transfer with no sender: `from_address` is NULL, and that NULL is the only mark
-- of where minted coins came from.
--
-- `id` orders two transfers made in the same instant, which `created_at` alone
-- cannot.
--
-- The CHECKs are the rules that must hold whichever function is writing:
--   - both addresses are address-shaped (a NULL sender passes: it is a mint);
--   - a transfer moves at least one coin and no more than the ledger can hold;
--   - nothing is sent to the address it came from.
--
-- wallet_mint credits an address and records the transfer in ONE transaction, so
-- a balance never rises without the row that says why, and no row claims coins
-- that never arrived. It answers the address's new balance. When the credit would
-- take the address past 9007199254740991 it writes nothing and answers NULL: the
-- caller is told the mint was refused instead of being handed a constraint
-- violation to interpret. It never touches `next_sequence`, which counts only
-- transfers OUT of an address.
--
-- An amount below one is not checked here. The transfer row's CHECK refuses it,
-- and that failure takes the credit back with it.
--
-- Security posture (zero-trust; mirrors the other tables):
--   - RLS enabled on the table, NO policies -> anon + authenticated denied.
--   - Postgres lets every role execute a new function, and this project's default
--     privileges name anon and authenticated as well, so EXECUTE is taken from
--     all three and granted to service_role alone. Nothing a browser holds can
--     mint.

CREATE TABLE wallet_transfers (
  id            BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_address  TEXT         CHECK (from_address ~ '^jsc[0-9a-f]{40}$'),
  to_address    TEXT         NOT NULL CHECK (to_address ~ '^jsc[0-9a-f]{40}$'),
  amount        BIGINT       NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (from_address <> to_address)
);

ALTER TABLE wallet_transfers ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.

CREATE FUNCTION wallet_mint(mint_to TEXT, mint_amount BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  held BIGINT;
BEGIN
  INSERT INTO wallet_balances AS ledger (address, balance)
  VALUES (mint_to, mint_amount)
  ON CONFLICT (address) DO UPDATE
    SET balance = ledger.balance + EXCLUDED.balance
    WHERE ledger.balance <= 9007199254740991 - EXCLUDED.balance
  RETURNING ledger.balance INTO held;

  IF held IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO wallet_transfers (to_address, amount) VALUES (mint_to, mint_amount);
  RETURN held;
END;
$$;

REVOKE EXECUTE ON FUNCTION wallet_mint(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wallet_mint(TEXT, BIGINT) TO service_role;
