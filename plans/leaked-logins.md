# Plan: the routes that leak a login

**Status:** Grilled 2026-11-03. Slices not yet planned. Nothing is built.

Contract networks ship with two ways onto the key box: `hydra` (a crackable root) and `msfconsole`
(a critical hole). This epic adds four where a forgotten file or setting leaks root's password. A
job pays its usual JSC, and the player keeps a word that opens other doors in the world, which closes
D2.6b (`docs/backlog.md`): nothing in the generated world hands a player a word they could not
already crack. As-built context: `docs/missions-architecture.md`. The item comes from `docs/backlog.md`
under "missions — deferred".

---

## Grill record

1. **The leaked word comes from the uncrackable pool (2026-11-03).** A crackable word cannot be the
   leak, since `hydra` already finds it and the file would add nothing. The shape already draws an
   uncrackable hash for a key box's root, so `ssh`, `hydra` and `ftp` work unchanged. The server needs
   the word at runtime, so "the game never holds them" becomes "the bundle never holds them". This
   departs from the backlog's "written from the server-only secret": `MISSION_KEY_SECRET` is not the
   word's source. Rejected: a word derived per contract from the secret (the hash could not be in the
   bundle, so the server would overlay `/etc/passwd` at every door that authenticates a mission box,
   and the word would open one box and be worthless afterwards, leaving D2.6b open).

2. **The word opens `root` directly (2026-11-03).** The key file is root-only and nothing but the
   route climbs, so a user login alone would strand the player. Rejected: a user account then a second
   leak for root (two server-written files and a guaranteed user account; a good harder template
   later, with higher pay); a user account with the key readable on this route (permissions varying
   by route, and a contractor never needing root).

3. **All four doors, one slice each, web first (2026-11-03).** Web proves what every route shares: the
   server-written word, the two forwards and the new draw. FTP, database and SNMP each add one tool,
   and the epic can stop after any slice. Rejected: web and FTP only; web only.

4. **Only a fixed slice of the pool can leak (2026-11-03).** The pool holds 52 words, accepting and
   dropping a job costs nothing, a dropped slot refills on the next board read, and the network stays
   reachable for good. So a farmer collects all 52 in about 240 leak jobs, words are shareable, and
   every door that drew an uncrackable word would then fall to `hydra`. A leak route's root draws from
   a slice of about 13 words, reached in about 40 jobs, opening about a quarter of the world's
   uncrackable doors and no more. 13 is a starting number, measured against the world before locking.
   Rejected: a cooldown after dropping (slows the farm, no cap, one more rule); leaving it open (ends
   the progression instead of closing it); growing the pool (only delays it, every hash ships in the
   bundle, and it re-rolls every generated door).

5. **A flat draw across the shipped routes (2026-11-03).** `prng.pick(ROUTES)`, a third each once web
   ships, a sixth each once all four have. Each slice re-rolls every contract's route. That is free
   today: the owner confirmed no jobs are in flight, and prod's only players are the owner's test
   accounts and a bot. A number's address, key and key path never move, so a key already read still
   pays. This is the plan `missions-architecture.md` asks for when a shape changes. Rejected: a
   separate stream with a fixed leak share (reduces the disruption without removing it); storing the
   route on the contract row (breaks "the number is the whole network", and the client would need it
   from the server to work out the LAN on a hop).

6. **The web file sits on a path already on the default list (2026-11-03).** Being on `gobuster`'s list
   is the whole gate, and the default list already holds `.env`, `config.php`, `settings`, `notes.txt`,
   `todo.txt`, `readme.txt`, `backup`, `old` and `dump.sql`. The number draws one, so a plain sweep then
   `curl` finds it, with no list change and no bundle cost. Players learning to try `/.env` by hand is
   fair, and each try is an `access.log` line. The file is root-owned like every published page, so a
   guest shell cannot `cat` it but can `curl localhost`. Rejected: a path off the list with a pointer
   to it (a good harder template later; a player who only sweeps would think the job broken); a mix.

7. **The server holds the words by reading `JSHACK_SECRETS` at runtime (2026-11-03).** A server-only
   module, imported from `api/` and `scripts/` alone, parses it with the existing `parseSecrets` and
   returns the word for a slice position. It is already set in all three Vercel environments and kept
   readable, so there is no new variable and no deploy step, and the words cannot drift from the pool.
   A missing value fails closed, as the key does. A test pins that only slice words can come out.
   Rejected: a second variable holding the slice (a second list to keep in step, where a mismatch is a
   login that silently fails); allowing `__plaintext.ts` in `api/` (weakens the lint rule and puts
   every word in the function bundle).

8. **A file shows the word and never names the account (2026-11-03).** `ADMIN_PASS=<word>`, or "the
   server password is still `<word>`, change it!". The player works out that it is a login and whose:
   by hand, or by appending it to `passwords.txt` and running `hydra`, which is the loop D2.6b was
   built around. Every wrong try is an `auth.log` line and the box has three accounts. All four doors
   use this style, and the text is built on the server. Rejected: naming `root` (teaches nothing beyond
   finding the file); dressing it as another service's password (a box with no database on this route
   would mislead, and a player could reasonably give up).

