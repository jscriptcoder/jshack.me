-- Drop network_registry. Every cross-player lookup now answers from
-- network_public_ips (which ESSID owns a public IP) and home_network_occupants (who
-- is on that ESSID, and the identity needed to rebuild their box).
--
-- The registry's real defect was its LIFETIME, not its columns. Its PK was the
-- ESSID-shared public_ip, so on a shared AP the last joiner evicted the previous one
-- and only ever one occupant was reachable; and no path ever deleted a row, so a
-- player who ran `nmcli disconnect` stayed readable and writable forever. Occupancy
-- has neither problem: (essid, owner_key) lets every occupant coexist, and the row
-- exists exactly while the machine is on the WiFi.
--
-- The index is a SWAP, not an addition. The registry carried an index on
-- workstation_machine_id for exactly one query — the reverse lookup that turns a
-- machine id held by a foreign session back into the box it names. That query now
-- runs against home_network_occupants, whose only index is its (essid, owner_key)
-- PK, which cannot serve it. Create the replacement before dropping the table it
-- replaces.

CREATE INDEX IF NOT EXISTS home_network_occupants_workstation_machine_id_idx
  ON home_network_occupants (workstation_machine_id);

DROP TABLE IF EXISTS network_registry;
