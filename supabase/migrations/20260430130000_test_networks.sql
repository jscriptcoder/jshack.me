-- test_networks: dev-only fixture for shared multiplayer test networks.
--
-- Each row represents a test network where multiple players see the
-- same machines (same machine_id, generated from the same seed). Used
-- for end-to-end smoke testing of cross-player visibility (rehydration
-- via listPatchesForMachines + Realtime broadcasts) without waiting
-- for production-grade home networks / mission instances to ship.
--
-- REMOVED AT GAME RELEASE: drop this migration and the surrounding
-- module (src/testNetworks/, api/test-networks.ts, App.tsx wiring).
-- Patches rows for these machine_ids become orphaned but harmless.
--
-- The public_ip is registered in public_ips with kind='test_network'
-- so the IP allocator's PK-conflict-retry naturally skips it for real
-- mission/home allocations.
--
-- See plans/test-networks-playground.md for design + memory:
-- project_multiplayer_playground_network.md.

-- Extend the kind enum to include test_network. The constraint is
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
      'test_network'
    )
  );

CREATE TABLE test_networks (
  public_ip   TEXT        PRIMARY KEY REFERENCES public_ips(ip) ON DELETE CASCADE,
  seed        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE test_networks ENABLE ROW LEVEL SECURITY;

-- SELECT open to anon: test fixtures are public dev metadata, not secrets.
CREATE POLICY "anon can read test_networks"
  ON test_networks FOR SELECT
  TO anon, authenticated
  USING (true);
-- No INSERT/UPDATE/DELETE policies — anon/authenticated denied by default.
-- Mutations happen via migrations (this file) or future dev-only endpoints
-- using service_role.

-- Seed: basic playground at 203.0.113.42 (TEST-NET-3 IETF docs range).
-- Memorable, won't collide with any real-world IP, and clearly signals
-- "this is a test fixture" to anyone who knows the docs IP convention.
INSERT INTO public_ips (ip, kind, owner_key)
  VALUES ('203.0.113.42', 'test_network', NULL);

INSERT INTO test_networks (public_ip, seed, name, description)
  VALUES (
    '203.0.113.42',
    'test-basic',
    'Basic Playground',
    'Shared playground for cross-player visibility smoke tests. Ship-ready cleanup: drop this migration + module.'
  );
