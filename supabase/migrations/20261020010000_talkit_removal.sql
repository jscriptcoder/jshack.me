-- The operator's removal from talkit.io (`scripts/talkitRemove.ts`): what a removed
-- thread and a removed comment leave in the forum's tables.
--
-- A removed thread is deleted for good, and every comment on it goes with it through the
-- foreign key's cascade, a comment that lands while it is being removed included. Its id
-- is an identity, so it never comes back; its link answers as an id nobody used does.
--
-- A removed comment keeps its row, its number and its time, so "see #4" still means #4
-- and the thread's comment_count, which numbers the next comment, still counts it. Its
-- author and its body are wiped together: whatever made the operator remove it does not
-- stay, and no handle is left marked by a removal it may not have written, since a stolen
-- login signs as its owner. A NULL body is the mark of a removed comment; the CHECK holds
-- the two NULL together, and their shape CHECKs still hold whenever they are not.
--
-- Nothing else changes: the operator writes these tables with the service role, as a
-- restore writes the journal, and players still cannot remove anything.

ALTER TABLE talkit_comments
  DROP CONSTRAINT talkit_comments_thread_id_fkey,
  ADD CONSTRAINT talkit_comments_thread_id_fkey
    FOREIGN KEY (thread_id) REFERENCES talkit_threads (id) ON DELETE CASCADE,
  ALTER COLUMN author DROP NOT NULL,
  ALTER COLUMN body DROP NOT NULL,
  ADD CONSTRAINT talkit_comments_removed_whole CHECK ((author IS NULL) = (body IS NULL));
