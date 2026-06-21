-- nonces: replay-protection ledger for signed requests.
--
-- One row per nonce the server has accepted. The signed-request verifier
-- (verifySignedRequest) checks the timestamp window (REPLAY_WINDOW_MS) BEFORE the
-- nonce, so a nonce is only ever consulted while its envelope's `ts` is still
-- within that window — rows older than the window are dead weight and get pruned
-- (Slice 7.2.0b). The adapter records a nonce with
-- INSERT ... ON CONFLICT (nonce) DO NOTHING ... RETURNING and treats "row
-- actually inserted" as fresh; a conflict (nothing returned) means replay.
--
-- Security posture (zero-trust; mirrors patches/sessions/network_registry):
--   - RLS enabled, NO policies → anon + authenticated denied by default.
--   - service_role bypasses RLS; the only path is the Vercel function, which has
--     already verified the Ed25519 envelope before recording the nonce.

CREATE TABLE nonces (
  nonce      TEXT        NOT NULL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prune-by-age (Slice 7.2.0b deletes rows older than REPLAY_WINDOW_MS) scans created_at.
CREATE INDEX nonces_created_at_idx ON nonces (created_at);

ALTER TABLE nonces ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write, mediated entirely by the Vercel function.
