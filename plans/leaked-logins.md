# Plan: the routes that leak a login

**Status:** Slice 1 (the web route) shipped at v0.442.0 and is verified on production. Slice 2 (anonymous FTP) shipped at
v0.443.0, with no production check planned. Their as-builts are below.
**Next: slice 3, the database route**, v0.444.0, not started. Slices 3–4 get their plans here as each starts.

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
   fair, and each try is an `access.log` line. The file is root-only, unlike a generated page, which a
   guest can read, so a guest shell cannot `cat` it but can `curl localhost`. Rejected: a path off the list with a pointer
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

---

## Slices

One PR per slice against `main`, each with its own version bump. Slice 1 carries everything the routes
share, so each later slice adds one door and one entry in `ROUTES`. The epic can stop after any of them.

| Slice | Version | The player can now…                                                      | Adds                                                                                       |
| ----- | -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1     | v0.442.0 | sweep a key box, read a forgotten file, and log in as root with its word | the leakable slice, the word module, the two forwards, the flat draw, the web file         |
| 2     | v0.443.0 | log in to a key box's FTP as `anonymous` and fetch the file              | the anonymous branch at the door, a truthful `vsftpd.conf`, `/srv/ftp/pub`                 |
| 3     | v0.444.0 | crack a key box's database and `SELECT` the word                         | `mysqld` on the key box, a guaranteed crackable account, the server-added `settings` table |
| 4     | v0.445.0 | guess or crack a community and read the word in a walk                   | `snmpd` on the key box, the server-written `snmpd.conf`, the guessable community pool      |

**Facts each later slice starts from, found while tracing slice 1:** a database is the file
`/var/lib/mysql/data.json`, so slice 3 lays in a whole file, the base's database plus the table, and a
statement's write-back then carries the table through the journal. `hydra <ip> snmp` and
`snmpWalkCrossPlayer` already exist, so slice 4 has no new walk output, though it should confirm that a
forward to `:161` on a generated box reaches the agent. Slice 2 should confirm a session row accepts a
username that no `/etc/passwd` holds, and cover the same-LAN path as well as the public one.

**Close-out, after the last slice that ships:** one browser run over every shipped route (browser runs wait
for the end of an epic), `docs/missions-architecture.md` updated with the routes, `docs/project-status.md`
and `docs/backlog.md` recording D2.6b closed, a `/dev` story on valleynews.io, and this plan retired.

### Slice 1: a contract can be a web route, where a sweep finds root's word in a forgotten file

