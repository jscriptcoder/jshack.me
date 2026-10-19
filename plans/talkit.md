# Plan: a forum, at talkit.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-19. No slice is planned
yet; slice 1 is next.
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
