-- talkit_threads: the threads players start on talkit.io, the valley's forum.
--
-- This table is the truth about every thread. talkit.io's box is a machine like any
-- other, attackable and brickable, and a restore wipes only its journal, so nothing a
-- player wrote is lost with it, and a root on the box cannot change it: the thread list
-- and each thread are built from these rows for every visit, never served from a file.
--
-- `author` is an emailit.io handle, written as the handle shape and nothing more. It is
-- no foreign key: the forum's own welcome is signed `talkit`, a reserved name no account
-- holds, and accounts are never deleted.
--
-- `last_activity_at` is when the thread was started or last commented on, and the list
-- is read down it, equal times by the newer thread first. `comment_count` is kept beside
-- it so the list needs no join.
--
-- A thread is plain text, stored as it was typed and escaped only when a page shows it.
-- The CHECKs are the rules that must hold whichever function is writing: a title is 1 to
-- 80 characters on one line, a body 1 to 4000, counted as characters, and neither holds
-- a control character, except that a body may break its lines. Postgres text cannot hold
-- a NUL at all.
--
-- The forum opens with one thread, the operator's welcome, which states its rules.
--
-- Security posture, as emailit's: RLS on with no policies, so anon and authenticated are
-- denied. The Vercel function is the only caller, as service_role.

CREATE TABLE talkit_threads (
  id                BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author            TEXT         NOT NULL CHECK (author ~ '^[a-z][a-z0-9_-]{0,23}$'),
  title             TEXT         NOT NULL CHECK (
                                   char_length(title) BETWEEN 1 AND 80
                                   AND title !~ '[\x01-\x1F\x7F]'
                                 ),
  body              TEXT         NOT NULL CHECK (
                                   char_length(body) BETWEEN 1 AND 4000
                                   AND body !~ '[\x01-\x09\x0B-\x1F\x7F]'
                                 ),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_activity_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  comment_count     INTEGER      NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  CHECK (last_activity_at >= created_at)
);

CREATE INDEX talkit_threads_activity_idx ON talkit_threads (last_activity_at DESC, id DESC);

ALTER TABLE talkit_threads ENABLE ROW LEVEL SECURITY;
-- No policies: anon + authenticated denied. service_role bypasses RLS and is the
-- only path that can read/write.

INSERT INTO talkit_threads (author, title, body) VALUES (
  'talkit',
  'Welcome to talkit.io',
  'This is the forum for the whole valley. Start a thread from the front page, or comment '
    || 'on someone else''s. You post as your emailit.io account. Each of us gets 20 posts '
    || 'and comments an hour. Posts are permanent: nobody can edit or delete what you write.'
);
