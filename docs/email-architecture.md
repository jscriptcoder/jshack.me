# Email architecture (as-built)

How a player gets an email address in the game: the `mail` command, a sign-up page at
`emailit.io`, accounts and messages held in server tables, and emailit.io's own root-only
view of all of it. This is the shipped model of the email epic, complete at **v0.389.0**.
It is groundwork for missions — a later job site will take a player's address and mail them
a private address to open with `curl` or `lynx`; that job site, the per-player mission
address, and missions themselves are **not** here. The grill record and slice plan were
retired on close-out; what the epic deliberately left out is in `backlog.md` under "Email —
follow-ups deferred". When this doc and the code disagree, the code wins — fix the doc.

## The one idea the design turns on

**Mail lives in server tables, never in files.** emailit.io's box shows a view of the mail
built from those tables each time it is read, laid under the box's patch journal rather than
in it. The alternative — real mbox files in the journal — was rejected because one root on
emailit.io could then plant, rewrite or wipe every player's mail, and many writers appending
to one inbox fights the journal's one-row-per-file-per-writer shape (see
`cross-player-architecture.md`). Keeping the mail in tables means a root can forge what the
*next* root sees, but never touch anyone's actual mail, login or password.

Everything else follows from that: the server is the only authority, every `mail` request
carries the address and password and is checked afresh (there is no mail session), and the
password hash is the one thing worth stealing.

## 1. The server: four tables, seven functions, three entry points

All email state is in Supabase, reached only by the service-role Vercel functions. Four
migrations build it: `20261014000000_email.sql` (accounts, the welcome mail, sign-up),
`20261015000000_email_reading.sql` (the inbox read path and the guess throttle),
`20261015010000_email_sending.sql` (sends and the hourly limit) and
`20261015020000_email_passwd.sql`.

**Tables.**

- `email_accounts` — one row per handle: `handle` (lowercase, unique), `password_md5`,
  `signed_up_at`, and `signed_up_by` (the Ed25519 key that signed the sign-up, for the
  per-player daily cap; **not** a tie to the account — anyone with the password owns it).
- `email_messages` — one row per delivered message: its inbox, `number`, `sender`,
  `subject`, `body`, `delivered_at`, and a `read` mark.
- `email_sends` — one row per send that reached the server (bounces included), for the
  20-an-hour rolling limit.
- `email_login_failures` — one row per failed password check, keyed by the guessing player,
  for the 5-a-minute throttle.

**Functions** (all `SECURITY DEFINER`, each check-and-record in one statement so parallel
requests cannot slip past a limit): `email_signup`, `email_check_password`, `email_inbox`,
`email_read`, `email_send`, `email_delete`, `email_passwd`. talkit.io's `talkit_post` and
`talkit_comment` check a writer's handle through `email_check_password` too, so a post or a
comment spends the same guesses as a login, and a stolen password also writes as its owner.

**Entry points**, all through `/api/network` on a signed envelope:

- **`resolveHttpFetch`** serves emailit.io's pages and, on `POST /signup`, calls
  `email_signup`. This is how `curl -d` and a lynx form both sign up.
- **`resolveMail`** carries one of `op: list | read | send | delete | passwd` plus the login,
  and runs the matching function (`core/emailit/handleResolveMail.ts`). It carries no caller
  location — with no log line to trace, only reachability matters.
- **`resolveCrossPlayerFs`** builds emailit.io's root view when the caller's session on the
  box is root (section 6).

## 2. Signing up

`emailit.io` is a fixed site (`generation/fixedSites.ts`) with a public address, a findit
listing and operator restore, running `http` and `ssh` like findit.io and mapit.io. Its
front page (`core/emailit/pages.ts`) carries a sign-up form and the `curl -d` recipe.

- **`curl -d "handle=neo&password=hunter2024" http://emailit.io/signup`** is the terminal
  route. `-d` is a flag that sends a form-encoded POST body (`&` separates fields, `+` is a
  space, `%XX` a byte); the body is **never** written to the access log, so the line reads
  `POST /signup`, and cracking the stored hash stays the real prize.
