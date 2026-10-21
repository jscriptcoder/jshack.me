# Plan: the valley's paper, at valleynews.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-21. No slice is planned
yet; slice 1 is next.
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

## Deferred

- Headlines generated from the world, and headlines from what players did.
- The newest `/dev` headline at boot, or after `nmcli connect`.
- A `/latest` stream across sections, and paging, if a section ever grows long enough.
- Reporters with emailit.io inboxes; an embargo queue a root could read; both mission-shaped.
