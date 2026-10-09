# v2 — deferred backlog & future content ideas

Forward-looking direction not yet built (preserved as pointers; design when actually built). Where
the project stands is in [`project-status.md`](./project-status.md); the working rules and
invariants are in [`conventions-and-gotchas.md`](./conventions-and-gotchas.md).

- **CLOSED (2026-10-07) — three wire-checks that failed for fixture reasons.**
  `testCrossPlayerConnectionTrace` already read the gateway's trace under `ap:<essid>` (fixed in
  #601; this entry outlived it). `testMysqlDeep` now cleans its gateway and deep box at teardown as
  well as setup, so `testExploitDeepChain` no longer meets the mysqld it left stopped (on day 78 both
  land on `android-164` behind INITECH-5G; 13/13 then 11/11 back to back, both orders).
  `testSharedApForwards` redraws B until the guest passwords differ (8/8, three runs).

- **Generated files too big to carry home.** Saving a file a player fetched (`ftp get`, `scp`,
  `cp` onto their own box) is one signed write whose payload `signedEnvelopeSchema` caps at 8192
  characters of JSON, so a larger file fails with `local: <path>: I/O error`. Measured across every
  NPC box at world-content slice 8b's close-out (v0.258.0), files over ~7.5K escaped: `auth.log.1`
  on **102 boxes (max 19,940), readable by every tier**; `syslog.1` on 4 (max 9,717), every tier;
  `mail.log.1` on 15 (max 19,214), root only; `/var/lib/mysql/*` on 46 (max 18,464) and
  `/var/lib/redis/*` on 19 (max 13,708), root only. The guest-readable logs are the ones a player
  meets first. Decide between shrinking what generation writes (as 8a did for documents and 8b for
  the transfer log) and letting the patch write carry larger payloads (an `api/` change with its
  own wire-check and a reason the guard can grow). `share.test.ts`'s transport tests are the
  pattern for holding any fix.

- **A script's `fs.appendFile` takes the file it adds to.** It composes on the machine and names
  `baseContent`, but passes neither `owner` nor `permissions`, so `patches.write` stamps the
  script's session and tier defaults over an existing node: a user-tier sweep appending to a
  root-owned file that grants user write walks away owning it (and can `chmod` it). The shell's `>>`
  keeps both (`conventions-and-gotchas.md` §6). Found building `>>` (v0.277.0); one `stat` and two
  fields, with a test beside the existing appendFile ones in `node.test.ts`.

