-- Restrict Realtime broadcast publishing on patches:* channels to
-- service_role. Closes the forgery vector accepted by PR #81 (live
-- cross-player updates via Supabase Realtime broadcasts, v0.105.0).
--
-- Without authorization, any client holding the anon key (which ships
-- in the browser bundle by design) can call
--
--   supabase.channel('patches:<victim>').send({
--     type: 'broadcast', event: 'patch_change', payload: {...}
--   });
--
-- and inject forged patch_change events. Subscribers apply the forged
-- patch via applyExternalPatch until the next listPatchesForMachines
-- refresh overwrites it with server truth.
--
-- Mitigation: gate INSERTs on realtime.messages for patches:* topics
-- to service_role. The Vercel function (api/patches.ts) publishes via
-- the broadcast REST endpoint with service_role, which bypasses RLS,
-- so server-side broadcasts keep working unchanged. Anon clients keep
-- their SUBSCRIBE path (read-only) but lose forge-publish.
--
-- Pairs with the client-side change in src/patchRegistry/realtime.ts
-- that opts each subscription into Realtime authorization via
-- `{ config: { private: true } }`. The private flag is what routes
-- the subscribe handshake through realtime.messages so these policies
-- evaluate; without it the channel uses the legacy public path.
--
-- See memory: project_realtime_publish_authorization.md.

-- realtime.messages already has RLS enabled by Supabase. Re-running
-- the ENABLE statement is a no-op safe-guard against environments
-- where it might have been disabled.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- DROP IF EXISTS keeps this migration re-runnable in local dev and
-- safe under `supabase db reset`. Production is one-shot, but the
-- guard costs nothing.
DROP POLICY IF EXISTS "anon can subscribe to patches broadcasts" ON realtime.messages;
DROP POLICY IF EXISTS "service_role can publish patches broadcasts" ON realtime.messages;

-- SELECT (subscribe): anon and authenticated may join patches:*
-- broadcast channels. The client subscribes with `private: true`,
-- which routes the join through realtime.messages so this policy
-- evaluates. Without the policy, private subscribes would be denied
-- (default-deny under RLS) and live cross-player updates would stop.
--
-- Scoped to extension='broadcast' so future presence/postgres_changes
-- usage on the same channel namespace doesn't accidentally inherit
-- this rule.
CREATE POLICY "anon can subscribe to patches broadcasts"
  ON realtime.messages
  FOR SELECT
  TO anon, authenticated
  USING (
    (select realtime.topic()) LIKE 'patches:%'
    AND realtime.messages.extension = 'broadcast'
  );

-- INSERT (publish): only service_role. This is documentary — service_role
-- already bypasses RLS, so the policy is not strictly required for the
-- server to publish via the REST endpoint. The absence of an INSERT
-- policy for anon/authenticated is the actual security guarantee:
-- under default-deny RLS, no policy means no access.
--
-- Including the explicit service_role policy keeps the schema's intent
-- legible to a future reader and guards against the (unlikely) day
-- Supabase changes the bypass behavior.
CREATE POLICY "service_role can publish patches broadcasts"
  ON realtime.messages
  FOR INSERT
  TO service_role
  WITH CHECK (
    (select realtime.topic()) LIKE 'patches:%'
    AND realtime.messages.extension = 'broadcast'
  );
