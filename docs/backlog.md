# v2 — deferred backlog & future content ideas

Forward-looking direction not yet built (preserved as pointers; design when actually built). Where
the project stands is in [`project-status.md`](./project-status.md); the working rules and
invariants are in [`conventions-and-gotchas.md`](./conventions-and-gotchas.md).

- **A scheduled guardian.** The guardian's rounds (`scripts/guardian.ts`, run by the
  `/guardian` skill) happen only when the owner invokes them, so players have no day to time an
  exploit to. Once the owner knows which rhythm feels right, a round could run on a timer. It
  needs production credentials in a cloud routine, and a rule for restores with nobody there to
  pick them (patch only, or restore only a brick).

- **Crypto wallet — follow-ups deferred.** The wallet epic shipped at v0.362.0 (as-built:
  [`wallet-architecture.md`](./wallet-architecture.md)). Four things were left out on purpose:
  **recognition**, the other half of a mission reward, to be designed with missions; **anything to
  spend JSC on**; **mission payouts**, which will call the operator mint; and **generated wallets
  as loot**, a world-content story that would reopen the rule that generated boxes hold no loot.

- **emailit.io's root view has a size ceiling.** Since v0.389.0 a root shell on emailit.io is
  served every account's mailbox, built from the email tables, and it re-reads that tree before
  every line. An inbox holds at most 100 messages of 4,000 characters (about 400 KB; most hold a
  few KB), and a Vercel response is capped at 4.5 MB, so the read fails at about 11 full inboxes or
  a few thousand ordinary ones, and the box then reads as unreachable to its root. Sends are held
  to 20 an hour per player, so nothing reaches it before launch. The fix when it is needed: serve
  the spool's listing (names and sizes) and fetch one mailbox only when it is read, a second read
  path through the shell, `cat`, `grep` and `scp`. Copying a mailbox home also meets the 65,536
  character signed-write cap (`MAX_SIGNED_PAYLOAD`).

- **Email — follow-ups deferred.** The email epic shipped at v0.389.0 (as-built:
  [`email-architecture.md`](./email-architecture.md)). Left out on purpose: **reporting and
  blocking** for player mail, and an **operator tool** to delete an abusive message or close an
  account (like `guardian.ts restore`), both before multiplayer is announced; a **local-mbox mode for
  `mail`** that reads `/var/mail/<user>` on the box when not logged in to emailit.io and comes
  preinstalled on NPC boxes with mail; an **`smtp` service on emailit.io** (port 25 in a scan,
  its own versions and CVEs); a **`/var/log/mail.log` on emailit.io**, one line per mail login
  with its source address, so whoever roots the box can see who reads which inbox from where (mail
  otherwise leaves no log line); and **mission-era NPC mail**, clients mailing players and the
  reverse.

- **talkit — follow-ups deferred.** The forum epic shipped at v0.414.0 (as-built:
  [`talkit-architecture.md`](./talkit-architecture.md)). Left out on purpose:
  - **Townsfolk threads**, the next piece of work after the epic: flavour and true leads,
    generated on the server from the world, so they cost no bundle bytes. Kept out of v1 because a
    content generator and its lead rules would have doubled the epic.
  - **Authors deleting their own posts.** It makes a good impersonation mechanic, since a stolen
    `~/.mailrc` could then delete its victim's posts, and it needs a slice of its own. Until then
    only the operator removes (`scripts/talkitRemove.ts`).
  - **Paging a long thread's comments.** Every comment is on the thread's one page, and the
    20-an-hour cap is what bounds it. Page it if a thread ever grows long enough to need it.
  - Reporting and blocking are owed before multiplayer is announced, as for mail (above).

- **hireme — the missions it waits for.** The contractor boards shipped at v0.422.0 (as-built:
  [`hireme-architecture.md`](./hireme-architecture.md)), every board saying no work is available
  yet. Left for the missions grill, all on top of the machines, the addresses and the lookup as
  they are:
  - **Job templates and per-handle instances**, a table keyed by handle, so a job a player
    completes leaves their own board and nobody else's. Places posting vacancies that say how they
    run (the old `hireit.io` idea) fit here.
  - **How a job is claimed and completed**, and whether somebody holding a leaked address can
    claim one.
  - **The wallet and the payout**, through the operator mint, paying whoever completes the job and
    names a wallet.
  - **What the root view adds**, beyond each handle's address.
  - A second, darknet operator stays open as later content.

