# Plan: the valley's paper, at valleynews.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-21. Slice 1 shipped
(v0.423.0, PR #723, 2026-10-21; migration on `jshack-dev` and `jshack-prod`). Slice 2 shipped
(v0.424.0, PR #724, 2026-10-21; no migration). Next is the close-out browser run, posting,
editing and removing through the script; then the opening stories on release day.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

One place where everything is announced: the valley's own news, the game's development news in
the developer's own voice, and real-world security news. It is a public site in the world, read
with `curl` or `lynx`, its stories written by hand and posted by the operator. Origin: "Local
news" under "More public websites" in `docs/backlog.md`, the last of the three sites picked there
(the block explorer and the forum are built), widened by the owner from in-world headlines to
every kind of announcement.

## Where it starts from (facts, 2026-10-21)

- **A fixed site is a row.** Adding one to `FIXED_SITES` (`generation/fixedSites.ts`) gives it a
  box with `http` and `ssh`, a public address, a findit listing, `whois` and operator restore
  (`scripts/restoreSite.ts <domain>`). Its address is the next placeless one after hireme.io's
  (`generation/world.ts`, `ADDRESS_BY_KEY`), so nobody's moves. Every fixed site's root password
  is uncrackable; the way in is a root-tier CVE.
- **talkit.io is the model** (`docs/talkit-architecture.md`): what was written lives in server
  tables, and the pages showing it are built by a function, never served from a file. `/` is a
  static `index.html` planted by `generation/fixedSiteFs.ts`, so a root can rewrite it; the
  function paths answer on the site's network and the exact path even when a root plants a file of
  the same name (`network/resolveHttpFetch.ts`). Every string goes out through one escape. An
  unknown id is a **404**, which carries no page in this game. `access.log` records every view
  beside the visitor's address, as on any site.
- **talkit's operator script is the model for the operator's** (`scripts/talkitRemove.ts`): run
  with `npx dotenv -e .env.development.local -- npx tsx scripts/…` against dev, or with
  production's `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` against prod. It refuses a bad order
  before touching anything (exit 2), prints one line naming what it is about to do and the
  database it will do it to, then writes. No confirmation, no undo, no trace on the site's box.
  Its parsing and its lines live in `core/` (`core/talkit/removal.ts`), where they are tested.
- **The web tools reach only the world.** `lynx https://therecord.media/…` answers
  `lynx: (6) Could not resolve host`, as `curl` and `gobuster` do, through one shared resolution.
- **`renderPage` has no images**, as real lynx has none.
- **A game day is a real day** (`gameDayAt(now)`, whole days since `WORLD_EPOCH`), so a story
  carries a real date with no in-game calendar to reconcile.
- **The home `README` is the one file the game plants in a new player's home**
  (`core/hackademy/readme.ts`, `WELCOME_README`): it walks them online and ends at
  `# lynx http://hackademy.io`. A player who already has a box never gets it again.
- **The main bundle has 1,205 B left** under the 286,975 B gzipped ceiling (285,770 B at v0.422.0,
  `scripts/checkBudgets.ts`). The masthead and the README line are client bytes; the section and
  story pages are built on the server and cost none.

## Decisions (owner-confirmed 2026-10-21)

1. **One site in the world, in labelled sections.** It carries three voices: the valley's (in the
   fiction), the developer's and the real world's (both outside it). Rejected: in-world news only,
   with the developer's notes and real news on a channel outside the game (two places to look,
   when the owner wants one).
2. **v1 is hand-written stories only**, by the owner and by Claude (filler that makes the valley
   feel inhabited), posted through the operator script. Rejected for v1: headlines generated from
   the world, and headlines from what players did (watching journals for bricks and defacements);
   both are content generators with their own rules, deferred as townsfolk threads were for talkit.
3. **The name is `valleynews.io`.** The game stays in Harrow Valley however many towns it grows,
   so a valley paper always fits. Rejected: `newsit.io` (the *-it.io* family), `readit.io`.