- **lynx sends the same POST** from the form. The password field renders a star per character
  (`[******_]` while typed into), never the characters, as lynx itself draws one. The
  terminal's masked prompts (`su`, `mail login`) still show nothing. Back after a submit
  re-fetches `/signup` as a **GET** (a POSTed page enters lynx's trail as a GET of its
  address), so it never resends and never spends a second sign-up.
- **Every other web server answers a POST with `405`** and logs `"POST <path> HTTP/1.1" 405`.
  The access log now records the real method (`core/logging/accessLog.ts`, `GET` when
  unnamed); only emailit.io's `/signup` takes a POST.
- A handle follows the Intro username rules, is stored lowercase (`Neo` and `neo` are one
  address), and may not be one of 14 reserved names (Intro's 7 plus `postmaster`, `admin`,
  `root`, `abuse`, `noreply`, `support`, `emailit`). The password needs only the Intro
  minimum length and is stored as `md5(password)` — 32 lowercase hex, deliberately weak like
  every reachable hash in the world.
- **Caps**: at most 3 successful sign-ups per player per rolling 24 hours; a refused sign-up
  costs nothing. Every new account gets a welcome mail from `noreply@emailit.io`.

Both pages warn: *don't use a password you use anywhere outside this game.* The hashes are
shown to other players by design, and people reuse real passwords — this protects the person.

## 3. The `mail` command

`mail` comes from `apt install mailutils` and is preinstalled nowhere
(`core/commands/mail.ts`). Subcommands: `login`, bare `mail` (list), `read <n>`,
`send <to> <subject>`, `reply <n>`, `delete <n>`, `passwd`, `logout`.

**The file is the login.** There is no terminal-held session: `mail` is logged in as whatever
the current user's `~/.mailrc` on the current box holds, and as nothing when there is none.
So nothing travels — `ssh` to another box uses that box's file, `exit` home uses yours, `su`
uses theirs. `mail login` writes `~/.mailrc` (`0600`, owned by that user), asking nothing;
`mail logout` deletes it. `~/.mailrc` holds `set from=…` and `set password=…` lines in plain
text, so **every box a player logs in from keeps their password readable by root there** —
and a hand-written or copied file logs in exactly the same. This is the first takeover route:
a thief who reaches a victim's box copies the address and password out of their `~/.mailrc`.

- **Composing is nano.** `send` opens an empty buffer titled with the recipient and subject;
  `reply` opens on an empty line above the original quoted with `> ` (its own quotes become
  `> > `; no `On … wrote:` line), subject `Re: <subject>` and never `Re: Re:`. **Ctrl-O
  writes the draft, Ctrl-X sends it**; nothing written, or an empty draft, cancels. The quote
  counts toward the body limit.
- **Scripts read and send but never log in.** The list, `read`, `delete` and a `~/.mailrc`
  auto-login work; `send`/`reply` take the body as a final argument instead of opening nano;
  `login`, `logout` and `passwd` refuse with `mail: <subcommand> is interactive`, so a script
  can never guess a password.
- **`mail passwd` rewrites the `~/.mailrc` it ran from.** Because the server keeps no session,
  changing the password cuts off every other holder of the old one at once — a victim's home
  file, a thief's copy — and whoever changes it first keeps the account. On success it writes
  the new password back into its own file so that one keeps working.

## 4. Delivery, limits, numbering

- Players mail `@emailit.io` addresses only; anything else bounces `unknown domain`, an
  unknown handle `no such mailbox`. The domain is checked before nano opens, the mailbox at
  send. A bare handle means `@emailit.io`, lowercased.
- **System senders** (`noreply@emailit.io`, and the job site later) are addresses no player
  can log in to; a reply to one bounces. System mail is always delivered, so nobody can fill
  an inbox to block a mission mail.
- **Limits**: subject ≤ 80 characters, body ≤ 4,000 (both counted in Unicode characters, both
  enforced on the client before/after nano *and* on the server); ≤ 20 sends per player per
  rolling hour (every send that reaches the server counts, so probing handles by mailing them
  is held too); an inbox holds 100, and player mail to a full inbox bounces `mailbox full`.
