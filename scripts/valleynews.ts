// The operator's desk at valleynews.io — posts a story to the Harrow Valley paper. The
// operator runs it by hand; nobody else writes to the paper.
//
// A story is a file: `section:`, `title:` and `byline:` headers in any order, a blank line,
// then the body. The section is `valley`, `dev` or `wire`. The file is read and checked
// before anything is touched, and a file that is not exactly a story is refused with the
// reason. The server stamps the day the story is posted.
//
// There is no confirmation. The one guard is the line it prints before it writes, naming
// the story, its section and byline, and the database it is about to post to. Posting
// leaves no trace on valleynews's box: the operator has no address in the world, as a
// restore has none.
//
// Usage (local):
//   npx dotenv -e .env.development.local -- npx tsx scripts/valleynews.ts post <file>
//
// In production the operator supplies production's SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Exits 0 on a post, 1 on a database error, 2 on anything but `post <file>`, a file it
// cannot read or that is not a story, or missing env — all before anything is touched.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { postedLine, postingLine, readStoryFile } from '../src/core/valleynews/storyFile.js';

const [verb, file, ...rest] = process.argv.slice(2);
if (verb !== 'post' || file === undefined || rest.length > 0) {
  console.error('Usage: valleynews.ts post <file>');
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

const reading = readStoryFile(readText(file));
if (!reading.ok) {
  console.error(`Not posted: ${reading.reason}`);
  process.exit(2);
}
const { story } = reading;

const sr = createClient(url, serviceKey, { auth: { persistSession: false } });

const main = async () => {
  console.log(postingLine(story, new URL(url).host));
  const posted = await sr.from('news_stories').insert(story).select('id').single();
  if (posted.error) {
    console.error(`posting the story failed: ${posted.error.message}`);
    process.exit(1);
  }
  console.log(postedLine((posted.data as { id: number }).id));
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
