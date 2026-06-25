-- network_public_ips: the per-ESSID public-IP allocation of record.
--
-- A network's WAN address belongs to the AP — one per ESSID, shared by every
-- occupant — and must be globally unique across ESSIDs. The server issues an IP on
-- the FIRST join of an ESSID and stores it here; `public_ip UNIQUE` guarantees no
-- two ESSIDs ever collide (replacing the old deterministic `generatePublicIp` draw,
-- which could birthday-collide across ESSIDs). `registerNetwork` reads-or-allocates
-- from here and stamps the result into `network_registry.public_ip`; every later
-- occupant of the ESSID resolves the SAME address.
--
-- Allocation is an `INSERT … ON CONFLICT (essid) DO NOTHING` issued by the function:
--   - fresh ESSID + free IP  -> the row is inserted (claimed)
--   - ESSID already allocated -> DO NOTHING (the caller reads + adopts the stored IP)
--   - IP belongs to ANOTHER ESSID -> the `public_ip` UNIQUE constraint raises 23505,
--     which is NOT the ON CONFLICT target, so the caller sees it and redraws.
--
-- Lifecycle: permanent — an ESSID keeps its IP forever (never released), so the
-- address is stable for everyone, always. No GC.
--
-- Security posture (zero-trust; mirrors network_registry / home_network_occupants):
--   - RLS enabled, NO policies -> anon + authenticated denied by default.
--   - service_role bypasses RLS and is the only path that reads/writes, always via
--     the Vercel function, which derives the essid from the verified envelope (never
--     a client claim).

CREATE TABLE network_public_ips (
  essid       TEXT        PRIMARY KEY,
  public_ip   TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE network_public_ips ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write, mediated entirely by the Vercel function.
