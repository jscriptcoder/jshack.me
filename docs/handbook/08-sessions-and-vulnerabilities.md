# 8. Sessions, service protocols, vulnerabilities and traces

This chapter explains how a player gets onto another machine in the game and what happens while
they are there: the session model behind `ssh`, `su`, `ftp` and the rest, how logins are checked,
how the simulated database and key-value services answer, how the vulnerability system decides
what an in-game exploit does, and how every one of those actions leaves a log line that a defender
can read. Read it before touching `src/core/sessions/`, `src/core/cve/`, `src/core/mysql/`,
`src/core/redis/`, `src/core/findit/` or `src/core/logging/`.

All of this is game mechanics over simulated machines. "Exploit", "backdoor" and "crack" are names
of in-game actions on generated data.

## The shape in one paragraph

A **session** is "player P is logged in as user U, at tier T, on machine M". The client keeps a
stack of them (the hop chain); the server keeps one row per session in the `sessions` table.
**Every door that creates a session on someone else's machine is decided on the server:** the
server rebuilds the target machine from its seed and journal, checks the credential against that
machine's own `/etc/passwd` (or database, or recomputes the vulnerability), and only then inserts
the row. That row is what later authorizes reads and writes on the machine (the L1 gate, chapter
10). Almost every door also appends a line to the right log file on the target, written by the
server with the server's clock. (The one deliberate exception is a planted `nc` listener, which
leaves no log line at all.)

## Key files

| Path                                                            | What it does                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `core/commands/types.ts`                                        | `Session`, `SessionKind`, `HopChain`.                                                                                             |
| `sessions/authCreateSession.ts`                                 | Login to a generated machine on your own LAN (`ssh`, `ftp`, `scp`, `nc` to a listener).                                           |
| `sessions/authCreateSessionSameLan.ts`                          | Login to a fellow player's workstation on the same WiFi.                                                                          |
| `sessions/authCreateSessionPublic.ts`                           | Login through a public IP: the access-point gateway, or a player's box behind a forward.                                          |
| `sessions/authCreateSessionInnerGateway.ts`                     | Login to a hidden deep-layer machine through an inner gateway's forward.                                                          |
| `sessions/authElevateSession.ts`                                | Cross-player `su` to root on another player's box.                                                                                |
| `sessions/createSession.ts`, `endSession.ts`, `listSessions.ts` | Persist, end and list the caller's own session rows.                                                                              |
| `sessions/rebootMachine.ts`                                     | `reboot`: ends **every** session on a machine and writes a new boot id.                                                           |
| `sessions/passwdAccount.ts`                                     | `accountIn`: read one account's hash and tier from a rebuilt `/etc/passwd`. The one credential reader.                            |
| `sessions/homeDirectory.ts`                                     | Where an account lands: `/root` for root, `/home/<user>` otherwise.                                                               |
| `sessions/launchVantage.ts`                                     | Which box an action was launched from (the hop below the active one).                                                             |
| `sessions/serviceHost.ts`                                       | `reachBox` / `reachServiceHost`: the shared reachability walk (chapter 7).                                                        |
| `sessions/hydraCrack*.ts`                                       | The server-side password sweep behind `hydra`: `hydraCrack.ts` (own LAN and same-WiFi players), `…Public.ts`, `…InnerGateway.ts`. |
| `sessions/mysqlConnect.ts`, `mysqlStatement.ts`                 | The database door and its per-statement handler.                                                                                  |
| `sessions/redisConnect.ts`, `redisStatement.ts`                 | The key-value store door.                                                                                                         |
| `sessions/snmpAgent.ts`, `snmpWalk.ts`, `snmpSet.ts`            | The SNMP door (chapter 7).                                                                                                        |
| `sessions/exploitCreateSession.ts`                              | Remote exploit (`msfconsole <host> <port>`): the server decides what, if anything, opens.                                         |
| `sessions/exploitLocalElevate.ts`                               | Local exploit (`msfconsole --local <command>`) on a box you already stand on.                                                     |
| `mysql/`, `redis/`                                              | Datadir schemas (zod), statement parsers and executors, and a player's own freshly installed instance.                            |
| `cve/worldClock.ts`                                             | `WORLD_EPOCH` and `gameDayAt(now)`: the one clock every vulnerability derives from.                                               |
| `cve/packageTimeline.ts`, `liveCve.ts`                          | Package release timelines and "which vulnerability is live for this version on this day".                                         |
| `cve/exploitEffect.ts`, `localExploit.ts`, `firmwareExploit.ts` | What firing a vulnerability grants, per axis (service, library, firmware).                                                        |
| `findit/`                                                       | The in-game search engine `findit.io`: crawl view, robots rules, ranking, pages.                                                  |
| `logging/`                                                      | One formatter per log file (`auth.log`, `kern.log`, `access.log`, `vsftpd.log`, `mysql.log`, …), source-IP rules, writer keys.    |

