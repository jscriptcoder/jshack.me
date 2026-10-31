# Plan: missions

**Status:** grill in progress (started 2026-10-31). No plan yet, no code.

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
   server draws a fresh number for each job it posts and records it as issued, so the record is of
   who was given what, never of where a network lives. Rejected: free-form seeds hashed into the
   block (collisions by about 5,000 seeds, and a table to settle them breaks "the address comes
   from the seed"); free-form seeds with an address stored on first accept (the address no longer
   comes from the seed). Legacy's keyword seeds are dropped with them: their substring matching was
   a known problem, and a dev who wants given axes searches for a number that has them.

3. **Only issued missions exist (2026-10-31).** A 195 address nobody was given answers exactly as
   an empty address does, at every door: no reply to a scan, a fetch, `ssh` or any service gate,
   so a wrong guess tells a prober nothing. Every door finds a 195 network through one lookup of
   the issued record, the path `networkByPublicIp` already takes for the 194 boards. Once issued,
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
   the issued record and nothing else shows them. Rejected: 40 to 80 JSC (a dinner, not a
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
    with no Sent folder in emailit.io, the proof leaves no copy, and the issued record is where
    completion lives. Rejected: real client inboxes (pool handles are reused across thousands of
    missions, so a client's inbox reaches the 100-message cap and bounces every contractor's proof
    `mailbox full`, and those inboxes grow emailit.io's root view toward its 4.5 MB ceiling).

13. **The mission engine runs on the server only (2026-10-31).** The generator, templates, pools,
    client handles and briefings live in code only `api/` imports, as hireme's pages, mail and
    lookup do. A player reaches a mission box only through doors that already go to the server
    (scan, fetch, `ssh`, `hydra`, the exploit door, and the remote read `resolveCrossPlayerFs`,
    which builds a box on the server and prunes it to the caller's tier before it is sent), so the
    client never generates one. The bundle grows by little more than the 195 block in `isPublicIp`
    and a `whois` record, as the 194 boards did; nothing about a mission ships to the client, and
    the keyed secret of decision 6 stays as defence in depth. The generator emits the machine
    shape every v2 network box already has, so the journal, the write validation and every reader
    treat a mission box like any other (legacy's mission instances were never server-side, and its
    machines had two structures). **To verify in the plan, not assume:** that working from a
    mission box (a scan of its LAN from the gateway, `ssh` to the internal box) resolves on the
    server, as operate-from-a-hop suggests. Rejected: a shared generator in `core/` run on both
    sides like the world (kilobytes the bundle ceiling does not have, and every secret needing
    the server-written treatment anyway).

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
    address> <pay>` line per accepted job, built from the issued record on each read, the way the
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
    is the seed (decision 2), sharing it is how a mission is shared (decision 1), only issued
    missions exist so a code would open nothing the address does not (decision 3), and every way a
    mission leaks leaks the address. The 24-bit number lives only inside the server. Rejected: a
    reference code in the briefing as flavour (it would do nothing).

18. **An operator script stages missions for testing (2026-10-31).** `scripts/hireme.ts`, run
    against dev or local and never needed in play, as `guardian.ts` and `valleynews.ts` are:
    `post <handle>` fills a board's offers now, past the 24-hour turnover; `issue <handle>
    [--number N]` accepts a job directly, optionally at a chosen number (how a dev gets a mission
    with given axes, decision 2); `show <address>` prints the mission's template, routes, decoys,
    key path and key, reading the server secret from the env, so only an operator can run it;
    `drop <handle>` clears an active job. It cannot complete a job: completion only ever happens
    through `mail`, so every test of a payout goes through the real door.
