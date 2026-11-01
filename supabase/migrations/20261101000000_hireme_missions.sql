-- hireme_missions: the record of who was given which contract, and how far it got.
--
-- A contract's identity is a 24-bit number. The number seeds its whole network (subnet,
-- gateway, key box, services) in the bundle; the server draws it, writes it here, and
-- never stores where the network lives, because the network does not live anywhere — it
-- is regenerated from the number on demand. So this table is the record of WHO was offered
-- or hired for WHAT, never of a place.
--
-- `number` is the primary key: no two contracts share one, so no two share an address. The
-- CHECK is the rule every writer must hold — a number in the 24-bit block whose last octet
-- is a host octet (2-254), the same host range every address in the world uses — so the
-- number maps one-to-one onto an address and back.
--
-- `handle` is the contractor's emailit.io handle (the mailbox is the board, and the board
-- is where a contract is offered and accepted). It is referenced ON DELETE CASCADE as the
-- boards are; no path deletes an email account today, so the choice is conventional rather
-- than load-bearing. Should account deletion ever ship, a completed or abandoned contract's
-- network is meant to stay reachable, so this action is revisited then.
--
-- `state` is the contract's whole lifecycle:
--
--   offered    posted to a board, its number reserved for the handle. NOT reachable.
--   burned     an offer the 24-hour turnover replaced. NEVER reachable.
--   accepted   the contractor took it. Reachable, and the one active job the handle holds.
--   completed  the contractor mailed a right key. Reachable, for good.
--   abandoned  the contractor dropped it. Reachable, for good; pays nothing.
--
-- A number's address answers as its network only while the state is accepted, completed or
-- abandoned (`networkByPublicIp`); offered, burned and ungiven all answer as an empty
-- address. The partial unique index on `handle` where state = 'accepted' is the one-active-
-- job rule: a second accept for a handle that already holds an active contract collides on
-- the index and is refused, so completion is never ambiguous about which job it is for.
--
-- `posted_at` is when the offer was drawn; `accepted_at` is when it was taken (null until
-- then); `closed_at` is when it completed or was abandoned (null until then).
--
-- Security posture, as the boards': RLS on with no policies, so anon and authenticated are
-- denied, and service_role (the Vercel functions and the operator script) is the only path
-- that reads or writes.

CREATE TABLE hireme_missions (
  number       INTEGER      PRIMARY KEY CHECK (
    number >= 0 AND number < 16777216 AND number % 256 BETWEEN 2 AND 254
  ),
  handle       TEXT         NOT NULL REFERENCES email_accounts (handle) ON DELETE CASCADE,
  state        TEXT         NOT NULL CHECK (
    state IN ('offered', 'burned', 'accepted', 'completed', 'abandoned')
  ),
  posted_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  accepted_at  TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ
);

-- One active job per handle: a second accept collides here and is refused.
CREATE UNIQUE INDEX hireme_missions_one_active_per_handle
  ON hireme_missions (handle)
  WHERE state = 'accepted';

ALTER TABLE hireme_missions ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the only
-- path that can read/write.