## Sessions

```ts
type Session = {
  id; // client-minted, e.g. "ssh-<user>-<ms>"; also the sessions table primary key
  playerKey; // who holds it (server stamps this from the signature)
  machineId; // the machine it stands on
  username;
  userType; // 'guest' | 'user' | 'root'
  kind; // 'ssh' | 'su' | 'exploit' | 'exploit_limited' | 'nc' | 'ftp' | 'scp' | 'mysql' | …
  createdAt;
  port?; // only for a backdoor listener, which must keep checking it is still there
  bootId?; // the boot id last read on the box (undefined / null / string are all meaningful)
};
```

The client's `sessionStack` (chapter 4) has the base login at index 0 (never stored on the server)
and pushes one session per hop. The prompt, the working directory, the filesystem tree and the
patch client all follow the **top** session.

| Kind              | Created by                                                                          | Is it a hop on the stack?                        | Survives a reload?         |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| `su`              | `su` on your own box (`createSession`), or cross-player `su` (`authElevateSession`) | Yes                                              | Yes                        |
| `ssh`             | `ssh` through any of the four login handlers                                        | Yes                                              | Yes                        |
| `exploit`         | A remote or local exploit that granted a full shell                                 | Yes                                              | Yes                        |
| `exploit_limited` | An exploit that granted a shell without a terminal                                  | Yes                                              | No (closed as `abandoned`) |
| `nc`              | Connecting to a listener planted on a box                                           | Yes                                              | No (closed as `abandoned`) |
| `ftp`, `scp`      | File-transfer logins                                                                | No (a parallel sub-shell or a one-shot transfer) | No                         |
| `mysql`, redis    | Database and store connections                                                      | No, and **no server row**                        | No                         |

### Why some doors create no session row

A session row is an authorization: it lets its holder list and write the machine's journal. The
database, key-value store, SNMP and `hydra` doors deliberately create **no** row. Instead, every
statement re-establishes reachability and re-checks the credential. This means a daemon stopped
mid-session drops the player on their next statement, and reaching a database port never grants
filesystem access.

### Reboots and boot ids

`reboot` ends every open session row on the machine (for all players, reason `rebooted`) and writes
a fresh random boot id to `/var/run/boot-id`. Each client session records the boot id it first saw
(`observeBootId` in `ui/state.ts`); when the next command on that session sees a different id, the
session has been evicted. `null` ("read, no marker yet") is distinct from `undefined` ("not read
yet"), which is what lets the very first reboot of a box evict anyone.

A reboot (or a box going dark) also ends every session **stacked above** that box through the hop
chain, server-side, with reason `upstream_lost` (`sessions/upstreamLost.ts`, `endChainsAbove`); the
terminal drops to the deepest surviving hop, printing `Connection to <host> closed by remote host.`
per closed leg, and rehydration ends any orphaned child the same way. Nothing else re-validates an
open session: a changed password, a closed forward or a new ACL rule affects only new logins, as a
real `sshd` does — so a defender evicts an intruder by rebooting.

## Logging in: the credential check

The password login handlers follow the same steps:

1. Verify the signed request (chapter 9).
2. Resolve the target **from the address**, with the resolver for that vantage (own LAN, same-WiFi
   player, public IP, inner-gateway chain). See chapter 7.
3. Rebuild the target's filesystem: generated base + replayed journal. If it cannot boot, it is
   unreachable.
4. Check the right daemon is listening on the reached port (`sshd` for `ssh`, `vsftpd` for `ftp`).
   Nothing is logged if there is no box or no daemon.
5. Read the account with `accountIn` from the rebuilt `/etc/passwd` and compare the MD5 of the typed
   password with the stored hash.
6. **Log the attempt, success or failure**, in the target's log (`auth.log` for `ssh`, `vsftpd.log`
   for `ftp`, …) through the service catalog's `sweepLog` column.
7. On failure, answer `401 invalid_credentials` (the same for an unknown user and a wrong password).
   On success, derive the tier **from the passwd row** (uid 0 → root, `guest` → guest, otherwise
   user; the client never states its own tier) and insert the session row.

