# Plan: a forum, at talkit.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-19. **Slice 1 in review**
(PR #708, `feat/talkit-reading`, v0.410.0; the migration is on `jshack-dev` and `jshack-prod`).
Slice 2 is next and has no plan yet.

**Slice 1 as built: where it differs from the plan below** (owner-confirmed 2026-10-19):

- **A thread that is not there is a plain 404**, as a missing file is: `{ error: 'not_found' }`,
  `curl`'s `(22)` line, lynx's own 404 page, logged `404 0`. A 404 carries no page in this game,
  and teaching the clients to show one was not worth widening the slice, so the "No such thread."
  page was dropped.
- **A thread id is at most 15 digits** (`^[1-9][0-9]{0,14}$`), not 18, so every id stays exact
  as a JS number.
- **Titles and handles go through `escapeHtml` alone; only a body goes through `playerText`**,
  which also breaks lines and links. A title is a link itself on the list and plain text in
  `<title>`, so it never links. Every player string is still escaped by the one function.
- **The two selects landed with the dispatch** (increment 4), as `ResolveHttpFetchDeps` does not
  typecheck without them; the migration and wire-check stayed in increment 5.
- **Bundle:** 284,314 B with the row, the front page and the `man mail` sentence, 661 B under the
  ceiling, so decision 5's raise stays in slice 2.
- **Found, not fixed:** `resolveOccupantSweep.test.ts`'s bad-signature test fails in some full
  runs (3 of 6 on the branch) and never alone. Its tampering is a no-op 1 time in 256, which
  does not explain the rate; the cause is not yet found. Goes to `backlog.md` at close-out.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

A public forum players browse with `curl` or `lynx` and post to: anyone writes a post, and other
players comment on it, which makes it a thread. Backlog origin: "More public websites" in
`docs/backlog.md` ("townsfolk talk about their WiFi, jobs and new routers").

## Where it starts from (facts, 2026-10-19)

- **A fixed site is a row.** Adding one to `FIXED_SITES` (`generation/fixedSites.ts`) gives it a
  box with `http` and `ssh`, a public address, a findit listing and operator restore. Its static
  pages are files planted in `generation/fixedSiteFs.ts`.
- **Some paths answer from a function, not a file**: findit's `/?q=`, emailit's `POST /signup`,
  chainit's `/address`, `/recent` and `/rich` (`network/resolveHttpFetch.ts`). A root defaces the
  files but cannot forge what the function answers.
- **emailit.io already holds accounts**: a lowercase unique handle and an `md5` password
  (`email_accounts`), a login saved in plain text in `~/.mailrc`, a guess throttle per guesser (5 a
  minute) and a send cap (20 an hour per player). It is the only player identity besides the game
  key (`docs/email-architecture.md`).
- **The main bundle has 941 B left** under the fixed 284,975 B gzipped ceiling (v0.409.0,
  `scripts/checkBudgets.ts`). Content built in the browser counts against it; content the server
  answers does not. Nothing in the client is lazy-loaded; every command and screen is in the
  main chunk.
- **lynx forms are single-line `<input>` fields** (text, password, hidden, submit;
  `ui/renderPage.ts`). There is no `<textarea>` and no cookie, so the web keeps no login between
  requests. `curl -d` sends any form body.
- **Moderation is owed before multiplayer is announced**: email's deferred list already names
  reporting, blocking and an operator delete tool (`docs/backlog.md`, "Email — follow-ups
  deferred").

## Decisions (owner-confirmed 2026-10-19)

1. **Players post from the first version.** One general board, not one per town: anyone posts
   whatever they want, and other players comment on a post, which makes it a thread.
2. **An author is an emailit.io account.** A post or comment is signed with a handle and proved
   with that handle's password, so one identity covers mail and the forum, and a stolen
   `~/.mailrc` or a cracked `/etc/emailit/passwd` line lets the thief post as the victim.
   Rejected: talkit's own accounts (a second sign-up and table), the game key or machine name (an
   identity nobody can lose and that gives the player away), anonymous posts.
3. **lynx gains an inline `<textarea>`, so a post or comment can run to several lines.** It
   draws as a box several rows tall; inside it Enter breaks the line (in a one-line field Enter
   submits), Tab, Shift+Tab, Esc and the up and down arrows leave it, and the form is sent from its
   own button. Line breaks travel as `%0A`, as a browser sends them, so `curl -d` already speaks
   it. Rejected: opening nano as real lynx's external editor does, an overlay on an overlay for
   the same result.
4. **The login is `~/.mailrc`, carried like a cookie.** talkit's forms ask for no handle and no
   password. A POST to talkit from `lynx` or `curl` (one shared path) attaches the handle and
   password in the current user's `~/.mailrc` on the box the tool runs on, read as `mail` reads
   it, and the page says "Posting as `<handle>`". The server checks the password against
   `email_accounts` as `resolveMail` does, so a stale file fails and a wrong password counts
   toward the guess throttle; the file is where the credential comes from, never proof by
   itself. No `~/.mailrc` refuses the post plainly ("Not logged in to emailit.io"), with no
   hint. Who you are on the box decides who you post as: a shell as B's user posts as B, a
   `guest` there cannot read B's `0600` file, and root posts as root's own `~/.mailrc` until it
   `su`s to B or copies B's file, the step `mail` already asks for. Not realistic, and wanted:
   standing on somebody's box as them is how a player impersonates them.
5. **The bundle ceiling's code part grows by what talkit measures, rounded up.**
   `BUNDLE_CEILING_BYTES` is 134,975 B of code before world content plus a 150 KB content
   allowance; talkit adds code, so the code part rises (a reason beside the constant) and the
   content allowance stays 150 KB. Rejected: cutting content a third time in a row, and
   lazy-loading lynx, nano or hackademy's pages, which is the lasting fix but its own piece of
   work (box generation is synchronous); it goes to `backlog.md`.
6. **A thread is a post and its flat comments.** A post has a title and a body; comments sit
   under it oldest first, numbered within the thread (`#1`, `#2` …) so players can point at one,
   each with its author's handle and its time in UTC, as `wallet history` and `mail` print time.
   Rejected: nested replies (a tree indented in an 80-column text browser), and no titles (a
   chat stream with nothing for an index to list).
7. **The chainit pattern: a defaceable front page, live views from a function.** `/` is a static
   `index.html` on talkit's disk (the welcome, a link to the thread list, the new-post form),
   which a root can deface or repoint. `/threads`, `/thread?id=<n>` and the two POST targets,
   `/post` (a new thread) and `/comment` (`id=<n>`), always answer from a function over the
   database, even when a root plants a file of the same name; every other path is a file. A root
   changes the site's files, never what players wrote. Rejected: `/` as the live list (the one
   front door a root could not change), and posts as files under the journal like emailit's
   spool (the forum only as honest as its last root, and posts tied to the journal).
