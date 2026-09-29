-- Drop network_public_ips. A network's public address is no longer drawn and stored:
-- it is derived from the network's place in the world, so every reader asks the world
-- and nothing reads or writes this table any more.
--
-- Nothing is lost with the rows. Every declared network's address was already derived
-- before this drop, so the stored ones were ignored; the only rows still written were
-- for made-up lab networks joined by local wire-checks, and those have no public address
-- at all now.

DROP TABLE IF EXISTS network_public_ips;