A planted `nc` listener is different: the door checks that the listener's pidfile is still there,
admits whoever the pidfile names, inserts the row, and writes **no** log line, on purpose (a real
netcat listener leaves the defender nothing to read).

Some consequences are deliberate game design:

- Passwords live inline in `/etc/passwd`. There is **no `/etc/shadow`** in this game.
- MD5 is deliberately weak so hashes can be cracked. Do not "fix" it.
- Because the check reads the **replayed** passwd, a player who edits another box's `/etc/passwd`
  (with root) changes who can log in. This is intended.
- `hydra` answers "which of this host's accounts have a password in your wordlist?" on the server,
  from the same passwd `ssh` checks. A credential `hydra` reports is therefore one `ssh` accepts.

## The database and key-value store doors

Both services keep their data as a **file** on the box that serves them:
`/var/lib/mysql/data.json` and `/var/lib/redis/data.json`. Because a player can become root and
edit that file, every read goes through a zod schema (`mysql/types.ts`, `redis/types.ts`); a file
that fails to parse means "this box has no database", the same answer as no file at all.

- **`mysql`**: the account list comes from the datadir, not `/etc/passwd`. On a generated box the two
  are drawn separately, so the box's root password opens nothing here. `mysql/statements.ts` is the whole statement path (parse, execute, render) in
  one module, run on the server. Only rendered text leaves the server, never rows, so a client never
  receives data its account was not allowed to select. Changes are written back to the datadir as a
  patch.
- **`redis`**: a handful of verbs. A store has at most one password (stored as a hash in the
  root-only datadir, not in the guest-readable config). Parsing happens on the server too, so a dead
  box cannot keep politely correcting the player's spelling.
- A player who installs one of these on their own box gets a fresh instance (`ownDatabase.ts`,
  `ownStore.ts`). The database has a small `app` database and accounts drawn from the player's key
  (so no two players share them), except that its `root` account mirrors the box's own root
  password from `/etc/passwd`. The store holds no keys, and its lock is also the box's root
  password (a key-seeded lock is used only if the box has no root account).

## The vulnerability system

The full as-built design is in [`vulnerability-architecture.md`](../vulnerability-architecture.md).
The essentials for a maintainer:

**There is no vulnerability database. Every vulnerability is recomputed, never stored.** A package
name, a version and a game day are enough to derive, identically on client and server, which
vulnerability is live, its severity, and what firing it grants.

- **The world clock.** `WORLD_EPOCH` in `cve/worldClock.ts` is a hardcoded date.
  `gameDayAt(now) = max(0, floor((now − WORLD_EPOCH) / 1 day))`. The client uses its clock only to
  **render** (`nmap -sV`, `apt list -u`); the server uses its own clock to **authorize**. A forged
  client clock changes what a player sees, never what they get.
- **Timelines.** Each package has a version template in `packages/packageVersions.ts`.
  `packageTimeline(key, throughDay)` walks releases forward on separate seeded streams (release gaps,
  serial numbers, patch delays), so adding a package never shifts another's numbers.
- **One derivation, three readers.** `liveCve(key, version, gameDay)` answers
  `{cve, severity, publishedAt}` or nothing, for any package. Three readers interpret it: the
  **service** axis (what a remote exploit on a port grants), the **library** axis (what a local
  exploit through a command's linked libraries grants), and the **firmware** axis (a router's image,
  contested against the service on the port; a tie goes to the service).
- **The manifest is the version authority.** Every generated box carries `/var/lib/dpkg/status`.
  `apt upgrade` edits it (as a patch), so every reader sees the upgraded version.
- **Severity sets a tier floor**, and the grant goes to the lowest account at or above it.
- **Eight effect kinds**, from a full shell down to reading one file. Each effect pool's **order and
  repetition are load-bearing**: the roll is one draw against the pool as written, seeded on the
  package and release, never the machine.
- **The request carries only an address and a port.** There is no field in which a client could
  claim a version, a vulnerability, an effect or a tier. The server rebuilds the target, reads its
  manifest, and recomputes everything.
- **An in-game script run by an exploit executes on the client**, against the target's tree; the
  server re-checks each resulting write at the granted tier. Server-side evaluation of player
  JavaScript was rejected and must stay rejected.

The defender's tools are `nmap -sV` (see the vulnerability and severity, never the effect),
`apt list -u` (triage), `apt upgrade` (stops new exploits, does not evict), and `reboot` (evicts
everyone).