- **`grep` takes no stacked flags and no `-n`.** Since v0.329.0 (#622) it accepts `-l`, `-c`, `-i`
  and `-r` one at a time, but it does not opt into `stacking`, so `grep -ri x .` and `grep -rl x .`
  answer `unrecognized option: -ri`, and `-n` (line numbers, the other flag every admin types:
  `grep -rn`) does not exist at all. A playtester will type both. The fix is `stacking: true` on
  `grep` (every flag it has is boolean) plus a real `-n` that prefixes `<line>:` — and
  `<file>:<line>:` under a directory, as GNU does. No planted history line uses either today, so
  `plantedHistory.test.ts` would not catch a regression here; the test belongs in `grep.test.ts`
  through `runCommandLine`. Found while closing the planted-history item (2026-10-07).

- **`ssh`, `scp` and `ftp` could not reach your own box — RESOLVED 2026-10-09 (v0.341.0–v0.344.0,
  #637–#640).** `ssh root@localhost` answered `No route to host` with sshd running. At home the
  three doors now log into the own box client-side (`commands/ownBoxLogin.ts`): the daemon must hold
  the port, the password is checked against the box's own `/etc/passwd`, and the login lands in
  the door's own log as `127.0.0.1`. From a hop, `localhost` is sent on as `127.0.0.1` and lands on
  the hop. Chapter 5 shows the `localhost` examples again. Still open: ftp transfers at home are not
  itemised in `vsftpd.log` (`recordFtpTransfer` refuses the own box), and the data doors
  (`serviceHost.ts`) still map loopback through `ownLanSourceIp`, so on a deep hop they may land
  on the gateway. Unverified. And a file `scp` carries lands `rwx------`, owned by the login's
  account, so `scp notes.txt root@localhost:/tmp/` leaves a file the player's own account cannot
  read (real scp keeps the source's mode). Found by the close-out browser run.

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

- **`ps` runs a 12-character command into the PORT column.** `COMMAND_COL` in
  `commands/ps.ts` is 12, and `redis-server` is exactly 12, so the row reads
  `redis-server6379` with no gap. The same class as `nmap`'s 5-digit port column (#620): pad to
  the widest command plus one, with a test that asserts the gap. Seen in the workstation-birth
  browser runs (2026-10-08).

- **`relations.test.ts` times out under the full suite.** "an IT contractor's shortcuts > keeps no
  shortcut to a client on any other box of the office" takes ~20s alone against the 30s
  `testTimeout` and exceeds it when the whole suite runs, on `main` as of 2026-10-08 (seen twice
  in a row, unrelated to the change at hand). Either make the test cheaper (it walks the world)
  or give it its own timeout with the reason beside it; do not raise the global one.

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
  - **The map**, with fog of war: Ridgemont lit, a town appearing once one of its networks is
    touched. Needs the first per-player exploration record (where it is stored, what counts as
    "found"). Brings the town rows' map coordinates and `ping` across networks, latency growing
    with distance. The world map of regions waits for a second region.
    Why it matters: 612 networks are invisible today. Nothing shows a player how much world
    there is or how much of it they have seen, so the scale reads as sameness rather than as an
    open world; a found count per town ("41/178") is what makes it something to complete.
    Shape proposed 2026-10-09, not yet grilled:
    - **A `map` command opens a full-screen overlay**, the Lynx/Nano pattern: box-drawing
      characters in the active theme's colours, arrows to move, Enter to zoom in, Esc to zoom
      out. It reads as the player's own tool, not a game menu. Precedents: Uplink's world map
      and Hacknet's netmap, which grows a node each time something is found.
    - **Three zoom levels.** The *region*: the towns at their authored coordinates, an
      untouched town fogged or absent, each lit town with its found count. A *town*: a graph of
      the networks the player knows, each edge the route that led there (findit, the council
      directory, a lead's kind, `whois`), so it reads as the player's own investigation board
      rather than a street plan; that is the shape the discovery design already has. A
      *network*: its topology as the player has scanned it (gateway, machines, inner router),
      deep layers `???` until pivoted into.
    - **Five states a network can be in**, each a glyph, each something the player did: heard
      of (a file or trace named it), reached (scanned or its site fetched), got in (a session),
      root, bricked.
    - **The exploration record is the root decision**: server-side, keyed by the player's
      identity, written as a side effect of actions the server already sees (scans, `whois`,
      sessions, patches). The rest of the map follows from what it records.
    - **Town coordinates are authored data on the rows**, append-only like the rows
      themselves; a town's internal layout is computed from its graph each render, never stored.
    - **Later, a multiplayer layer**: addresses from the player's own traces shown as "someone
      came from here", which is the missing route to deliberate rendezvous (below).
    - Plain DOM like the other overlays, so the jsdom + `@solidjs/testing-library` harness
      tests it; no canvas.
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
- **The patch-error map is written seven times.** `{ no_session: 'Permission denied',
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
- **`snmpwalk` of your OWN address has no client-side own-box path.** `snmpwalk.ts` calls the server
  unconditionally, and the server answers a walk for the box a player is NOT standing on — so
  walking your own agent times out (`No Response`) even while it runs and a STRANGER's walk of the
  same box answers. Every other own-box door (`ps`, `cat`, `rediscli 127.0.0.1`) reads locally; the
  walk is the one that does not, so a player cannot read their own device over SNMP. Surfaced at D8
  boundary 1, re-confirmed live 2026-08-31; a fix is an own-box branch in `snmpwalk`, deferred.
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
- **An `http` sweep is written up as `sshd`.** `hydra <host> http` is a supported attack —
  `hydraCrackPublic.test.ts` deliberately covers reaching the web service through a forward — but
  the web door has no login, so the trace it leaves is `Failed password for <user> from <ip>` in
  the target's `auth.log`, tagged `sshd`, for a daemon nobody knocked on. D3.1 routed the sweep
  trace **by service** (`SERVICE_CATALOG.<svc>.sweepLog`) and gave `ftp` its own file, but left
  `http` pointing at `auth.log` **byte-for-byte as it was** — the row says so in a comment. It is
  recorded here rather than fixed there because the right destination is `access.log` as a run of
  401s, and that is the web door's decision, not the ftp door's. Fixing it is now one row.

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
- **Player-driven service patching (defender role)** — root-tier `apt upgrade` mutates
  `Port.serviceVersion` → a CVE goes inert game-wide; a blue-team mechanic.
- **Wordlist progression** — hydra as progression: a weak default wordlist, harvest
  passwords to expand coverage.
- **Themed persistent networks** — `world_networks` infra + a findit.io directory;
  office/police/university/café as drop-in additions; handler+generator registries dispatch
  on `theme`. CVE-eligible themed ports need `Port.owner` stamped; pages must be well-formed
  HTML; CVE pickers constrain INITIAL state only (not post-`apt upgrade`).
- **Player-hosted websites** — apache2/nginx daemons shipped (legacy); remaining: mutable
  router NAT, findit.io registration/crawl.
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
