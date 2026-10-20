# Plan: applying for contract work, at hireme.io

**Status**: Grilled and sliced. Decisions confirmed by the owner 2026-10-20. No slice is planned
yet; slice 1 is next.
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
