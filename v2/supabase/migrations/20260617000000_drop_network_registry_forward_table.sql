-- Story 5.1.1b: drop network_registry.forward_table.
--
-- The router is now a DISTINCT machine (router_machine_id = computeRouterId(owner_key))
-- that bears the public IP and owns /etc/iptables/rules.v4. NAT forwards are parsed
-- from that file on the router's journal — the single source of truth — so the
-- degenerate forward_table column (originally [{ "publicPort": "*", → workstation }])
-- is no longer read or written by anything. Removing it keeps the registry honest:
-- the only forward authority is the file, never a duplicated DB projection.
--
-- Safe to drop unconditionally — no live players depend on it, and the upsert no
-- longer supplies it. router_machine_id stays (its VALUE changed from the
-- workstation id to the router id; no schema change for that).

ALTER TABLE network_registry DROP COLUMN IF EXISTS forward_table;
