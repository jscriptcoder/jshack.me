-- ssh sessions carry the `essid` of the network the target host was generated
-- under, so the server can REGENERATE that host's filesystem on demand — the
-- later L1/L2 remote-write path rebuilds the tree to check permissions, and the
-- coordinate machine_id is a one-way hash, so `essid` + `machine_id` together are
-- what recover the host (via `hostForMachineId`).
--
-- NULL for same-machine `su` rows (no remote host to regenerate). Nullable, no
-- default — populated only by the authCreateSession path.
ALTER TABLE sessions ADD COLUMN essid TEXT;
