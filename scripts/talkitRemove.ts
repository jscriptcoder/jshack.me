// Operator removal from talkit.io — takes a thread, or one comment, off the forum.
// The operator runs it by hand; nobody else can remove anything a player wrote there.
//
// A thread is deleted for good, and every comment on it with it. A comment keeps its row,
// its number and its time, and loses its author and its body: its thread's page then
// shows `#3 [removed]` in its place, so every other number still points where it did,
// and the thread's comment count and place on the list stay as they were.
//
// There is no confirmation and no undo. The one guard is the line it prints before it
// writes, naming what it is about to remove and the database it is about to remove it
// from. A removal leaves no trace on talkit's box: the operator has no address in the
// world, as a restore has none.
//
// Usage (local):
//   npx dotenv -e .env.development.local -- npx tsx scripts/talkitRemove.ts thread <id>
//   npx dotenv -e .env.development.local -- npx tsx scripts/talkitRemove.ts comment <id> <n>
//
// In production the operator supplies production's SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Exits 0 on a removal, 1 when there is nothing to remove or on a database error, 2 on
// anything but `thread <id>` or `comment <id> <n>`, or on missing env — both before
// anything is touched.

import { createClient } from '@supabase/supabase-js';
import {
  alreadyRemovedLine,
  noCommentLine,
  noThreadLine,
  readRemovalOrder,
  removedLine,
  removingCommentLine,
  removingThreadLine,
  type CommentRemoval,
  type ThreadRemoval,
} from '../src/core/talkit/removal.js';

const order = readRemovalOrder(process.argv.slice(2));
if (order === null) {
  console.error('Usage: talkitRemove.ts thread <id> | comment <id> <n>');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });
const host = new URL(url).host;

// Typed where they are declared, so that the code after a call knows it never returns.
const fail: (label: string, error: { message: string }) => never = (label, error) => {
  console.error(`${label} failed: ${error.message}`);
  process.exit(1);
};

const nothingToRemove: (line: string) => never = (line) => {
  console.error(line);
  process.exit(1);
};

const removeThread = async (thread: ThreadRemoval) => {
  const found = await sr
    .from('talkit_threads')
    .select('title, author, comment_count')
    .eq('id', thread.threadId)
    .maybeSingle();
  if (found.error) fail('reading the thread', found.error);
  if (found.data === null) nothingToRemove(noThreadLine(thread, host));
  const { title, author, comment_count } = found.data as {
    title: string;
    author: string;
    comment_count: number;
  };
  console.log(removingThreadLine(thread, { title, author, commentCount: comment_count }, host));

  // The cascade takes every comment on the thread with it.
  const deleted = await sr.from('talkit_threads').delete().eq('id', thread.threadId).select('id');
  if (deleted.error) fail('removing the thread', deleted.error);
  if ((deleted.data ?? []).length === 0) nothingToRemove(noThreadLine(thread, host));
};

const removeComment = async (comment: CommentRemoval) => {
  const found = await sr
    .from('talkit_comments')
    .select('author, body')
    .eq('thread_id', comment.threadId)
    .eq('number', comment.number)
    .maybeSingle();
  if (found.error) fail('reading the comment', found.error);
  if (found.data === null) nothingToRemove(noCommentLine(comment, host));
  const { author, body } = found.data as { author: string | null; body: string | null };
  if (author === null || body === null) nothingToRemove(alreadyRemovedLine(comment, host));
  console.log(removingCommentLine(comment, { author }, host));

  // Only a comment still standing is wiped, so a removal running beside this one that got
  // there first is told, not repeated.
  const wiped = await sr
    .from('talkit_comments')
    .update({ author: null, body: null })
    .eq('thread_id', comment.threadId)
    .eq('number', comment.number)
    .not('body', 'is', null)
    .select('number');
  if (wiped.error) fail('removing the comment', wiped.error);
  if ((wiped.data ?? []).length === 0) nothingToRemove(alreadyRemovedLine(comment, host));
};

const main = async () => {
  if (order.kind === 'thread') await removeThread(order);
  else await removeComment(order);
  console.log(removedLine(order));
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
