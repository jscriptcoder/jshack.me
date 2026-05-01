-- home_networks + home_network_occupants: the cracked-WiFi LAN catalog and
-- per-player slot allocation for cross-player home networks.
--
-- Two players who crack the same WiFi end up on the same LAN as separate
-- occupants. The occupant table is the source of truth for "which slot do
-- I own on this LAN" — the join endpoint is idempotent against it.
--
-- See plans/home-network-occupants.md for the full design and the rationale
-- behind: identity-derived hostname suffixes, random-within-range slot
-- allocation, and idempotent join semantics.
--
-- The 'home_network' kind is already in public_ips (added in
-- 20260424180121_public_ips.sql) — no enum change needed here.

-- home_networks: catalog row per LAN instance. Each row is one shared LAN
-- with a unique public IP (registered in public_ips, FK enforces uniqueness
-- across all network kinds via the public_ips PK).
CREATE TABLE home_networks (
  public_ip       TEXT        PRIMARY KEY REFERENCES public_ips(ip) ON DELETE CASCADE,
  essid_template  TEXT        NOT NULL,
  density_tier    TEXT        NOT NULL CHECK (density_tier IN ('crowded', 'shared', 'solo')),
  max_slots       INT         NOT NULL CHECK (max_slots > 0),
  seed            TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drives the find-or-create flow: "do we have an existing row for this
-- (essid_template, density_tier) with free slots?" The created_at suffix
-- supports ORDER BY for picking the oldest row first (LRU-ish — fills up
-- existing LANs before spawning new ones).
CREATE INDEX home_networks_template_tier_idx
  ON home_networks (essid_template, density_tier, created_at);

-- home_network_occupants: per-player slot on a LAN. The (network_id,
-- player_key) PK enforces "one slot per player per network" — the join
-- endpoint relies on this for idempotency (an existing row for the player
-- short-circuits allocation).
CREATE TABLE home_network_occupants (
  network_id    TEXT        NOT NULL REFERENCES home_networks(public_ip) ON DELETE CASCADE,
  player_key    TEXT        NOT NULL,
  lan_ip        TEXT        NOT NULL,
  hostname      TEXT        NOT NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network_id, player_key),
  UNIQUE (network_id, lan_ip),
  UNIQUE (network_id, hostname)
);

-- Lookup-by-player ("what LANs am I on") for future UX surfaces.
CREATE INDEX home_network_occupants_player_idx
  ON home_network_occupants (player_key);

-- RLS posture (mirrors world_networks):
--   - SELECT open to anon (the schema is public game state — knowing a
--     LAN exists doesn't reveal occupancy details beyond what nmap inside
--     the LAN would already expose).
--   - INSERT/UPDATE/DELETE: no policies, so RLS denies for anon and
--     authenticated by default. Only service_role (the Vercel join handler)
--     can mutate.
ALTER TABLE home_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_network_occupants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read home_networks"
  ON home_networks FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "anon can read home_network_occupants"
  ON home_network_occupants FOR SELECT
  TO anon, authenticated
  USING (true);