8. **`/threads` lists by latest activity, 20 a page.** A comment bumps its thread to the top.
   Each line: the title (a link to its thread), the author's handle, the comment count and the
   time of the last activity. An `older` link (`/threads?page=2` …) pages back. Thread ids only
   ever grow, so a thread's link never changes. Rejected: newest post first (a busy thread sinks
   under every new one), and the newest 20 with no paging (a thread falls off and cannot be
   found from the list).
9. **Mail's numbers.** A title is 1–80 characters on one line; a body or comment 1–4,000,
   line breaks included; blanks at either end are trimmed. Each player writes at most 20 posts
   and comments together in a rolling hour, counted by the game key, never the handle, so
   stolen handles buy no extra. Empty, too long or over the cap is refused plainly and writes
   nothing. Rejected: a looser comment cap (flooding before any moderation exists), no cap.
10. **Plain text, guarded on the way in and escaped on the way out.** The owner's rule: be
    extremely careful with injection. Why it matters here: the `~/.mailrc` cookie rides every
    talkit POST, so a post that could carry a `<form action="/comment">` would make its readers
    comment as themselves — forum CSRF through a post.
    - **In (the server, before anything is stored):** `\r\n` and a lone `\r` become `\n`; every
      other control character is refused (NUL and escapes included), and a title refuses `\n`
      too; length is checked after that. The checked text is stored as typed, never
      pre-escaped, so it is escaped once, the same way, by every reader. Every query is
      parameterised (Supabase RPC arguments). The form body is never logged; `access.log`
      keeps the path through `escapeLogField`, as emailit's POST does.
    - **Out (every page, every time):** one escaping function in one renderer, for every string
      a player wrote — titles, bodies, handles, echoed bad input — escaping `& < > " '`. Links
      come only from a strict match on the escaped text: `http://` or `https://` and a run
      with no space, `<`, `>`, `"` or `'`; `javascript:`, `data:` and everything else stay
      text. The `href` is attribute-escaped and the link shows the URL it goes to. No
      `<textarea>` is ever pre-filled with player text; every form talkit serves is static.
    - **Proof:** a payload corpus through post and view asserts no player text becomes markup:
      `<script>`, `"><form action=/comment>`, `</textarea>`, an already-escaped `&lt;b&gt;`,
      `javascript:alert(1)`, a URL holding `"`, CRLF in a title.
    - **Rejected:** no links (every lead retyped by hand), a tag whitelist (every allowed tag a
      sanitiser to get right, and `<a>` alone can show one place and go to another).
