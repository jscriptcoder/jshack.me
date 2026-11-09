# Plan: decoy services on a contract's network

**Status:** Grilled 2026-11-09. One slice planned 2026-11-09. Nothing is built.

Today a public scan of a contract's address tells the route. Past the gateway's own `22`, `2222`
alone is hydra, `80` alone is msfconsole, and `80`, `21`, `3306` or `161` beside `2222` is a leak
route. Decoys are the backlog's first deferred missions item ("missions — deferred" in
`docs/backlog.md`): more doors on the gateway, so the port list stops answering the question the
player is meant to work out. As-built context: [`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

1. **A decoy is a forwarded door that blurs the scan (2026-11-09).** An extra forward on the
   gateway onto a real service on the key box. Its only job is to make the public port list stop
   telling the route; it opens no way in. Rejected: unforwarded daemons visible only from a shell on
   the key box, which blur nothing, since whoever has that shell already found the route.

2. **Five kinds, every one of them a real route somewhere (2026-11-09):** `:2222` (ssh), `:80`
   (web), `:21` (ftp), `:3306` (mysql), `:161` (snmp). A port that is never a route (`:25`, `:8080`)
   is dismissed at a glance, so it blurs nothing and costs a daemon, its logs and its door. Given,
   not chosen:
   - A decoy is never a kind the key box already runs: a web route's `:80` is not also a decoy, nor
     is a database-storage contract's `:3306`.
   - A `:2222` decoy is the forward alone, onto the key box's own sshd, which always runs. Its `root`
     stays shut, as on the msfconsole route today.

3. **The count is drawn, so it says nothing (2026-11-09).** A contract draws how many forwards its
   gateway has, **3 or 4**, and decoys fill the gap above its real forwards (the route's, plus
   `:3306` on database storage when the route's door is not already that). Real forwards run 1–3,
   so every route reaches every count: hydra or msfconsole takes 2–3 decoys, a leak route 1–2, a leak
   route on database storage 0–1. With the gateway's `22` a scan shows 4–5 ports. Rejected: a flat
   0–2 decoys (two ports would still mostly mean hydra or msfconsole); every contract forwarding all
   five kinds (one rule, but every scan identical, so players learn to skip it and no network reads
   like a small business's).

4. **A decoy lets you in as far as a real door of its kind would, and holds nothing (2026-11-09).**
   Working it costs what working the real door costs; only then does the player find it empty.
   Rejected: decoys whose doors stay shut, each ruled out by one failed `hydra` or login, which
   saves the player barely anything over today's scan.

5. **An snmp decoy's read-write community is shut (2026-11-09).** Its read-only community is a
   guessable one (`monitor` or `netops`, as on the snmp route) and a walk shows an ordinary contact
   line. Its read-write community is drawn from `SHUT_HASHES`, so `hydra <address> snmp` finds
   nothing. On the real snmp route the word comes through the read-only walk, so the decoy matches
   the real door along the path that wins it. Rejected: a crackable read-write community, which
   would hand anyone on about half of all contracts a root-free `snmpset inputPort.22=deny` that
   shuts `:2222` for good, killing a hydra or leak route before the contractor gets there.

6. **A decoy is the real door's generated build minus what the server lays in (2026-11-09).** The
   word always comes from the server's lay-in, never from the generated box, so the two cannot
   differ on the surface:

   | Kind | The real door's generated box | The decoy |
   | --- | --- | --- |
   | web | nginx, the stock `It works!` page; the server lays the forgotten file | the same, nothing laid |
   | ftp | `anonymous_enable=YES`, an empty `/srv/ftp/pub`; the server lays the file | the same, nothing laid |
   | mysql | the generated application, a crackable application account, a shut root; the server adds `settings` | the same, no `settings` |
   | snmp | a hashed read-write community; the server lays `snmpd.conf` with the word | a read-write hash from the shut pool, and an `snmpd.conf` with a guessable read-only community and an ordinary contact, generated with the box since it holds no secret |
   | `:2222` | the key box's sshd | the forward only |

   Rejected for now: believable filler behind both real doors and decoys (a company homepage,
   mundane files in `pub`, a business contact). Filler on decoys alone would be a tell, so it is a
   backlog item for both together.

7. **The owner took the remaining recommendations (2026-11-09):**
   - **Safe releases.** Every decoy daemon sits on a release whose hole is `low` or `medium`, a
     guest shell at most; the shape test that walks 2,000 numbers keeps proving nothing but the
     route climbs.
   - **A stream of its own**, `mission-decoys-<n>`, for the count, the kinds and their versions and
     hashes, so no contract's topology, route, hashes, key, key path, storage or pay moves.
   - **No migration.** Decoys reach every contract the moment they ship, accepted ones included.
     Only test accounts and bots play on prod, and the pre-launch rule carries no backward-compat
     burden. A key box a root already rewrote keeps its journal over the new base; that corner is
     left as it falls.
   - **The forwards' order is not shuffled.** It lives only in the gateway's `rules.v4`, whose admin
     is shut, and the gateway runs no snmp agent, so nobody can read it.
   - **Pay is unchanged.** Decoys land on every contract alike, so no job gets harder than another;
     a higher pay range belongs to the harder templates the backlog lists.
   - **Accepted:** a `:2222` or `:21` decoy lets `hydra` win a guest or user shell on a route that
     offered none before. That shell cannot read the root-only key, as on the hydra and leak routes
     today.

## Where a door is made today (found 2026-11-09)

- `src/core/missions/missionShape.ts`: `missionShape(n)` builds `keyBoxServices`, `keyBoxVersions`,
  `forwards`, `keyBoxDatabase` and `keyBoxCommunityHash` from the route (on `mission-versions-<n>`)
  and then the storage (`mission-storage-<n>` picks it; a database storage's mysqld and `:3306`
  draw last on the versions stream). `safeVersionOf`, `databaseAccounts` and `SHUT_HASHES` are
  already there for a decoy to reuse.
- `src/core/generation/missionKeyBoxFs.ts`: the key box's base reads its daemons, pidfiles, logs
  and `/var/www` off `shape.keyBoxServices`, and its datadir off `shape.keyBoxDatabase`, so a web or
  mysql decoy needs nothing new there. Two things key off something else: the ftp config and
  `/srv/ftp/pub` off `shape.route === 'ftp'`, and the snmp state file off `keyBoxCommunityHash`. An
  snmp decoy also needs an `/etc/snmp/snmpd.conf` in the base, which no key box has today (the snmp
  route's is laid by the server).
- `src/core/missions/missionLeak.ts`: the server lays the datadir only on the mysql route or a
  database storage (`laysDatadir`), and `snmpd.conf` only on the snmp route (`leakPlaceOf`). So a
  mysql or snmp decoy's door reads the generated base untouched, with nothing laid over it.
  `GUESSABLE_COMMUNITIES` (`monitor`, `netops`) is private to this server-only module.
- `src/core/snmp/conf.ts`: `SNMPD_CONF_SEED` is the ordinary device's config (`rocommunity public`,
  `syscontact netops@corp.local`); `SNMPD_CONF_PATH` and `SNMPD_CONF_PERMISSIONS` are what the
  decoy's file uses.
- `src/core/generation/routerFs.ts`: `missionGatewayFs` writes every `shape.forwards` entry into
  `rules.v4`, so the gateway needs no change.
- `src/core/missions/hiremeOrders.ts`: `showReport` prints every forward and service from the shape.
- Tests that pin today's exact forwards: `missionShape.test.ts` (`toEqual` per route) and
  `missionKeyBoxFs.test.ts` (each route "runs X and sshd"). The wire-checks assert forwards with
  `includes`, so a decoy does not break them.

---

## Slice 1 — decoys (v0.449.0)

One PR, branch `feat/mission-decoys`. Every contract's gateway gains forwards and its key box gains
daemons, so the `api/` doors serve new boxes and the wire-check runs before merge.

**Acceptance criteria**

- Every contract's gateway forwards **3 or 4** public ports, each about half the time, the gap above
  its real forwards filled with decoys. Every route reaches both counts.
- A decoy is one of `ssh` (`:2222` onto the key box's `:22`), `web` (`:80`), `ftp` (`:21`), `mysql`
  (`:3306`) or `snmp` (`:161`), never one whose public port the contract already forwards, and no
  kind twice. Each forward reaches the same port on the key box, as the route's do.
- For every number: the route, `keyBoxRootHash`, `gatewayAdminHash`, the storage, the stem and the
  key-box octet are what they were before this slice, and the route's own forwards come first and
  unchanged (a decoy draws on `mission-decoys-<n>` alone).
- Every decoy daemon's package sits on a `low` or `medium` release; the existing 2,000-number test
  (no `critical` or `high` hole on either box but the route's) passes unchanged.
- **web decoy:** nginx with the stock `It works!` page; `gobuster` through `:80` finds `index.html`
  and nothing else.
- **ftp decoy:** `anonymous_enable=YES` and an empty `/srv/ftp/pub`, so an anonymous login lands and
  lists nothing.
- **mysql decoy:** the generated application behind a crackable application account (on the default
  list) and a database root from `SHUT_HASHES`; no `settings` and no `api_keys` table.
- **snmp decoy:** `/etc/snmp/snmpd.conf` in the base, world-readable, `rocommunity` one of `monitor`
  or `netops` and `syscontact netops@corp.local`; a read-write community hash from `SHUT_HASHES`.
  `snmpwalk` with the guessable community answers `READ-ONLY` and prints that contact; `public`
  gets silence; `hydra <address> snmp` finds nothing.
- **ssh decoy:** the forward only; the key box's root is what the route drew (shut on msfconsole).
- The server lays nothing for a decoy: `missionFiles` and `missionFilePaths` are unchanged for
  every number.
- `hireme.ts show` marks each decoy forward and service, so the operator can tell the route from
  the blur.
- The offer, pay, briefing, key, key path and `/etc/hireme/contracts` are unchanged.

**Shape**

- `missionShape`: a `DECOYS` table of the five kinds (its service record, or none for `ssh`, and its
  forward). After everything else is drawn, a `mission-decoys-<n>` stream picks the total from
  `[3, 4]`, then `total - forwards.length` kinds without repeats from those whose public port is not
  yet forwarded, and draws each one's safe version. A mysql decoy fills `keyBoxDatabase` with
  `databaseAccounts`; an snmp decoy fills `keyBoxCommunityHash` with a pick from `SHUT_HASHES` and
  draws its read-only community. The shape gains `decoys`, the kinds drawn, which `showReport` and
  the key box builder read. Decoys are appended to `keyBoxServices` and `forwards`.
- `GUESSABLE_COMMUNITIES` moves from `missionLeak.ts` to `missions/pools.ts`, so the shape and the
  leak draw from one list. A pure move in its own commit.
- `missionKeyBoxFs.ts`: the ftp config and `/srv/ftp/pub` follow "runs vsftpd", not "is the ftp
  route"; an snmp decoy gets its `snmpd.conf`. Everything else already follows the services.
- `showReport`: a `(decoy)` tag on each decoy forward and service line.

**TDD order (RED first, each at its public surface)**

1. `missionShape`, over a sample: forward count is 3 or 4, near half each; every route meets both;
   no public port twice; every decoy is one of the five; the route's forwards are a prefix of
   `forwards`, unchanged.
2. `missionShape`: nothing a contract already had moves (route, hashes, storage, stem, octet), and
   the existing per-route `toEqual` tests become "begins with the route's forwards".
3. `missionShape`: a mysql decoy's accounts (application crackable, root shut), an snmp decoy's
   read-write hash in `SHUT_HASHES`, each decoy on a safe release.
4. `buildMissionKeyBoxFs`: each decoy kind's box (stock page, anonymous config and empty `pub`,
   datadir with no word's table, `snmpd.conf` with the guessable community and the ordinary
   contact) and its pidfile and log.
5. `missionFiles`/`missionFilePaths`: unchanged for decoy kinds over a sample.
6. Commands at the doors on staged decoy numbers, through the remote-session harness the leak
   routes' tests use: `snmpwalk` with the guessable community, `ftp` anonymous `ls`, `mysql` with
   the cracked account and `SHOW TABLES`.
7. `showReport`: the `(decoy)` tags.

**Gates**

- `npm run typecheck`, `npm run lint`, the full suite, `npm run build` with `checkBudgets` (raise the
  ceiling if the build needs it).
- Wire-check: a new `scripts/testMissionDecoys.ts`, staging numbers through `hireme.ts accept
  --number` so that each decoy kind appears at least once, working each through the real `/api`
  endpoints: `nmap` lists every forward; the web decoy's sweep finds only `index.html`; the ftp
  decoy lets `anonymous` in to an empty `pub`; the mysql decoy's account cracks and its tables hold
  no word or key; the snmp decoy walks `READ-ONLY` with the guessable community, is silent with
  `public`, and `hydra` finds no read-write community; and the contract's own route still pays. The
  existing mission wire-checks re-run green.
- Mutation gate on the new and changed lines of `missionShape.ts`, `missionKeyBoxFs.ts` and
  `hiremeOrders.ts`.
- Version bump to v0.449.0 in `package.json` and `package-lock.json`.
- One browser run at close-out: a contract with at least two decoys, scanned, each decoy worked to
  its empty end, then the route worked to the payout.

**Docs**

- `missions-architecture.md`: §2's "No decoy services are drawn yet" and "a scan tells the route"
  become the decoy rules (kinds, count, depth, the shut read-write community); "To add a route"
  mentions `DECOYS` when the new route's door is a new kind.
- `backlog.md`: the decoys item leaves "missions — deferred", and believable filler behind real
  doors and decoys together joins it.
- `project-status.md` gains the shipped item.