- **A message's number is stable**: it takes the next number on arrival and keeps it until
  deleted, never reused, so the list has gaps after a delete. The list is oldest-first.
- **Read marks live on the server** (`read` sets them; `reply` and `delete` do not), so mail a
  thief has opened shows as read to its owner — a clue someone was in. There is no Sent
  folder; sending writes one copy, into the recipient's inbox.
- **A guess throttle, per guesser not per account**: after 5 failed password checks in a
  minute — across every address, login, saved file, `passwd` old password, send or read — the
  server refuses that player's checks for the rest of the minute. An account is never locked,
  so nobody can lock anyone else out. Online guessing works but is slow; cracking the hash
  file stays the fast route.

## 5. The new-mail check

The one deliberate timed pull in a client that otherwise polls nothing (`ui/state.ts`,
`MAIL_CHECK_MS = 60_000`; Supabase Realtime was rejected). It is `mail` run quietly where the
player stands: the current user's `~/.mailrc` on the current box, skipped with no file or when
the box cannot reach emailit.io. It runs on a 60-second timer and again the moment a hidden
tab becomes visible; a hidden tab checks nothing.

- It prints `You have new mail.` above an idle prompt (redrawing a half-typed line), waiting
  for the prompt inside nano, lynx, ftp or a password prompt. The mark it compares against
  lives per-address in the terminal's memory and only grows, so a message is announced once.
- **The first check of an address announces only unread mail**: a fresh terminal after a
  reload, or standing as a victim on their box, starts with no mark, prints the notice if
  anything is unread, then sets the mark. This is why notices resume after a reload with no
  typing, and why it does not nag after every reload.
- **This is how a victim learns their password was taken.** When the saved password no longer
  works, the check prints `mail: login failed for <address>` **once** and then leaves that
  file alone until its contents change (a typed `mail` still prints it every time). Nothing
  deletes the file; skipping it keeps a stale login from spending a throttle failure every
  minute.

## 6. emailit.io's root view of the mail

A root on emailit.io finds every account's mail at the real Debian paths. The view is built
from the tables on every read, in `core/emailit/spool.ts`:

- **`/etc/emailit/passwd`** — one `handle:md5` line per account, in sign-up order
  (`neo:5f4dcc3b5aa765d61d8327deb882cf99` for the password `password`).
- **`/var/mail/<handle>`** — a real mbox shaped like the NPC mailboxes
  (`generation/mailbox.ts`, which now exports `rfcDate` and `asctime`): a
  `From <sender> <asctime>` separator, then `Date:`, `From:`, `To:`, `Subject:`, a blank line
  and the body, oldest first. A read message carries `Status: RO`, an unread one none, so a
  root sees what the owner has not opened; a body line beginning `From ` is written `>From `.
  No `Received:` lines, no message numbers. **Every account has a file**, 0 bytes when its
  inbox is empty, so the spool and the passwd file always name the same accounts.