**As built (v0.442.0, PR #750, merged 2026-11-03).** The criteria below are met. Criterion 10's 500 has unit tests
only, since a live check needs a server started without `JSHACK_SECRETS`. What a later slice should know:

- **Where a later route plugs in:** `ROUTES` and the route's branch in `missionShape.ts`, and `missionFiles` in
  `missionLeak.ts`, whose files every door lays in through `withMissionFiles` (`missionBoxFiles.ts`). The doors and the
  write gate take `findMissionFiles` and `missionFilePathsOf`.
- **The slice:** 13 words open 25.7% of Ridgemont's 1,263 uncrackable doors, measured, which is the quarter decision 4
  asked for.
- **Changed from the plan:** a file's wording is tied to its name rather than being a second draw, so a `.env` always
  reads like a `.env`.
- **Accepted, found while building:** everything under `/var/www` reaches any session's client, because anyone can
  `curl` it. Someone reading the traffic can see the word without leaving an `access.log` line.
- **The doors' secrets:** with `MISSION_KEY_SECRET` unset, a key box's web door answers 500 on any route that serves
  web. With `JSHACK_SECRETS` unset, only web routes close.
- **Bundle:** 297,806 B gz, which replaces decision 14's starting figure, against the same 298,175 B ceiling.
- **Production (2026-11-03):** production had no reachable contract, so the check accepted web-route contract 9000004
  on `kestrel`, a mailbox made for it. One fetch from a throwaway identity answered 200, and a word in the file matched
  root's md5, so production reads `JSHACK_SECRETS` at runtime. The contract and its `access.log` row were then removed.
- **Open, not from this slice:** `npm run build` fails locally on `checkBudgets`, findit's generated web taking about
  1,100 ms against a 1,000 ms ceiling. `main` failed it too before this slice. It needs its own fix or an owner decision.

**Value:** a contractor on a web-route job runs `gobuster`, reads a forgotten file with `curl`, works out
that the word inside is a login, and reads the key as root. They keep the word.

**Path:** `missionShape` draws the route and two forwards → `routerFs` writes both into the gateway's
`rules.v4` → the key box builder runs `nginx` on a safe release → the server lays the file into the box at
each door that reads it → `gobuster` and `curl` reach it through the forward → `ssh -p 2222` logs in against
the unchanged `/etc/passwd` → the existing key file and reply → the existing payout.

**Class:** behavior change. **Delivery:** independent PR against `main`, branch `feat/leak-web-route`.

**Required implementation skills:** `tdd`, `testing`, `functional`, `typescript-strict`, `refactoring` where
it applies, and `mutation-testing` at the PR gate.

**What it builds:**

- **The leakable slice, in the bundle** (`src/core/missions/leakablePool.ts`): `LEAKABLE_HASHES`, about 13
  hashes from positions no fixed box's root holds, and `SHUT_HASHES`, the rest of the pool. A fixed box's root
  comes from a cheap draw on its `host-fs-` stream, not from building its tree; a test holds that draw equal
  to the built `/etc/passwd`. Check for an import cycle first, since `routerFs` already imports `missionShape`.
- **The shape:** `route` is `prng.pick(ROUTES)`, still the third draw on the topology stream, so stems and
  octets do not move. `forward` becomes `forwards`, a list, with one entry on the old routes and two on a leak
  route. The gateway's admin and the msfconsole root draw from `SHUT_HASHES`, and a web route's root from
  `LEAKABLE_HASHES`. A web route's `nginx` sits on a safe release through the existing `safeVersionOf`.
- **The word and the file, on the server only** (`src/core/missions/missionLeak.ts`, imported from `api/` and
  `scripts/` alone): parses `JSHACK_SECRETS` with `parseSecrets`, finds the word whose md5 is the shape's hash,
  and refuses any hash outside `LEAKABLE_HASHES`. It draws the path from a pool of default-list names, draws the
  wording from a few templates, and throws an error the door turns into a 500 when the variable is missing.
- **One lay-in at every door that reads the box.** `findMissionKeyFile` and `missionKeyPathOf` widen from one
  file to the box's server-written files. The key already reaches `resolveCrossPlayerFs` and
  `remoteWritePermission`. The web door goes through neither, so the file also has to reach
  `generatedForwardTarget` in `resolveHttpFetch.ts` (which serves fetches and sweeps, both through
  `resolveWebTarget`) and `replayedGeneratedBox` in `resolveOccupantFetch.ts` (a shell's `curl localhost`). Each
  lays it in before the journal replays, so a root's `rm` sticks. **The key must stay unservable:** document-root
  confinement already keeps it out of reach, and a test should hold that.
- **The operator:** `show` prints the route, both forwards, the leaked path and the word.

**Acceptance criteria (for the owner to confirm before any code):**

1. Across numbers, routes draw about a third each. A number's address, key and key path are the same whichever
   route it draws.
2. On a web route, `nmap <address>` shows `80` and `2222`, and the gateway's `rules.v4` holds both forwards.
3. A default `gobuster http://<address>` finds the file, and `curl` returns text holding the word and never the
   word `root`. Each request is an `access.log` line on the key box.
4. `ssh root@<address> -p 2222` with that word opens a root shell that can read the key, and mailing the key to the
   client pays as on any route.
5. Appending the word to `passwords.txt` makes `hydra` find root on `:2222`. Without it, `hydra` finds no root there.
6. `msfconsole` finds no root through `:80` on a web route.
7. A guest shell on the box cannot `cat` the file but gets it from `curl localhost`.
8. After a root's `rm`, a later visitor gets a 404 and the key file is unaffected.
9. Only slice words can come out of the server's module. Over 2,000 numbers, no gateway admin and no msfconsole root
   holds a slice word. No fixed box's root holds one either.
10. With `JSHACK_SECRETS` unset, a web route's door answers 500 and serves no file. Boxes on other networks are
    unaffected.
11. Every existing guarantee in `missionShape.test.ts` still holds across all three routes: nothing but the route
    climbs, and a route's door is reachable through a forward.
12. `show` prints the route, both forwards, the path and the word. `checkSecrets` passes on a built `dist/`, and the PR
    states its gzipped cost against the ceiling.

**RED:** start from `missionShape.test.ts` (the draw, the forwards, which pool each door draws from), then
`missionLeak.test.ts` (the word, the refusal, the missing variable), then `resolveHttpFetch.test.ts`,
`resolveHttpSweep.test.ts` and `resolveOccupantFetch.test.ts` (the file served and swept, the `rm`, the fail-closed
500, the key not served), then `hiremeOrders.test.ts`.

**GREEN:** the least that passes each, in that order. **REFACTOR:** assess after each green. `forwards` touches
`hiremeOrders.ts`, `routerFs.ts` and `scripts/testMissions.ts`, which are the only readers of `forward` today.

**Measure before locking the 13:** a probe over Ridgemont's networks counting how many uncrackable doors each slice
size opens, printing counts and never words. If about a quarter is wrong, the owner picks the size before merge.

**Wire-check:** a new `scripts/testMissionLeak.ts` against `vercel dev` and local supabase, driving a real accept:
the sweep, the fetch, the word's login, the key, the payout, the `rm` sticking and the guest shell's `curl
localhost`. `testMissions.ts` moves to `forwards`, and its route search covers the new route. Run every
`testMission*` script, since each slice re-rolls their fixtures.

**PRE-PR mutation:** scoped to `leakablePool.ts`, `missionLeak.ts` and `missionShape.ts`, one file at a time.

**Deploy:** no migration and no new variable. `JSHACK_SECRETS` has only ever been read at build time, so a minimal
check after the merge confirms a web route's file serves on production, as slice 1 of the missions epic did for its
secret. That check runs on prod, so the owner approves it at the time.

**PR-ready when:** the criteria are met with their tests, `npm run typecheck`, `npm run lint` and the full test suite
pass, the wire-checks pass, and the mutation gate leaves only equivalents. The owner approves each commit.

**Slice complete when:** the PR merges and this plan records the as-built.

### Slice 2: a contract can be an FTP route, where an anonymous login fetches root's word

**As built (v0.443.0, PR #751, merged 2026-11-03).** The criteria below are met, with three limits on the evidence:
`get` at the real `ftp>` prompt waits for the close-out browser run, since the wire-check reads the tree and records the
transfer through the same endpoints. Criterion 11's 500 has unit tests only, as in slice 1. The `show` test was never seen
failing, because `show` needed no code. What a later slice should know:

- **Where a later route plugs in:** `ROUTES` and `LEAK_ROUTE_DOORS` in `missionShape.ts`, and `LEAK_HOMES` in
  `missionLeak.ts`, which holds the directory and permissions of a route's file. A `MissionFile` now carries its own
  permissions, and `withMissionFiles` uses them.
- **Changed from the plan:** the door's rule is `src/core/sessions/doorAdmission.ts`. `admitToDoor` returns a tier rather
  than an account, so no caller can pick up the hash. `ftpLanding` decides where a session starts.
- **A session row takes `anonymous`** with no `/etc/passwd` entry, proved live by `scripts/testMissionFtp.ts`.
- **Accepted, found while building:** an account a root creates and names `anonymous` also starts in `/srv/ftp`, because the
  client only knows the name.
- **Bundle:** 298,111 B gz, up 305 B, against the 298,175 B ceiling, so **64 B remain**. Slices 3 and 4 will need the raise
  decision 14 expects.
- **Open, not from this slice:** findit's generated web took 677–732 ms in `checkBudgets` this time, against about 1,100 ms
  during slice 1 and the 1,000 ms ceiling. Nothing here touches it, so it's most likely machine load, and the budget question
  stays with the owner.

**Value:** a contractor on an FTP-route job sees `21` and `2222` in a scan, logs in as `anonymous` with any password,
fetches a forgotten file from `pub/`, works out that the word inside is a login, and reads the key as root. They keep
the word.

**Path:** `missionShape` draws the route and two forwards → `routerFs` writes both into the gateway's `rules.v4` → the
key box builder runs `vsftpd` on a safe release, writes `/etc/vsftpd.conf` and makes `/srv/ftp/pub` → the server lays
the file into `pub/`, guest-readable → `ftp <address> anonymous` reaches the door through the forward → the door reads
the box's own config and opens a guest-tier session → `get` copies the file home → `ssh -p 2222` logs in against the
unchanged `/etc/passwd` → the existing key file and reply → the existing payout.

**Class:** behavior change. **Delivery:** independent PR against `main`, branch `feat/leak-ftp-route`.

**Required implementation skills:** `tdd`, `testing`, `functional`, `typescript-strict`, `refactoring` where it applies,
and `mutation-testing` at the PR gate.

**What the trace settled, against decision 10 and the note above:**

- **A session row takes a username no `/etc/passwd` holds.** `credentials` is plain JSONB, and a session's tier comes
  from the row. The wire-check proves it end to end.
- **"Same-LAN" means the own-LAN door.** `authCreateSession` is what reaches a key box from inside its network, for
  example a shell on the box running `ftp localhost anonymous`. `authCreateSessionSameLan` only reaches players' boxes,
  and contract networks have no occupants. `authCreateSessionInnerGateway` is never called by `ftp`.
- **The file's permissions now vary by route.** `withMissionFiles` hard-codes `ROOT_FILE`, so a `MissionFile` has to carry
  its own permissions: read for every tier and write for root only in `pub/`, root-only for the key and the web file. The
  write gate needs no change, since it only reads write permission, which is root's on all three.
- **`ftp` can log in as well as hand out the file.** `ftp <address> root` with the word opens a root session that can
  `get` the key, so `:2222` is one way to use the word rather than the only one. Decision 15 keeps `:2222` anyway, so a
  scan tells this route from an msfconsole route on `:21`.

**What it builds:**

- **The shape:** `ftp` joins `ROUTES`, still the third draw on the topology stream. `vsftpd` on a safe release, forwards
  `21` and `:2222`, and root from `LEAKABLE_HASHES`, as the web route does.
- **The key box:** on this route, `/etc/vsftpd.conf` with `anonymous_enable=YES` (world-readable, as every role config
  is) and an empty `/srv/ftp/pub`. `/var/log/vsftpd.log` is seeded on any key box running `vsftpd`. The config leaves out
  `anon_root`: the door doesn't read it, so stating it would break the promise that a setting says what the door does.
- **One rule at the door** (`src/core/services/anonymousFtp.ts`, name to be settled in the code): the box's config says
  whether `anonymous` is let in, for the `ftp` door only. It replaces the `accountIn` and `md5` pair in `authCreateSession`,
  `authCreateSessionPublic`, `authCreateSessionSameLan` and `admitOwnBoxLogin`, so a door can't exist at one address and
  not another. It admits at guest tier with any password. Everything else goes to `/etc/passwd` as today. A root who writes
  `anonymous_enable=YES` on any box opens that box, which is what the setting says. On a box with no `/srv/ftp`, the
  session lands in a directory that isn't there and `ls` says so.
- **The landing:** `enterFtpSession` starts `anonymous` in `/srv/ftp` rather than `/home/anonymous`.
- **The file, on the server only:** `missionLeakPath` gives `/srv/ftp/pub/<name>` on this route. Names and wording come
  from the same pool as the web route, minus `.env`, because a plain `ls` hides a dotfile and the directory would look empty.
- **Comments:** the pool's and `boxSurface.test.ts`'s "nobody logs in anonymously" become "no generated file server
  claims it". The test itself stays and still bans `anonymous_enable=YES` on every file server in the world.
- **The operator:** `show` needs no code, since it already prints whatever `missionLeakPath` and `forwards` hold.

**No in-game hint:** no `man ftp` example, Hackademy line or banner mentions `anonymous`. A player either knows to try it,
reads `anonymous_enable=YES` from a guest shell, or cracks `guest` with `hydra` and finds the file. The `/dev` story at
close-out tells it afterwards.

**Acceptance criteria (for the owner to confirm before any code):**

1. Across numbers, routes draw about a quarter each. A number's address, key and key path are the same whichever route
   it draws.
2. On an FTP route, `nmap <address>` shows `21` and `2222`, and the gateway's `rules.v4` holds both forwards.
3. `ftp <address> anonymous` with any password, an empty one included, answers `230` and lands in `/srv/ftp`. `pub/` lists
   the file, and `get` copies it to the player's box. Its text holds the word and never the word `root`.
4. `/var/log/vsftpd.log` on the key box records `[anonymous] OK LOGIN` and `OK DOWNLOAD`, each with the visitor's address.
5. `ssh root@<address> -p 2222` with that word opens a root shell that can read the key, and mailing the key to the client
   pays as on any route. `ftp <address> root` with the word also opens a root session.
6. Appending the word to `passwords.txt` makes `hydra` find root on `:2222`. Without it, `hydra` finds no root on `:21` or
   `:2222`. `msfconsole` finds no root through `:21` on this route.
7. An anonymous session cannot `get` the key and cannot `put` anything. `ssh anonymous@<address> -p 2222` and `scp` as
   `anonymous` are refused, and another unknown name at the `ftp` door gets `530`.
8. A guest shell on the key box can run `ftp localhost anonymous` and fetch the file, and can also `cat` it directly, as
   decision 10 accepted.
9. After a root sets `anonymous_enable=NO`, a later visitor gets `530` and a `FAIL LOGIN` line. Setting it back reopens the
   door. After a root's `rm` of the file, a later visitor no longer finds it and the key file is unaffected.
10. `ftp <address> anonymous` gets `530` on a hydra route, on an msfconsole route running `vsftpd`, and on a generated file
    server. A box whose root writes `anonymous_enable=YES` opens at the public, own-LAN, same-LAN and own-box doors alike.
11. With `JSHACK_SECRETS` unset, an FTP route's key box serves no file and its read answers 500. Hydra and msfconsole routes
    and boxes on other networks are unaffected.
12. Every existing guarantee in `missionShape.test.ts` holds across all four routes: nothing but the route climbs, and an
    FTP route's root is a slice word.
13. `show` prints the route, both forwards, the path and the word. `checkSecrets` passes on a built `dist/`, and the PR states
    its gzipped cost against the ceiling, with 369 B of room going in.

**RED:** start from `missionShape.test.ts` and `missionKeyBoxFs.test.ts` (the draw, the forwards, the config, `/srv/ftp/pub`),
then `missionLeak.test.ts` (the path, the permissions, no dotfile, fail-closed), then the door's own test, then
`authCreateSessionPublic.test.ts`, `authCreateSession.test.ts`, `authCreateSessionSameLan.test.ts` and `ftp.test.ts`, then
`state.test.ts` (the landing). `hiremeOrders.test.ts` gets one case for this route.

**GREEN:** the least that passes each, in that order. **REFACTOR:** assess after each green. Tests with a fixed contract
number may change route when `ROUTES` grows; those that need a route should search for one, as `webRouteContract.ts` does.

**Wire-check:** a new `scripts/testMissionFtp.ts` against `vercel dev` and local supabase, driving a real accept: the scan,
the anonymous login over the public door and over `localhost`, the listing, the fetch, both `vsftpd.log` lines, the word's
login, the key, the payout, the config set to `NO`, and the `rm` sticking. Run every `testMission*` script and the
`testFtp*` scripts, since the door's check changed and this slice re-rolls the contract fixtures.

**PRE-PR mutation:** scoped to the door's rule, `missionLeak.ts` and `missionShape.ts`, one file at a time.

**Deploy:** no migration, no new variable, and no production check: slice 1 already proved production reads `JSHACK_SECRETS`
at runtime, and this file reaches a door the same way.

**PR-ready when:** the criteria are met with their tests, `npm run typecheck`, `npm run lint` and the full test suite pass,
the wire-checks pass, and the mutation gate leaves only equivalents. The owner approves each commit.

**Slice complete when:** the PR merges and this plan records the as-built.
