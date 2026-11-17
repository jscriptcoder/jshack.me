# Plan: a contract that asks for a port forwarded into a machine

**Status:** Slice 1 merged (v0.467.0, #780). Slice 2 on `feat/portforward-msfconsole`
(v0.468.0). Then the close-out.

A seventh kind of contract, and the first won on the router alone. The client wants one of the
target's inside services reachable from outside, on a public port the briefing names; the player
breaks into the contract network's router and adds the forward. The client reads the router when
the contractor mails in, as a backdoor client reads the target. As-built context:
[`docs/missions-architecture.md`](../docs/missions-architecture.md).

---

## Grill record

### The job

1. **The forward is the whole job (2026-11-17).** The client pays when the public port it named
   reaches the target on the inside port it named. Nothing on the target has to change: the
   service is already running there, and it is what the client wants to reach. Anyone's forward
   counts, as anyone's listener counts on a backdoor job. A forward to the right port on the wrong
   machine, or to the right machine on the wrong port, is a miss. Rejected: also asking for a root
   shell or a file on the target, which every other kind already asks for.

2. **The router draws one of two routes, half and half, on a stream of its own (2026-11-17).**
   Today a contract router is passed through, never broken: a shut admin, safe firmware, no agent.
   On a portforward job it draws a way in:
   - **hydra**: the router's admin password is from the crackable pool, so `hydra <address> ssh`
     on its own `:22` finds it and `ssh` lands a root;
   - **msfconsole**: the firmware is pinned to a release whose hole lands root (critical or
     high, on one of four vendors: item 9), so
     `msfconsole <address> 22` gets in through a router a scan shows as clean (firmware answers
     to no port, so `nmap -sV` never shows it).

   Either way the root edits `/etc/iptables/rules.v4` in `nano`. Set aside for later, as the leak
   routes followed the first key jobs: **snmp** (a guessable read-write community and `snmpset`
   with no root, which clashes with contracts that already forward `:161`), and **an inside
   leak** (root the target through a key-box route and find the router's admin in a backup
   config there).

3. **The target takes the key box's slot and runs one sealed service (2026-11-17)**, drawn per
   contract, each with a machine named after what it is:

   | Machine             | Service | Inside port | Hostname          |
   | ------------------- | ------- | ----------- | ----------------- |
   | customer database   | mysql   | 3306        | `<stem>-db`       |
   | cache server        | redis   | 6379        | `<stem>-cache`    |
   | staff intranet      | web     | 80          | `<stem>-intranet` |
   | development server  | ssh     | 22          | `<stem>-dev`      |

   The service is on a safe release with a shut login: the client wants a door, not the player's
   way through it, and the target never offers a root. The briefing never gives the address, so
   the player finds the machine from the router (a root there can `apt install nmap` and sweep the
   LAN). **The public port** is the client's pick from 2022, 8022, 8080, 8443, 13306 and 16379,
   never one the router already forwards or listens on; a test fails if it ever is. Rejected: ftp
   and snmp (snmp is UDP and a different story; too many routes already lean on ftp).

4. **Single-hop only (2026-11-17).** The router is reached straight from outside and the target
   is always inside with no forward of its own, so a front box would add nothing to the path. The
   network is the router and the target. Every contract router forwards 3 or 4 decoys, and here
   they land on the target, sealed as usual, but **no decoy is the kind of service the job
   exposes**, or that service would already be reachable and the job pointless; a test fails if
   one is. A number drawn two-hop that becomes a portforward job is single-hop; its kind changes
   anyway. The pay is the key job's single-hop range, 500–2,000 JSC to the nearest 50.

   **A chained two-hop version is set aside, not rejected (2026-11-17)** — see "Set aside" below.

### The proof

5. **The client asks the game's routing, not the file's text (2026-11-17).** On every mail the
   client materializes the router and asks `machineServing` where the public port leads, then
   checks it lands on the target's address at the inside port named. Whatever the router honours
   counts: a forward written in `nano`, one written by anyone else, and whatever a deny on the
   router does to it. A router that no longer boots reaches nothing, so a bricked router loses the
   job for good. The replies, subject `Contract: <target>`, the first row that fits answering:

   | The mail                          | The reply                                                                            | What changes              |
   | --------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
   | No accepted job with this client  | "We have no contract with you."                                                      | nothing                   |
   | A completed job                   | "That job is already closed." (the router is not read)                               | nothing                   |
   | Reaches it, with a wallet         | "We're through. §1,450 sent to jsc…. Pleasure doing business."                       | completed, the pay minted |
   | Reaches it, no wallet             | "We're through. You sent no wallet, so there is nothing to pay. No wallet, no money." | completed, nothing minted |
   | Anything else                     | "Port 13306 doesn't reach their customer database. No way in, no money."             | nothing                   |
   | The read itself fails             | nothing: 500, as any store failure                                                   | nothing                   |

   "Anything else" is one reply for no forward, the wrong machine, the wrong inside port and a
   bricked router; it never says which. Only the mail's wallet matters. A completed job stays
   completed: a later removal of the forward takes nothing back.

### The terms

6. **The kind is called `portforward` (2026-11-17)**, legacy's name and what the job is. The board
   reads `<Client> — open a way into a customer database — §<pay>` (likewise a cache server, a
   staff intranet, a development server), and `hireme.ts show` prints
   `Kind: portforward, <machine>, <public>→<inside>`. `mission-kind-<n>` splits in sevenths on the
   backdoor and infiltrate precedent: each older kind gives up a sliver at one edge, so no number
   moves between older kinds; the fractions are the plan's. Each machine brings three pitches of
   its own, twelve in all ("an auditor needs to look without anyone knowing", "we want their
   numbers live"). The briefing names the machine, the inside port and the public port, never the
   router, an address or `rules.v4`:

   ```text
   We want to reach their customer database from outside.
   Their router should send port 13306 to it, on 3306.

   Write to this address with your wallet address once it is open.
   No way in, no money. No wallet, no money.
   ```

### Accepted as the world already works (2026-11-17)

7. - **Whoever roots the router can close its route** for whoever comes after: `passwd` closes
     hydra, and an `apt upgrade` flashes the firmware, which closes msfconsole and reboots the
     router. A rival can delete the forward. It is "whoever roots a box can close its route", as
     everywhere.
   - **Nothing else on the router is rated above medium.** sshd and the rest stay on safe
     releases; on the msfconsole route only the firmware's critical-or-high hole does. The
     2,000-number shape test covers the router as it covers the key box. **Amended 2026-11-17,
     slice 2:** a router holds only root, so sshd's safe hole lands whatever it grants on root,
     and about one portforward router in three falls to `msfconsole <address> 22` through sshd
     itself (a password reset, a listener or a script). The owner accepted it as how every router
     in the world falls: it only adds a way in, the drawn route stays open, and a listener never
     opens on a port a job names.
   - **A firmware route release exists by `MISSION_ROUTE_DAY` (111):** a hole that lands a root
     shell, published on or before that day (item 9 found it critical or high, on four vendors).
     A test walks the firmware timelines as one already walks the service packages'.
   - **No new tool is needed.** Forwards live only in the router's `rules.v4`
     (`core/network/iptablesRules.ts`); an `snmpset` forward writes the same file through
     `withForward`, so the one check covers both, should the snmp route join later.

### The work

8. **Two slices (2026-11-17).** Slice 1, a portforward job pays on the hydra route: the kind and
   its share of `mission-kind-<n>`, the target with all four machines and their pitches, the
   router's crackable admin, the client's check through `machineServing`, the replies,
   `hireme.ts show`, and a wire-check that drives accept → `hydra` the router → `ssh` →
   `nano rules.v4` → the mail → the payout. Slice 2, the msfconsole route: the firmware pinned to
   a critical release, the half-and-half route draw, the timeline test, and the wire-check
   extended to a firmware contract. Rejected: one PR (the firmware pinning and its timeline test
   are a mechanism of their own, and slice 1 already pays).

9. **The msfconsole route rests on a critical-or-high release that lands a root shell, on one of
   four vendors (2026-11-17, from planning).** Measured while planning: by day 111 only
   ubiquiti has a *critical* firmware release whose hole is `shell_full`. A high hole lands root
   too (`TIER_BY_SEVERITY`, `core/cve/firmwareExploit.ts`) and still beats the router's sshd on
   its low-or-medium release. Root-shell releases by day 111: ubiquiti 3.3.0 (critical) and 2.0.9,
   cisco 17.0.4 and 17.0.5, openwrt 24.2.0 and 24.4.1, pfsense 3.0.3 (all high). mikrotik has none
   (its critical is `file_write`) and ddwrt none (`file_read`, `backdoor_port_open`). So the route
   release is the newest critical-or-high firmware release published by day 111 whose effect is
   `shell_full`, and a router on the msfconsole route takes its vendor from those four, drawn on
   the contract's own stream and handed to the router builder. A hydra-route router keeps the
   builder's own vendor draw, so a vendor never tells the route. A test walks every vendor's
   timeline and fails if one of the four loses its release. Rejected: ubiquiti only (every
   firmware-route router a ubiquiti, a tell in `dpkg`); mikrotik's critical `file_write` (a
   second way to do the job, through a root file write, with its own mechanics; ddwrt would still
   have nothing).

### Set aside

- **A chained two-hop portforward (2026-11-17).** The target sits behind an inner router on a
  second layer; the player roots both routers and writes two forwards, at two-hop pay
  (2,000–4,000). Not possible today, for two reasons found in the grill:
  1. **A public forward stops at the first box it reaches.** `resolvePublicTarget` lands on the
     box at the forward's address and, if that box is a router, counts the port only if the router
     itself listens on it (`listensOn`); its own `rules.v4` is never read. The chained walk exists
     only from inside a LAN (`resolveInnerGatewayTarget`, Story 5b).
  2. **Contract networks have no second layer.** Inner routers and deep layers
     (`seedNetworkDepth`) exist on world networks only.

  Agreed order when it is taken up: first the world (a public forward that lands on a router
  follows that router's forwards, one walk shared by the outside and LAN resolvers, with scans,
  `ssh`, `hydra` and the data doors going through it — useful on its own, since today a player
  cannot expose a deep box on their own network), then the contract. Its own grill, not a slice
  of this plan. Recorded in `docs/backlog.md` under "missions — deferred".
- **The snmp and inside-leak router routes** (item 2).

---

## Where it plugs in

Read before the slice; every path is today's code (v0.466.1).

- **The kind** is `missionKind` (`src/core/missions/missionShape.ts`), one draw on
  `mission-kind-<n>`. `MissionKind` gains `'portforward'`. Each of the six kinds goes from ⅙ to
  1⁄7 by giving up 1⁄42 at the top of one of its pieces, so a number is the kind it was or has
  become portforward, and none turns from one older kind into another. In 420ths (today's
  sixtieths × 7):

  | Draw (×1⁄420) | Kind        | Was        |
  | ------------- | ----------- | ---------- |
  | 0 to 60       | tamper      | tamper     |
  | 60 to 70      | portforward | tamper     |
  | 70 to 84      | infiltrate  | infiltrate |
  | 84 to 95      | backdoor    | backdoor   |
  | 95 to 105     | portforward | backdoor   |
  | 105 to 140    | file        | file       |
  | 140 to 200    | sabotage    | sabotage   |
  | 200 to 210    | portforward | sabotage   |
  | 210 to 224    | infiltrate  | infiltrate |
  | 224 to 245    | backdoor    | backdoor   |
  | 245 to 270    | file        | file       |
  | 270 to 280    | portforward | file       |
  | 280 to 294    | infiltrate  | infiltrate |
  | 294 to 315    | backdoor    | backdoor   |
  | 315 to 375    | key         | key        |
  | 375 to 385    | portforward | key        |
  | 385 to 399    | infiltrate  | infiltrate |
  | 399 to 406    | backdoor    | backdoor   |
  | 406 to 410    | infiltrate  | infiltrate |
  | 410 to 420    | portforward | infiltrate |

  Sixty each: tamper 60, sabotage 60, key 60, file 35+25, backdoor 11+21+21+7, infiltrate
  14+14+14+14+4, portforward 6×10. A draw past the last cut is now portforward, not infiltrate.
- **Single-hop by kind.** `drawTopology` draws two-hop on `mission-template-<n>` whatever the
  kind; it now returns no front box when `missionKind(n)` is `portforward`, so `missionTopology`
  and `missionShape` agree and every hop command sees one box behind the router. No other
  number's topology moves (the kind is its own stream).
- **The job's draws** sit on one stream of their own, `mission-portforward-<n>`, in a
  `portforwardJob(n)` beside `backdoorJob` (`src/core/missions/targetRoles.ts`): the machine
  (customer database, cache server, staff intranet, development server, each with its noun,
  suffix, service, inside port and three pitches), then the public port. `keyBoxSuffix` answers
  the machine's suffix (`db`, `cache`, `intranet`, `dev`) for a portforward number.
- **The target is sealed and has no route.** `MissionBox.route` widens to
  `MissionRoute | null`, null on a portforward target; its readers (`missionLeak.ts`'s four
  checks, `hiremeOrders.ts`'s route lines, the wire-check pickers) treat null as no route, so no
  leak file, records or key is laid. Its `root` is from `SHUT_HASHES`. It runs the job's service
  on a safe release: `mysql` with both database accounts shut (application and root), `redis`
  with a `requirepass` from `SHUT_HASHES` (the key-box builder, `missionKeyBoxFs.ts`, learns to
  lay a store as it lays a datadir), `nginx` with the stock page, or nothing more for ssh
  (`sshd` runs on every box). Storage is `null`.
- **Decoys only on the router.** A portforward contract has no real forwards: `withDecoys`
  fills all 3 or 4 from the decoy kinds, minus the kind the job exposes (`mysql` for the
  database, `web` for the intranet, `ssh` for the development server — the `:2222` decoy forwards
  onto its sshd; redis has no decoy kind). The public port never clashes: decoys answer on 2222,
  80, 21, 3306 and 161, the router on 22.
- **The router.** `MissionShape` gains `routerRoute: 'hydra' | 'msfconsole' | null` (null on
  every other kind) and, for slice 2, the vendor. On a portforward number, after the existing
  draws so `versionPrng` moves nothing, `gatewayAdminHash` is replaced by a crackable hash drawn on
  `mission-router-<n>` (slice 1, hydra). The gateway already runs `sshd:22` on a safe release
  (`safeBaseVersions`), and `missionGatewayFs` (`src/core/generation/routerFs.ts`) already builds
  the router from `gatewayAdminHash`, `gatewayVersions` and `forwards`, so the router is
  `hydra`-able on its public `:22` with no builder change in slice 1.
- **The client's check.** `decide` (`src/core/missions/clientMail.ts`) sends an accepted
  portforward job to a new `checkForward` decision; `proves` answers true for it, as for the other
  box-read kinds. `answerClientMail` gains a reader `readForward(n)` answering
  `'reaches' | 'misses' | 'error'`. Its server side sits beside `targetBoxReader` in
  `src/core/emailit/handleResolveMail.ts`: replay the contract's gateway over its journal
  (`materializeApGatewayFs`, as `resolvePublicTarget` does), `misses` when it cannot boot, then
  `machineServing` for the public port; `reaches` when the answer is a forward to
  `<subnet>.<target octet>` at the inside port. A failed journal read is `error` (500).
  `RECEIVED` gains "We're through." and the miss line names the port and the machine.
- **Terms** (`src/core/missions/missionTerms.ts`): a `job: 'portforward'` arm drawn on
  `mission-terms-<n>` in the backdoor arm's order (client, target company, the machine's pitch,
  pay), `kind: open a way into a <noun>`, at single-hop pay (500–2,000, to the nearest 50).
- **The briefing's lines** (`jobLines`, `src/core/hireme/contracts.ts`): the ask, the port line,
  "Write to this address with your wallet address once it is open." and "No way in, no money. No
  wallet, no money." No attachment, so no migration.
- **`show`** (`src/core/missions/hiremeOrders.ts`): `Kind: portforward, <machine>`,
  `Forward: <public>→<inside> on <stem>-<suffix>`, `Router: hydra` (slice 2: `msfconsole,
  <vendor> <version>`), the slot called the target, `Route: none (sealed)`.
- **What re-rolls on ship:** a seventh of all numbers turn portforward. Every pinned number,
  wire-check picker and test factory that lands portforward is re-picked, as each earlier kind
  re-picked its own; the pickers that filter on `keyBox.route` already skip a null route.

## Given by the plan, not the grill

- **Each machine draws its public port from the grilled six by what it is:** the development
  server 2022 or 8022, the intranet 8080 or 8443, the database 13306, the cache 16379. A port
  that reads like the service it reaches is the client's natural pick, and it stays inside the
  pool the grill named.
- **The briefing**, for the database:

  ```text
  We want to reach their customer database from outside.
  Their router should send port 13306 to it, on 3306.

  Write to this address with your wallet address once it is open.
  No way in, no money. No wallet, no money.
  ```

- **The miss line**: "Port 13306 doesn't reach their customer database. No way in, no money."
- **The check reads the router, not the target.** The target is sealed and nobody can root it,
  so its service is always up; the router's boot gate and its forward table are the whole
  question. A router root's `rm` of the target is impossible, and the one thing that could take
  the service away (a root on the target) does not exist.

---

## Slices

Load `tdd`, `testing` and `refactoring` before code and `mutation-testing` at the PR gate.

### Slice 1 — a client hires a contractor to open a way into a machine through its router, on the hydra route (v0.467.0)

**Value:** a contractor takes an `open a way into a customer database` job off the board, cracks
the contract router's admin with `hydra` on its `:22`, `ssh`s in as root, installs `nmap` there
and finds the target, adds `forward 13306 to <target>:3306` to `/etc/iptables/rules.v4` in `nano`,
mails the client and is paid once; any other state of the router gets "Port 13306 doesn't reach
their customer database. No way in, no money."
**Class:** behavior change. **Branch:** `feat/portforward-jobs`.

**Acceptance criteria**

- A seventh of numbers are portforward jobs on `mission-kind-<n>`, cut as the table above, and
  each older kind keeps a seventh. Every number that stays key, tamper, sabotage, file, backdoor
  or infiltrate keeps its shape, terms and LAN exactly (a 2,000-number sample deep-equals a
  fixture captured from `main`, captured and deleted inside the PR).
- A portforward contract is single-hop: one target in the key-box slot, named
  `<stem>-db`, `-cache`, `-intranet` or `-dev`, a quarter each over a sample.
- The target runs its machine's service on its inside port, on a safe release, with no way to
  root it: `root` shut, a database's application and root accounts shut, a cache's `requirepass`
  shut. It holds no key, records, file or storage.
- The router forwards 3 or 4 decoys onto the target and no real forward. None is the kind the job
  exposes. The public port is the machine's (2022/8022, 8080/8443, 13306, 16379), and is never one
  the router forwards or listens on (a test over 2,000 numbers).
- The router's admin is crackable: `hydra <address> ssh` on its `:22` finds it, and `ssh root@`
  lands on the router. Nothing else on the router or the target climbs (the shape test covers
  the router and a routeless target).
- The board reads `<Client> — open a way into a customer database — §<pay>`, pay 500–2,000 to the
  nearest 50, the target company drawn as a key job's. The briefing opens with one of the
  machine's three pitches, then the ask and the port line as above, and the closing two lines.
  It names no router, address, `rules.v4` or path.
- Any mail from the contractor on an accepted portforward job reads the router:
  - the public port forwarded to the target at the inside port (anyone's forward) → completed,
    paid once, "We're through. §X sent to jsc…. Pleasure doing business." (no wallet: "We're
    through. You sent no wallet, so there is nothing to pay. No wallet, no money.");
  - no forward on that port, one to another machine or another inside port, or a router that
    no longer boots → "Port N doesn't reach their <machine>. No way in, no money.", the job still
    accepted.
- A later mail on the completed job → "That job is already closed.", without reading the router.
- A router read that fails answers nothing (null, 500 at the handler).
- `hireme.ts show` prints `Kind: portforward, <machine>`, the forward asked for, `Router: hydra`,
  the slot as the target and `Route: none (sealed)`.
- Every older kind offers, briefs, completes, refuses and closes exactly as before.

**TDD order (RED first, each at its public surface)**

1. `missionKind`: the seven shares over a sample; every number that keeps an older kind keeps it.
2. `missionTopology`/`missionShape`: a portforward number is single-hop; its target's suffix,
   sealed root, service, versions and decoys (never the exposed kind); no real forward; the
   public port's pool and that it never clashes; the router's admin crackable.
3. The key-box builder: a portforward target runs its service (a cache's store with the shut
   `requirepass`, a database with both accounts shut); `missionFiles` lays nothing on it.
4. `missionTerms`: the portforward line, the pay range, the target name.
5. The briefing for each machine.
6. `answerClientMail`: a reaching forward pays once (with and without a wallet); no forward, the
   wrong machine, the wrong inside port and a bricked router answer the miss line; closed
   without a read; a failed read answers null; every other kind unchanged.
7. The server's `readForward`: a gateway journal with the right forward reaches; with a wrong
   one, none, or a `/boot` tombstone misses; a failed journal read is an error.
8. `show` for a portforward number.
9. Factories and pinned wire-check numbers moved off numbers that landed portforward.

**Gates**

- `npm run typecheck`, `npm run lint`, the full suite, `npm run build` with `checkBudgets` (raise
  the ceiling if the pitches need it).
- Wire-check `scripts/testMissionPortforward.ts` (new), staging numbers with `hireme.ts accept
  --number`: the briefing's lines; a public scan shows the router's `:22` and the decoys, never
  the public port; a mail before anything → the miss line; the router's admin from `hydra`'s
  sweep logs in; a forward on the right port to the wrong inside port, then to the router's own
  address, written through `/api/patches` as the router's root → the miss line each; the right
  forward → the public port now shows on a scan and reaches the target's service (an `ssh`, a
  page fetch or a data-door reach through it, by machine), and the mail pays once; a second mail
  → closed; a fresh contract whose forward a second player writes → paid; a forward written then
  removed before the mail → the miss line; a bricked router → the miss line. Every other mission
  and hireme wire-check re-run green.
- No migration and no new variable.
- Mutation gate on the changed lines of `missionShape.ts`, `targetRoles.ts`, `missionTerms.ts`,
  `contracts.ts`, `clientMail.ts`, `handleResolveMail.ts`, `missionKeyBoxFs.ts`,
  `missionLeak.ts` and `hiremeOrders.ts`.
- `docs/missions-architecture.md`: the header and "the one idea" name the seventh kind, the kind
  split moves to sevenths in the earlier kinds' sections, "Two hops" says a portforward job is
  never two-hop, and a "Portforward jobs" section records what this slice built.
- v0.467.0 in `package.json` and `package-lock.json`.

### Slice 2 — the msfconsole router route (v0.468.0)

**Value:** half of portforward contracts put the router on a firmware release whose hole gives
a root shell, so `msfconsole <address> 22` gets in through a router a scan shows as clean, and
the job is finished from there as on the hydra route.
**Class:** behavior change. Criteria to the owner once slice 1 merges. In outline: the router
route drawn half and half on `mission-router-<n>`; on msfconsole the vendor drawn from the four
with a root-shell release and handed to `missionGatewayFs` (an optional vendor on the router
identity that wins over the seed draw), that vendor pinned to its newest critical-or-high
`shell_full` release by day 111 and every other package safe, the admin shut again; the
timeline test over the four vendors; the shape test proving the firmware is the only climb;
`show`'s `Router: msfconsole, <vendor> <version>`; the wire-check extended to a firmware
contract through `exploitCreateSession`; `docs/missions-architecture.md` updated.

### Close-out

One browser run on a fresh player: a hydra-route job worked from the board to the payout (mailed
once before anything for the miss line, then `hydra` and `ssh` to the router, `apt install nmap`
there, a sweep of the LAN, `nano` on `rules.v4`, and the target reached through the new public
port from the player's own box), and an msfconsole-route job the same way through `msfconsole`.
Then `docs/missions-architecture.md` finished, `docs/project-status.md` given its entry, the e2e
skill's `reaching-a-state.md` given the route, the plan retired, and the story offered for
valleynews.io `/dev`.