- **valleynews — follow-ups deferred.** The paper shipped at v0.424.0 (as-built:
  [`valleynews-architecture.md`](./valleynews-architecture.md)), every story hand-written and
  posted by the operator. Left out on purpose:
  - **Headlines generated from the world** (the towns and their places), and **from what players
    did** (watching journals for bricks and defacements: "Copper Systems' site has been down since
    Tuesday"). Each is a content generator with its own rules, deferred as townsfolk threads were
    for talkit.
  - **The newest `/dev` headline at boot**, or as a line after `nmcli connect`, when the bundle has
    room: a box boots before it is on a network, and it needs a server read and client code.
  - **A `/latest` stream across sections, and paging**, cheap to add if asked for or if a section
    grows long enough.
  - **A small markup**, indented code blocks, if a `/dev` post ever needs one.
  - **Reporters with emailit.io inboxes**, and **an embargo queue a root could read** (a leaked
    story as a job): both mission-shaped.

- **More public websites — ideas, not yet grilled (2026-10-16).** The public web today is
  findit.io (search), mapit.io (the map), emailit.io (mail), hackademy.io and the public places'
  own sites. These are candidates to make Harrow Valley feel inhabited. Every name is a
  placeholder, and each site needs its own grill before it is planned.
  - **Inhabited world:**
    - ✅ **Local news** (`valleynews.io`): shipped at v0.423.0–v0.424.0 (#723–#724), widened to
      every announcement: the valley's news, the developer's notes and real-world security news,
      hand-written and posted by the operator; as-built
      [`valleynews-architecture.md`](./valleynews-architecture.md). Generated headlines, from the
      world and from what players did, are under "valleynews — follow-ups deferred".
    - ✅ **A forum** (`talkit.io`): shipped at v0.410.0–v0.414.0 (#708–#712), players posting
      to each other first; as-built [`talkit-architecture.md`](./talkit-architecture.md).
      Townsfolk talking about their WiFi, jobs and new routers is its next piece, under "talkit
      — follow-ups deferred".
    - ✅ **A jobs board**: built as hireme.io at v0.420.0–v0.422.0 (#719, #721, #722), each
      player's own contractor board behind a private address; as-built
      [`hireme-architecture.md`](./hireme-architecture.md). Places posting vacancies that say how
      they run is missions content, under "hireme — the missions it waits for".
    - **Reviews** (`rateit.io`): star ratings and comments on mapit's places, cheap to generate
      from the place data ("The Wi-Fi password is on the menu, lol").
  - **Ties to systems that already exist:**
    - ✅ **A JSC block explorer** (`chainit.io`): shipped at v0.393.0–v0.394.0 (#690–#691); its
      as-built is section 7 of [`wallet-architecture.md`](./wallet-architecture.md).
    - **A JSC shop** (`buyit.io`): something to spend JSC on, such as cosmetic themes or a vanity
      hostname. This answers "anything to spend JSC on" under crypto wallet follow-ups.
    - **A people directory** (`whoisit.io`): the `whois` data and the generator's people roles as
      web pages, with staff pages and who works where. It feeds deliberate rendezvous.
    - **Town council sites**: notices, opening hours and contacts for each town. It overlaps
      "Ridgemont's council keeps no town directory" (Ridgemont's is a landmark).
  - **Background texture:**
    - **Weather** (`weatherit.io`): seeded per town and day. Later content could depend on it.
    - **A status page** (`isitdown.io`): which public sites answer right now. It overlaps the
      deferred live map on mapit.io, since both read every town's journals.
    - **A paste site** (`pasteit.io`): townsfolk post config snippets and notes carelessly, a
      source of leads that fits players learning the hard way.
  - **The pick when this is taken up:** news, the forum and the block explorer. The first two
    make the world feel alive and give missions a channel. The third built on the shipped
    wallet and is done (2026-10-16), the forum is done (2026-10-20), and news remains.

- **Two system log lines landing together can lose one.** `appendMachineLog`
  (`patches/appendMachineLog.ts`) reads the log as a reader sees it, appends the line and writes
  the file back, so two appends to one log at the same moment can each build on the same read,
  and the second write drops the first one's line. Found in the talkit epic (2026-10-19), when
  `scripts/testTalkit.ts` fetched three talkit pages in parallel and `access.log` held two
  lines; the check now fetches them in turn. Every trace that goes through `appendMachineLog`
  shares it. In play it costs a log line now and then, when two visitors hit one site at once.
  The fix when it matters: an append that does not read first, such as a row per line or a
  database-side append. Agreed 2026-10-20 to take it as its own planned slice, not a small fix:
  a database-side append has to lock the log's path, re-read the latest row by the reader's
  ordering (`orderPatchesForReplay`, restated in SQL), and end with an `updated_at` later than
  the row it built on. The `patches_set_updated_at` trigger stamps `NOW()`, the transaction's
  START, so an append that waited on the lock would write a row a reader ranks below the one it
  built on; the slice has to change that stamp (`clock_timestamp()`) for every write. And every
  handler's
  `readLog`/`upsertPatch` deps (about 30 files and their test fakes) move onto it.

- **`resolveOccupantSweep.test.ts`'s bad-signature test fails in some full runs, and never
  alone.** "rejects an envelope whose signature does not verify" failed in 3 of 6 full runs on
  the talkit slice 1 branch (2026-10-19). Its tampering, replacing the signature's first byte
  with `00`, changes nothing 1 time in 256, which does not explain that rate. 2026-10-20: three
  full runs on `main` (10,108 tests each) all passed, so the rate did not reproduce. The 1-in-256
  hole was real (a `00`-leading signature, tampered so, verified) and is closed: the test and its
  twin in `resolveOccupantFetch.test.ts` now flip a bit through `withForgedSignature`
  (`src/test/factories/signedEnvelope.ts`). If it fails again, the cause is something else.

- **Lazy-load a large client piece so features stop meeting the bundle ceiling.** Every command
  and screen is in the main chunk, so each feature's client code counts against
  `BUNDLE_CEILING_BYTES` (`scripts/checkBudgets.ts`). Content was cut twice to make room, and
  talkit raised the ceiling's code part by 2,000 B instead (285,135 B of 286,975 B at
  v0.414.0). The lasting fix is to load lynx, nano or hackademy's pages on demand. It is its own
  piece of work, since box generation is synchronous.

- **The e2e skill's `type-command.sh` could not type a command holding `"` — RESOLVED
  2026-10-20.** `agent-browser eval` always prints the value as a JSON string, so every `"` inside
  came back as `\"` and the check refused to press Enter (seen in the talkit close-out on
  `curl -d "id=…&body=…"`). The script now decodes the eval result with `JSON.parse` before
  comparing, and compares against the command alone.

- **CLOSED (2026-10-07) — three wire-checks that failed for fixture reasons.**
  `testCrossPlayerConnectionTrace` already read the gateway's trace under `ap:<essid>` (fixed in
  #601; this entry outlived it). `testMysqlDeep` now cleans its gateway and deep box at teardown as
  well as setup, so `testExploitDeepChain` no longer meets the mysqld it left stopped (on day 78 both
  land on `android-164` behind INITECH-5G; 13/13 then 11/11 back to back, both orders).
  `testSharedApForwards` redraws B until the guest passwords differ (8/8, three runs).

- **Generated files too big to carry home — RESOLVED 2026-10-18 (v0.399.0).** Saving a file a
  player fetched (`ftp get`, `scp`, `cp` onto their own box) is one signed write, and
  `signedEnvelopeSchema` capped its payload at 8192 characters of JSON, so a larger file failed
  with `local: <path>: I/O error`. Measured over the whole world at v0.398.0 (619 networks, 3,812
  boxes): 1,143 files on 943 boxes were over it, 613 of those boxes with one a guest can read —
  `auth.log.1` on 612 (max 20,878), `data.json` on 435 (max 21,772, root), `mail.log.1` on 79,
  `syslog.1` on 15, and mapit's `ridgemont.html` and `kingsford.html`. The cap is now
  `MAX_SIGNED_PAYLOAD`, 65,536, and `carryHome.test.ts` sends the world's largest generated files
  through the real `createPatchApi`. Since v0.400.0 a write still over the cap (a live log grown
  by sweeps, a player's own huge file) is refused before it is sent, as `File too large` — in
  `createPatchApi` for a write and in `sessionsApi` for an exploit fire carrying a script's writes.
  - **Whole visits would fit in `vsftpd.log.1` again.** World-content slice 8b cut each upload to
    one line (no CONNECT or OK LOGIN around it) for the old cap; whole visits were 4–13K. Left as
    it is when the cap was raised; restoring them is a content change of its own.

- **A script's `fs.appendFile` took the file it added to — CLOSED v0.347.0.** It composed on the
  machine and named `baseContent`, but passed neither `owner` nor `permissions`, so `patches.write`
  stamped the script's session and tier defaults over an existing node. It now does what the
  shell's `>>` does (`conventions-and-gotchas.md` §6): one `stat` on the reloaded machine, and an
  existing node's owner and permissions travel with the write; a file the append creates is still
  the session's. `fs.writeFile` is untouched: it is a "this is mine" writer, as `>` is.

- **`grep` takes no stacked flags and no `-n` — DECIDED 2026-10-10, left as it is.** It accepts
  `-l`, `-c`, `-i` and `-r` one at a time, so `grep -ri x .` answers `unrecognized option: -ri`,
  and `-n` does not exist. The owner declined both: a command here takes the flags it takes and is
  not a 1:1 copy of the real one, because realism is weighed against playability and a command
  that grows toward the real one's surface complicates the game. A missing flag is therefore not
  a bug on its own; it becomes one when something the game shows the player (a tutorial, a planted
  history, a man page) types it.

- **`ssh`, `scp` and `ftp` could not reach your own box — RESOLVED 2026-10-09 (v0.341.0–v0.344.0,
  #637–#640).** `ssh root@localhost` answered `No route to host` with sshd running. At home the
  three doors now log into the own box client-side (`commands/ownBoxLogin.ts`): the daemon must hold
  the port, the password is checked against the box's own `/etc/passwd`, and the login lands in
  the door's own log as `127.0.0.1`. From a hop, `localhost` is sent on as `127.0.0.1` and lands on
  the hop. Chapter 5 shows the `localhost` examples again. Three gaps left behind are the next
  three items.

- **ftp transfers at home were not itemised in `vsftpd.log` — RESOLVED 2026-10-10 (v0.353.0).**
  `ftp localhost` logged the CONNECT and LOGIN lines from `127.0.0.1`, but a `get` or `put` that
  followed left no line, because `recordFtpTransfer` refuses the caller's own box: it reads the
  account off a session row, and a login the client answered has none. That refusal stays. The
  line is written by `appendAuthLog` instead (an `ftpTransfer` event), the action that already
  records the own-box login, told the account and the address that login was made with; the
  session carries the address (`Session.fromIp`) from the login to the transfer.
  `scripts/testOwnBoxLogin.ts` carries the five checks. Not played in the browser yet. One
  neighbour found on the way is the next item.

- **A trace's free-text fields could carry a line of their own, on another player's box —
  RESOLVED 2026-10-12 (v0.366.0).** Found by reading on 2026-10-10 as two handlers:
  `recordFtpTransfer` took `path` as any non-empty string and `recordPackageDowngrade` took
  the package name and both versions the same way. Proved first on the live stack, and wider
  than recorded: every trace writes what the caller sent, and a fetch `path` reaches another
  player's `access.log` with no session at all (`scripts/testOccupantFetch.ts` added two
  lines for one request). The fix is at the one place every trace lands,
  `appendMachineLog`: a line break inside a line is written out as `\n` or `\r`, so the line
  stays one line and the attempt is itself on record. Traces of several lines (a login's
  arrival and attempt, a sweep, a hydra run) now hand their lines over apart through
  `appendMachineLogLines` rather than joined, so the only breaks written are the ones between
  them. The two own-box appenders (`appendAuthLog`, `appendKernLog`) write a player's own log
  and are unchanged. Checks 13b in `testFtpCrossPlayer.ts` and `testAptDowngradeTrace.ts`, and
  8b in `testOccupantFetch.ts`. ✅ Played in the browser 2026-10-12: the traces of several
  lines still land a line each on another player's box (a 40-path sweep, an ftp arrival and
  login, a 79-attempt `hydra` run), and an ftp `get` is itemised on its one line. The game
  never sends a line break, so the escape itself is the wire-checks' to prove. The run also
  showed the ftp client greets with `220 (vsFTPd 3.0.3)` whatever release the box runs (it had
  4.1.2); the banner is a constant in `core/commands/ftp.ts`. ✅ Its neighbour, a field
  spoofing the columns that follow it WITHIN its own line (a path ending `", 0 bytes`), closed
  at v0.404.0: every field a caller typed or a player chose passes `escapeLogField` in its
  formatter, which spells out anything outside `[A-Za-z0-9/._:+~=?&%-]` as `\xNN`, so the
  timestamp, address and verdict the server stamped are the only ones on the line. A break
  inside such a field now reads `\x0a` rather than `\n`; the three checks above assert the new
  spelling. Proved live first (`scripts/testLogFieldEscaping.ts`, 1/4 before, 4/4 after). ✅
  Played in the browser 2026-10-18: a crafted ssh account, `curl` path, ftp account and ftp
  upload path each read escaped in the owner's logs beside the visitor's real address, and
  ordinary attempts read as before (`project-status.md` item 17).

- **The data doors resolved `localhost` to the gateway on a deep hop — RESOLVED 2026-10-10
  (v0.349.0).** Proved first on the live stack (`scripts/testHopDataDoors.ts`): `redis-cli
  localhost` from a box on a deep layer answered `host_unreachable`. On the gateway's own ssh
  port the reach returned the GATEWAY instead (seen in the unit test, not live), which is the box
  a `hydra localhost` from the deep one would have swept. `reachBox` (`core/sessions/serviceHost.ts`) took loopback's address from
  `ownLanSourceIp`, which is where the LAN sees the box. It now resolves it the way the login
  doors do (`segmentsReachedFrom(...)[0]`, the lease for a player's box), which covers `mysql`,
  `redis-cli`, `snmpwalk`/`snmpset`, `hydra` and the exploit session at once, and a switch in
  front of the layer no longer stands in loopback's way. Two neighbours found on the way are the
  next two items.

- **A data door over `localhost` obeyed the hop's own filter — RESOLVED 2026-10-18
  (v0.402.0).** Proved first on the live stack (`scripts/testLoopbackFilter.ts`): on a box whose
  owner denied the redis port in its own `rules.v4`, `redis-cli localhost` answered
  `service_not_running`, while the same deny correctly closed the box to the network — where the
  box's own seeded filter file promises "localhost is never filtered" and the login doors keep
  that promise (`reachDoor`'s `overLoopback`). `reachServiceHost` and the exploit session asked
  `portsOpenToNetwork` whatever vantage the request arrived over; they now read the pidfiles
  unfiltered when the reach came over loopback, carried on a new `ReachedBox.overLoopback` the
  reach already computes. The switch ACL (`deniedPorts`) was already zeroed over loopback, so only
  the box's own INPUT filter changed. The public and inner-gateway resolvers enforce the filter
  upstream, so those vantages are unaffected. Found 2026-10-10.

- **`curl localhost` on a deep box left no line in its own access log — RESOLVED 2026-10-10
  (v0.351.0).** Proved first on the live stack (`scripts/testLanFetchLog.ts`, on `cam-189`
  behind ACME-CORP's inner switch): the trace answered 200 and wrote nothing, because it
  resolved loopback to where the LAN sees the box, which is the gateway in front of it, and no
  gateway serves the web. `handleRecordLanFetch` (`core/network/recordLanFetch.ts`) now takes
  loopback in a shell on a generated box to mean the box the caller named and holds a session
  on (`generatedBaseFsForMachineId`), so nothing is looked up by address. The box's own ports
  decide, unfiltered, and no switch journal is read: a deny on the web port in front of the
  layer does not stop the line, as it does not stop the page. A player's workstation is still
  placed by its lease. Two neighbours found on the way are the next two items. Played in the
  browser 2026-10-10 on COPPER-SYSTEMS: `curl localhost` as root on `web-176`, one layer down,
  served the page and `cat /var/log/access.log` showed the one `127.0.0.1` line.

- **`curl localhost` in a shell on another player's box left no line there — RESOLVED
  2026-10-10 (v0.352.0).** Proved first on the live stack (`scripts/testLanFetchLog.ts`): a
  visitor holding a shell on a player's workstation fetched `localhost`, then the box's own LAN
  address, and both answered 200 and wrote nothing. The trace placed the box by its lease and
  then asked whether that address was the CALLER's own. `handleRecordLanFetch` now takes the
  workstation at the address when it is the caller's own or the one their shell stands on
  (`workstationTarget`), and files the line under the box OWNER's key, so the owner reads the
  visit in their own log and the visitor writes no row of their own. A third player's
  workstation, which nothing on the LAN serves to that shell, still gets no line. Played in the
  browser 2026-10-10: a second player on the owner's WiFi logged in as `guest`, ran
  `curl localhost`, and the owner's `cat /var/log/access.log` showed the `127.0.0.1` line (once
  the owner had run a command of their own; a defender gets no live tail). The journal holds one row, under the
  owner's key. The address half is not reachable in play; see the next item.

- **`curl <a player's LAN address>` answered `Could not resolve host`, from the LAN and from a
  shell on that box — RESOLVED 2026-10-11 (v0.354.0).** Found in the browser 2026-10-10 and
  decided a gap 2026-10-11: a web server a scan shows open answers a fetch from anywhere that
  can reach it, a player's workstation included. A scan of a neighbour on the WiFi showed
  their web port open and `curl` and `lynx` both said no such host existed, because a player's
  workstation is on no generated LAN and `locateHost` (`core/commands/webHost.ts`) finds no
  box at the address. The page is in the owner's journal, so the fetch is a server action,
  `resolveOccupantFetch` on `/api/network`, drawn on the gate the scan of a neighbour already
  draws (`resolveOccupantScan`): the caller stands on the network, the address is a lease
  whose holder is on the WiFi, the box boots, and the port is one it answers to the network
  with a web server behind it. A port the owner filtered refuses; a shell on the box itself
  reaches its own address past its own filter. The line lands in the owner's `access.log`,
  under the owner's key, from the address the server places the caller at. The client asks
  only for an address no box it can build holds (`fetchWebPage`, which `curl` now goes
  through as `lynx` and a followed link do), so a fetch of a generated box costs no round
  trip. An address nobody holds still answers `Could not resolve host`.
  `scripts/testOccupantFetch.ts` carries the eleven checks. Played in the browser 2026-10-11
  on QUIGLEY-WIFI: a second player on the owner's WiFi ran `curl http://<her address>`,
  `curl <her machine name>/admin/` and `lynx <her machine name>`, and each showed her page.
  From a guest shell on her box, `curl http://<its address>/status` served the page too. Her
  journal holds one `access.log` row, under her key, with each visit from the visitor's
  lease, or from her own address for the shell on her box. One neighbour found on the way is
  the next item.

- **`gobuster http://<a player's LAN address>` answered `Could not resolve host` — RESOLVED
  2026-10-11 (v0.355.0).** Found by reading 2026-10-11 and never reproduced in play: the sweep
  reached a box through `reachWebHost` alone and had no server path for a fellow occupant, so
  a neighbour's pages could be fetched one at a time and not swept. The sweep is now a server
  action, `resolveOccupantSweep` on `/api/network`, entering through the door the fetch of a
  neighbour enters (`resolveOccupantWebTarget`, shared by both), so what a scan shows open a
  sweep walks and what it shows shut refuses. The path list is read off the box the caller
  stands on and never sent, sizes come back and never pages, and every request the run cost
  lands in the owner's `access.log` as one append, under the owner's key, from the address
  the server places the caller at. A shell on the box itself sweeps its own address past its
  own filter, with the list on that box. `gobuster` asks the server only for an address no
  box it can build holds. `scripts/testOccupantSweep.ts` carries the eleven checks. Played in
  the browser 2026-10-11 in the same run: `gobuster http://<her address>` printed her three
  pages of the list's forty words, a port she serves nothing on was refused, and each run is
  41 lines under one stamp in her log (forty words, and the second request her directory
  cost). From the guest shell on her box, where she had installed the tool, the same sweep
  found the same three and is logged from her own address. Both boxes held the stock list, so
  the run does not show whose was read. One neighbour found on the way is the next item.

- **`gobuster http://<a player's machine name>` answered `Could not resolve host` — RESOLVED
  2026-10-11 (v0.356.0).** `curl` and `lynx` turn a fellow occupant's name into their address
  before they route on it (`addressForTarget`); `gobuster` resolved only the names a network
  generates, through `reachWebHost`, so a neighbour's box could be fetched by name and swept
  only by address. `gobuster` now takes the same step, on the network the shell stands on and
  as the box it runs on. An institution's domain resolves with it, so
  `gobuster http://ridgemont.edu` sweeps the address the domain names. The header keeps what
  was typed. An address, and a name the network generates, still cost no occupant round
  trip. No server change. Played in the browser 2026-10-11 in the same run:
  `gobuster http://nebula` and `gobuster http://nebula.quigley-wifi.lan` printed the three
  pages the sweep by address had, `gobuster http://nebula:8080` was refused at her address,
  a name nobody holds stayed unresolved as typed, and `gobuster http://ridgemont.edu` found
  seven paths. Two neighbours found on the way are the next two items.

- **A neighbour who named their box `localhost` took your loopback traffic — RESOLVED
  2026-10-12 (v0.364.0).** `addressForTarget` asked who was on the network for any target
  with a letter in it, `localhost` included, and a machine name may be `localhost`
  (`validateMachineName` allows it). `curl`, `lynx` and `gobuster` resolved the name before
  `reachWebHost` mapped loopback, so beside such a neighbour `curl localhost` fetched their
  box; `nmap`, `ping` and `msfconsole` at home took the same step. `addressForTarget` now
  hands a loopback name back as typed and asks nobody, which covers every command that
  calls it and saves each `curl localhost` an occupant round trip. The neighbour's box
  still answers to its full name, `localhost.<zone>.lan`. Client only. ✅ Played in the
  browser 2026-10-12 (v0.366.0): with a neighbour named `localhost` on BUY-N-LARGE, `curl
  localhost` and `gobuster http://localhost` answered from the player's own box, and `curl
  localhost.buy-n-large.lan` fetched the neighbour's page. One thing the run showed is the
  next item.

- **`ping localhost` and `ping 127.0.0.1` got no reply on your own box — RESOLVED 2026-10-19
  (v0.409.0, #707).** `ping` had no loopback step. The owner decided from what a real box does:
  `localhost` and all of `127.0.0.0/8` reply from the box itself, with or without a network, and
  `rules.v4` cannot block it. Left as it is: pinging the box's OWN LAN address still takes a LAN
  round trip (about 1 ms), where a real box routes it through `lo` at loopback speed.

- **In a visitor's shell on a player's box, `localhost` served less than the box does —
  RESOLVED 2026-10-12 (v0.363.0).** Seen in the browser 2026-10-11. The owner had published
  three pages as root, which `echo >` leaves readable by root alone. From a guest shell on
  her box, `curl localhost` answered 404 and `gobuster http://localhost` found 0 of 40,
  while her `access.log` recorded the same requests as `200`, and `curl` and `gobuster` at
  the box's own address or name, from the same shell, served all three. Loopback read the
  tree the client holds for the hop, which the server prunes to what the visitor's tier may
  read (`patches/readFilter.ts`); every other route asked the server, which reads the page
  as the web server does. Loopback there now asks the server too. `reachWebHost` no longer
  takes another player's workstation for a box this side holds (it is the box whose address
  the vantage cannot recover), so `curl`, `lynx`, a followed link and `gobuster` fall
  through to the fetch and sweep of a fellow occupant, sent the loopback address.
  `resolveOccupantWebTarget` takes that address to mean the workstation the caller's shell
  stands on, found by its machine id, past its own filter, and records the visit from
  `127.0.0.1` in the owner's log. The owner at home, and a shell on a box the network
  generates, still read the tree they hold. `scripts/testOccupantFetch.ts` (13/13) and
  `scripts/testOccupantSweep.ts` (12/12) carry the loopback checks, with the page readable
  by root alone and the shell a guest's. ✅ Played in the browser 2026-10-12 (v0.366.0): from
  a guest shell on the owner's box, `curl localhost` and `curl localhost/status` served the
  pages she published as root, `gobuster http://localhost` found 2 of 40, and her
  `access.log` holds those 42 requests from `127.0.0.1`, one line each. One thing it left
  behind is the next item.

- **`recordLanFetch` answered for a shell on another player's workstation, and no client
  asked it to — RESOLVED 2026-10-12 (v0.365.0).** Since v0.363.0 a fetch or sweep of the
  box a visitor's shell stands on is served and logged by `resolveOccupantFetch` and
  `resolveOccupantSweep`, by loopback and by address both. The arm of `workstationTarget`
  (`core/network/recordLanFetch.ts`) that took "the one their shell stands on", added at
  v0.352.0, was reached only by a request signed outside the game, where it wrote a
  second line for a visit the serving action had already recorded. It is gone: the trace
  takes a player's workstation only when it is the caller's own. Checks 10 and 11 of
  `scripts/testLanFetchLog.ts` now hold that such a request leaves no line. ✅ Played in the
  browser 2026-10-12 (v0.366.0): 44 requests against the owner's box, from the WiFi and from
  a shell on it, left exactly 44 lines in her `access.log`.

- **A visitor's shell on a player's box outlived the box's place on the network — RESOLVED
  2026-10-12 (v0.368.0).** Recorded 2026-10-10, by reading, as `curl localhost` in that shell
  leaving no line. Probed on the live stack first, and the recorded half was already gone:
  since v0.363.0 loopback there asks the server, which answers `host_unreachable` once the
  owner has left, so nothing is served. The open half was the defect. Nothing ended the
  visitor's session row, so the server went on placing them on that WiFi, at no address: from
  the shell on the departed box a fetch of a third occupant answered 200 and that occupant's
  `access.log` recorded it from `unknown`, as every door would. After `nmcli disconnect` and
  `nmcli connect <another network>` the shell read and wrote the box again, in ordinary play,
  with its tools still acting on the first WiFi. Decided with the owner the same day: leaving
  ends them. `handleUnregisterOccupant` now closes every other player's open row on the box
  (`network_left`) and every session opened from it (`upstream_lost`), as a reboot does; the
  owner's own rows on their box stay open, and a returning box does not bring the old sessions
  back. The visitor's next line prints `Connection to <box> closed by remote host.`: one hop
  deep on another player's workstation the shell now asks which of its sessions are open,
  which costs that shell one request a line. `scripts/testDisconnectedUnreachable.ts` carries
  the checks (13/13). Played in the browser 2026-10-14: a `guest` shell on the leaver's box
  printed the line on its next command. Three things were found on the way. One,
  the raw journal `listPatches` handed a session holder, closed at v0.374.0 (handbook chapter
  13). The other two are the next two items.

- **A player who leaves a WiFi kept the sessions they opened across it — RESOLVED
  2026-10-14 (v0.381.0).** Proved live first (`scripts/testLeaverSessionsClose.ts` against
  the old server: 5/13). After `nmcli disconnect`, and after a join that moved the box to
  another network, the leaver's shells on a neighbour's box and on a generated box stayed
  open; a request signed outside the game still read the neighbour's box as a shell there,
  wrote both boxes, and fetched a third occupant's page from the neighbour's box. Leaving
  now closes the leaver's open rows on every machine but their own (`network_left`) with
  every hop above them, beside the visitors' rows it already closed
  (`dropConnectionsThrough`, shared by the disconnect and the join); their rows on their own
  box stay open (13/13). The browser is told on the next line: a shell on any box but the
  player's own now asks which of its sessions are open, one hop deep on a generated box or a
  gateway included, which costs that shell one request a line. Played in the browser
  2026-10-14: a `root` shell on a generated site server closed on its next line once its
  player disconnected from a second terminal. One neighbour found on the way is the next item.

- **An `ftp>` prompt across the network after its owner leaves — RESOLVED 2026-10-18
  (v0.405.0).** Leaving closed the leaver's `ftp` rows with the rest, but the prompt never
  asked: it answered `ls`, `cd`, `pwd` and `get` from the tree fetched at login, `get`
  reporting `226 Transfer complete.`, and a `put` failed as `Permission denied`, until the
  player typed `quit`. The same held for every other way the server closes the row (the
  target leaving or rebooting, a flash, a lost upstream hop). Decided with the owner: before
  any non-empty line the prompt asks whether its row is still open, one request a line as a
  shell on another box pays, and a closed one prints
  `421 Service not available, remote server has closed connection.` and hands back the
  shell with the line unrun. An ftp login to the player's own box holds no row and asks
  nothing. No `api/` change: `listSessions` already lists open `ftp` rows. Played in the
  browser 2026-10-18: one `nmcli disconnect` closed the leaver's own prompt on a generated box
  and a visitor's prompt on the leaver's box, and each printed the `421` on its next line.

- **`nmcli connect <another network>` without a disconnect left the box on both — RESOLVED
  2026-10-14 (v0.380.0).** Proved live first (`scripts/testOneNetworkAtATime.ts` against the
  old server: 5/10, the box on both networks and a visitor still logging in on the first).
  Decided by the owner: a box is on one network at a time. `nmcli` refuses a connect to a
  second network while `wlan0` is associated, before the password is checked. The server
  holds the same rule for a request that skips the game, and for a disconnect whose
  fire-and-forget leave never landed: `registerNetwork` takes the box off every other network
  it occupies, closing its visitors' sessions and their chains as a disconnect does
  (`dropConnectionsTo`, shared with `unregisterOccupant`), rather than refusing the join, which
  would have stranded a player whose leave was lost. With one row per owner, handbook chapter
  13's stale-`updated_at` question went with it (10/10). Played in the browser 2026-10-14: a
  second `nmcli connect` while connected was refused, and the player held one occupancy row.

- **What a network was generated with is computable by any client. The accepted limit of the
  served-boxes work (owner, 2026-10-12).** The generators ship in the bundle, since `nmap`, the
  `ssh` preflight and the scans rebuild machines the player holds no session on. So the files a
  machine was generated with, its seeded password hashes included, can be computed from the
  ESSID without logging in. The server hides everything written to a machine afterwards:
  players' files, wallet keys, changed passwords, logs. Closing it means generating the world on
  the server alone, which rewrites every local resolver: several times the work that stopped
  here.
  - **A cheaper middle step was measured and dropped (owner, 2026-10-16).** Key the streams
    that draw credentials (`host-fs-` passwords, `wifi-pw-`, the gateway admins and
    communities, `mysql-db-`, `redis-store-`) with a server-only secret, and give the client
    a stub drawer that writes locked hashes. Usernames, services and content sit on other
    streams, so only passwords would re-roll. Every client reader of those values was traced:
    all but three already ask the server or read only open ports. The three were
    `aircrack-ng`/`nmcli` (the scan carries the plaintext), the player's own box (drawn from
    the uncrackable pool in the browser), and `msfconsole` scripts, which read a client-built
    tree. The owner dropped it on the third. The script read path was fixed at v0.395.0 (#692;
    as-built: the `script_exec` bullet in
    [`vulnerability-architecture.md`](./vulnerability-architecture.md)), which removes that blocker
    if this is reopened.
- **Script holes read the box as it stands — SHIPPED v0.395.0 (#692, 2026-10-17); one browser case
  deferred.** A blind `msfconsole` script hole now runs in two fires and reads the target's
  server-materialized tree (journal replayed) filtered to the granted tier, on every box a fire
  reaches, instead of a client rebuild (as-built: the `script_exec` bullet in
  [`vulnerability-architecture.md`](./vulnerability-architecture.md); milestone 13 in
  [`project-status.md`](./project-status.md)). The close-out browser run (2026-10-17) played the
  `/etc/passwd` root-password case end to end via the `--local systemctl` root hole and the network
  two-step on a generated box (hand-planted file kept under the script's append; two `auth.log`
  lines; `/root` not in the user-tier served tree). **Deferred to a later browser session:** the
  second listed close-out case — a script on a FELLOW OCCUPANT's box reading a file in their home. It
  needs a second player seated as an occupant with a staged `openssh-server 9.8.2` user-tier script
  hole and a `~/.wallet/wallet.dat`; alice fires a user-tier `ssh` script and the served tree should
  carry the wallet but not `/root`. It is already wire-check-proven
  (`scripts/testScriptHolesReadTheBox.ts`, section 2); only the in-browser play is pending. Note for
  whoever runs it: no root-tier NETWORK `script_exec` is live before ~game day 153 (nginx, openssh
  and mysql script holes are user-tier, redis user/guest today), so a network script's writes land
  only at user/guest tier — the root `/etc/passwd` path needs `--local systemctl` (libsystemd
  255.4.3, staged).
- **The password pools are in the public repo — RESOLVED 2026-10-18 (v0.396.0–v0.398.0).** The
  pools come from the `JSHACK_SECRETS` environment variable (no list in the repo, and no fake dev
  list: a missing value fails every gate), the uncrackable list was rotated since the old one is in
  git history, and the bundle carries that pool as md5s only, with `scripts/checkSecrets.ts`
  failing any build that ships an uncrackable word. See `docs/handbook/06-world-generation.md`.

- **A served tree is pulled whole before every line. Left as it is (2026-10-12).** A shell on
  any box that is not the player's own asks the server for the tree before each command, with
  no conditional fetch. Measured over 50 generated hosts on 5 networks: 20 to 102 KB raw
  (median 36), 2.5 to 19 KB gzipped (median 5.7), 1 to 4 ms to build and serialise. A
  conditional or cached fetch is the fix if it shows in play.

- **Several sessions on one machine: the newest open row sets the tier. Left as it is
  (2026-10-12).** A player who holds a `root` shell on a box and then opens a `guest` one there
  is served, and has their writes judged, at `guest` in both until the newer one closes. The
  write check already worked this way and the served tree follows it.

- **A LAN web fetch of a generated machine never read its journal — RESOLVED 2026-10-14
  (v0.382.0).** `curl` or `lynx` at a generated box on the caller's own LAN was answered from
  the tree the box was generated with, and so was `gobuster`. Probed live first: a defaced,
  deleted, stopped or bricked site server still answered its original page on its LAN, and
  `recordLanFetch` logged `200` for it every time, the bricked box included. Now the server
  serves every web read of a box that is not the player's own workstation at home:
  `resolveOccupantWebTarget`, behind `resolveOccupantFetch` and `resolveOccupantSweep`, falls
  back to the box the network generated at the address (a LAN host, a host on a deep layer
  through its switch's live ACL, or the box a shell stands on, the access point's gateway
  included), replays its journal, checks it boots and records the visit. `recordLanFetch`
  keeps only the player's own workstation (`scripts/testLanWebServed.ts` 10/10, 2/10 on the
  old code; `testLanFetchLog.ts` and `testHopWebTools.ts` moved to match). Played in the
  browser 2026-10-14 on CITY-HALL-WIFI's site server: from its LAN and from across the
  internet, `curl`, `lynx` (with a followed link) and `gobuster` read the defaced page, a 404
  once it was deleted, a refusal once apache stopped and nothing once it was bricked, and its
  `access.log` held the size each visit was served. As-built: `cross-player-architecture.md`
  §3, web reads on the LAN.

- **An exploit fired from a script left a session row nobody stands on — RESOLVED 2026-10-14
  (v0.383.0).** A script cannot be put in a shell, so `msfconsole` reports
  `Full shell available` and pushes no session (`env.scripted`), but the server had already
  inserted the row, and nothing closed it short of a reboot or the player leaving the network.
  Probed live first: by the rule two items up, that row set the tier the player's real shell on
  the box was served at. A root shell was served at `user` after a script fired a `user` hole
  there, and a guest shell at `root` after a `root` one, while each prompt still showed the old
  tier. Now the client sends `scripted: true` and both `exploitCreateSession` and
  `exploitLocalElevate` answer a shell hole without inserting a row. `--local` also writes no
  `session opened` line, since no session opened; the network fire still writes the break-in to
  the daemon's log, since the attack did happen. The flag can only make a caller hold less, so
  the server trusts it as sent (`scripts/testScriptedExploitLeavesNoRow.ts` 6/6, 1/6 on the old
  code).

- **Three guards in `ui/state.ts` have no test that fails without them (mutation, v0.374.0).**
  Two drop a served tree that arrives for a box the player has already left
  (`refreshServedRoot`), and one is the journal re-read after a reboot of the player's own box
  (`rebootEvict`). The change that found them touched neither decision.

- **A shell below `root` on a switch has not been played.** Gateways and switches carry only a
  `root` account, so a lower tier there comes from an exploit, and on 2026-10-13 every hole
  live on the switch and the two routers of the network played (CITY-PARK-WIFI) granted a
  limited effect and no shell. That a lower-tier shell on a switch
  still has its scans filtered by `acl.conf` rests on the unit tests and on the wire-checks of
  v0.371.0 that a session holder is served the file (`testCrossPlayerRead`,
  `testPidfileVisibility`). Play it when a shell-granting hole is live there, or stage one.

- **`curl <its own address>` on a deep box behind a switch that denies the web port was served
  but not traced — RESOLVED 2026-10-14 (v0.382.0).** The client served the standing box's own
  tree whichever of its names was used, and the trace found the box by address through the
  filtered layer. Closed by the item on LAN web fetches above: the server now serves that read
  and records it, as the box the shell stands on, past the switch (a unit test in
  `resolveOccupantFetch.test.ts`).

- **A shell on a deep box could write nothing there, even as root — RESOLVED 2026-10-10
  (v0.350.0).** Found in the browser on ABSTERGO-NET: `ssh root@192.168.190.184` then
  `ssh root@10.241.72.247` lands on `mysql-247` as root, where `echo probe > /tmp/probe.txt`
  answered `Permission denied` and so did `redis-server`. The write gate
  (`core/patches/remoteWritePermission.ts`) named the boxes it could rebuild kind by kind, a LAN
  host and a chain gateway, and took anything else for another player's workstation, so a deep
  box resolved to nothing and the write failed closed. It now asks
  `generatedBaseFsForMachineId`, the resolver the read side already used, which knows every box
  a network generates. A guest shell there is still held to its tier, and a deep box on another
  network is still refused. `scripts/testDeepLayerSsh.ts` carries the two write cases. Played
  in the browser 2026-10-10 on COPPER-SYSTEMS: as root on `web-176`,
  `echo browser-run-0352 > /root/proof.txt` took, and `cat` read it back.

- **A file `scp` carried landed `rwx------` — RESOLVED 2026-10-10 (v0.345.0).** `scp` passed no
  mode, so the write took `defaultFilePermissions` for the login's tier, and
  `scp notes.txt root@localhost:/tmp/` (chapter 5's example) left a file the player's own account
  could not read. The copy now takes the source's mode exactly. Decided with it (2026-10-10): the
  mode travels as it is, with nothing added for the login, so a `user`-only file carried in as
  `guest` lands unreadable to that guest, who cannot `chmod` it there either; the player widens it
  at home first. The other direction is unchanged: a file taken off a box lands as the player's
  own write. `ftp put` still writes the login's default.

- **`~` expands only as `~` and `~/path` (v0.328.0, #621).** Expansion happens in the tokenizer, so
  every command and redirect target gets it. Still missing: `~user` (another account's home —
  bash resolves it through `/etc/passwd`, which the box has), tab completion of a `~/…` path
  (`shell/complete.ts` does not expand before matching), and the `ftp>`, `mysql>` and `redis>`
  prompts, which never pass through the shell (real `ftp` does not expand `~` either, so that one is
  probably right as it is).

- **`apache2` was hollow, so a workstation was never born with it — RESOLVED 2026-10-08
  (v0.331.0–v0.334.0, #625–#628).** It had no release history and shared nginx's row and pidfile,
  so `ps` named it `nginx`. It now has its own pidfile, unit, timeline (CVE number 22) and effect
  pool, every tool reads the running program, and workstations and generated web hosts draw it
  50/50 with nginx. As built: `docs/vulnerability-architecture.md` "One service, two programs:
  the web".

- **`apt install` of a base-image service inside its patch window leaves it at the start tuple.**
  `openssh-server` and `vsftpd` are base-image packages (`BASE_IMAGE_PACKAGES`), so `apt install`
  on them is an upgrade. Inside the package's no-fix-yet window the upgrade has nothing safe to
  move to and stays put, though a newer (exposed) release exists, so the box keeps its start-tuple
  release rather than the newest one. Found building workstation birth (#623), which shares that
  path, so a box born inside that window keeps the old release too; existing `apt` behaviour, left
  alone. Decide
  whether "no fix yet" should still move a box to the newest release, with a test in
  `apt.test.ts` beside the upgrade-status ones.

- **`apt install` of a package the box already carries prints `Setting up` twice. Seen in the
  browser 2026-10-19, cosmetic.** On the AP gateway, `apt install snmp` printed a bare
  `Setting up snmp ...` and the `already exists, keeping your copy` lines, then
  `The following packages will be upgraded:`, `Unpacking snmp (5.9.15) over (5.9.4) ...` and
  `Setting up snmp (5.9.15) ...`. The install path in `commands/apt.ts` writes its unversioned
  line before handing a carried package to `applyUpgrades`, which writes its own. Real apt prints
  the upgrade block once.

- **CLOSED v0.346.0 — `ps` ran a 12-character command into the PORT column.** `redis-server` is
  exactly as wide as the COMMAND column was, so its row read `redis-server6379`. The column now
  widens to the widest program plus one, header and every row together, as `nmap`'s PORT column
  does (#620). Seen in the workstation-birth browser runs (2026-10-08).

- **`relations.test.ts` timed out under the full suite — RESOLVED 2026-10-18.** The test rebuilt a
  box's whole generated tree for every file it read, three files a box, once for each client of
  the office. It now builds each box's tree once (`readerOn`) and checks every client of the
  office against it: 6.0 s alone became 0.28 s, with the same assertions (flipping it to look at
  the contractor's own desk still fails). The original note follows.

  "an IT contractor's shortcuts > keeps no
  shortcut to a client on any other box of the office" takes ~20s alone against the 30s
  `testTimeout` and exceeds it when the whole suite runs, on `main` as of 2026-10-08 (seen twice
  in a row, unrelated to the change at hand). Either make the test cheaper (it walks the world)
  or give it its own timeout with the reason beside it; do not raise the global one. Seen again
  on 2026-10-12 (12 s alone, over 30 s in the full run, the same on `main`); it passed in the
  full run of 2026-10-13. Seen again on 2026-10-16 (chainit slice 1, which does not touch it):
  failed once in a full run, ~18 s and 3/3 green alone, clean in the next full run. That run's
  output went through a filter, so its error text was lost; a timeout is still the likely cause.
  Seen again on 2026-10-18 (carry-home slice 1, which does not touch it): timed out at ~31–37 s in
  full runs, on `main` too, and passed alone; clean in slice 2's full run the same day. Five
  sightings in ten days, so the next full-suite failure is likely this one.

- **`resolveOccupants.test.ts` failed about once in 250 runs — RESOLVED 2026-10-18.** "derives
  each occupant's LAN IP from THAT occupant's key+ESSID, not the caller's" drew two fresh
  identities and asserted their LAN addresses differ, but both come from one network's octet
  pool, so the two could draw the same address. Seen once in a full run on 2026-10-16. The test
  now searches for a pair at distinct octets (`distinctIdentities`), as the file's
  `collidingIdentities` already searches for a pair at one, rather than hard-coding keys a
  change to the derivation could leave proving nothing.

- **CLOSED v0.326.0 (#619) — `grep -c` answered `grep: unrecognized option: -c`.** Parity rather
  than a missing capability (`grep … | wc -l` worked since v0.278.0), but the game planted
  `grep -c sshd /var/log/auth.log` in root's generated `.bash_history`, so it suggested a command it
  refused. Found in world-content slice 3's played run (v0.250.0).

- **CLOSED v0.329.0 (#622) — root's planted `.bash_history` held lines the shell refused.**
  `src/core/generation/plantedHistory.test.ts` now runs every line of the five history pools, and
  one real line per distinct shape of every `.bash_history` the world plants (home and deep boxes
  and every gateway, about 3s), through `runCommandLine` with the real registry, and fails on a
  usage refusal (`unrecognized option`, `Invalid operation`, `no manual entry`, `usage:`).
  Running the WORLD, not just the pools, is what found the largest case: `gatewayHistory.ts`
  planted `ping -c N <ip>` on 1722 distinct lines, and both generators planted `tail -f`. Two
  decisions moved from the record below once that was measured: `ping -c N` is **supported**
  (a flag names itself, which is why a bare positional count was refused; default stays 4), and
  `grep -r` is **supported**, not reworded — this grep already recurses into a directory and is
  already case-insensitive, so `-r` and `-i` are accepted and change nothing. `apt update` reports
  how many packages `upgrade` could move (same resolver), `-y` is accepted; `tail -f` became
  `tail -n 50` in the pools and both generators; `apt autoremove` → `apt list --installed`,
  `mysql -u root` → `mysql localhost root`, `nginx -t` → `openssl ciphers` (not every webserver
  serves a site, so nothing path-bearing was safe), `man bash` → `man grep`. All 57 landmark
  fingerprints moved with it, on purpose. The original note follows.

  Root's planted `.bash_history` holds lines the shell refuses. `ROOT_HISTORY` in
  `core/generation/pools/rootContent.ts` plants `tail -f /var/log/auth.log`, and `tail` has no `-f`
  by design (nothing appends to a log while you watch). A player who roots a box and replays its
  history meets `unrecognized option`. The fix that cannot rot is a test running every line of the
  history pools through `runCommandLine` against the real registry, then rewording or supporting
  each failure — `tail -f` becomes `tail -n 50`. Found while closing `grep -c` (2026-10-07).

  **Measured 2026-10-07, and decided with the owner the same day.** All 323 lines of the five
  history pools (root, gateway, role, personal, work) were run through `runCommandLine` with
  `commandRegistry` on a generated box. What came back, and what each kind gets:
  - **199 lines name a command the game does not ship** (`vim` 15, `git` 12, `ll` 9, `date` 8,
    `python3`, `du`, `rndc` … about 100 distinct). **Exempt as flavour**: a real history names
    tools the box does not have, and `grep -c` (#619) drew the line at commands the game ships.
  - **The shell has no `~` expansion anywhere** — `cd ~`, `cat ~/notes/x`, `nano ~/.bashrc` and
    `echo x >> ~/notes/x` all answer `No such file or directory`. About 20 planted lines break on
    it, and so does every player's first `cd ~`. **Ships as its own PR first**, so the history
    test lands green on top of it without rewording a tilde line.
  - **A shipped command refusing the line's syntax** — the rule the test enforces. Supported:
    `grep -i`, `apt update`, `apt upgrade -y` (`-y` a no-op; nothing here asks). Reworded:
    `tail -f` (×3), `grep -r` (×2), `apt autoremove`, `mysql -u root` (the game's syntax is
    `mysql localhost root`), `nginx -t`, `man bash`.
  - **A relative file the box does not hold** (`cat sign.txt`, `./deploy.sh`, `wc -l
    register.csv`) is the world answering truthfully, not the shell refusing — exempt, as
    `homeHistory.ts` already intends.

  So the test's one rule: **every planted line whose command the game ships parses and runs
  without a usage refusal** (`unrecognized option`, `Invalid operation`).

- **A deep TERMINAL NPC box is read-only when rooted — depth alone decides whether you can
  write to an NPC.** The cross-player/deep write gate (`remoteWritePermission` L2,
  `resolveTargetBaseFs`) authorizes a write only when the target resolves as the AP gateway, a
  home-LAN NPC sibling (`lanBaseFsForMachineId`), a deep chain GATEWAY
  (`chainGatewayBaseFsForMachineId`), or an occupant workstation. A deep TERMINAL NPC — a
  `machine` at the end of a chain — matches none, so every write verb (`systemctl stop/start`,
  `nano`) fails closed with `403 permission_denied` even from a root shell reached through a
  forward. Read verbs (`ssh` in, `cat`, `ls`) all work, so it presents as a box you can root and
  inspect but not change. A Layer-1 NPC sibling with the same role IS writable via the LAN arm, so
  the asymmetry is purely positional. Found at X1 slice 2's browser close-out: `systemctl stop
  named` on the deep `ns-116` (GRAD-STUDENT-WIFI) refused while `whoami` returned `root`; its id
  `ns-116-6ba015ee` matched no arm. Not DNS-specific and not slice 2's — slice 2 places the files
  correctly on a box that happens to be a deep terminal NPC. Decide, when a write to a deep NPC is
  actually wanted, whether visitors should be able to reconfigure an NPC's deep box at all, or
  whether the "stop your own name server" story is meant only for boxes the player owns/can write
  (the daemon-stop mechanism itself is proven in `generatedBoxDoors.test.ts` against a box's own
  journal).

- **A Layer-1 (home-LAN) dns box does not advertise `53/domain` in `nmap` — only DEEP dns boxes
  do.** A same-LAN NPC's scanned ports come from `resolveLanHostIdentity(host, essid).baseFs`
  (via `remoteHostFs`), whose ports ignore the drawn role — a mailserver scans `80/http`, a
  fileserver `21/ftp` — so `bind-224`, a dns-role box on OSCORP-GUEST at `192.168.118.224`, scans
  `2121/ftp` and never `53`. The dns FILES are still placed (`remoteHostFs` writes `named.conf` +
  the zone for any `role === 'dns'` host), and the DEEP path gets the port right —
  `buildDeepHostFs` gives `ns-116`/`ns-196` a real `53/domain` alongside `22/ssh`. So the split is
  positional: decision 7's "nmap reports `53 open`, which is HOW a player finds the box" holds for
  the four deep dns boxes and fails for the two Layer-1 ones. Impact on X1 is low — both
  OPEN-transfer name servers are deep and correctly discoverable, and `dig` is role-based (the
  transfer works whether or not `53` shows), so only the two CLOSED Layer-1 dns boxes are
  unfindable-as-DNS, and they refuse anyway. Found at X1 slice 3's browser close-out; not
  slice-3's own (its `dig` is correct). Decide, when a home-LAN name server should be
  discoverable, whether to route Layer-1 role services (at least the `dns` row) through the same
  placement the deep path uses.

- **CLOSED v0.327.0 — `snmpd` was a daemon nobody could run by name.** It was left out on
  purpose when the world first ran agents (#465, "an agent a player can install is its own
  slice"); the slice that installed it (#472) never registered it. `registry.test.ts` now holds
  every `DAEMONS` key to a registered command. The original note: `apt install snmp` lays it in `/usr/sbin`
  and typing `snmpd` answers `command not found` — the binary is right there. Every other
  daemon in `DAEMONS` is registered as a command; only this one is not, so it is reachable
  through `systemctl start snmpd` alone. Found at X1 slice 2's increment 2, where `named`
  was registered deliberately for the reason slice 1 pulled `dig` forward: a binary the
  world installs that no command answers to reads as a broken install. One line in
  `registry.ts` plus a gating test; left alone because it is not the DNS door's bug.

- **An interrupted REDIRECT is silent — no `^C`, no error.** `state.ts` prints the marker
  inside its `if (result.kind === 'async')` branch, but a redirect collects the stream
  first, so the abort's rejection escapes `runCommandLine` during collection and never
  reaches that branch. `airodump-ng > scan.txt` and `node sweep.js > out.txt` both just
  return to the prompt having written nothing. The half that matters is already right —
  no partial file, and the marker cannot be captured INTO the file, which is why `node`
  throws rather than printing (D9 decision 13, verified in the browser). Found at D9
  slice 4's close-out; belongs to a change that owns the redirect path.

- **`Command.tier` is declared by every command and read by NO production code.** The only
  `.tier` outside tests is `snmpwalk.ts`'s unrelated `walked.tier`. Surfaced at D9 slice 3's
  mutation gate, where `tier: 'guest'` survives — and it will survive under every command
  this project ever mutates, alongside `availability`, so recognise the family rather than
  re-triaging it each time. A repo-wide reduction candidate: either delete the field or give
  it the reader its presence implies. Not a bug; nothing is gated wrongly, because nothing is
  gated by it at all.

- **`runLine.ts` `withCarried` has an untested arm that would throw.** Mutating
  `result.kind === 'sync'` to `true` survives the full suite, which means no test has BOTH a
  non-empty carried list AND a non-sync final stage — and in that state the code spreads an
  `AsyncIterable` with `...` and throws. Reachable in principle: an intermediate stage writing
  to stderr ahead of a streamed final stage. Predates D9 by many PRs; found by slice 3's
  mutation gate and deliberately left for a change that owns the pipeline, rather than
  widened into a slice about a script's filesystem.

- **The D6 browser smoke test's findings are ALL closed (last one 2026-08-26).** The run that
  found the own-box write-wipe (fixed in v0.172.0, #449 — see the `conventions-and-gotchas.md` §6
  invariant) turned up three more, none of which blocked a player and none of which belonged in that
  fix. Two closed at v0.173.0 — the sub-shell prompt echo and the self-scan cover name — and the
  third, the one recorded as a product decision rather than a bug, closed at v0.182.0 (D7 slice 7b)
  when the decision was finally taken. Kept as a record of what a smoke test is worth: one session's
  browsing produced four findings, three of them invisible to a suite that was green.

  1. **The `mysql` sub-shell echoed the SHELL prompt — RESOLVED (v0.173.0).** Every statement
     scrolled back as `root@box:/root# SHOW TABLES;` while the live prompt correctly read
     `mysql> `, because two places decided the same thing: the echo in `ui/state.ts` branched
     only on `inFtpSession()`, while `Terminal.tsx` had a two-rung ladder. Both now read one
     `subShellPrompt()`, so the next sub-shell gets the echo and the live prompt right by being
     added once — the second special case the entry warned against was never written.

  2. **A fellow occupant's open ports were invisible to `nmap` — RESOLVED (v0.182.0).** A
     neighbour scanned as `Host is up.` with no port table, and the blank was CORRECT: a real
     occupant's services live on THEIR box, `buildRemoteHostFs` keys on the host IP alone, and
     letting them fall through would have FABRICATED the NPC ports that octet rolled. So this
     was a product gap rather than a bug — nothing told a player their neighbour ran a database,
     and finding it meant guessing the service and letting `hydra` look. The fix is the shape
     this entry predicted: `resolveOccupantScan`, server-side, generic to every service, resolved
     lazily for ONE address when it is actually scanned. Two things the entry did not predict.
     The client needed no async port resolver — a single-IP occupant scan returns early beside
     the inner-gateway one, before the sync resolver is built. And a two-state resolution would
     have made the tool lie: collapsing a failed round-trip into `found: false` reports a live
     neighbour as DOWN, so this seam keeps three outcomes where the public one keeps two.

  3. **You saw yourself under a cover name — RESOLVED (v0.173.0).** In her own scan a player
     showed as the generated `desktop-32` while every other path — occupants, public targets,
     same-LAN sessions, elevation — named her `alicebox` from the registry, so the cover was one
     only its owner was behind and it bought nothing. Self now uses the workstation name.
     `env.workstationName` is new beside `env.hostname` because a hop is where the two part:
     after `ssh` the shell STANDS on the remote box, while the player's own workstation keeps the
     name their neighbours already see. `ping` passes a name it never renders, so no behaviour
     was invented there.

- **D6's remaining test debt, graduated on close-out (2026-08-23).** Two items, both narrow and
  both about assertions rather than behaviour. (1) The `mysql` client's prompt WORDING — `Enter
  user: ` and the no-default rule — is written and untested; the `Enter password: ` half and
  `masked: true` are asserted, and the gap shows up as a surviving `StringLiteral` mutant on
  `mysql.ts`. (2) `pools/database.ts` sits at 88.69% with **42 surviving column-metadata mutants**
  that need `DESCRIBE` asserted **over the population** rather than over one drawn box — the
  assertion slice 3 owed and did not write. Neither blocks a player; both are cheap for whoever
  next opens those files.

- **A rooted generated box can have its doors shut — RESOLVED 2026-08-22 (v0.168.0, #444).** The
  rule landed: a generated box carries the packages for the services it runs, so `unitFor` finds
  the binary and `systemctl stop nginx` works on an NPC webserver. See the invariant in
  `conventions-and-gotchas.md` §6. What remained was the slice's own remainder, and slice 6b is now
  COMPLETE (v0.169.0): the end-to-end evidence landed as `generatedBoxDoors.test.ts` needing no
  production change, as predicted, and the two apache-flavoured `/etc/httpd.conf` templates were
  rewritten nginx-flavoured so a generated webserver's config, its COMMAND column and its
  `/usr/sbin` all name one program. (Since v0.334.0 a generated webserver runs nginx or apache2 and
  its config is in the words of whichever runs, which keeps the same rule.) The one thing it
  surfaced rather than closed is the scan half, recorded with the own-LAN `nmap` entry below.

- **Should `vsftpd` be an apt package rather than base image?** Raised while grilling slice 6b and
  deliberately parked, because the union rule above resolves it with no second decision: the day
  the `ftp` package gains `daemons: ['vsftpd']`, fileservers start carrying both halves and every
  other box stops carrying a daemon it never runs. Today `vsftpd` ships on every machine
  (`SYSTEM_DAEMON_NAMES`) while the `ftp` package installs only the CLIENT — an asymmetry that is
  historical rather than designed, since ftp landed before apt had a `daemons` field.

- **A door's error BODY is asserted by one test in ten (found by D7 slice 7a's mutation gate).**
  Nine refusal tests across `src/core/sessions/` assert `expect(response.status).toBe(400)` and
  stop there; exactly one asserts `body: { error: … }` beside it. So
  `body: { error: verified.reason }` mutated to `{}` SURVIVES on every door — a handler could
  answer a bare `400 {}` and the suite would stay green. Narrow (the status is what routes the
  client's message) and entirely uniform, which is why slice 7a left it rather than fixing the two
  redis doors and leaving eight answering by a different standard. Whoever closes it should close
  it across the family in one pass; the mutant to reproduce is `ObjectLiteral` on the
  `STATUS_BY_VERIFY_REASON` return of any door.

- **An INTERMITTENT full-suite flake, seen three times, still unnamed.** 2026-08-26, D7 slice
  7a: the first `npx vitest run` reported `1 failed | 171 passed`, and five later runs on the same
  tree were clean. Same day, D7's close-out: `2 failed | 171 passed` on a tree carrying **nothing
  but documentation edits**, then four clean runs (3737/3737 each). Neither failure was ever named.
  Most likely a timeout under the ~215s environment setup, but that is still a guess and is written
  down as one — twice now the evidence has been destroyed before anyone could look at it.

  **How it keeps escaping, and what to do about it.** The entry used to say "capture the test NAME
  before re-running". That is necessary and not sufficient: the second occurrence was lost to a
  `| grep -E 'Test Files|Tests '` on the FIRST run, which discards the failure block just as
  completely as a clean re-run does. So: **never pipe a full-suite run through a filter that can
  drop the failure detail.** Redirect the whole thing (`npx vitest run > suite.log 2>&1`) and grep
  the FILE. A summary line is the one part of the output that is worthless when something fails.

  **Third occurrence, 2026-09-14** (the own-LAN gateway scan, at v0.217.0): `1 failed | 4788 passed`,
  then five clean runs on the same tree (4789/4789 each). Lost the same way a third time, to a
  `| tail -8` — so the warning above is easy to trip even by someone who has just read it. Treat
  "pipe the first full-suite run through anything" as the hazard, not any particular filter.

  One NEW data point survived, because it is about the command rather than the output. Of the six
  runs, the failing one was the only one not invoked as a bare `npx vitest run`: it was chained in a
  single shell command after `npm run typecheck`, whose `pretypecheck` hook runs `npm run encode`
  and REWRITES `src/core/secrets/__encoded.ts`. A source file rewritten moments before the run is a
  concrete mechanism worth eliminating — vitest's transform cache keys on mtime. That is a
  hypothesis to TEST next time (run the chained form repeatedly on a clean tree), not a cause; it is
  recorded because three occurrences have now produced exactly one testable lead.

  **Fourth occurrence, 2026-09-17** (Phase 3 slice 7 PR1, at v0.231.0): `1 failed | 5016 passed`,
  then five clean runs on the same tree (5017/5017 each). Lost the same way a FOURTH time, to a
  `| tail -6`. Two things it did settle, though:

  1. *It matched the lead.* The failing run was again the chained form — `npm run typecheck && npm
     run lint && npx vitest run` in one shell command — and every clean run was either bare or
     redirected to a file. Two for two now.
  2. *But the lead does not reproduce on demand.* Running the chained form three more times on the
     same clean tree was 5017/5017 each. So `__encoded.ts` being rewritten moments before the run
     is at best a contributing condition, not a trigger — which is what makes this so hard to
     corner, and why the next occurrence still needs its output redirected to a file before
     anything else is tried.

**Cross-player / multiplayer deferred.** The cross-player epic shipped every enumerated story
(1–7, plus 5b, unique public-IP allocation and shared-network reconciliation) and its plan file
was retired here on close-out — this group is now the sole owner of what it deliberately left
undone. As-built for everything shipped: `cross-player-architecture.md`, `project-status.md` and
`conventions-and-gotchas.md` §6. Nothing below blocks the live PvP loop; each was a scoped owner
decision, not a gap.

- **Story-7 reconciliation** — DONE except WiFi density and presence/TTL, which stay deferred.
  Shipped v0.88.0 → v0.96.0: unique per-ESSID public-IP allocation, collision-free LAN leases,
  one shared AP gateway per ESSID, ESSID-seeded shared NPCs and deep chains, and the removal of
  the store whose last-writer-wins PK caused the collisions. As-built in
  `conventions-and-gotchas.md` §6 and `cross-player-architecture.md`; the plan file was deleted on
  close-out. **What stays deferred**:
  **WiFi-strength = density** (signal strength as a proxy for how many occupants a network holds);
  **presence / TTL heartbeat** (occupancy is connection-state-based today, with no last-seen, so a
  player who closes the tab stays an occupant until they disconnect); and **matchmaking** beyond
  the rendezvous note in the procedural-expansion item below.

- **Procedural world expansion — DONE (2026-10-03, v0.306.0).** Grilled 2026-07-29, re-grilled
  2026-09-28 and shipped as #572–#596. As-built, its standing rules and the calls not to re-open:
  [`procedural-world-architecture.md`](./procedural-world-architecture.md). It was split
  deliberately out of shared-network reconciliation, which was cheaper to verify while the world
  was 50 networks and `INJECT_MAX = 3` made encounters frequent; expanding first would have made
  encounters rare before the code handling them was proven. What it settled against this item's
  first grill: the catalog stayed as 57 hand-written landmarks rather than becoming templates;
  the world is one region of eleven towns and 612 declared networks; every public address is
  derived from a network's place, and the allocator and its table are gone; the injector shows
  one occupied Ridgemont network in about 5% of scans. Periodic world reset stays **rejected**
  (it destroys the persistence that makes PvP damage meaningful), and deleting the injector
  stays rejected (it would leave the shared-LAN work no live consumer).
  **Procedural world deferred** (each needs its own grill):
  - **The map — SHIPPED as mapit.io (2026-10-14, v0.376.0–v0.379.0, #673–#676).** A site on
    the public web, the same for every player: Harrow Valley drawn by hand, a seeded plan of
    each town with its public places, and a link from findit's front page and hackademy's web
    chapter. As built: `discovery-architecture.md`, "mapit.io: the map". The shape proposed
    here on 2026-10-09 was **dropped, not deferred**, when the site was grilled (2026-10-13):
    the `map` overlay, fog of war, the per-player exploration record, found counts per town,
    the five states of a network, and `ping` latency growing with distance. Bringing any of it
    back is a new grill. **What waits:**
    - **A page of the world's regions** above the valley, once a second region is declared.
      Until then `mapit.io/` is Harrow Valley, and the test pinning the region's eleven legend
      rows fails when a second region's towns join the list, which is when its filter is
      written.
    - **A live map**, where a dark site drops off and a player's page appears. The map is files
      on its box; a live one would read every town's journals, as findit's search does.
    - **A search box on mapit.io.** Searching is findit's.
    - **Left open by the build:** no test holds the street counts of a town or a city (a pinned
      town and city plan would); a place name holding `<` would break its row on the map, and
      nothing fails when one is declared. Found beside it and not looked into: `npm run build`
      failed two timing budgets on the developer machine, on `main` as well (Ashby's boxes,
      2.15 ms against 2 ms; findit's generated web, 1,170 ms against 1,000 ms), and
      `relations.test.ts` once timed out in a full run ("keeps no shortcut to a client on any
      other box of the office", about 39 s against 30 s) while passing alone.
  - **Travel** between towns and regions. Joining another town's WiFi gives another public
    address, since the address belongs to the network. Needs a server-authoritative player
    location; until then the join refuses every network outside Ridgemont.
  - **More ways in**: hidden ESSIDs joined by a name learnt elsewhere (`nmcli` would have to
    accept a known name missing from the scan), and a hacker BBS posting leads.
  - **The categories after healthcare**: education (schools, and universities in drawn towns),
    finance, media, industrial, hospitality, one a slice, each filling every category pool.
  - **Deliberate rendezvous** is the eventual shape of meeting another player: being *led* to an
    occupied network by intel (a trace, `whois`, a findit lookup) rather than stumbling onto it.
    The pieces exist (`whois` on a trace's address names the network); nothing ties them into a
    route yet.
  - **The fixed-IP mission catalog** now has its substrate: a hand-written network declared after
    a town's drawn ones answers at a known derived address, as Millbrook's cottage hospital does.
  - **The WiFi password is checked by the client only.** The server never verifies the cracked
    password, so a modified client can join without `aircrack-ng`. It predates the epic and is
    derivable server-side from the encoded pool.
  - **Ridgemont's council keeps no town directory**: it is a landmark, whose content cannot move.
    Giving it one is a decision of its own.
  - **Consequence to hold onto: the PUBLIC IP remains the primary cross-player attack surface**,
    and the shared LAN is the rare special case. `nmap <public IP>` is the headline PvP path.
- **CLOSED (v0.400.0) — the patch-error map is written seven times.** Adding `too_large` folded
  the last copies (`ftpShell`, `rm`, `touch`, `nano`) into `PATCH_ERROR_REASON`; `mkdir` spreads
  it and overrides only `network_error`. Original note: `{ no_session: 'Permission denied',
  permission_denied: 'Permission denied', network_error: 'I/O error', modified_since_open: … }`
  appears verbatim in `daemon.ts`, `ftpShell.ts`, `mkdir.ts`, `rm.ts`, `touch.ts`, `systemctl.ts`
  and `shell/runLine.ts` — one piece of knowledge (how a `PatchResult` failure reads to the
  player) with seven owners, so a new failure kind or a reworded reason has to be found in seven
  places. Each copy was added by following the one before it, which is why it never looked like a
  decision. Not urgent — the strings agree today — but it is the kind of drift that surfaces as
  two commands blaming different things for the same failure. Consolidating it is a small,
  self-contained refactor touching seven modules; it wants its own slice rather than a ride-along.
  (`const errorResult = …` is duplicated across seven command modules too, but that one is
  incidental shape rather than shared knowledge, and is fine as a local idiom.)
- **CLOSED (v0.151.0) — a backdoor session on an OFF-LAN box showed the intruder's OWN
  filesystem.** Found by Act 14 on 2026-08-18 at v0.150.0. Standing in an `nc` shell on another
  network's AP gateway, `ls /var/run` listed only the planted `nc-<port>.pid` and
  `cat /etc/iptables/rules.v4` said no such file — while `ssh` into the SAME box at the SAME
  public IP, same tier, listed `sshd.pid` too and printed the seeded NAT table.
  **Cause:** `ui/activeRoot.ts` `baseFsFor` resolves a foreign machine's seeded base with
  `generatedBaseFsForMachineId(essid, machineId)` using the VIEWER's current essid, and falls
  back to `ownBaseFs` when nothing matches. Off-LAN, nothing matches, so the intruder got their
  own workstation base with the target's journal replayed over it. `ssh` escaped it because
  `isCrossPlayerHop` routes an off-LAN shell to the SERVER-served tree, and that predicate was
  `kind === 'ssh' || kind === 'su'` — carrying the comment "Service sessions (nc/mysql/…) have no
  served tree and are excluded", true until D5 slice 4 gave `nc` a shell, stale ever since.
  It was not cosmetic: `env.patches` is bound to the TARGET, so a write issued from that shell
  landed on the target's journal while the tree on screen was the intruder's own.
  **Fixed** by counting `nc` in `isCrossPlayerHop` — and that was only half of it. Three things
  the fix turned up, all of which generalize past this bug:
  - **A served tree is not refreshed by a journal re-pull.** An off-LAN backdoor reads the tree
    the SERVER materialized, so slice 5's pre-line `refetchPatches()` left the shell asking a
    stale copy whether its own door was still open — cross-network eviction would have silently
    stopped working. `executeLine` now re-pulls whichever source the active tree comes from:
    served for a cross-player hop, journal otherwise. **Any future "re-read the box before
    acting" gate has the same two sources to choose between.**
  - **"It costs a round trip only in a backdoor" is a testable claim, and needs a test that
    prices a line** rather than reading its output. The mutant making the re-pull unconditional
    survived everything else: it changes no output, only how chatty the client is. The test asserts
    that a command on your own box issues NO requests at all.
  - **A hand-built filesystem is not a box.** A fixture tree without `/usr/bin` answers
    `command not found`, and one without library deps answers
    `ls: error while loading shared libraries: libpcre.so`. Build a served tree as
    `applyPatches(buildRemoteHostFs(essid, host), journal)` — base plus journal, the same two
    pieces the server composes.

  **What it says about coverage:** the session row was correct throughout, so no wire-check could
  see it — it was the tree the CLIENT renders that was wrong, which is why the browser act exists.
  The wire-check added alongside the fix proves the other half, the half no unit test can see:
  `authorizeMachineAccess` gates the served-tree fetch on an active session row regardless of
  kind, so an `nc` row authorizes it (`testNcCrossPlayerReach` 9/9).
- **CLOSED (v0.152.0) — an ftp session on an OFF-LAN box showed the intruder's OWN filesystem,
  the same defect one door along.** Found by reading the code while closing the `nc` one above,
  then reproduced: at `ftp>` on another network's box, `ls /home` printed `tester` — the
  intruder's own account. **Cause:** `ftpRoot` called `resolveActiveRoot` with no cross-player
  check at all, so off-LAN `baseFsFor` found no generated host for the target under the VIEWER's
  essid and fell through to `?? ownBaseFs`. Worse than the `nc` case: `get` reads the same tree,
  so taking a file off a stranger's box handed back a copy of the intruder's own while the
  target's `vsftpd.log` itemised it as a file that left.
  **Fixed** with a served tree held beside `ftpPatches` — a second one, for the same reason the
  journal is a second one: the shell's `servedRoot` follows the ACTIVE session and an ftp session
  is beside it, not above it. Three things worth carrying:
  - **There were THREE places deciding which tree a session reads, and they must agree.**
    `scpTargetTree` (always right), `activeRoot`/`isCrossPlayerHop` (fixed v0.151.0), `ftpRoot`
    (fixed here). Two were found only after a browser act caught the first. **Any fourth reader
    of a remote tree has the same question to answer**, and the answer is never "call
    `resolveActiveRoot` and hope" — off-LAN that resolver's honest answer is your own box.
  - **A fixture can be foreign in address and local in machine, and then it proves nothing.**
    The shipped ftp suite reached its targets at a public IP but generated them on the essid the
    player was CONNECTED to, so the local resolver always succeeded and the fallback never fired.
    The same shape hid the `nc` defect in `activeRoot.test.ts`. **To exercise a cross-player path
    the target must be generated on a DIFFERENT essid** — a public address alone does not make a
    box foreign.
  - **The ftp served tree is deliberately UNTAGGED, unlike the shell's.** Tagging it with its
    machine id produced a mutant nothing could kill: one ftp session is held at a time and
    entering one clears the tree, so a mismatched tag is unreachable. What replaced it is a test
    of the race the tag was imagined to cover — a slow answer about the foreign box, landing after
    the player opened a door on their own LAN — which fails loudly without the session-id guard.
    Structure nobody can observe has no test that can fail; the guard that does the work does.

  **What it says about coverage:** the wire-check added alongside proves the server half no unit
  test can see — an `ftp` row alone authorizes `resolveCrossPlayerFs`, and the tree comes back
  pruned to the tier the credential bought, not the box owner's (`testFtpCrossPlayer` 18/18).
- **CLOSED (D5 close-out) — `testScpTransfer` check 8 asserted behavior a PR had removed the
  same day, and the sweep read 44/45 for two doors before anyone looked.** The check expected 200
  for "a plain ssh login into the same box keeps its documented exemption"; #410 removed that
  exemption so every login gate asks the same question, and a box running no sshd now answers 404
  `service_not_running`. The script was written in #403 and #410 landed the same day, so it was
  never green after its own merge. Production was right throughout — `testDaemonGates` check 1
  asserts the shipped behavior and passes. **The lesson is the race, not the assertion:** a
  wire-check written against behavior that is itself in flight has to be re-run after the PR it
  raced, because nothing else will notice. The script's header comment carried the same stale
  claim and moved with it — a comment that states a rule is part of the rule.
- **CLOSED v0.327.0 — `nmap` ran a 5-digit port into the STATE column.** The PORT column now
  widens per table the way real nmap's does (9 normally, the widest cell plus a gutter when a
  5-digit port is in it), so 4-digit tables are unchanged. The original note: `31337/tcpopen  unknown` — the PORT
  column pads for four digits. Cosmetic, but every port in the generated backdoor pool
  (`BACKDOOR_PORTS`) is 4-5 digits, so it shows up routinely now.
- **CLOSED v0.216.0 + v0.217.0 — an own-LAN `nmap` replayed no journal, so it could not see a
  planted door, a closed one, a filtered one, or a patched version.** One defect with four recorded
  faces, open from D5 (2026-08-22) to 2026-09-14. The client resolved an own-LAN scan from seeded
  trees — the `.1` AP gateway from `buildApGatewayBaseFs`, every NPC sibling from
  `buildRemoteHostFs` — while a scan of a PUBLIC IP was server-resolved and replayed the target's
  journal. So one box answered two different ways depending on where you stood.

  | # | Face | Found | Lied about |
  |---|---|---|---|
  | 1 | a planted `nc` door — or a CLOSED one — invisible to occupants | D5, Act 14 | somebody else's action |
  | 2 | `systemctl stop` on a box you rooted still showed the port open | 2026-08-22 | the player's OWN action |
  | 3 | an `snmpset` filter or forward on `.1` changed the public scan, not the LAN one | D8 e2e, 2026-08-31 | the gateway every occupant shares |
  | 4 | a package upgraded on an NPC still scanned as the old version, with a live CVE | slice 4 e2e, 2026-09-13 | the version and CVE columns |

  **The fix was which TREE gets passed in, never the reader.** `readOpenPorts` and `scanResult`
  already answered correctly for whatever they were handed; what was missing was a server-side
  resolution, because `listPatches` is gated on an active session and a client cannot read the
  journal of a machine it holds no session on. `resolveSameLanScan` mirrors `resolveInnerGatewayScan`:
  regenerate the host from the ESSID, resolve it through `resolveLanHostIdentity`, replay its journal
  with `materializeMachineFs`, gate on `canBoot`, answer its ports. Client-side, `lanHostResolver` in
  `nmap.ts` holds the precedence — own box → occupant → inner gateway → everything the access point
  owns.

  - **S1, v0.216.0 (#500)** — siblings. Faces 1, 2 and 4: the same `nmap -sV` that read
    `Redis 7.2.5 CVE-2026-0597580 critical` now reads `Redis 7.3.0` with an empty CVE column,
    verified at Act 16 step 14 and by `scripts/testSameLanScan.ts`.
  - **S2, v0.217.0** — the `.1` gateway, and filters everywhere. The gateway needed no new server
    branch: `generateHomeLan` already places it and `resolveLanHostIdentity` already seeds it from
    `buildApGatewayBaseFs`, so the whole client-side defect was that `nmap` never asked. Face 3
    closed by reading through `scanResult` at the `sameLAN` vantage instead of the pidfiles, which
    also closed the same hole on SIBLINGS — `snmpset inputPort.<port>=deny` works on *any* box
    keeping a filter of its own, so a sibling's filter had been invisible too. Verified at
    Act 17 and by the same wire-check, 9/9.

  **Two things worth keeping.** The player's own box deliberately stays a LOCAL read — a runtime
  `sshd` no journal has heard of must still show, which is Act 16 step 13 and Act 17 step 9. And a
  RANGE scan resolves nothing: `resolveHostPorts` reaches only `scanSingle`, so a `/24` prints no
  port table and there was never a 253-journal batching problem to solve (the open design call that
  deferred this work for three weeks answered itself in the code).

  **One guarantee is doubled, deliberately.** `resolveSameLanScan` passes both `vantage: 'sameLAN'`
  and `resolveTargetPorts: () => []`, and either alone would keep the NAT forward table off a LAN
  scan — the mutation gate proves it, since flipping the vantage to `'external'` by hand leaves all
  140 tests green. The vantage is therefore documentation and defence in depth rather than the
  operative guard. Left that way on purpose: making it load-bearing would mean wiring real machine
  materialization into this handler to produce a value that must never be displayed. If anyone ever
  passes a real resolver here, the vantage becomes load-bearing that moment and needs its own test.
- **`snmpwalk` of your OWN address had no client-side own-box path — RESOLVED 2026-10-19
  (v0.407.0, #705).** The walk always went to the server, whose same-LAN vantage excludes the
  caller, so walking your own agent timed out while a stranger's walk of the same box answered.
  At home `localhost`, `127.0.0.1` and the box's own LAN address are now answered client side
  (`commands/snmpOwnBox.ts`), off the machine as it stands: the same community judgement,
  identity and port tables as `handleSnmpWalk` (`platformOf` and `portTablesOf` moved into
  `sessions/snmpAgent.ts` so both read one copy), the same two `snmpd.log` lines, and no filter in
  the owner's way. On a hop `localhost` is now sent as `127.0.0.1`; it had gone as the bare name,
  which the server does not place as loopback, so it walked nothing. Played in the browser
  2026-10-19 on UMBRELLA-NET: both tiers, a wrong guess, a `deny 161`, a stopped agent, the log,
  and `localhost` from a root shell on the AP gateway.
- **`snmpset` on your OWN box had the same gap — RESOLVED 2026-10-19 (v0.408.0, #706).** It
  called `env.snmp.set` unconditionally, so a write to your own agent went to the server, which
  excludes the caller, and on a hop `localhost` went as the bare name. Now answered client side by
  `setOwnAgent` beside `walkOwnAgent`, judged by `judgeSnmpSet` in `sessions/snmpAgent.ts`, which
  the server handler shares, and the hop sends `127.0.0.1`. Played in the browser 2026-10-19 on
  APERTURE-WIFI: deny and permit on both addresses, the three refusals, a wrong guess, a stopped
  agent, the log, and a set on `localhost` from a root shell on the AP gateway.
- **The usage check in `commands/snmpset.ts` has four surviving mutants nobody has explained.
  Found 2026-10-19 by the #706 mutation gate.** Turning the missing-argument condition into `false`,
  or `||` into `&&`, survived a battery that included `snmpset.test.ts`. Those mutants should make
  `assignment.includes` throw, and the usage tests look like they would catch that. Worth a
  hand-check before trusting the usage tests.
- **A wire-check sweep should read 585/585 across 57 scripts; `testFtpSession` spent from #394
  to v0.183.0 red at 12/14 for a FIXTURE reason.** It picked its target because the host serves
  **ftp** (`kind === 'machine' && serves(ftp)` → `babycam-26` on `VSFTPD-LAB`, `ftp:2121`), then
  asserted a plain **ssh** `authCreateSession` against that same host — which runs no sshd, so
  the login was refused, no session row was written, and the two `kind`-default checks read an
  absent row. Fixed 2026-08-26 by giving the ssh half its own host and credential; the guard now
  names a TRIO so a future ESSID missing any of the three exits 2 loudly. **What it had been
  hiding is the lesson:** once those checks actually ran they reported `kind=ssh` and
  `end_reason=user_exit` — production had been correct the whole time, so a red fixture had
  concealed a PASSING behaviour that nothing else covered. A wire-check that selects its own
  fixture must select one per CLAIM, not one per script; sharing a host across two claims silently
  couples them.
- **Wire-checks are not in CI** — every `scripts/test*.ts` runs only by hand against a local
  `vercel dev` + supabase, and they are the ONLY thing that proves `api/` runtime correctness
  (`tsc` cannot see DB columns or constraints). A regression there ships green. (This line used to
  carry a count. It said 43 while the directory held 66, because nothing updates a number in prose
  — `ls scripts/test*.ts | wc -l` is the answer that cannot go stale.) Raised repeatedly and
  deliberately not taken on yet; it needs a CI supabase + a way to boot the functions
  headlessly, which is a piece of work in its own right rather than a config tweak.
- **`scp` moves one file, one hop, one direction at a time.** Named and deferred at D3b's
  close-out (2026-08-16): **remote-to-remote** (`scp root@A:/f root@B:/g` — two transient
  sessions in one command, and genuinely interesting given how silent the door is), **`-r`**
  and directory transfer, and **preserve-times**, which can never have its real name because
  `-p` is the port (a deliberate decision, not an oversight). The **`-P` alias was resolved
  rather than deferred**: not shipped, because an alias nobody can observe in-game has no test
  that can fail — it stays free to add the day something can see it.

- **The terminal cannot rewrite a line, so no tool can draw a live meter.** Real `scp` prints ONE
  progress line per file and overwrites it with `\r` about once a second — filename, percent,
  bytes so far, rate, and ETA that becomes elapsed at the end. Ours announces
  `Connecting to <host>...` and then prints a single completion line, because append-only output
  is all the terminal has. Two separable pieces of work, noticed while running Act 12
  (owner call 2026-08-16: not now):
  - **Cheap and honest:** make the completion line carry the two columns real scp ends with —
    `passwords.txt   100%  285     0.3KB/s   00:00` — timing the round-trip the command already
    awaits, so the rate is measured rather than invented. One change to `landed()` in `scp.ts`.
  - **The real fix:** `\r` semantics in the terminal, which would also give `hydra`, `aircrack-ng`
    and `nmap` honest meters instead of their current paced line dumps. A feature in its own
    right, not a transfer-slice detail. Do NOT approximate it with stepped 25/50/75% lines —
    that appends where the real tool overwrites, and reads *less* like scp, not more.

- **`api/patches.ts` holds four hand-copied `readLog` closures.** Every log appender needs the
  same "one writer's row at one path on one machine" read, and each `if (action === …)` block
  declares its own. A fifth was NOT added for `recordFtpDownload` — it uses a shared
  `readMachineLog` beside `upsertPatch`/`findActiveSession` — but the other four are still
  inline. Folding them on is mechanical and behaviour-preserving; it is left for a slice that
  is already touching those blocks, because `api/` has no unit tests and only a wire-check run
  can prove the fold (and only two of the four have one).
- **An `http` sweep was written up as `sshd` — RESOLVED 2026-10-18 (v0.401.0).** `hydra <host>
  http` left `Failed password … sshd` lines in the target's `auth.log`, for a daemon nobody
  knocked on. It now leaves one `access.log` request per password tried, the account in the
  HTTP-auth field: `<ip> - <user> [...] "GET / HTTP/1.1" 401 0`, and `200` for the one that fell.
  It was not the one row it looked like: a break-in's destination followed `sweepLog`, so moving
  the row would have moved every `nginx[pid]`/`apache2[pid]` exploit line into the request log
  too. Decided with the owner to split them: the web row carries an `exploitLog` (`auth.log`),
  and `exploitLogOf(spec)` is the one reader, shared by `exploitCreateSession` and the ten
  exploit wire-checks.

- **CLOSED (v0.143.0) — `ps` on a box you have ENTERED showed nothing. It was a producer
  disagreement, and the first diagnosis recorded here was wrong.** Found 2026-08-16 by the D4 Act
  13 browser run: a guest standing on another player's box ran `ps` and got the header and no
  rows, while that box was running the sshd they had just logged in through.

  The entry originally blamed the read filter and proposed projecting `/var/run` to a foreign
  session regardless of tier — a change to the recon/defence balance. **That was a misdiagnosis,
  and the fix it proposed would have been a hole punched in the filter to route around a bug
  elsewhere.** The filter was correct: it was pruning a file the box genuinely called root-only.
  The three world generators each stamped their pidfiles world-readable, while `bringUp` in
  `daemon.ts` passed no `permissions` at all and took the write's fall-back — the CALLER's tier
  defaults, and a daemon is root-only, so `read: ['root']`. A pidfile the world planted was
  visible to a visitor and one the owner started was not. Same file, same directory, two answers,
  depending only on who put it there.

  Fixed by making the shape explicit and shared: `PIDFILE_PERMISSIONS` is exported from
  `services/pidfile.ts` — the module that already owns the pidfile's FORMAT — and all four
  producers resolve it. It had existed as three private copies (`routerFs.ts`,
  `generateDeepLayer.ts`, and as `PIDFILE_PERMS` in `remoteHostFs.ts`); adding a fourth at the
  call site would have fixed the symptom and left the cause.

  **What generalises past this bug:** a write that names no permissions is not neutral — it
  inherits the writer's tier, so a root-only command silently produces root-only files. That is
  right for a file root authored and wrong for a file that describes the machine to everyone who
  can reach it. And `env.fs.root()` still means two things — the raw tree on your own box, and an
  already-pruned tree across a hop — so a unit test that builds a tree by hand cannot see this
  class of defect at all. `ps.test.ts` now walks the real projection (the write `sshd` makes → the
  patch row → `applyPatches` → `filterTreeForRead` → `ps`), which is the shape any later claim
  about what a visitor sees should copy. Act 13 in `e2e-shared-network-verification.md` is the
  browser-level proof.

- **`AvailabilityRule` is inert — enforce it or delete it.** Every command declares one
  (`{kind:'any-machine'}`, `'localhost-only'`, `'installed-package'`) and **nothing in production
  code reads `command.availability`** — verified 2026-08-10 by grepping `\.availability\b` across
  `src/` excluding tests: no hits. Runtime gating is `availability.ts`, which resolves `/bin/<name>`
  against the live FS and reads the binary's own execute perms — a different mechanism that never
  consults the declared rule. So `localhost-only` on `ssh` is documentation that looks like
  enforcement, which is the dangerous kind: a reader reasonably assumes the rule holds. Decide one
  way. If enforcing, note that `hydra` deliberately runs anywhere ("tools run where you stand") and
  its `any-machine` is load-bearing intent, not a default.

  Re-verified 2026-08-16 while shipping `ps`: still no production read, and the only read anywhere
  is one assertion in `john.test.ts`. It also surfaced independently as a **mutation survivor** —
  blanking `ps`'s `availability` to `{}` changed no observable behavior — which is the cleanest
  evidence of inertness there is, and a reason to expect the same survivor on every command added
  until this is decided.
- **A shared DEEP box's auth.log is written under the ATTACKER's key, so one occupant's lines hide
  another's.** Found 2026-08-11 while grounding D2.4 slice 5. The deep chain is ESSID-seeded and
  shared — `generateHomeLan(essid).hosts` for the entry, `generateDeepLayer(essid, frontingGateway)`
  and `hostMachineId(deep.host, essid)` for the walk — so every occupant of an ESSID reaches the
  same deep boxes. But `authCreateSessionInnerGateway.ts:358` writes its deep-reach line with
  `writerKey: publicKey`. Since `materializeMachineFs` folds so the latest write to each path wins,
  and `appendMachineLog` appends to the writer's OWN row, occupant B's line **replaces** occupant
  A's in the materialized view. This is precisely the collision the credential layer already
  solved on the public path, where `resolvePublicTarget` returns a box-owned `logWriterKey` (the
  reached occupant's key, or the AP's stable key when the box is ownerless) so every attacker's
  lines accrete into ONE row. **Affected THREE paths**, all writing `writerKey: publicKey` onto
  ESSID-shared deep boxes: the deep ssh reach (`authCreateSessionInnerGateway`), the deep sweep
  (`hydraCrackInnerGateway`), and the deep scan's `kern.log` (then `nmapScanDeep`). D2.4 slice 5
  deliberately made hydra match the other two rather than diverge — hydra and `ssh` disagreeing
  about one box is the worse failure. A deep NPC is ownerless, so the fix is the
  `apGatewayLogWriterKey` shape: a stable key derived from the box, applied to all three writes in
  one slice, with a test proving two occupants' lines coexist. The stale "private, per-viewer"
  docstrings that hid this were corrected across the codebase at D2.4 close-out.

  **CLOSED at v0.225.0**, and wider than the three paths above. Everything that touches an
  ownerless box now files under `apGatewayLogWriterKey` on the ESSID's leases: the reach's
  deep and own-LAN branches (so mysql/redis/snmp inherit it), `hydraCrack` own-LAN, the deep
  sweep, the deep ssh reach, both scans, and the exploit's trace. A box with an OWNER is
  unchanged and still keyed to them, and effect WRITES are unchanged and still keyed to the
  actor — those rows are provenance and are meant to coexist.

  Proven live by `scripts/testSharedBoxLogTruth.ts`: two players sweep one generated box,
  and afterwards there is ONE row at that `(machine_id, /var/log/auth.log)`, keyed to a
  third player who holds the lowest lease and never acted, holding both attackers' lines.
  Reverting the rule takes it to 2/7 with `rows=2`, `+0 from bob`, `bob MISSING` — the data
  loss itself, on the real journal's fold. That falsification is what makes the green run
  worth anything; the other four candidate scripts pass UNCHANGED either way, because they
  seed no leases and so only ever exercise the `?? publicKey` fallback.

  Two things the original entry did not predict. The blast radius was wider than "deep": the
  reach's OWN-LAN generated branch had the identical bug, and so did `hydraCrack`'s own-LAN
  sweep, which resolves its own targets and never appears in the deep list at all. And the
  three paths are coupled through the FILE, not the depth — `spec.sweepLog.path` is the same
  file the data doors write, so hydra had to move with them or a login and a sweep would have
  split one log the moment the reach changed. The rule that follows: the unit that must agree
  is `(machine_id, path)`, not the vantage.
- **D2.6b — harvestable plaintext loot, the missing input to wordlist growth. POSTPONED by owner
  decision 2026-08-12**, in favour of parity breadth; the harvest route can arrive with the CVE
  phase (decision 6 names `password_reset`) rather than as bespoke loot content. Hidden credentials
  are still wanted later, as content. The gap itself is unchanged and still open: the progression
  the credential layer was built around does not close, because appending a word works (#377) but
  nothing in the generated world hands a player a word they could not already crack (full reasoning
  in `project-status.md`'s D2 block). What it needs is a file on a reachable box holding a
  **plaintext** drawn from the UNCRACKABLE pool — a `credentials.txt`, a config with `password=`, a
  note. Two constraints, both already load-bearing: it must be **uncrackable-pool** or the harvest
  is a no-op, which is what makes `defaultWordlist.test.ts`'s "covers the uncrackable pool NOT AT
  ALL" the assertion that gives the loot its value; and it must sit behind a **tier gate** or a
  guest walk-in reads it, the same reason `/etc/passwd` is `read: ['root','user']`. This also makes
  `john` genuinely non-redundant, by the route D2.5's grounding named second — a plaintext file, not
  a hash file, since a hash file would still hold a hash of one of the two pools.
  **Whatever closes this, `/etc/passwd` does not**: it yields an md5, and `john` against that hash
  only returns words already in the caller's wordlist — the closed loop itself, not a way out of it.
  So the CVE phase must ship a route producing a plaintext the player did not hold, or the
  progression stays inert however many doors parity adds. The three loot designs worked out before
  the postponement are recorded in the parity epic's "Next action" so the option set survives.
- **Neon themes deferred.** Known limits of the block cursor, found in Chromium and left as they
  are: the drawn line wraps where the invisible input scrolls, so a click on a wrapped second line
  places the caret by the input's single-line layout; a selection made with Shift and the arrows is
  not drawn; IME and mobile keyboards were never checked. The output pane shows a horizontal
  scrollbar under the wide banner at phone width, older than the neon work. Firefox was not
  checked for the glow's `color-mix` with `currentColor`. Out of the epic's scope:
  `public/og-image.*` and the meta and OG descriptions in `index.html` still show and describe the
  amber terminal.
- **World content deferred.** The generated world content epic shipped (#533–#550, as-built in
  [`world-content-architecture.md`](./world-content-architecture.md)); its motivating backlog
  entry, which stood here since the owner decision of 2026-08-12, is retired. Named at its grills
  and deliberately not decided — design when a slice leans on one:
  - **Tablets as photo devices, pairing and lock entries.** A share's photos, a media box's
    pairings and a lock's log name phones only; letting them name tablets re-rolls the share and
    device content. Read `tabletModel`, never extend `PHONE_MODELS`, or the two will disagree.
  - **A phone-shaped `/root` and `/etc`, and screenshots.** A phone's `/root`, `/etc` and logs are
    still the workstation role's; a screenshot needs PNG, a new document format.
  - **Site ↔ database agreement.** A café's menu page need not list its `menu_items`, and a
    portal's CMS posts are not its pages.
  - **`~` in replayed history lines.** v2's `cat`/`ls` do not expand `~` (`cd` defers it too), so
    a history line like `cat ~/notes/todo.txt` answers "No such file" when replayed, while `cat
    notes/todo.txt` from the home works. Either the shell learns tilde expansion or histories
    spell home paths another way; decide together with `tail` (above).
  - **Memoization of base trees** — the key, the cache bound on each end, and whether the derived
    network population is memoized alongside — only when `checkBudgets.ts`'s build budget breaks.
  - **Archetypes for IoT and gateways**, as databases have; and whether the AP gateway's content
    files need their own serialized-size check beside the wire ceiling.
  - **Log permission constants** — reuse `baseFs.ts`'s or add the few Debian defaults still
    missing, for whichever log next needs one.
- **Three things D1b left behind** (plan closed 2026-08-14 at v0.129.0, Act 9 green; the plan file
  was deleted on close-out and these are the only parts that outlived it):
  - **The renderer has no tables and no preformatted blocks.** Deliberate: no page in
    `webPages.ts` has either, and the legacy renderer's table code was the bulk of its 401 lines.
    Add them when content does, not before — and note the renderer takes no width parameter
    (CSS wraps), so nothing here needs wrapping arithmetic.
  - **`followLink` has two untested branches** — the offline guard (4 no-coverage mutants) and the
    "a different overlay is open" guard. Both predate slice 7 and neither was named by a criterion,
    so they were left rather than quietly absorbed. Cheap to close: the harness in
    `state.test.ts` already builds a browsing game; an offline variant needs a store without the
    persisted ESSID, and the other needs `nano` open when `followLink` is called.
  - **`resolveOccupants.test.ts:134` is a coin flip, ~1 run in 222.** Two random identities derive
    the same LAN address 90 times in 20000 (0.45%, measured 2026-08-13), and the guard asserts they
    differ. Pre-existing and unrelated to D1b — it surfaced during a slice-5 full-suite run. Worth
    its own small PR: seed the two identities apart rather than trusting the roll.
- **Nine known surviving mutants in generated config content, never owned.** Exposed by D2.2's
  honest mutation run (once a raised timeout stopped scoring timeouts as kills) in code that slice
  never touched: the `RULES_V4_SEED` / `ACL_CONF_SEED` header lines and their `join('\n')`
  separator, plus `buildDeepSwitchBaseFs`'s config subtree mutating to `{}`. The tests assert those
  files *parse*, so blanking a header a player reads with `cat`, or building a deep switch with no
  `acl.conf`, goes unnoticed. Not blocking anything; small, well understood, and worth a short PR.
- **124 plan tags are still embedded in code comments, and the rule against them is always-apply.**
  Counted 2026-08-11: `Story N` / `Slice N` / `5b.Na` / `D2.N` appears 124 times across 64 files
  (40 production, 24 test), including **9 inside `describe`/`it` titles**, which
  `conventions-and-gotchas.md` §1 forbids by name. All of it predates the rule. It is exactly the
  rot the rule exists to prevent: plan files are
  **deleted on close-out**, so every one of these points at something a reader cannot open —
  `ssh.ts:304` explains its dispatch by citing "5b.1a"; `bindFlags.ts:10` narrates four slices of
  its own history instead of stating what the flag parser does; `nmapScan.test.ts:392` names a
  Story in a `describe` title, so the suite prints a dangling reference on every run.
  **Not a mechanical find-and-replace.** Deleting the tag alone often deletes the only explanation
  the comment carried — the fix is to say the WHY the tag was standing in for, which needs the code
  read one site at a time. Sized like several sittings, not one; it conserves behaviour entirely
  (comments and test titles only), so it is a clean `refactoring` candidate with the existing suite
  as its whole preservation evidence. Best done per-file when a slice is already in that file,
  rather than as one enormous unreviewable diff.
- ~~**A NAT forward reaches only ONE occupant of a shared AP**~~ — **FIXED at v0.99.0.** The
  public paths no longer resolve "the box behind the NAT" at all: a forward's `internalIp` is
  matched against the ESSID's `network_lan_leases` + `home_network_occupants`, so it lands on
  whoever actually leases that address. Every occupant is forward-reachable, two forwards on one
  gateway reach two different boxes with two different credentials, and each is gated on its own
  target's liveness. As-built in `cross-player-architecture.md` §3; wire-check
  `scripts/testSharedApForwards.ts`.
- ~~**Saving a shared file deletes another occupant's edits**~~ — **FIXED at v0.101.0 (server
  refusal) + v0.102.0 (the y/n confirm).** An editor save carries a sha256 of the content it was
  SHOWN; the server compares it against the row a reader materializes and answers `409
  modified_since_open`, and nano asks GNU nano's own question rather than reporting an error.
  Last-writer-wins is preserved on purpose — a deliberate clobber is one keystroke, a blind one
  is impossible. An absent fingerprint means an unconditional write, so `>`, `touch`, `apt` and
  the sshd pidfile are exempt by construction. As-built in `project-status.md`; repro, the fix and
  the three-player re-verification in `e2e-shared-network-verification.md` §6.
- **A shared-file view is still stale, deliberately.** The fix above stops the *destruction*, not
  the staleness: a session on a foreign machine still never learns of a foreign write, because
  the `patches-changed` channel remains workstation-scoped. So refusals are ROUTINE, not rare —
  a co-edited gateway will ask most times. Two cheaper-looking fixes were considered and left:
  a refetch when an editor OPENS a foreign file (narrow — does not help a concurrent save), and
  a machine-scoped invalidation channel — **now decided against, see below.**
- **DECIDED 2026-07-31: no Supabase Realtime. The staleness is accepted; a fresher READ is the
  approved direction if we ever fix it.** Three reasons, in order of weight:
  1. **Legacy shipped this and it leaked.** Broadcasting patch changes let a player read, from
     the browser's Network tab, what other players were changing on machines they were not on
     and had no permission to see. Legacy's fix was to send the broadcast back EMPTY for an
     unauthorized subscriber — which is the tell: the push had already degraded into a bare
     hint, and the hint still needed authorizing.
  2. **There is no identity for RLS to key on.** Realtime's `postgres_changes` evaluates RLS for
     the *subscribing* identity, but a player here is an Ed25519 keypair the API layer verifies
     per request — not a Supabase auth user. Every browser would subscribe as the same anon
     role, so no policy can express "only occupants of this ESSID". That is a mismatch between
     two identity systems, not a config gap. The bridgeable form is Realtime **Broadcast** on
     per-machine topics with API-issued subscription tokens — buildable, but a subsystem with
     its own auth surface.
  3. **It would be the first direct client↔DB channel.** `@supabase/supabase-js` is imported
     ONLY in `api/*` under `service_role`; the browser holds no database connection at all and
     every read is a signed request the server authorizes. That invariant is cheap to keep and
     expensive to restore. Even a data-free hint leaks the existence of a change on a box you
     cannot see.
- **The staleness is worse for LOGS than the entry above implies, and D1 made that plain.** The
  co-edit case is a genuine race and rare. A defender's log is not a race: **every** cross-player
  trace is invisible until the defender happens to do something that triggers a refetch, because
  the server writes it on their behalf and nothing tells them. That is `/var/log/kern.log`
  (someone scanned you), `auth.log` (someone tried to log in) and now `access.log` (someone
  fetched or probed your page) — all three, 100% of the time. Verified live 2026-07-31: a player
  was fetched and traversal-probed from another network four times and her terminal showed
  nothing until she ran an unrelated command. Nothing is lost — the rows are correct in the
  journal — so this is read freshness, not data.
  **If we fix it, the approved shape is a PULL, not a push:** refetch the journal before reading
  a file the server may have written behind your back (the three paths already exist as
  `ACCESS_LOG_PATH` / `AUTH_LOG_PATH` / `KERN_LOG_PATH`, and `refetchPatches` is already written
  and already called on every write). That needs **no new authorization model** — it is the
  existing signed `listPatches` for your OWN machine — and costs one round trip on
  `cat /var/log/*`. Do not re-open Realtime for this.
  **Re-confirmed 2026-08-14 at v0.130.0, and it now covers a fourth writer**: D1d's live run left
  a 3201-character `access.log` row on the swept box while the owner's `cat` printed nothing, until
  an unrelated command that wrote locally brought the whole file in at once. The control matters —
  a `curl` through the same forward was equally invisible, so this is the shipped shape of every
  cross-player writer and NOT a property of the sweep. It is the single most repeated
  false-alarm in this project's E2E runs: **when a log reads empty, check the row before believing
  it**, `docker exec supabase_db_jshack-me psql -U postgres -tAc "select content from patches
  where path='/var/log/access.log' and machine_id='<box>'"`, and resolve `<box>` from
  `home_network_occupants` rather than by hostname — a previous session's `skylab-…` answers with
  months-old lines and no error. Journey detail: `e2e-shared-network-verification.md` Act 10.
  **Re-confirmed 2026-08-31 at v0.193.0 (D8 close-out), and `snmpd.log` is the fifth writer**: in a
  two-browser-session run, A walked B's workstation agent, B's live `cat /var/log/snmpd.log` printed
  `No such file or directory`, and the row was already correct in the journal (right `machine_id`,
  B's own `writer_key`, `/var/log` present) — a browser reload alone brought the trace in. It is the
  same shape as the four writers above and NOT a defender-audit gap or a D8 bug: the trace is
  recorded and owner-readable, only not pushed to an already-open session. This nearly cost a wrong
  "workstation walks aren't logged" fix; the row check is what caught it.
- **`echo x > rules.v4` wipes a co-occupant's rules unasked — DECIDED, a mechanic, not a gap
  (2026-10-08).** A redirect carries no base fingerprint by design — it truncates by definition,
  and the player was never shown the content — so it overwrites a co-occupant's rules with no
  question asked. The owner kept it: `>` means truncate everywhere, a blind wipe of a shared
  gateway's rules is a legitimate move, and the defender learns of it the hard way. Do not
  propose a guard, a shared-file carve-out, or a dedicated trace for it. `set -o noclobber` is
  no answer either way: it protects the writer from themself, never the file's other owner.
- **Two journal fetches for the SAME machine can still land out of order.** Fixed at v0.98.0:
  `refetchPatches` drops a late answer for a machine the player has LEFT, so a hop no longer
  paints the box you came from over the box you are on. What the machine-scoped guard does not
  cover is two in-flight fetches for one machine — a cross-tab `patches-changed` hint racing a
  write's own reconciliation — where the older answer landing last leaves `patches()` one write
  behind until the next refetch. Own-box only (the sync channel is workstation-scoped) and
  self-healing, so it was left. The obvious fix — a monotonic "newest issued fetch wins"
  counter — is NOT a drop-in: it would also discard the reconciliation `wrapWithRefetch`
  awaits, breaking the documented promise that a command's write is visible to the next line it
  runs. Any fix has to keep that one.
- **Pivot / operate-from-a-hop ✅ SHIPPED (#598–#615, v0.307.0–v0.323.0).** Every IP tool now runs
  from the box its shell stands on — reachability and server-derived source address both — so a trace
  left through a hop names the hop, not the attacker's home. The old "established session never
  re-validated against its route" open question was answered here: a reboot (or a box going dark)
  cascades to the sessions stacked above it (`upstream_lost`), which is the defender's eviction move;
  an established leg is otherwise not re-validated (a changed password / forward / ACL affects only
  new logins). As-built: handbook chapters 7 ("Reachability") and 8 ("Reboots and boot ids"), and
  `cross-player-architecture.md` §8. **Follow-ups** found in the close-out e2e (2026-10-07), all on
  commands outside the epic's vantage scope. Three closed at v0.324.0: `whois` asks from the vantage
  (so a hop answers with the home card off), `man ssh` says `exit` steps back one hop, and a WiFi
  change in one tab is followed by the others (each tab listens for the others' `storage` writes).
  The fourth closed at v0.325.0: **`reboot`'s `kern.log` line** used to source the actor's HOME
  public IP and name a gateway by its machine-id part (`ap-gw`). It now names the address the
  rebooting session's login came from — every door stores its server-derived address on the row
  (`sessions.source_ip`, no longer the client's), `su` and a local exploit inherit their shell's —
  and the box's generated hostname. A backdoor (`nc`) login stores its address too, though it logs
  nothing on the way in, so a reboot from a backdoor shell does name the knocker.
  Two more, found while checking the cross-tab fix in two real tabs (2026-10-07):
  - **Each tab keeps its own scan list.** `nmcli connect <ESSID>` refuses with `network "<ESSID>"
    not found` in a tab that never ran `airodump-ng`, even when another tab scanned it moments ago —
    the scan roll lives in that tab's memory, not on the card. Following a connection does not
    need the list, so only a fresh connect in a fresh tab bites.
  - **A followed connect leaves the tab's monitor mode on.** A tab in monitor mode that follows
    another tab's connect ends up both associated and in monitor — the state `airmon-ng` (refuses
    while connected) and `nmcli` (refuses in monitor) otherwise keep apart. A real card cannot be
    both; following a connect could switch monitor off. Reasoned from `followConnection`, not
    staged live (the scan-list item above blocked the second tab's connect).
- **Replay/nonce store** — built (#294, with a 7.2.0b retrofit + lazy prune) then REVERTED on the
  owner's call (ship-first): narrow value in this threat model (TLS wire + the adversary is the
  player's own key-holding client → an authorized player just re-signs with a fresh nonce, so it
  only blocks *byte-identical* resubmission — captured-envelope reuse by a non-key-holder plus
  duplicate non-idempotent effects; idempotent upserts + per-request re-authorization
  (L1/L2/`canBoot`/tier) carry the real guarantee). Keep `noopNonceStore` everywhere; **revisit at
  multiplayer-hardening**, where it becomes load-bearing if envelopes ever become shareable. The
  legacy-parity epic takes the same posture for its wordlist obfuscation, so the two revisit
  together. **Preserved re-add design** (cheap to reinstate): `createSupabaseNonceStore(db)` over a
  `nonces` table (`nonce` PK, `created_at` + index, RLS service-role-only);
  `.upsert({nonce},{onConflict:'nonce',ignoreDuplicates:true}).select()` → inserted row ⇒ fresh,
  conflict ⇒ replay; **fail-open** on DB error (degrade to timestamp-window-only); **lazy
  fire-and-forget prune** of rows older than `REPLAY_WINDOW_MS` after each insert (self-cleaning,
  no cron). Wire it at the `verifySignedRequest` seam in `api/patches.ts` (×5), `api/network.ts`
  (×3) and `api/sessions.ts` (×6). Prove it with a `scripts/testNonceReplay.ts` wire-check
  (replay → 401 `replay`).
- **Is the hand-rolled tree walk's mutation noise a house-wide cost or a local one?** Six
  modules reach a known path by walking `entries.get()` a directory at a time, each guarding
  every level with `x === undefined || x.kind !== 'directory'`: `sessions/passwdAccount.ts`,
  `services/pidfile.ts`, `commands/ssh.ts`, `network/iptablesRules.ts`, `network/switchAcl.ts`
  and `mysql/datadir.ts`. On the last of those the guards produce **13 surviving mutants of 46**
  — every one on the four guard lines, twelve needing a system directory to be a FILE or absent
  (states the generator never draws and no patch creates) and one provably equivalent, since a
  directory where `data.json` should be yields `undefined` content that `parseMysqlDatabase`
  already answers `null` for. Accepted there as `conventions-and-gotchas.md` §3's type-narrowing
  class.
  **The assumption worth checking is that the other five behave the same.** It was reasoned, not
  measured. If they do, that is a repo-wide floor on the mutation score of every path reader and
  an argument for one shared `directoryAt(fs, segments)` that concentrates the guards in a single
  place; if they do NOT, then `datadir.ts` is doing something the others are not, and the reasoning
  that waved its survivors through is wrong. Cheap to settle — scope Stryker to those five files
  and read the survivor lines. Do it before citing "type-narrowing, accept it" for a third module,
  and note that a shared walker is exactly the kind of abstraction worth proposing collapsed:
  six call sites is the evidence, not the guard count.

**Game-design / content ideas** (same game; may carry to v2):

- **Library-CVE privilege escalation** — `/lib/*.so` libs as a privesc vector (library CVE
  → `msfconsole --local` → root). Build the binary/availability/library model so
  versions/CVEs bolt on without rework.
- **Player-driven service patching (defender role) — RESOLVED 2026-10-18 (v0.403.0, #701).**
  Grilled down to "a firmware flash reboots the router": services and libraries already behave
  as on a real box (every reader takes the version from the manifest), and a CVE going inert
  game-wide was rejected because it needs a stored shared record. Moving a router's firmware now
  reboots it; see `project-status.md` item 16.
- **Wordlist progression** — hydra as progression: a weak default wordlist, harvest
  passwords to expand coverage.
- **Themed persistent networks** — `world_networks` infra + a findit.io directory;
  office/police/university/café as drop-in additions; handler+generator registries dispatch
  on `theme`. CVE-eligible themed ports need `Port.owner` stamped; pages must be well-formed
  HTML; CVE pickers constrain INITIAL state only (not post-`apt upgrade`).
- **Player-hosted websites — RESOLVED.** A player runs apache2/nginx, forwards `:80` on their
  gateway, and findit.io lists the page under its bare public IP — crawled live at every
  search, never submitted, opt-out by `robots.txt`. As built: forwards in
  `docs/cross-player-architecture.md`, the crawl in `docs/discovery-architecture.md`.
- **A reason to keep a service running (its own epic).** Since v0.330.0 a workstation is born
  running 1–3 services and the CVE clock opens holes in them; an owner's safest move is to stop
  them all, and nothing yet pays them not to. Give a running service something to offer (perhaps
  a special service), so keeping it up is a trade rather than a mistake. Deferred by the owner
  when the attack-surface epic was grilled (2026-10-07).
- **Multi-target NAT forwarding** — distribute public-port forwards across multiple
  outer-layer machines.
- **Mission template vs instance model** — catalog templates + per-acceptance instances;
  public IP is the instance key; instances permanent + shareable.

**Realism notes** — same-LAN scans log the LAN IP, cross-network log the public IP (the
same-LAN-IP leak is load-bearing for defender gameplay). `nmap <router.1>` from inside the
LAN shows a merged view real PREROUTING wouldn't — a known realism gap.

**Legacy-parity parking lot** (named across the epic's grills, deliberately not built; the
epic that owned them is retired):

- **A pre-release realism pass over every command's argument surface.** v2's house style
  deliberately simplifies flags the real tools spell out (`hydra [-p port] <host> [service]
  [user]`, `john <file>`, `snmpwalk <host> [community]`, `redis-cli <host> [password]`, `find`'s
  positional shape). #464 bought realism in the binary NAMES, not the arguments. The
  realism-versus-simplicity tension is real, so the whole set gets tweaked **together, once, before
  release**, with a player's muscle memory in view — not one command at a time. hackademy.io's
  examples ride with it: the tutorial tests check an example's command and never its arguments
  (`tutorials-architecture.md` "Accepted gaps"), which is how a bare `systemctl status` shipped,
  so the pass rewrites the chapters too and is the natural place to start checking arguments.
- **Tutorials dropped into the player's home folder — RESOLVED 2026-10-09 (v0.335.0–v0.340.0,
  #631–#636).** A home `README` walks a new player online and into `lynx`, and `hackademy.io`, an
  attackable in-world site, teaches the world in ten chapters, scripting and its example scripts
  included; it is the one place the game names `findit.io`. As built:
  `docs/tutorials-architecture.md`.
- **`nmap`'s SERVICE column as a port→name GUESS.** Real nmap labels a port from `/etc/services`
  (31337→elite, 4444→krb524, unlisted→unknown), so the column is never evidence. One small table,
  flavour only; a listener reads `unknown` either way and probing stays how you learn the truth.
- **`techparts.io` and further themed/publisher networks** — content, not capability; drop-ins once
  X2's registry exists (see `discovery-architecture.md`).
- **Wordlist hardening** — the recorded path if the obfuscated-uncrackable-pool cost ever bites:
  ship md5 hashes to the client, keep plaintext server-side, make hydra/john server calls. Same
  posture as the reverted nonce store; revisit at multiplayer hardening.
- **A service drawn onto a box that can never answer it is a wasted placement** — a `mysql` rolled
  onto a router/switch is unreachable (its in-play ports are `22`+`161`). Surfaced by X2 slice 5;
  the doors and web tools agree with the scan now (#561), but the placement itself is still spent.