11. **A root on talkit learns who posts from where.** Besides `access.log` (every view and POST
    path beside the visitor's address, as on any site), every write lands one line in
    `/var/log/talkit.log` — `post #12 by neo from <address>`, `comment #3 on #12 by neo from
    <address>` — through `appendMachineLog` as every trace does, the handle through
    `escapeLogField`. It is an ordinary journal file: a root reads it, wipes or edits it to
    cover tracks, and the restore resets it. Nothing warns a poster. Rejected: `access.log`
    alone (a root matches timestamps by hand), and a copy of the posts on disk built from the
    tables (something to edit that fools nobody, since the pages read the database).
12. **Nobody edits or deletes but the operator.** Posts are permanent, as on a BBS. The operator
    removes one with `scripts/talkitRemove.ts <thread|comment>`, shipped in v1 since players post
    in public before launch. A removed comment keeps its number and reads `#3 [removed]`, so "see
    #4" still means #4; a removed thread leaves the list and its link answers "No such thread."
    Rejected for now: authors deleting their own (a fine impersonation mechanic, its own later
    slice; `backlog.md`), and editing (rewrites what others answered, and brings history).
13. **The board opens with one welcome thread by `talkit`, the operator.** It states the rules:
    the cap, and that posts are permanent; nothing about the log. `talkit` joins emailit's
    `RESERVED_HANDLES` (`emailit/signup.ts`) so no player can sign up as it. Townsfolk threads
    — flavour and true leads, generated on the server from the world, so they cost no bundle
    bytes — are the next slice after the epic (`backlog.md`). Rejected: townsfolk in v1 (a
    content generator and its lead rules doubling the epic), and an empty board.
14. **Scripts post, through `curl`, and that is wanted (more fun).** A script calls `curl` as
    typing would (`scripting/commandContext.ts`), so a POST from it carries the `~/.mailrc`
    already on the box; it cannot write one, as scripts never log in to mail. The 20-an-hour
    cap per player is what holds a bot. `lynx` needs a terminal, so scripts never use it.
    Rejected: refusing scripted posts, a carve-out for one site that makes `curl` differ between
    a script and the prompt.
15. **Names.** Fixed-site row `talkit.io` / hostname `talkit` / place
    `{ category: 'hacker', place: 'the town square' }`. Title
    `talkit.io - the Harrow Valley forum`; findit description "A forum for the whole valley:
    start a thread, or join one. Sign in with your emailit.io account." Pages say _thread_,
    _post_ and _comment_, never _message_ (mail's word) or _reply_.
16. **Discovery: findit lists it, and `man mail` ends with one sentence**: "The same login signs
    your posts on talkit.io, the valley's forum." Nothing about `~/.mailrc` being read where the
    player stands, nor about the log. Rejected: findit alone, and a link on findit's front page
    (a findit content change and landmark fingerprints for a site search already finds).
17. **talkit is recoverable when players hit it.** `scripts/restoreSite.ts talkit.io` works from
    the fixed-site row alone (it looks the domain up in `FIXED_SITES`): it ends every session on
    the box, deletes its journal and writes a fresh boot marker, so a defaced page, a brick and
    a doctored or wiped `talkit.log` all go. Posts and comments are in the database, never on
    the box, so a restore leaves every thread as it was; unwanted posts are the operator
    removal's job (decision 12). The script's header list of sites gains talkit.io.
18. **Four slices, one browser run at the close-out.** Each slice with an `api/` change carries
    its wire-check against `vercel dev` + supabase; a migration goes to `jshack-dev` then
    `jshack-prod` before merge.
    1. **The forum opens, read-only**: the fixed-site row and the static front page (linking
       only to what exists); the thread and comment tables, with the welcome thread seeded and
       `talkit` reserved; `/threads` (latest activity, 20 a page) and `/thread?id=`, both
       through the one escaping renderer, with the read half of the injection corpus; the
       findit listing and the `man mail` sentence.
    2. **A player starts a thread**: inline `<textarea>` in lynx; the `~/.mailrc` cookie on a
       talkit POST from lynx and curl, through one path; `POST /post` with the inbound checks,
       the password check and throttle, and the 20-an-hour cap; `talkit.log` lines; the
       new-post form on the front page; the write half of the injection corpus; the ceiling's
       code part raised by what is measured.
    3. **A player comments**: `POST /comment` and the comment form on a thread page; numbering
       and the bump in `/threads`; comments in the same cap and in `talkit.log`.
    4. **The operator removes**: `scripts/talkitRemove.ts`, `#n [removed]` for a comment and
       "No such thread." for a thread.

## Follows from the decisions

- **A dark or bricked talkit takes every view and every post down**, as a bricked findit takes
  search down; `mail` keeps working, since it asks emailit. The remedy is decision 17's restore.
- **A fixed site's root is uncrackable**; the way in is a root-tier CVE, as for the other five.
- **To `backlog.md` at the close-out**: authors deleting their own posts (decision 12),
  townsfolk threads (decision 13), and lazy-loading a large client piece so features stop
  meeting the bundle ceiling (decision 5).

## Slice 1 plan: the forum opens, read-only

**Branch**: `feat/talkit-reading` · **Version**: 0.409.0 → 0.410.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; one migration, applied to `jshack-dev` then `jshack-prod`
before merge.

**Value.** A player opens `talkit.io` in lynx or curl, follows the link to the thread list, and
reads the welcome thread, on a forum whose pages show what players wrote and nothing a root on
the box can forge.

**Path.** `lynx`/`curl` → the signed `resolveHttpFetch` → `handleResolveHttpFetch` resolves
`talkit.io`'s address to its one box, as for every fixed site → a GET to `/threads` or `/thread`
on talkit's network reads the forum table and answers with a page; every other path is a file
under `/var/www/html` → the hit is a line in talkit's `access.log` either way.

### Facts read while planning (2026-10-19)

- **A fixed site's address is its place in a list** (`ADDRESS_BY_KEY`, `generation/world.ts`):
  chainit holds `placelessAddress(4 + …)`, so talkit takes `5 + …` and nobody moves.
- **These follow from the row, unchanged:** the findit listing (`FIXED_LISTINGS`,
  `findit/webIndex.ts`), `whois`, the persona, the gateway's hostname, the router's fs and
  `scripts/restoreSite.ts` (chainit's slice 1 found the same).
- **A view is dispatched by network and path** (`CHAINIT_VIEWS` in
  `network/resolveHttpFetch.ts`), reached only after the target resolved, so a dark site answers
  none; a view that returns `null` is a 500 with no log line (`ledger_lookup_failed`).
- **`escapeHtml` (`findit/page.ts`) already escapes `& < > " '`**, decision 10's set.
- **The game's web is `http://` only.** `parseHttpUrl` (`network/http.ts`) accepts no other
  scheme, and `renderPage` draws a link it cannot follow as plain text.
- **`ledgerTime` (`wallet/historyLine.ts`) prints an ISO instant as `2026-10-11 22:07`** (UTC).
- **lynx re-flows a `<p>` and breaks a line at `<br>`**; a `<pre>` keeps its spacing and does
  not wrap (`ui/renderPage.ts`).
- **emailit's tables set the database pattern** (`20261014000000_email.sql`): RLS on with no
  policies, CHECKs for the rules that must hold whatever writes, the service role the only
  caller. Reads in `api/network.ts` are plain selects at module scope (an `api/` file is an
  endpoint, conventions §4).
- **`RESERVED_HANDLES`** is in `emailit/signup.ts`.

### Choices made while planning (owner to confirm with the plan)

- **The comments table waits for slice 3.** Slice 1 seeds no comment and has nothing to show
  under a thread, and slice 3 owns comment numbering; a table nobody writes or reads has no test
  that can fail. `talkit_threads` carries `comment_count` (0 until slice 3 writes it) and
  `last_activity_at`, so the list needs no join. This narrows decision 18's slice 1 wording.
- **One table, slice 1's columns.** `talkit_threads`: `id` (an identity primary key), `author`
  (CHECK the handle shape), `title` (CHECK 1–80 characters, no control character), `body` (CHECK
  1–4000, no control character but `\n`), `created_at`, `last_activity_at` and `comment_count`
  (default 0), indexed on `(last_activity_at DESC, id DESC)`. The CHECKs repeat decision 10's
  inbound rules as the last guard, as emailit's do. `author` is no foreign key: `talkit` holds
  no account, and accounts are never deleted. RLS on, no policies.
- **The migration seeds the welcome thread**, `author` `talkit`, id 1, title
  `Welcome to talkit.io`, body: "This is the forum for the whole valley. Start a thread from the
  front page, or comment on someone else's. You post as your emailit.io account. Each of us gets
  20 posts and comments an hour. Posts are permanent: nobody can edit or delete what you write."
  The posting it names arrives in slices 2 and 3, before multiplayer is announced.
- **Links: `http://` only, matched on the raw text and escaped piece by piece.** The text is
  split on `http://[^\s<>"']+`; trailing `.,;:!?)` stays text; each plain piece is escaped, and
  each URL becomes `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`. Matching the raw text
  rather than the escaped one (decision 10's wording) keeps entity fragments such as `&quot;` out
  of a URL, and `https://` stays text because no browser here can follow it. One function,
  `playerText`, is the only way player text reaches a page.
- **A body is a `<p>` with a `<br>` per line break**, so lynx wraps prose to the screen; a
  `<pre>` would run a 4,000-character line off it.
- **Pages open, like chainit's, with `<h1>talkit.io</h1>` and a nav line** (`Threads`), then an
  `<hr>`. Front page: the welcome paragraph and the link to `/threads`; no form until slice 2.
  Titles: front `talkit.io - the Harrow Valley forum` with the findit description as its meta
  description, list `Threads - talkit.io`, thread `<title> - talkit.io`.
- **`/threads` lines** are a `<p>` each: the title as a link to `/thread?id=<n>`, then
  `by <handle>, <n> comments, last <time>` (`1 comment` singular). An absent `page` means 1; a
  page that is not `^[1-9][0-9]{0,5}$` answers "No such page." with a link to `/threads`; a page
  past the end says "No threads here." with the same link. 21 rows are read, so `older` appears
  only when a further page exists; page 2 onwards also shows `newer`.
- **`/thread?id=<n>`**: the title as `<h2>`, `by <handle>, <time>`, the body, then "No comments
  yet." until slice 3. An `id` that is not `^[1-9][0-9]{0,17}$`, or names no thread, answers
  **404** "No such thread.": an absent page, logged as the 404 it is (chainit's 200s answer a
  valid question with an empty answer).
- **Only `GET /threads` and `GET /thread` exactly are the forum's**, as `/address` is chainit's;
  `/threads/`, `/thread.html` and every other path are files, and a POST anywhere still gets the
  405 until slice 2.
- **A failed read is `500 forum_lookup_failed` with no log line**, as chainit's is.
- **Bundle:** the row, `index.html` and the `man mail` sentence are client bytes. Measured at
  increment 3; if the 941 B left do not hold them, decision 5's raise lands in this slice
  instead of slice 2.

### Acceptance criteria

1. `curl http://talkit.io/` prints the front page: its title and meta description, the `<h1>`,
   the welcome paragraph and a link to `/threads`. In `lynx talkit.io` the link opens the list.
2. A findit search for `forum` or `talkit` lists `talkit.io` with its description;
   `whois talkit.io` answers; talkit's address is in the 193 block and no other network's
   address changed.
3. `/threads` on the fresh database lists the welcome thread: `Welcome to talkit.io` linking to
   `/thread?id=1`, then `by talkit, 0 comments, last <its time>`.
4. With 45 threads seeded, `/threads` shows the 20 most recently active, newest first and equal
   times by id descending, with an `older` link; `?page=2` the next 20 with `newer` and `older`;
   `?page=3` the last 5 with only `newer`; `?page=9` "No threads here."; `?page=0`, `?page=x`
   and `?page=-1` "No such page."
5. `/thread?id=1` shows the welcome thread's title, `by talkit, <time>`, its body with each line
   break a `<br>`, and "No comments yet." `?id=999999`, `?id=abc`, `?id=` and no `id` answer 404
   "No such thread."
6. **No player text becomes markup.** Threads seeded with `<script>alert(1)</script>`,
   `"><form action=/comment method=post><input type=submit>`, `</textarea>`, `&lt;b&gt;`,
   `javascript:alert(1)` and `http://x.io/a"onmouseover="1` as title and body show each one
   escaped, character for character as written, on both `/threads` and `/thread`, and the page
   holds no element but the forum's own. `http://findit.io/?q=router.` is a link to
   `http://findit.io/?q=router` with the dot outside it; `https://x.io` is text.
7. A thread whose body holds a CR, a NUL or an ESC cannot be stored (the table's CHECK refuses
   it), nor one whose title holds `\n`.
8. Every `/threads` and `/thread` hit is a line in talkit's `access.log` with the query and the
   visitor's address, a 404 included.
9. A root on talkit who writes `/var/www/html/threads` or `/var/www/html/thread` does not change
   the views; a rewritten `index.html` is served at `/`.
10. A talkit whose web server is stopped, or whose box is bricked, answers no view;
    `restoreSite.ts talkit.io` brings back the front page and the views, and the thread rows are
    untouched. The script's comment names talkit.io.
11. When the forum cannot be read, a view is a 500 and nothing is logged.
12. `talkit` cannot be signed up for at emailit.io ("a reserved system name").
13. `man mail` ends with: "The same login signs your posts on talkit.io, the valley's forum."
14. Every other fixed site, and every other path, is served exactly as before; the bundle check
    passes.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **Player text** (`core/talkit/playerText.ts`): escape and link; criterion 6 at the function,
   with the whole corpus.
2. **talkit's pages** (`core/talkit/pages.ts`): the front, list (paging links, the empty and
   bad-page answers), thread and not-found pages, pure. Criteria 1 and 3–6 at the page.
3. **talkit.io is a fixed site**: the `TALKIT` row last in `FIXED_SITES`, its address after
   chainit's, `index.html` in `WEB_ROOTS`, `talkit` reserved. Criteria 2, 12 and 14 in the
   `fixedSiteFs`, `webIndex`, `world`, `whois` and `signup` tests; the bundle measured.
4. **The fetch answers the views**: `findThreads(offset, limit)` and `findThread(id)` in
   `ResolveHttpFetchDeps`, `core/talkit/answerViews.ts` with the row schemas, the dispatch
   beside chainit's. Criteria 3–5 and 8–11 at the handler, with fake deps.
5. **The migration, the adapter and the wire-check**: `talkit_threads` with its CHECKs, index
   and welcome row, to `jshack-dev`; the two selects in `api/network.ts`; a new
   `scripts/testTalkit.ts` seeding through the service role (criteria 3–11 live, 7 as refused
   inserts); `testRestoreSite.ts talkit.io`.
6. **`man mail`, docs, version 0.410.0**: criterion 13; `restoreSite.ts`'s comment; the
   handbook's codebase map and glossary; `docs/project-status.md`; the migration to
   `jshack-prod` before merge.

### Evidence

- Unit and jsdom tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check.
- Wire-check `scripts/testTalkit.ts` against `vercel dev` + local supabase, and
  `testRestoreSite.ts talkit.io`.
- Mutation gate at PR readiness over `core/talkit/` and the dispatch, with no mutant left
  standing in `playerText`.
- No browser run: one at the epic's close-out.
