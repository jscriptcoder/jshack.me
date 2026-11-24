# Plan: White-hat jobs

**Status:** Grilled 2026-11-22 (the shared rules and cleanup). **Cleanup shipped** at v0.479.0 (PR #801, merged 2026-11-22) and closed out with a browser run the same day; as-built: "Cleanup jobs" in `docs/missions-architecture.md`. **Close the door shipped** at v0.480.0 (PR #802, merged 2026-11-23) and closed out with a browser run the same day; as-built: "Close-the-door jobs" in `docs/missions-architecture.md`. **Lock them out shipped** at v0.481.0 (PR #803, merged 2026-11-23) and closed out with a browser run the same day; as-built: "Lock-them-out jobs" in `docs/missions-architecture.md`. **Patch it shipped** at v0.482.0 (PR #804, merged 2026-11-24) and closed out with a browser run the same day; as-built: "Patch-it jobs" in `docs/missions-architecture.md`. **Restore the record grilled** 2026-11-24 (decisions 48–58) and planned ("Slice plan: Restore-the-record jobs"); next: the owner confirms its acceptance criteria and settled items, then RED on `feat/white-hat-restore`. This plan is retired once the last white-hat kind closes out.

Every contract kind v2 ships is black-hat: the contractor breaks into the target's network and
does something to it. Legacy also had defender contracts (`malware`, `forensics`, `db_fix`,
`script_fix`, `script_auto`; see `docs/mission-ideas/white-hat-investigations.md` and
`objectives.md`), filed under a separate SECURITY CONTRACTS column. This grill decides how v2
brings defender work back on top of the shipped missions system
(`docs/missions-architecture.md`).

---

## Grill record

1. **The client lets the contractor in (2026-11-22).** On a white-hat job the contractor is hired
   help, not an intruder, so breaking in would make no sense and is taken away. The difficulty
   moves from getting in to the work itself (the hunt, the logs, the true value of a record), so
   each white-hat kind has to carry its own challenge in what it plants.

2. **A root `ssh` login per machine in scope, handed over in the briefing (2026-11-22).** The
   briefing names each machine the job covers with a `root@<address>` login and its password,
   as legacy did. On a two-hop job that means a login for the front box and one for the machine
   behind it, so the player never has to find a way to the next hop themselves. Rejected: an
   ordinary admin account plus root's password for `su`, one more step that would teach the
   habit and give `auth.log` a line, but adds friction to work the client wants done; and a
   single login to the front box only, which would bring breaking in back for the second hop.

   Consequences noted, not yet decided:
   - The login is a secret worth stealing. It sits in the briefing mail, and mission networks are
     shared, so whoever reads the contractor's inbox or `~/.bash_history` reaches the client's
     machines as root and can undo the fix before the contractor mails. This fits the owner's
     rule that players learn the hard way; no warning is added.
   - Whether the client changes the password once the job is paid, so a closed job leaves no
     open door, is still open.

3. **White-hat kinds join hireme's kind draw (2026-11-22).** They are offered on the same
   hireme.io board as every kind before them, each taking its share of the kind draw. An offer's
   kind and pitch already say what sort of job it is, so no new site, door or lookup is needed;
   the clients need white-hat pitches beside their black-hat and grey ones. Rejected: a labelled
   white-hat section on the board (legacy's second column), which changes the layout and the
   three-offer top-up; and a separate security firm as a second operator, the clearest identity
   but a new site, board, application and lookup.

4. **Seven white-hat kinds are in scope (2026-11-22).**
   - **Cleanup** (the backdoor job's mirror, legacy `malware`): an implant and the listener it
     runs were left on a machine; pays once both are gone.
   - **Close the door** (the portforward job's mirror): a rogue forward on the router exposes one
     of the client's machines; pays once the public port no longer reaches it.
   - **Lock them out** (the credential job's mirror): root's password on a machine has leaked;
     pays once the leaked password no longer logs in.
   - **Patch it** (new, on the CVE system): a box runs a release with a root-level CVE; pays once
     `apt upgrade` has moved it off, which only works inside the patch-delay window.
   - **Restore the record** (the tamper job's mirror, legacy `db_fix`): a record was corrupted and
     its true value sits in a backup or export on the box; pays once the table reads right.
   - **Forensics** (legacy): read the logs back to the intruder; pays on a mail naming their
     handle and origin.
   - **Incident response** (the chain job's mirror): find how they got in, then close it.

   Out: recovering a bricked box, since a brick is permanent by design; and the script jobs
   (legacy `script_fix`, `script_auto`), which need a verification hook designed against v2's
   `node` and go to `backlog.md`.

5. **Mirrors first, incident response last (2026-11-22).** Each kind is its own story with its
   own close-out, in this order: cleanup (which also builds what every white-hat kind shares, the
   briefing with root logins), close the door, lock them out, patch it, restore the record,
   forensics, and incident response last because it chains the others. Rejected: forensics first,
   the most distinctly white-hat kind; and patch it first, the newest to v2.

6. **White-hat work pays about 60% of black-hat (2026-11-22).** 300–1,200 JSC single-hop and
   1,200–2,400 two-hop, rounded to 50 as every pay is; incident response, two steps like a chain,
   2,400–4,200. Breaking in is what black-hat pay is for, and the gap leaves players a reason to
   take that risk. Rejected: the same bands as each mirrored kind, which pays the easy way in as
   much as the hard one; and about half, a starker trade.

7. **The handed-over logins keep working after the job closes (2026-11-22).** No new mechanism:
   the network stays reachable as every mission network does, and a leaked briefing stays a root
   door for good. This settles the question decision 2 left open. Rejected: the client revoking
   access when the job is paid or dropped, closer to practice but a contract-state check at the
   login door.

   **Where the words come from (revised at RED, 2026-11-22): a list of their own,
   `WHITE_HAT_PASSWORDS` in `JSHACK_SECRETS`.** Find-gaps had settled on a white-hat slice of the
   uncrackable pool, but measured at RED the pool's 52 words are drawn by every world box, fixed
   site and mission NPC, not only by the leak routes, so no slice of it is free. The leak routes'
   mechanism on a list of its own: `scripts/encode.ts` bundles only the list's hashes, root's hash
   is drawn in the bundle from them, and the server turns it back into the word for the briefing
   from `JSHACK_SECRETS`, as `leakedWord` does (`core/missions/missionLeak.ts`). `parseSecrets`
   refuses a word that is also uncrackable or in a list a player can read. The bundle holds only
   hashes, so the address without the briefing gives no root, and `/etc/passwd` stays the
   bundle's. A handed-over word opens white-hat boxes only, and no other number, box or digest
   moves. The cost is operational: the list is added to `JSHACK_SECRETS` locally and on Vercel
   (Preview and Production) before the PR's preview builds. Rejected: carving a slice from the 52
   and redirecting every other draw that lands on it, which hands about one uncrackable account in
   eight a new word and moves some contracts' shut hashes; reusing the shut words, which lets a
   cleanup word open a world box; the leakable slice, which would let a player accept and drop
   cleanup jobs for free to collect words that open black-hat leak-route roots with no break-in;
   and an HMAC under `MISSION_KEY_SECRET` (the first draft), which needs the server to lay root's
   `/etc/passwd` line.

8. **Cleanup: the briefing gives a symptom, never the file (2026-11-22).** It says what the
   client noticed, such as something answering on a port. `ps` shows the listener (`nc`, its
   port, the user who planted it), and the implant, disguised as an ordinary service script among
   real ones in the boot and schedule directories (`cron.d`, `init.d`, `systemd` and the like),
   names that port or its outside host in its text, so `grep -r` or reading those directories
   finds it. Decoy scripts sit beside it. Rejected: a briefing that names nothing, closer to real
   work but leaves a first-time player without a place to start; and one that names the path, as
   legacy's `ps` did, which makes the job trivial with a root login.

9. **Cleanup: the listener and the file are both required, each on its own (2026-11-22).** As
   legacy: a killed listener stays dead whether or not the file is there, and the client pays
   once both are gone, its miss naming what is left. No new mechanism. Rejected: a listener that
   lives as long as its file, laid back in after replay while the implant exists, which teaches
   persistence but adds a rule at every read door and reads like a bug when it respawns right
   after `kill`.

10. **A white-hat client pays only while its machines still boot (2026-11-22).** One rule for
    every white-hat kind: before the kind's own check, the client reads whether each machine in
    scope still boots (`canBoot`, the sabotage job's check the other way round). A bricked
    machine gets "You took our machine down. No money." Since a brick is permanent, that job can
    never pay, whoever bricked it, the contractor or someone holding the leaked briefing.
    Rejected: also requiring every service the machine was born running, more realistic but a
    per-kind definition of "its services" and a miss after a stray `systemctl stop`; and no such
    rule, which pays a defender who wrecked the box.

    Settled from the code, proposed:
    - A bricked machine loses the job for good and the job stays active until the contractor
      drops it, as on every black-hat kind (a bricked backdoor or destroy target never pays and
      is never closed by the client). Revised while planning (2026-11-22): the first draft had
      the mail close the job unpaid, which is a new state change in the mail path for one reply.
    - Cleanup is two-hop on one contract in three, as credential, destroy and wipe jobs are, the
      implant on the machine behind the front box, with a login for each.
    - "The file is gone" is the destroy job's rule: its path no longer holds the bytes laid there,
      so overwriting it counts as removing it.

11. **Cleanup's implants are legacy's catalog, adapted (2026-11-22).** The 24 templates on
    reachable roles (`docs/mission-ideas/white-hat-investigations.md` §2), in its six families,
    rewritten for v2's roles and voice, each naming the port and outside host the symptom leads
    to. The binary ones stay, read through `strings`; the router and switch templates go.
    Rejected: one family first and the rest in a later slice; and a new catalog.

12. **The same ten clients post white-hat work, as a middleman (2026-11-22).** A client hires the
    contractor on behalf of the company whose network it is ("our customer Halden …"), so the
    client's door, mail and handles stay as they are and only the pitches and briefings are new.
    A client that pays for attacks and defence alike fits the game's grey world. Rejected: the
    network's own company mailing the contractor, which needs a mailbox and client door for every
    target company; and a separate pool of security-minded clients.

    Settled from the code, proposed:
    - The proof is any mail to the client naming a wallet, as on every kind whose proof is the
      network's state; the client reads the machines on every mail and closes a completed job
      without reading them again.
    - Each white-hat kind takes its share of the kind draw at one edge as it ships, as every kind
      before it did, so no number changes between older kinds.
    - The rest of each later kind (its target, plant, check and miss wording) is grilled when its
      story starts, on top of decisions 1–3, 6, 7, 10 and 12, which every white-hat kind shares.

### Close the door (grilled 2026-11-22)

The portforward job's mirror: a forward someone wrote into the router's `rules.v4` exposes one of
the customer's machines. Measured first: a mission router forwards 3–4 ports, all onto one box;
the client reads the router's routing (`machineServing`), not the file's text; and a `deny` in a
router's own INPUT filter does not stop a forward.

13. **The briefing names the machine, never the port (2026-11-22).** "Someone opened a way into
    their customer database from outside, and nobody there did it. Shut it." The forward is found
    by reading `rules.v4` for the one onto the service's port, or by scanning the public address
    for the port that answers as the service. Rejected: naming the port, which makes the job
    deleting one line; and naming nothing, an audit with no symptom.

14. **Every other forward must keep working (2026-11-22).** Otherwise `rm` of `rules.v4` does the
    job with no hunt. The briefing states it as a rule, never a method ("Leave the rest of what
    their router forwards as it is."), as cleanup's states "leave the machine running". Not
    permanent: a forward put back and a fresh mail can still pay. Rejected: the boot rule alone,
    which leaves nothing to hunt.

15. **Only the router is in scope, with one login: root on the router (2026-11-22).**
    `ssh root@<address>` on the router's own `:22`, its hash drawn from `WHITE_HAT_HASHES` on a
    stream of its own. The router has no route (handed over) and safe firmware; the exposed
    machine stays sealed, as on a portforward job. Rejected: also handing over the machine's
    login, which opens closing the port on the machine itself (a `deny`, or stopping the service
    the client wants kept).

16. **Shut means no public port reaches the machine's service port, through anyone's forward
    (2026-11-22).** The client reads the router's routing over every forward, not the one laid:
    moving the forward elsewhere counts, and so does shadowing its port with a listener on the
    router. A router `deny` does not count, since it stops no forward, and a fresh forward onto
    the service's port from anyone keeps the job unpaid.

17. **The machines are the portforward job's four (2026-11-22)**, with their ports: customer
    database 13306 to 3306, cache server 16379 to 6379, staff intranet 8080 or 8443 to 80,
    development server 2022 or 8022 to 22. The rogue forward is drawn on a stream of its own. The
    decoys are never the service's own kind (`EXPOSING_DECOYS`), so only one forward reaches the
    service's port.

18. **Single-hop only (2026-11-22).** The door is on the router, so a front box adds nothing. Pay
    is the white-hat single-hop band, 300–1,200 (decision 6).

19. **The boot rule reads the router (2026-11-22).** Decision 10 applies: a bricked router gets
    "You took our machine down. No money." and the job stays open until dropped.

20. **The replies, the first row that fits (2026-11-22):**

    | The mail                                    | The reply                                                                                 |
    | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
    | No accepted job with this client            | "We have no contract with you."                                                           |
    | A completed job                             | "That job is already closed." (nothing read)                                              |
    | The router no longer boots                  | "You took our machine down. No money."                                                    |
    | A forward still reaches the service's port  | "Their customer database still answers from outside. Still open, no money."               |
    | Another forward no longer reaches its place | "That's not all you closed. Something they use no longer answers from outside. No money." |
    | Shut, the rest intact, with a wallet        | "It's shut. §300 sent to jsc…. Thank you for the help."                                   |
    | Shut, the rest intact, no wallet            | the no-wallet form; completed, nothing minted                                             |

    The miss never names the port, or one free mail would undo decision 13, and the second never
    says which forward broke, as a portforward job's miss never says which.

21. **The terms (2026-11-22):** `<Client> — close a way into a customer database — §<pay>`,
    posted as a middleman (decision 12): the briefing opens "Our customer is <Company>. Their
    network is at <address>." Three white-hat pitches per machine, twelve in all.

22. **The login keeps working after the job (2026-11-22).** Decision 7 applies: whoever holds the
    briefing can open the door again after the pay. Accepted.

23. **A thirteenth of the draw (2026-11-22).** Each older kind gives up an edge of one piece as
    before, so no number turns from one older kind into another. 27,720 does not split by 13, so
    `KIND_CUTS` moves to 360,360ths, 27,720 for each kind.

24. **`hireme.ts show` (2026-11-22)** prints `Kind: closedoor, <machine>, :<public> -> :<inside>`,
    the router's `Login: root / <word>` with its route as `none (handed over)`, and the other
    forwards tagged as ones to keep.

    Accepted risk: with every forward onto one box the hunt is shallow, spotting the line onto the
    service's port and touching no other. Set aside for `backlog.md`: the kept forwards reaching
    other machines on the LAN, so the hunt matches addresses to hosts with `nmap`, which needs new
    LAN boxes in the shape.

### Lock them out (grilled 2026-11-23)

The credential job's mirror: root's password on one of the customer's machines has leaked, and
the intruder used it. Measured first: a mission target's `/etc/passwd` holds root, one staff user
(uid 1000), `guest` (1001) and the machine's service account; uid 0 is root at login
(`userTypeFromPasswdFields`); ssh checks passwords only, nothing reads `.ssh`; `passwd <name>`
from a root shell on a foreign box rewrites the row on the server; there is no `userdel`.

25. **The intruder added an account with uid 0 (2026-11-23).** With root's word they laid one
    more row in `/etc/passwd`, disguised as a system account, so a contractor who only changes
    root's password has not locked them out. Nothing else is planted: no files, no `auth.log`
    lines. Rejected: the password alone, which is `ssh`, `passwd root` and a mail; the leaked word
    reused on several of the box's accounts, a chore more than a hunt; and an added account plus
    an implant, which overlaps cleanup.

26. **The handed-over login is the leaked word (2026-11-23).** The briefing gives root's login on
    the target with the word the intruder holds, so the job starts from exactly what they have.
    Decision 2 holds with no second word; decision 7 is turned round for this one login, since
    ending it is the job. Rejected: a clean word for a second admin account the customer keeps,
    a second draw and an extra row to explain.

27. **The added account carries the same word (2026-11-23).** The intruder reused what they had,
    so `cat /etc/passwd` shows root's hash twice, and the leaked word logs in as the added account
    and lands root. No new draw.

28. **The added row (2026-11-23).** Its name is drawn from about eight plausible system names
    (`sysadm`, `toor`, `operator`, `support`, `ntpd` and the like), never one the box already
    has; uid 0, gid 0, a fitting gecos and home, `/bin/bash`. Its place among the rows, never
    first, is drawn on a stream of its own, as close the door's rogue line is. It ships in the
    bundle, the trade close the door accepted for its rogue port.

29. **The machines are the credential job's seven (2026-11-23)**, in the key box's slot, each with
    its service account. Three lock-them-out pitches per machine, 21 in all.

30. **Two-hop on about one contract in three (2026-11-23)**, as credential and cleanup jobs are.
    The front box gets a white-hat login of its own on cleanup's stream; the target's root is the
    leaked word. Access is cleanup's: no route, safe releases, public `:2222` forwarded to the
    first box's `:22`. Pay is the white-hat bands, 300–1,200 and 1,200–2,400 (decision 6).

31. **Still open is one rule with one reply (2026-11-23).** The job is still open while the leaked
    word opens any account, root takes no password, or any account the customer did not have is
    in the file. Changing the added account's password or taking it off uid 0 does not count; it
    has to go. Anyone's edit counts, a rival's added account too. The reply never says which door
    is left.

32. **The customer's own accounts stay as laid (2026-11-23).** Every one of their rows must read
    as it did, root's hash aside, or a file holding only root would do the job with no hunt (the
    reason for decision 14). Root's new hash is any non-empty one but the leaked word's. Not
    permanent: a row put back and a fresh mail can still pay.

33. **The boot rule reads every machine in scope (2026-11-23).** Decision 10 applies.

34. **The replies, the first row that fits (2026-11-23):**

    | The mail                              | The reply                                                                                    |
    | ------------------------------------- | -------------------------------------------------------------------------------------------- |
    | No accepted job with this client      | "We have no contract with you."                                                              |
    | A completed job                       | "That job is already closed." (nothing read)                                                 |
    | A machine in scope no longer boots    | "You took our machine down. No money."                                                       |
    | Still open (decision 31)              | "Whoever has that password can still get into their backup server. Still open, no money."    |
    | One of their own rows gone or changed | "That's not all you changed. One of their own accounts no longer works as it did. No money." |
    | Locked out, with a wallet             | "They're locked out. §300 sent to jsc…. Thank you for the help."                             |
    | Locked out, no wallet                 | the no-wallet form; completed, nothing minted                                                |

35. **The terms and the briefing (2026-11-23):** `<Client> — lock an intruder out of a <machine> —
    §<pay>`, `… an internal <machine>` on two-hop, posted as a middleman (decision 12). The
    briefing says someone outside has root's password on the machine, asks to lock them out and
    to leave the customer's own accounts as they are, and gives the leaked word as the login. It
    never mentions an added account: the player learns the hard way.

36. **A fourteenth of the draw (2026-11-23).** 360,360 splits into 25,740 for each kind; each of
    the thirteen older kinds gives up 1,980 at the top of its largest piece, the lowest on a tie,
    so no number turns from one older kind into another.

37. **`hireme.ts show` (2026-11-23)** prints `Kind: lockout, <machine>`, each box's
    `Login: root / <word>` with its route as `none (handed over)`, and the added row with its
    place.

    Accepted risk: in a file of four or five rows a uid-0 line stands out, so the hunt is shallow;
    the lesson is that uid 0 is root, which a contractor who only runs `passwd root` misses. Set
    aside for `backlog.md`: Debian's stock system accounts on every box, so the row has something
    to hide among. To measure while planning: that root can remove a row with `nano /etc/passwd`
    on a mission box.

### Patch it (grilled 2026-11-23)

A new kind, on the CVE system (`docs/vulnerability-architecture.md`): one of the customer's
machines runs a service on a release whose hole lets anyone in as root, and the client pays to
have it moved off that release and nothing else moved. Measured first, at game day 134:

- Everything on a mission box that is not its way in sits on a `low` or `medium` release
  (`safeVersions`, as of `MISSION_ROUTE_DAY`, 111), each one a live hole granting a guest shell at
  most, so `apt list -u` on any target already lists several upgradable packages.
- The services with a `critical` release (a root-tier hole) published by day 111: `nginx` and
  `redis` (a full shell), `bind9` (two, the newer a full shell), `mysql` (a file read) and
  `vsftpd` (a directory listing). `openssh-server`, `snmp` and `apache2` have none. Every library
  has several `high` or `critical` releases, each a local root.
- A release laid at day 111 or earlier has its fix out by day 113 at the latest (the patch delay
  is 1–2 days), so the job can always be done. Today's newest release can itself be inside its
  own window: `libssl`'s and `vsftpd`'s are, at day 134.
- `apt upgrade <package>` moves one package; a bare `apt upgrade` moves every package a fix has
  shipped for.

Decision 4's "only works inside the patch-delay window" does not apply: the laid release's fix
has always shipped by the time a job is played.

38. **The hole is a service on the target, on its newest `critical` release by day 111
    (2026-11-23),** drawn from `nginx`, `redis`, `mysql`, `vsftpd` and `bind9`, as the
    msfconsole route draws its release (`criticalRouteVersion`). On a single-hop job the router
    forwards that service, so `nmap -sV` from home shows its CVE and `critical` before the job
    and the change after it. Rejected: a library hole, a local root only and invisible from
    outside; the router's firmware, whose move reboots the router and drops every session on it;
    and only the full-shell services, since all five are root-tier.

39. **The challenge is to move only what has to move (2026-11-23).** The briefing says the rest
    of the customer's software is certified on the versions it runs. The player reads
    `apt list -u` and its severities and runs `apt upgrade <package>`; a bare `apt upgrade` moves
    everything and is the collateral miss. Rejected: any upgrade paying, which is `apt upgrade`
    and a mail; and two holes to find, a chore more than a hunt.

40. **Patched is the package's release, as `apt` resolves it, later than the laid one
    (2026-11-23),** whatever is live on the day. A downgrade, a missing row or a stopped service
    each stay open. A hand edit to `9.9.9` resolves to the newest known release and counts, as
    lying buys exactly what being patched buys. Rejected: no root-tier hole live on the server's
    day, which moves with the clock and leaves a job unpayable for a day or two whenever the
    newest release is inside its own window; and on the newest release, which turns back the day
    a new release ships.

41. **The collateral miss is any other laid row on the target that no longer reads its laid
    version, or is gone (2026-11-23).** A row for a package installed since is free. The front
    box on two hops is read only for the boot rule (decision 10). Rejected: holding the front box
    to its versions too, a second job with no hunt in it.

42. **Two hops on one contract in three (2026-11-23),** as cleanup and lock them out: the target
    behind the front box, its service not forwarded, a login for each.

43. **The briefing names the machine, never the package, the port or the CVE (2026-11-23).** It
    says anyone can get in as root on their `<machine>`, hands over root, and asks to move only
    what has to move. Rejected: naming the CVE id, which makes the job a `grep`; and naming the
    service, which skips reading the severities.

44. **The replies, in lock them out's order (2026-11-23):**

    | The state                          | The reply                                                                                                     |
    | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
    | A machine in scope no longer boots | "You took our machine down. No money."                                                                        |
    | Still open                         | "Their <machine> still runs the release with that hole. Still open, no money."                                |
    | Another package moved or gone      | "That's not all you moved. Something else on their <machine> is no longer on the version they run. No money." |
    | Patched, with a wallet             | "It's patched. §<pay> sent to jsc…. Thank you for the help."                                                  |
    | Patched, no wallet                 | the no-wallet form; completed, nothing minted                                                                 |

45. **The white-hat pay (2026-11-23):** 300–1,200 JSC single-hop and 1,200–2,400 two-hop
    (decision 6).

46. **A fifteenth of the draw (2026-11-23).** 360,360 splits into 24,024 for each kind; each of
    the fourteen older kinds gives up 1,716 at the top of its largest piece, the lowest on a tie,
    so no number turns from one older kind into another.

47. **`hireme.ts show` (2026-11-23)** prints `Kind: patch, <machine>, <package> <version>`, the
    logins, and every package row on the target, the holed one tagged `(hole)`.

    To measure while planning: that `apt upgrade <package>` from a root shell on a mission box
    writes the manifest under the network's key and moves no other row, libraries included; and
    that every target role can carry each of the five services beside its decoys.

### Restore the record (grilled 2026-11-24)

The tamper job's mirror (legacy `db_fix`): someone got into a customer's records and changed one,
the true value sits in a backup on the same machine, and the client pays once the table reads as
it did. Measured first:

- The game's `mysql` has no `INSERT` (`SHOW`, `DESCRIBE`, `SELECT`, `UPDATE`, `DELETE`, `DROP`),
  and the datadir is one minified JSON line (`/var/lib/mysql/data.json`), so no row can be retyped
  by hand.
- A white-hat target's database accounts are shut (`shutStores`), and the database's accounts are
  its own, not the box's, so a handed-over root alone cannot `UPDATE`.
- No `diff`, `gzip` or `tar` ships; the text tools are `cat`, `grep`, `head`, `tail`, `wc`,
  `nano`, `cp` and `mv`.
- A tamper change already draws the true value (`from`), the changed one (`to`), the rows and the
  check (`recordsLookRight`). No mission box has a `/var/backups`.

48. **One value in the target table was changed, never a row erased (2026-11-24).** The tamper
    change reversed: the box is laid with the change's `to`, and the truth is `from`, the row as
    generated, so the change carries a motive (a failing grade raised to an A, a warrant
    cleared). Rejected: erased rows too, which only CSV storage could restore without `INSERT`, a
    carve-out; and a garbled value (`#ERR`), which a `SELECT` shows without the backup.

49. **The records are a tamper job's (2026-11-24):** the records box (`<stem>-files`), the
    setting, the storage (half database, half CSV) and the rows on tamper's streams, the action
    always a change. The box is handed over as every white-hat target is: the router forwards
    `:2222` to `:22`, nothing else is forwarded, and there is no route. Two hops on one contract in
    three, the records on the box behind the front box, a login for each.

50. **On database storage the briefing hands over the database login too (2026-11-24):** the
    application account, its hash drawn from the white-hat list as root's is, its word turned back
    by `whiteHatWord`. Rejected: cracking its hash out of the datadir, which is breaking in
    (decision 1); retyping the one-line datadir; and CSV storage only, which drops the SQL half.

51. **The backup is on the same box under `/var/backups`, root-only (2026-11-24).** It holds the
    three tables as they stood before the change and before the target table's newest 1–3 rows
    were added. On database storage it is a dump, `CREATE TABLE` and one `INSERT` per row, so
    `grep` finds a row; on CSV storage, a copy of the three CSVs. Rejected: a backup on another
    machine, a second login and hop; several dated backups to choose among; and a backup equal to
    the table but for the one value, which makes CSV storage a `cp`.

52. **The briefing describes the table, never the record (2026-11-24),** in the wipe job's words
    (`WIPE_DESCRIPTIONS`): someone got in and changed one of those records, their backup from
    before it is on the machine, and records have been added since that must stay. Never who, the
    value, the table's name or the backup's path. The hunt is comparing the table with the
    backup, and it cannot mislead: the change sits in a row both hold, the additions only in the
    live table. Rejected: naming the person, which makes the job a `grep`.

53. **Paid when the target table reads exactly as generated (2026-11-24):** every row in order,
    each value equal as text, the restored one after trimming. The two tables beside it are never
    read, as on a tamper job.

54. **The replies, in lock them out's order (2026-11-24):**

    | The state                                              | The reply                                                                                            |
    | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
    | A machine in scope no longer boots                     | "You took our machine down. No money."                                                               |
    | The changed value is still there, or the table is gone | "Their records still hold the change. Not restored, no money."                                       |
    | Restored, and anything else in the table differs       | "That's not all you changed. Other records on their <machine> no longer read as they did. No money." |
    | Restored, with a wallet                                | "The records are back. §<pay> sent to jsc…. Thank you for the help."                                 |
    | Restored, no wallet                                    | the no-wallet form; completed, nothing minted                                                        |

    The traps follow with no rule of their own. On CSV storage, copying the backup over the live
    file loses the rows added since for good, unless the player kept a copy first, so that job can
    never pay. On database storage, a loose `WHERE` (`WHERE student='…'` at a school) moves the
    student's other rows, which can be put back.

55. **The white-hat pay (2026-11-24):** 300–1,200 JSC single-hop and 1,200–2,400 two-hop
    (decision 6).

56. **A sixteenth of the draw (2026-11-24).** 360,360 does not split by sixteen, so the draw is
    taken in 720,720ths, every cut doubled, which is exact and moves no number. Each kind gets
    45,045; each of the fifteen older kinds gives up 3,003 at the top of its largest piece, the
    lowest on a tie, so no number turns from one older kind into another.

57. **The terms (2026-11-24):** `<Client> — restore a school record — §<pay>`,
    `restore an internal school record` on two-hop, the target `<Stem> <institution>`, and three
    pitches a setting, the client writing for its customer ("our customer Halden Academy …").

58. **`hireme.ts show` (2026-11-24)** prints `Kind: restore, <setting>`, the storage, the logins
    (root's, and the database's on database storage),
    `Restore: <names>: <column> <laid> -> <true>`, the backup's path and the rows added since.

## Facts the plan rests on (measured 2026-11-22)

- **The shape is drawn in the bundle** (`missionShape`, `core/missions/missionShape.ts`): a route
  from `ROUTES` on the shape stream, then versions, root hash and forwards from `drawRoute`.
  Growing `ROUTES` re-rolls every number's route, so a new way in must not join it. Portforward
  already branches on `missionKind(n)` before `drawRoute` with a shape of its own
  (`portforwardShape`), which is the precedent for a kind that is not reached by one of the six.
- **The hydra and leak routes already have the login a white-hat job needs**: a public `:2222`
  forwarded to the box's `:22` and `ssh root@<address> -p 2222`. On two-hop the front box takes
  that forward, and the inside box is reached on its own `:22` at its LAN octet. A leak route's
  root hash is drawn from `LEAKABLE_HASHES` and the server turns it into the word with
  `leakedWord`; the bundle holds only hashes.
- **The kind draw is `KIND_CUTS`**: 53 pieces in 27,720ths, eleven kinds at 2,520 each. A twelfth
  kind takes 2,310 by every older kind giving up 210 at the top of one piece, as each kind before
  it did. A draw past the last cut is portforward.
- **The seven target machines** (`core/missions/targetRoles.ts`) are `nvr`, `backup`, `mon`, `ci`,
  `lic`, `access` and `billing`, shared by sabotage, backdoor and credential jobs so a hostname
  never says which job a box is. Each brings pitches of its own.
- **A mission box's `/etc` is bare.** `buildMissionBoxFs` (`core/generation/missionKeyBoxFs.ts`)
  gives it `passwd`, its service configs and nothing under `cron.d`, `init.d` or `systemd`; world
  boxes have only `/etc/crontab` (`etcContent.ts`). The decoys are new content. The infiltrate
  boot script is the precedent: a company's own SysV script the server lays at `/etc/init.d` or
  `/etc/rc.d/init.d` (`core/missions/missionFileItem.ts`).
- **The server lays files on a contract box before the journal is replayed** (`withMissionFiles`,
  `core/network/missionBoxFiles.ts`, at the read, web, database and SNMP doors and the write
  gate), so a root's `rm` of a laid file sticks for the next reader. `missionFilePaths(ref)`
  (`missionLeak.ts`) lists each box's laid paths for the write gate.
- **A listener is a pidfile**, `/var/run/nc-<port>.pid` holding
  `nc:port=<n>,user=<name>,userType=<tier>` (`core/services/pidfile.ts`). `ps` lists it as `nc`
  with its user and port at any tier; `kill <pid>` removes it as root, its pid derived from the
  box and the port. Nothing restarts a killed listener, and `reboot` checks only `/boot`.
- **The hunt's tools ship on every mission box**: `grep`, `strings`, `ps` and `kill` are in
  `/bin` (`SYSTEM_UTILITY_NAMES`, `core/generation/binaries.ts`), so no `apt install` is needed.
- **`grep -r` skips binary files** and anything the shell may not read (`core/commands/grep.ts`),
  so a binary implant is found by listing the directories and reading it with `strings`, not by
  grepping. `ls -a` shows dot-files.
- **The client already reads a target as it stands** (`readTargetBox` in `answerClientMail`,
  `core/missions/clientMail.ts`): `listenerOn(fs, port)` is the backdoor check, the destroy check
  compares a path with the bytes the server laid, a chain job reads its front box, and a target
  that no longer boots answers as `absent`.

## Slice plan: Cleanup jobs

**Branch:** `feat/white-hat-cleanup` · **Delivery:** one independent PR against `main` ·
**Version:** v0.479.0 (minor, a new kind).

### Goal

A contractor accepts a cleanup job on their hireme.io board, logs in as root with the login the
briefing hands over, finds the listener and the implant behind it, gets rid of both, and is paid
when they mail the client.

### Slice 1: a twelfth kind, cleanup, paid once the listener and the implant are gone

**Value:** a player gets defender work: a job whose way in is given and whose difficulty is the
hunt.
**Path:** board offer → accept → briefing mail with root logins → `ssh` through the gateway's
`:2222` (and from the front box to the inside box on two-hop) → `ps`, `grep -r`, `ls`, `strings`,
`kill`, `rm` on the target → `mail` to the client → `answerClientMail` reads the target → reply,
pay minted.
**Class:** behavior change. **Required skills:** `tdd`, `testing`, `functional`, `refactoring`;
`mutation-testing` at PR readiness.

**What it builds:**

- **The kind.** `cleanup` joins `MissionKind` and takes a twelfth of `mission-kind-<n>`, each older
  kind giving up 210 at the top of one piece. No number turns from one older kind into another.
- **The white-hat login, in the shape.** A cleanup number still makes the route draw on the shape
  stream, so no stream moves, and is then given the login instead: root's hash from the white-hat
  list (decision 7), the gateway forwarding `:2222` to the box's `:22`, decoys filling the
  forwards as on every contract, every package on safe releases. On two-hop (the existing
  one-in-three `mission-template-<n>` draw) the front box gets the same login and forward, and
  the inside box its own root hash, reached on `:22` at its LAN address. `ROUTES` is unchanged.
- **The target** is the key box's slot, named for one of the seven machines on a stream of its own
  (`mission-cleanup-role-<n>`), with no storage. On two-hop it is the inside box.
- **What the server lays on the target**, drawn under `MISSION_KEY_SECRET` from the number so
  nobody makes it from the bundle: the implant, one of the 24 templates assigned to that machine,
  root-owned, in one of legacy's seven locations under `/etc` and nowhere else (confirmed in
  find-gaps, 2026-11-22): `/etc/cron.d`, `/etc/cron.daily`, `/etc/cron.hourly`, `/etc/init.d`,
  `/etc/network/if-up.d`, `/etc/systemd/system`, or `/etc` itself beside `rc.local` (legacy's
  "manual" deep paths in `/tmp`, `/var/tmp`, `/opt` and the like are dropped, so one tree holds
  the hunt, and its two "manual" templates, `php-fpm-worker` and `smbd-helper`, take a location
  from the seven); its listener's pidfile
  `/var/run/nc-<port>.pid`, the port one of the backdoor job's eight; and two to four ordinary
  decoy scripts from the same directories' pool that never name the port; and Debian's stock
  `.placeholder` in each cron directory (settled item 2). All of them are
  listed by `missionFilePaths` for the write gate.
- **The outside host an implant names** (confirmed in find-gaps, 2026-11-22) is a public address
  in the game's own world that no machine holds, drawn per contract with the implant: outside
  the 195 contract block (any 195 address can become an accepted contract) and outside every
  address the procedural world assigns. It answers nothing to `ssh`, `nmap` or `ping`, and never
  points outside the game. Rejected for now: a real in-game machine as the intruder's staging
  host, a lead for forensics later but a target no grill has designed; and a made-up hostname,
  which the world's DNS cannot resolve and which could match a real domain.
- **The terms:** `<Client> — clean up a build server — §<pay>`, `clean up an internal build
  server` on two-hop; pay 300–1,200 single-hop and 1,200–2,400 two-hop, rounded to 50, as the
  last draw on `mission-terms-<n>`. Three white-hat pitches per machine, in the client's voice as
  a middleman for the target company.
- **The briefing** names the target company, the machine and the port, and hands over the
  login(s). It never names a path, `ps`, `kill` or the implant's family. Draft:

  ```text
  Our customer Halden Freight needs a hand. Something on their build server
  answers on port 4444, and nobody there put it there. Find what runs it,
  stop it, and get it off the machine.

  They have given you root:

    ssh root@195.12.40.7 -p 2222
    password: <word>

  Leave the machine running. If it no longer boots, there is no money.
  Write to this address with your wallet address once it is gone.
  Still there, no money. No wallet, no money.
  ```

  On two-hop the login is the front box's, followed by "The build server is inside their
  network, at 192.168.211.23. From the edge machine: `ssh root@192.168.211.23`, password:
  <word>". The address is the inside box's on the contract's own LAN, whose `/24` comes from its
  ESSID as every network's does (`lanSubnetPrefix`), so the briefing reads it from the shape.
- **The client's check**, first row that fits:

  | The mail | The reply | What changes |
  | --- | --- | --- |
  | No accepted job with this client | "We have no contract with you." | nothing |
  | A completed job | "That job is already closed." (nothing read) | nothing |
  | A machine in scope no longer boots (the target; the front box too on two-hop) | "You took our machine down. No money." | nothing; the job can never pay |
  | A listener still on the port | "Something still answers on port 4444. Still there, no money." | nothing |
  | The implant's path still holds the laid bytes | "It has stopped, but it is still on the machine. Still there, no money." | nothing |
  | Both gone, with a wallet | "It's gone. §650 sent to jsc…. Thank you for the help." | completed, the pay minted |
  | Both gone, no wallet | "It's gone. You sent no wallet, so there is nothing to pay. …" | completed, nothing minted |

  Anyone's `kill` and `rm` count, as anyone's brick does.

  **"Gone" is the destroy job's rule** (confirmed in find-gaps, 2026-11-22): the implant's path no
  longer holds exactly the bytes laid there, so deleting, overwriting and `mv` all count, and the
  same bytes put back count as still there. A moved copy is inert story, since nothing runs it
  outside its location. Rejected: scanning the whole tree for the laid bytes, truer to "get it
  off the machine" but a whole-tree read on every mail and a second rule beside destroy's.

  **Any listener on the briefed port is a miss** (confirmed in find-gaps, 2026-11-22), the backdoor
  job's `listenerOn` check: the client only knows the port answers, so a fresh `nc -l` there after
  the implant's listener is killed, the contractor's own or a griefer's through the leaked login,
  keeps the job unpaid until a root kills it. Rejected: counting only the laid listener, kinder
  but a distinction the client could not see, and a pidfile-content comparison.
- **`hireme.ts show`** prints `Kind: cleanup, <machine>`, the port, the implant's path and family,
  the decoys' paths, and the login word(s).

**Acceptance criteria** (to confirm with the owner before RED):

- [ ] A twelfth of numbers are cleanup jobs; every other number keeps its kind, shape, terms and
      LAN exactly (a sweep against `main` outside the cleanup share).
- [ ] A cleanup offer reads `<Client> — clean up a <machine> — §<pay>` (`an internal …` on
      two-hop), pays in the white-hat bands, and carries a white-hat pitch.
- [ ] The briefing's login opens root on the target (and on both boxes on two-hop), and nothing in
      the bundle yields the word or the implant's path.
- [ ] No white-hat word is held by any door outside white-hat boxes: `parseSecrets` refuses one
      that is also uncrackable or in a list a player can read, so no fixed site, world box,
      black-hat contract or leak route can draw it.
- [ ] Every implant's outside host is an address no machine holds: not in the 195 block and not
      one the world assigns, and `ping`, `ssh` and `nmap` to it reach nothing.
- [ ] On the target, `ps` shows the listener on the briefed port, `grep -r <port> /etc` finds a
      script implant and no decoy, and `strings` on a binary implant shows the port.
- [ ] The client answers each row of the table above, and pays only once both the listener and
      the implant are gone, whoever removed them.
- [ ] A root's `kill` and `rm` on the target hold for the next reader and the next mail.
- [ ] An `nmap` of the target from a hop on its LAN shows the briefed port open while the laid
      listener runs and closed once it is killed, so the box tells one story to `ps` and to a
      scan (the pidfile rule); the gateway forwards nothing to that port.
- [ ] With `JSHACK_SECRETS` or `MISSION_KEY_SECRET` unset, accepting a cleanup offer fails whole,
      as an infiltrate accept does: no briefing without its password is mailed, and the doors that
      lay the implant answer 500 `mission_secret_missing`.
- [ ] `show` prints the report above.

**RED:** unit tests through the public surfaces: the kind sweep and the cleanup share of
`missionKind`; `missionShape` for a cleanup number (forwards, hashes, two-hop logins); the laid
files from the server-side draw; `answerClientMail` for each row, over a target built with
`src/test/factories/patchedBox.ts` and the real `kill`/`rm` paths; the terms and briefing text.
**GREEN:** the minimum per row. **REFACTOR:** assess after each green; the briefing's login
block is the first thing later white-hat kinds reuse, so keep it in one place once a second
caller exists, not before.
**Wire-check:** `scripts/testMissionCleanup.ts` against `vercel dev` + local supabase: accept with
`scripts/hireme.ts`; the login opens root through `:2222` (and inside on two-hop); each miss
reply; `kill` and `rm` through the real doors; the paid reply and the mint; a bricked target's
reply; and every other mission and hireme wire-check still green.
**Pre-PR:** mutation on the changed lines; `npm run typecheck`, `npm run lint`, the full unit
suite, `npm run build` (the bundle budget).
**Close-out:** one browser run on a fresh player, a single-hop and a two-hop cleanup job worked
end to end; a "Cleanup jobs" section in `missions-architecture.md`; a `project-status.md` entry;
the script jobs and any twists set aside go to `backlog.md`.

### Risks

- **The catalog is the bulk of the PR.** 24 implants, the decoy pool and 21 pitches are content.
  The grill kept the whole catalog in one slice (decision 11); if the PR outgrows a review, the
  binary implants could become a second PR, which needs the owner's say-so.
- **Implant text is story, never working code.** Each implant reads as a believable service
  script whose lines name its port, outside host and purpose, inert like the infiltrate boot
  script. It is written in the main thread, not by subagents, which have been cut off copying
  the game's malware content before.
- **Accepted contracts move.** A twelfth of numbers become cleanup jobs, so some accepted prod
  contracts change kind. Only test accounts and a bot play on prod, so this costs nothing yet.

### Settled while planning

These came out of planning, not the grill, and each changes what gets built.

1. ✅ **By fit, three or four per machine (2026-11-22).** Each template goes to the machine its
   disguise suits best (legacy's IoT ones to `nvr` and `access`, file-server ones to `backup`,
   database ones to `billing`, web ones to `ci` and `mon`), its disguise renamed where needed, so
   every machine's implants look like they belong. Rejected: any implant on any machine, which
   loses the believable disguise half the hunt rests on; and cleanup's own machines from
   legacy's roles, whose hostnames would say which job a box is.
2. ✅ **About half the implants are dot-named (2026-11-22).** A coin flip per contract under
   `MISSION_KEY_SECRET`, so a plain `ls` misses the implant and `ls -a` shows it. It mostly
   hardens the binary implants, which `grep -r` skips; whether `grep -r` walks dot-files is to be
   confirmed in RED. Rejected: never, which leaves the disguise as the only cover; and always,
   which makes any dot-file in those directories a tell.

   **Narrowed in find-gaps (2026-11-22) so a dot-file is never a tell.** Every cron directory on
   a cleanup target (`/etc/cron.d`, `/etc/cron.daily`, `/etc/cron.hourly`) always holds the stock
   `.placeholder` Debian ships there, whatever the implant, so `ls -a` always shows dot-files and
   a dot-named implant sits among them. The coin flip applies only when the implant's location is
   one of those three; in `/etc/init.d`, `/etc/systemd/system`, `/etc/network/if-up.d` and `/etc`
   itself it is always plainly named and hides among the decoys. Rejected: dot-named decoy
   scripts, which are odd in themselves and widen the pool; accepting the tell; and dot-names in
   every location, a lone dot-file where Debian ships none.
3. ✅ **`ps` shows the listener under a service account (2026-11-22).** It is the machine's own
   service account, drawn per contract, written into the pidfile as
   `user=<account>,userType=user`. An account like that running `nc` is out of place, a second
   clue for a sharp player that fits the story of a broken-into service. A mission box's
   `/etc/passwd` holds root, guest and one NPC user today, so RED confirms the account appears
   there too (adding it, or falling back to the NPC user), and that `kill` stays root-only
   whatever the listener's user. Rejected: `root`, which blends in and leaves the briefed port
   as the only lead.

### Gaps closed (find-gaps, 2026-11-22)

- [Blocker → decision 7, AC] The handed-over words come from a white-hat slice no other door holds
  (revised at RED: a list of their own in `JSHACK_SECRETS`, since every door draws from all 52).
- [Blocker → What it builds, AC] An implant's outside host is an in-game address no machine holds.
- [Blocker → What it builds] Implants sit in legacy's seven `/etc` locations only.
- [Should → reply table] "Gone" is the destroy job's path rule; a moved implant counts.
- [Should → reply table] Any listener on the briefed port is a miss.
- [Should → settled item 2] Cron directories always hold `.placeholder`; dot-names only there.
- [Should → AC] An inside `nmap` agrees with `ps` about the briefed port.
- [Should → AC] Accepting with a secret unset fails whole.
- [Nice → briefing draft] The two-hop inside address is on the contract's own `/24`.
- Checked clean: the hunt's tools are on every mission box.

## Slice plan: Close-the-door jobs

**Branch:** `feat/white-hat-closedoor` · **Delivery:** one independent PR against `main` ·
**Version:** v0.480.0 (minor, a new kind).

### Goal

A contractor accepts a close-the-door job on their hireme.io board, logs in to the customer's
router as root with the login the briefing hands over, finds the forward that exposes the machine
the briefing names, takes it out and nothing else, and is paid when they mail the client.

### Facts this slice rests on (measured 2026-11-22)

- **The portforward job is the template.** `portforwardShape` (`missionShape.ts`) branches on
  `missionKind` before the route draw, seals the target in the key box's slot, fills its forwards
  with decoys never of the service's own kind (`EXPOSING_DECOYS`), and sets `gatewayAdminHash`,
  `routerRoute` and `routerVendor`. Its four machines, their ports and pitches are `MACHINES` in
  `core/missions/portforwardJob.ts`, drawn on `mission-portforward-<n>`.
- **The client already reads the router** (`readRouter` beside `readTargetBox`,
  `core/missions/clientMail.ts`; `handleResolveMail` replays its journal over
  `materializeApGatewayFs` and answers `absent` when it no longer boots), and `machineServing`
  decides which machine a public port reaches. A router's own listener on a port wins over a
  forward there; a `deny` line is not read by it (`parseInputDenies` is read only by a box's own
  `portsOpenToNetwork`).
- **The forwards are written real first, decoys after** (`withDecoys`, `pointedAt`), so a rogue
  forward laid as the "real" one would always be the top line of `rules.v4`.
- **Cleanup's briefing login block** is `cleanupLoginLines` (`core/hireme/contracts.ts`): the word
  through `whiteHatWord`, "They have given you root:", the `ssh` line and the password. This kind
  is its second caller.
- **`KIND_CUTS`** holds 65 pieces in 27,720ths, 2,310 per kind; 27,720 does not split by 13.

### Slice 1: a thirteenth kind, close the door, paid once no public port reaches the machine's service and every other forward still works

**Value:** a second defender job, whose challenge is choosing the one line to take out.
**Path:** board offer → accept → briefing mail with the router's root login → `ssh root@<address>`
onto the router's own `:22` → `cat /etc/iptables/rules.v4`, a public scan or an `nmap` of the LAN →
`nano` the rules → `mail` to the client → `answerClientMail` reads the router → reply, pay minted.
**Class:** behavior change. **Required skills:** `tdd`, `testing`, `functional`, `refactoring`;
`mutation-testing` at PR readiness.

**What it builds:**

- **The kind.** `closedoor` joins `MissionKind` and takes a thirteenth of `mission-kind-<n>`:
  `KIND_CUTS` moves to 360,360ths (every cut times 13), and each of the twelve older kinds gives
  up 2,310 at the top of its largest piece, the lowest on a tie, as cleanup's split did. No number
  turns from one older kind into another; numbers in the gaps become close-the-door jobs.
- **The job** (`closeDoorJob`, on a stream of its own, `mission-closedoor-<n>`): one of the
  portforward job's four machines and a public port from its `publicPorts`, read from the same
  table so the two kinds cannot drift. Twelve white-hat pitches of its own, three per machine, in
  the client's voice as a middleman.
- **The shape** (`closeDoorShape`, branching before the route draw as portforward does): single
  hop always. The target sits sealed in the key box's slot exactly as on a portforward job (its
  service on a safe release, its decoys never the service's kind). The router's root is drawn
  from `WHITE_HAT_HASHES` on `mission-closedoor-login-<n>`, its `routerRoute` and `routerVendor`
  are `null`, and its firmware stays on the safe versions. Its forwards are the decoys onto the
  target plus the rogue one, `:<public>` to the machine's inside port, at a drawn position among
  them (settled item 1).
- **The terms:** `<Client> — close a way into a <machine> — §<pay>`, pay 300–1,200 rounded to 50
  as the last draw on `mission-terms-<n>`.
- **The briefing** names the company, the address and the machine, never the port, the rules
  file, `iptables` or `nano`, and hands over the router's login through the login block cleanup
  built, moved to one place now that it has a second caller. Draft:

  ```text
  Our customer is Halden Freight. Their network is at 195.12.40.7.
  Someone opened a way into their customer database from outside, and nobody there did it.
  Shut it. Leave the rest of what their router forwards as it is.
  They have given you root on their router:
    ssh root@195.12.40.7
    password: <word>
  Leave the router running. If it no longer boots, there is no money.
  Write to this address with your wallet address once it is shut.
  Still open, no money. No wallet, no money.
  ```

- **The client's check** (`checkClosed`, reading the router with `readRouter`), the first row
  that fits:

  | The mail | The reply | What changes |
  | --- | --- | --- |
  | No accepted job with this client | "We have no contract with you." | nothing |
  | A completed job | "That job is already closed." (the router is not read) | nothing |
  | The router no longer boots | "You took our machine down. No money." | nothing; the job can never pay |
  | Any public port reaches the machine's inside port | "Their customer database still answers from outside. Still open, no money." | nothing |
  | A kept forward no longer reaches its machine and port | "That's not all you closed. Something they use no longer answers from outside. No money." | nothing |
  | Shut, the rest intact, with a wallet | "It's shut. §650 sent to jsc…. Thank you for the help." | completed, the pay minted |
  | Shut, the rest intact, no wallet | "It's shut. You sent no wallet, so there is nothing to pay. …" | completed, nothing minted |

  "Reaches" is `machineServing` over every public port a forward in the router's `rules.v4`
  names, so anyone's forward counts, a forward moved to another machine or port is shut, a
  listener on the router shadowing the port is shut, and a `deny` on the router changes nothing.
  "Kept" is each forward the shape lays other than the rogue one, read at its public port.
- **`hireme.ts show`** prints `Kind: closedoor, <machine>, :<public> -> :<inside>`, the rogue
  forward's position in `rules.v4`, `Router: none (handed over)` and its `Login: root / <word>`,
  the kept forwards tagged `(keep)`, and the target's services.

**Acceptance criteria** (to confirm with the owner before RED):

- [ ] A thirteenth of numbers are close-the-door jobs; every other number keeps its kind, shape,
      terms and LAN exactly (a sweep against `main` outside the new share).
- [ ] A close-the-door offer reads `<Client> — close a way into a <machine> — §<pay>`, pays
      300–1,200 to the nearest 50, and carries one of the kind's twelve pitches.
- [ ] The briefing names the machine and never the public port, and its login opens root on the
      router at `ssh root@<address>`; nothing in the bundle yields the word.
- [ ] The router's `rules.v4` holds the rogue forward at a drawn position among the kept ones:
      over 2,000 numbers it takes every slot, first in roughly a quarter to a third of them.
- [ ] Before any change, a public scan of the address shows the rogue port answering as the
      machine's service.
- [ ] The client answers each row of the table above: still open while any forward reaches the
      service's port (including a fresh one onto it from anyone), and still open after a router
      `deny` of the port; the collateral miss after a kept forward is removed or moved, and paid
      once it is put back; paid after the rogue line is removed, moved, or shadowed by a router
      listener.
- [ ] A bricked router gets the boot-rule reply on every later mail.
- [ ] With `JSHACK_SECRETS` lacking the white-hat list, accepting fails whole, as a cleanup accept
      does: no briefing without its password is mailed.
- [ ] `show` prints the report above.

**RED:** unit tests through the public surfaces: the kind sweep and the new share of
`missionKind`; `missionShape` for a close-the-door number (the router's hash, null route, the
rogue forward's position, the target sealed); `answerClientMail` for each row over a router built
from the shape with the real `rules.v4` editors (`withForward`, `withInputDeny`) and a pidfile
listener; the terms and briefing text; `show`.
**GREEN:** the minimum per row. **REFACTOR:** the login block moves to one place serving both
white-hat kinds; `portforwardJob` and `closeDoorJob` read one machine table. Assess the rest after
each green.
**Wire-check:** `scripts/testMissionCloseDoor.ts` against `vercel dev` + local supabase: accept
with `scripts/hireme.ts`; the login opens root on the router; a public scan shows the rogue port
as the service; each miss through the real router writes; the paid reply and the mint; a bricked
router's reply; and `testMissionPortforward.ts`, `testMissionCleanup.ts`, `testMissionBoard.ts`
and every other mission and hireme wire-check still green.
**Pre-PR:** mutation on the changed lines; `npm run typecheck`, `npm run lint`, the full unit
suite, `npm run build` (the bundle budget; raise the ceiling if the kind needs it).
**Close-out:** one browser run on a fresh player, a close-the-door job worked end to end including
one collateral miss put right; a "Close-the-door jobs" section in `missions-architecture.md`; a
`project-status.md` entry; a valleynews story if the owner asks.

### Risks

- **Accepted contracts move.** A thirteenth of numbers become close-the-door jobs, so some
  accepted prod contracts change kind. Only test accounts and a bot play on prod.
- **The hunt is shallow** (decision 24, accepted): every forward lands on one box, so the rogue
  line is the one onto the service's port. The deeper version is in `backlog.md`.
- **Two kinds share the machine table.** A change to a portforward machine changes the
  close-the-door job on it too; that is wanted (the same machine reads the same everywhere), and
  each kind's own stream keeps the draws apart.

### Settled while planning

1. ✅ **The rogue forward sits at a drawn position among the kept ones (2026-11-22).** A mission
   router writes its real forwards first, so a rogue forward laid as the real one would always be
   the top line of `rules.v4`, a tell. Its index is drawn on a stream of its own,
   `mission-closedoor-place-<n>`, uniform over the 3 or 4 slots. Taken on the owner's standing
   instruction to adopt the recommendation; reversible before RED. Rejected: always first, the
   tell; always last, the same tell the other way round.

## Slice plan: Lock-them-out jobs

**Branch:** `feat/white-hat-lockout` · **Delivery:** one independent PR against `main` ·
**Version:** v0.481.0 (minor, a new kind).

### Goal

A contractor accepts a lock-them-out job on their hireme.io board, logs in to the customer's
machine as root with the leaked word the briefing hands over, changes root's password, finds and
removes the account the intruder added, leaves the customer's own accounts alone, and is paid when
they mail the client.

### Facts this slice rests on (measured 2026-11-23)

- **Cleanup is the template.** `cleanupShape` (`missionShape.ts`) hands every box in scope a root
  drawn from `WHITE_HAT_HASHES` on a login stream of its own, route `null`, safe releases, no
  services but sshd, and forwards public `:2222` onto the first box's `:22`; on two hops the
  front box comes from `drawTopology` as every two-hop contract's does. The client's
  `checkCleanup` branch (`clientMail.ts`) already reads the target and, on two hops, the front
  box, with the boot rule first.
- **The key box's `/etc/passwd`** (`buildMissionBoxFs`, `generation/missionKeyBoxFs.ts`) is root,
  one staff user drawn from the generic username pool (uid 1000), `guest` (1001), and the
  machine's locked service account (`*`, uid 999, `nologin`), which today is laid on cleanup
  targets only.
- **Logins read the box's rows as they stand.** `admitToDoor` (`sessions/doorAdmission.ts`) takes
  the first row with the name and admits on `md5(password)`; uid 0 is root
  (`userTypeFromPasswdFields`). An empty hash never admits at ssh, but `su` and `passwd` treat it
  as password-less and skip the prompt.
- **`passwd <name>` from a root shell on a foreign box** is the server's `passwdChange`
  (`api/sessions.ts`), composed against the box's journal; the credential wire-check proves a
  password set this way logs in and pays. There is no `userdel`; a row is removed with `nano
  /etc/passwd`, an ordinary root write (`api/patches.ts` gates only the server-laid paths).
- **Names.** `operator`, `support` and `admin` are in the generic username pool, so the intruder's
  names come from a list of their own, disjoint from every username pool and every service
  account: `sysadm`, `toor`, `ntpd`, `syslogd`, `dbus`, `systemd-sync`, `sshd-agent`, `netadm`
  (none is in `pools/usernames.ts`).
- **`KIND_CUTS`** holds 77 pieces in 360,360ths, 27,720 per kind; 360,360 splits into fourteenths
  of 25,740. Each kind's largest piece, the lowest on a tie: closedoor 27,720–30,030 (twelve tied
  at 2,310), cleanup 33,306–36,036, chain 51,779–55,055, wipe 104,676–108,680, destroy
  187,187–192,192, credential 113,685–120,120, portforward 351,780–360,360 (the top of the draw),
  infiltrate 240,240–248,248, backdoor 192,192–201,929, file 210,210–226,620, and tamper,
  sabotage and key their single pieces.

### Slice 1: a fourteenth kind, lock them out, paid once the leaked word and the added account no longer let anyone in and the customer's own accounts read as laid

**Value:** a third defender job, whose challenge is knowing that a password change is not the
whole lockout: uid 0 is root, whatever the account is called.
**Path:** board offer → accept → briefing mail with the leaked word as root's login → `ssh
root@<address> -p 2222` (and on to the inside box on two hops) → `passwd root`, `cat
/etc/passwd`, `nano /etc/passwd` → `mail` to the client → `answerClientMail` reads the boxes →
reply, pay minted.
**Class:** behavior change. **Required skills:** `tdd`, `testing`, `functional`, `refactoring`;
`mutation-testing` at PR readiness.

**What it builds:**

- **The kind.** `lockout` joins `MissionKind` and takes a fourteenth of `mission-kind-<n>`: each
  of the thirteen older kinds gives up 1,980 at the top of its largest piece, the lowest on a tie
  (settled item 1). No number turns from one older kind into another.
- **The job** (`lockoutJob`, on `mission-lockout-<n>`): one of the credential job's seven machines
  (`TARGET_ROLES`), then the added account's name from the eight, then its place among the rows.
  Three lock-them-out pitches per machine, 21 in all, in the client's voice as a middleman.
- **The shape** (`lockoutShape`, beside `cleanupShape` and sharing what they have in common): the
  target's root, the leaked word, is the first draw on `mission-lockout-login-<n>`, the front
  box's the second on two hops; route `null`, safe releases, `:2222` onto the first box's `:22`.
  Two hops on the usual `mission-template-<n>` draw, about one in three.
- **The target's rows** (`buildMissionKeyBoxFs`): the machine's service account laid as on a
  cleanup target, and the added row at its drawn place, never first (settled item 3):
  `<name>:<root's hash>:0:0:<name>:/var/lib/<name>:/bin/bash`, the intruder having reused the word.
- **The terms:** `<Client> — lock an intruder out of a <machine> — §<pay>`, `… of an internal
  <machine>` on two hops, pay 300–1,200 single-hop and 1,200–2,400 two-hop to the nearest 50, the
  last draw on `mission-terms-<n>`.
- **The briefing** names the company, the address and the machine, says someone outside has
  root's password, never mentions an added account, a file or a tool, and hands over the leaked
  word through the shared login block. Draft (single hop):

  ```text
  Our customer is Meridian Records. Their network is at 195.85.65.53.
  Someone outside has root's password on their backup server, and nobody there gave it to them.
  Lock them out. Leave their own accounts as they are.
  This is the password they have. The customer has given you root with it:
    ssh root@195.85.65.53 -p 2222
    password: <word>
  Leave the machine running. If it no longer boots, there is no money.
  Write to this address with your wallet address once they are locked out.
  Still open, no money. No wallet, no money.
  ```

  On two hops the edge machine's login comes first, as on a cleanup job, then "The backup server
  is inside their network, at 192.168.70.138. This is the password they have. From the edge
  machine:" and the leaked word's login, and the warning names both machines.
- **The client's check** (`checkLockout`, reading the target and on two hops the front box), the
  first row that fits:

  | The mail | The reply | What changes |
  | --- | --- | --- |
  | No accepted job with this client | "We have no contract with you." | nothing |
  | A completed job | "That job is already closed." (nothing read) | nothing |
  | A machine in scope no longer boots | "You took our machine down. No money." | nothing; the job can never pay |
  | Still open | "Whoever has that password can still get into their backup server. Still open, no money." | nothing |
  | One of their own rows gone or changed | "That's not all you changed. One of their own accounts no longer works as it did. No money." | nothing |
  | Locked out, with a wallet | "They're locked out. §650 sent to jsc…. Thank you for the help." | completed, the pay minted |
  | Locked out, no wallet | "They're locked out. You sent no wallet, so there is nothing to pay. …" | completed, nothing minted |

  The rows are matched by name against the ones laid (settled item 2). "Still open" is root's
  hash still the leaked word's or empty, or any row whose name is not one of the customer's, or a
  second row with one of their names. "Gone or changed" is a customer's name with no row, or a
  row that differs from the laid one in any field but root's hash. Row order is free.
- **`hireme.ts show`** prints `Kind: lockout, <machine>`, each box's `Login: root / <word>` with
  its route as `none (handed over)`, the target's rows in order with the added one tagged
  `(intruder)`, and the target's services.

**Acceptance criteria** (to confirm with the owner before RED):

- [ ] A fourteenth of numbers are lock-them-out jobs; every other number keeps its kind, shape,
      terms and LAN exactly (a sweep against `main` outside the new share).
- [ ] A lock-them-out offer reads `<Client> — lock an intruder out of a <machine> — §<pay>`,
      pays in the white-hat bands to the nearest 50, and carries one of its machine's three
      pitches; about one in three is two-hop.
- [ ] The briefing gives the leaked word as root's login on the target, never mentions an added
      account, and on two hops gives the edge machine's own login first; nothing in the bundle
      yields either word.
- [ ] The target's `/etc/passwd` holds root, the staff user, `guest`, the service account and the
      added uid-0 row with root's hash, at a drawn place: over 2,000 numbers the row takes every
      slot after root's, and its name is never one the box already has.
- [ ] Before any change, the leaked word logs in as root and as the added account, both landing
      root.
- [ ] The client answers each row of the table above: still open after `passwd root` alone,
      after changing the added account's password, after taking it off uid 0, after emptying
      root's hash, and with a further account added by anyone; the collateral miss after a
      customer's row is removed or changed, and paid once it is put back; paid after root's
      password is changed and the added row removed, in either order and with the rows reordered.
- [ ] A bricked target, or front box on two hops, gets the boot-rule reply on every later mail.
- [ ] With `JSHACK_SECRETS` lacking the white-hat list, accepting fails whole, as a cleanup accept
      does.
- [ ] `show` prints the report above.

**RED:** unit tests through the public surfaces: the kind sweep and the new share of
`missionKind`; `missionShape` and `buildMissionKeyBoxFs` for a lock-them-out number (the logins,
null routes, the added row's name, fields and place, the service account); `answerClientMail` for
each row over a target built from the shape with its `/etc/passwd` rewritten as `passwd` and
`nano` would leave it; the terms and briefing text; `show`.
**GREEN:** the minimum per row. **REFACTOR:** what `lockoutShape` shares with `cleanupShape`
moves to one place; the briefing's login block serves all three white-hat kinds. Assess the rest
after each green.
**Wire-check:** `scripts/testMissionLockout.ts` against `vercel dev` + local supabase: accept with
`scripts/hireme.ts`; the leaked word opens root on the target and as the added account; `passwd
root` through `passwdChange` and the still-open reply; the added row removed through a real
`/etc/passwd` write and the paid reply and mint; the collateral miss and its repair; a two-hop
job's front login; a bricked target's reply; and every other mission, hireme and wallet
wire-check still green.
**Pre-PR:** mutation on the changed lines; `npm run typecheck`, `npm run lint`, the full unit
suite, `npm run build` (raise the bundle ceiling if the kind needs it).
**Close-out:** one browser run on a fresh player, a lock-them-out job worked end to end through
the still-open miss after `passwd root` alone; a "Lock-them-out jobs" section in
`missions-architecture.md`; a `project-status.md` entry; a valleynews story if the owner asks.

### Risks

- **Accepted contracts move.** A fourteenth of numbers become lock-them-out jobs, so some
  accepted prod contracts change kind. Only test accounts and a bot play on prod.
- **The hunt is shallow** (decision 37, accepted): five rows, one with uid 0. The deeper version,
  Debian's system accounts on every box, is in `backlog.md`.
- **Rows by name.** A player who edits a customer's row and also adds one under a new name gets
  the still-open reply first, since still open is checked before collateral; each mail answers
  one thing, as every kind's does.

### Settled while planning

1. ✅ **Portforward gives up the top of the draw (2026-11-23).** Its largest piece is the tail,
   351,780–360,360, so by the rule every split has used its top 1,980 becomes lock-them-out and
   a draw past the last cut is now a lock-them-out job. Taken on the owner's standing instruction
   to adopt the recommendation (one rule, no carve-out); reversible before RED. Rejected: taking
   portforward's share from its second-largest piece to keep it on top, an exception to a rule
   that has held for twelve splits.
2. ✅ **The customer's rows are matched by name (2026-11-23).** A row whose fields changed is the
   collateral miss, not a foreign row, so a contractor who changed `guest`'s password hears what
   they did. Order is ignored, so a reordered file is the same file. Rejected: matching whole
   lines, which turns an edited customer row into a foreign one and answers it "still open".
3. ✅ **The added row's place is any slot after root's (2026-11-23)**, drawn on `mission-lockout-<n>`
   after the name. Root's row stays first, as every generated file has it, so the added row
   moving root down would be a tell of its own. Rejected: last always, a tell.
4. ✅ **An emptied root hash is still open (2026-11-23).** ssh never admits an empty hash, but
   `su` from any shell on the box skips the prompt for one, so it is a door. Rejected: counting it
   locked, which pays for a box where any user shell becomes root.

## Slice plan: Patch-it jobs

**Branch:** `feat/white-hat-patch` · **Delivery:** one independent PR against `main` ·
**Version:** v0.482.0 (minor, a new kind).

### Goal

A contractor accepts a patch-it job on their hireme.io board, logs in to the customer's machine as
root with the login the briefing hands over, finds the one package whose release lets anyone in
as root, moves that package and nothing else with `apt upgrade <package>`, and is paid when they
mail the client.

### Facts this slice rests on (measured 2026-11-23)

- **Cleanup and lock them out are the template.** `handedOverShape` (`missionShape.ts`) hands
  every box in scope a root from `WHITE_HAT_HASHES` on a login stream of the kind's own, route
  `null`, safe releases, sshd and decoys, and `:2222` onto the first box's `:22`; on two hops the
  front box comes from `drawTopology`. `checkLockout` (`clientMail.ts`) reads the target and on
  two hops the front box, the boot rule first, and builds the laid box with
  `buildMissionKeyBoxFs` to compare against.
- **The services a mission box can run** are `nginx` (`WEB_SERVER`), `vsftpd` (`FTP_SERVER`),
  `mysql` (`DATABASE_SERVER`), `snmp` (`SNMP_AGENT`) and `redis` (`CACHE_SERVER`). There is no
  name server, so `bind9` cannot be a target's hole without a new door (settled item 1).
  `sealedTarget`, the portforward job's machine, already runs one of them behind shut hashes
  (a shut database account and root for `mysql`, a shut lock for `redis`), and
  `EXPOSING_DECOYS` keeps a decoy of the same service off it.
- **The hole's release.** `criticalRouteVersion(key)` gives the newest `critical` release
  published by `MISSION_ROUTE_DAY` (111): `nginx` 1.28.7, `redis` 7.2.5, `mysql` 8.0.39, `vsftpd`
  4.0.1. Every fix has shipped by day 113. At day 134 `vsftpd`'s newest release is itself inside
  its patch delay (`high`), so an upgrade lands it on a newer hole; decision 40 pays it anyway.
- **The target's manifest** is laid by `withPackageManifest(tree, { versions })`
  (`missionKeyBoxFs.ts`) from the shape's versions: every library, `openssh-server`, `vsftpd`,
  and each running service's package, all on safe releases but the hole.
- **`apt upgrade <package>`** runs `planUpgrade(manifest, day, package)`
  (`core/cve/planUpgrade.ts`), which moves only that package's row, and writes the whole manifest
  through `env.patches.write`, so from a root shell on a hop it is a root write on that box. A
  bare `apt upgrade` moves every package a fix has shipped for: on a target that is nearly
  every row, since every safe release is a `low` or `medium` hole.
- **A release resolves** with `installedRelease(key, version, day)` (`packageTimeline.ts`): the
  newest release at or below the version, the start tuple for anything that is not one. Its
  `index` orders releases, so "later than the laid one" is a greater index.
- **`KIND_CUTS`** holds 90 pieces in 360,360ths, 25,740 per kind; fifteenths are 24,024, so each
  of the fourteen kinds gives up 1,716 at the top of its largest piece, the lowest on a tie:
  tamper 24,024–25,740, lockout 26,004–27,720, closedoor 31,044–32,760, cleanup 43,329–45,045,
  chain 58,344–60,060, sabotage 144,144–145,860, wipe 158,444–160,160, credential
  169,884–171,600, infiltrate 185,471–187,187, destroy 208,494–210,210, file 222,924–224,640,
  backdoor 259,510–261,226, key 294,294–296,010, portforward 356,664–358,380. The top of the
  draw, 358,380–360,360, stays lockout's, so the fallback past the last cut is unchanged.

### Slice 1: a fifteenth kind, patch it, paid once the holed package has moved forward and nothing else on the target has moved

**Value:** a fourth defender job, whose challenge is reading severity: `apt list -u` lists nearly
every package on the box, and only one of them lets anyone in as root.
**Path:** board offer → accept → briefing mail with root's login → `ssh root@<address> -p 2222`
(and on to the inside box on two hops) → `apt list -u`, `apt upgrade <package>` (or `nmap -sV`
from home on a single-hop job) → `mail` to the client → `answerClientMail` reads the boxes →
reply, pay minted.
**Class:** behavior change. **Required skills:** `tdd`, `testing`, `functional`, `refactoring`;
`mutation-testing` at PR readiness.

**What it builds:**

- **The kind.** `patch` joins `MissionKind` and takes a fifteenth of `mission-kind-<n>`, the
  fourteen pieces above. No number turns from one older kind into another.
- **The job** (`patchJob`, on `mission-patch-<n>`): one of the credential job's seven machines
  (`TARGET_ROLES`), then the holed service from the four, its release
  `criticalRouteVersion(package)`. Three patch-it pitches per machine, 21 in all, in the client's
  voice as a middleman.
- **The shape** (`handedOverShape` with `kind: 'patch'`): the target's root the first draw on
  `mission-patch-login-<n>`, the front box's the second on two hops; route `null`; the holed
  service running on its critical release behind shut hashes as on `sealedTarget`, every other
  package on a safe release; no decoy of the hole's own service. On a single hop the router
  forwards the hole's port beside `:2222` and the decoys; on two hops the hole is reached only
  from the front box. Two hops on the usual `mission-template-<n>` draw, about one in three.
- **The terms:** `<Client> — patch a <machine> — §<pay>`, `… an internal <machine>` on two hops,
  pay 300–1,200 single-hop and 1,200–2,400 two-hop to the nearest 50, the last draw on
  `mission-terms-<n>`.
- **The briefing** names the company, the address and the machine, says anyone can get in as root
  on it, never names the package, the port or the CVE, hands over root through the shared login
  block, and asks to move only what has to move. Draft (single hop):

  ```text
  Our customer is Meridian Records. Their network is at 195.85.65.53.
  Something on their backup server lets anyone in as root. It needs patching.
  Move only what has to move. The rest of their software is certified on the versions it runs.
  The customer has given you root:
    ssh root@195.85.65.53 -p 2222
    password: <word>
  Leave the machine running. If it no longer boots, there is no money.
  Write to this address with your wallet address once it is patched.
  Still open, no money. No wallet, no money.
  ```

  On two hops the edge machine's login comes first, then the inside address and the target's
  login from the edge machine, and the warning names both machines.
- **The client's check** (`checkPatch`, reading the target and on two hops the front box), the
  first row that fits:

  | The mail | The reply | What changes |
  | --- | --- | --- |
  | No accepted job with this client | "We have no contract with you." | nothing |
  | A completed job | "That job is already closed." (nothing read) | nothing |
  | A machine in scope no longer boots | "You took our machine down. No money." | nothing; the job can never pay |
  | Still open | "Their backup server still runs the release with that hole. Still open, no money." | nothing |
  | Another package moved or gone | "That's not all you moved. Something else on their backup server is no longer on the version they run. No money." | nothing |
  | Patched, with a wallet | "It's patched. §650 sent to jsc…. Thank you for the help." | completed, the pay minted |
  | Patched, no wallet | "It's patched. You sent no wallet, so there is nothing to pay. …" | completed, nothing minted |

  "Still open" is the holed package with no row, or a row whose release, resolved by
  `installedRelease` on the server's day, has an index at or below the laid one's (settled item
  3). "Moved or gone" is any other row of the laid manifest missing or reading another version
  string; a row the laid manifest never had is free.
- **`hireme.ts show`** prints `Kind: patch, <machine>, <package> <version>`, each box's
  `Login: root / <word>` with its route as `none (handed over)`, and the target's package rows in
  manifest order, the holed one tagged `(hole)`.

**Acceptance criteria** (to confirm with the owner before RED):

- [ ] A fifteenth of numbers are patch-it jobs; every other number keeps its kind, shape, terms
      and LAN exactly (a sweep against `main` outside the new share).
- [ ] A patch-it offer reads `<Client> — patch a <machine> — §<pay>`, pays in the white-hat bands
      to the nearest 50, and carries one of its machine's three pitches; about one in three is
      two-hop.
- [ ] The briefing gives root's login on the target (and on two hops the edge machine's first),
      never names the package, the port or the CVE, and asks to move only what has to move;
      nothing in the bundle yields either word.
- [ ] The target runs one of `nginx`, `redis`, `mysql` and `vsftpd` on its `critical` release
      and every other package on a `low` or `medium` one; over 2,000 numbers each of the four
      is drawn; no decoy runs the hole's service; on a single hop the router forwards its port.
- [ ] Before any change, `apt list -u` on the target lists the holed package as `critical` and
      upgradable, among the others, and `nmap -sV` from outside shows it on a single-hop job.
- [ ] The client answers each row of the table above: still open before anything, after the hole
      is downgraded, and after its service is stopped; the collateral miss after a bare `apt
      upgrade` and after another row is removed or pinned elsewhere, paid once it is put back;
      paid after `apt upgrade <package>`, and after the version is hand-edited past the newest.
- [ ] A bricked target, or front box on two hops, gets the boot-rule reply on every later mail.
- [ ] With `JSHACK_SECRETS` lacking the white-hat list, accepting fails whole, as a cleanup accept
      does.
- [ ] `show` prints the report above.

**RED:** unit tests through the public surfaces: the kind sweep and the new share of
`missionKind`; `missionShape` and `buildMissionKeyBoxFs` for a patch-it number (the logins, null
routes, the hole's service, version and forward, the decoys, every other release safe);
`answerClientMail` for each row over a target built from the shape with its manifest rewritten as
`apt` would leave it; the terms and briefing text; `show`.
**GREEN:** the minimum per row. **REFACTOR:** whether the running-service-behind-shut-hashes
part of `sealedTarget` serves both kinds; assess the rest after each green.
**Wire-check:** `scripts/testMissionPatch.ts` against `vercel dev` + local supabase: accept with
`scripts/hireme.ts`; root over `:2222`; a mail before anything still open; a real manifest write
moving the hole and the paid reply and mint, once, then closed; a bare upgrade's collateral miss
and its repair; a downgrade still open; no wallet completing unpaid; a two-hop job's front login
and the inside machine patched; a bricked target's and a bricked edge machine's reply; and every
other mission, hireme and wallet wire-check still green.
**Pre-PR:** mutation on the changed lines; `npm run typecheck`, `npm run lint`, the full unit
suite, `npm run build` (raise the bundle ceiling if the kind needs it).
**Close-out:** one browser run on a fresh player, a patch-it job worked end to end through the
collateral miss after a bare `apt upgrade`; a "Patch-it jobs" section in
`missions-architecture.md`; a `project-status.md` entry; a valleynews story if the owner asks.

### Risks

- **Accepted contracts move.** A fifteenth of numbers become patch-it jobs, so some accepted prod
  contracts change kind. Only test accounts and a bot play on prod.
- **A bare `apt upgrade` cannot be undone with `apt`.** `apt install pkg=<version>` pins each
  moved package back, one per row, so the repair after the collateral miss is many commands or a
  hand edit of the manifest. Accepted: it is the lesson, and the miss says what to look for.
- **Anyone can root the target through the hole** on a single-hop job, since the router forwards
  it, and a rival who bricks it loses the job for good (decision 10). The briefing's login
  already hands root to whoever reads it, so nothing new is exposed.
- **The newest release can be holed.** A job paid on `vsftpd` today leaves the box on a `high`
  release inside its own window; decision 40 accepts it.

### Settled while planning

1. ✅ **`bind9` is dropped from decision 38: the hole is one of `nginx`, `redis`, `mysql` and
   `vsftpd` (2026-11-23).** Taken by the owner while planning. Mission boxes run no name server, so `bind9` would need a new door
   (the daemon, its zone files, its port on the router). Rejected: building that door for one of
   five draws.
2. ✅ **Each older kind gives up 1,716 at the top of its largest piece, the lowest on a tie
   (2026-11-23),** as every split before. The top of the draw stays lockout's, so a draw past the
   last cut is still a lock-them-out job.
3. ✅ **"Later" is a greater release index, resolved on the server's day (2026-11-23).** The
   manifest's version is resolved with `installedRelease`, as every reader of a box's exposure
   resolves it, so `9.9.9` reads as the newest release and `banana` as the start tuple.
   Rejected: comparing version strings, which calls `9.9.9` and `1.28.10` by their characters.
4. ✅ **No decoy runs the hole's service (2026-11-23),** as `EXPOSING_DECOYS` keeps one off a
   portforward target: two daemons cannot share a port.

## Slice plan: Restore-the-record jobs

**Branch:** `feat/white-hat-restore` · **Delivery:** one independent PR against `main` ·
**Version:** v0.483.0 (minor, a new kind).

### Goal

A contractor accepts a restore-the-record job on their hireme.io board, logs in to the customer's
records machine as root with the login the briefing hands over, finds the backup under
`/var/backups`, compares it with the live table to find the one record someone changed, puts that
value back and nothing else, and is paid when they mail the client.

### Facts this slice rests on (measured 2026-11-24)

- **Patch it is the template.** `handedOverShape` (`missionShape.ts`) takes the kinds
  `cleanup`, `lockout` and `patch`, draws every root in scope from `WHITE_HAT_HASHES` on
  `mission-<kind>-login-<n>` (the target's first, the front box's after it), and forwards `:2222`
  onto the first box's `:22`. `withHole` shows how a target gains a running service and its
  stores. `checkPatch` (`clientMail.ts`) reads the target and on two hops the front box, the boot
  rule first, then the kind's miss.
- **The records are drawn and laid already.** `missionRecords(n)` draws the setting, the three
  tables and the target on tamper's streams; its action comes from `missionAction(n)`, half erase
  where the setting erases, so a restore job needs the change draw whatever that stream says. The
  server lays a records box's datadir (`datadirFile`) or root-only CSVs (`recordsFilesLaid`) in
  `missionFiles` (`missionLeak.ts`), keyed on `keyBoxKind` being `tamper` or `wipe`, and lists the
  paths in `missionFilePaths` for the write gate. `recordsStorage(n)` is the storage, on its own
  stream. `keyBoxSuffix` already falls through to `files`, so the box is `<stem>-files`.
- **The database login.** A database's credentials are `root` (shut) and an application account
  named from `MYSQL_USERNAMES` in `buildMissionKeyBoxFs`, with `database.accountHash` from the
  shape; on a white-hat target both come from `shutStores` today. `whiteHatWord` turns any
  white-hat hash into its word, so the application account's can be handed over as root's is. From
  a shell on the box the login is `mysql localhost <account>`, which prompts for the word.
- **Decoys.** `withDecoys(box, forwards, n, barred)` may add a database decoy on a single hop,
  which forwards `:3306`; a target running its own `mysqld` bars it, as a patch-it target bars
  its hole's service. `withInsideDecoys` already skips a door the box runs.
- **Where the changed row sits** (measured over 4,000 change draws): the target is the table's
  last row in 138 (3.5%), second to last in 127, third to last in 133; 3,602 have three or more
  rows after it.
- **The game's `mysql` has no `INSERT`,** the datadir is one minified JSON line, and no `diff`,
  `gzip` or `tar` ships (decisions 48–52).
- **`KIND_CUTS`** holds 107 pieces in 360,360ths, 24,024 per kind. Taken in 720,720ths each kind
  holds 48,048 and a sixteenth is 45,045, so each of the fifteen gives up 3,003 at the top of its
  largest piece, the lowest on a tie (720,720ths): tamper 45,045–48,048, patch 48,477–51,480,
  lockout 57,057–60,060, closedoor 77,077–80,080, chain 128,271–131,274, cleanup
  160,017–163,020, sabotage 285,285–288,288, credential 336,765–339,768, wipe 357,357–360,360,
  backdoor 396,895–399,898, file 442,845–445,848, key 585,585–588,588, destroy 627,627–630,630,
  portforward 653,037–656,040, infiltrate 671,601–674,604. Lockout's top piece, 716,760–720,720,
  ties its 56,100–60,060 and is the higher, so the fallback past the last cut stays lockout.

### Slice 1: a sixteenth kind, restore the record, paid once the changed value is back and nothing else in the table has moved

**Value:** a fifth defender job, whose challenge is comparing: the backup and the live table differ
in more than one place, and only one of those is the intruder's.
**Path:** board offer → accept → briefing mail with root's login (and the database's) →
`ssh root@<address> -p 2222` (on to the inside box on two hops) → `ls /var/backups`, `cat` the
backup and the table (`mysql localhost <account>` and `SELECT`, or the CSV) → `UPDATE … WHERE …`
or `nano` → `mail` to the client → `answerClientMail` reads the boxes → reply, pay minted.
**Class:** behavior change. **Required skills:** `tdd`, `testing`, `functional`, `refactoring`;
`mutation-testing` at PR readiness.

**What it builds:**

- **The kind.** `restore` joins `MissionKind` and takes a sixteenth of `mission-kind-<n>`, the
  draw taken in 720,720ths with every cut doubled and the fifteen pieces above. No number turns
  from one older kind into another.
- **The records** are a tamper change's (`missionRecords` with the change forced for a restore
  number): the setting, the three tables, the target row and its `from` (the truth) and `to` (what
  the intruder wrote). On `mission-restore-<n>`: how many of the target table's last rows were
  added since the backup, drawn 1–3 and capped at the rows after the target (settled item 1).
- **The shape** (`handedOverShape` with `kind: 'restore'`): the target's root the first draw on
  `mission-restore-login-<n>`; on database storage the target runs `mysqld` on a safe release, its
  application account the next white-hat draw and its database root shut, and a database decoy is
  barred; the front box's root after them on two hops. Route `null`, safe releases, `:2222` only
  besides the decoys. Two hops on the usual `mission-template-<n>` draw, about one in three.
- **What the server lays** on the target, root-only and in `missionFilePaths`:
  - the live table as generated with the target's cell set to `to`, in the datadir beside the two
    tables, or in the three CSVs at tamper's paths;
  - the backup: every table as generated less the target table's rows added since, the target's
    cell holding `from`. Database storage: `/var/backups/<stem>-records.sql`, a `-- MySQL dump`
    header, then for each table a `CREATE TABLE` naming its columns and one
    ``INSERT INTO `<table>` VALUES (…);`` per row, text quoted, numbers bare. File storage:
    the three CSVs under `/var/backups/records/` (settled item 2).
- **The terms:** `<Client> — restore a school record — §<pay>`,
  `restore an internal school record` on two hops (`a`/`an` by the setting's noun, as
  tamper's), the target `<Stem> <institution>`, pay 300–1,200 single-hop and 1,200–2,400
  two-hop to the nearest 50, and three restore pitches per setting, 24 in all, in the client's
  voice as a middleman.
- **The briefing** names the company and the address, describes the table in the wipe job's words,
  says one record was changed and the backup from before is on the machine, says records added
  since must stay, and hands over the logins. Draft (single hop, database storage):

  ```text
  Our customer is Halden Academy. Their network is at 195.85.65.53.

  Someone got into their records of what each student scored in each subject and changed one.
  Their backup from before it happened is on the machine. Put that record back as it was.
  They have added records since the backup. Those stay as they are.

  They have given you root:
    ssh root@195.85.65.53 -p 2222
    password: <word>
  Their database login, from that machine:
    mysql localhost <account>
    password: <word>
  Leave the machine running. If it no longer boots, there is no money.
  Write to this address with your wallet address once it is put back.
  Not restored, no money. No wallet, no money.
  ```

  On file storage the database lines are left out. On two hops the edge machine's login comes
  first, then the inside address and the target's login from the edge machine, then the database
  login from the inside machine, and the warning names both machines.

- **The client's check** (`checkRestore`, reading the target and on two hops the front box), the
  first row that fits:

  | The mail                                         | The reply                                                                                          | What changes                   |
  | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------ |
  | No accepted job with this client                 | "We have no contract with you."                                                                    | nothing                        |
  | A completed job                                  | "That job is already closed." (nothing read)                                                       | nothing                        |
  | A machine in scope no longer boots               | "You took our machine down. No money."                                                             | nothing; the job can never pay |
  | No row reads as the changed one did, or no table | "Their records still hold the change. Not restored, no money."                                     | nothing                        |
  | Restored, and the table differs anywhere else    | "That's not all you changed. Other records on their machine no longer read as they did. No money." | nothing                        |
  | Restored, with a wallet                          | "The records are back. §650 sent to jsc…. Thank you for the help."                                 | completed, the pay minted      |
  | Restored, no wallet                              | "The records are back. You sent no wallet, so there is nothing to pay. …"                          | completed, nothing minted      |

  "Restored" is some row of the live table equal to the generated target row, each value equal as
  text and the restored one after trimming. "Anywhere else" is the live table not holding exactly
  the generated rows in order, as `recordsLookRight` reads a change. The CSV is read as tamper's
  is. The two tables beside it are never read.

- **`hireme.ts show`** prints `Kind: restore, <setting>`, the storage and the table (or its CSV
  path), each box's `Login: root / <word>` with its route as `none (handed over)`, the database
  login on database storage, `Restore: <names>: <column> <to> -> <from>`, the backup's path, and
  `Added since: <n> rows`.

**Acceptance criteria** (to confirm with the owner before RED):

- [ ] A sixteenth of numbers are restore-the-record jobs; every other number keeps its kind,
      shape, terms and LAN exactly (a sweep against `main` outside the new share).
- [ ] A restore offer reads `<Client> — restore a <setting> record — §<pay>`, pays in the
      white-hat bands to the nearest 50 and carries one of its setting's three pitches; about one
      in three is two-hop; each of the eight settings and both storages are drawn over 2,000
      numbers.
- [ ] The briefing gives root's login on the target (and on two hops the edge machine's first)
      and on database storage the database login, describes the table, and never names the
      person, the value, the table, the file or the backup's path; nothing in the bundle yields
      any of the words.
- [ ] On the target, root reads the backup under `/var/backups` and the live table; the two differ
      in the target's one value and in the rows added since, and nowhere else. On database
      storage `mysql localhost <account>` with the handed-over word opens the database, and no
      decoy answers on `:3306`.
- [ ] The client answers each row of the table above: still changed before anything and after the
      table is deleted or dropped; the collateral miss after the backup is copied over the live
      CSV, and after an `UPDATE` with a loose `WHERE`, paid once the other rows are put back where
      they can be; paid after `UPDATE … WHERE` the one row, and after a `nano` edit of the one
      value, with spaces around it.
- [ ] A bricked target, or front box on two hops, gets the boot-rule reply on every later mail.
- [ ] With `JSHACK_SECRETS` lacking the white-hat list, accepting fails whole, as a cleanup accept
      does.
- [ ] `show` prints the report above.

**RED:** unit tests through the public surfaces: the kind sweep and the new share of
`missionKind`; `missionShape` and `buildMissionKeyBoxFs` for a restore number (the logins, the
database and its accounts, the barred decoy, null routes); `missionFiles` for the live table and
the backup on both storages; `answerClientMail` for each row over a target built from the shape
and the laid files with the table edited as `UPDATE`, `cp` or `nano` would leave it; the terms and
briefing text; `show`.
**GREEN:** the minimum per row. **REFACTOR:** whether the restore check and `recordsLookRight`
share one reading of "the generated rows, one cell asked for"; assess the rest after each green.
**Wire-check:** `scripts/testMissionRestore.ts` against `vercel dev` + local supabase, one
database-storage and one file-storage number: accept with `scripts/hireme.ts`; root over
`:2222`; the backup readable at its path; a mail before anything still changed; the database
login and a real `UPDATE` through the statement door, or a real CSV write, and the paid reply and
mint, once, then closed; the backup copied over the live CSV and its collateral miss; a loose
`UPDATE` and its miss; no wallet completing unpaid; a two-hop job's front login and the inside
records restored; a bricked target's and a bricked edge machine's reply; and every other mission,
hireme and wallet wire-check still green.
**Pre-PR:** mutation on the changed lines; `npm run typecheck`, `npm run lint`, the full unit
suite, `npm run build` (raise the bundle ceiling: 67 B of headroom is left).
**Close-out:** one browser run on a fresh player, a restore job worked end to end on database
storage through the loose-`WHERE` miss; a "Restore-the-record jobs" section in
`missions-architecture.md`; a `project-status.md` entry; a valleynews story if the owner asks.

### Risks

- **Accepted contracts move.** A sixteenth of numbers become restore jobs, so some accepted prod
  contracts change kind. Only test accounts and a bot play on prod.
- **A copy over the live CSV is for good.** The rows added since exist nowhere else, so a player
  who copies the backup without keeping the live file first can never be paid (decision 54).
- **Comparing is by eye.** With no `diff`, the player reads 20–40 rows twice, across a dump and a
  `SELECT` on database storage. `grep` on a name narrows it once the player suspects a row.
- **The handed-over database login** opens the records to whoever reads the briefing, as root's
  login already does.

### Settled while planning (to confirm with the owner)

1. **No rows added since when the target is the table's last row (2026-11-24).** The count is
   drawn 1–3 and capped at the rows after the target, since a row added after the backup has no
   true value in it. About 3.5% of jobs end with none added, where copying the backup over the
   live CSV pays. Rejected: moving the added rows before the target, which puts newer ids ahead of
   an older row; and redrawing the target, which leaves tamper's records draw.
2. **The backup's paths (2026-11-24):** `/var/backups/<stem>-records.sql` on database storage, the
   three CSVs under `/var/backups/records/` on file storage, both undated. Rejected: a dated name,
   with no calendar a mission box keeps.
3. **The collateral reply says "on their machine" (2026-11-24),** since a records box has no role
   noun: "That's not all you changed. Other records on their machine no longer read as they did.
   No money."
4. **The database decoy is barred only on database storage (2026-11-24);** on file storage the
   target runs no `mysqld`, so a database decoy is a decoy as anywhere else.
