# Plan: email, at emailit.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-14. No slice is planned
yet; slice 1 is next.
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
    `handle:hash` line per account (`0600 root:root`). A guest sees the files exist and cannot read
    them. Writing to them is refused; the tables are the truth.

## Out of scope

- The job site, the private per-player mission address, and missions themselves. The job site
  ties that address to the player who applied (from the request), not to an email address.
- NPC senders and recipients beyond `noreply@emailit.io`.

## Slices

Each slice is its own PR and version bump. A slice that changes `api/` gets its `scripts/test*.ts`
wire-check. One browser run at the end covers them all.

1. **emailit.io and sign-up.** The fixed site and its front page, `curl -d`, and `/signup`:
   validation, reserved handles, the daily cap, the hash, and the welcome mail stored. The
   real-password line on Intro. A player who signs up reads `Welcome, neo@emailit.io`; a second
   sign-up for the same handle is refused.
2. **lynx sends POST forms**, and Back never resends one. A lynx player signs up from the front
   page.
3. **Reading mail.** `mailutils`, `mail login` with `~/.mailrc`, auto-login, `logout`, the list and
   `read`, and the offline and emailit.io-down answers. A player reads their welcome mail.
4. **Sending mail.** `send`, `reply`, `delete`, the bounces, the size and rate limits, and the
   inbox cap with system mail always delivered. Two players exchange mail.
5. **Changing the password, and new-mail notices.** `mail passwd` and the background check of
   decisions 25 and 26.
6. **emailit.io's root view.** `/var/mail/<handle>` and `/etc/emailit/passwd`, built from the
   tables, read-only.

## Backlog from this grill

- **Before multiplayer is announced**: reporting and blocking for player mail, and an operator
  tool to delete an abusive message or close an account, like `restoreSite.ts`.
- **A local-mbox mode for `mail`**: when not logged in to emailit.io, `mail` reads
  `/var/mail/<user>` on the box, and comes preinstalled on NPC boxes that have mail. A candidate
  for when NPC mail starts to matter in missions.
- **An `smtp` service on emailit.io**: port 25 in a scan, with its own versions and CVEs.
- **Mission-era NPC mail**: clients mailing players, and players mailing them.
