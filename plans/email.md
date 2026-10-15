# Plan: email, at emailit.io

**Status**: Grilled, sliced and gap-reviewed. Decisions 1–27 confirmed by the owner 2026-10-14,
28–41 from a find-gaps review the same day, 42–45 while planning slice 3 and 46–51 while
planning slice 4 (2026-10-15). Slice 1 shipped at v0.384.0 (#681, 2026-10-15), slice 2 at
v0.385.0 (#682), slice 3 at v0.386.0 (#683) and slice 4 at v0.387.0 (#684, all 2026-10-15);
slice 5 is next and needs its plan.
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
    `~/.mailrc` is the player's job, and nothing warns them. *(Replaced by decision 42: no save
    question, the file is the login, and `logout` deletes it.)*
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
    their password was changed. *(Replaced by decision 44: the file stays and the check stops
    retrying it.)* Every logged-in tab checks on its own. The "nothing is polled" note
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
    `~/.mailrc` travels the same way. *(Replaced by decisions 42 and 43: nothing travels, and
    `mail` and the check use the `~/.mailrc` of whoever the player stands as. That `mail` needs
    `mailutils` on the box and reaches emailit.io from that box's network still holds.)*
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

## Decisions from slice 3 planning (owner-confirmed 2026-10-15)

These replace decision 16's save question and decision 33's travelling login.

42. **The file is the login.** `mail` is logged in as whatever the current user's `~/.mailrc` on
    the current box holds, and as nothing when there is none. No login lives in the terminal, so
    nothing travels: `ssh` to another box uses that box's file, `exit` home uses yours again, and
    `su` to another user uses theirs. `mail login` always writes `~/.mailrc` (`0600`), asking
    nothing, and `mail logout` deletes it. Every box a player logs in from therefore keeps their
    password in plain text, readable by root there. A thief who wants a victim's mail at home
    copies the file's address and password into their own `mail login`.
43. **The new-mail check watches whoever the player stands as.** It is `mail` run quietly where
    they stand: the current user's `~/.mailrc` on the current box, skipped when there is no file or
    the box cannot reach emailit.io. At home it is the player's own mail, on a victim's box as the
    victim it is the victim's, and on a box with no file there are no notices. Notices resume after
    a reload because the home `~/.mailrc` is still there, so no auto-login on terminal start is
    needed.
44. **A saved login that stops working is left alone.** When the password in a `~/.mailrc` is
    wrong (someone ran `mail passwd`), the check prints `mail: login failed for neo@emailit.io`
    once and then skips that file until its contents change; a typed `mail` prints the same line
    every time, until `mail login` or `mail logout`. Nothing deletes the file. Skipping it keeps a
    stale file from spending one of decision 28's five failures every minute.
45. **`~/.mailrc` holds `set` lines, as a real one does:** `set from=neo@emailit.io` and
    `set password=s3cret`, each value running to the end of its line. Blank lines and lines
    starting with `#` are ignored, and a hand-written or copied file works exactly like one
    `mail login` wrote. A file missing either line makes `mail` print `mail: ~/.mailrc has no login`.

## Decisions from slice 4 planning (owner-confirmed 2026-10-15)

These settle what decisions 15, 18 and 20 left open about sending.

46. **Ctrl-O writes the draft, Ctrl-X sends it.** In `send` and `reply`, nano's keys mean what
    they mean for a file: Ctrl-O writes the draft and stays open, Ctrl-X closes the editor and
    sends the draft as it was last written. Nothing written, or an empty draft, prints
    `mail: send cancelled` (or `mail: reply cancelled`) and sends nothing. Edits after the last
    Ctrl-O are lost, as an unsaved buffer is under a real `mail`. Rejected: Ctrl-X sending the
    buffer as it stands, and a `Send message? (y/n)` question that file nano does not ask.
47. **The domain is checked before nano opens; the rest at send.** `mail send bob@gmail.com hi`
    is refused at once with `mail: bob@gmail.com: unknown domain`, asking no server and counting
    nothing. `no such mailbox` and `mailbox full`, a reply to a system sender included, are found
    when the message is sent, after Ctrl-X: the bounce prints, the draft is gone (there is no Sent
    folder), and the send counts toward the 20 an hour. Rejected: asking the server before nano,
    and saving a bounced draft to `~/dead.letter`.
48. **A send, a reply or a delete that works prints nothing**, as real `mail` and `mail logout`
    do. In a script it returns nothing.
49. **`mail send trin hello there`** mails `trin@emailit.io` with the subject `hello there`. A bare
    handle means `@emailit.io`, and the address is lowercased, as in `mail login`. The subject is
    every word after the address and is required; without one `mail` prints its usage. In a
    script the subject is exactly the third argument and the body the fourth:
    `mail('send', 'trin', 'hello there', 'body text')`.
50. **A reply opens on an empty line above the quoted original.** Every line of the original is
    prefixed `> `, so its own quotes become `> > ` and the whole history comes along. No
    `On … wrote:` line, as in the NPC mail already in the world. The subject is `Re: <subject>`,
    never `Re: Re:`, cut to 80 characters. The quote counts toward the 4,000: a reply that grows
    past it is refused, and the player trims it.
51. **Size limits on the client, the rate limit on the server.** A subject over 80 characters is
    refused before nano opens with `mail: subject too long`; a body over 4,000 after Ctrl-X with
    `mail: message too long`. Neither reaches the server or counts. The 21st send in an hour is
    found only at send and prints `mail: too many messages sent, wait an hour`; the draft is gone.
    The server enforces all three regardless of what the client checked.

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
3. ✅ **Reading mail** (v0.386.0, #683). `mailutils`, `mail login` writing `~/.mailrc` and `logout` deleting it, the
   list and `read`, and the offline and emailit.io-down answers; the guess throttle, stable
   numbers, scripted reads and read marks, and a stale login's error (decisions 28, 29, 32, 34,
   35, 37, 42, 44, 45). A player reads their welcome mail.
4. ✅ **Sending mail** (v0.387.0, #684). `send`, `reply`, `delete`, the bounces, the size and
   rate limits, and the inbox cap with system mail always delivered, and scripted `send` and
   `reply` (decisions 34, 46–51). Two players exchange mail.
5. **Changing the password, and new-mail notices.** `mail passwd` and the background check of
   decisions 25, 26, 43 and 44.
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

## Slice 3 plan: reading mail

**Branch**: `feat/mail-reading` · **Version**: 0.385.0 → 0.386.0 · **Class**: behaviour change ·
**Delivery**: one PR against `main`, with a migration.

**As built (2026-10-15, #683, merged as `3d59703e`).** Shipped as planned, with these changes:

- **The server does not ask where the caller stands.** `resolveMail` carries no
  `caller_machine_id`: with no log line to trace, only reachability matters, and the client
  refuses a box with no network itself, as `wallet` does.
- **`email_login_failures` landed with the throttle** (increment 5), not with the inbox, and
  brought `email_check_password`, the one password check `email_inbox` and `email_read` share.
- **The wire shapes of a listed and an opened message live in `core/emailit/inbox.ts`**, read by
  the handler and the client alike, so the browser takes none of the server's code.
- **`mail login` checks the home can take the file before asking emailit.io**, so a doomed login
  spends no password check. An empty address prints `mail: no address given`.
- **The usage grew with each increment**, and is now built from the manual's synopsis.
- `scripts/testMailRead.ts` has 15 checks. The migration went to jshack-dev and jshack-prod
  before the merge, so the preview could read mail.

**Value.** A player who signed up installs `mailutils`, runs `mail login`, and reads their welcome
mail with `mail` and `mail read 1`. Whoever can read a `~/.mailrc` reads that inbox.

**Path.** `mail` (`core/commands/mail.ts`) reads the current user's `~/.mailrc` on the current box
→ `env.mail` → the adapter posts a signed `resolveMail` to `api/network.ts` → the handler finds
where the caller stands and reaches emailit.io's web server through `resolveWebTarget`, as a
`curl` would → one RPC checks the throttle and the password and answers with the inbox or one
message → the command prints it. `mail login` asks the same RPC first, then writes the file.

### Choices made while planning (owner to confirm with the plan)

- **Mail is served by emailit.io's web server.** The handler reaches emailit.io through the same
  `resolveWebTarget` a fetch uses, so a bricked emailit.io, a dark gateway or a stopped web server
  takes mail down exactly as it takes sign-up down. A box with no network is refused on the
  client before anything is sent, as `wallet` is. Every way of not getting there prints
  `mail: cannot reach emailit.io`.
- **Mail leaves no line in emailit.io's `access.log`.** It is not a page fetch, and slice 5's
  60-second check would bury the log. A `/var/log/mail.log` of logins with their source address
  goes to the backlog, beside emailit.io's root view.
- **The password travels in the signed request and is hashed on the server**, as `ssh`'s does.
  Nothing logs it.
- **Two RPCs, each one transaction with the throttle.** `email_inbox(handle, md5, key)` answers
  the list, and `email_read(handle, md5, key, number)` answers one message and marks it read.
  Each takes a lock on the player's key, refuses while 5 failures sit in the last minute, and
  records a failure for a wrong password. A new table `email_login_failures (player_key,
  failed_at)` holds those failures. **An unknown handle is a wrong password**: the same answer,
  and a failure counted, so `mail login` cannot tell a free handle from a taken one. A refused
  (throttled) request is not a password check and counts nothing. Same security posture as
  `email_signup`: RLS on, no policies, EXECUTE for `service_role` only.
- **`mail login` asks `Address:`, then `Password:` (masked).** The address may be typed as `neo`
  or `neo@emailit.io`, in any case, and is stored lowercase. Another domain is refused before the
  password is asked, with `mail: <address>: unknown domain` (decision 18's wording). The server
  is asked first, then the file is written: a refused login writes nothing and leaves an existing
  file as it was. A home the user cannot write to prints `mail: can't create '<path>': Permission
  denied`, and no login exists. An existing `~/.mailrc` is replaced without asking. Success prints
  `You have 1 new message.`, `You have 2 new messages.` or `You have no new messages.`
- **What `mail` says when it cannot use the file.** No file: `mail: not logged in — run mail
  login`, with nothing sent. An unreadable one (after a `chmod`): `mail: can't read '<path>':
  Permission denied`. A file whose address is at another domain: `mail: <address>: unknown
  domain`. A wrong password or unknown handle: `mail: login failed for <address>`.
- **`mail logout` deletes `~/.mailrc` and prints nothing**, as `rm` does. With no file it prints
  `mail: not logged in`.
- **The list's columns.** The `N` mark or a space, two spaces, the number right-aligned to 3, two
  spaces, the sender padded to 22, the date (`Oct 15 09:12`, UTC), two spaces, the subject; the
  line is cut at 80 characters. `read <n>` that is not a whole number answers
  `mail: no message <n>`, as a missing one does.
- **Which subcommands work where.** `login` refuses in a script with `mail: login is interactive`
  and without a terminal with `mail: login needs a terminal` (it has a masked prompt). `logout`
  refuses in a script with `mail: logout is interactive` (decision 34) and works in a pty-less
  shell. The list and `read` work everywhere, a script included, and return their lines to it.
  The usage this slice prints is `mail: usage: mail [read <n>] | login | logout`; slices 4 and 5
  add theirs.
- **`mailutils` is a plain apt package**, `{ name: 'mailutils', binaries: ['mail'] }`, and `mail`
  is available where it is installed, as `wallet` is.

### Acceptance criteria

1. On a box without `mailutils`, `mail` is not found, as any uninstalled tool is. After
   `apt install mailutils`, `mail` runs on that box.
2. With no `~/.mailrc`, `mail` prints `mail: not logged in — run mail login` and sends nothing.
3. `mail login`, address `Neo`, password `s3cret` (nothing echoed): prints
   `You have 1 new message.`, and `~/.mailrc` holds `set from=neo@emailit.io` and
   `set password=s3cret`, owned by the user, readable and writable by that user and root only.
4. A wrong password or an unknown handle prints `mail: login failed for neo@emailit.io` and writes
   nothing; an existing `~/.mailrc` is unchanged. An address at another domain is refused before
   the password is asked.
5. `mail` lists the inbox oldest first: `N    1  noreply@emailit.io      Oct 15 09:12  Welcome to
   emailit.io`. An empty inbox prints `No mail for neo@emailit.io`.
6. `mail read 1` prints the `From:`, `To:`, `Date:` (`Thu, 15 Oct 2026 09:12:03 +0000`) and
   `Subject:` headers, a blank line and the body. Afterwards the list shows message 1 without
   `N`, and a fresh `mail login` says `You have no new messages.` `mail read 7`, `mail read x`
   and `mail read` with no number answer `mail: no message 7`, `mail: no message x` and the usage.
7. A `~/.mailrc` written by hand or copied from another box logs in the same way; blank lines and
   `#` lines are ignored, and a password containing spaces or `=` works. A file missing either
   line prints `mail: ~/.mailrc has no login`.
8. After the account's password changes (stood in for by a test writing a different hash), `mail`
   prints `mail: login failed for neo@emailit.io` every time and the file is untouched.
9. The file is the login: on box B with `mailutils` and no file, `mail` is not logged in; `exit`
   home and `mail` lists the player's own inbox; `su` to a user whose `~/.mailrc` holds another
   address and `mail` lists that inbox.
10. After 5 failed password checks within a minute, from any mix of addresses, logins and saved
    files, the next one, even with the right password, prints
    `mail: too many failed logins, wait a minute`. A minute after the oldest failure, the right
    password works again. Another player is not held back, and the account is never locked.
11. With the box offline, or emailit.io bricked or its web server stopped, every `mail` command
    prints `mail: cannot reach emailit.io`, and `mail login` writes nothing.
12. In a script, `mail()` returns the list and `mail('read', '1')` returns the message and marks
    it read; `mail('login')` and `mail('logout')` return `mail: login is interactive` and
    `mail: logout is interactive`.
13. `mail logout` deletes `~/.mailrc` and prints nothing; `mail` then says not logged in.
    `mail logout` with no file prints `mail: not logged in`.
14. `man mail` describes `login`, `logout`, the list and `read`, and says the login is saved in
    plain text in `~/.mailrc`.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The server answers an inbox.** Migration `email_login_failures`, `email_inbox`; a
   `core/emailit/` handler for `resolveMail` (verify, where the caller stands, reach emailit.io,
   ask the store, read its answer); the `api/network.ts` action; the adapter method. Unit tests
   with a fake store; the wrong-password and unknown-handle answers are one answer.
2. **`mail` lists an inbox from `~/.mailrc`.** The `mailutils` package, the command, the file's
   parsing (decision 45), not logged in, cannot reach, login failed, the list's format and the
   empty inbox. Criteria 1, 2, 5, 7, 8, 9, 11.
3. **`mail read <n>`**, and the message marked read: `email_read`, the handler's second request,
   the command's `read`. Criterion 6.
4. **`mail login` and `mail logout`.** Prompts, the domain check, the server first, the `0600`
   write, the new-message count, the delete. Criteria 3, 4, 13.
5. **The guess throttle.** Both RPCs refuse while 5 failures sit in the last minute; the command
   prints the wait. Criterion 10.
6. **Scripts and terminals, `man mail`, handbook, version 0.386.0.** Criteria 12, 14; the
   handbook's command table and codebase map; `docs/project-status.md`.

### Evidence

- Unit: the handler, the command (through a test env, as `wallet.test.ts` does), the `.mailrc`
  parsing and the adapter. No UI change, so no jsdom work.
- Wire-check: a new `scripts/testMailRead.ts` against `vercel dev` + supabase: sign up, the inbox
  shows the welcome unread, `read 1` returns it and marks it read, a wrong password and an
  unknown handle answer the same, the sixth failure in a minute is refused while another key is
  not, and a bad message number answers `no message`. `testEmailitSignup.ts` re-runs unchanged.
- Migration: applied to the local stack for the wire-check; pushed to jshack-dev and jshack-prod
  after the merge, on the owner's go.
- Pre-PR: Stryker on the changed lines of `core/emailit/`, `mail.ts` and the adapter; typecheck;
  lint; the full test run.
- No browser run; the epic's one run at the end walks login, the list, `read`, a stolen
  `~/.mailrc` on a second player's box, and logout.

## Slice 4 plan: sending mail

**Branch**: `feat/mail-sending` · **Version**: 0.386.0 → 0.387.0 · **Class**: behaviour change ·
**Delivery**: one PR against `main`, with a migration.

**As built (2026-10-15, #684, merged as `f8f00a50`).** Shipped as planned, with these changes:

- **One migration for the slice**, `20261015010000_email_sending.sql`: `email_sends` and
  `email_send`, `email_read` recreated with `read_mark`, and `email_delete`. `email_sends` landed
  with the send limit (increment 3), not with delivery.
- **`mark` is required on a `read`**: a request that does not say whether to mark the message is
  turned away, so no client can mark one read by leaving the field out.
- **`send` needs a terminal only when typed, so the command asks itself.** `withoutTty` sees only
  the arguments, and a typed `mail send trin hello there` and a script's
  `mail('send', 'trin', 'hello', 'there')` are the same four words. The command checks
  `env.scripted` and `hasTty` instead, as `msfconsole` does.
- **A script's text stands where the player would have typed**, on the draft's empty first line,
  so a scripted reply is the text, a newline, then the quote. An empty scripted body cancels, as
  an empty draft does.
- **`send` and `reply` share one `composeAndSend`**: editor (or script), cancel, the 4,000 check,
  the send and its bounces.
- **A reply to a sender at another domain is refused** before nano opens. No such sender exists
  today; the check is what turns the sender into a handle.
- **`Nano` takes a `title`, not a `path`**, so one editor serves files and messages, and closing
  an overlay moved into `ui/state.ts`, where it hands a message back to the command waiting on it.
- `scripts/testMailSend.ts` has 23 checks. The migration went to jshack-dev and jshack-prod before
  the merge. Mutation 430/472 on the changed lines; the read and delete wiring in `ui/state.ts`
  is left to the epic's closing browser run.

**Value.** Two players mail each other: `mail send` writes a message in nano and it arrives in
the other inbox, `mail reply` answers it with the history quoted, and `mail delete` clears it.
Whoever holds the password can send as that address, so a stolen `~/.mailrc` now speaks as well
as reads.

**Path.** `mail send|reply|delete` (`core/commands/mail.ts`) reads `~/.mailrc` as the list does →
for `send` and `reply`, `env.compose` opens nano on a draft and resolves with what was written →
`env.mail` → the adapter posts a signed `resolveMail` naming its `op` → the handler reaches
emailit.io through `resolveWebTarget` as before → one RPC checks the throttle and the password,
then the send limit, the recipient and its inbox, and delivers (or deletes) → the command prints
nothing, or the refusal.

### Choices made while planning (owner to confirm with the plan)

- **The editor is a seam the command waits on**, as `su` waits on `env.prompt`.
  `env.compose({ to, subject, draft })` opens the nano screen and resolves with the draft as last
  written by Ctrl-O, or `null` when nothing was. The command, not the screen, decides what
  happens next, so every rule of sending stays in `mail.ts` under unit test and the screen only
  edits. Rejected: a new `ModeChange` that sends from the UI when nano closes, which would put
  the bounces and limits in `ui/state.ts`. The screen is the existing `Nano` with a different
  save: Ctrl-O keeps the draft in memory and reports `[ Wrote N lines ]`, Ctrl-X resolves. Its
  title bar reads `GNU nano · To: trin@emailit.io · Subject: hello there`.
- **A draft of nothing but blank space is empty**, and cancels.
- **The order of the checks** for `send`: the arguments (usage), the domain, the subject's
  length, `~/.mailrc` (slice 3's not-logged-in, unreadable and no-login answers), a network to
  ask from (`cannot reach`), then nano, then empty (`cancelled`), then the body's length, then the
  server. Everything before nano costs the player nothing; everything after it loses the draft.
- **`reply` reads the original first, without marking it read** (decision 35). `email_read`
  takes a `mark` flag; `reply` asks with it off, so `mail: no message <n>`, a failed login and
  `cannot reach` all come before nano. The reply goes to the original's sender, `Re:`-prefixed,
  through the same send as `mail send`; the server cannot tell a reply from a send. A scripted
  reply's body is the given text, a newline, then the quote, the layout nano would have left.
- **One action, with an `op`.** `resolveMail` carries `op`: `list`, `read` (with `mark`), `send`
  (`to` as a bare handle, `subject`, `body`) or `delete` (`number`). The handler checks the subject
  (≤ 80) and body (≤ 4,000) in Unicode characters, not UTF-16 units, and turns a longer one away
  as `payload_invalid` without asking the store. New answers: 404 `no_mailbox`, 409
  `mailbox_full`, 429 `send_limited` beside 429 `throttled`, and 404 `no_message` for `delete`.
- **`email_send(handle, md5, key, to_handle, subject, body)`, one transaction.** The password
  check of slice 3 (throttle included) → under a lock on the player's key, refuse with
  `send_limited` when 20 sends sit in the last 60 minutes, else record one in a new
  `email_sends (player_key, sent_at)` → lock the recipient's account row; no row is
  `no_mailbox` (system senders and reserved handles hold none) → 100 messages already in it is
  `mailbox_full` → insert at the account's `next_number` and bump it. The sender is stored as
  `neo@emailit.io`. A failed or throttled login is not a send and records none; a bounce is and
  does (decision 38).
- **The inbox cap lives only in `email_send`.** System mail is written by other functions
  (`email_signup`'s welcome today, the job site later) that never look at it, so it is always
  delivered by construction.
- **`email_delete(handle, md5, key, number)`** answers `deleted`, `no_message`, or the check's
  word. Deleting marks nothing read, and the number is never reused (`next_number` is untouched).
- **Bounce wording**: `mail: trin@emailit.io: no such mailbox` and
  `mail: trin@emailit.io: mailbox full`, the recipient named in full as decision 18 has it.
- **Terminals and scripts.** At the prompt in a pty-less shell, `send` and `reply` refuse with
  `mail: send needs a terminal` (`reply`'s likewise); `delete` works anywhere. In a script,
  `mail('send', to, subject, body)` and `mail('reply', n, body)` never open the editor; a missing
  or extra argument prints the usage. The usage becomes
  `mail: usage: mail [read <n>] | send <to> <subject> | reply <n> | delete <n> | login | logout`.

### Acceptance criteria

1. `mail send trin hello there` opens nano titled with `trin@emailit.io` and `hello there`. A body
   written with Ctrl-O, then Ctrl-X, prints nothing, and trin's `mail` lists
   `N    2  neo@emailit.io        Oct 15 10:04  hello there`; `mail read 2` shows `From:
   neo@emailit.io`, `To: trin@emailit.io` and the body. `mail send TRIN@emailit.io hi` reaches the
   same inbox.
2. Ctrl-X with nothing written, or with an empty or blank draft, prints `mail: send cancelled` and
   delivers nothing. Text typed after the last Ctrl-O is not sent.
3. `mail reply 2` opens nano on an empty line above the original quoted with `> `, its own quotes
   as `> > `. The reply goes to the original's sender as `Re: hello there`, and a reply to that
   is `Re: hello there` again, never `Re: Re:`. An unread message 2 stays unread. `mail reply 9`
   prints `mail: no message 9` without opening nano. Cancelling prints `mail: reply cancelled`.
4. `mail send bob@gmail.com hi` prints `mail: bob@gmail.com: unknown domain` before nano opens,
   and counts nothing. A send to a handle nobody holds prints
   `mail: ghost@emailit.io: no such mailbox` after Ctrl-X, and a reply to the welcome mail prints
   `mail: noreply@emailit.io: no such mailbox`. A send to an inbox of 100 prints
   `mail: trin@emailit.io: mailbox full`.
5. An 81-character subject prints `mail: subject too long` before nano opens; an 80-character one,
   emoji counted as one each, is accepted. A 4,001-character body prints `mail: message too long`
   after Ctrl-X and delivers nothing; a 4,000-character one is delivered. Neither refusal counts
   toward the hour's 20.
6. After 20 sends in the last 60 minutes, bounces included, the 21st prints
   `mail: too many messages sent, wait an hour` and delivers nothing. A send whose login failed
   does not count. Another player is not held back. The 21st goes through once the oldest of the
   20 is an hour old.
7. `mail delete 2` prints nothing, and message 2 is gone from the list for everyone holding the
   password. The next message to arrive takes a new number, never 2. `mail delete 9` and
   `mail delete x` print `mail: no message 9` and `mail: no message x`. Deleting marks nothing read.
8. With no `~/.mailrc`, an unreadable one, or one with no login, `send`, `reply` and `delete` print
   slice 3's answers before nano opens. A wrong password prints
   `mail: login failed for neo@emailit.io` and counts toward the guess throttle.
9. With the box offline, `send` and `reply` print `mail: cannot reach emailit.io` before nano
   opens. With emailit.io down, `reply` prints it before nano, and `send` after Ctrl-X.
10. In a script, `mail('send', 'trin', 'hi', 'body')` delivers and returns nothing, and
    `mail('reply', '2', 'thanks')` delivers `thanks` above the quoted original. `mail('send',
    'trin', 'hi')` returns the usage. The limits apply as typed. Typed in a pty-less shell,
    `mail send trin hi` prints `mail: send needs a terminal` and `mail delete 2` works.
11. `man mail` describes `send`, `reply` and `delete`, Ctrl-O and Ctrl-X, and the limits.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The server delivers a message.** Migration: `email_sends`, `email_send` (password check,
   recipient, cap, delivery; the send limit comes in increment 3). The handler's `op` and `send`;
   the adapter's `sendMail`. Unit tests with a fake store, as slice 3's.
2. **`mail send` through nano.** `env.compose` (core seam, `ui/env.ts`, `ui/state.ts`, the
   `Nano` screen's compose save, jsdom test), the arguments, the domain and size checks, cancel,
   the bounces. Criteria 1, 2, 4, 5, 8, 9.
3. **The send limit.** `email_send` refuses the 21st in an hour; the command prints the wait.
   Criterion 6.
4. **`mail reply`.** `email_read`'s `mark` flag, the quoted draft, `Re:`. Criterion 3.
5. **`mail delete`.** `email_delete`, the handler's `delete`, the command. Criterion 7.
6. **Scripts and terminals, `man mail`, handbook, version 0.387.0.** Criteria 10, 11; the
   handbook's command table and `resolveMail` row; `docs/project-status.md`.

### Evidence

- Unit: the handler, the command through a test env with a fake `compose`, the adapter. jsdom for
  the `Nano` screen's compose save (Ctrl-O keeps, Ctrl-X resolves, nothing written resolves
  `null`).
- Wire-check: a new `scripts/testMailSend.ts` against `vercel dev` + supabase. Two sign-ups; A
  mails B and B's inbox shows it unread from A. B replies and A sees `Re:`. A reading for a reply
  leaves the original unread. An unknown handle and `noreply` bounce, an inbox seeded to 100 is
  full, and the 21st send in an hour is refused while another key is not. A delete removes the
  message and the next arrival skips its number. `testMailRead.ts` and `testEmailitSignup.ts`
  re-run unchanged.
- Migration: applied locally for the wire-check, then pushed to jshack-dev and jshack-prod before
  the merge, on the owner's go.
- Pre-PR: Stryker on the changed lines of `core/emailit/`, `mail.ts`, the adapter and the
  `Nano` screen; typecheck; lint; the full test run.
- No browser run; the epic's one run at the end adds two players trading mail and a reply.

## Backlog from this grill

- **Before multiplayer is announced**: reporting and blocking for player mail, and an operator
  tool to delete an abusive message or close an account, like `restoreSite.ts`.
- **A local-mbox mode for `mail`**: when not logged in to emailit.io, `mail` reads
  `/var/mail/<user>` on the box, and comes preinstalled on NPC boxes that have mail. A candidate
  for when NPC mail starts to matter in missions.
- **An `smtp` service on emailit.io**: port 25 in a scan, with its own versions and CVEs.
- **A `/var/log/mail.log` on emailit.io**: one line per mail login with its source address, so
  whoever roots emailit.io can see who reads which inbox from where. Mail leaves no access-log
  line (slice 3).
- **Mission-era NPC mail**: clients mailing players, and players mailing them.
