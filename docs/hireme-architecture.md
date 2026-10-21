# hireme architecture (as-built)

How a player gets a contractor board: `hireme.io`, a fixed site where a player applies with their
emailit.io address and is mailed a private address of their own, which `curl` or `lynx` opens.
This is the shipped model of the hireme epic, complete at **v0.422.0** (three slices,
v0.420.0–v0.422.0, PRs #719, #721 and #722). It is the front door for missions, built before
missions exist: every board says so. Jobs, claiming them and payment are **not** here; they wait
for the missions grill (see "What missions add"). The grill record and slice plans were retired on
close-out. When this doc and the code disagree, the code wins — fix the doc.

## The one idea the design turns on

**A board's address is its key, and it belongs to an emailit.io handle.** There is no login:
whoever has the address sees the board, and the address only ever goes to the handle's inbox. So
whoever holds the mailbox holds the board, and an address leaks the ways anything leaks — a read
inbox, a `~/.bash_history` holding `lynx <address>`, a talkit post. Nothing warns the player to
keep it private; they learn it was a secret when someone else turns up on their board. One handle
has one address for good: applying again re-sends the same one, so a leaked address stays
leaked.

Two machines follow from the owner's wish that a broken application site must not take players'
boards down with it: **hireme.io** takes applications and nothing else, and an unlisted **boards'
server** answers at every board's address.

## 1. Applying at hireme.io

- **hireme.io is the seventh fixed site**: the `HIREME` row last in `FIXED_SITES`
  (`generation/fixedSites.ts`), hostname `hireme`, place
  `{ category: 'hacker', place: 'the hiring hall' }`, its address `193.72.191.97` after talkit's.
  The row gives it a box with `http` and `ssh`, a findit listing, `whois`, a persona and operator
  restore. `hireme` is in `RESERVED_HANDLES` (`emailit/signup.ts`), so nobody signs up as the
  agency.
- **The front page** (`core/hireme/pages.ts`, `HIREME_FRONT_PAGE`) is planted at `index.html` and
  at `apply`, so a browser going back after a submit fetches the form again and never resends it.
  It carries the form (one `email` field, `[ Apply ]`) and the recipe
  `curl -d "email=neo@emailit.io" http://hireme.io/apply`. A root can deface it like any file.
- **`POST /apply` is answered by a function** (`answerApply`, `core/hireme/apply.ts`), matched by
  network and path in `network/resolveHttpFetch.ts` before any file is read. The address is read
  as `mail` reads a recipient (`typedAddress`, `emailit/mailrc.ts`): trimmed, lowercased, and a
  bare handle means `@emailit.io`.
- **Refusals** are a `<p role="alert">` under the line they are about, the address kept as typed:
  "Enter your emailit.io address" and "Only emailit.io addresses can apply" under the field; "No
  such mailbox" under the field for a handle no account holds, whether its shape is impossible or
  the store has no account; "We already have your application. Check your inbox." under the
  button, inside the 24-hour window.
- **Success** reads "Thanks, neo. We have sent your contractor board to neo@emailit.io." No page
  ever shows the address: anyone may apply for any handle, so a page that showed it would hand
  neo's board to whoever typed `neo`. Nobody proves they own the address they type, because the
  board's address goes only into that inbox.
- **The mail** comes from `jobs@hireme.io`, a system sender: always delivered, even to a full
  inbox; nobody logs in to it; a reply is refused by `mail` (`unknown domain`). Subject
  `Your hireme.io application`; the body thanks the handle and gives
  `http://<address>/` and `lynx http://<address>/`.
- **The log**: every `/apply` POST is a `POST /apply` line in hireme's `access.log`, never the
  form. A 500 logs nothing.

## 2. The table and the function

- **`hireme_boards`** (`supabase/migrations/20261020020000_hireme_boards.sql`): `handle`
  (primary key, references `email_accounts`), `address` (UNIQUE, CHECKed to
  `194.<0–255>.<0–255>.<2–254>`), `applied_at`, `mailed_at`. RLS on with no policies, so only the
  service role that `api/` uses reads it.
- **`hireme_apply(handle, candidate_address, sender, subject, body)`** does everything that must
  be atomic, under a lock on the applicant's `email_accounts` row, and answers one word:
  `no_mailbox`; `recent` (mailed inside 24 hours, nothing written); `collision` (the handle has no
  board and the candidate is somebody else's, nothing written); `sent` (the board read, or created
  at the candidate, `mailed_at` set, the mail delivered as the inbox's next message). The body
  arrives with `{address}` where the address goes and the function writes the board's own address
  in, so a re-sent mail names the address held, never the fresh candidate.
- **The window is per handle**, not per player: system mail ignores the 100-message cap, and only
  a per-handle limit stops a crowd burying one inbox.
- **The draw is the caller's**: `api/network.ts` draws with `node:crypto`'s `randomInt` and
  `BOARD_FIRST_OCTET`; `answerApply` takes it injected, offers up to 5 candidates on `collision`,
  then answers 500 `apply_failed`. A store that errs, or answers a word nobody taught it, is a 500
  too, never a guessed page.

## 3. The block and the lookup

- **The 194 block is the boards'**: `BOARD_FIRST_OCTET = 194` beside `PLACELESS_FIRST_OCTET`
  (`generation/world.ts`). `isPublicIp` (`generation/ip.ts`) accepts it, so every cross-network
  command routes a `194.` target to the server; `isBoardAddress` tests for it. About 16.7M
  addresses, so guessing one blind is hopeless.
- **A board's address is the one public address that is stored.** Every door to a public address
  (the fetch, the scan, the path sweep, `ssh` and every service gate: twelve wirings in
  `api/network.ts` and `api/sessions.ts`) finds its network through `networkByPublicIp`
  (`core/hireme/boards.ts`): a held `194.` address is the boards' server; an unheld one is
  nothing, answering exactly as an empty `193.` address does, so a wrong guess tells a prober
  nothing; every other address is `derivedNetworkByPublicIp`, without the table being read. A
  failed read is the lookup's error, never a guess either way.
- **`whois` answers for the whole block** from the client, held or not, as a real `whois` answers
  for a netblock: `inetnum: 194.0.0.0 - 194.255.255.255`, `netname: HIREME-BOARDS`,
  `org-name: hireme.io` (`commands/whois.ts`, `BOARDS_RECORD`).

## 4. The boards' server and the board

- **A fixed box nobody lists**: `BOARD_SERVER` (`generation/fixedSites.ts`) is a `FixedSite`
  kept out of `FIXED_SITES`, key `boards.hireme.io`, hostname `boards`, domain `hireme.io` (its
  `/etc/hosts` names `boards.hireme.io`, but no name resolves to it), place
  `{ category: 'hacker', place: 'the back office' }`. `fixedSite()` finds it through
  `FIXED_BOXES`, so its box, hostname and persona come from the same code as every site's:
  `http` and `ssh` on the seeded versions, an uncrackable root, empty logs, an empty web root,
  and a root-only `/etc/hireme`. It has no address of its own, no domain anybody can `curl` and
  no findit listing; it answers at every held address.
- **The board is answered at `/`** for a GET, any query ignored, from a function: the handle
  holding the address asked (`payload.target`), then `boardPage(handle)`: title
  `hireme.io - contractor board`, "Welcome back, neo.", then "Contractor board — no contracts
  available yet. New work is coming soon.", the handle escaped. A root's `index.html` never
  replaces a board. Another path is a file from the box's empty web root, so a 404; a POST is the
  usual 405. No handle on the second read is `host_unreachable`; a failed read is a 500
  `board_lookup_failed` with no log line.
- **The log line names the board read.** Every address lands on one box and one `access.log`, so
  there the request is recorded in absolute form, `"GET http://194.12.40.7/ HTTP/1.1"`, with the
  reader's address in front. `loggedRequestPath` (`core/hireme/boards.ts`) holds the rule, and
  both the fetch and a `gobuster` sweep use it. A root reading the log sees each board read and
  where from, including a read from somewhere its owner never was.
- **The two boxes fall apart.** A dark or bricked hireme.io stops only new applications; a dark
  or bricked boards' server leaves every board unreachable while hireme.io still takes
  applications.

## 5. What a root finds

- **On the boards' server**, `/etc/hireme/boards`: one `<handle> <address>` line per board in the
  order they were applied for, built from `hireme_boards` on each read (`withBoardsList`,
  `core/hireme/boards.ts`) and laid into the box by `resolveCrossPlayerFs` before the journal is
  replayed, as emailit.io's mail view is. A root who rewrites or removes it changes what the next
  root reads and nobody's board. It is read for a root session there alone: below root the table
  is not read and nothing of it reaches the wire; a failed read is a 500 `boards_lookup_failed`,
  never an empty file. Rooting this box is the way to everyone's board at once; reading one inbox
  is the way to one.
- **On hireme.io**, nothing special: who applied is only in the table, so the boards' server is
  the one prize.
- **Working from the boards' server traces as `unknown`** in other boxes' logs, as from any box
  with no public address of its own: it answers at 16.7M addresses and none is its own.
- **Both boxes are rooted only by a root-tier CVE** on `:80` or `:22`, as every fixed site is.

## 6. The operator

`scripts/restoreSite.ts <name>` looks a fixed box up by its key (`fixedSite()`): a site's key is
its domain, and the boards' server's is `boards.hireme.io`, the only name it has. A restore ends
every session on the box, empties its journal and writes a fresh boot marker; the boards' list,
like every board, is built from the table again, and `hireme_boards` is never touched. The usage
line lists every name.

## 7. The bundle

The client carries the hireme.io row, its front page, the reserved name, the block in
`isPublicIp`, the `whois` record, the boards' server's row and its empty `/etc/hireme`; the
application rules, the pages answered by functions, the mail, the lookup and the list are built on
the server only. The epic added 409 B in all (234, 148 and 27), to 285,770 B of the 286,975 B
ceiling at v0.422.0, with no raise.

## 8. Proving it

- **Unit**: the application rules over a fake store and a scripted draw, including five
  collisions in a row (`apply.test.ts`); the pages (`pages.test.ts`); the lookup, the absolute log
  path and the list (`boards.test.ts`); the block (`ip.test.ts`, `whois.test.ts`); both boxes
  (`fixedSiteFs.test.ts`); the dispatch (`resolveHttpFetch.test.ts`,
  `resolveHttpSweep.test.ts`); the root view (`resolveCrossPlayerFs.test.ts`).
- **Wire-checks** (vs `vercel dev` + local supabase): `scripts/testHireme.ts` (21: applying, the
  refusals, the window, the same address after 24 hours, a full inbox, collisions, the log);
  `scripts/testHiremeBoard.ts` (15: the board, two handles, an unheld address against an empty
  193 one to `curl`, `nmap` and `ssh`, the log lines, a planted `index.html`, the two boxes
  falling apart); `scripts/testHiremeBoardRoot.ts` (13: the root view, lower tiers, a root's
  rewrite, the restore by key); `scripts/testRestoreSite.ts hireme.io`.
- **Mutation**: every slice's scoped run left no survivor but equivalents.
- **One browser run at the epic's close-out** (2026-10-21, v0.422.0, game day 101), two players
  in headed browsers. alice signed up on emailit.io, applied from `lynx hireme.io` with the bare
  handle, read the mail and opened her board in `lynx`; `whois` gave the block's record for her
  address and an unheld one. bob opened the leaked address and saw alice's board; the next
  address was refused; `nmap -sV` showed `http` and `ssh`. No release on day 101 had a root-tier
  hole, so the root view rests on its wire-check; a staged nginx manifest gave bob a user-tier
  shell, where `/etc/hireme` was hidden and `access.log` showed both board reads, alice's and
  his. `restoreSite.ts boards.hireme.io` closed bob's shell ("Connection to ap-gw closed by
  remote host."), the staged version was gone and alice's board still answered. No defect; a
  shell on any fixed site prompts `root@ap-gw`, a known cosmetic issue
  (`e2e-shared-network-verification.md`).

## What missions add

Left for the missions grill, on top of this without changing the machines, the addresses or the
lookup: job templates and per-handle instances (a table keyed by handle, so a job a player
completes leaves their board, not anyone else's); how a job is claimed and completed, and whether
somebody holding a leaked address can claim one; the wallet and payout step (the operator mint);
and what the root view adds. A second, darknet operator stays open as later content.

## Key files

- **Server**: `supabase/migrations/20261020020000_hireme_boards.sql`; `api/network.ts` (`apply`,
  `drawBoardAddress`, `findBoardHandle`, `findBoards`) and `api/sessions.ts` (the lookup at each
  door).
- **hireme**: `core/hireme/` — `apply.ts`, `pages.ts`, `boards.ts`.
- **Wiring**: `core/network/resolveHttpFetch.ts` (the `/apply` and board dispatch),
  `core/network/resolveHttpSweep.ts`, `core/network/resolveCrossPlayerFs.ts` (the list),
  `core/generation/fixedSites.ts`, `core/generation/fixedSiteFs.ts`, `core/generation/world.ts`,
  `core/generation/ip.ts`, `core/commands/whois.ts`, `core/emailit/signup.ts`
  (`RESERVED_HANDLES`), `core/emailit/mailrc.ts` (`typedAddress`).
- **Operator**: `scripts/restoreSite.ts hireme.io`, `scripts/restoreSite.ts boards.hireme.io`.
