# Plan: applying for contract work, at hireme.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-20. Slice 1 shipped
(v0.420.0, PR #719, 2026-10-20; migration on `jshack-dev` and `jshack-prod`). Slice 2, the board
answers, shipped (v0.421.0, PR #721, 2026-10-21; no migration). Slice 3, a root on the boards'
server, shipped (v0.422.0, PR #722, 2026-10-21; no migration). All three slices are in, and
the epic's browser run passed (2026-10-21, v0.422.0, below); the close-out moving this file's
content into `docs/` is next.
Where another doc disagrees with this file, this file wins until the close-out moves its content
into `docs/`.

## Goal

The front door for missions, built before missions exist. A player applies at a public site with
their emailit.io address and is mailed a private address of their own; `curl` or `lynx` on that
address opens their contractor board. Each player's board will list their own jobs (a job a player
completes leaves their board, not anyone else's), so the board is per player from the start. Until
missions are designed the board says so. Origin: `docs/email-architecture.md` ("a later job site
will take a player's address and mail them a private address to open with `curl` or `lynx`") and
"A jobs board" under "More public websites" in `docs/backlog.md`.

## Where it starts from (facts, 2026-10-20)

- **A fixed site is a row.** Adding one to `FIXED_SITES` (`generation/fixedSites.ts`) gives it a
  box with `http` and `ssh`, a public address, a findit listing and operator restore
  (`scripts/restoreSite.ts <domain>`, which finds the site by its domain). Its address is the next
  placeless one after talkit's (`generation/world.ts`, `ADDRESS_BY_KEY`), so nobody's moves.
- **Every public address today is derived, never stored.** `publicAddress(key)` and its inverse
  `networkAt(address)` place every network by its position in the world: towns in the region
  block (`87.x`), findit, the corporations and the fixed sites in the placeless block (`193.x`).
  No other first octet is used. `isPublicIp` (`generation/ip.ts`) knows only those two, and every
  command that reaches across networks (`curl`, `lynx`, `nmap`, `ssh`, `nc`, `ftp`, `scp`,
  `gobuster`, `mysql`, `redis-cli`) uses it to route a target to the server.
- **The server finds what stands at a public address through one injected lookup**,
  `findNetworkByPublicIp`, which every caller wires to `derivedNetworkByPublicIp`
  (`network/resolvePublicTarget.ts`; `api/network.ts`, `api/sessions.ts`). It is already shaped
  as an async lookup that may read a table, which is where an address that is stored, not derived,
  can be answered.
- **`whois` is client-side** (`commands/whois.ts`, over `networkAt`), so it cannot know which
  addresses in a block have been handed out.
- **Some paths answer from a function, not a file**: findit's `/?q=`, emailit's `POST /signup`,
  chainit's views, talkit's `/threads`, `/thread` and its POSTs (`network/resolveHttpFetch.ts`).
  A root defaces the files but cannot forge what a function answers.
- **System mail exists.** emailit's sign-up delivers a welcome from `noreply@emailit.io`, an
  address nobody can log in to; system mail is always delivered, even to a full inbox, and a reply
  to it bounces (`docs/email-architecture.md` §4). Players mail `@emailit.io` addresses only.
- **emailit.io's root view is the model for a table-built view**: files built from the tables on
  each read, laid under the box's journal, so a root's edits land in the journal and the tables
  never change; `restoreSite.ts` wipes the journal (`docs/email-architecture.md` §6).
- **The main bundle has 1,614 B left** under the fixed 286,975 B gzipped ceiling (v0.419.0,
  `scripts/checkBudgets.ts`). Content the browser builds counts; content the server answers does
  not. The code part was raised once, by 2,000 B, for talkit.

## Decisions (owner-confirmed 2026-10-20)

1. **A private address belongs to an emailit.io handle**, never to the player's game key. The job
   site knows only the address it was given, and whoever holds a handle's password owns the
   handle, so whoever reads `neo`'s mail gets `neo`'s board. Rejected: keying on the game key (the
   email becomes a mere delivery channel, and one player with three handles needs a rule).
2. **The address is the key.** Whoever has it sees the board; there is no login. It leaks the ways
   anything leaks: a read inbox, a `~/.bash_history` holding `lynx <address>`, a talkit post.
   Rejected: the address plus the handle's password (the address stops being a secret, and the
   per-player address adds little over one shared board behind a login).
3. **One handle, one address, for good.** Applying again re-sends the same address. A leaked
   address stays leaked; guarding the mail is the only defence. Rejected: rotating on re-apply (a
   recovery after a leak, but a thief holding the mail login rotates too), and a new address each
   time with the old ones kept (no value, and addresses pile up).
4. **Addresses are random, drawn on the server and stored**: `(handle, address)`, both UNIQUE,
   from a reserved block, a whole first octet the world uses for nothing else (about 16.7M
   addresses, so guessing one blind with `curl` is hopeless). The draw is redone on a collision, the
   win-or-read pattern of the retired `allocatePublicIp`. An address in the block that nobody holds
   answers as nothing at all, the same as any empty address, so a wrong guess gives no signal.
   Rejected: deriving it from the handle with a server secret (the row is needed anyway for the
   lookup and the root view, and the secret is one more thing to operate).
5. **Two machines.** The owner's reason: a broken application site must not take players' boards
   down with it.
   - **`hireme.io`** is a public fixed site, listed on findit, with a domain. It takes applications
     and nothing else. Dark or bricked, only new applications stop.
   - **The board server** has no domain and no listing. Every private address lands on it, and
     each serves that handle's board, built from the tables. It is found only through an address
     somebody holds; bricked, every board is dark until the operator restores it.
   Rejected: one machine for both (the box everyone can find would take every board down with it).
6. **Jobs will belong to the handle, and the address is only the handle's door.** A request to a
   private address looks up the handle that holds it, then builds that handle's board: later, the
   job templates less what that handle has completed. Missions add a table keyed by handle; the
   machines, the addresses and the lookup do not change.
7. **The operator is a neutral contractor agency at `hireme.io`**: freelance contracts for
   independent IT and security people, respectable enough that both white-hat and greyer jobs fit
   later. The name breaks the `-it.io` pattern on purpose: you find it and email it, but you do not
   hire an "it", and "hire me" is what an applicant says. `whois` on any address in the board block
   names the agency's back office: it answers for the whole block, held or not, as a real `whois`
   answers for a netblock, so it leaks nothing. Rejected: an openly shady broker (rules out
   white-hat jobs on the same board); a second, darknet operator stays open as later content.
8. **The application asks for the email address only**: `curl -d "email=neo@emailit.io"
   http://hireme.io/apply`, or the same form in lynx. Nobody proves they own the address, because
   the private address only ever goes into that inbox: applying "as neo" mails neo their own
   address. The wallet to be paid in is a mission-time question, so payment will follow whoever
   completes the job and names a wallet. Rejected: a wallet on the application (payouts stuck to the
   applicant, and a "change my wallet" rule).
9. **One application mail per handle per 24 hours.** A repeat inside the window answers "We already
   have your application. Check your inbox." and sends nothing. It is held per handle, not per
   player, because system mail ignores the 100-message inbox cap, and only a per-handle limit stops
   a crowd burying one inbox. An address that is not `@emailit.io`, or a handle with no account, is
   refused in red under the field (`<p role="alert">`), as emailit.io's sign-up refuses. Rejected:
   a per-player cap (each attacker limited, the victim not), and both (handle probing is already
   free through emailit's sign-up).
10. **The mail comes from `jobs@hireme.io`**, a system sender: always delivered, nobody can log in
    to it, a reply bounces. Subject `Your hireme.io application`; the body thanks the handle by name
    and gives the address and how to open it (`lynx http://<address>/` or `curl`). **No warning to
    keep it private**: the player learns it was a secret when somebody else turns up on their board.
11. **The board says whose it is, then that there is no work yet.** "Welcome back, neo." on top,
    and under it "Contractor board — no contracts available yet. New work is coming soon." A leaked
    address carries the handle it belongs to. Rejected: the placeholder alone, and empty mission
    sections laid out before missions are designed.
12. **What a root finds.**
    - **The board server** runs `http` and `ssh` like every fixed site, with the same seeded
      versions and CVE exposure, so there is a way in. Its root-only `/etc/hireme/boards` holds one
      line per applicant, `neo 194.12.40.7`, built from the table on each read and laid under the
      journal: a root can rewrite or wipe it and the next root sees that, but the table never
      changes, so nobody's board moves. Its `access.log` records each board read with the reader's
      address, so a root sees a board read from somewhere its owner never was.
    - **hireme.io** has no special view. Its `access.log` shows `POST /apply`, never the body, as
      emailit.io's `/signup` does. Who applied is only in the tables, so the board server is the one
      prize.
    - Both are restorable by the operator; the board server has no domain, so `restoreSite.ts` must
      be able to name it some other way.
    Rejected: no root view (nothing worth breaking in for), and application times and job state in
    the view (the missions grill adds what there is to show).
13. **Server-side first for the bundle.** The board page is built per handle on the server, so its
    text never reaches the client; hireme.io's pages and refusals are built there too where they
    can be. If the client still has to grow past the 1,614 B left (the new block in `isPublicIp`,
    `whois`, a second box's services), the code part of the ceiling rises by what is measured,
    rounded up, with the reason beside the constant, as talkit's did. Rejected: a hard ceiling with
    content trimmed to fit, and a round raise taken up front.
14. **Three slices, one browser run at the close-out.** Each slice with an `api/` change carries
    its wire-check against `vercel dev` + supabase; a migration goes to `jshack-dev` then
    `jshack-prod` before merge.
    1. **A player applies**: the `hireme.io` fixed-site row, its front page with the form and the
       `curl -d` recipe, and its findit listing; the applications table and its migration; `POST
       /apply` with the refusals, the per-handle 24-hour window, the address drawn and stored, and
       the mail from `jobs@hireme.io`. Between slices 1 and 2 the mailed address answers nothing.
    2. **The board answers**: the reserved block in `isPublicIp` and `whois`; the table lookup
       behind `findNetworkByPublicIp` for an address in the block; the board server box with `http`
       and `ssh` and its `access.log`; the board page, "Welcome back" and the placeholder.
    3. **A root on the board server**: `/etc/hireme/boards` built from the table under the journal,
       and operator restore for a box with no domain.

## Browser run (2026-10-21, v0.422.0, game day 101): passed, no defect

Two players in headed browsers against `vercel dev` + local supabase.

- **alice**, on `APERTURE-WIFI` (`193.201.183.142`): signed up as `alicek` with `curl -d`, then
  `mail login`; in `lynx hireme.io` typed the bare handle `alicek` into the form and submitted.
  The page answered "Thanks, alicek. We have sent your contractor board to alicek@emailit.io."
  with no address on it. `mail` listed `jobs@hireme.io` / `Your hireme.io application`;
  `mail read 2` gave `http://194.100.69.23/` and the `lynx` line. `lynx http://194.100.69.23/`
  showed "Welcome back, alicek." and the placeholder. `whois` on her address and on an unheld
  `194.1.2.3` printed the same `HIREME-BOARDS` record.
- **bob**, on `GROUND-ZERO-COFFEE` (`87.1.37.73`): `lynx` on the leaked address showed alicek's
  board; `curl` on the neighbouring `194.100.69.24` was refused; `nmap -sV` showed `http`
  (nginx 1.26.0) and `ssh` (OpenSSH 9.7.0).
- **No root on the boards' server today.** Neither service has a root-tier hole on day 101, so
  the root view is proven by `testHiremeBoardRoot.ts` (13/13), as the runbook directs. To show a
  shell in the browser, nginx 1.28.3 was staged by one service-role manifest row (a user-tier
  full shell that day); `msfconsole 194.100.69.23 80` landed. There `cat /etc/hostname` read
  `boards`, `ls /etc` listed no `hireme`, `cat /etc/hireme/boards` was "No such file or
  directory", and `cat /var/log/access.log` showed both reads,
  `193.201.183.142 … "GET http://194.100.69.23/ HTTP/1.1" 200` and the same from `87.1.37.73`:
  a board read from somewhere its owner never was.
- **The operator restore**: `restoreSite.ts boards.hireme.io` closed 1 session and removed 4
  rows; bob's next command printed "Connection to ap-gw closed by remote host."; a rescan showed
  nginx 1.26.0 again; alice's `curl` still got her board, and her `hireme_boards` row was
  unchanged.
- **Known, not this epic's**: a shell on any fixed site or gateway prompts `root@ap-gw`, since the
  prompt names a box by its machine id's leading half (recorded in
  `docs/e2e-shared-network-verification.md`).

## Follows from the decisions

- **Rooting the board server is the way to everyone's board at once**, and later to everyone's
  jobs; reading one inbox is the way to one. Both are wanted.
- **A fixed site's root is uncrackable**; the way into either box is a root-tier CVE, as for the
  other six.
- **Left for the missions grill**: job templates and per-handle instances, how a job is claimed and
  completed (and whether somebody holding a leaked address can claim one), the wallet and payout
  step (the operator mint, per `docs/backlog.md`), and what the root view adds.
- **Open for slice plans, not the owner**: the block's first octet (anything but `87` and `193`;
  `194` is the working choice), the board server's key and hostname, the table's name, the exact
  page wording beyond decisions 10–11, and whether a bare handle in the form means `@emailit.io`
  as it does for `mail send`.

## Slice 1 plan: a player applies

**As built (v0.420.0, PR #719).** All 14 criteria met. Unit tests at the rules, the pages, the
site row and the dispatch; `scripts/testHireme.ts` 21/21 and `testRestoreSite.ts hireme.io` 13/13
live. hireme.io is at `193.72.191.97`. The bundle grew 234 B, to 285,595 B of 286,975 B.
Mutation: `apply.ts` 79 killed + 1 timeout, dispatch 27/27; `pages.ts`'s 12 survivors are static
mutants (five killed by hand, seven closing tags the HTML parser restores). The gate found the
`no_mailbox` tests never reached the store (`nobody` is a reserved username) and fixed them.

**Branch**: `feat/hireme-apply` · **Version**: 0.419.0 → 0.420.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; one migration, applied to `jshack-dev` then `jshack-prod`
before merge.

**Value.** A player opens `hireme.io` in lynx or curl, applies with their emailit.io address, and
finds a mail from `jobs@hireme.io` in their inbox holding a private address that is theirs for
good. The address answers nothing until slice 2.

**Path.** `lynx`/`curl -d` → the signed `resolveHttpFetch` → `handleResolveHttpFetch` resolves
`hireme.io`'s address to its one box, as for every fixed site → a POST to `/apply` on hireme's
network is answered by a function: the form is read, the store is asked to apply (draw-or-read
the address, the 24-hour window, the mail, in one transaction) → a page answers → the hit is a
`POST /apply` line in hireme's `access.log`, without the body.

### Facts read while planning (2026-10-20)

- **emailit's `/signup` is the template** (`network/resolveHttpFetch.ts`): a POST whose target's
  ESSID and path match is answered by `answerSignup` (`emailit/signup.ts`), which decodes the form
  with `URLSearchParams`, refuses through the front page with a `Refusal` said under a line, and
  reads the store's word with a zod enum; a store that fails or answers an unknown word is a 500
  `signup_failed` with no log line. The front page is also planted at `/signup`, so going back
  after a submit re-fetches the form and never resends it.
- **`email_signup` delivers a system mail in SQL**: it inserts into `email_messages` at the
  account's `next_number` and bumps it, in the same transaction, under an advisory lock
  (`20261014000000_email.sql`). The 100-message cap lives in `email_send`, so a function that
  inserts on its own ignores it, as system mail must.
- **`handleOf` (`emailit/mailrc.ts`) is an address's emailit handle or null**; `mail` turns what
  was typed into an address with its private `typedAddress` (trimmed, lowercased, a bare handle
  means `@emailit.io`, `commands/mail.ts`).
- **A reply to `jobs@hireme.io` already bounces**: `mail` refuses any domain but emailit.io
  (`unknown domain`) before nano opens.
- **These follow from a fixed-site row, unchanged** (talkit and chainit found the same): the
  findit listing (findit crawls the front page and reads its meta description), `whois`, the
  persona, the box's hostname and `scripts/restoreSite.ts`. A site's static files are its entry
  in `WEB_ROOTS` (`generation/fixedSiteFs.ts`).
- **`RESERVED_HANDLES`** (`emailit/signup.ts`) holds the system names nobody may sign up as.

### Choices made while planning (owner to confirm with the plan)

- **No page ever shows the address.** Success reads "Thanks, neo. We have sent your contractor
  board to neo@emailit.io." Anyone may apply for any handle (decision 8), so a page that showed
  the address would hand neo's board to whoever typed `neo`. The "already applied" answer shows
  nothing of it either.
- **The form reads the address as `mail` does**: trimmed, lowercased, and a bare handle means
  `@emailit.io`. `typedAddress` moves from `commands/mail.ts` to `emailit/mailrc.ts` beside
  `handleOf`, so the two cannot drift. This settles the last open item above.
- **Refusals, each a `<p role="alert">` under its line, the address kept as typed**: nothing
  typed, "Enter your emailit.io address" (under the field); another domain, "Only emailit.io
  addresses can apply" (field); a handle no account holds, "No such mailbox" (field), whether the
  shape is impossible or the store has no account; inside the window, "We already have your
  application. Check your inbox." (under the button, as emailit's cap is, since no field is
  wrong).
- **One table, `hireme_boards`**: `handle` (primary key, references `email_accounts`), `address`
  (UNIQUE, CHECKed to `194.<0–255>.<0–255>.<2–254>`, the fourth octet as every address in the
  world), `applied_at` and `mailed_at`. RLS on, no policies. Decision 4's "both UNIQUE" is the
  primary key and the UNIQUE.
- **One function, `hireme_apply(handle, candidate_address, sender, subject, body)`, answering a
  word**, everything that must be atomic under a lock on the handle (as built: the applicant's
  `email_accounts` row `FOR UPDATE`, as `email_send` locks a recipient's): `no_mailbox` (no
  account), `recent` (mailed inside 24 hours; nothing written), `collision` (the handle has no
  board and the candidate is somebody else's; nothing written), `sent` (the board read, or
  created at the candidate; `mailed_at` set; the mail delivered as the next message). The body
  arrives with `{address}` where the address goes and the function puts the board's own address
  there, so a re-sent mail names the address held, never the fresh candidate. A handle holds no
  braces, so nothing typed can become the placeholder.
- **The draw is the caller's, injected**: `api/network.ts` draws `194.<0–255>.<0–255>.<2–254>`
  with `node:crypto`'s `randomInt`; `core/hireme/` takes a `drawBoardAddress` function, so the
  rule is tested with a scripted draw. On `collision` the caller draws again, up to 5 times, then
  answers 500 `apply_failed` with no log line (at about 16.5M addresses a collision is a test's
  event, not a player's).
- **The mail**, from `jobs@hireme.io`, subject `Your hireme.io application`:

  ```
  Thanks for applying, neo.

  Your contractor board is at http://{address}/

  Open it with lynx or curl:

    lynx http://{address}/

  -- hireme.io
  ```

- **The row**: key and domain `hireme.io`, hostname `hireme`, place
  `{ category: 'hacker', place: 'the hiring hall' }`, last in `FIXED_SITES`, its address
  `placelessAddress(6 + …)` after talkit's. `hireme` joins `RESERVED_HANDLES`, as `talkit` did,
  so nobody signs up as `hireme@emailit.io` to pass for the agency.
- **The front page**: `<h1>hireme.io</h1>`, "Freelance contracts for independent IT and security
  people. Apply with your emailit.io address and we will send you your contractor board.", the
  form (one `email` field, `[ Apply ]`), and the recipe in a `<pre>`:
  `$ curl -d "email=neo@emailit.io" http://hireme.io/apply`. Title `hireme.io - contract work`;
  meta description "Freelance contract work for independent IT and security people. Apply with
  your emailit.io address." It is planted at `index.html` and `apply`, as emailit's is at
  `signup`.
- **Bundle:** the row, the front page and the reserved name are client bytes; the answer pages,
  the rules and the mail text are server-only. Measured at increment 3; decision 13 governs a
  breach.

### Acceptance criteria

1. `curl http://hireme.io/` prints the front page: title, meta description, the `<h1>`, the
   paragraph, the form and the `curl -d` recipe; `lynx hireme.io` shows the form. A GET of
   `/apply` is the same page.
2. A findit search for `contract` or `hireme` lists `hireme.io` with its description;
   `whois hireme.io` answers; its address is in the 193 block and no other network's address
   changed.
3. `curl -d "email=neo@emailit.io" http://hireme.io/apply` for an existing `neo` answers "Thanks,
   neo. We have sent your contractor board to neo@emailit.io.", and the page holds no `194.`
   address. `neo`'s inbox then has, as its next message, a mail from `jobs@hireme.io` with
   subject `Your hireme.io application` and the body above with a `194.x.y.z` address in it.
4. `email=Neo`, `email= neo ` and `email=NEO@EMAILIT.IO` all apply for `neo`.
5. Inside 24 hours of the last mail, applying for `neo` again answers "We already have your
   application. Check your inbox." under the button, sends nothing and changes nothing.
6. After 24 hours, applying again mails the SAME address, never a new one.
7. A full inbox (100 messages) still receives the application mail.
8. `email=` refuses "Enter your emailit.io address"; `email=neo@gmail.com` "Only emailit.io
   addresses can apply"; `email=nobody` (no such account) and `email=a!b` "No such mailbox";
   each as an alert under the field with the address kept as typed, and none writes anything.
9. Two handles applying get different addresses; a drawn address another handle holds is drawn
   again and the applicant still gets a board of their own; five collisions in a row are a 500
   with nothing logged and nothing written.
10. Every `/apply` POST is a `POST /apply` line in hireme's `access.log` with the visitor's
    address and never the form; a 500 logs nothing.
11. A reply from `mail` to `jobs@hireme.io` is refused `unknown domain`.
12. `hireme` cannot be signed up for at emailit.io ("a reserved system name").
13. A hireme.io whose web server is stopped, or whose box is bricked, takes no applications;
    `restoreSite.ts hireme.io` brings it back and the `hireme_boards` rows are untouched. A
    root's rewritten `index.html` is served at `/` while `POST /apply` still works.
14. Every other fixed site and path is served as before; emailit's sign-up and `mail` behave as
    before; the bundle check passes.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The application's rules** (`core/hireme/apply.ts`): read the form, refuse, ask the store
   with a drawn candidate, redraw on `collision`, map each word to its page; criteria 3–5, 8
   and 9 at the function with a fake store and a scripted draw. `typedAddress` moves to
   `mailrc.ts` (mail's tests stay green).
2. **hireme's pages** (`core/hireme/pages.ts`): the front page with a refusal under its line,
   and the thanks page; criteria 1, 3, 5 and 8 at the page, including that no page holds the
   address.
3. **hireme.io is a fixed site**: the row, its address, `WEB_ROOTS`, `hireme` reserved;
   criteria 2, 12 and 14 in the `fixedSiteFs`, `webIndex`, `world`, `whois` and `signup` tests;
   the bundle measured.
4. **The fetch takes the form**: an `apply` dep in `ResolveHttpFetchDeps` and the dispatch
   beside emailit's; criteria 3, 10 and 13 at the handler with fake deps.
5. **The migration, the adapter and the wire-check**: `hireme_boards` and `hireme_apply` to
   `jshack-dev`; the RPC and the draw in `api/network.ts`; a new `scripts/testHireme.ts`
   (criteria 3–11 live: 6 by moving `mailed_at` back with the service role, 7 by filling an
   inbox, 9 by calling `hireme_apply` directly with an address another handle holds, since the
   server's draw cannot be predicted; five collisions in a row are unit-tested), and
   `testRestoreSite.ts hireme.io`.
6. **Docs and version 0.420.0**: `restoreSite.ts`'s comment; the handbook's codebase map and
   glossary; `docs/project-status.md`; the migration to `jshack-prod` before merge.

### Evidence

- Unit and jsdom tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check.
- Wire-check `scripts/testHireme.ts` against `vercel dev` + local supabase, and
  `testRestoreSite.ts hireme.io`.
- Mutation gate at PR readiness over `core/hireme/` and the dispatch.
- No browser run: one at the epic's close-out.

## Slice 2 plan: the board answers

**As built (v0.421.0, PR #721).** All 9 criteria met. Unit tests at the block, `whois`, the
box, the lookup, the page and both handlers; `scripts/testHiremeBoard.ts` 15/15 live, with
`testHireme`, `testHackademy` and `testCrossPlayerRouter` rerun green. The bundle grew 148 B, to
285,743 B of 286,975 B. Mutation: 122 killed, 3 equivalent survivors (two `?? ''` fallbacks, a
`!== null` guard before an `includes`). One addition while building: a `gobuster` sweep of a
board's address logged plain paths, so the absolute-form rule moved into one function,
`loggedRequestPath` (`core/hireme/boards.ts`), that the fetch and the sweep both use; unit-tested
only, since staging a live sweep needs a player standing on a box. `isBoardAddress` lives in
`generation/ip.ts` beside `isPublicIp`, shared by `whois` and the lookup.

**Branch**: `feat/hireme-board` · **Version**: 0.420.0 → 0.421.0 · **Class**: behaviour change
· **Delivery**: one PR against `main`; no migration (the table and its service-role access
exist since slice 1).

**Value.** A player who applied opens the address in their mail with `lynx` or `curl` and finds
their contractor board: "Welcome back, neo." and the placeholder. Any address in the block that
nobody holds answers as nothing, as any empty address does.

**Path.** `lynx`/`curl` on a `194.` address → `isPublicIp` routes it to the server → the signed
`resolveHttpFetch` → `findNetworkByPublicIp` reads `hireme_boards` for that address: held, it is
the board server's network; not held, nothing → the board server's gateway (the box itself) is
materialized, boot- and port-gated as every fixed site → a GET of `/` on the board server is
answered by a function: the handle holding the asked address, then its board page → the hit is a
line in the board server's `access.log`. `nmap`, `ssh` and the other cross-network commands reach
the same box through the same lookup.

### Facts read while planning (2026-10-21)

- **`isPublicIp`** (`generation/ip.ts`) accepts a single address whose first octet is the
  placeless block's (`PLACELESS_FIRST_OCTET`, 193, in `generation/world.ts`) or a region's. Every
  cross-network command and the UI's page fetch (`ui/state.ts`) route on it; nothing client-side
  but `whois` asks *who* is at a public address.
- **`findNetworkByPublicIp` is wired in twelve places**, all to the pure
  `derivedNetworkByPublicIp`: `api/network.ts` (the fetch, the scan, the path sweep) and
  `api/sessions.ts` (nine: ssh and the service gates). `resolvePublicTarget`,
  `resolveWebTarget` and `resolvePublicScan` all take it as a dep, so one composed lookup serves
  every door.
- **A fixed site's box is chosen by key**: `apGatewayFs` (`generation/routerFs.ts`) builds
  `buildFixedSiteFs(site)` for `fixedSite(essid)`; `resolvePublicTarget`'s gateway target takes
  its hostname and "fronts no LAN" from the same lookup; `networkPersona` its place. Listing,
  domain resolution (`publisher.ts`), findit and `restoreSite.ts` read `FIXED_SITES`; the
  placeless address comes from `ADDRESS_BY_KEY`. So a box `fixedSite()` finds but `FIXED_SITES`
  does not hold has a machine, a hostname and a persona, and no address, domain or listing.
- **A fixed site's web root is its `WEB_ROOTS` entry**; with none, `/var/www/html` is empty.
- **The fetch's function-answered paths are matched by ESSID and path** before the file read
  (`network/resolveHttpFetch.ts`), and logged through `logFetch` with the request path as sent.
  An access-log line is `<source> - - [time] "<METHOD> <path> HTTP/1.1" <status> <size>`
  (`logging/accessLog.ts`).
- **Standing on a box with no public address traces as `unknown`**
  (`derivedPublicIpByEssid`), so a root who works from the board server leaves `unknown` in
  others' logs.
- **`hireme_boards` is readable by the service role alone** (RLS on, no policies), which is what
  `api/` uses; a read by address hits the UNIQUE index.
- **Bundle**: 285,595 B of 286,975 B, 1,380 B left (v0.420.0).

### Choices made while planning (owner to confirm with the plan)

- **The block is `194`, declared beside the placeless one**: `BOARD_FIRST_OCTET = 194` in
  `world.ts`; `isPublicIp` accepts it; `api/network.ts`'s draw uses it in place of its literal.
- **The board server is a fixed box nobody lists**: a `FixedSite` value outside `FIXED_SITES`,
  key `boards.hireme.io`, hostname `boards`, domain `hireme.io` (its `/etc/hosts` says
  `boards.hireme.io`, the agency's back office, but no name resolves to it), place
  `{ category: 'hacker', place: 'the back office' }`. `fixedSite(key)` finds it as well, so its
  box, hostname and persona come from the same code as every fixed site's: `http` and `ssh` on
  the seeded versions, an uncrackable root, empty `access.log`, `auth.log`, `kern.log`, and an
  empty web root. It has no 193 address, no domain anybody can `curl`, no findit listing.
- **One lookup for every door**: `core/hireme/boards.ts` exports a lookup built from a
  `findBoardHandle(address)` read: a `194.` address is the board server's network when a handle
  holds it and nothing when none does; any other address is `derivedNetworkByPublicIp`'s answer.
  A failed read is the lookup's error (a 500 `network_lookup_failed`, as today). All twelve
  wirings switch to it, so `curl`, `lynx`, `nmap`, `ssh`, `nc` and the rest agree.
- **The board is answered at `/`**, any query ignored, for a GET only, from a function, as
  talkit's views are: the handle holding the asked address (`payload.target`), then its page. A
  root's `index.html` on the board server never replaces anybody's board. Every other path is a
  file from the board server's disk (empty, so a 404); a POST is the usual 405. If the second
  read finds no handle (the account was deleted between the two reads) the answer is
  `host_unreachable`; if it fails, a 500 `board_lookup_failed` with no log line.
- **The page**: title `hireme.io - contractor board`, `<h1>Welcome back, neo.</h1>`, then
  `<p>Contractor board — no contracts available yet. New work is coming soon.</p>`; the handle
  escaped as on the thanks page. Built on the server only.
- **The log line names the board read**: every address lands on one box and one `access.log`,
  so a line with the path alone would not say whose board was read. On the board server, the
  request is recorded in absolute form, `"GET http://194.12.40.7/ HTTP/1.1"`, as a server logs a
  request that names its host; the line's format is otherwise unchanged. Rejected: the plain
  path (the root sees reads but not whose), and a host column for this one box (a second line
  format to parse).
- **`whois` answers for the whole block**, held or not, from the client alone:

  ```
  inetnum:        194.0.0.0 - 194.255.255.255
  netname:        HIREME-BOARDS
  org-name:       hireme.io
  ```

- **Working from the board server traces as `unknown`**, as from any box with no public
  address; it has 16.7M addresses and no one of them is its own. Left as it is; slice 3, which
  is about a root on this box, may revisit it.
- **Bundle**: the block, the `whois` record and the box's row are client bytes; the lookup, the
  page and the dispatch are server-only. Measured at increment 2; decision 13 governs a breach.

### Acceptance criteria

1. After `neo` applies, `curl http://<mailed address>/` prints neo's board: title, "Welcome
   back, neo." and "Contractor board — no contracts available yet. New work is coming soon.";
   `lynx` shows the same; `/?x=1` is the same page.
2. Two handles' addresses each answer their own handle's board, never the other's.
3. An address in the 194 block that nobody holds answers exactly as an empty 193 address does,
   to `curl`, `lynx`, `nmap` and `ssh`.
4. `nmap` on a held address shows `http` and `ssh` open; `ssh root@<address>` with a wrong
   password is refused as at any fixed site. Every held address reaches the same one box.
5. Each board read is a line in the board server's `access.log` with the reader's address and
   `GET http://<address>/`; a path other than `/` is a logged 404 in the same form; a POST is a
   logged 405; a failed lookup logs nothing.
6. `whois` on any `194.` address prints the block's record; `whois` on every other address and
   domain answers as before.
7. A root's `index.html` on the board server does not change what `/` answers at any address.
8. A bricked board server, or one whose web server is stopped, leaves every board unreachable
   while hireme.io still takes applications; a dark hireme.io leaves every board answering.
9. findit lists nothing new; no network's address, domain or listing changed; every other fixed
   site, path and command behaves as before; the bundle check passes.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The block is public**: `BOARD_FIRST_OCTET`, `isPublicIp`, and `whois`'s block record;
   criteria 6 and the routing half of 3 in the `ip` and `whois` tests.
2. **The board server's box**: the unlisted row, `fixedSite` finding it, its tree (services,
   logs, empty web root, hostname, persona); the listing, address and domain tests prove it
   stays unlisted (criterion 9); the bundle measured.
3. **The lookup**: `core/hireme/boards.ts` over a fake `findBoardHandle`; held, unheld, failed,
   and a non-194 address passed through (criteria 3 and 4 at the lookup).
4. **The board page and the dispatch**: `boardPage(handle)` in `hireme/pages.ts`; a
   `findBoardHandle` dep in `ResolveHttpFetchDeps`; `/` answered from it, the absolute-form log
   line, the 404, 405, `host_unreachable` and 500 arms; criteria 1, 2, 5, 7 and 8 at the handler
   with fake deps.
5. **The adapter and the wire-check**: `findBoardHandle` over `hireme_boards` and the composed
   lookup at all twelve wirings in `api/network.ts` and `api/sessions.ts`; the draw on
   `BOARD_FIRST_OCTET`; a new `scripts/testHiremeBoard.ts` (criteria 1–5, 7 and 8 live: apply,
   read the mail, fetch the board, two handles, an unheld address against an empty 193 one,
   `nmap`, a wrong-password `ssh`, the log lines, a root's `index.html` planted by journal row,
   a bricked board server).
6. **Docs and version 0.421.0**: the handbook's glossary ("Contractor board", now served) and
   codebase map; `docs/project-status.md`; this plan's status.

### Evidence

- Unit and jsdom tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check.
- Wire-check `scripts/testHiremeBoard.ts` against `vercel dev` + local supabase; `testHireme.ts`
  rerun, since its mail now names an address that answers.
- Mutation gate at PR readiness over `core/hireme/boards.ts`, the board page, the dispatch and
  `isPublicIp`/`whois`.
- No browser run: one at the epic's close-out.

## Slice 3 plan: a root on the boards' server

**As built (v0.422.0, PR #722).** All 7 criteria met. Unit tests at the box, `withBoardsList`
and the `resolveCrossPlayerFs` dispatch; `scripts/testHiremeBoardRoot.ts` 13/13 live, with
`testMailSpool`, `testRestoreSite hireme.io` and `emailit.io`, `testHiremeBoard` and `testHireme`
rerun green. The bundle grew 27 B, to 285,770 B of 286,975 B. Mutation: 59 killed, none survived.
One change from the plan: `testRestoreSite.ts` was left as it is, since it assumes a site whose
`/` is a file and whose address is its domain's; the boards' server's restore is checked in
`testHiremeBoardRoot.ts` instead. `FIXED_BOXES` is now exported, for the restore's usage line.

**Branch**: `feat/hireme-board-root` · **Version**: 0.421.0 → 0.422.0 · **Class**: behaviour
change · **Delivery**: one PR against `main`; no migration (the table and its service-role access
exist since slice 1).

**Value.** A player who gets root on the boards' server finds `/etc/hireme/boards`, every
applicant's handle beside their board's address, and so every board at once. The operator can
put the boards' server back with the restore script, as for every fixed site.

**Path.** A root session on the boards' server → the signed `resolveCrossPlayerFs` → the box is
built as today → for a root session on this one machine, the boards are read from
`hireme_boards` and laid in as `/etc/hireme/boards` → the journal is replayed over it → the
tree is pruned to the tier and sent. The operator runs `restoreSite.ts boards.hireme.io`.

### Facts read while planning (2026-10-21)

- **emailit's view is the template** (`network/resolveCrossPlayerFs.ts`): a dep,
  `findMailSpool`, is asked only when the machine is emailit's and the session is root; a failed
  read is a 500 `mail_spool_lookup_failed`, never an empty view; the files are laid in by a pure
  `withMailSpool(box, accounts)` (`emailit/spool.ts`, over `withFiles`) before
  `materializeMachineFs` replays the journal. Below root nothing is read, and the root-only
  directory is pruned before the wire.
- **emailit's box is born with an empty root-only `/etc/emailit`** (`generation/fixedSiteFs.ts`,
  `keepsMail`), so the directory is there even when nobody has signed up.
- **`restoreSite.ts` finds a site with `FIXED_SITES.find(domain)`**, and `testRestoreSite.ts`
  likewise, reaching it at `siteAddress(domain)`. The boards' server is outside `FIXED_SITES`,
  and its domain is hireme.io's, so neither can name it today. `fixedSite(key)` finds both kinds
  of box, and every listed site's key is its domain.
- **The adapter reads with the service role** (`api/network.ts`, beside `findMailSpool`), which
  is what `hireme_boards` allows.

### Choices made while planning (owner to confirm with the plan)

- **The file**: `/etc/hireme/boards`, root-only (`ROOT_FILE`) in a root-only `/etc/hireme`
  (`ROOT_DIR`) the box is born with, one line per board in the order they were applied for,
  `neo 194.12.40.7`, and empty when nobody has applied. Built by a pure `withBoardsList(box,
  boards)` in `core/hireme/boards.ts`, beside the lookup.
- **Read only for a root session on the boards' server**: a `findBoards` dep in
  `ResolveCrossPlayerFsDeps`; a failed read is a 500 `boards_lookup_failed`, never an empty file.
  A root who rewrites or removes the file changes what the next root sees and nobody's board.
- **The restore takes a box's key**: `restoreSite.ts <name>` looks the name up with
  `fixedSite()`, so `boards.hireme.io` names the boards' server and every domain used today
  still works unchanged. The usage line lists every name. No new flag.
- **Working from the boards' server still traces as `unknown`**, as slice 2 left it: the box has
  16.7M addresses and none is its own, and a root there is meant to be hard to trace.
- **No new client bytes** beyond the empty `/etc/hireme` on the box; the file is built on the
  server only.

### Acceptance criteria

1. A root session on the boards' server reads `/etc/hireme/boards`: one line per applicant,
   `<handle> <address>`, in application order; an empty file when nobody has applied.
2. A `user` or `guest` session there sees no `/etc/hireme`, and no board is read from the table
   for it; no other box has `/etc/hireme`.
3. A root who rewrites or deletes the file sees that on the next read, and so does the next root;
   every board still answers at its address for its handle.
4. A failed read of the boards is an error to the caller, never an empty file.
5. `restoreSite.ts boards.hireme.io` closes every session on the boards' server, empties its
   journal and leaves one fresh boot marker; the file is built from the table again and every
   board answers; `hireme_boards` is untouched.
6. `restoreSite.ts <domain>` for every listed site behaves as before; an unknown name is refused
   before anything is touched, and the usage line names the boards' server.
7. emailit's view and every other box read as before; the bundle check passes.

### Increments (each RED → GREEN → REFACTOR; commit on approval)

1. **The box keeps an empty `/etc/hireme`**: the boards' server's tree, root-only, and no other
   box; criterion 2's pruning half in `fixedSiteFs.test.ts`.
2. **The view**: `withBoardsList` in `core/hireme/boards.ts`; criteria 1 at the function.
3. **The read lays it in**: the `findBoards` dep and the root-only dispatch in
   `resolveCrossPlayerFs`; criteria 1–4 at the handler with fake deps.
4. **The adapter, the restore and the wire-checks**: `findBoards` over `hireme_boards` in
   `api/network.ts`; `restoreSite.ts` by key; `testRestoreSite.ts` able to take
   `boards.hireme.io` (reaching it at an address a seeded handle holds); a new
   `scripts/testHiremeBoardRoot.ts` for criteria 1–5 live, with a seeded root session as
   `testMailSpool.ts` does; `testMailSpool`, `testRestoreSite hireme.io` and `testHiremeBoard`
   rerun.
5. **Docs and version 0.422.0**: `restoreSite.ts`'s comment; the tier-read audit's footnote;
   `docs/cross-player-architecture.md`; the handbook glossary ("Boards' server"); the e2e
   fixed-sites reference; `docs/project-status.md`; this plan's status.

### Evidence

- Unit tests under `npm test`; `npm run typecheck`; `npm run lint`; the bundle check.
- Wire-checks `scripts/testHiremeBoardRoot.ts` and `testRestoreSite.ts boards.hireme.io`
  against `vercel dev` + local supabase, with the reruns above.
- Mutation gate at PR readiness over `core/hireme/boards.ts` and the `resolveCrossPlayerFs`
  dispatch.
- No browser run in the slice: the epic's close-out run follows it.
