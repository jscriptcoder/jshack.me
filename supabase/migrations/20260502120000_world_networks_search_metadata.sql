-- search_metadata: per-row indexable metadata for findit.io's search
-- engine. Each row that opts in declares:
--
--   { "title": "...", "description": "...", "keywords": ["...", ...] }
--
-- The findit.io network generator reads every world_networks row at
-- boot, filters to rows with non-null search_metadata, and snapshots
-- the result into /etc/findit/index.json on findit.io's filesystem
-- (see src/themedNetworks/handlers/searchEngine.ts).
--
-- Migration is additive — existing playground row stays unindexed
-- (search_metadata = NULL). Themed networks ship their metadata in
-- subsequent migrations alongside the network row itself.

ALTER TABLE world_networks
  ADD COLUMN search_metadata JSONB;
