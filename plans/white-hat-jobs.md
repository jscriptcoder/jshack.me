# Plan: White-hat jobs

**Status:** Grilled 2026-11-22 (the shared rules and cleanup). Cleanup slice planned and gap-checked; acceptance criteria to confirm before RED.

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

   **Where the words come from (confirmed in find-gaps, 2026-11-22): a white-hat slice of the
   uncrackable pool.** The leak routes' mechanism, on a slice of its own: root's hash is drawn in
   the bundle from a fixed white-hat slice of the uncrackable pool that no other door holds,
   beside `LEAKABLE_HASHES` (`core/missions/leakablePool.ts`), and the server turns it back into
   the word for the briefing from `JSHACK_SECRETS`, as `leakedWord` does
   (`core/missions/missionLeak.ts`). The bundle holds only hashes, so the address without the
   briefing gives no root, and `/etc/passwd` stays the bundle's. A handed-over word opens white-hat
   boxes only. Rejected: the leakable slice, which would let a player accept and drop cleanup jobs
   for free to collect words that open black-hat leak-route roots with no break-in; and an HMAC
   under `MISSION_KEY_SECRET` (the first draft), which needs the server to lay root's
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
  slice of the uncrackable pool (decision 7), the gateway forwarding `:2222` to the box's `:22`, decoys filling the
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
- [ ] No hash in the white-hat slice is held by any door outside white-hat boxes: no fixed site,
      world box, black-hat contract or leak route (a test over the pool, as the leakable slice
      has).
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

- [Blocker → decision 7, AC] The handed-over words come from a white-hat slice no other door holds.
- [Blocker → What it builds, AC] An implant's outside host is an in-game address no machine holds.
- [Blocker → What it builds] Implants sit in legacy's seven `/etc` locations only.
- [Should → reply table] "Gone" is the destroy job's path rule; a moved implant counts.
- [Should → reply table] Any listener on the briefed port is a miss.
- [Should → settled item 2] Cron directories always hold `.placeholder`; dot-names only there.
- [Should → AC] An inside `nmap` agrees with `ps` about the briefed port.
- [Should → AC] Accepting with a secret unset fails whole.
- [Nice → briefing draft] The two-hop inside address is on the contract's own `/24`.
- Checked clean: the hunt's tools are on every mission box.