> **Time-sensitive: `WORLD_EPOCH` is a development anchor** (currently 2026-07-12). A tripwire test,
> `src/core/cve/worldClock.test.ts`, fails once the anchor is `RUNWAY_DAYS` (180) days old, which
> is **2027-01-08 UTC**. When it fails, decide: re-stamp the epoch for launch, or postpone again.
> To postpone, raise `RUNWAY_DAYS` in the test (it was raised from 90 on 2026-09-27); that leaves
> the world untouched. Moving the epoch instead re-dates all generated history and restarts every
> vulnerability timeline at day 0; it is free before launch and irreversible after.

## findit.io, the in-game search engine

`findit.io` is a generated one-box network with a public address, reachable by name through the
world's DNS (chapter 7). Its search is computed at request time on the server:

- **The index is a view, not a copy.** `findit/webIndex.ts` reads it at the moment of the search
  from every homepage on a public port 80, replaying the same journals a fetch would. A page edited a
  moment ago is found as edited; a bricked or stopped web server is simply absent. Only what
  generation built is kept, from a server's first search: a site nobody touched is listed from it.
- `findit/search.ts` ignores case and accents on both sides, so "cafe" finds a café.
- `findit/robots.ts` honours `robots.txt` the way a real crawler does (user-agent groups, the `/`
  rule), so opting out uses the web's own words.
- `findit/readPage.ts` extracts text from markup without a DOM (the server has none), forgivingly.
- `findit/search.ts` ranks by where a word appears (title over description over body).
- `findit/page.ts` renders the results page; everything interpolated is escaped.

Rooting findit and restoring it are covered in [`discovery-architecture.md`](../discovery-architecture.md).
`scripts/restoreFindit.ts` is the operator tool that resets its journal and sessions.

## Traces: actions leave log lines

Nearly every in-game action against a box appends a line to a real-looking log on that box, so a
defender can `cat /var/log/...` and see what happened. (`john`, which cracks hashes offline, and a
planted `nc` listener leave nothing, on purpose.)

| Log                                                                     | Written for                                                        | Formatter              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------- |
| `/var/log/auth.log`                                                     | `su`, `ssh` logins (success and failure), sweeps                   | `logging/authLog.ts`   |
| `/var/log/kern.log`                                                     | Port scans (one aggregate line per sweep), local exploits, reboots | `logging/kernLog.ts`   |
| `/var/log/access.log`                                                   | Web fetches and path sweeps                                        | `logging/accessLog.ts` |
| `/var/log/vsftpd.log`                                                   | FTP logins and transfers                                           | `logging/vsftpdLog.ts` |
| `/var/log/mysql.log`, `redis.log`, `snmpd.log`, `named.log`, `dpkg.log` | Their service's connections, refusals, zone transfers, downgrades  | one module each        |

Rules the trace system follows:

1. **The server writes traces, with the server's clock.** The client sends the event; each handler
   formats the line with a `core/logging/` formatter, and `appendMachineLog` (in `core/patches/`)
   appends it to the file. A client never supplies a timestamp or the line itself.
2. **The source IP is derived server-side wherever the server can know it.** A fellow player on the
   same WiFi is recorded at their server-issued lease. A visitor from another network is recorded at
   the public IP of the network they are acting from (their home network, or the network of the box
   they are standing on), looked up from their verified key (`logging/crossPlayerSourceIp.ts`). On the
   caller's **own** LAN, against a generated box, the address is the one the client states
   (`source_ip`), because only the caller can know it; the server does not invent one.
   An act on a box the caller is already inside — `reboot` — names the address their **login**
   came from: every cross-player door stores the address it derived on the session row
   (`source_ip`), `su` and a local exploit carry the address of the shell they were typed into, and
   `rebootMachine` reads it back, so the `kern.log` line and the login's `auth.log` line name one
   visitor. The line names the box by its hostname (`hostnameForMachineId` in
   `generation/lanTopology.ts` for gateways, whose ids carry no name).
3. **One log per box, under a stable writer key.** Because the journal is last-write-wins per
   `(machine, path, writer)`, writers must agree on the key or they erase each other's lines. A
   player's box logs under the owner's key (`resolveTraceProvenance` in
   `core/patches/traceProvenance.ts`). Generated boxes reached through the shared reach, `hydra` and
   `reboot` log under the access point's key (`logging/apGatewayLogWriter.ts`). **Not every path
   follows this yet**: an own-LAN `ssh`/`ftp` login (`authCreateSession.ts`) and
   `resolveTraceProvenance` for unowned boxes write under the caller's own key (see
   [known issues](./13-known-issues.md)). See chapter 7.
