# valleynews architecture (as-built)

How the valley's paper works: `valleynews.io`, a fixed site that carries every announcement in
the game, read with `curl` or `lynx`, its stories written by hand and posted by the operator. This
is the shipped model of the valleynews work, complete at **v0.424.0** (two slices, v0.423.0 and
v0.424.0, PRs #723 and #724). Headlines generated from the world or from what players did are
**not** here (see "Deferred"). The grill record and slice plans were retired on close-out. When
this doc and the code disagree, the code wins — fix the doc.

## The one idea the design turns on

**One paper, three voices, and the line between them drawn at each section's heading.** The
valley's own news is fiction; the developer's notes and real-world security news are not. The
owner wanted one place to look rather than a channel outside the game, so all three live on one
site in the world, and every section page, and every story page, says which voice it is in:

| Path      | Heading     | Label                                 |
| --------- | ----------- | ------------------------------------- |
| `/valley` | The valley  | News from Harrow Valley               |
| `/dev`    | The dev log | From the people who build jshack.me   |
| `/wire`   | The wire    | Security news from the real world     |

A story reached straight from a mail or a talkit post still carries its section's heading and
label, so a reader who never saw the section page knows whose voice it is.

The second idea is talkit's: **what the paper printed lives in a server table, and the pages
showing it are built by a function, never served from a file.** A root on the paper can deface
its masthead, read its log and brick its box, but cannot forge, edit or delete a story.

## 1. The site

- **valleynews.io is the eighth fixed site**: the `VALLEYNEWS` row last in `FIXED_SITES`
  (`generation/fixedSites.ts`, exported network `VALLEYNEWS_NETWORK`), hostname `valleynews`,
  place `{ category: 'hacker', place: 'the newsroom' }`, its address `193.88.47.244`
  (`placelessAddress(7 + …)` in `ADDRESS_BY_KEY`, `generation/world.ts`), after hireme.io's, so
  nobody else's moved. The row gives it a box with `http` and `ssh`, a findit listing, `whois`, a
  persona and operator restore. Its root is uncrackable; the way in is a root-tier CVE, as for
  every fixed site. `valleynews` is in `RESERVED_HANDLES` (`emailit/signup.ts`), so nobody signs
  up as `valleynews@emailit.io` to pass for the paper.
- **`/` is the masthead, a static `index.html`** (`VALLEYNEWS_FRONT_PAGE` in
  `core/valleynews/pages.ts`, planted through `WEB_ROOTS` in `generation/fixedSiteFs.ts`): title
  `valleynews.io - the Harrow Valley paper`, a meta description findit lists ("News from Harrow
  Valley, from the people who build it, and from the wider world of security."), then one line
  per section, its heading linked and its label under it. It is the one page on the box's disk,
  so the one a root can rewrite, a fake developer announcement included. Nothing warns a reader
  that it can lie.
- **Every page is one wrapper**: `<h1>valleynews.io</h1>`, the nav `Valley | Dev | Wire`, `<hr>`,
  then the page.
- **Discovery**: findit lists it (a search for `news` or `valley` finds it first), and a new
  player's README ends with it (`core/hackademy/readme.ts`), in the root shell the walk ends in:

  ```
  # lynx http://hackademy.io

  News from the valley, and from the people who build it:
  # lynx http://valleynews.io
  ```

  Only a new box gets the README; a player who has one keeps theirs.

## 2. The table

- **`news_stories`** (`supabase/migrations/20261021000000_news_stories.sql`): `id` (identity,
  `GENERATED ALWAYS`), `section` (CHECK `valley`, `dev` or `wire`), `title` (1–120 characters),
  `byline` (1–60), `body` (1–20,000), `posted_at` (`now()`). Counted as characters. No field holds
  a control character, but a body may break its lines. An index on
  `(section, posted_at DESC, id DESC)`. RLS on with no policies: the Vercel function, which only
  reads, and the operator's script are the only callers, both as the service role.
- **Text is stored as written** and escaped only when a page shows it.
- **The table is the only record.** A story file is scratch input, kept or thrown away; nothing
  is seeded, so a fresh database prints *No stories yet.* in every section.
- **A removed id is never handed out again** (identity), so an old link to a removed story stays
  a 404 and never lands on a newer one.

## 3. The views

- **Four paths answer from a function**, on valleynews's network and the path exactly, whatever
  a root plants at the same name (`NEWS_VIEWS` in `network/resolveHttpFetch.ts`): `/valley`,
  `/dev`, `/wire` and `/story`. The query is ignored for the sections (`/valley?x=1` is
  `/valley`). A view is reached only after the target resolved, so a stopped web server or a
  bricked box answers none. A POST to any of them is the 405 every server without a form gives.
- **The reads** are two plain selects in `api/network.ts`, `findStories(section)` (newest first,
  equal times by the higher id) and `findStory(id)`, behind `NewsReads`
  (`core/valleynews/answerViews.ts`). Rows come off the wire, so each is parsed with zod; a time
  must carry its offset.
- **A section page** (`sectionPage`): title `<Heading> - valleynews.io`, the heading and label,
  then one paragraph per story: its title linked to `/story?id=<n>`, then
  `by <byline>, <YYYY-MM-DD>`. No paging. An empty section says *No stories yet.*
- **A story page** (`storyPage`): title `<story title> - valleynews.io`, the section's heading
  (linked) and label, the title, `by <byline>, <YYYY-MM-DD>`, then the body's paragraphs.
- **A body is plain text.** It is split into paragraphs on blank lines (a line of spaces counts),
  and a single line break inside a paragraph becomes a space, so a story file can be wrapped at
  any width. Each paragraph is escaped and wrapped in `<p>`. Nothing is linked: a real source is
  written at the end of the body as `Source: The Record - https://…`, text for the reader to copy
  into a real browser. No link on the site leaves the world, so a defaced masthead cannot send a
  reader anywhere real either. No markup, no images.
- **Dates are the day only**, in UTC, as a paper prints them.
- **A 404 for anything that names no story**: `/story` with no id, an id that is not one (a sign,
  a leading zero, 0, over 15 digits, letters), and an id no row holds, a removed one included.
  Text that is not an id never reaches the table. lynx shows it as
  `lynx: (22) The requested URL returned error: 404`.
- **A failed or unparseable read is a 500 `news_lookup_failed`** with nothing logged, as
  talkit's.
- **The log**: every view, a 404 included, is a line in valleynews's `access.log` with the
  visitor's address, as on any site.

## 4. The operator's desk

`scripts/valleynews.ts` is the only way a story reaches the paper. Its order, its story file and
every line it prints are read and built in `core/valleynews/storyFile.ts`, where they are tested.

- **A story is a file**: `section:`, `title:` and `byline:` headers in any order, a blank line,
  then the body.

  ```
  section: wire
  title: A router flaw nobody patched
  byline: The wire desk

  First paragraph…

  Source: The Record - https://therecord.media/…
  ```

  A file that is not exactly a story is refused with the reason, never guessed at: a missing,
  repeated or unknown header (header names are lowercase), a line in the headers that is not
  one, an unknown section, an empty title, byline or body, a value over its limit, or a control
  character other than a line break (a tab included; the C1 range too, which is a little stricter
  than the table). What an editor adds on its own, a CRLF or a byte-order mark, is read through.
  The byline is free text, tied to no account: a small cast of recurring reporters is how filler
  reads as a paper.
- **Three verbs**, the order read by `readDeskOrder`:
  - `post <file>`: `Posting "<title>" to /<section> as <byline> on <host>`, then
    `Posted story <id>: http://valleynews.io/story?id=<id>`. The server stamps the day.
  - `edit <id> <file>`: reads the row first, then
    `Editing story <id> "<current title>" in /<current section> on <host>:` and
    `  now "<new title>" in /<new section> as <new byline>`, writes the four fields, and prints
    `Edited story <id>: http://valleynews.io/story?id=<id>`. The id and the day stay, silently, so
    links already passed around keep working; a new section moves the story there, in its first
    date's place.
  - `remove <id>`: reads the row first, then `Removing story <id> "<title>" from /<section> on
    <host>`, deletes it, and prints `Removed story <id>`.
- **The guard** is the line printed before each write, naming the story as it stands and the
  database host, so a mistyped id shows the wrong story before it is overwritten. There is no
  confirmation and no undo.
- **An id is read by the views' own rule** (`STORY_ID`), so `edit 07 …` or `remove +7` is
  refused, never read as 7.
- **Exits**: 0 done; 1 when the id names no story (`No story <id> on <host>`, including one
  removed by a run in between) or on a database error; 2 on a bad order (the usage line
  `Usage: valleynews.ts post <file> | edit <id> <file> | remove <id>`), a file it cannot read or
  that is not a story (`Not posted: …` / `Not edited: …`), or missing env, each before the
  database is asked anything.
- **Nothing the operator does leaves a trace on the paper's box**: the operator has no address in
  the world, as a restore has none.
- **Production** takes production's `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; the host in
  every guard line says which database it is.

## 5. What a root finds

The masthead, `access.log` and the power to brick, and nothing built from the table: the stories
live off the box. A rewritten `index.html` is served at `/`; a file planted at
`/var/www/html/valley` or `story` changes no view. `scripts/restoreSite.ts valleynews.io` puts the
masthead back, empties the journal (the log with it) and leaves every story as it was.

## 6. The bundle

The client carries the row, the masthead, the reserved name and the README line; the section and
story pages, the reads and the desk are server or script code (the client takes only a type from
`storyFile.ts`). Slice 1 added 295 B, to 286,065 B; slice 2 and the vite 8.3.4 bump beside it
together added 105 B, to 286,170 B of the 286,975 B ceiling at v0.424.0, with no raise.

## 7. Proving it

- **Unit**: the story file, the order and the desk's lines (`storyFile.test.ts`); the masthead
  (`pages.test.ts`); the sections and stories over a fake `NewsReads` (`answerViews.test.ts`);
  the row, address and web root (`fixedSiteFs`, `webIndex`, `world`, `whois` and `signup` tests);
  the dispatch, its log and its root cases (`resolveHttpFetch.test.ts`); the README
  (`workstationFs.test.ts`).
- **Wire-checks** (vs `vercel dev` + local supabase): `scripts/testValleynews.ts` (51: the
  masthead and findit; posting through the real script, CRLF and all; each section and story;
  markup and sources as text; the 404s; refused files and orders; the table's CHECKs; the log; a
  root's planted files, a stopped and a bricked paper and the restore; the real `edit` and
  `remove`, the id and exact `posted_at` kept, a section moved, a refused or unknown edit writing
  nothing, a removal's 404 and a second removal's exit 1); `scripts/testRestoreSite.ts
  valleynews.io`.
- **Mutation**: each slice's scoped run left no survivor but equivalents and module-load mutants
  killed by hand.
- **One browser run at the close-out** (2026-10-21, v0.424.0), one reader in a headed browser
  while the operator ran the real script. A new box's README ended at the paper. On
  PRIMROSE-HOUSE with lynx: the masthead; `/valley` with its one story; the story page with its
  voice, a wrapped line read as one paragraph; the wire story's source as text with no link
  number. After `edit 51` from `/valley` to `/dev`: the same address with the new words and the
  first day, `/valley` empty, `/dev` in date order. After `remove 53`: lynx's 404, `/wire` empty,
  and a second removal's `No story 53`. findit's `news` search listed the paper first. A planted
  masthead was served ("EXTRA EXTRA"), and `restoreSite.ts valleynews.io` brought the real one
  back with both stories kept. No release had a root-tier hole that day, so the defacement was
  planted through the service role, as the e2e runbook prescribes. No defect.

## Deferred

In `backlog.md` under "valleynews — follow-ups deferred": headlines generated from the world, and
from what players did; the newest `/dev` headline at boot, or after `nmcli connect`; a `/latest`
stream across sections, and paging; reporters with emailit.io inboxes and an embargo queue a root
could read, both mission-shaped; a small markup for code blocks if a dev post needs one.

## Key files

- **Server**: `supabase/migrations/20261021000000_news_stories.sql`; `api/network.ts`
  (`findStories`, `findStory`).
- **The paper**: `core/valleynews/` — `storyFile.ts`, `pages.ts`, `answerViews.ts`.
- **Wiring**: `core/network/resolveHttpFetch.ts` (`NEWS_VIEWS`), `core/generation/fixedSites.ts`,
  `core/generation/fixedSiteFs.ts`, `core/generation/world.ts`, `core/emailit/signup.ts`
  (`RESERVED_HANDLES`), `core/hackademy/readme.ts`.
- **Operator**: `scripts/valleynews.ts`, `scripts/restoreSite.ts valleynews.io`.