9. **Pay does not change (2026-11-03).** 500–2,000 JSC from the number, for every route. Offers show no
   route and pay gives no hint of one. The word is the extra reward, found by doing the job. Rejected:
   paying less or more on leak routes (either lets a reader guess the route, and ties pay to route).

10. **Anonymous FTP is a real login, switched on by the box's config (2026-11-03).** Only an FTP route's
    key box carries `anonymous_enable=YES`; every other box stays `NO`, and the pool's promise that a
    setting says what the door does stays true. `ftp <address> anonymous` accepts any password and gives
    a guest-tier session in `/srv/ftp`, the file in `pub/`. No account joins `/etc/passwd`, and `ssh` as
    `anonymous` still fails. The door reads the file, so a root who sets it to `NO` closes it for later
    visitors. `vsftpd.log` records the login and the transfer. A planted listener already opens a session
    with no password (`authCreateSessionPublic.ts`), the precedent for the branch. Accepted: the file is
    guest-readable, so a guest shell over `ssh` can find it too. Rejected: a hardcoded check on the route
    (the config would state something the door ignores); a guest-readable file with no anonymous login
    (not really about FTP, just another file behind `hydra`).

11. **The database route is a `settings` table behind a guaranteed crackable login (2026-11-03).** A
    database here is a file, `/var/lib/mysql/data.json`, read from the journal over the generated base,
    so the server lays the word in as it does the key. The key box runs `mysqld` on a safe release, one
    application account always falls to `hydra`, and database root stays uncrackable. The server adds one
    table with rows like `admin_pass = <word>`, and the rest comes from the existing application
    generator. The player runs `hydra <address> mysql`, logs in, `SHOW TABLES`, `SELECT`. A root reading
    `data.json` sees the row too, and a `DELETE` sticks. Rejected: a plaintext column in `users`
    (`databaseApp.ts` keeps those bcrypt-shaped so that table is recon, and everyone looks there first); a
    database with no password (a new door branch, and FTP already teaches that).

12. **The SNMP route puts the word in `syscontact`, on an agent that refuses `public` (2026-11-03).** The
    server writes `snmpd.conf` with the word in `syscontact` and a read-only community from a small
    guessable pool (`monitor`, `netops`), and the read-write community is guaranteed crackable. `nmap`
    shows `161`, `snmpwalk <address>` gets silence, so the player guesses a community or runs
    `hydra <address> snmp`, then walks with it. No new walk output. Accepted: `snmpd.conf` is
    world-readable, so a guest shell can read the word without walking; whoever holds the read-write
    community can `snmpset` the key box's filter and shut later visitors out of `:2222` without being
    root, matching the rule that whoever gets there first can close a route. Rejected: `public` still
    answering (asks nothing of the player); a new tier-gated section of the walk (a new directive and
    new output in formatters shared with the own-box path, for little gain).

13. **No door that should stay shut may hold a slice word (2026-11-03).** Measured: a plain "first 13"
    would include the root words of findit.io and valleynews.io; the ten fixed boxes hold ten distinct
    positions. The 13 are chosen from positions no fixed box holds, and mission gateways and the
    msfconsole route's root draw only from outside the slice. A test fails if a fixed box's root or one of
    those shut doors ever lands on a leakable word, which also catches a pool rotation. The harvest opens
    ordinary NPC roots, gateways and databases. Players are unaffected: a workstation's root is the
    password its owner chose (`workstationFs.ts`), so no word touches it. Rejected: protecting the mission
    shape only (`emailit.io` or `boards.hireme.io` could fall to a list on another draw); no exclusions.

14. **A slice over the bundle ceiling asks for the raise it needs (2026-11-03).** Words, file text, the
    `settings` rows and `snmpd.conf` contents are built on the server as a standing rule. Each PR states
    its gzipped cost against 297,685 B of a 298,175 B ceiling, and any raise is the owner's to approve, as
    with talkit and missions slice 1. Lazy-loading stays its own epic, soon after. Rejected: lazy-loading
    first (its own piece of work, since box generation is synchronous); cutting content (already cut
    twice, and more content is welcome).

15. **Decoy services stay out of this epic (2026-11-03).** A route needs two forwards, the door holding the
    leak and `:2222` to `sshd`, because the web door cannot log anyone in. So `nmap` tells the route: `2222`
    is hydra, `80` or `21` alone is msfconsole, and `80`, `21`, `3306` or `161` with `2222` is a leak.
    Learning to read a scan is a real skill that pays only after several jobs. Decoys stay in the backlog,
    and a later epic blurring the pattern would re-roll networks and may need a plan for live players.
    Rejected: decoys as a fifth slice or first.

**Following from those, with no decision to make:** on a leak route `hydra` on `:2222` gets a guest or NPC
shell at most and `msfconsole` on the door's port finds nothing, since that package sits on a safe release.
A root's `rm` of a leaked file sticks, as with the key, and any root can close a route by removing the file
or changing the password or config. `scripts/hireme.ts show` prints a route's path and word for testing.
Accepted across the epic: harvested words can be shared, so about a quarter of the world's uncrackable NPC
doors can fall to a shared list; and each of the four slices re-rolls every contract's route, which stops
being free once real players arrive.
