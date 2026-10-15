# Plan: email, at emailit.io

**Status**: Grilled, sliced and gap-reviewed. Decisions 1–27 confirmed by the owner 2026-10-14,
28–41 from a find-gaps review the same day. Slice 1 shipped at v0.384.0 (#681, 2026-10-15) and
slice 2 at v0.385.0 (#682, 2026-10-15); slice 3 is next and needs its plan.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

A player can sign up for an email address at `emailit.io`, read their mail with a `mail` command,
and mail other players. This is groundwork for missions: a job site (later, not here) will take a
player's address and mail them a private address to open with `curl` or `lynx`.

## Where it starts from (facts, 2026-10-14)

Read in the code on this date.

- **A player's username and workstation name are not unique.** Both are typed into the Intro form
  (`ui/screens/Intro.tsx`, validated by `gameConfig/gameConfig.ts`); nothing on the server claims
  them. The only unique thing a player has is their Ed25519 key.
- **NPC boxes already hold mail.** `generation/mailbox.ts` and `generation/networkMail.ts` write
  real mbox files under `/var/mail` with delivery headers and `> `-quoted replies.
- **`curl` takes only a URL and `-i`.** There is no way to send a request body.
- **`lynx` renders forms and sends GET forms only** (`ui/screens/Lynx.tsx`, `ui/renderPage.ts`).
  A `method="post"` form is parsed but never sent. A password field renders as `[]`, showing
  neither its value nor its length.
- **Query strings work** (`http://findit.io?q=x`), and every web fetch appends a line to the
  serving box's `access.log`.
- **A fixed site is a row.** Adding one to `FIXED_SITES` (`generation/fixedSites.ts`) gives it a
  public address in the placeless `193` block, a findit listing (`findit/webIndex.ts`) and
  operator restore (`scripts/restoreSite.ts <domain>`, which wipes the site's journal only).
  Fixed sites run `http` and `ssh`; the service catalog has no `smtp`.
- **The terminal has masked prompts** (`env.prompt({ masked: true })`, used by `su`).
- **Nothing is polled.** The client's only timer is the HUD clock, and Supabase Realtime was
  decided against on 2026-07-31 (`docs/backlog.md`, "DECIDED 2026-07-31: no Supabase Realtime").
- **Tools arrive by apt** (`packages/aptPackages.ts`: `hydra`, `snmp`, `mysql`, …).

## Decisions (owner-confirmed 2026-10-14)

### Accounts

1. **An address comes from signing up at `emailit.io`.** Rejected: an automatic
   `username@machine.io` (neither name is unique, and the machine can be bricked for good) and an
   automatic random address (no character, nothing to find).
2. **An account is a handle and a password, nothing more.** It is not tied to the player who made
   it. A player may hold as many as they like, so burner addresses come for free. Handles are
   first come, first served.
3. **An account has its own password.** Two ways to take one over: a login saved in `~/.mailrc`
   on the victim's box, or root on emailit.io's box and its crackable hashes.
4. **A stolen address stays alive with whoever holds its password.** Signing up again does not
   touch an old address; the victim simply makes a new one. Bad luck is the lesson.
5. **At most 3 sign-ups per player per day**, counted on the server by the player's key. It guards
   the shared handle space against a script squatting every good name; a player meets it only by
   mass-registering.
6. **A handle follows the Intro username rules** (reuse `validateUsername`), is stored lowercase
   so `Neo` and `neo` are one address, and may not be one of `postmaster`, `admin`, `root`,
   `abuse`, `noreply`, `support` or `emailit`.
7. **A password needs only the Intro minimum length**, no complexity rules. It is stored as a
   deliberately weak unsalted hash, crackable with real external tools like every reachable hash
   in the world.
8. **"Don't use a password you use anywhere outside this game."** One line on the emailit.io
   sign-up page AND on the Intro form. The hashes are shown to other players by design and people
   reuse real passwords; this protects the person, not a game mechanic.

### Signing up

9. **`curl -d` is a new flag that sends a POST body:**
   `curl -d "handle=neo&password=s3cret" http://emailit.io/signup`. The body is never written to
   `access.log` (the line reads `POST /signup`), so cracking the hashes stays the real prize.
   Rejected: a query string, which would leave every password in plain text in the log.
10. **`lynx` sends POST forms** through the same server path as `curl -d`. emailit.io's front page
    carries the form: Handle, one Password field (no confirmation box, matching curl), [Sign up],
    and the line from decision 8.
11. **What a sign-up answers.** Success is the `/signup` page: `Welcome, neo@emailit.io`, the
    mailbox is ready with a welcome message waiting, read it with `mail`, get that with
    `apt install mailutils`, and a link back to emailit.io. Failure is the form page again with the
    error above it (handle taken, reserved or invalid; password too short; too many sign-ups
    today), the handle kept and the password cleared. `curl -d` prints the same HTML.
12. **Back never sends a POST again.** A page reached by POST enters lynx's trail as a GET of the
    same address, and `GET /signup` shows the form. A resend would make a second account or spend
    the day's sign-ups.

### The `mail` command

13. **`apt install mailutils` provides `mail`, and it is preinstalled nowhere**, on player and NPC
    boxes alike. It installs wherever the player has the rights to install. A thief on your box
    needs `mailutils` there to use your `~/.mailrc` in place, or copies the file away.
14. **Subcommands**: `login`, bare `mail` (list, unread marked `N`), `read <n>`,
    `send <to> <subject>`, `reply <n>`, `delete <n>`, `passwd`, `logout`. Simple, not a clone of
    the real `mail`.
15. **Composing is `nano`.** `send` opens an empty buffer. `reply` fills in the sender and
    `Re: <subject>` and opens the original quoted with `> ` below an empty line. Save and exit
    sends; exiting unsaved, or with an empty body, cancels (`mail: reply cancelled`). Replies
    carry the quoted history, so a stolen inbox shows both sides of a conversation.
16. **`mail login`** asks for the address, then the password (masked), then
    `Save login to ~/.mailrc? [y/N]`. Unsaved, the login lasts for that terminal session. Saved, the
    address and password sit in plain text in `~/.mailrc` on **the box the player is standing
    on**, and `mail` on that box logs in from it. `mail logout` forgets the session only; removing
    `~/.mailrc` is the player's job, and nothing warns them.
17. **The server keeps no mail sessions.** Every request carries the address and password and is
    checked each time. `mail passwd` (old password, new twice) therefore cuts off every holder of
    the old one at once, a stolen `~/.mailrc` and a thief's open terminal included. Whoever changes
    it first keeps the account.

### Delivery

18. **Players mail `@emailit.io` addresses only.** Anything else bounces at once with
    `mail: <address>: unknown domain`; an unknown handle with `mail: <address>: no such mailbox`.
    That a handle can be probed this way is accepted.
19. **The server sends as system senders**, addresses no player can log in to. The first is a
    welcome mail from `noreply@emailit.io` on every sign-up; the job site will use the same channel.
    A reply to a system sender bounces.
20. **Limits**: a subject of at most 80 characters and a body of at most 4,000
    (`mail: message too long`); at most 20 sends per player per hour, counted on the server; an
    inbox holds 100 messages, and player mail to a full inbox bounces with `mailbox full`.
    **System mail is always delivered**, so nobody can fill an inbox to block a mission mail.
21. **NPC mail stays scenery.** NPC boxes keep their generated `/var/mail`, read with `cat`; no
    NPC has an emailit.io account.

### Where mail lives, and when it works

22. **Accounts and messages live in server tables.** emailit.io's box shows a read-only view built
    from them (decision 27). Rejected: real files in the box's journal, where one root could plant,
    rewrite or wipe every player's mail, and many writers appending to one file fights the
    journal's one-row-per-file-per-writer shape.
23. **Mail goes down with emailit.io's box.** A box that does not boot answers nothing: `mail` says
    it cannot reach emailit.io, a send is refused rather than queued, and sign-up is dark, until the
    operator runs `scripts/restoreSite.ts emailit.io`. The restore wipes only the box's journal, so
    no mail is lost.
24. **Mail needs the internet.** Every `mail` command, and the check in decision 25, reaches
    emailit.io the way `curl` would: a box not joined to a WiFi with a way out has no mail.

### New mail

25. **A background check, not a push.** Supabase Realtime stays rejected for the three reasons
    recorded on 2026-07-31; this is a pull with credentials the terminal already holds. It runs
    only while the terminal is logged in to mail and the tab is visible (checking at once when the
    tab becomes visible again), every 60 seconds, and skips silently while emailit.io cannot be
    reached. `mail login` checks once and prints `You have N new messages.`
26. **How the notice shows.** `You have new mail.` prints above an idle prompt, redrawing whatever
    was half-typed. Inside `nano`, `lynx`, `ftp` or a password prompt it waits for the next prompt.
    It prints once per batch of new mail. A check that gets `login failed` prints
    `mail: login failed — logged out` once, ends the session and stops: that is how a victim learns
    their password was changed. Every logged-in tab checks on its own. The "nothing is polled" note
    in `ui/state.ts` is reworded to say mail is the one deliberate timed pull, and why.

### emailit.io's box

27. **A fixed site, findable on findit, running `http` and `ssh`** like findit.io and mapit.io, and
    attackable the same ways. Its view of the mail is root-only, at real Debian paths:
    `/var/mail/<handle>`, one mbox per account (`0660 root:mail`), and `/etc/emailit/passwd`, one
    `handle:hash` line per account (`0600 root:root`). A guest does not see them (decision 31).
    Writing to them is refused; the tables are the truth.

## Decisions from find-gaps (owner-confirmed 2026-10-14)

28. **Wrong mail passwords are throttled per guesser, not per account.** The server counts failed
    password checks by the player's key, across every address and every kind of request (`login`,
    an auto-login from `~/.mailrc`, `passwd`'s old password, any send or read). After 5 failures
    within a minute it refuses every password check from that player for the rest of the minute,
    with `mail: too many failed logins, wait a minute`. Online guessing works but is slow, so
    cracking emailit.io's hash file stays the fast route. An account is never locked, so nobody
    can lock someone else out of their mail.
29. **A message's number is stable.** Each message takes the next number in its inbox when it
    arrives and keeps it until deleted; a number is never reused, so the list has gaps after a
    delete. `mail` lists by number, oldest first, as the real `mail` does. `read`, `reply` and
    `delete` take that number, and a number not in the inbox answers `mail: no message <n>`. A
    message arriving in the background never changes what an existing number means.
30. **A server that takes no POST answers `405 Method Not Allowed`.** Only emailit.io's `/signup`
    (and later the job site) accepts a POST. Every other web server in the world — findit.io,
    mapit.io, hackademy.io, NPC sites, a player's own — answers a POST with a 405 page, which
    `curl -d` prints and lynx shows. The access log records the request's real method: a POST there
    is a `"POST <path> HTTP/1.1" 405` line, never its body. Today `logging/accessLog.ts` writes
    `GET` for every line; that changes.
31. **The mail view is built on the server, for root only, before the tree is pruned.** When a
    caller's tier on emailit.io is root, the server adds `/var/mail/<handle>` and
    `/etc/emailit/passwd`, built from the tables, to the materialized box and then prunes it the
    way every remote box is pruned (`patches/readFilter.ts`). Below root it is not built at all —
    no table read, nothing on the wire. A guest therefore does not see these files exist, like
    every other root-only file in the world.
32. **A saved `~/.mailrc` is `0600`, owned by the user who saved it.** Only that user and root can
    read it, as with a real mail client. A guest who lands on the box must climb to the user or to
    root before the saved login is theirs; `chmod` can loosen it, and that mistake is the player's
    to make.
33. **A mail login belongs to the terminal, and travels with it.** One login per terminal, carried
    across `ssh` hops and back. `mail` works on any box that has `mailutils` installed, and reaches
    emailit.io from that box's network, as `curl` there would. The check of decision 25 keeps
    running wherever the player stands and skips while the current box cannot reach emailit.io.
    With no login yet, the first `mail` on a box where the current user has a readable `~/.mailrc`
    logs in from it, and on terminal start the player's own box logs in from its `~/.mailrc`
    silently, so notices begin after a reload without typing anything. A login made from a stolen
    `~/.mailrc` travels the same way.
34. **Scripts may read and send mail, but never log in.** In a script, the list, `read <n>` and
    `delete <n>` work as typed, returning their output to the script, and a script can use an
    automatic `~/.mailrc` login. `send` and `reply` take the body as a final argument instead of
    opening nano, e.g. `mail('send', 'trin@emailit.io', 'hi', 'body text')`. A scripted `reply` adds
    the `> `-quoted original below the body, as nano would have. The size limits and the
    20-sends-an-hour limit apply the same way, so automation such as auto-replies or bots stays
    within them. `login`, `passwd` and `logout` refuse in a script with
    `mail: <subcommand> is interactive`, so a script can never guess a password. At the prompt,
    `send` and `reply` still always open nano.
35. **A message is unread until `read <n>` shows it, and the mark lives on the server.** Typed or
    scripted, `read` marks the message read; `reply` and `delete` do not. The list marks unread
    messages `N`, and login's `You have N new messages.` counts them. Everyone holding the password
    sees the same marks, so mail a thief has read shows as read to its owner — a clue someone was
    in. The background check's notice is about arrival, not reading: `You have new mail.` prints
    when the inbox holds a message numbered above the highest this terminal has already announced
    or listed (decision 29's numbers only grow), once per such batch.
36. **There is no Sent folder.** An inbox holds only what arrived, the rule NPC mailboxes already
    follow (`generation/mailbox.ts`). A sender's own words survive only where a reply quotes them
    back. Sending writes one copy, into the recipient's inbox; emailit.io's `/var/mail/<handle>`
    shows exactly that inbox.
37. **What `mail` prints.** The list is one line per message, oldest first: the `N` mark (or a
    space), the number, the sender, the date and the subject cut to fit —
    `N  12  noreply@emailit.io   Oct 14 09:12  Welcome to emailit.io`. An empty inbox prints
    `No mail for neo@emailit.io`. `read <n>` prints `From:`, `To:`, `Date:` and `Subject:` headers,
    a blank line, then the body as written; the date reads `Wed, 14 Oct 2026 09:12:03 +0000`. A
    date is the moment the server delivered the message, in UTC like the logs; the sender's clock
    plays no part, so a date cannot be faked.
38. **How the server counts.** Both limits are rolling windows: "3 sign-ups a day" is the last 24
    hours and "20 sends an hour" the last 60 minutes, so there is no midnight reset to time a script
    against. Only a successful sign-up counts; one refused for a taken, reserved or invalid handle
    or a short password costs nothing, so a typo does not eat the day. Every send that reaches the
    server counts, bounces included, so probing handles by mailing them is held to 20 an hour too.
    Two players claiming the same handle at once: exactly one gets it, the other is told
    `That handle is taken`. Each limit is checked and recorded in one step, so parallel requests
    cannot slip past it.
39. **A `-d` body is form-encoded, as with real curl.** `curl -d` sends the text exactly as typed,
    with `Content-Type: application/x-www-form-urlencoded`, and the server decodes it: `&` separates
    fields, `=` a name from its value, `+` is a space and `%XX` a byte. A password with `&` in it is
    typed as `%26`; that is the player's job, as with real curl. lynx encodes what is typed into its
    fields itself, so a lynx user never meets it. `-d` always means POST, and `-i` still prints the
    status line and headers.
40. **The hash is plain md5, in hex, like every password hash in the world.** The tables store
    `md5(password)` as 32 lowercase hex characters, and `/etc/emailit/passwd` prints one
    `handle:hash` line per account, in sign-up order — `neo:5f4dcc3b5aa765d61d8327deb882cf99`.
    Logging in compares `md5(typed)` with the stored value; nothing anywhere keeps the password
    itself.
41. **Small rules.** The 80- and 4,000-character limits count Unicode characters, not bytes. A
    write to the view of decision 31, even by root, is refused with the shell's usual
    `Permission denied`, as any other refused write is. The close-out moves this plan's as-built
    content into a new `docs/email-architecture.md`, beside `wallet-architecture.md`.

## Out of scope

- The job site, the private per-player mission address, and missions themselves. The job site
  ties that address to the player who applied (from the request), not to an email address.
- NPC senders and recipients beyond `noreply@emailit.io`.

## Slices

Each slice is its own PR and version bump. A slice that changes `api/` gets its `scripts/test*.ts`
wire-check. One browser run at the end covers them all.

1. ✅ **emailit.io and sign-up** (v0.384.0, #681). The fixed site and its front page, `curl -d`, and `/signup`:
   validation, reserved handles, the daily cap, the hash, and the welcome mail stored (decisions
   38–40). Every other server answers a POST with 405, and the access log records the real method
   (decision 30). The real-password line on Intro. A player who signs up reads `Welcome, neo@emailit.io`; a second
   sign-up for the same handle is refused.
2. ✅ **lynx sends POST forms** (v0.385.0, #682), and Back never resends one. A lynx player signs up from the front
   page.
3. **Reading mail.** `mailutils`, `mail login` with `~/.mailrc`, auto-login, `logout`, the list and
   `read`, and the offline and emailit.io-down answers; the guess throttle, stable numbers, the
   login that travels with the terminal, scripted reads and read marks (decisions 28, 29, 32–35,
   37). A player reads their welcome mail.
4. **Sending mail.** `send`, `reply`, `delete`, the bounces, the size and rate limits, and the
   inbox cap with system mail always delivered, and scripted `send` and `reply` (decision 34).
   Two players exchange mail.
5. **Changing the password, and new-mail notices.** `mail passwd` and the background check of
   decisions 25 and 26.
6. **emailit.io's root view.** `/var/mail/<handle>` and `/etc/emailit/passwd`, built from the
   tables, read-only, and built only for a root caller (decision 31).

## Slice 1 plan: emailit.io and sign-up

**Branch**: `feat/emailit-signup` · **Version**: 0.383.0 → 0.384.0 · **Class**: behaviour change ·
**Delivery**: one PR against `main`.

**As built (2026-10-15, #681, merged as `4cf9ef00`).** Shipped as planned, with these changes:

- **`md5` hashes UTF-8 bytes now.** It hashed each UTF-16 code unit, so a non-ASCII password's
  hash matched no real tool's. Fixed for every caller (the owner's call): every hash already in
  the world is ASCII and unchanged, and a player whose Intro root password is non-ASCII no
  longer matches the hash stored for it.
- **Every reserved handle reads `"<handle>" is a reserved system name`**, Intro's wording, for
  emailit's names as for Intro's. `root` and `admin` are in Intro's set only, so emailit's adds
  five.
- **The real-password line lives in `gameConfig.ts`** (`REAL_PASSWORD_WARNING`), beside the
  password rule, so Intro and emailit.io read one constant.
- **emailit.io answers at `193.26.109.162`**, the next placeless address after mapit.
- **`SignUp` hands back the database's raw reply** and core reads it, so `api/network.ts` stays a
  thin adapter. A failed reply, or a word the reader does not know, is a `500 signup_failed`.
- **A form over 4,096 characters is refused** (`400 payload_invalid`) on both server fetch paths
  before any lookup.
- The migration `20261014000000_email.sql` is on jshack-dev and jshack-prod (pushed 2026-10-15).
- The wire-check is `scripts/testEmailitSignup.ts` (16 checks).

**Value.** A player signs up for `neo@emailit.io` with `curl -d` and is welcomed; the welcome mail
waits in the tables for slice 3 to read. Every other web server answers a POST with a 405.

**Path.** `curl -d` → `fetchPageAcrossNetwork` → `env.remote.fetchPublic` → `adapters/networkApi.ts`
→ `api/network.ts` `resolveHttpFetch` → `resolveWebTarget` (dark box = unreachable, for free) →
emailit.io's `/signup` answered by a function, as findit's search is → `email_signup` RPC (one
transaction: cap, handle, account, welcome mail) → page back → line in emailit.io's `access.log`.

### Choices made while planning (owner to confirm with the plan)

- **The fixed site**: `{ key: 'emailit.io', domain: 'emailit.io', hostname: 'emailit',
  place: { category: 'hacker', place: 'the post office' } }`, appended last to `FIXED_SITES` so
  no existing address moves.
- **`/signup` answers from a function, `/` from a file.** Like findit's search, a rooted emailit.io
  can deface its front page without breaking sign-up, and a dark one takes both down.
  `GET /signup` stays a 404 in this slice; slice 2 makes it the form (decision 12).
- **The front page has no form yet.** It explains sign-up with the `curl -d` line,
  `apt install mailutils` and decision 8's line. Slice 2 adds the form along with lynx POST, so no
  build ships a form that does nothing.
- **Every sign-up answer is `200 OK`**, success or refusal, as a form page that re-renders with
  its error. Only 405 is new to the status line.
- **A refusal page is the front page with the error above it.** Messages: the `validateUsername`
  text for an invalid handle, `"<handle>" is reserved` for decision 6's names,
  the `validatePassword` text, `That handle is taken`, and
  `You have signed up 3 addresses today. Try again tomorrow.` A missing field reads as empty.
- **The 405 page**, from every server that takes no POST, including emailit.io on any path but
  `/signup`: `<h1>405 Method Not Allowed</h1>`, with `-i` showing
  `HTTP/1.1 405 Method Not Allowed` and the usual `Server:` header. curl exits 0, as real curl does
  without `-f`.
- **The cap is checked before the handle**, so a capped player is told so whatever they ask for.
- **The welcome text lives in TypeScript** (`core/emailit/`) and is passed to the RPC, so its
  wording sits in one tested place. The owner chose it 2026-10-14 (`<handle>` filled in):

  ```
  Welcome to emailit.io, <handle>.

  Your address is <handle>@emailit.io. Anyone who knows it
  can write to you.

  We cannot reset a lost password, and we will never
  ask you for it.

  This mailbox is not read. Replies go nowhere.

  -- emailit.io
  ```

### Acceptance criteria

1. On a box with a way out, `curl emailit.io` prints the front page: how to sign up with
   `curl -d "handle=<handle>&password=<password>" http://emailit.io/signup`, that `mail` comes from
   `apt install mailutils`, and "Don't use a password you use anywhere outside this game." A findit
   search for `email` lists emailit.io, and the site answers on 80 and 22 like the other fixed
   sites.
2. `curl -d "handle=neo&password=s3cret" http://emailit.io/signup` prints a page reading
   `Welcome, neo@emailit.io`, saying the mailbox is ready with a welcome message waiting, and that
   `mail` comes from `apt install mailutils`. The account row holds `neo` and `md5("s3cret")` in
   lowercase hex, and neo's inbox holds message 1 from `noreply@emailit.io`, subject
   `Welcome to emailit.io`, unread.
3. `handle=Neo` creates `neo`. A second sign-up for `neo`, in any case, prints the front page under
   `That handle is taken` and changes nothing.
4. An invalid handle, any of the 14 reserved names (Intro's 7 and decision 6's 7), a password
   under 4 characters, or a missing field prints the front page under its message and stores
   nothing.
5. A player's 4th successful sign-up within 24 hours is refused with the cap message; refused
   sign-ups do not count toward the 3. Five parallel sign-ups by one player create exactly 3
   accounts; two players claiming one handle at once leave exactly one owner.
6. The body is form-decoded: `password=a%26b+c` stores `md5("a&b c")`.
7. emailit.io's `access.log` gains `"POST /signup HTTP/1.1" 200 <size>`; the password never
   appears in any log.
8. `curl -d <anything>` against findit.io, an institution's site, a fellow occupant's box, the
   player's own box, or emailit.io at any path but `/signup` prints the 405 page (and its status
   line under `-i`), and that box's `access.log` records `"POST <path> HTTP/1.1" 405 <size>`.
   GET lines are unchanged.
9. With emailit.io bricked, the sign-up fails as `curl` does against any dark box and stores
   nothing; offline, curl reports the network unreachable.
10. The Intro form shows "Don't use a password you use anywhere outside this game." under the
    password fields.
11. `man curl` lists `-d` with a sign-up example.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The access log names the method.** `formatAccessLogLine` takes a `method` (GET where
   unnamed); `AccessLogFetch`, `recordLanFetch`, `resolveOccupantFetch` and `resolveHttpFetch` carry
   it. Generated history stays GET.
2. **`curl -d` and 405 everywhere.** A string `-d` flag; `PublicFetchParams`,
   `OccupantFetchParams` and the local read gain `method` and `body`; the result gains `status`. The
   own-box path, `resolveOccupantFetch` and `resolveHttpFetch` answer a POST with the 405 page and
   log it. `responseLines` prints the real status line. Manual entry for `-d`.
3. **emailit.io exists.** `FIXED_SITES` entry, `core/emailit/pages.ts` front page in `WEB_ROOTS`,
   findit listing (description meta), `restoreSite.ts` header names it.
4. **Sign-up, decided in core.** `core/emailit/signup.ts`: decode the form, lowercase, validate
   (`validateUsername` plus the reserved set, `validatePassword`), hash, call a `signUp` dependency
   that answers `created | taken | capped`, render the page. Unit-tested against a fake.
5. **`resolveHttpFetch` routes it.** A POST to `/signup` on emailit.io's network goes to step 4;
   anything else POSTed is 405. Body capped at 4,096 characters by the schema.
6. **The tables.** Migration `<stamp>_email.sql`: `email_accounts` (handle PK with the handle
   CHECK, `password_md5` CHECKed as 32 hex, `created_by` key, `created_at`, `next_number`),
   `email_messages` (`handle` FK, `number`, `sender`, `subject`, `body`, `delivered_at`,
   `read`, unique `(handle, number)`), RLS on with no policies, and `email_signup(...)` returning
   `created | taken | capped`: an advisory lock on the player's key, the rolling-24-hour count, an
   insert that loses a handle race cleanly, and the welcome as message 1. EXECUTE for
   `service_role` only, as `wallet_transfer`. `api/network.ts` wires `signUp`;
   `adapters/networkApi.ts` sends `method` and `body`.
7. **Intro's line**, under the confirm field, jsdom-tested.
8. **Version bump** to 0.384.0.

### Evidence

- Unit: increments 1–5 and 7, plus the curl command tests.
- Wire-check `scripts/testEmailitSignup.ts` against `vercel dev` + supabase: criteria 2–9,
  including the two parallel races, rows read back with the service key, and the access-log lines
  on emailit.io and findit.io. Existing `testFindit.ts`, `testHttpFetch.ts` and `testLanFetchLog.ts`
  still pass.
- Pre-PR: Stryker on `core/emailit/`, `accessLog.ts` and the changed fetch handlers; typecheck;
  lint; the full test run.
- The migration is pushed to jshack-dev and jshack-prod at merge (link → push → unlink).
- No browser run; the epic's one run comes at the end.

## Slice 2 plan: lynx sends POST forms

**Branch**: `feat/lynx-post-forms` · **Version**: 0.384.0 → 0.385.0 · **Class**: behaviour change ·
**Delivery**: one PR against `main`.

**As built (2026-10-15, #682, merged as `8bc97a5e`).** Shipped as planned, with these changes:

- **`onFollow` and `followLink` take `(url, body?)`**, not `{ url, body }`: unambiguous, and every
  existing caller and test stayed as it was.
- **The masked drawing landed with the renderer**, not with the submit: once a password was a
  field, lynx drew what it held, so the two had to ship together.
- **`followLink` came before the screen's submit**, so no commit had lynx sending a form that
  `followLink` dropped.
- **`encodeForm` in `http.ts`** encodes a GET form's query and a POST form's body alike.
- **`sendingForm` is gone**: every caller had already handled links, so Lynx reads the form off
  the field or button.
- Slice 1's test that `GET /signup` is a 404 was flipped: it now serves the form and signs nobody
  up.
- `scripts/testEmailitSignup.ts` has 18 checks (two for `GET /signup`).

**Value.** A lynx player signs up at emailit.io from its front page: types a handle and a
password, presses Enter, and reads `Welcome, neo@emailit.io`. Going Back never sends the form
again.

**Path.** Enter on a POST form's field or button in `ui/screens/Lynx.tsx` → `onFollow` with the
action's address and the form-encoded fields → `followLink` (`ui/state.ts`) →
`fetchPageAcrossNetwork` / `fetchWebPage` with `body` (slice 1 built both) → the same
`resolveHttpFetch` route `curl -d` takes → the answer replaces the page; the box logs a POST line.
No `api/` or database change.

### Choices made while planning (owner to confirm with the plan)

- **`GET /signup` is a file.** emailit.io's web root gains `signup`, holding the front page with
  its form, so Back after a sign-up, and `curl http://emailit.io/signup`, show the form. It needs
  no server code, and like every page anyone can see it is a file a rooted emailit.io can deface.
  Only the POST is answered by a function, so a defaced site still signs people up.
- **The front page carries the form above the `curl -d` line**: `Handle`, `Password`,
  `[ Sign up ]`, then decision 8's line. The curl way stays, under "Or from a terminal".
- **A refusal keeps the handle as it was typed** (`Neo`, not `neo`), in the field's `value`,
  escaped, and the password field comes back empty.
- **A password field becomes a field you can type into, and still shows nothing.** `[]` when the
  reader is elsewhere, `[_]` while they are in it, whatever it holds: no characters and no
  length, as the masked terminal prompt shows none. What the page filled it with is sent if the
  reader typed nothing, and never drawn.
- **A form whose action is only a fragment (`#…`) is sent to the page it sits on**, as a browser
  sends it. The generated NPC login pages (`action="#" method="post"`) therefore send their form,
  and the box answers with its 405 page, as decision 30 says every server but emailit.io does.
  Today such a form is drawn but sends nothing.
- **A 405 is a page the reader moves to**, as a 404 is: the box answered and logged it.
  `followLink` today would show any answer that is not a page as the 404 page.
- **One request at a time.** While a follow, a submit or a Back is waiting for its answer, lynx
  ignores Enter, ArrowRight, ArrowLeft and Backspace outside a field. A held Enter would otherwise
  send a sign-up twice, and the second answer (`That handle is taken`) could land last, over the
  welcome for the address the reader just got. Quitting still works.
- **The body is the fields form-encoded as a GET form's query is** (`URLSearchParams`), sent to
  the action's address with any query it carries kept, as a browser does for a POST.
- **The trail needs no new rule.** It already records the address of the page being left, and
  Back GETs it, so a page reached by POST is gone back to as `GET /signup`. A test pins it.

### Acceptance criteria

1. `lynx emailit.io` shows a `Handle` field, a `Password` field, a `[ Sign up ]` button and
   "Don't use a password you use anywhere outside this game.", then the `curl -d` way.
2. Typing into the Password field shows `[_]` and nothing else; leaving it shows `[]`. No typed
   character and no count of them ever appears on screen.
3. Handle `neo`, password `s3cret`, Enter on either field or on `[ Sign up ]`: lynx shows
   `Welcome, neo@emailit.io` at `http://emailit.io/signup`. The account and its welcome mail exist
   exactly as after `curl -d` (`md5("s3cret")`), and emailit.io's `access.log` gains
   `"POST /signup HTTP/1.1" 200 <size>`; the password is in no log.
4. A refused sign-up (taken, reserved, invalid, short password, the day's cap) shows the front page
   with the reason above the form, the handle field holding what was typed (`Neo` stays `Neo`) and
   the password field empty.
5. From the welcome page, Back, or "Back to emailit.io" and then Back, fetches
   `http://emailit.io/signup` with GET: the form shows with no error, the log line is
   `"GET /signup HTTP/1.1" 200 <size>`, and no account is made and no sign-up spent.
   `curl http://emailit.io/signup` prints the same form.
6. What is typed arrives as typed: password `a&b c+d%` stores `md5("a&b c+d%")`, and a non-ASCII
   handle is refused with the usual message rather than mangled.
7. On a generated NPC login page, Enter on its form shows the 405 page, and that box's
   `access.log` gains `"POST <path> HTTP/1.1" 405 <size>`. The same on the player's own box when
   its page has a POST form.
8. A second Enter while a submit is waiting sends nothing: one sign-up, one log line.
9. With emailit.io dark, a submit leaves the reader on the form with the connect error in the
   footer and what they typed still in the fields; nothing is stored.
10. findit's search (a GET form) and every link and Back behave as before.
11. `man lynx` says a form is filled in by selecting a field and typing, and sent with Enter.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **renderPage: a password is a field, and `#` sends to the page.** A password input renders as a
   `field` that is masked (drawn `[]` whatever its value); a fragment-only action resolves to the
   page's own address. `renderPage.test.ts`'s "offers no password field to type into" flips.
2. **Lynx submits a POST form.** `onFollow` takes `{ url, body? }`; Enter on a POST form's field or
   button sends the action and the encoded fields as `body`; the hint offers `⏎ Submit` for it; a
   masked field reads `[_]` while edited; Back after a POST asks for the address with no body; one
   request at a time. `http.ts` gains the body encoder beside `formSubmissionUrl`. jsdom tests in
   `Lynx.test.tsx`.
3. **followLink carries the body and shows a 405.** Both fetch paths get `body`; a
   `method_not_allowed` answer moves the reader to its page. Tests in `state.test.ts`.
4. **emailit.io's form.** `emailitFrontPage` draws the form and takes the typed handle;
   `answerSignup` hands it back on a refusal; `WEB_ROOTS` gains `signup`. Tests in
   `emailit.test.ts` (parsed and run through `renderPage`, so the form is proven to be one lynx can
   send), `signup.test.ts` and `fixedSiteFs.test.ts`.
5. **`man lynx`, version 0.385.0, handbook** (`05-shell-and-commands.md`).

### Evidence

- Unit and jsdom: increments 1–4; criteria 1–4 and 6–11 at the renderer, the screen,
  `followLink` and the page builders.
- Wire-check: `scripts/testEmailitSignup.ts` gains `GET /signup` → 200 with the form and a
  `GET /signup` log line (criterion 5). No `api/` code changes, so the rest of it and
  `testHttpFetch.ts` are re-run unchanged.
- Pre-PR: Stryker on the changed lines of `renderPage.ts`, `Lynx.tsx`, `followLink`,
  `core/emailit/` and `http.ts`; typecheck; lint; the full test run.
- No browser run; the epic's one run at the end walks criteria 1–5 and 8 in lynx.

## Backlog from this grill

- **Before multiplayer is announced**: reporting and blocking for player mail, and an operator
  tool to delete an abusive message or close an account, like `restoreSite.ts`.
- **A local-mbox mode for `mail`**: when not logged in to emailit.io, `mail` reads
  `/var/mail/<user>` on the box, and comes preinstalled on NPC boxes that have mail. A candidate
  for when NPC mail starts to matter in missions.
- **An `smtp` service on emailit.io**: port 25 in a scan, with its own versions and CVEs.
- **Mission-era NPC mail**: clients mailing players, and players mailing them.
