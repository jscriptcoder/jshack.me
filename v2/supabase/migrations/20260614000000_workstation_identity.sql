-- workstation identity on the registry row (Story 2, slice 2a).
--
-- Story 1 stored only "where" a public IP resolves (owner_key + machine ids +
-- forward table). To let the server RECONSTRUCT the owner's workstation for a
-- cross-player reader, it also needs the owner's player-chosen identity:
-- `username` + `machine_name` (the box is seeded from the pubkey PLUS these),
-- and the root password as an md5 HASH (`root_hash`). The client hashes the
-- password before it leaves the browser — the server stores it opaquely and
-- never sees plaintext. (The guest password is pubkey-seeded, so the server
-- recomputes it from owner_key and it is NOT stored here.)
--
-- Nullable: pre-existing Story 1 rows predate these columns; every join from now
-- on supplies them. The cross-player read (2b/2c) treats a row missing them as
-- not-yet-reconstructable.

ALTER TABLE network_registry
  ADD COLUMN workstation_username     TEXT,
  ADD COLUMN workstation_machine_name TEXT,
  ADD COLUMN workstation_root_hash    TEXT;
