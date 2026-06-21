-- home_network_occupants: who is live on a shared-WiFi LAN, keyed by ESSID
-- (Story 7, slice 7.2a). This is the cross-player state the same-WiFi story renders:
-- the `nmap` occupant merge, the same-LAN connect front door, and same-LAN traces.
--
-- Written on join (folded into the same `registerNetwork` round-trip that upserts the
-- WAN registry): the server stamps owner_key from the verified pubkey and records the
-- player's workstation identity. Deleted on disconnect (slice 7.2b). The LAN IP +
-- hostname are NOT stored — they re-derive from `assignHomeNetwork(owner_key, essid)`
-- (a pure function of identity + AP; storing would only risk drift).
--
-- PK is (essid, owner_key) so every occupant of a shared ESSID COEXISTS — the crucial
-- contrast with network_registry (PK public_ip, last-writer-wins on a shared AP, which
-- can therefore hold only ONE occupant's box identity). This table is the only place
-- each occupant's workstation identity survives, so the same-LAN connect handler (7.4)
-- can auth a guest/root login against the specific occupant's /etc/passwd. The
-- composite PK's leading `essid` column also serves the occupant-list read
-- (`... WHERE essid = $1`) — no separate index needed.
--
-- Security posture (zero-trust; mirrors patches/sessions/network_registry):
--   - RLS enabled, NO policies -> anon + authenticated denied by default.
--   - service_role bypasses RLS and is the only path that reads/writes, always via the
--     Vercel function, which verifies the Ed25519 envelope and stamps owner_key itself
--     (never a client claim).

CREATE TABLE home_network_occupants (
  essid                    TEXT        NOT NULL,
  owner_key                TEXT        NOT NULL,
  workstation_machine_id   TEXT        NOT NULL,
  workstation_username     TEXT        NOT NULL,
  workstation_machine_name TEXT        NOT NULL,
  workstation_root_hash    TEXT        NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (essid, owner_key)
);

ALTER TABLE home_network_occupants ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the only
-- path that can read/write, mediated entirely by the Vercel function.