**How it is wired.** emailit.io's generated box carries two empty directories,
`/var/mail` (the spool's root-only permissions) and `/etc/emailit` (root-only), added by a
`keepsMail` check in `generation/fixedSiteFs.ts`. On a read, `resolveCrossPlayerFs.ts` checks
`activeSession?.userType === 'root'` on emailit.io's machine; if so it fetches the accounts
(`findMailSpool` in `api/network.ts`, selecting `email_accounts` with their
`email_messages`), builds the files with `withMailSpool`, and lays them into the box **before
the journal is replayed**. Below root nothing is built — no table read, nothing on the wire —
so a guest does not see the directories exist, like every root-only file in the world. A read
whose spool lookup fails returns `500 mail_spool_lookup_failed` rather than an empty box.

**The view is attackable like the rest of the box.** Because the files sit *under* the
journal, a root's write, `rm`, `mv` or `chmod` lands in emailit.io's journal and every later
root reader sees it: `rm -r /var/mail` shows an empty spool, a rewritten `/etc/emailit/passwd`
is a honeypot whose cracked hashes fail at login, a written `/var/mail/trin` stops showing
trin's new mail. **The tables never change**, so no player's real mail is touched, and
`scripts/restoreSite.ts emailit.io` wipes the journal and brings the true view back. This
replaced an earlier read-only-view design, whose one unattackable file on an otherwise
attackable box was the odd exception, and the real-files design, where one root could take
every account by writing a hash with no way to undo it.

**Ceiling (a recorded tripwire, `backlog.md`).** The view is built whole on every read, so a
response — capped at 4.5 MB — breaks at about 11 full inboxes (100 × 4,000 chars) or a few
thousand ordinary ones. With sends held to 20 an hour nobody reaches it before launch; the
fix, when needed, is to serve the listing first and fetch a mailbox only when it is read.

## 7. The two takeover routes

An account is a handle and a password, nothing more, and stays alive with whoever holds the
password. A stolen address is not recovered by signing up again — the victim just makes a new
one; bad luck is the lesson, and the game gives no warning or nudge. Two ways in, both
designed:

1. **A saved login** in `~/.mailrc` on a box the attacker reaches (section 3).
2. **Root on emailit.io and its crackable hashes**: once root on the box, read
   `/etc/emailit/passwd` and crack a handle's md5 with a real external wordlist tool — the
   account passwords are player-chosen, so a weak one falls. **Getting root is CVE-only**: a
   fixed site's own root password is drawn from the uncrackable pool by design
   (`CRACKABLE_ROOT_CHANCE = 0` in `generation/fixedSiteFs.ts`), so it is never guessed and `ssh`
   with a password never lands; the way in is a live **root-tier** hole on emailit.io's `:80` or
   `:22`, the same fixed-site model as findit.io. When the day's holes are only user/guest tier,
   root is not reachable that day. (md5 is weak on purpose and is never to be "fixed".)

Either way, `mail passwd` finishes the takeover and the victim's next check tells them.

## 8. Proving it

- **Unit + jsdom**: sign-up validation and pages, the inbox/read/send/delete/passwd handlers,
  the `mail` command and its script mode, the mbox builder (`spool.test.ts`), the `keepsMail`
  directories, the root-only read filter, and the new-mail check.
- **Wire-checks** (`api/` runtime, vs `vercel dev` + local supabase):
  `scripts/testEmailitSignup.ts`, `testMailRead.ts`, `testMailSend.ts`, `testMailPasswd.ts`
  and `testMailSpool.ts` (the root view: root sees passwd and mailboxes with read marks, a
  lower tier and no session see neither, a root write sits over the view while the real inbox
  is untouched, and wiping the journal restores it).
- **One live browser run at the epic's close-out** (2026-10-15, v0.389.0) walked all six
  slices with two players: `curl` and lynx sign-up (and lynx Back never resending the POST),
  reading and the plaintext `~/.mailrc`, two players trading mail and a reply, the live
  new-mail notice, a root on emailit.io reading the spool, a forged mailbox over the untouched
  real inbox, the restore, and a full takeover — recovering a handle's password, logging into the
  victim's mail, changing the password, and the victim's one `login failed` notice. On that game
  day emailit.io's network holes were only user/guest tier, so a legitimate in-game root was not
  available: the root-view, forge, restore and spool reads were exercised against a root `ssh`
  session stood up directly — the same root view `testMailSpool.ts` seeds — not via a CVE, and
  the handle password was one chosen at sign-up standing in for a real external md5 crack. The
  behaviours themselves are genuine.

## Key files

- **Server**: `supabase/migrations/20261014000000_email.sql` and the three that follow;
  `api/network.ts` (`resolveHttpFetch`, `resolveMail`, `resolveCrossPlayerFs`, `findMailSpool`).
- **Handlers**: `core/emailit/handleResolveMail.ts`, `signup.ts`, `inbox.ts`, `pages.ts`,
  `spool.ts`.
- **View wiring**: `core/network/resolveCrossPlayerFs.ts`, `core/generation/fixedSiteFs.ts`,
  `core/generation/mailbox.ts`, `core/generation/fixedSites.ts`.
- **Client**: `core/commands/mail.ts`; the new-mail check and mail API wiring in
  `ui/state.ts`; `core/logging/accessLog.ts` (the request method).
- **Operator**: `scripts/restoreSite.ts emailit.io`.
