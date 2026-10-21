// The operator's desk at valleynews.io — posts, edits and removes the Harrow Valley paper's
// stories. The operator runs it by hand; nobody else writes to the paper.
//
// A story is a file: `section:`, `title:` and `byline:` headers in any order, a blank line,
// then the body. The section is `valley`, `dev` or `wire`. The file is read and checked
// before anything is touched, and a file that is not exactly a story is refused with the
// reason. The server stamps the day the story is posted.
//
// An edit rewrites a story in place from a file: its section, title, byline and body. It
// keeps its id and its day, silently, so an address already passed around still opens it.
// A removal deletes the story for good; its address is a 404 from then on, and no later
// story is ever given its id.
//
// There is no confirmation and no undo. The one guard is the line it prints before it
// writes, naming the story, and for an edit what it becomes, and the database it is about
// to write to. Nothing it does leaves a trace on valleynews's box: the operator has no
// address in the world, as a restore has none.
//
// Usage (local):
//   npx dotenv -e .env.development.local -- npx tsx scripts/valleynews.ts post <file>
//   npx dotenv -e .env.development.local -- npx tsx scripts/valleynews.ts edit <id> <file>
//   npx dotenv -e .env.development.local -- npx tsx scripts/valleynews.ts remove <id>
//
// In production the operator supplies production's SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Exits 0 when done, 1 when the id names no story or on a database error, 2 on anything but
// `post <file>`, `edit <id> <file>` or `remove <id>`, a file it cannot read or that is not a
// story, or missing env — all before anything is touched.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  editedLine,
  editingLines,
  noStoryLine,
  postedLine,
  postingLine,
  readDeskOrder,
  readStoryFile,
  removedLine,
  removingLine,
  type StandingStory,
  type Story,
} from '../src/core/valleynews/storyFile.js';

const order = readDeskOrder(process.argv.slice(2));
if (order === null) {
  console.error('Usage: valleynews.ts post <file> | edit <id> <file> | remove <id>');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const readText = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return process.exit(2);
  }
};

/** The story in the file at `path`, or an exit 2 saying why there is none; `refusal` names
 *  what did not happen. It is read before the database is asked anything. */
const storyIn = (path: string, refusal: string): Story => {
  const reading = readStoryFile(readText(path));
  if (!reading.ok) {
    console.error(`${refusal}: ${reading.reason}`);
    return process.exit(2);
  }
  return reading.story;
};

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });
const host = new URL(url).host;

// Typed where they are declared, so that the code after a call knows it never returns.
const fail: (label: string, error: { message: string }) => never = (label, error) => {
  console.error(`${label} failed: ${error.message}`);
  process.exit(1);
};

const noStory: (id: number) => never = (id) => {
  console.error(noStoryLine(id, host));
  process.exit(1);
};

/** The story the id names as its row stands, or an exit 1 when no row holds it. */
const standing = async (id: number): Promise<StandingStory> => {
  const found = await sr.from('news_stories').select('section, title').eq('id', id).maybeSingle();
  if (found.error) fail('reading the story', found.error);
  if (found.data === null) noStory(id);
  return found.data as StandingStory;
};

const post = async (posted: Story) => {
  console.log(postingLine(posted, host));
  const inserted = await sr.from('news_stories').insert(posted).select('id').single();
  if (inserted.error) fail('posting the story', inserted.error);
  console.log(postedLine((inserted.data as { id: number }).id));
};

const edit = async (id: number, edited: Story) => {
  console.log(editingLines(id, await standing(id), edited, host));
  // Only the story's own four fields are written: its id and its day stay as they were.
  const updated = await sr.from('news_stories').update(edited).eq('id', id).select('id');
  if (updated.error) fail('editing the story', updated.error);
  if ((updated.data ?? []).length === 0) noStory(id);
  console.log(editedLine(id));
};

const remove = async (id: number) => {
  console.log(removingLine(id, await standing(id), host));
  const deleted = await sr.from('news_stories').delete().eq('id', id).select('id');
  if (deleted.error) fail('removing the story', deleted.error);
  if ((deleted.data ?? []).length === 0) noStory(id);
  console.log(removedLine(id));
};

const main = async () => {
  if (order.verb === 'post') await post(storyIn(order.file, 'Not posted'));
  else if (order.verb === 'edit') await edit(order.id, storyIn(order.file, 'Not edited'));
  else await remove(order.id);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
