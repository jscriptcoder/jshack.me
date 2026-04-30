-- world_networks: shared persistent networks visible to every player.
--
-- Each row represents a network where multiple players see the same
-- machines (same machine_id, generated from the same seed). Used for:
--
--   - The multiplayer playground (theme='playground') — smoke-test
--     surface for cross-player visibility (rehydration via
--     listPatchesForMachines + Realtime broadcasts).
--   - Future themed locales (theme='office' | 'police' | 'university'
--     | 'cafe' | ...) — non-mission persistent world content
--     players can discover and explore.
--
-- The public_ip is registered in public_ips with kind='world_network'
-- so the IP allocator's PK-conflict-retry naturally skips it for real
-- mission/home allocations.
--
-- See plans/world-networks.md and memory:
-- project_themed_persistent_networks.md.

-- Extend the kind enum to include world_network. The constraint is
-- inline-named in the public_ips migration as the Postgres default
-- (`<table>_<column>_check`).
ALTER TABLE public_ips DROP CONSTRAINT IF EXISTS public_ips_kind_check;
ALTER TABLE public_ips
  ADD CONSTRAINT public_ips_kind_check
  CHECK (
    kind IN (
      'mission_instance',
      'home_network',
      'pivot',
      'npc_faction',
      'darknet_hub',
      'world_network'
    )
  );

CREATE TABLE world_networks (
  public_ip   TEXT        PRIMARY KEY REFERENCES public_ips(ip) ON DELETE CASCADE,
  seed        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  description TEXT,
  theme       TEXT        NOT NULL DEFAULT 'playground',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by theme for future per-theme browse / catalog UX.
CREATE INDEX world_networks_theme_idx ON world_networks (theme);

ALTER TABLE world_networks ENABLE ROW LEVEL SECURITY;

-- SELECT open to anon: world networks are public-by-design world
-- content, surfaced to every player. Future visibility rules (per
-- project_multiplayer_security_model) only apply to player-private
-- surfaces; world content stays universally visible.
CREATE POLICY "anon can read world_networks"
  ON world_networks FOR SELECT
  TO anon, authenticated
  USING (true);
-- No INSERT/UPDATE/DELETE policies — anon/authenticated denied by
-- default. Mutations happen via migrations or future
-- service_role-driven content-curation flows.

-- Seed: the multiplayer playground at 203.0.113.42 (TEST-NET-3 IETF
-- docs range). One of many planned world_networks rows; future themed
-- rows (office, police, university, café, ...) ship as content via
-- additional migrations.
INSERT INTO public_ips (ip, kind, owner_key)
  VALUES ('203.0.113.42', 'world_network', NULL);

INSERT INTO world_networks (public_ip, seed, name, description, theme)
  VALUES (
    '203.0.113.42',
    'playground-basic',
    'Playground',
    'Shared playground for multiplayer smoke tests. One of many world_networks rows; future themes (office, police, university, café, etc.) ship as content.',
    'playground'
  );
