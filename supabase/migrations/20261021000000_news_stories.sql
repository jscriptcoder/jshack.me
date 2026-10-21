-- news_stories: the stories valleynews.io prints, the Harrow Valley paper.
--
-- This table is the truth about every story. valleynews.io's box is a machine like any
-- other, attackable and brickable, and a restore wipes only its journal, so no story is lost
-- with it, and a root on the box cannot change one: each section and each story is built
-- from these rows for every visit, never served from a file. A root can only rewrite the
-- masthead, which is a file.
--
-- Only the operator writes here, through `scripts/valleynews.ts`, from a story file. The
-- paper speaks in three voices, so `section` is one of three: `valley` (the valley's own
-- news, in the fiction), `dev` (the people who build the game) and `wire` (real-world
-- security news). `byline` is free text the operator sets, tied to no account.
--
-- A story is plain text, stored as written and escaped only when a page shows it. The
-- CHECKs are the script's own limits, so whichever way a row arrives it holds the same:
-- a title is 1 to 120 characters and a byline 1 to 60, each on one line; a body is 1 to
-- 20000 and may break its lines; counted as characters, and none holds another control
-- character. Postgres text cannot hold a NUL at all.
--
-- A section is read down `posted_at`, equal times by the newer id.
--
-- Security posture, as talkit's: RLS on with no policies, so anon and authenticated are
-- denied. The Vercel function, which only reads, and the operator's script are the only
-- callers, both as service_role.

CREATE TABLE news_stories (
  id         BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  section    TEXT         NOT NULL CHECK (section IN ('valley', 'dev', 'wire')),
  title      TEXT         NOT NULL CHECK (
                            char_length(title) BETWEEN 1 AND 120
                            AND title !~ '[\x01-\x1F\x7F]'
                          ),
  byline     TEXT         NOT NULL CHECK (
                            char_length(byline) BETWEEN 1 AND 60
                            AND byline !~ '[\x01-\x1F\x7F]'
                          ),
  body       TEXT         NOT NULL CHECK (
                            char_length(body) BETWEEN 1 AND 20000
                            AND body !~ '[\x01-\x09\x0B-\x1F\x7F]'
                          ),
  posted_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX news_stories_section_idx ON news_stories (section, posted_at DESC, id DESC);

ALTER TABLE news_stories ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.
