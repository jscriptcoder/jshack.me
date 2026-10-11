-- wallet_balances: what each address on the ledger holds.
--
-- The ledger is keyed by ADDRESS and by nothing else. No column names a player,
-- a machine or a session: whoever holds an address's key spends its coins, and
-- the ledger is built not to know who that is.
--
-- A row exists only for an address that has been paid. Reading an address with no
-- row answers zero and makes none, so asking about an address never writes, and a
-- mistyped address leaves nothing behind.
--
-- `next_sequence` is the number the next transfer OUT of the address has to name.
-- It is what stops a transfer that was once accepted from being sent again.
--
-- The CHECKs are the rules that must hold whichever function is writing:
--   - an address is `jsc` and 40 lower-case hex characters, the one shape the
--     wallet makes and the endpoint accepts;
--   - a balance is never negative, and never past 9007199254740991, the largest
--     whole number a browser holds exactly. A credit that would pass it fails
--     here rather than reaching a player as a rounded figure.
--
-- Security posture (zero-trust; mirrors the other tables):
--   - RLS enabled, NO policies -> anon + authenticated denied by default.
--   - service_role bypasses RLS and is the only path that reads or writes, always
--     through the Vercel function. The ledger is public by what that function
--     chooses to answer, not by a grant on the table.

CREATE TABLE wallet_balances (
  address        TEXT    PRIMARY KEY CHECK (address ~ '^jsc[0-9a-f]{40}$'),
  balance        BIGINT  NOT NULL DEFAULT 0
                         CHECK (balance BETWEEN 0 AND 9007199254740991),
  next_sequence  BIGINT  NOT NULL DEFAULT 0
                         CHECK (next_sequence BETWEEN 0 AND 9007199254740991)
);

ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write, mediated entirely by the Vercel function.
