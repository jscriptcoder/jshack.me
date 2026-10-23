-- player_locations: where a player stands once they have travelled.
--
-- A player starts in the town their key draws, worked out from the key alone by the client
-- and the server alike, and nothing stores it. Boarding a ride at rideit.io writes a row
-- here, and from then on the row's town is where they stand: the join admits only its
-- networks, and the scan draws from it. A player with no row has never travelled.
--
-- `town` is a town's name as the world declares it. `trips` counts the trips taken, so a
-- row always holds at least one. A boarding names the count it read and writes only if it
-- still holds, so two boardings at once by one player store one move and count one trip.
--
-- Security posture, as every table's: RLS on with no policies, so anon and authenticated
-- are denied. The Vercel function, on the service role, is the only writer, and it writes
-- only for a request whose signature it has checked, under the verified key.

CREATE TABLE player_locations (
  owner_key   TEXT         PRIMARY KEY,
  town        TEXT         NOT NULL,
  trips       INTEGER      NOT NULL CHECK (trips > 0),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE player_locations ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.
