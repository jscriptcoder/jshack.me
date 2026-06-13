-- network_registry: public IP → network / router / machines, the index that makes
-- cross-player scan resolution possible (Story 1, slice 1a).
--
-- Written on join: when a player connects to a cracked AP, the server stamps
-- owner_key from the verified pubkey and derives public_ip from the essid, then
-- upserts one row (public_ip is the PK — one row per AP). `resolvePublicScan`
-- reads it so a DIFFERENT identity's `nmap <public IP>` resolves to the registered
-- machine server-side, instead of being "out of range".
--
-- Degenerate NAT today: router_machine_id IS the workstation and forward_table
-- forwards every port to it ([{ "publicPort": "*", "targetMachineId": ... }]).
-- Story 5 swaps the forward_table VALUE for real PREROUTING/DNAT rules (the router
-- becomes a distinct machine; specific public ports map to specific internal
-- machines) with NO schema change — the shape is fixed here up front.
--
-- The patches PK is intentionally NOT touched: Story 1/2 resolve the owner's
-- existing per-viewer rows via (machine_id, player_key = owner_key) from this
-- registry; the shared-record flip lands in Story 3 when cross-player WRITES need
-- it.
--
-- Security posture (zero-trust; mirrors patches/sessions):
--   - RLS enabled, NO policies → anon + authenticated denied by default.
--   - service_role bypasses RLS and is the only path that reads/writes, always
--     via the Vercel function, which verifies the Ed25519 envelope and stamps
--     owner_key + public_ip itself (never a client claim).

CREATE TABLE network_registry (
  public_ip              TEXT        PRIMARY KEY,
  owner_key              TEXT        NOT NULL,
  workstation_machine_id TEXT        NOT NULL,
  router_machine_id      TEXT        NOT NULL,
  forward_table          JSONB       NOT NULL,
  essid                  TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE network_registry ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write, mediated entirely by the Vercel function.
