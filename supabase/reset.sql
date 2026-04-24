-- Cloud dev-project reset: truncate all game state tables.
--
-- Usage:
--   Local dev: prefer `npm run db:reset` which drops + re-applies migrations.
--   Cloud dev project: paste this into the Supabase SQL editor to clear data
--   without dropping the schema.
--
-- Safe to run repeatedly. Never run this against a production project.

TRUNCATE TABLE public_ips CASCADE;

-- Future tables (uncomment as they land in later PRs):
-- TRUNCATE TABLE patches CASCADE;
-- TRUNCATE TABLE mission_instances CASCADE;
-- TRUNCATE TABLE sessions CASCADE;
-- TRUNCATE TABLE home_network_occupants CASCADE;