4. **A break-in writes to the same file its credential sweeps already use**, through the
   `formatExploit` column required on every service catalog row. A service cannot be added without
   deciding where its exploits show up.
5. **Traces are best-effort.** A failed read skips the append; a failed append never fails the
   action.
6. **The owner sees a trace only after their next refetch.** Nothing is pushed (chapter 9). An empty
   log in the browser is usually a stale view, not a missing write; check the `patches` row first.

## Rules you must not break

1. **The server decides every login, elevation and exploit.** The client may pre-check to render a
   nicer message, but never to authorize.
2. **Tiers come from the target's own files**, never from the request.
3. **One reader per fact:** `accountIn` for passwd accounts, `reachBox` for reachability,
   `liveCve` for vulnerabilities, the pidfile reader for running services.
4. **Dark states read alike.** A refused community, an absent host and a bricked box answer the same.
5. **Rows are authorizations.** Do not create a session row for a door that should not grant
   filesystem access.
6. **Never store a vulnerability.** Recompute it.
7. **Effect pool order is part of the world.** Reordering it changes what every box hands over.

## How to…

### Add a new login door (a new session kind)

1. Add the kind to `SessionKind` and decide whether it is a hop (add it to `SHELL_KINDS` in
   `ui/activeRoot.ts` and, if it should survive reloads, to `HOP_KINDS` in `ui/sessionRehydrate.ts`).
2. Write the server handler in `core/sessions/`: resolve the target with the existing vantage
   resolver, rebuild and boot-gate it, check the daemon, check the credential with `accountIn`, log
   the attempt, then insert the row on success. Copy `authCreateSessionPublic.ts`.
3. Route it in `api/sessions.ts` (chapter 10), add the adapter method in `src/adapters/sessionsApi.ts`
   and the `CommandEnv` seam (chapter 4), then the command (chapter 5).
4. Test the handler with injected fakes and add a wire-check under `scripts/` (chapter 11).

### Add a vulnerable package or a new effect

Follow [`vulnerability-architecture.md`](../vulnerability-architecture.md). In short: a new package
needs a version template with a **new, never-reused** hand-assigned number in
`packages/packageVersions.ts`; append effects to the end of a pool, never reorder; and remember that
changing timing constants in `CVE_TIMING` must keep `assertCveTimingInvariants` passing.

### Add a new trace

Write a formatter in `core/logging/<log>.ts` (pure, the timestamp passed in). Append it on the server
with `appendMachineLog`, using the owner's key on a player's box (`resolveTraceProvenance`) and the
access point's key (`apGatewayLogWriterKey(essid)`) on a generated box, never the visitor's. On the
client, call it as a fire-and-forget `record*` adapter method.

## Pitfalls

- **An `nc` backdoor shell does not survive a reload**, although it is a hop on the stack. Whether
  that is intended is an open question (see the [known issues](./13-known-issues.md)).
- **Client clock skew above two minutes breaks every request**, including logins (chapter 9).
- **`effect_one_shot`, `effect_password_reset` and `mission` exist in `SessionKind`** but are not
  written as rows today; `mission` is reserved for the future missions work.
- **A deep terminal machine cannot be written to**, even as root (chapter 7).

## Where it is tested

Each handler has a colocated test with injected lookups (for example
`sessions/authCreateSessionPublic.test.ts`, `sessions/exploitCreateSession.test.ts`,
`cve/exploitEffect.test.ts`, `cve/packageTimeline.test.ts`, `mysql/statements.test.ts`,
`logging/authLog.test.ts`). Wire-checks prove the real endpoints: `testSameLanConnect.ts`,
`testCrossPlayerSuElevate.ts`, `testExploitCrossPlayer.ts`, `testHydraCrossPlayer.ts`,
`testMysqlQuery.ts`, `testRedisConnect.ts`, `testRebootEvicts.ts`, `testSharedBoxLogTruth.ts` and
others (chapter 11).

## Deeper reading

- [`vulnerability-architecture.md`](../vulnerability-architecture.md): the full vulnerability design
  and its accepted costs.
- [`cross-player-architecture.md`](../cross-player-architecture.md) §3, §7, §8: cross-player login,
  root escalation, bricking, and traces.
- [`discovery-architecture.md`](../discovery-architecture.md): DNS and findit.io.
