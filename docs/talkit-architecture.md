# talkit architecture (as-built)

How the valley's forum works: `talkit.io`, a fixed site where players start threads and comment
on them as their emailit.io account, read with `curl` or `lynx`. This is the shipped model of the
talkit epic, complete at **v0.414.0** (four slices, v0.410.0–v0.413.0, PRs #708–#711, and the
lynx fix the close-out found, PR #712). Townsfolk threads and authors deleting their own posts
are **not** here. The grill record and slice plan were retired on close-out; what the epic left
out is in `backlog.md` under "talkit — follow-ups deferred". When this doc and the code disagree,
the code wins — fix the doc.

## The one idea the design turns on

**What players wrote lives in server tables, and the pages that show it are built by a
function, never served from a file.** talkit.io is chainit.io's pattern: a defaceable front page
on the box's disk, and live views answered over the database. A root on talkit can deface,
repoint or wipe the site's files, read its logs and brick its box, but cannot forge, edit or
delete a single post. The alternative, posts as files in the box's journal, was rejected because
the forum would then be only as honest as its last root, and posts would be tied to the journal.

Everything else follows from that: the server is the only authority, every write is checked
afresh against `email_accounts` (there is no forum session), and every string a player wrote is
escaped by one function on its way out.

## 1. The site

- **talkit.io is the sixth fixed site**: the `TALKIT` row last in `FIXED_SITES`
  (`generation/fixedSites.ts`), hostname `talkit`, place
  `{ category: 'hacker', place: 'the town square' }`, its address after chainit's in
  `ADDRESS_BY_KEY`. The row alone gives it a box with `http` and `ssh`, a public address in the
  193 block, a findit listing ("A forum for the whole valley: start a thread, or join one. Sign
  in with your emailit.io account."), `whois` and operator restore. Its root password is
  uncrackable (`CRACKABLE_ROOT_CHANCE = 0`); the way in is a root-tier CVE, as for every fixed
  site.
- **`/` is a static `index.html`** (`TALKIT_FRONT_PAGE` in `core/talkit/pages.ts`, planted by
  `generation/fixedSiteFs.ts`): the welcome, a link to `/threads`, and the "Start a thread" form
  (a title `<input>`, a `<textarea>` for the body, a `[ Post ]` button, no handle or password
  field). A root can rewrite it, and `/` then serves what they wrote.
- **Four paths answer from a function**, on talkit's network and the path exactly, even when a
  root plants a file of the same name (`network/resolveHttpFetch.ts`): `GET /threads`,
  `GET /thread`, `POST /post` and `POST /comment`. `/threads/`, `/thread.html` and every other
  path are files; a POST anywhere else is the 405. A view is reached only after the target
  resolved, so a dark or bricked talkit answers none, while `mail` keeps working.
- **Discovery**: findit lists it, and `man mail` ends with "The same login signs your posts on
  talkit.io, the valley's forum." Nothing tells a player that `~/.mailrc` is read where they
  stand, or that the box logs who wrote what.
- **The board opens with one welcome thread by `talkit`**, seeded by the first migration. It
  states the 20-an-hour cap and that posts are permanent, and says nothing about the log.
  `talkit` is in emailit's `RESERVED_HANDLES` (`emailit/signup.ts`), so no player can sign up as
  it.

## 2. The server: three tables, two functions

Four migrations: `20261019000000_talkit_threads.sql` (threads and the welcome row),
`20261019010000_talkit_post.sql` (the write count and `talkit_post`),
`20261020000000_talkit_comment.sql` (comments and `talkit_comment`) and
`20261020010000_talkit_removal.sql` (the cascade and removable comments). RLS is on with no
policies, so the service-role functions in `api/network.ts` are the only callers.

**Tables.**

- `talkit_threads` — `id` (an identity, at most 15 digits so it stays exact as a JS number),
  `author`, `title`, `body`, `created_at`, `last_activity_at` and `comment_count`, indexed on
  `(last_activity_at DESC, id DESC)` so the list needs no join. `author` is no foreign key:
  `talkit` holds no account.
- `talkit_comments` — `(thread_id, number)` as the primary key, `author`, `body`, `created_at`.
  `thread_id` references the thread `ON DELETE CASCADE`. `author` and `body` are NULL together
  or not at all (a removed comment, section 7).
- `talkit_writes` — `(player_key, written_at)`, one row per post or comment, the one count the
  20-an-hour cap reads.

The CHECKs repeat the inbound rules as the last guard: a handle's shape; a title of 1–80
characters with no control character; a body of 1–4,000 with no control character but `\n`.

**Functions** (`SECURITY DEFINER`, `STRICT`, `EXECUTE` for `service_role` alone, shaped as
emailit's `email_send`):

- `talkit_post(handle, password_md5, player_key, title, body)` — `email_check_password` first,
  so a wrong password counts toward mail's 5-a-minute guess throttle; then an advisory lock on
  the key, rows older than an hour cleared, `capped` at 20; then the thread and a
  `talkit_writes` row. It answers `posted` with the id, `login_failed`, `throttled` or `capped`.
- `talkit_comment(handle, password_md5, player_key, thread_id, body)` — the same checks, then
  one `UPDATE` of the thread that adds 1 to `comment_count`, sets `last_activity_at` to `now()`
  and returns the new count. No row is `no_thread`, writing and counting nothing. The row lock
  that `UPDATE` takes numbers two comments on one thread one after the other; the comment goes
  in with the returned number. A comment bumps its thread to the top of the list.

**The cap is counted by the game key, never the handle**, so stolen handles buy no extra posts.
A failed or throttled login counts nothing toward it.

**Reads** are plain selects in `api/network.ts`: `findThreads(offset, limit)`,
`findThread(id)` and `findComments(threadId)`; the writes are `postThread` and `postComment`. A
read that fails is `500 forum_lookup_failed`; a write that fails, or answers a word nobody
taught the handler, is `500 post_failed` or `comment_failed`. None of the three logs a line.

## 3. The pages

All built by `core/talkit/pages.ts`, opening like chainit's with `<h1>talkit.io</h1>`, a
`Threads` nav line and an `<hr>`.

- **`/threads`** lists 20 a page by latest activity, equal times by id descending. Each line is
  the title as a link to `/thread?id=<n>`, then `by <handle>, <n> comments, last <time>`
  (`1 comment` singular; times in UTC as `ledgerTime` prints them). 21 rows are read, so
  `older` appears only when a further page exists; page 2 onwards also shows `newer`. A page
  that is not `^[1-9][0-9]{0,5}$` answers "No such page."; one past the end says "No threads
  here."
- **`/thread?id=<n>`** shows the title as `<h2>`, `by <handle>, <time>`, the body, then the
  comments oldest first, each `#<n> by <handle>, <time>` and its body, or "No comments yet.";
  then a "Comment" heading and a form holding `<input type="hidden" name="id">`, a body box and
  a `[ Comment ]` button. Every comment is on the one page; the cap is what bounds a thread.
  An id that is not `THREAD_ID` (`core/talkit/answerViews.ts`), or names no thread, is a plain
  **404**, as a missing file is: a 404 carries no page in this game.
- **Answers to a write** are 200 pages linking back to the front page: "Posted as `<handle>`."
  or "Commented as `<handle>`." with a link to the thread, or a refusal ("Not logged in to
  emailit.io.", "Login failed for `<handle>`@emailit.io.", "Too many failed logins. Wait a
  minute.", "You have posted 20 times in the last hour. Wait a while.", the length and control
  character sentences, "No such thread."). A refusal writes nothing and echoes nothing typed.

## 4. The login: `~/.mailrc` as a cookie

**An author is an emailit.io account**, so one identity covers mail and the forum. talkit's
forms ask for no handle or password: a POST to talkit's address from `lynx` or `curl -d` (one
path, `fetchPageAcrossNetwork` in `commands/webPage.ts`) attaches the login in the current
user's `~/.mailrc` on the box the tool runs on, read by `emailit/mailrc.ts`, the one reader
`mail` uses too. It rides only a POST whose host is
`siteAddress('talkit.io')`, as a browser scopes a cookie to its site: no GET carries it and no
other server is handed it. The envelope (`resolveHttpFetchSchema`) carries it as `login`, read
by talkit's two POST paths alone and never logged; its form cap is 49,152 characters, room for
a 4,000-character body of 4-byte characters percent-encoded.

The file is where the credential comes from, never proof by itself: the server checks the
password against `email_accounts`, so a stale file answers "Login failed", and no file, one the
user cannot read, or one without both lines answers "Not logged in to emailit.io." with no hint.

**Who you are on the box decides who you post as**, and that is the mechanic: a shell as B's
user posts as B, a `guest` cannot read B's `0600` file, and root posts as root's own
`~/.mailrc` until it `su`s to B or copies B's file. A stolen `~/.mailrc`, or a cracked
`/etc/emailit/passwd` line, lets the thief write as the victim. A script calls `curl` as typing
does (`scripting/commandContext.ts`), so a scripted POST carries the box's `~/.mailrc` too; the
cap is what holds a bot. `lynx` needs a terminal, so scripts never use it.

## 5. Plain text, guarded in and escaped out

The owner's rule for this epic: be extremely careful with injection, both sending and receiving.
It matters here because the `~/.mailrc` cookie rides every talkit POST, so a post that could
carry a `<form action="/comment">` would make its readers comment as themselves.

- **In (the server, before anything is stored)** — `core/talkit/writing.ts`, used by
  `answerPost` and `answerComment`: `\r\n` and a lone `\r` become `\n`; any other C0 control or
  DEL refuses the write, and a title refuses `\n` too; both are trimmed; then the lengths are
  counted as a reader counts them (`[...text].length`, `char_length` in SQL). The text is
  stored exactly as checked, never pre-escaped. Every query is parameterised.
- **Out (every page, every time)** — `playerText` (`core/talkit/playerText.ts`) is the only way
  player text reaches a page. It escapes `& < > " '` with `escapeHtml`, breaks a body's lines
  with `<br>`, and links only `http://` runs with no space, `<`, `>`, `"` or `'`, matched on the
  raw text and escaped piece by piece, a trailing `.,;:!?)` left outside. The link shows the
  URL it goes to. `https://`, `javascript:` and `data:` stay text. Titles and handles go
  through `escapeHtml` alone, since a title is already a link on the list.
- **Every form talkit serves is static.** No `<textarea>` is pre-filled with player text, and
  the comment form's hidden `id` is the server's own number.
- **Logs**: the form body is never logged; `access.log` keeps the path through `escapeLogField`,
  and a `talkit.log` line its handle.

A payload corpus (`<script>`, `"><form action=/comment method=post>`, `</textarea>`,
`&lt;b&gt;`, `javascript:alert(1)`, `http://x.io/a"onmouseover="1`, CRLF in a title) is posted
as a title, a body and a comment, in unit tests and live, and each is shown escaped character
for character, with no element on the page but the forum's own.

## 6. What a root on talkit sees

Besides `access.log` (every view and POST path beside the visitor's address, as on any site),
every write that lands adds one line to `/var/log/talkit.log` through `appendMachineLog`
(`logging/talkitLog.ts`): `2026-10-19 14:37:02 post #12 by neo from 203.0.113.7`, and `comment
#3 on #12 by neo from <address>`, the address the one `access.log` records. Root-owned,
world-readable, root-written, like `named.log`; no boot seed, so the file appears with the
first post; best-effort, so a post stands if its line fails. A refused write adds no line.
It is an ordinary journal file: a root reads it, wipes or edits it, and the restore resets it.
Nothing warns a poster.

## 7. The operator

- **`scripts/restoreSite.ts talkit.io`** works from the fixed-site row alone: it ends every
  session on the box, deletes its journal and writes a fresh boot marker, so a defaced page, a
  brick and a doctored `talkit.log` all go. Posts are in the database, never on the box, so a
  restore leaves every thread as it was.
- **`scripts/talkitRemove.ts`** is the only way anything a player wrote goes; nobody edits, and
  no player deletes, not even their own. It writes the tables directly with the service role,
  with no SQL function, and leaves no trace on talkit's box: the operator has no address in the
  world.
  - `thread <id>` deletes the thread, and the cascade takes its comments. Its link is then the
    404 an unused id gets, and a comment sent to it answers "No such thread.". Ids are an
    identity, so a removed id never comes back.
  - `comment <id> <n>` sets the comment's `author` and `body` to NULL. The row keeps its number
    and time, the page shows `#3 [removed]` alone, and `comment_count` and `last_activity_at`
    stay, so "see #4" still means #4 and the next comment is never handed a used number.
  - The words are read by `readRemovalOrder` (`core/talkit/removal.ts`): exactly
    `thread <id>` or `comment <id> <n>`, the id as `THREAD_ID` and the number as
    `^[1-9][0-9]{0,8}$`; a near miss is refused, never repaired. Before writing it prints one
    line naming the target (a thread's title, author and comment count, or a comment's author)
    and the database host, with no prompt. Every title and handle is quoted by hand with every
    control and format character (`\p{Cc}`, `\p{Cf}`) spelled out as an escape, so nothing a
    player typed acts on the operator's terminal and no bidi override reorders the line.
  - Exit 0 when something was removed; 1 when there is nothing to remove ("No thread #n", "No
    comment #m on #n", "Comment #m on #n is already removed", each with the host) or the
    database errs; 2 for bad words or missing env, before anything is touched.

## 8. lynx's part

- **A `<textarea>` is a box** (`ui/renderPage.ts`, `ui/screens/Lynx.tsx`): a `field` segment
  with `multiline` set, at least `rows` rows tall (default 4, at most 12). Inside it Enter
  breaks the line (`⏎ New line`), Backspace joins lines back up, and Tab, Shift+Tab, Esc and
  the up and down arrows leave it; the form is sent from its own button, a line break as `%0A`.
- **A form's hidden fields are sent**, ahead of the fields the reader typed, as a browser sends
  them (`hiddenFieldsOf`, `FormTarget.hidden`), for a POST form and a GET form's address alike;
  they are drawn nowhere and offered to no one to type into. The comment form names its thread
  in one.
- **A `<form>` is laid out as a block**, as a `<div>` is (`WRAPPER_TAGS`), so its paragraphs
  each start a line.
- **The bundle**: talkit's client code (the row, the front page, the form, the box, the login
  and the `man` text) cost about 1,000 B, so the ceiling's code part rose once by 2,000 B to
  136,975 B, a ceiling of 286,975 B (`scripts/checkBudgets.ts`). At v0.414.0 the main chunk is
  285,135 B.

## 9. Proving it

- **Unit + jsdom**: player text and the whole corpus (`playerText.test.ts`), the pages, the
  views over fake reads, the post and comment checks over a fake store, the removal words and
  their quoting over every near miss and control range, the handler's dispatch, logs and 500s,
  lynx's box and hidden fields, and the shared `~/.mailrc` reader through `mail`'s own tests.
- **Wire-checks** (vs `vercel dev` + local supabase): `scripts/testTalkit.ts` (87 checks: the
  views and paging, posting and commenting live through the signed endpoint, the corpus,
  numbering under parallel comments, the shared cap, the throttle, both logs, the planted-file
  and dark-box cases); `scripts/testTalkitRemove.ts` (25: the real script as a child process,
  its exit codes, the pages and rows after each run, no log line); and
  `scripts/testRestoreSite.ts talkit.io`.
- **One browser run at the epic's close-out** (2026-10-20, v0.413.0): a new player signed up on
  emailit.io and ran `mail login`; lynx showed the front page and the list, posted a two-line
  thread from the box ("Posted as e2eneo."), and showed it with "No comments yet." and the
  comment form; `talkitRemove.ts comment` left `#1 [removed]` above `#2` with the list still at
  `2 comments`, and `talkitRemove.ts thread` turned the link lynx held into a 404 and left only
  the welcome thread on the list. **It found one defect**: a comment sent from lynx always
  answered "No such thread.", since lynx sent only the fields it drew and the thread's `id` is
  hidden (the same comment from `curl -d` posted). Slice 3 had recorded that lynx sent hidden
  fields; nothing tested it, as the wire-check posts its own bodies. It also found the front
  page's "Post" label running onto the title field's line. PR #712 (v0.414.0) fixed both, and
  a re-check in the browser posted a lynx comment ("Commented as e2etrin.").

## Key files

- **Server**: `supabase/migrations/20261019000000_talkit_threads.sql` and the three that
  follow; `api/network.ts` (`findThreads`, `findThread`, `findComments`, `postThread`,
  `postComment`).
- **Forum**: `core/talkit/` — `pages.ts`, `playerText.ts`, `answerViews.ts`, `answerPost.ts`,
  `answerComment.ts`, `writing.ts`, `removal.ts`.
- **Wiring**: `core/network/resolveHttpFetch.ts` (the dispatch, `TALKIT_VIEWS`, the
  `talkit.log` line), `core/logging/talkitLog.ts`, `core/generation/fixedSites.ts`,
  `core/generation/fixedSiteFs.ts`, `core/emailit/signup.ts` (`RESERVED_HANDLES`).
- **Client**: `core/emailit/mailrc.ts` (the login), `core/commands/webPage.ts` (attaching it),
  `core/commands/curl.ts`, `core/commands/lynx.ts`, `ui/renderPage.ts`, `ui/screens/Lynx.tsx`.
- **Operator**: `scripts/talkitRemove.ts`, `scripts/restoreSite.ts talkit.io`.
