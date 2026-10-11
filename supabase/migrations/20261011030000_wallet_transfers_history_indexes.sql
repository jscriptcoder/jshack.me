-- wallet_transfers: the two indexes a history is read through.
--
-- A history is the latest transfers into or out of one address, newest first.
-- Without these, finding them means reading every transfer the ledger has ever
-- made. One index serves the transfers an address sent and the other the ones
-- it received, and each carries `id`, the column a history is ordered by:
-- two transfers can share a `created_at`, and `id` still says which came first.
--
-- A mint has no sender, so it is found through the destination index alone.

CREATE INDEX wallet_transfers_from_address_id_idx ON wallet_transfers (from_address, id DESC);
CREATE INDEX wallet_transfers_to_address_id_idx ON wallet_transfers (to_address, id DESC);
