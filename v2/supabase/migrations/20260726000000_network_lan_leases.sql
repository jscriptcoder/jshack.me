-- network_lan_leases: an occupant's host address on an AP's /24, the DHCP-style
-- allocation of record.
--
-- Where `network_public_ips` holds ONE WAN address per ESSID shared by every
-- occupant, a LAN lease is per `(essid, owner_key)`: each occupant holds its own
-- host octet on the shared subnet. `UNIQUE (essid, octet)` is what guarantees two
-- occupants of one network can never collide — the addresses were previously a pure
-- hash of `(owner_key, essid)`, which had nothing preventing two identities drawing
-- the same octet.
--
-- Allocation is an `INSERT … ON CONFLICT (essid, owner_key) DO NOTHING` issued by
-- the function:
--   - fresh occupant + free octet   -> the row is inserted (leased)
--   - occupant already has a lease  -> DO NOTHING (the caller reads + adopts it)
--   - octet held by ANOTHER occupant of the ESSID -> the `(essid, octet)` UNIQUE
--     constraint raises 23505, which is NOT the ON CONFLICT target, so the caller
--     sees it and redraws.
--
-- The octet CHECK is defence in depth for the same rule the allocator's draw range
-- enforces: `.0` is the network address, `.1` is the AP gateway (a real machine an
-- occupant would otherwise be impersonating), and `.255` is broadcast.
--
-- Lifecycle: permanent, and deliberately OUTLIVES occupancy. `unregisterOccupant`
-- deletes the `home_network_occupants` row on `nmcli disconnect`, but the lease
-- stays, so reconnecting to a network returns you to the address you had. No GC —
-- an exhausted subnet is a clean allocation failure, not a reclaim.
--
-- Security posture (zero-trust; mirrors network_public_ips / home_network_occupants):
--   - RLS enabled, NO policies -> anon + authenticated denied by default.
--   - service_role bypasses RLS and is the only path that reads/writes, always via
--     the Vercel function, which stamps `owner_key` from the verified envelope
--     (never a client claim).

CREATE TABLE network_lan_leases (
  essid       TEXT        NOT NULL,
  owner_key   TEXT        NOT NULL,
  octet       SMALLINT    NOT NULL CHECK (octet BETWEEN 2 AND 254),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (essid, owner_key),
  UNIQUE (essid, octet)
);

ALTER TABLE network_lan_leases ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write, mediated entirely by the Vercel function.
