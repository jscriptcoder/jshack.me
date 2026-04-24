-- public_ips: global unique registry of public IPs allocated across all network types.
--
-- The PRIMARY KEY on ip is the collision-prevention mechanism — two concurrent
-- allocations for the same IP cannot both succeed. The Vercel allocation
-- endpoint handles conflicts by re-rolling and retrying the INSERT.
--
-- Security posture:
--   - SELECT is open to anon. Public IPs are public by nature — any player can
--     nmap them in-game; there's no secrecy at the registry layer.
--   - INSERT / UPDATE / DELETE have NO policies, so RLS denies them for anon
--     and authenticated roles by default. Only service_role (used by the Vercel
--     allocation function) can mutate — service_role bypasses RLS.
--
-- See memory: project_multiplayer_security_model.md ("RLS is the actual
-- security boundary").

CREATE TABLE public_ips (
  ip             TEXT        PRIMARY KEY,
  kind           TEXT        NOT NULL CHECK (kind IN (
                               'mission_instance',
                               'home_network',
                               'pivot',
                               'npc_faction',
                               'darknet_hub'
                             )),
  owner_key      TEXT,
  instance_ref   TEXT,
  allocated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by owner ("what do I own" queries from the client)
CREATE INDEX public_ips_owner_key_idx
  ON public_ips (owner_key)
  WHERE owner_key IS NOT NULL;

-- Lookup by kind (future admin / debug queries)
CREATE INDEX public_ips_kind_idx
  ON public_ips (kind);

ALTER TABLE public_ips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read public_ips"
  ON public_ips FOR SELECT
  TO anon, authenticated
  USING (true);
