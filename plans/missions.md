# Plan: missions

**Status:** Slices 1 and 2 shipped and deployed. Slice 1 is v0.438.0, PR #746, merged
2026-11-01. Slice 2 is v0.439.0, PR #747, merged 2026-11-03. Slice 2's migration
(`20261102000000_hireme_contracts.sql`) is on `jshack-dev` and `jshack-prod`, and no account on
either holds a client handle. **Next: slice 3, planned below** (the client pays: the key mailed
to the client's handle, the reply, the mint), on `feat/missions-client-pays`.

Missions are the one legacy system v2 has not rebuilt. The groundwork is built: wallets and the
operator mint, emailit.io, the hireme.io contractor boards (every board saying no work is
available yet), valleynews, talkit, and rideit's fares as something to spend JSC on. This grill
decides what a job is, where it runs, how it is claimed, completed, verified and paid. The open
questions it started from are in `docs/backlog.md` under "hireme — the missions it waits for";
legacy's design, scenarios and known problems are in `docs/mission-ideas/`.

---

## Grill record

1. **A job runs on its own generated network, not on the shared world (2026-10-31).** Each
   mission is a network generated from a seed, so the same seed always generates the same
   mission. The owner kept this from legacy on purpose: a seed can be shared. The mission's public
   address derives from its seed as well, and the network is **persistent and shared**: what one
   player changes there stays, and another player who is given the address (or the seed) finds
   the network as the first one left it. A second world engine is accepted, on the condition that
   it does not repeat legacy's known problems (`docs/mission-ideas/mission-loop.md` §7): one
   machine structure, not two; mission machines a server-side concept from the start, with the
   journal and the write validation covering them like every other box; an address that never
   shifts with what else exists; a board that cannot break when the generator changes; and
   completion recorded, distinct from abandoning. Rejected: jobs aimed at machines already in
   Harrow Valley (contested by other players and the guardian, no fresh state, CVE windows
   closing under a job).

2. **The seed is the address; missions are templates filled from pools (2026-10-31).** A
   mission's identity is a 24-bit number in a new public block (195), and the address decodes to
   that number, so seed and address map one-to-one, no two missions can share an address, and
   every door finds the network from the address alone. (A readable seed code beside the address
   was proposed here and dropped in decision 17.) The number seeds the PRNG that picks a **template** and fills its details
   from **pools**: two players get missions of the same kinds, differing in the pool draws and
   always at different addresses. **No two players are ever offered the same mission**: the
   server draws a fresh number for each job it posts and records it in the missions table, so the record is of
   who was given what, never of where a network lives. Rejected: free-form seeds hashed into the
   block (collisions by about 5,000 seeds, and a table to settle them breaks "the address comes
   from the seed"); free-form seeds with an address stored on first accept (the address no longer
   comes from the seed). Legacy's keyword seeds are dropped with them: their substring matching was
   a known problem, and a dev who wants given axes searches for a number that has them.

3. **Only accepted missions exist (2026-10-31).** A 195 address nobody was given answers exactly as
   an empty address does, at every door: no reply to a scan, a fetch, `ssh` or any service gate,
   so a wrong guess tells a prober nothing. Every door finds a 195 network through one lookup of
   the missions table, the path `networkByPublicIp` already takes for the 194 boards. Once accepted,
   a mission is reachable by whoever holds its address: the contractor, someone they shared it
   with, or someone who read it where it leaked. Rejected: every 195 address a live network (a
   random sweep finds 16.5M networks nobody was hired for, and the board stops being the way in).

4. **Offers, then accept (2026-10-31).** The board lists offers. Each offer is backed by its own
   number, drawn and reserved for that handle when it is posted, so the client, kind of job and
   pay it shows come from the same template and pool draws as the network (legacy's board drew
   its client separately and disagreed with the mission). An offer never shows the address. The
   player accepts with a form on the board (or `curl -d`, as `/apply` takes), and accepting is the
   moment the network becomes reachable: the briefing, address included, is mailed to the
   handle's emailit.io inbox from the client. So the mailbox holds the targets as it holds the
   board, and an accepted job is a state that completing or dropping it can close. Rejected:
   every posted job live with its address on the board (networks nobody took, and a leaked board
   hands out working targets).

5. **Three offers, one active job, a daily turnover, and dropping keeps the network
   (2026-10-31).** A board shows **3 offers**, one constant the owner expects to raise as more
   mission types arrive and the board needs room to show variety. It does not cap a session: an
   accepted offer's slot fills again the moment that job is completed or dropped, so a player can
   work jobs back to back. A player holds **one accepted job at a time**; accepting another is
   refused under the button ("Finish or drop your current contract first"), so completion is
   never ambiguous about which job it is for. Offers nobody takes are **replaced every 24 hours**
   (the application window's real-time clock); a replaced offer's number is burned and never
   becomes reachable. **Dropping** a job is allowed, is recorded as abandoned (distinct from
   completed) and pays nothing; the network stays reachable, being persistent and shared, and its
   address may already have been passed on. (The owner settled the count; the other three were
   proposed with it and not objected to.)

6. **The first mission type is exfiltrate, a key (2026-10-31).** The client wants a secret, an
   `ACCESS-XXXX-XXXX-XXXX` key in a file somewhere in the network, and the proof is that one
   string. Completion compares it with the mission's key and never reads the network's state, so
   whatever other visitors do to the network cannot break a completion; nearly all of the epic goes
   into the engine and the loop. Because the generator ships in the bundle and the seed is public,
   the key (and every mission secret after it) comes from a **server-only secret**, a keyed hash of
   the seed that the server writes into the file, never from the public PRNG. **File exfiltration**
   (bring a file, a binary, home and send it back from your own mailbox) is a later mission type of
   its own; emailit.io has no attachments today, so it needs a way to carry a file first.
   Rejected for the first type: tamper or deface (verification reads the network's state, which a
   later visitor can undo before the report) and sabotage (bricking the target ends a shared,
   persistent mission for everyone given it).

7. **The proof is mailed to the client, found by its shape (2026-10-31).** The briefing comes
   from the client's address, and the player replies with `mail` in their own words. The server
   reads the mail when it is sent and looks for the two things by their shape, not by a format:
   a key (`ACCESS-XXXX-XXXX-XXXX`) and a wallet address (`jsc` + 40 hex, the ledger's own CHECK),
   in the subject or the body, ignoring case. "here is the key ACCESS-…, pay me at jsc…" works as
   well as two bare lines. A mail with several of either uses the first one found. **Only the
   handle whose accepted job this is gets paid**: a right key from anyone else earns a reply that
   the client has no contract with them. A right key with no wallet in it completes the job and
   pays nothing (the briefing says payment needs a wallet, and nothing warns beyond that). Every
   mail gets an instant, specific reply from the client (a wrong key, a key with no contract), and
   a wrong key costs nothing; retries are unlimited. **The hole stays on purpose**: whoever holds
   a contractor's `~/.mailrc` can mail the client as them and name their own wallet, and the
   payout goes there. Rejected: a form on the board (anyone holding a leaked board address could
   complete someone else's job to their own wallet) and a new command (a bundle change that fits
   the fiction less well).

8. **Exfiltrate pays 500 to 2,000 JSC; no recognition yet (2026-10-31).** One JSC is one dollar
   by design (`wallet-architecture.md`), so pay reads as a real freelance quote. Each template
   carries its own pay range; the offer's pay is drawn from the mission's number and rounded to
   the nearest 50 ("1,350 JSC"), so it comes from the same number as the network. Later, harder
   types get higher ranges of their own. One job pays for 20 to 80 rideit fares, and JSC stays
   loose until something else costs it (`backlog.md`, "anything to spend JSC on"). Recognition,
   the other half of a mission reward the wallet epic deferred, stays deferred: completions are in
   the missions table and nothing else shows them. Rejected: 40 to 80 JSC (a dinner, not a
   contract).

9. **Every mission is solvable by construction: a guaranteed route per hop, from a catalog, among
   decoys (2026-10-31).** A template gives the path's shape (the border box, internal hops, the box
   holding the key). Each hop draws one **guaranteed** way in from a **route catalog**, limited to
   what that hop must yield (a shell, or root where the file is root-only). The catalog is built
   from tools v2 already has: a weak account password (`hydra`); a service pinned to an old
   release whose hole has already published (`nmap -sV`, `msfconsole`); a forgotten web file
   holding a login (`gobuster`, `curl`/`lynx`); anonymous FTP with a careless file (`ftp`); a
   database with weak or no auth and a login in a table (`mysql`, `redis-cli`); a guessable SNMP
   community leaking config (`snmpwalk`); a readable hash cracked offline (`john`); old router
   firmware, then the forward table into the deep layer; a vulnerable library for the last step to
   root (`ldd`, the local exploit). Like mission types, the catalog starts small and grows.
   Pinning to a release whose hole published long ago works because `liveCve` keeps a published
   hole live on every box still on that release, so the route does not depend on the day the job
   is taken and the same seed stays the same mission; the package timeline is the world's, so a
   version's hole is the one players already know. **Decoys** carry the realism of a network
   where not every door opens: a service whose hole has not published, a login nobody can crack,
   an FTP that refuses anonymous. The briefing never names the way in. Whoever roots a hop can
   close its route for later visitors (`apt upgrade`, `passwd`), as anywhere in the world.
   Rejected: missions that may have no way in until a hole publishes (realistic, but an offer that
   cannot be done is a bad offer).

10. **The first slice ships two routes and the smallest shape (2026-10-31).** Routes: a weak
    account password (`hydra`, the crackable pool; the uncrackable pool ships as md5s only, so no
    plaintext reaches the bundle) and a service on an old release with a published hole
    (`msfconsole`, the exploit door as it is). Decoys of the same two kinds: an account nobody can
    crack, a service whose hole has not published. Shape: a **border gateway** at the mission's 195
    address forwarding one port to **one internal box holding the key** in a root-only file, with
    up to two decoy services per box. The routes that leak a working login in a file (web, FTP,
    SNMP, a database row) wait for a second slice: such a file cannot be generated in the bundle
    from the public seed, so like the key it is written by the server from the server-only secret,
    and once that mechanism exists they reuse it. Deep chains, switches and more hops come with
    later templates.

11. **A client writes from an emailit.io address of its own (2026-10-31).** A client is a
    throwaway webmail handle (`copper.ops@emailit.io`), drawn from a pool of client handles that
    are **reserved from signup**, as `hireme` is, so no player can register as one. `mail` already
    sends to emailit.io, so the command and the bundle do not change; the server recognises a send
    to a client handle and answers it with the verification reply. The briefing comes from the
    same handle. Rejected: proof sent to `jobs@hireme.io` (`mail` sends only to emailit.io and
    would learn a second domain) and a company domain per client (`mail` learns any number of
    domains, each wanting DNS, `whois` and likely a web server, for a briefing's sender).

12. **A client has no inbox (2026-10-31).** A mail to a client handle is read by the server,
    answered with a reply in the sender's inbox (system mail, always delivered) and kept nowhere;
    with no Sent folder in emailit.io, the proof leaves no copy, and the missions table is where
    completion lives. Rejected: real client inboxes (pool handles are reused across thousands of
    missions, so a client's inbox reaches the 100-message cap and bounces every contractor's proof
    `mailbox full`, and those inboxes grow emailit.io's root view toward its 4.5 MB ceiling).

13. **The engine is split: the network's shape in `core/`, its secrets and prose on the server
    (2026-10-31, revised the same day).** First decided as server-only. The check this entry
    asked for then failed: a shell standing on a remote box works out that box's network **on the
    client**, from its ESSID (`vantage.ts` takes the subnet from `generateHomeLan(session.essid)`;
    `nmap` from a hop sweeps `generateHomeLan(essid)`; `ssh` and `scp` from a hop find the host
    there and read its seeded tree through `resolveLanHostIdentity` to decide whether it listens,
    before the server is asked; `generateHomeLan` has 43 callers, `ftp`, `mysql`, `nc`, `ping` and
    `redis-cli` among them). A server-only network would answer "No route to host" to every
    command typed on its gateway. So:
    - **In `core/`, in the bundle: the network's shape** — its subnet, the gateway and the key
      box, their hostnames (the target-name pool), and each box's services at their pinned
      versions (the route and decoy draws that decide services). That is what `generateHomeLan`
      and `resolveLanHostIdentity` already answer for every network; missions are one branch
      there, as fixed sites are one branch in `apGatewayFs`, and every hop command works
      unchanged.
    - **On the server only: everything secret or written as prose** — the key and its file (laid
      into the key box on the server before the journal is replayed, as `withBoardsList` lays in
      `/etc/hireme/boards`), and the offers, briefings, client handles and pitches. Account
      passwords need nothing new: the crackable words already ship, the uncrackable ones as md5s
      only. The keyed secret of decision 6 is what keeps the key out of reach of anyone holding
      the generator.
    - **The cost** is an estimated 1 to 2 KB gzipped, so the bundle ceiling is raised by explicit
      decision when the slice measures it, as before.

    One machine structure and one set of hop paths: the generator emits the shape every v2 network
    box has, so the journal, the write validation and every reader treat a mission box like any
    other (legacy's mission instances were never server-side, and its machines had two
    structures). Rejected: server-only with the client taught to ask (about ten commands each
    growing a "this is a mission, ask the server" branch, and server endpoints for a scan and a
    login from a hop on a mission LAN: two reachability paths for one kind of network, the
    "two structures" decision 1 rules out).

14. **No deadline, no rescue, and the guardian stays out (2026-10-31).** An accepted job stays the
    contractor's until they complete or drop it; the only thing it holds is the one active slot,
    which dropping frees. Deadlines are content for a later, harder template. A network wrecked by
    anyone holding its address (the key box bricked, its root password changed, its hole upgraded
    shut) is left as it is: a contractor who already read the key still completes, because the
    proof is checked against the mission's key and not the box; one who did not drops the job,
    recorded as abandoned. No warning, no refund, no regenerated network: never share an address
    before you have finished. The guardian's rounds and `guardian.ts restore` never touch a mission
    box, which also keeps the old releases the guaranteed routes rest on pinned.

15. **A root on the boards' server sees the active contracts (2026-10-31).** Beside
    `/etc/hireme/boards`, `/etc/hireme/contracts` holds one `<handle> <client handle> <mission
    address> <pay>` line per accepted job, built from the missions table on each read, the way the
    boards list is (laid in before the journal is replayed, root session only, nothing of it on the
    wire below root, a failed read a 500 and never an empty file). A root learns every live
    mission and who is working it: they cannot claim another's job, but they can race the
    contractor to the key box, or read that contractor's board from `boards` and go after their
    `~/.mailrc` to take the payout through decision 7's hole. Rejected: nothing new (live missions
    stay hidden, since offers never show addresses) and pending offers too (offers are not
    reachable until accepted, so they add nothing over the contracts).

16. **What an offer and a briefing say (2026-10-31).** An offer is one block with `[ Accept ]`:
    the client, the kind of job, the pay, and a one-line pitch ("Copper Systems — retrieve an
    access key — 1,350 JSC" / "A rival is sitting on something of ours. We want the key to it.").
    The briefing comes from the client's handle, subject `Contract: <target>`, and gives the
    target company, the mission address, what the key opens, the key's form
    (`ACCESS-XXXX-XXXX-XXXX`, which is what makes decision 7's shape-matching fair) and the
    payment rule ("No key, no money. No wallet, no money."). It never gives the way in or the
    path. Pools, all drawn from the mission's number: **clients** (a company and its reserved
    throwaway handle); **targets** (the company owning the network, which also names its boxes,
    `halden-gw`, `halden-files`); **pitches**, black-hat ("a rival is sitting on something of
    ours") and grey ("our admin quit and took the only copy"), the same mechanics in a different
    moral light; **what the key opens** (the billing API, the payroll export, the backup vault);
    and **where the key sits**, a root-only file at a believable path
    (`/etc/halden/billing.key`, `/root/.config/vault/key`).

17. **The address is a mission's only identity (2026-10-31).** No readable seed code: the address
    is the seed (decision 2), sharing it is how a mission is shared (decision 1), only accepted
    missions exist so a code would open nothing the address does not (decision 3), and every way a
    mission leaks leaks the address. The 24-bit number lives only inside the server. Rejected: a
    reference code in the briefing as flavour (it would do nothing).

18. **An operator script stages missions for testing (2026-10-31).** `scripts/hireme.ts`, run
    against dev or local and never needed in play, as `guardian.ts` and `valleynews.ts` are:
    `post <handle>` fills a board's offers now, past the 24-hour turnover; `accept <handle>
    [--number N]` accepts a job directly, optionally at a chosen number (how a dev gets a mission
    with given axes, decision 2); `show <address>` prints the mission's template, routes, decoys,
    key path and key, reading the server secret from the env, so only an operator can run it;
    `drop <handle>` clears an active job. It cannot complete a job: completion only ever happens
    through `mail`, so every test of a payout goes through the real door.

19. **The board shows the current contract without its address; dropping is a form
    (2026-10-31).** While a job is active, the board shows a "Current contract" block above the
    offers: client, target company, pay and `[ Drop contract ]`, never the address (decision 4
    keeps addresses in the mailbox). A leaked board shows who you work for and against whom, not
    where. Accept and drop are forms on the board, `POST /accept` and `POST /drop`, which `curl -d`
    reaches as it reaches `/apply`, with refusals and confirmations under the button in hireme's
    style ("Contract dropped. Copper Systems will not be in touch again."), and the client mails
    one short line on a drop. **Whoever holds a board address can drop that board's job, and accept
    its offers**, since the address is the board's only key; an accept they make still mails the
    briefing to the board's own inbox, so it tells them nothing, and a drop costs the job, never pay
    already earned.

20. **Four slices, as the hireme epic was cut (2026-10-31).** Each merges on its own with its own
    wire-checks, and each shows players a little more:
    1. **A mission exists**: the server-only engine (the exfiltrate template, the two routes, the
       decoys, a gateway and a key box), the 195 block, the missions table, the lookup at every
       door, the server secret, and `scripts/hireme.ts accept/show/drop`. An operator-accepted
       address answers `nmap`, `ssh`, `hydra` and `msfconsole`, with the key root-only on the key
       box. Carries decision 13's check that working from a mission box resolves on the server.
    2. **The board hires**: three offers, the 24-hour turnover, `POST /accept` with the briefing
       mailed from the client handle, the current contract, `POST /drop`, the reserved client
       handles, `scripts/hireme.ts post`. The board's "no contracts available yet" goes.
    3. **The client pays**: a mail to a client handle checked by its shape, the reply, the mint
       paying the contractor's wallet exactly once, completion recorded, the slot refilled.
    4. **The root view**: `/etc/hireme/contracts` on the boards' server.

    Then the close-out: one browser run over all four (two players, one working a job and one
    handed the leaked address) and a valleynews `/dev` post announcing contract work. The routes
    that leak a login in a file (decision 10) follow as their own small epic. Each slice bumps the
    version, runs the mutation gate on its new modules, and lands its migration on `jshack-dev` and
    `jshack-prod` before the merge.

21. **Defaults, applied with the plan (the owner may overrule):**
    - **A mission box leaves traces like any box**: `auth.log`, `kern.log`, `access.log` and the
      exploit door's lines, sourced from the visitor's vantage, so whoever arrives later reads who
      came before and from where. A job that cares about stealth is a later template.
    - **A job is paid once.** Completion and the mint happen in one database transaction keyed on
      the job, so two right mails sent together pay once; a right key after completion earns a
      reply that the job is already done.
    - **Accepting is atomic** under a lock on the handle's row, as `hireme_apply` is, so two
      accepts at once (the owner and someone on a leaked board) take one job and refuse the other.
    - **Proof mails count toward the 20 sends an hour**, like any send: retries are unlimited in
      kind, never in rate.

---

## Find-gaps (2026-10-31)

Run on the grill record before the slice 1 plan. Each answer below is the owner's.

22. **A mission's states, and which are reachable.** One state model for the missions table
    (which replaces the "issued record" wording of the first draft):

    | State | Reached by | Reachable |
    | --- | --- | --- |
    | `offered` | posted to a board, its number reserved | no |
    | `burned` | an offer the 24-hour turnover replaced | never |
    | `accepted` | `POST /accept` | yes |
    | `completed` | a right key mailed by the contractor | yes, for good |
    | `abandoned` | `POST /drop` | yes, for good |

    **An address is reachable if and only if its number was ever accepted.** A completed network
    stays up as an abandoned one does (decision 5): it is persistent and shared, and its address
    may already be out.

23. **A decoy is defined by what its hole grants, never by when it publishes.** Every release
    carries exactly one hole, with a fixed severity and publish day, and severity sets the tier
    (`exploitEffect.ts`: critical root, high user, medium and low guest). Decision 10's "a service
    whose hole has not published" would publish within days and, if critical, become a second
    route to root. So: a **service decoy** is a release whose one hole is `low` or `medium`, a guest
    shell at most, which cannot read the root-only key (a player can still land there and look
    around); an **account decoy** holds a password from the uncrackable pool and stays shut. A
    decoy is never a release whose hole has not published, because the generator cannot know
    what it will grant. **Libraries are pinned by the same rule:** `msfconsole --local` escalates
    through a box's libraries and a high or critical library hole grants root
    (`localExploit.ts`), so a guest-shell decoy beside one badly pinned library is a route. Every
    library on a mission box sits on a release whose hole is `low` or `medium` (user, never root);
    the library route, when the catalog gains it, is a template pinning one library to a critical
    release. This supersedes the decoy kinds named in decision 10.

24. **The server secret: one per deployment, never rotated, failing closed.**
    `MISSION_KEY_SECRET` is set in the Vercel env for Preview (`jshack-dev`) and Production
    (`jshack-prod`), and in `.env.local` for `vercel dev`; the two differ, so a key read on dev
    never works on prod. It **never rotates**: changing it changes every mission's key at once,
    including keys contractors have read and not yet mailed, so a rotation is an operator incident
    (a leak) whose cost, every unmailed key in the valley refused, is accepted then. A door that
    needs it and finds none answers 500 `mission_secret_missing`; there is never a default, which
    would put a guessable key in production. Only the server and `scripts/hireme.ts show` read it,
    and it is never logged or printed, only `show`'s derived key.

25. **On the key box, a route lands root; the gateway is passed through, not broken.** The key is
    root-only and, since entry 23, nothing below root climbs, so: the **hydra route** is a
    crackable `root` on the key box (a word from the crackable pool), its sshd reached through the
    gateway's forward (`hydra -p <fwd> … 195.x.y.z`, the D2.4 forwarded-port door as it is); the
    **msfconsole route** is a `critical` service on the key box, also reached through a forward.
    Either way **the forward exposes the route's port**: the gateway is the way in, not a box to
    break, and its own admin password comes from the uncrackable pool (an account decoy), so the
    guaranteed path never needs it. `guest` and the NPC user keep the world's odds
    (`passwordPools.ts`: guest 1, user 0.7): shells to look around in, which cannot climb.

26. **"Published long ago" is a fixed cutoff day, `MISSION_ROUTE_DAY`.** The generator is a pure
    function of the mission's number and never reads the clock (reading today would make the
    same number a different network tomorrow). The cutoff is the game day slice 1 ships on (about
    day 111). A **route release** is one whose hole is `critical` and published on or before the
    cutoff; the clock only moves forward, so every route stays open for good. Only packages with
    such a release carry a route, and a test walks every service package's timeline and fails if
    the template could draw one without. **Decoys need no cutoff**: a `low` or `medium` hole grants
    guest at most whether or not it has published, so a decoy release may be old or new. Moving the
    cutoff changes the pool and so the network of every existing number: free until launch (the
    no-backward-compat rule), never after it without a plan for the missions already accepted.

27. **A mission network's ESSID is `mission-<number>`, and nobody joins it.** Every v2 network is
    keyed by an ESSID (its subnet, gateway id, hostnames and journal scope), so a mission's is
    `mission-` and its number in decimal. It is on no town's scan list, and `nmcli connect` joins
    only an ESSID from that list; **the plan verifies the server's join refuses it too**, so a
    crafted client cannot join a mission's LAN as an occupant. Players never see the ESSID, only
    the address and the hostnames. With the shape in the bundle (entry 13), anyone holding the
    generator can compute any 195 number's hostnames, services and versions offline: **accepted**,
    since without the address it says nothing about which missions exist and with the address a
    scan says the same; existence (entry 22) and the key (entry 24) stay on the server.

28. **Offers are posted lazily, when a board is read.** A `GET /` on a board tops it up: fewer than
    3 `offered` rows, and the server posts new ones until there are 3. Boards that already exist
    (since v0.420.0) get their first offers on the first read after slice 2 ships, with no
    backfill and no cron. **The 24 hours count from each offer's own `posted_at`**: an offer older
    than that is `burned` on the next read and replaced in the same top-up, so offers turn over one
    by one rather than in a daily wipe, and a completed or dropped job's slot fills on the next
    read (decision 5). The read and the top-up are **one transaction** under the lock on the
    handle's row that accepting takes (entry 21), so two reads at once cannot post six offers.
    Anyone reading a leaked board tops it up too, which is harmless: it is the same board.

29. **To the rest of the world, a mission network is a small business's line.** `whois` answers for
    the whole 195 block, accepted or not, from the client, as it does for 194, with a record that
    does not name hireme (`inetnum: 195.0.0.0 - 195.255.255.255`, `netname: SMALLBIZ-NET`,
    `org-name: Harrow Valley Business Broadband`), so looking up a briefing's address says "a
    business connection", not "a mission". findit, mapit and the web see nothing: a mission network
    is not a place, so no listing, no pin, no site. A payout shows on chainit as any mint does, the
    ledger being public: a mint to an address, never which job paid it. valleynews stays
    operator-written, nothing generated about missions.

### Gaps closed — find-gaps session, 2026-10-31

Resolved (9):
- [Blocker → entry 22] "Issued" meant both posted and reachable; one state model, reachable iff
  ever accepted.
- [Blocker → entry 23] Decoys whose hole had not published would open within days; decoys are
  defined by what their hole grants, libraries pinned by the same rule.
- [Blocker → entry 24] The server secret's lifecycle: per deployment, never rotated, fails closed.
- [Should → entry 25] The hydra route cracks `root` on the key box; the forward exposes the route.
- [Should → entry 26] "Published long ago" is a fixed cutoff day, so the generator never reads the
  clock.
- [Should → entry 27] The mission ESSID, unjoinable; offline knowledge of the shape accepted.
- [Should → entry 28] Offers posted lazily on a board read, each on its own 24 hours.
- [Nice → entry 29] `whois` for the 195 block; findit, mapit and the web see nothing.
- [Nice → entry 29] chainit shows a payout as any mint.

Parked: none.

### Planning slice 2 (2026-11-01)

30. **An offer is named by a random ref, never by its number.** An offer's number is its address
    (decision 2), and an offer never shows the address (decision 4), so the `[ Accept ]` form
    cannot carry it. Each offer posted to a board gets a short random `ref`, unique per handle and
    kept in the missions table, and the form posts `offer=<ref>` in a hidden field (as rideit's
    tickets and talkit's comments carry theirs). A page whose offer has since turned over is
    refused ("That offer is no longer available."), never silently swapped for another job.
    Rejected: the slot's position (a board that turned over between the read and the click accepts
    a job the player never read).

31. **Slice 2 ships before slice 3 pays, and the gap is accepted.** Vercel deploys `main` on merge,
    so for the days between the two merges a contractor can accept, root the key box and mail the
    key to the client handle, and the mail bounces as to any handle with no account. Nothing is
    lost: the key never rotates (entry 24) and a job has no deadline (decision 14), so the same
    key mailed once slice 3 ships is paid. Rejected: keeping the board shut behind a flag until
    slice 3 (a bridge to remove, and slice 2 would ship nothing a player sees) and stacking slices
    2 and 3 into one merge (a bigger review and the rebase churn).

32. **Defaults, applied with the slice 2 plan (the owner may overrule):**
    - **A board has three slots, and the active job holds one.** Decision 5 has a slot fill
      "the moment that job is completed or dropped" and entry 28 tops up to 3 `offered` rows; read
      together, the top-up fills to 3 counting the accepted job, so while a job is active the board
      shows it and 2 offers, and the third offer comes on the first read after it closes.
    - **Client handles fit the handle alphabet.** `mail` sends only to a valid handle
      (`^[a-z][a-z0-9_-]*$`, at most 24 characters), so decision 11's `copper.ops` is `copper-ops`.
    - **The offers and briefings are server-only.** `hireme/pages.ts` ships in the bundle (the
      front page is a file in hireme.io's tree), so the board page moves to a module only the
      server's fetch handler imports, beside the new client, pitch and "what the key opens" pools.
    - **The operator's `accept` stays silent.** It still writes an accepted row directly and mails
      no briefing; `show` gains the client, the target company and the pay, which is what a test
      of slice 3's mail door needs. The briefing is tested through the real `POST /accept`.
    - **A `GET` of `/accept` or `/drop` answers the board** and changes nothing, as rideit's
      `/board` does for a browser going back.
    - **The words.** Accepted: "Contract accepted. <Client> has sent you a briefing." Dropped:
      "Contract dropped. <Client> will not be in touch again." Busy: "Finish or drop your current
      contract first". Gone: "That offer is no longer available." No job: "You have no current
      contract." Each under the button it answers, in hireme's `role="alert"` style.

### Planning slice 3 (2026-11-03)

33. **The client does not read quoted lines (owner, 2026-11-03).** `mail reply` quotes the
    briefing, and the briefing's own example `ACCESS-XXXX-XXXX-XXXX` has a key's shape. The client
    reads neither the key nor the wallet from a body line that starts with `>`: those lines are
    the player quoting someone else. Where the player types the key, above or below the quote, no
    longer matters, and a reply holding no key of its own gets the no-key reply. Rejected: first
    found with the quote included (a key typed below the quote refused as wrong over the client's
    own example) and skipping only the example (a key quoted from someone else's mail would count
    as the sender's).

34. **Defaults, applied with the slice 3 plan (the owner may overrule):**
    - **Which contract a mail is about.** The client looks only at the sender's jobs with *this*
      client (the client drawn from each job's number) in state `accepted` or `completed`. An
      `abandoned` job is no contract: dropping and then mailing the right key pays nothing
      (decision 5). The first row that fits answers:

      | The mail | The reply | What changes |
      | --- | --- | --- |
      | No accepted job with this client, and the key is not one of the sender's completed jobs' with it | "We have no contract with you." | nothing |
      | An accepted job with this client, and no key in the mail | "No key, no money. Send the key." | nothing |
      | The accepted job's key, with a wallet | "Key received. 1,350 JSC sent to jsc…. Pleasure doing business." | completed, the pay minted to the wallet |
      | The accepted job's key, no wallet | "Key received. You sent no wallet, so there is nothing to pay. No wallet, no money." | completed, nothing minted |
      | The key of one of the sender's completed jobs with this client | "That job is already closed." | nothing |
      | An accepted job with this client, and any other key | "That key opens nothing of ours." | nothing |

    - **The reply is system mail** from `<client handle>@emailit.io` (always delivered, as the
      briefing is), subject `Contract: <target company>`, or `No contract` on the first row.
    - **`mail` prints what it prints for any send.** A mail to a client handle answers 200 once
      the reply is in the inbox, so the command and the bundle do not change and the player reads
      the answer with `mail`. A mail to a client handle never bounces again.
    - **One rate rule.** The 20-an-hour count moves out of `email_send` into one helper that it
      and the client's door both call, so a proof mail counts exactly as a send does (entry 21)
      and the rule is written once. A failed or throttled login counts nothing, as before.
    - **Completion is recorded by state alone**: `completed` and `closed_at`, no new column. The
      mint's own ledger row records the payout (chainit shows it, entry 29); which wallet a job
      paid is kept nowhere else.
    - **A mint the ledger refuses** (the wallet would pass 9,007,199,254,740,991) takes the
      completion back with it: the mail answers 500 `mail_failed`, the job stays accepted, and
      nothing is mailed.
    - **No secret, no proof.** With `MISSION_KEY_SECRET` unset, a mail to a client handle answers
      500 `mission_secret_missing` before anything is counted or read (entry 24); mail between
      players is untouched.

---

## Slice 1 — a mission exists

**Branch:** `feat/missions-exist` · **Version:** 0.438.0 · **Class:** behavior change

**Goal.** An operator accepts a job for a handle from `scripts/hireme.ts`, and its 195 address
answers like a small business's line: `nmap` finds the gateway and the forwarded port, the one
guaranteed way in (`hydra` or `msfconsole`, whichever the number drew) lands root on the key box,
and root reads a key that `scripts/hireme.ts show` agrees with. An address nobody was given
answers exactly as an empty one. No board, no mail, no pay: those are slices 2 and 3.

**Actor and trigger.** The operator runs `scripts/hireme.ts accept <handle>`; a player (or the
wire-check driving one) is handed the address.

### What it builds

- **The block and the address** (`core/`, bundle). `MISSION_FIRST_OCTET = 195` beside the board
  block (`generation/world.ts`); `isPublicIp` accepts it, so every cross-network command routes a
  `195.` target to the server. The number is the address's low 24 bits (`195.a.b.c` is
  `a·65536 + b·256 + c`); only host octets 2–254 are numbers, as the boards' CHECK has it. The
  ESSID is `mission-<number>` in decimal (entry 27). `whois` answers the whole block with entry
  29's record.
- **The shape** (`core/`, bundle): one mission branch in each of `generateHomeLan` (the gateway at
  `.1` and the key box at a drawn octet, the `lone` shape), `buildApGatewayBaseFs` (the gateway)
  and `baseFsForLanHost` (the key box), all drawn from the number alone, never the clock:
  - **hostnames** from a target-stem pool (`halden-gw`, `halden-files`);
  - **the route**, `hydra` or `msfconsole`, one draw;
  - **the gateway**: router firmware as every gateway has, an admin password from the
    uncrackable pool, and one forward in `rules.v4`, the route's port to the key box (entry 25);
  - **the key box**, built by a mission builder of its own and **not** by `buildRemoteHostFs`'s
    role draws, so nothing the world scatters on an NPC (a database login, a backup, a backdoor,
    a role config) opens a way in nobody guaranteed. Its accounts: `root` (crackable on the hydra
    route, uncrackable on the msfconsole route), the NPC user and `guest` at the world's odds.
    Its services: the route's (sshd, or a service pinned to a `critical` release published on or
    before `MISSION_ROUTE_DAY`) plus up to two decoys. Its manifest pins **every** package that
    is not the route, sshd and vsftpd (which ship on every box) and the libraries included, to a
    release whose hole is `low` or `medium` (entry 23);
  - `MISSION_ROUTE_DAY = 111` (entry 26).
- **The secrets** (server only; modules imported from `api/` and `scripts/` alone). The key
  path pool, and the key, `ACCESS-XXXX-XXXX-XXXX` formatted from an HMAC-SHA256 of the number
  under `MISSION_KEY_SECRET` (`node:crypto`). The key file (mode 600, root's) is laid into the key
  box before the journal is replayed, at the two server sites that build a network box from its
  id: the read (`resolveCrossPlayerFs`, at every tier, the walker keeping it off the wire below
  root) and the write gate (`remoteWritePermission`), so a root's `rm` of the key is accepted and
  sticks. No secret: 500 `mission_secret_missing` (entry 24).
- **The missions table** (migration): `number` (PK, the CHECK above), `handle` (references
  `email_accounts`), `state` (CHECK in entry 22's five), `posted_at`, `accepted_at`,
  `closed_at`; a partial unique index on `handle` where `state = 'accepted'` (one active job);
  RLS on with no policies.
- **The lookup**: `networkByPublicIp` (`core/hireme/boards.ts`) gains a mission finder: a `195.`
  address is the network `mission-<number>` when its row's state is `accepted`, `completed` or
  `abandoned`, nothing otherwise, its read error passed on. The twelve door wirings change only
  through the two `networkByPublicIpVia` helpers in `api/network.ts` and `api/sessions.ts`.
- **The join refuses a mission ESSID** (`registerNetwork.ts`) before anything else, with 403
  `network_not_joinable`, even when `JSHACK_ADMIT_LAB_NETWORKS` admits undeclared networks (it is
  set in `.env.development.local`, so the wire-check sees the refusal with it on).
- **Working from a mission box traces as its 195 address**: `derivedPublicIpByEssid` learns the
  mission ESSID, so a scan typed on the key box writes the mission's address into the scanned
  box's `kern.log`, not `unknown`.
- **`scripts/hireme.ts`** (operator, dev or local; reads the service role and the secret from
  env): `accept <handle> [--number N]` (refuses a handle with an active job or no mailbox; draws a
  free number with `randomInt` when none is given; prints the address); `show <address>`
  (template, route, decoys, key path, key); `drop <handle>` (state `abandoned`, `closed_at`).
  It has no `complete`.

### Acceptance criteria

1. With no row for a number, `curl`, `nmap`, `ssh` and `hydra` against its 195 address answer
   exactly as against an empty `193.` address; the same holds for a row in state `offered` or
   `burned`.
2. After `scripts/hireme.ts accept alice`, `nmap -sV <address>` shows the gateway's services and
   the forwarded port.
3. On a number whose route is `hydra`, `hydra` through the forwarded port cracks `root` on the
   key box, and `ssh root@<address> -p <port>` lands a root shell on it.
4. On a number whose route is `msfconsole`, `nmap -sV` through the forward shows the pinned
   release and its CVE, and `msfconsole` lands root on the key box.
5. As root on the key box, `cat <key path>` prints the key `scripts/hireme.ts show` prints. As
   `guest` or the NPC user the file's content does not reach the client.
6. From a root shell on the key box, `nmap <mission subnet>` lists the gateway and the key box,
   and `ssh` sideways to the gateway is answered (asks for a password), never "No route to host"
   (the hop check of decision 13).
7. For 2,000 drawn numbers (a unit test): the route is reachable through the forward and grants
   root; no other package on either box holds a `critical` or `high` hole on any day; the
   gateway's admin and, on the msfconsole route, the key box's `root` are uncrackable; every
   service package the route can draw has a `critical` release published on or before
   `MISSION_ROUTE_DAY`, and every package a mission box carries has a `low` or `medium` release.
8. The same number generates the same network on the client and the server, today and on any
   later game day.
9. `scripts/hireme.ts drop alice` leaves the address reachable and frees alice to accept again;
   a second `accept alice` while one is active is refused.
10. A root's `rm` of the key file sticks for the next root reader.
11. With `MISSION_KEY_SECRET` unset, a read of the key box answers 500 `mission_secret_missing`
    (handler unit test).
12. A join of `mission-<number>` answers 403 `network_not_joinable`, with the lab flag on.
13. `whois <any 195 address>` prints entry 29's record.
14. A scan typed on the key box records the mission's 195 address in the scanned box's
    `kern.log`.
15. The built main chunk holds no key path from the pool and no `MISSION_KEY_SECRET` read; its
    growth is measured and the ceiling raised by explicit decision if needed (entry 13).

### Evidence

- **Unit (TDD)**: the address codec and block (`ip.test.ts`), `whois.test.ts`, the generator's
  shape and invariants (AC 7, 8), the key format and its dependence on the secret, the lookup
  over the five states and a failed read (`boards.test.ts`), the overlay and the missing secret
  (`resolveCrossPlayerFs.test.ts`), the write gate (AC 10), the join refusal.
- **Wire-check** `scripts/testMissions.ts` vs `vercel dev` + local supabase, driving
  `scripts/hireme.ts`: AC 1–6, 9, 10, 12, 14, each against a number picked with `--number` for
  its route.
- **Mutation gate** at PR readiness on the new `core/` modules and the changed lookup.
- **Bundle**: `npm run build` and `scripts/checkBudgets.ts` (AC 15), grep of the chunk.
- **Ops (done 2026-11-01)**: the migration is on `jshack-dev` and `jshack-prod` (link, push,
  unlink per project); `MISSION_KEY_SECRET` is set for Preview, Production and
  `.env.development.local`, each value different (never printed). Verified live: a local browser
  E2E (fresh player → join wifi → `msfconsole` roots the key box → `cat` reads the `ACCESS-` key,
  matching the offline-derived value) and a minimal prod key-door check (a well-formed, distinct
  key came back from production, so the Production secret is bound).

### Out of scope

Offers, accept and drop on the board, the briefing, reserved client handles, pay (slice 2);
completion by mail and the mint (slice 3); `/etc/hireme/contracts` (slice 4). The guardian needs
no change: its rounds walk only the declared world.

---

## Slice 2 — the board hires

**Branch:** `feat/missions-board-hires` · **Version:** 0.439.0 · **Class:** behavior change ·
**Delivery:** independent PR against `main`

**Goal.** A contractor opens their board and finds three offers, each a client, the kind of job,
the pay and a pitch, and no address. Accepting one mails a briefing from the client's handle with
the mission's address in it, and that address starts answering; the board then shows the current
contract, which can be dropped. Offers nobody takes turn over after 24 hours, and their numbers
never become reachable. No pay yet: a mailed key bounces until slice 3 (entry 31).

**Actor and trigger.** A player holding a board's address reads it (`lynx`/`curl`) and submits
its forms (`POST /accept`, `POST /drop`, or `curl -d`).

### What it builds

- **The terms of a contract** (server-only, `core/missions/`, imported by the fetch handler and
  `scripts/` alone): from the number, as the shape is (a PRNG seeded by the number, never the
  clock) — the **client** (a company and its reserved handle, `Copper Systems` / `copper-ops`),
  the **target company** (its display name built on the shape's stem, so `halden-gw` belongs to a
  company called Halden something), the **pitch** (black-hat or grey), **what the key opens**, the
  **kind of job** ("retrieve an access key", exfiltrate being the one template) and the **pay**
  (500 to 2,000 JSC, rounded to the nearest 50, decision 8). The key path pool is not touched.
- **Reserved client handles**: every handle in the client pool joins emailit.io's reserved list,
  so signing up as one is refused as a reserved system name.
- **The missions table** (migration): a `ref` column (nullable: the operator's rows have none;
  every offer posted from a board has one), unique per handle (entry 30). Three store functions,
  each one transaction under the lock on the handle's `email_accounts` row (entry 21), each
  answering with a word, `EXECUTE` for `service_role` alone, as `hireme_apply`:
  - **post offers** (entry 28): burn the handle's offers posted more than 24 hours ago, then post
    from the candidate numbers and refs offered until offers plus the accepted job make 3
    (entry 32); a number or ref already taken is skipped, and the caller draws again when too few
    landed. It answers with the board as it now stands: the offers (number, ref) and the current
    job's number, if any.
  - **accept** (`handle`, `number`, the briefing): `busy` when the handle holds an accepted job;
    `gone` when the number is not this handle's offer, or is one posted more than 24 hours ago;
    otherwise the row turns `accepted` (`accepted_at`) and the briefing lands in the inbox as
    system mail (always delivered, as the board's own mail is), answering `accepted`.
  - **drop** (`handle`, `number`, the client's line): `no_contract` when that number is not the
    handle's accepted job; otherwise `abandoned` (`closed_at`) and the client's line mailed,
    answering `dropped`.

  The caller reads the offer's number by its ref first and builds the briefing from it, and the
  function checks again under the lock, so a turnover between the two is `gone`.
- **The board** (server-only module; `boardPage` leaves `hireme/pages.ts`): `GET /` on a board
  posts offers and renders, above them while a job is active, a "Current contract" block (client,
  target company, pay, `[ Drop contract ]`, never the address, decision 19), then each offer as
  one block (decision 16's line and pitch) with its own form and hidden `offer=<ref>`. The "no
  contracts available yet" line goes.
- **The doors** (`resolveHttpFetch.ts`): `POST /accept` and `POST /drop` on the boards' server,
  ahead of the 405 every other POST there still gets, answered from functions, never from a file
  (a root on the boards' server cannot stop either), each answering the board with its message
  under the button (entry 32). Every hit is an `access.log` line on the boards' server naming the
  board address asked, as the board's `GET` is, never with the form. `GET /accept` and `GET /drop`
  answer the board. Numbers and refs are drawn from the OS's randomness (`randomInt`), as board
  addresses are.
- **The briefing** (decision 16): from `<client handle>@emailit.io`, subject `Contract: <target
  company>`, giving the target company, the mission address, what the key opens, the key's form
  (`ACCESS-XXXX-XXXX-XXXX`), that the reply goes to this address with the key and a wallet
  address, and the payment rule ("No key, no money. No wallet, no money."). Never the way in, the
  path or the key's file. A drop mails one short line from the same handle.
- **`scripts/hireme.ts`**: `post <handle>` burns the handle's current offers and posts 3 fresh
  ones now, past the 24-hour turnover (decision 18); `show <address>` adds the client, target
  company and pay. `accept` and `drop` are unchanged (entry 32).

### Acceptance criteria

1. A board read for a handle with no offers shows 3 offers, each with a client, "retrieve an
   access key", a pay between 500 and 2,000 JSC that is a multiple of 50 ("1,350 JSC"), a pitch
   and an `[ Accept ]` button; neither the page nor its HTML holds a `195.` address.
2. Reading the board again shows the same 3 offers; two reads at once leave 3 offers, not 6.
3. An offer posted more than 24 hours ago is gone on the next read and replaced by a fresh one;
   the replaced offer's address still answers as an empty address.
4. Accepting an offer answers "Contract accepted. <Client> has sent you a briefing."; the inbox
   holds the briefing from `<client handle>@emailit.io` with subject `Contract: <target
   company>`, the mission's address, what the key opens, the key's form and the payment rule, and
   no route, path or key; `nmap` of that address now finds the gateway.
5. After accepting, the board shows a "Current contract" block (client, target company, pay,
   `[ Drop contract ]`) with no address, and 2 offers.
6. Accepting while a job is active answers "Finish or drop your current contract first", mails
   nothing and changes nothing.
7. Accepting with a ref that is not one of this board's live offers (turned over, another
   handle's, made up) answers "That offer is no longer available." and mails nothing.
8. Two accepts of different offers on one board at once: one is accepted, the other refused as
   busy, and one briefing is mailed.
9. Dropping answers "Contract dropped. <Client> will not be in touch again."; the client mails one
   line; the address still answers; the next read shows 3 offers and no current contract.
10. Dropping with no active job answers "You have no current contract."
11. Signing up as any client handle is refused as a reserved system name.
12. `GET /accept` and `GET /drop` answer the board and change nothing; a POST to any other path
    on the boards' server is still 405.
13. The boards' server's `access.log` records each `POST /accept` and `POST /drop` with the board
    address asked and without the form.
14. The same number gives the same client, target company, pitch, what the key opens and pay on
    every read (unit, over 2,000 numbers); every client handle passes `validateUsername`.
15. `scripts/hireme.ts post <handle>` replaces the board's offers with 3 fresh ones; `show
    <address>` prints the client, target company and pay.
16. The built main chunk holds no client handle, pitch or briefing line (grep); its size is
    measured against the budget.

### Evidence

- **Unit (TDD)**: the terms (AC 14, the pay range and rounding at 500, 2,000 and a value that
  rounds either way), the board page's states (offers, current contract, each message), the
  accept and drop answers against an injected store (each word, a store failure, a store word
  nobody taught it, as `apply.test.ts` does), the doors' routing in `resolveHttpFetch.test.ts`
  (AC 12, 13), the reserved handles (AC 11), the operator order parser (`post`).
- **Wire-check** `scripts/testMissionBoard.ts` vs `vercel dev` + local supabase: AC 1–10, 12, 13
  through the real `/api/network`, the 24-hour turnover by back-dating `posted_at` with the
  service role, the races in AC 2 and 8 by firing two requests together.
  `scripts/testMissions.ts` stays green.
- **Mutation gate** at PR readiness on the terms module, the board page, and the accept and drop
  answers.
- **Bundle**: `npm run build` and `scripts/checkBudgets.ts`, grep of the chunk (AC 16).
- **Ops, before the merge**: confirm no account holds a client handle on `jshack-dev` or
  `jshack-prod` (a read; a held one is swapped out of the pool); the migration on both (link,
  push, unlink per project; the prod push run by the owner).
- No browser run: the epic's close-out run covers it.
- **As built (2026-11-03)**: unit suite 330 files and 10,004 tests; wire-checks
  `testMissionBoard` 19/19, `testHiremeBoard` 15/15, `testHiremeBoardRoot` 13/13, `testMissions`
  19/19, `testHireme` 21/21, `testEmailitSignup` 18/18. Mutation: 435 killed, 1 timeout; the 13
  survivors and 1 no-coverage are all equivalent. Main chunk is 297,685 B gz against a 298,175 B
  ceiling, so only 490 B of headroom is left for slice 3. Migration pushed to dev (by Claude) and
  prod (by the owner).

**Required skills:** `tdd`, `testing` and `functional` for the terms and the page; `refactoring`
after each green; `mutation-testing` at the PR gate.

### Out of scope

Completion by mail, the reply, the mint and the slot refilling on completion (slice 3; until then
a mailed key bounces, entry 31); `/etc/hireme/contracts` (slice 4). The routes that leak a login
in a file stay their own epic.

---

## Slice 3 — the client pays

**Branch:** `feat/missions-client-pays` · **Version:** 0.440.0 · **Class:** behavior change ·
**Delivery:** independent PR against `main`

**Goal.** A contractor mails the key to the client's handle in their own words with a wallet
address, and the client answers in their inbox at once: the job is completed and the quoted pay is
minted to that wallet, exactly once. A wrong key, no key, a dropped job and someone else's job
each get a reply of their own and pay nothing. The board's slot frees for a new offer, and the
mission's address keeps answering.

**Actor and trigger.** A player logged in to emailit.io runs `mail send <client handle> …` or
`mail reply <briefing>`, or anyone holding a contractor's `~/.mailrc` does it as them (decision
7's hole).

### What it builds

- **Reading the proof** (server-only, `core/missions/`): the first key (`ACCESS-` and three
  groups of four from the key's alphabet) and the first wallet (`jsc` + 40 hex) in the subject,
  then the body, ignoring case and skipping body lines that start with `>` (entry 33). The key is
  compared upper-cased and the wallet lower-cased, as the ledger stores it.
- **The client's door** (server-only): `handleResolveMail`'s send hands a mail addressed to a
  client handle to it instead of to `email_send`. It opens the sender's contracts, picks the
  reply by entry 34's table from each job's terms and key (`missionKey` under
  `MISSION_KEY_SECRET`), and either completes the job or mails the reply. It answers 200
  `{ ok: true }` once the reply is in the inbox; a login refused, throttled or send-limited
  answers as any send does, and nothing is mailed.
- **The store** (migration). Each function is STRICT, with `EXECUTE` for `service_role` alone,
  as slice 2's are:
  - the send count moves out of `email_send` into one helper both call (entry 34); `email_send`
    otherwise answers exactly as before;
  - **open a proof** (`handle`, password md5, player key): the password check `email_send`
    makes, then the send counted. It answers with the check's word, `send_limited`, or the
    handle's jobs in `accepted` or `completed` (number and state);
  - **complete** (`handle`, `number`, the wallet or empty, the pay, the reply), under the lock on
    the handle's `email_accounts` row (entry 21). It answers `completed` when the number is the
    handle's accepted job: in one transaction the row turns `completed` (`closed_at`),
    `wallet_mint` credits the wallet with the pay when one was given, and the reply lands as
    system mail; a refused mint raises and takes all of it back. It answers `already_done` when
    the number is the handle's completed job, and `no_contract` otherwise; neither writes
    anything, and the door then mails the matching reply (a second right mail racing the first
    gets "That job is already closed.");
  - **reply** (`handle`, the reply): the client's other answers, as system mail.
- **The slot**: nothing new. The top-up already counts only `offered` and `accepted` (entry 32),
  so a completed job's slot fills on the next board read.
- **`scripts/hireme.ts`**: unchanged. It cannot complete a job (decision 18), and `show` already
  prints the key, the client handle and the pay a test needs.

### Acceptance criteria

1. On an accepted job, a mail to its client handle that holds the key and a wallet, anywhere in
   the subject or the body and in any case, answers as a delivered send. The inbox then holds the
   client's reply from `<client handle>@emailit.io` naming the pay and the wallet, the wallet's
   balance has risen by exactly the pay, and the wallet's history shows a mint of that amount.
2. After it the job is completed: the next board read shows 3 offers and no current contract,
   the address still answers `nmap`, and the contractor can accept another offer.
3. The right key with no wallet completes the job and mints nothing, and the reply says there is
   no wallet to pay.
4. The same key mailed again after completion earns "That job is already closed." and mints
   nothing.
5. Two right mails sent at once mint once: one "Key received" reply and one "That job is already
   closed." reply.
6. A wrong key earns "That key opens nothing of ours." and a mail with no key earns "No key, no
   money. Send the key."; neither changes the job, and the right key mailed next still pays.
7. A key typed below the quote of `mail reply <briefing>` pays; a reply that only quotes the
   briefing earns the no-key reply (entry 33).
8. The right key mailed by a handle with no contract with this client earns "We have no contract
   with you." and mints nothing, whether it comes from another player, a contractor of another
   client, or the contractor after dropping the job.
9. Whoever logs in as the contractor and mails the right key with their own wallet is paid to
   that wallet (decision 7's hole, kept on purpose).
10. A mail to a client handle with a wrong password answers `login_failed`, and with 20 sends
    already in the hour answers `send_limited`; neither mails anything. Each proof mail counts as
    one send.
11. With `MISSION_KEY_SECRET` unset, a mail to a client handle answers 500
    `mission_secret_missing` (handler unit test), and a mail to a player is delivered as before.
12. Mail between players is unchanged: delivered, bounced, capped and limited exactly as before.
13. The built main chunk holds no reply line, and its size is measured against the budget (no
    bundled code is expected to change).

### Evidence

- **Unit (TDD)**: reading the proof (subject before body, the first of several, either case,
  `>` lines skipped with the briefing's example in them, near misses such as eleven symbols, a
  letter outside the key's alphabet and a wallet of 39 hex); the client's door over every row of
  entry 34's table against an injected store (each word, a store failure, a word nobody taught
  it, as `contracts.test.ts` does); the mail handler's routing (a client handle to the door, any
  other handle to `email_send`, the missing secret).
- **Wire-check** `scripts/testMissionPay.ts` vs `vercel dev` + local supabase, through the real
  `/api/network` `resolveMail`: AC 1–10, with the job accepted through the real `POST /accept`,
  the key derived as `hireme.ts show` derives it, balances and history read through
  `/api/wallet`, the race fired as two sends together, and the send limit met by seeding the
  hour's count with the service role. `testMailSend`, `testMailRead`, `testMissionBoard` and
  `testMissions` stay green (AC 12, and the send-count helper's preservation evidence).
- **Mutation gate** at PR readiness on the proof reader, the client's door and the changed mail
  handler.
- **Bundle**: `npm run build`, `scripts/checkBudgets.ts` and a grep of the chunk (AC 13). The main
  chunk has 490 B of headroom, and this slice adds nothing to the client.
- **Ops, before the merge**: the migration on `jshack-dev` and `jshack-prod` (link, push, unlink
  per project; the owner runs the prod push). No new env: `MISSION_KEY_SECRET` is set on both.
- No browser run: the epic's close-out run covers it.

**Required skills:** `tdd`, `testing` and `functional` for the proof reader and the client's
door; `refactoring` after each green, and for moving the send count, a preservation change held
green by `testMailSend`; `mutation-testing` at the PR gate.

### Out of scope

`/etc/hireme/contracts` (slice 4). Recognition for completed jobs (decision 8). Attachments and
file exfiltration (decision 6). The close-out browser run and the valleynews `/dev` post
(decision 20).