4. **The talkit pattern for a root.** `/` is a static masthead on the box's disk: the paper's name
   and the three sections. A root can rewrite it, fake developer announcement included, and
   `restoreSite.ts valleynews.io` puts it back. Sections and stories are built from the table, so
   a root cannot forge, edit or delete a story. Nothing warns a reader that the masthead can lie.
   Rejected: headlines on `/` built by the server, leaving nothing on the page to deface.
5. **Three sections, each with a one-line label under its heading**: `/valley` *News from Harrow
   Valley*, `/dev` *From the people who build jshack.me*, `/wire` *Security news from the real
   world*. The line between fiction and reality is drawn once, at the section heading. Rejected: a
   `/latest` stream across sections (cheap to add later if asked for), and one mixed stream with a
   tag per story.
6. **A real source is plain text, never a link**: `Source: The Record — https://…` at the end of
   the body, for the reader to copy into a real browser. The same holds in `/dev`. No link on the
   site leaves the world, so a defaced masthead cannot send anyone anywhere real. Rejected: a link
   that fails with `Could not resolve host`, and a link the game opens in the player's real browser
   (new client code, and a way off an attackable page to any real URL).
7. **Every story has a byline**, free text set by the script ("Mara Ellis, Ridgemont desk", the
   owner's name, "The wire desk") and tied to no account. A small cast of recurring reporters is
   how filler reads as a paper. A reporter with an emailit.io inbox is mission-shaped and out of
   scope. Rejected: one fixed byline per section, and none.
8. **A body is plain text**, paragraphs split on blank lines, escaped on the way out and each
   wrapped in `<p>`, as talkit treats a post. No markup and no images. Rejected: trusted HTML, and
   a small markup with indented code blocks (a small change to add later if a dev post needs it).
9. **A section page lists headlines**, newest first, each with its date and byline, linking to
   `/story?id=<n>`; reading a story is a second request, and its address can be passed around in
   mail or on talkit. No paging. An empty section says *No stories yet.*; an unknown or removed id
   is a 404. Rejected: every story in full on its section page, and the newest in full above the
   rest.
10. **The operator script posts, edits and removes**: `post <file>`, `edit <id> <file>` and
    `remove <id>`. An edit replaces the title, byline and body (and section) and keeps the story's
    id and date, silently, with no "updated" mark, so links already passed around keep working.
    Rejected: post and remove only (a fix gives a new id and breaks the old links), and post only.
11. **A story is a file**: three header lines, a blank line, then the body.

    ```
    section: wire
    title: A router flaw nobody patched
    byline: The wire desk

    First paragraph…

    Source: The Record — https://therecord.media/…
    ```

    The server stamps the date when the story is posted. The script refuses an unknown section, a
    missing or repeated header, or an empty title, byline or body, before anything is touched.
    Rejected: flags plus a body file (shell quoting fights titles), and interactive prompts.
12. **The table is the only record.** A story file is scratch input, kept or thrown away; Claude
    drafts filler as files in its scratchpad for the owner to read, and the owner posts the ones
    they like. Rejected: story files committed under a `news/` folder (two copies that drift), and
    files the script syncs into both databases.
13. **Nothing is seeded.** The paper opens empty, and on release day the owner posts the opening
    stories to prod with the script, from drafts Claude writes beforehand (a `/dev` launch note, a
    couple of `/wire` pieces, a few `/valley` stories). Rejected: a migration seeding a launch
    story or one per section (content frozen in SQL that no story file edits).
14. **Discovery is findit plus one README line**:
    `News from the valley, and from the people who build it: lynx http://valleynews.io`. Rejected
    for v1: the newest `/dev` headline on the boot screen (a box boots before it is on a network,
    and it needs a server read and client code); kept in `backlog.md` for when the bundle has
    room, perhaps as a line after `nmcli connect`.
15. **A root gets the masthead, `access.log` and the power to brick**, and nothing built from the
    table: the stories live off the box. Rejected: a read-only copy of the stories as files
    (nothing a reader lacks), and an embargo queue only a root could read (noted for missions,
    where a leaked story could be a job).
16. **The row**: hostname `valleynews`, place `{ category: 'hacker', place: 'the newsroom' }`,
    the next 193 address after hireme.io's.

## Slices

1. **The paper reads and posts.** The `FIXED_SITES` row and its masthead, the stories table and
   its migration (on `jshack-dev` and `jshack-prod`), the server-built `/valley`, `/dev`, `/wire`
   and `/story?id=<n>`, the story-file parser in `core/`, the operator script's `post`, and a
   `scripts/testValleynews.ts` wire-check.
2. **Edit, remove and the README line.** `edit <id> <file>` and `remove <id>` on the same script,
   reusing the parser and the id lookup, and the line at the end of `WELCOME_README`.

A browser run closes out the work after slice 2, posting through the script. Release-day posting
of the opening stories follows.

## Slice 1 plan: the paper reads and posts

**As built (v0.423.0, PR #723).** All 13 criteria met. Unit tests at the story file, the pages and
views, the site row and the dispatch; `scripts/testValleynews.ts` 37/37 (it runs the real
`scripts/valleynews.ts post`) and `testRestoreSite.ts valleynews.io` 13/13 live. valleynews.io is
at `193.88.47.244`. The bundle grew 295 B, to 286,065 B of 286,975 B, leaving 910 B: the
masthead is client code, the section and story pages are not. Mutation over `core/valleynews/`
and the dispatch: 270 killed, 0 timeouts; 2 survivors are module-load mutants killed by hand
(Stryker's static-mutant blind spot), 3 no-coverage are `?? ''` fallbacks no file can reach.
The gate's first run found four untested behaviours (a file ending on its last header, a
paragraph broken by a line of spaces, the document frame `curl` prints for the masthead and a
section page), now tested, and three pieces of the reader that did nothing, now gone: `trim`
already takes off a byte-order mark, and one control-character rule serves every field.
Departures from the plan below: the reader refuses every `\p{Cc}` character but the line break,
the C1 range included, a little stricter than the table (lint forbids raw control ranges in a
regex); and the two selects in `api/network.ts` landed with the dispatch, since the handler's
deps require them, and were proven by the wire-check.

**Branch**: `feat/valleynews-paper` · **Version**: 0.422.0 → 0.423.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; one migration, applied to `jshack-dev` then `jshack-prod`
before merge.

**Value.** The operator writes a story file, runs `post` on it, and the story is on
valleynews.io: listed first in its section and readable at its own address, in `curl` or `lynx`,
by anyone who can reach the site.

**Path.** A story file → `scripts/valleynews.ts post <file>` parses it with `core/valleynews/`'s
parser, prints what it is about to post and where, and inserts the row with the service role →
`lynx`/`curl` → the signed `resolveHttpFetch` → `handleResolveHttpFetch` resolves valleynews.io's
address to its one box, as for every fixed site → a GET of `/valley`, `/dev`, `/wire` or
`/story` on valleynews's network is answered by a function over `news_stories` → a line in
valleynews's `access.log`, as for every view.

### Facts read while planning (2026-10-21)

- **talkit's views are the template** (`network/resolveHttpFetch.ts`): `TALKIT_VIEWS` maps a
  path without its query to an answer over `ForumReads`; it is consulted only after the target
  resolved and on talkit's network, so a planted file at the path changes nothing and a dark box
  answers no view. An answer of `null` (a failed or unparseable read) is a 500
  `forum_lookup_failed` with nothing logged; a 404 answer is logged and returns `NOT_FOUND`.
  `core/talkit/answerViews.ts` parses rows with zod (ids `^[1-9][0-9]{0,14}$`, times with their
  offset) and `api/network.ts` wires each read as a plain select.
- **talkit's pages are one wrapper** (`talkitDocument` in `core/talkit/pages.ts`): title, optional
  meta description, the site's `<h1>`, a nav line, `<hr>`, then the body. Every string goes out
  through `escapeHtml` (`findit/page.js`). `playerText` turns line breaks into `<br>` and **links
  every `http://` address**, so it is not the body renderer here: decision 6 wants no links.
- **The front page and `WEB_ROOTS`**: a fixed site's static files are its entry in `WEB_ROOTS`
  (`generation/fixedSiteFs.ts`); findit crawls the front page and lists the site under its meta
  description. The row, the front page and the address are client bytes; the views are server
  code.
- **The address**: `ADDRESS_BY_KEY` hands hireme.io `placelessAddress(6 + …)`; valleynews.io takes
  `placelessAddress(7 + …)`. The boards' server is in the 194 block and holds no placeless one.
- **`RESERVED_HANDLES`** (`emailit/signup.ts`) holds `talkit` and `hireme`, so nobody signs up as
  the site.
- **talkit's migration** stores text as typed and escapes only on the way out, with CHECKs for
  length and control characters (a body may break its lines), RLS on and no policies.
- **talkit's operator script** reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, exits 2 on a bad
  order or missing env before touching anything, prints one line naming the change and the
  database's host, writes with `sr.from(…)`, and exits 1 on a database error. Its words and its
  parsing live in `core/talkit/removal.ts` with tests.
- **The owner works on Windows**, so a story file may arrive with CRLF line ends.

### Choices made while planning (owner-confirmed 2026-10-21)

- **One table, `news_stories`**: `id` (identity), `section` (CHECK `valley`, `dev` or `wire`),
  `title` (1–120 characters, no control character), `byline` (1–60, none), `body` (1–20,000, none
  but the line break), `posted_at` (`now()`). An index on `(section, posted_at DESC, id DESC)`.
  RLS on, no policies. The parser holds the same limits, so the script refuses before the
  database would.
- **The story file is read leniently where it is harmless, strictly where it is not.** CRLF
  becomes LF. Headers are the lines before the first blank line, `name: value` with the value
  trimmed, in any order. Refused, each with one line saying why: a missing, repeated or unknown
  header; a section other than `valley`, `dev` or `wire`; an empty title, byline or body; a value
  over its limit; a control character other than a line break (a tab included). The body is the
  rest, with leading and trailing blank lines dropped.
- **A body's paragraphs** are split on blank lines; inside a paragraph a single line break
  becomes a space, so a story file can be wrapped at any width. Each paragraph is escaped and
  wrapped in `<p>`, and nothing is linked.
- **Every page is one wrapper**, as talkit's: `<h1>valleynews.io</h1>`, a nav line
  `Valley | Dev | Wire` linking the three sections, `<hr>`, then the page.
- **The masthead** (`/`, `index.html`): title `valleynews.io - the Harrow Valley paper`; meta
  description "News from Harrow Valley, from the people who build it, and from the wider world of
  security."; under the nav, one line per section with its heading linked and its label.
- **A section page**: title `<Heading> - valleynews.io`, `<h2>` the heading, the label as a line
  under it, then one `<p>` per story, newest first (equal times by the higher id): the title
  linked to `/story?id=<n>`, a `<br>`, `by <byline>, <YYYY-MM-DD>`. An empty section shows *No
  stories yet.* The headings: **The valley**, **The dev log**, **The wire**.
- **A story page carries its section**: title `<story title> - valleynews.io`, then the section's
  heading (linked) and its label, then `<h2>` the title, `by <byline>, <YYYY-MM-DD>`, and the
  paragraphs. A story reached straight from a mail or a talkit post still says whose voice it is
  in, which is decision 5's line drawn again where a reader may land without the section page.
- **Dates are the day only** (`YYYY-MM-DD`, UTC), as a paper prints them. talkit's
  `ledgerTime` adds the minute; a story's hour says nothing.
- **A 404 for anything that names no story**: `/story` with no id, an id that is not an id, an
  id no row holds. The section paths take no query; `/valley?x=1` is `/valley`.
- **A failed or unparseable read is a 500 `news_lookup_failed`** with nothing logged, as talkit's.
- **`valleynews` joins `RESERVED_HANDLES`**, so nobody signs up as `valleynews@emailit.io` to pass
  for the paper.
- **The script is `scripts/valleynews.ts`**, with `post <file>` in this slice; slice 2 adds `edit`
  and `remove` to it. Before writing it prints `Posting "<title>" to /<section> as <byline> on
  <host>`; after, `Posted story <id>: http://valleynews.io/story?id=<id>`. Exit 0 posted; 1 a
  database error; 2 a bad order, a file it cannot read, a refused file, or missing env, each
  before anything is touched. Its parsing and its lines live in `core/valleynews/storyFile.ts`.
  Posting leaves no trace on valleynews's box: the operator has no address in the world.
- **Bundle**: the row, the masthead and the reserved name are client bytes, measured at
  increment 3 against the 1,205 B left. A breach is raised with the owner before anything is cut.

### Acceptance criteria

1. `curl http://valleynews.io/` prints the masthead: its title, meta description, `<h1>`, nav,
   and the three sections each with its label; `lynx valleynews.io` follows each to its section.
2. A findit search for `news` or `valley` lists valleynews.io with its description; `whois
   valleynews.io` answers; its address is the next in the 193 block and no other network's
   address changed.
3. `scripts/valleynews.ts post story.txt` on a valid `wire` file prints the posting line, inserts
   one row and prints the story's id and address; the story is then first on `/wire`, on no other
   section, and at `/story?id=<n>` with its section heading and label, title, byline, the day it
   was posted, and its paragraphs.
4. A section lists every story it holds, newest first; an empty one says *No stories yet.*
5. A title, byline or body holding markup shows as the text it is on the section page and the
   story page; a body's `https://…` source is text, not a link.
6. A body wrapped across lines reads as one paragraph per blank-line block.
7. `/story`, `/story?id=abc`, `/story?id=0` and an id no story holds each answer 404.
8. The parser refuses, and the script exits 2 having written nothing, for: a missing, repeated or
   unknown header; an unknown section; an empty title, byline or body; a value over its limit; a
   tab or another control character. A CRLF file posts as its LF twin.
9. The table refuses a row the parser would refuse: a bad section, a control character, a value
   over its limit.
10. Every view, a 404 included, is a line in valleynews's `access.log` with the visitor's
    address; a 500 logs nothing.
11. A root's file at `/var/www/html/valley` or `story` changes no view; a rewritten `index.html`
    is served at `/`; a stopped web server or a bricked box answers no view;
    `restoreSite.ts valleynews.io` brings the masthead back with every story untouched.
12. `valleynews` cannot be signed up for at emailit.io ("a reserved system name").
13. Every other fixed site and path is served as before; the bundle check passes.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The story file** (`core/valleynews/storyFile.ts`): parse a file into a story or a refusal,
   and the script's lines; criteria 6 and 8 at the function.
2. **The paper's pages and views** (`core/valleynews/pages.ts`, `answerViews.ts`): the wrapper,
   masthead, section page, story page, and the views over a `NewsReads` fake; criteria 1 and 3–7
   at the page and the view.
3. **valleynews.io is a fixed site**: the row, its address, `WEB_ROOTS`, `valleynews` reserved;
   criteria 2, 12 and 13 in the `fixedSiteFs`, `webIndex`, `world`, `whois` and `signup` tests; the
   bundle measured.
4. **The fetch answers the views**: `NEWS_VIEWS` and `NewsReads` in `ResolveHttpFetchDeps`, the
   dispatch beside talkit's; criteria 7, 10 and 11 at the handler with fake deps.
5. **The migration, the adapter, the script and the wire-check**: `news_stories` to `jshack-dev`;
   the two selects in `api/network.ts`; `scripts/valleynews.ts post`; a new
   `scripts/testValleynews.ts` that runs the real script as the operator would and checks
   criteria 1–5, 7, 9, 10 and 11 live (its stories bylined `wirecheck`, deleted before and
   after), and `testRestoreSite.ts valleynews.io`.
6. **Docs and version 0.423.0**: the handbook's codebase map (`valleynews/`, the script), glossary,
   server table and operate chapter; `restoreSite.ts`'s comment; `docs/project-status.md`; the
   migration to `jshack-prod` before merge.

### Evidence

- Unit and jsdom tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check.
- Wire-check `scripts/testValleynews.ts` against `vercel dev` + local supabase, and
  `testRestoreSite.ts valleynews.io`.
- Mutation gate at PR readiness over `core/valleynews/` and the dispatch.
- No browser run: one at the epic's close-out.

## Slice 2 plan: edit, remove and the README line

**As built (v0.424.0, PR #724).** All 8 criteria met. `readDeskOrder` and the edit, remove and
no-story lines are tested at the function; `scripts/testValleynews.ts` grew from 37 to 51 checks,
running the real `edit` and `remove` live (an edit keeps the id and the exact `posted_at`, and
moves the story between sections in its first-date place). The bundle is 286,170 B of 286,975 B,
805 B left, measured after the vite 8.3.4 bump that landed beside the slice. Mutation over
`storyFile.ts`: 170 killed; 2 survivors are equivalent (the `= ''` destructuring defaults in
`readDeskOrder`, which only a missing word reaches, and the length checks refuse that first),
and 3 no-coverage are slice 1's `?? ''` fallbacks. No departure from the plan: the script reads
a story file inside the verb that needs it, still before the database is asked anything.

**Branch**: `feat/valleynews-desk` · **Version**: 0.423.0 → 0.424.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; no migration.

**Value.** The operator fixes a posted story without breaking the address already passed around,
and takes one down for good; a new player's README tells them where the paper is.

**Path.** `scripts/valleynews.ts edit <id> <file>` reads its order and the file with
`core/valleynews/`'s readers → reads the story's row by id with the service role → prints the
guard line naming the story it is about to change, and the database → updates the row's section,
title, byline and body → prints the story's address. `remove <id>` reads the row the same way,
prints its guard line, and deletes the row. The section and story pages read the table on every
visit, so nothing on the server changes. A new box's README is `core/hackademy/readme.ts`.

### Facts read while planning (2026-10-21)

- **The script reads its order inline** (`verb !== 'post' || …` in `scripts/valleynews.ts`).
  talkit's operator script reads its order in `core/` (`readRemovalOrder`, `core/talkit/removal.ts`),
  tested there, with the thread id rule it shares with the views (`THREAD_ID`, exported from
  `core/talkit/answerViews.ts`).
- **The story id rule** is `STORY_ID` (`^[1-9][0-9]{0,14}$`) in `core/valleynews/answerViews.ts`,
  not exported. `answerViews.ts` imports `storyFile.ts` (for `NEWS_SECTIONS`), so `storyFile.ts`
  cannot import it back without a cycle.
- **talkit's removal reads before it writes**: it reads the row, prints the guard line, writes with
  `.select(…)`, and treats a write that touched no row as nothing there (a run beside it got there
  first): one line, exit 1.
- **A removed id is never handed out again**: `news_stories.id` is `GENERATED ALWAYS AS IDENTITY`,
  so an old link to a removed story stays a 404 and never lands on a newer story.
- **An update keeps the date**: `posted_at` is not a field of a story, so writing the four fields
  leaves it, and the id, as they were. The table's CHECKs hold an edit to the limits they hold a
  post to, so no migration.
- **The README** is 16 lines; `workstationFs.test.ts` holds it to 20 ("fits on one screen") and
  checks each step of the walk. Only a new box gets it: a player who has one keeps theirs.
- **Bundle**: 910 B left. The README line is the only client bytes in the slice: the client
  imports `pages.ts`, which takes only a type from `storyFile.ts`, so the readers and the script's
  lines cost nothing.

### Choices made while planning (owner-confirmed 2026-10-21)

- **The guard lines name the story being changed**, read from its row, beside the database host.
  A mistyped id would otherwise overwrite or delete the wrong story with nothing on screen to say
  so.
  - `edit`: `Editing story <id> "<current title>" in /<current section> on <host>:`, then
    `  now "<new title>" in /<new section> as <new byline>`; after the write,
    `Edited story <id>: http://valleynews.io/story?id=<id>`.
  - `remove`: `Removing story <id> "<title>" from /<section> on <host>`; after,
    `Removed story <id>`.
  - An id no story holds, or a write that finds the row gone: `No story <id> on <host>`, exit 1,
    nothing written.
- **The README ends with the paper, as a prompt line**, in the root shell the walk ends in, inside
  the width of the lines above:

  ```
  # lynx http://hackademy.io

  News from the valley, and from the people who build it:
  # lynx http://valleynews.io
  ```

  Rejected: decision 14's sentence on one line, 81 characters with the command mid-sentence.

### Choices made while planning (Claude's, within the decisions)

- **The order is read in `core/`**, as talkit's: `readDeskOrder(words)` gives `post <file>`,
  `edit <id> <file>` or `remove <id>`, or nothing; nothing prints
  `Usage: valleynews.ts post <file> | edit <id> <file> | remove <id>` and exits 2. An id is a
  story id by the views' own rule, so `edit 07 …` or `remove +7` is refused, never read as 7.
- **`STORY_ID` moves to `storyFile.ts`** and is exported; `answerViews.ts` imports it. The views'
  404 tests are the safety net for the move.
- **Everything refusable without the database is refused first**: the order, the env, then for
  `edit` the file (`Not edited: <reason>`, as `post` prints `Not posted: …`), all exit 2.
- **An edit writes the four fields** whether or not they differ: no comparing, no "nothing
  changed" line.
- **A removal deletes the row.** Nothing else refers to a story, so nothing cascades.
- **Exits**: 0 done; 1 no such story or a database error; 2 a bad order, a file it cannot read or
  that is not a story, or missing env.
- **`storyFile.ts` keeps the readers and the lines**, its header widened to the whole desk, rather
  than a second module for three verbs.

### Acceptance criteria

1. `edit <id> <file>` on a posted story prints its guard line, current title and section and the
   new title, section and byline, then the edited line; `/story?id=<id>` then shows the new title,
   byline and paragraphs under the day it was first posted, at the same id.
2. An edit that changes the section moves the story: listed in the new section at its first
   date's place, and in the old one no longer.
3. `edit` with a file that is not a story, or that cannot be read, exits 2 with the story
   unchanged; with an id no story holds, it prints `No story <id> on <host>`, exits 1 and writes
   nothing.
4. `remove <id>` prints its guard line, deletes the story and prints `Removed story <id>`; the
   story is in no section and `/story?id=<id>` is a 404.
5. `remove` of an id no story holds, one already removed included, prints `No story <id> on
   <host>` and exits 1.
6. Anything but `post <file>`, `edit <id> <file>` or `remove <id>` (an unknown verb, a missing or
   extra word, an id with a sign, a leading zero, or over 15 digits) prints the usage line and
   exits 2 before anything is touched; `post` works as before.
7. A new player's README ends with the paper's line and `# lynx http://valleynews.io`, and still
   fits on one screen; every other line is as before.
8. The bundle check passes.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The desk's order and lines** (`core/valleynews/storyFile.ts`): `STORY_ID` moved in (views
   green), `readDeskOrder`, and the edit, remove and no-story lines; criterion 6 and the lines'
   wording at the function.
2. **The script and the wire-check**: `edit` and `remove` in `scripts/valleynews.ts`;
   `scripts/testValleynews.ts` runs the real script for criteria 1–6 live (its stories bylined
   `wirecheck`, as now).
3. **The README line** (`core/hackademy/readme.ts`): criterion 7 in `workstationFs.test.ts`; the
   bundle measured, criterion 8.
4. **Docs and version 0.424.0**: the handbook's codebase map row and operate chapter for the
   script's three verbs, the glossary entry, `docs/project-status.md`, and this plan's as-built.

### Evidence

- Unit tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check.
- Wire-check `scripts/testValleynews.ts` against `vercel dev` + local supabase.
- Mutation gate at PR readiness over `core/valleynews/storyFile.ts`; the README is a constant
  checked by its test (mutation N/A).
- No browser run in the PR: the work's close-out run follows this slice, posting, editing and
  removing through the script.

## Deferred

- Headlines generated from the world, and headlines from what players did.
- The newest `/dev` headline at boot, or after `nmcli connect`.
- A `/latest` stream across sections, and paging, if a section ever grows long enough.
- Reporters with emailit.io inboxes; an embargo queue a root could read; both mission-shaped.
