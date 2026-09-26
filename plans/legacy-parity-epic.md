# Epic: Legacy Parity (v2) — every way into a machine

> **Picking this up cold?** Read "Locked decisions", then the Phase 3 tree and the slice
> table — both are maintained per-PR and carry the live status. `## Next action` at the end
> is a HISTORICAL close-out log, NOT a pointer to current work: its newest entry is D5b
> (v0.157.0), many versions behind.
> Split authored 2026-07-29 (`story-splitting`), then grilled to nine locked decisions
> (`grill-me`, same day).

**Where we are now (2026-09-21):** **v0.247.0**. **Phase 3 slice 9 — firmware falls — is SHIPPED
and closed out, and with it V4 and the entire V-series are CLOSED**: four independent PRs to trunk,
#528, #529, #531, #532 (#530 between them was an unrelated sweep-test fix), v0.244.0–v0.247.0, with
its as-built retired into the `### Phase 3 slice 9` section near the end of this file and its plan
file (`firmware-falls.md`) deleted. Ten decisions, 81–90, in `### Slice 9 — resolved decisions`
(89 supersedes 82's ordering; 81 takes up slice 1a's `<vendor>-firmware` escape hatch); two of the
ten — 84 and 89 — are corrections the grill found rather than choices it made, without which the
axis lands a silent refusal on every router-class box (84) and is unreachable from the world's
second fortnight on (89). Slice 8 before it (libraries fall, #519–#527, v0.235.0–v0.243.0) is in the
`### Phase 3 slice 8` section; together slices 8 and 9 delivered V4. **All nine Phase 3 slices are
shipped** — the loop, the effect set, the cross-network route, the defender's patch, reboot
eviction, and both halves of local escalation (libraries and firmware). **Next is the ship gate**,
which waited for the generated world content epic (as-built:
[`world-content-architecture.md`](../v2/docs/world-content-architecture.md); owner decision:
content is inside the ship gate). **That epic is DONE** (2026-09-25, v0.264.0, all
twelve slices, #533–#550), so the ship gate is unblocked. **Update 2026-09-26: X2 (`findit.io`) was
un-deferred and GRILLED ahead of the ship gate** — decisions 91–105 and a six-slice spine in
["X2 — resolved scope & decisions"](#x2--resolved-scope--decisions-grilling-2026-09-26); its slice 1
SHIPPED v0.265.0–v0.268.0 (#551–#554), its slice 2 v0.269.0–v0.270.0 (#555–#556) and its slice 3
v0.271.0 (#557), all as-built under that section; slice 4 (findit falls and comes back) is next to
plan.
The `Status` block below is an accumulating log, not the current state.

**Status**: **D1 shipped** (v0.109.0), with its web follow-ups D1c (v0.123.0-v0.124.0), D1b
(v0.125.0-v0.129.0) and D1d (v0.130.0) all closed out. **D3 ✅ COMPLETE (v0.136.0)** — six slices,
#393–#398, closed out 2026-08-15: its plan file is deleted and the as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1 (the shape) and §7 (the
invariants), with the live two-player run as Act 11 of
[`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md).
`ftp` (D3) and `scp` (D3b) were **split into separate grill + plan phases** on 2026-08-14 — scp is
a transient two-endpoint transfer, not a door — and **BOTH are GRILLED** (D3: nine decisions;
D3b: five decisions + three slices; see their "resolved scope & decisions" sections).
**D3b ✅ COMPLETE (v0.139.0)** — all three slices shipped (#401, #402, and the cross-player one),
with `testScpTransfer` 19/19 live over both door-kind paths and Act 12 of the shared-network doc
as the two-player browser run. It inherited a working door: the transfer moves files through the
one D3 proved, so its slices were about the transient auth session and the two-endpoint
resolution rather than about reaching a box.
**D2 ✅ COMPLETE** — D2.1 (v0.111.0), D2.2 (v0.113.0), D2.3
(v0.114.0), D2.5 (v0.115.0), hydra's workstation-only gate lifted (v0.118.0), D2.4 all five slices
(v0.119.0–v0.122.0), and D2.6a (#377). Its split file is deleted; the as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1. **D2.6b — harvestable
plaintext loot — is the one piece D2 named and did not build**, and it is **POSTPONED by owner
decision (2026-08-12)** in favour of parity breadth: the harvest route can arrive with the CVE
phase instead of as bespoke loot (see "Next action").
**D4 ✅ COMPLETE (v0.142.0)** — four slices, #407–#411, closed out 2026-08-16: its plan file is
deleted and the as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7 (the daemon descriptor,
the single "what is running here" policy, the `env.fs` snapshot) and §9, with the browser run as
Act 13 of [`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md).
**D6 ✅ COMPLETE (v0.171.0)** — seven slices plus 6b, #434–#448, closed out 2026-08-23: its plan
file is deleted and the as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7 (the four-vantage reach,
the cross-player data write, the occupant-beats-sibling rule) and §9 (its remaining test debt).
Its close-out **browser smoke test found one real defect** — a defender's own box silently
reverting an intruder's writes — **fixed at v0.172.0 (#449)**, which also corrected the §7 claim
that every vantage re-materializes per statement. Of the three smaller findings from the same
run, **two are closed at v0.173.0** (the sub-shell prompt echo and the self-scan cover name) and
one stays a §9 backlog entry, because it is a product decision rather than a bug.
**D7 ✅ COMPLETE (v0.182.0)** — eight slices, #452–#461, closed out 2026-08-26: its plan file is
deleted and the as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7 (the reach parameterized
by daemon, the occupant-beats-sibling rule now covering PORTS, the three-outcome seam, the
NAT-vs-inside refusal asymmetry, `secretOn`) and §9. Its twelve locked decisions stay in "D7 —
resolved scope & decisions". It renamed the epic's own row to `rediscli`, believing `redis-cli`
unusable because `node`'s sandbox makes every command name a JS parameter — **reversed
2026-08-26**: the command is `redis-cli` again, and the sandbox keys its context by a
camelCase identifier instead. Its
close-out also **closed the last open finding from D6's browser smoke test** — a fellow occupant's
open ports were invisible to `nmap` — so all four of that session's findings are now resolved.
**Three follow-ups then landed on trunk after that close-out.** **#462** (v0.183.0) — `DAEMONS`
gained a `redis` entry when a player first ran their own store and `UNITS` never did, so
`systemctl start` answered "Unit redis.service could not be found" on a box where the store was
installed and running; because `systemctl stop` is the only way to shut a service, the store was a
door that never closed. **Found by playing the game, not by a test.** **#463** — three assertions
comparing NAMES rather than counts now hold the three daemon tables to one fact (every daemon a
package installs can be started, every startable one can be stopped, every catalog door names a
daemon a player can act on), verified by re-injecting both historical bugs; plus the ftp
wire-check fixture that had been asserting an `ssh` login against an ftp box. **#464** (v0.184.0)
— six commands took the name their real counterpart actually has: `reset` → `new-game` (the real
`reset` reinitialises a terminal; this wipes the save), `airdump` → `airodump-ng`, `aircrack` →
`aircrack-ng`, `airmon` → `airmon-ng`, `rediscli` → `redis-cli`, and the daemon `redis` →
`redis-server` (the package stays `redis`). The systemctl unit and the pidfile follow the daemon
name, so it is `redis-server.service` now. **Trunk is at v0.184.0.**
**D8 ✅ COMPLETE (v0.193.0)** — eight slices, #465–#473, closed out 2026-08-31: its plan file is
deleted and the as-built lives in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md)
§7 (the indistinguishability rule now binding the SCAN, `portsOpenToNetwork`, the terminate-vs-
pass-through rule) and §9 (the same-LAN journal-blind scan as D8's third bite, the `snmpwalk`
own-box gap, and `snmpd.log` as the fifth stale-log writer). Its eleven locked decisions stay in
"D8 — resolved scope & decisions". The grill's headline held: the `snmpd.conf` firewall/ACL OID
parsers legacy named would have duplicated the `rules.v4`/`acl.conf` v2 already ships, so the OIDs
shipped as a VIEW over those files — one fact, two interfaces, nano-over-ssh and snmp-without-a-
shell. It added the first `protocol` column on `ServiceSpec` (snmp reads `161/udp`) and a
`deny <port>` local firewall any box that installs the agent can keep about itself. **Its whole arc
was run live in the UI 2026-08-31** (install → rotate → walk → hydra → snmpset deny → the scan goes
dark → the forward stands, its target closes it), with the cross-player wire-check green 15/15.
**D5 🔍 GRILLED 2026-08-16, not yet planned** — fifteen locked decisions and a six-slice spine in
"D5 — resolved scope & decisions"; it also found that §9's `ps` defect is misdiagnosed and owns
the fix.
**D9 ✅ COMPLETE — v0.196.0-v0.200.0** (#475-#478, #480), all five slices; the plan file is deleted
and the as-built lives in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md)
§2/§4/§7/§9. Seventeen locked decisions — eleven in "D9 — resolved scope & decisions", six more at
slice 4; **decision 5 carries an amendment** (a script's output is `node`'s own `CommandResult`
lines, not `env.output` — which is what makes it pipe), and the epic's **slice 2 was split into 2a
(the call surface) and 2b (the liveness)**. It is the one Phase 1 row that is **not a door** (no
daemon, no port, no placement, no cross-player half, no `api/` change), and its headline is a
refusal: the row's **programmatic auth cannot port**, because `CommandEnv` is a per-line snapshot
and a script that hopped would go on answering about the box it left.

**D10 🚧 IN PROGRESS — slices 1 and 2 of 5 SHIPPED** (`dd1cc5cf`, PR #481, v0.201.0): a player clears the
terminal, colours it in one of four palettes that survives a reload, and asks it who they are.
Fifteen locked decisions and a five-slice spine in
"D10 — resolved scope & decisions". It **grew and shrank at once**: locked decision 9's whole long
tail folds in (nothing ever "first needed" `find`, `strings`, `chmod` or `gpg`, so without D10 they
never ship), while **`bash` is refused rather than ported** — it existed to run binaries by path in
a PATH-less NC shell, and v2 has neither. Its sharpest finding is that a second tab currently
rehydrates the SAME server-side session stack, so `xterm` ships as a genuinely fresh terminal
rather than as a `window.open`.

**Ship gate**: **all doors + hydra + discovery + the CVE system, minus missions.** Missions are
a **post-ship epic** — the infrastructure this epic builds is what makes them cheap.

## Why this epic exists

The multiplayer/cross-player epic is **complete** — the hard part, the part legacy never solved
because of React, is done and proven live (as-built:
[`cross-player-architecture.md`](../v2/docs/cross-player-architecture.md); its plan file was
retired on close-out and its deferred tail is in `conventions-and-gotchas.md` §9). What v2
lacks is the part legacy *did* get right: **the breadth of ways to reach a machine.**

Legacy shipped ~14 access vectors. v2 has **one** (`ssh`), and it only opens with a password no
player can obtain in-game. This epic closes both gaps.

---

## Parent capability (reframed)

> **A player can earn a machine's credentials in-game and reach it through whichever door it
> leaves open — web, file transfer, backdoor, database, device management, or a vulnerable
> service — and the defender can see it, close it, and patch it.**

- **Actor**: any player, as attacker and as defender.
- **Current constraint (the gate)**: one door, no in-game way to open it, and (near-term) no
  way to find a stranger. The shipped PvP machinery is reachable in tests, not in play.
- **Outcome**: the loop becomes self-sufficient — crack → enter → act — with no out-of-band
  knowledge at any step.

---

## Locked decisions (grill-me, 2026-07-29)

These are the spine. Every slice below derives from them.

### 1. Pre-CVE, the AP gateway is the root target — workstation root stays hard

hydra is wordlist-gated, so it reaches weak seeded pools but **not** a player-chosen
workstation root password. That is deliberate: a defender who picks a strong root password is
genuinely safe from other players until CVE lands. The crackable root targets pre-CVE are the
**shared AP gateway** (`seedApGatewayAdminPw`, `routerFs.ts:57` — *"taking the gateway is a
crack, not a birthright"*) and **NPC hosts** (decision 6).

**Consequence**: cross-player `su root` on a player workstation is near-dead content until the
CVE phase, so *"what can a guest actually do once inside"* has to carry the loop. That is why
the doors are the near-term focus.

### 2. Protocol is UX; tier is truth

A session's protocol does **not** constrain it server-side. `SessionKind` stays provenance;
L1 (session on the machine) + L2 (walker at the session's tier) keep carrying authorization
unchanged.

**Rationale — realism**, this project's governing principle: in real Unix an FTP login as
`guest` and an SSH login as `guest` have identical filesystem rights. The protocol limits the
**command surface**, not the privilege. Client-side mode restriction (FTP mode, NC mode's
missing PATH) is realism and UX, not a security boundary.

**Consequence — this is the big de-risker**: every door is a **thin** slice — resolve target →
check credential → insert a session row at the right tier → client mode. No new authorization
dimension, nothing beneath it changes. Story 7 already proved the shape: its same-LAN handler
was *"the ONLY net-new auth front door."*

**Left open** — **RESOLVED 2026-08-16 at D5's grill**: `nc -l` backdoors, where no credential is
checked and the "user" is asserted by the pidfile. The answer leaves this decision intact — only
the credential STEP becomes pluggable, while the spine, the session row and the tier are
unchanged. See "D5 — resolved scope & decisions".

### 3. CVE is inside the ship gate — re-ordered, not re-scoped

Connection doors first, then discovery, then the vulnerability system, then ship. CVE was a
large part of what made legacy good, and decision 1 means that without it the brick payoff
never reaches a defended workstation.

### 4. Each door ships with its content generation

A door with nothing behind it is a protocol demo, not a slice. A `mysql` story includes the
`SERVICE_CATALOG` row, generation placement, **and** the data generator. Legacy carried exactly
this weight (`generateDatabase.ts`, `generateRedisData.ts`, `pools/{database,redis,web}.ts`).

**Why this is affordable**: near-term, the consumer of these doors is **generated NPC hosts on
the shared LAN plus the AP gateway** — not other players. So doors are developable and
verifiable without two identities, and cross-player comes free via the shared journal.

### 5. Web first, then hydra, then the rest

Web is the **only credential-free door** — `/var/www/**` is already in the tier-3 allowlist
(`readFilter.ts:61`), so the cross-player read path needs no work. It is the cheapest complete
instance of the chain every later door repeats, with no auth to entangle it.

### 6. Two password pools; wordlist growth IS the progression

**"Crackable" is not a property of a password — it is membership in *your* wordlist.** The
legacy invariant holds exactly: the wordlist is the **sole gate**.

- **Crackable pool** — every member ships in the default `/usr/share/wordlists/passwords.txt`,
  installed with `apt install hydra`. **Long.**
- **Uncrackable pool** — disjoint, none in the default wordlist. **Long.**
- **Guest** accounts: always crackable-pool.
- **NPC user**: high probability crackable. **NPC root**: low probability crackable — so
  day-one rooting happens but is rare (a difficulty curve, not a binary).
- **Progression**: harvest a plaintext (loot in content, CVE `password_reset`, `john` on a
  stolen hash) → append it to your wordlist → coverage grows across **every** machine that drew
  that password.
- **Pool sizing**: a large curated uncrackable pool — harvesting meaningfully grows coverage,
  full exhaustion is impractical. No cliff.

**Derived, free**: your wordlist is **loot**. It is a real file on your own box, so it lives in
the shared journal — anyone who gets in can `cat` it and inherit everything you harvested (or
`rm` it at root tier). A concrete reason to defend your box beyond the brick. Zero new
mechanism.

**Derived**: curation is via `nano` (shipped). Neither v2 nor legacy has `>>` — `tokenize.ts`
emits `pipe` and `redirect` only — so append is not a parity requirement.

**Code delta**: `WEAK_PASSWORDS` (`remoteHostFs.ts:87`) splits into two pools plus per-account
probability knobs; `buildRemoteHostFs` changes behaviour. Free pre-launch.

### 7. The uncrackable pool is obfuscated, not server-held

Reuse the shipped seam: `core/secrets/secrets.ts` (committed plaintext, never imported by the
app) → `scripts/encode.ts` at build → gitignored `__encoded.ts` → `contentCodec.ts` decodes at
runtime. `WIFI_PASSWORDS` already rides it and `secrets.ts` says other pools port in as their
features land.

**Accepted cost, stated plainly**: `contentCodec.ts` documents itself as *"OBFUSCATION, NOT
SECRECY — the key sits in the shipped bundle."* A determined reader recovers the pool, so
wordlist progression is bypassable by exactly the audience most motivated to try. Same posture
as the reverted nonce store: **revisit at multiplayer-hardening.** The alternative (ship md5
hashes to the client, keep plaintext server-side, make hydra/john server calls) is recorded
here as the hardening path if it is ever wanted.

### 8. Door order: ftp → daemons → nc → mysql → redis → snmp → node

> **REVISED 2026-08-14 — `scp` split out of D3 into D3b, its own grill + plan.** The order below
> is unchanged; only the fusion of ftp and scp is. `scp` is a transient two-endpoint transfer, not
> a door — it has no daemon, no port and nothing to place, and legacy built it larger than ftp
> (417 lines vs 218). It stays after ftp, which supplies the tier-gated copy primitive it reuses.
> Full reasoning in "Next action".

ftp is the cheapest **complete** door — no content generator, since the target's filesystem is
the content — so it proves decision 2's session pattern at minimum cost. Daemon control follows
because by then a player runs sshd + a web server + ftpd with **no way to stop any of them**.
`nc` comes once the pattern is routine, since it carries the open design question. The two
heavy data doors follow, then snmp, then node as a force multiplier over everything built.

### 9. The long tail folds in, plus one polish slice

`find`, `whoami`, `strings`, `chmod`, `gpg`, `ping` land in the slice that first needs them.
`nslookup`/`dig` move to the discovery phase, where DNS exists. The pure-comfort set (`clear`,
`theme`, `author`, `xterm`, `bash`) becomes **one** small polish slice near ship. No "port the
remaining commands" story — that is the component split this epic exists to avoid.

**AMENDED 2026-09-02 at D10's grill.** The first half never fired: only `ping` (D1) ever landed
in a slice that needed it, so `find`, `whoami`, `strings`, `chmod` and `gpg` reached the end of
Phase 1 unclaimed — without D10 they would simply never ship. **D10 takes the whole tail**, and
the polish set loses `bash` (refused outright — see D10 decision 1). What survives of this decision
is its real point: there is still no "port the remaining commands" story, because the tail arrives
as five observable slices, not as a component sweep.

---

## What v2 already has (verified 2026-07-29 — do NOT re-port)

The substrate is in better shape than the command count suggests; much of it was built for
this work.

| Substrate | Where | Note |
|---|---|---|
| **Shell layer** | `core/shell/` | `tokenize`, `pipeline` (pipes), `runLine`, `complete`, `bindFlags`, history, prompt. **No `>>`** |
| **Binary/permission gating** | `core/commands/availability.ts` | `/bin` + `/usr/bin` + `/usr/sbin` search path, execute-perm gate, apt-install hint, **`/lib/*.so` library check already wired** |
| **Apt package catalog** | `core/commands/aptPackages.ts:26` | **Already lists every package this epic needs** — hydra, john, netcat, ftp, metasploit, snmp, mysql, redis-tools, lynx, apache2, nginx, gobuster, node, gpg. Names `extraFiles` as the seam that ships data files (→ `passwords.txt`) |
| **Service catalog** | `core/services/serviceCatalog.ts` | *"Adding a service is ONE row."* Currently one row (`ssh`), with `placement`/`altPorts`/`altPortChance` generation knobs already defined |
| **Pidfile model** | `core/services/pidfile.ts` | Pidfile presence ⇒ open port |
| **Tier-3 read allowlist** | `core/patches/readFilter.ts:61` | Already names `/var/www/**`, `/etc/snmp/snmpd.conf`, `/etc/switch/acl.conf`, `/var/lib/dpkg/status` — pre-wired for web, SNMP, and version scanning, with a TRIPWIRE for off-port CVEs |
| **Secrets codec** | `core/secrets/` | `secrets.ts` → `scripts/encode.ts` → `__encoded.ts`; `contentCodec.ts` (XOR+base64) |
| **Session kinds** | `core/commands/types.ts:32` | `SessionKind` already carries `'exploit'` and `'effect_one_shot'` — ported, unused |
| **Weak password pools** | `workstationFs.ts:51`, `remoteHostFs.ts:87`, `routerFs.ts:57` | Guest / NPC / AP-gateway pools exist; comments already anticipate *"a later hydra/wordlist epic"* |
| **Cross-player core** | [`cross-player-architecture.md`](../v2/docs/cross-player-architecture.md) | 3-tier read filter, L1/L2 write authz, `su`, traces — all `machine_id`-keyed and **protocol-agnostic** |

**`apt` currently has `install` + `list` only** (`core/commands/apt.ts`) — `upgrade`, `remove`,
and `pkg=<version>` pinning are net-new in the CVE phase.

## The delta (legacy → v2)

| Group | Missing commands |
|---|---|
| Web / HTTP | `curl`, `lynx`, `gobuster`, `apache2`, `nginx` |
| File transfer & shells | `scp`, `ftp` (+ FTP mode), `nc` connect + `nc -l` (+ NC mode) |
| Data services | `mysql`, `rediscli` |
| Credentials | `hydra`, `john`, wordlist system |
| Exploitation | `msfconsole` (remote, 8 effects) + `msfconsole --local` |
| Device management | `snmpwalk`, `snmpset` |
| Process / daemon control | `vsftpd`, `systemctl`, `ps`, `kill` |
| Recon | `ping`, `nslookup`, `dig` |
| Long tail | `find`, `whoami`, `strings`, `chmod`, `gpg`, `bash`, `clear`, `theme`, `author`, `xterm`, `node` |

**Missing subsystems**: HTTP request pipeline (`network/http.ts` — parse → DNS/NAT resolve →
handler-or-static `/var/www/html<path>`), DNS records, `world_networks` / themed networks +
`findit.io`, the wordlist system, dpkg status + service versions + version overlay, the
procedural CVE timeline (`publishedAt`/`patchDelay`), `apt upgrade`/pinning, scripting host.

---

## Phase plan

```
PHASE 1 — THE DOORS  (near-term focus)
  D1  web (apache2/nginx + generated pages + curl)     ✔ SHIPPED v0.109.0
  D1b lynx (browser screen)                           ✔ DONE — v0.125.0-v0.129.0, E2E 2026-08-14
  D1c gobuster (path brute-force)                     ✔ DONE — v0.123.0 + v0.124.0, E2E 2026-08-13
  D1d gobuster across networks                        ✔ DONE — v0.130.0, wire-check + E2E 2026-08-14
  D2  hydra + the wordlist system (+ john)             ✔ SHIPPED v0.111.0-v0.122.0
      D2.1 hydra vs an own-LAN NPC host                ✔ SHIPPED v0.111.0
      D2.2 not every account falls                     ✔ SHIPPED v0.113.0
      D2.3 the defender sees the sweep                 ✔ SHIPPED v0.114.0
      D2.5 john — the silent crack                     ✔ SHIPPED v0.115.0
      D2.4 cross-player hydra, all five slices        ✔ SHIPPED v0.119.0-v0.122.0
      D2.6a an appended word opens a door that held    ✔ SHIPPED #377 (tests only)
      D2.6b harvestable plaintext loot                 ⏸ POSTPONED — V2 owes the harvest route
  D3  ftp (the door)                                  ✔ COMPLETE v0.136.0 — all 6 slices
      D3 slice 1 the door + its own log                ✔ SHIPPED v0.131.0 (#393)
      D3 slice 2 login + a prompt you can leave        ✔ SHIPPED v0.132.0 (#394)
      D3 slice 3 looking around, without losing home   ✔ SHIPPED v0.133.0 (#395)
      D3 slice 4 get, itemised in the owner's log      ✔ SHIPPED v0.134.0 (#396)
      D3 slice 5 put, and the tier decides             ✔ SHIPPED v0.135.0 (#397)
      D3 slice 6 a stranger's door across the network  ✔ SHIPPED v0.136.0 (#398)
  D3b scp (the transfer)                              ✔ COMPLETE v0.139.0
      D3b slice 1 carry a file onto a box you hold     ✔ SHIPPED v0.137.0 (#401)
      D3b slice 2 take a file without being seen       ✔ SHIPPED v0.138.0 (#402)
      D3b slice 3 reach a stranger's box               ✔ SHIPPED v0.139.0 (#403)
  D4  daemon control (systemctl / ps)                 ✔ COMPLETE v0.142.0
      D4 slice 0 three commands become one             ✔ SHIPPED (#407, no bump)
      D4 slice 1 a defender shuts a door               ✔ SHIPPED v0.140.0
      D4 slice 2 a player sees what a box runs         ✔ SHIPPED v0.141.0
      D4 slice 3 every login gate asks one question    ✔ SHIPPED v0.142.0
  D5  nc connect + nc -l backdoor                     ✔ COMPLETE v0.151.0 (#415-#423)
  D5b machines get a kind, and it shows               ✔ COMPLETE v0.157.0 — all 5 slices
      D5b slice 1 a LAN reads as a population          ✔ SHIPPED v0.153.0 (#428)
      D5b slice 2 a name matches what it runs          ✔ SHIPPED v0.154.0 (#429)
      D5b slice 3 a box admits what it is              ✔ SHIPPED v0.155.0 (#430)
      D5b slice 4 the page a box serves fits the box   ✔ SHIPPED v0.156.0 (#431)
      D5b slice 5 the account you crack fits the box   ✔ SHIPPED v0.157.0
  D6  mysql                                           ✔ COMPLETE (v0.171.0)
      D6 slice 1 a box runs a database                ✔ SHIPPED v0.158.0 (#434)
      D6 slice 2 a player cracks a database account   ✔ SHIPPED v0.159.0 (#437)
      D6 slice 3 a player reads a database            ✔ SHIPPED v0.160.0-v0.162.0 (#438/#439/#440)
      D6 slice 4 a player changes a database          ✔ SHIPPED v0.163.0 (#441)
      D6 slice 5 a database on a deep layer answers   ✔ SHIPPED v0.166.0 (#442)
      D6 slice 6 a player runs their own database     ✔ SHIPPED v0.167.0 (#443)
      D6 slice 6b a generated box carries what it runs ✔ SHIPPED v0.168.0-v0.169.0 (#444/#445/#446)
      D6 slice 7 a player reaches another's database  ✔ SHIPPED v0.170.0-v0.171.0 (#447/#448)
  D7  redis-cli                                       ✅ SHIPPED (8 slices, v0.174.0-v0.182.0)
      D7 slice 1 a box runs a key-value store         ✔ SHIPPED v0.174.0 (#452)
      D7 slice 2 a player opens an unlocked store     ✔ SHIPPED v0.175.0 (#453)
      D7 slice 3 a player cracks a locked store       ✔ SHIPPED v0.176.0 (#454)
      D7 slice 4 a player changes a store             ✔ SHIPPED v0.177.0 (#455)
      D7 slice 5 a store on a deep layer answers      ✔ SHIPPED v0.178.0 (#457)
      D7 slice 5b a deep box's own journal is read    ✔ SHIPPED v0.179.0 (#458)
      D7 slice 6 a player runs their own store        ✔ SHIPPED v0.180.0 (#459)
      D7 slice 7a a player reaches another's store    ✔ SHIPPED v0.181.0 (#460)
      D7 slice 7b a neighbour's store, and the scan   ✔ SHIPPED v0.182.0 (#461)
      D7 follow-up  the daemon systemctl could not start ✔ SHIPPED v0.183.0 (#462)
      D7 follow-up  the three daemon tables get a guard  ✔ SHIPPED (#463, no bump)
      D7 follow-up  the real binary names, hyphens intact ✔ SHIPPED v0.184.0 (#464)
  D8  snmpwalk / snmpset                              ✔ COMPLETE v0.193.0 (11 decisions, 8 slices)
      D8 slice 1 a device answers SNMP                ✔ SHIPPED v0.185.0 (#465)
      D8 slice 2 a player walks it with `public`      ✔ SHIPPED v0.186.0 (#466)
      D8 slice 3 a player cracks the RW community     ✔ SHIPPED v0.187.0 (#467)
      D8 slice 4 a player opens a port, no shell      ✔ SHIPPED v0.188.0 (#468)
      D8 slice 5 a device on a deep layer answers     ✔ SHIPPED v0.189.0 (#469)
      D8 slice 6 a player runs their own agent        ✔ SHIPPED v0.190.0 (#470)
      D8 slice 7 a player reconfigures another's      ✔ SHIPPED v0.191.0 (#471)
      D8 slice 8 a player's own agent answers somebody ✔ SHIPPED v0.192.0-v0.193.0 (#472-#473)
  D9  node scripting                                 ✔ SHIPPED v0.196.0-v0.200.0 (#475-#480)
      D9 slice 1 a script runs and speaks             ✔ SHIPPED v0.196.0 (#475)
      D9 slice 2a a script runs the tools             ✔ SHIPPED v0.197.0 (#476)
      D9 slice 2b a script speaks while it works      ✔ SHIPPED v0.198.0 (#477)
      D9 slice 3 a script keeps what it found         ✔ SHIPPED v0.199.0 (#478)
      D9 slice 4 a script is reusable and can be stopped  ✔ SHIPPED v0.200.0 (#480)
  D10 polish (comfort commands + the whole long tail)  ✔ SHIPPED — all 5 slices (#481-#486)
      D10 slice 1 the terminal is yours               ✅ SHIPPED v0.201.0 (#481)
      D10 slice 2 the card and the second window      ✅ SHIPPED v0.202.0 (#482)
      D10 slice 3 the box answers questions  ✔ SHIPPED — find, strings
      D10 slice 4 permissions change hands   ✔ SHIPPED — chmod
      D10 slice 5 a file nobody else can read ✔ SHIPPED — gpg -c / -d
PHASE 2 — DISCOVERY
  X1  DNS + nslookup / dig                            ✔ SHIPPED — all 4 slices (#487-#490)
      X1 slice 1 a name resolves                      ✅ SHIPPED v0.206.0 (#487)
      X1 slice 2 a box answers as a name server       ✅ SHIPPED v0.207.0 (#488)
      X1 slice 3 the zone transfers                   ✅ SHIPPED v0.208.0 (#489)
      X1 slice 4 the transfer leaves a trace          ✅ SHIPPED v0.209.0 (#490)
  X2  findit.io + common website-bearing networks     GRILLED 09-26 (decisions 91-105, 6 slices)
      X2 slice 1 an institution has a website     ✔ SHIPPED v0.265.0-v0.268.0 (#551-#554)
        1a a publisher answers at its IP      ✅ SHIPPED v0.265.0 (#551)
        1b a domain resolves                  ✅ SHIPPED v0.266.0 (#552)
        1c the forward is a way in            ✅ SHIPPED v0.267.0 (#553)
        1d a bare address is a URL            ✅ SHIPPED v0.268.0 (#554)
      X2 slice 2 findit.io answers a search     ✔ SHIPPED v0.269.0-v0.270.0 (#555-#556)
        2a findit.io answers a search         ✅ SHIPPED v0.269.0 (#555)
        2b lynx submits a form                ✅ SHIPPED v0.270.0 (#556)
      X2 slice 3 a player's page is found      ✅ SHIPPED v0.271.0 (#557)
      X2 slice 4 findit falls and comes back   PLANNED 09-26 — one PR, v0.272.0 (plans/findit-falls-and-comes-back.md)
PHASE 3 — VULNERABILITIES                             GRILLED 09-09/09-10 + PLANNED (35 decisions)
      V slice 1 a version is visible          ✔ SHIPPED v0.210.0-v0.211.0 (#491, #494)
        1a every box carries a manifest       ✅ SHIPPED v0.210.0 (#491)
        1b nmap -sV prints the version        ✅ SHIPPED v0.211.0 (#494)
      V slice 2 a CVE is visible              ✔ SHIPPED v0.212.0 (#496)
      V slice 3 a door opens                  ✔ SHIPPED v0.213.0 (#497)
      V slice 4 the defender patches          ✔ SHIPPED v0.214.0-v0.215.0 (#498, #499) <- LOOP CLOSED
      V slice 5 six more effects              ✔ SHIPPED v0.218.0-v0.223.0 (#502-#507)
      V slice 6 the exploit crosses networks  ✔ SHIPPED v0.224.0-v0.230.0 (#508-#514)
      V slice 7 reboot evicts                 ✔ SHIPPED v0.231.0-v0.234.0 (#515-#518) <- V3 CLOSED
      V slice 8 libraries fall                ✔ SHIPPED v0.235.0-v0.243.0 (#519-#527)
      V slice 9 firmware falls                ✔ SHIPPED v0.244.0-v0.247.0 (#528,#529,#531,#532) <- CLOSED V4 and the V-SERIES
WORLD CONTENT — its own epic (plan retired; as-built doc) ✔ DONE v0.248.0-v0.264.0 (#533-#550) <- SHIP UNBLOCKED
────────────────────────── SHIP ──────────────────────────
POST-SHIP — MISSIONS
```

## Phase 1 — the doors

| # | Slice (actor + action + scope) | Includes | Defers | Acceptance examples |
|---|---|---|---|---|
| **D1** ✔ | **A player serves a web page and a stranger reads it** — SHIPPED | `apache2`/`nginx` daemons (pidfile → port, root for <1024); `SERVICE_CATALOG` http row + generation placement; generated page content (legacy `pools/web.ts`); `/var/www/html` in base FSs; `curl [-i]`; the request pipeline (parse → NAT/DNS resolve → static file); `access.log` trace; `ping` folds in. **A new server handler resolves (public IP, port, path)** — `resolveCrossPlayerFs` is keyed by a `machine_id` obtained from a login, and `curl` has no login | `lynx` (own slice, fast-follow — a full overlay browser screen, UI work of a different size); `gobuster` (→ D1c, which needs the `extraFiles` seam D2.1 builds); `-X POST`; request handlers; HTTPS specifics | B `curl http://<A pub IP>` → A's page, **with no session and no credential** (tier 3 already allows it); `nmap` shows `:80` on NPC hosts running http; A reads B's hit in `/var/log/access.log` |
| **D1b** | **A player browses a page instead of reading its source** | `lynx <url>` as a full overlay browser SCREEN (legacy carried `LynxBrowser.tsx` + `lynx/render.ts` + `lynx/fetch.ts`): render HTML to text, follow links, keyboard navigation, quit back to the terminal. Reuses D1 whole — `parseHttpUrl`, `resolveWebPath`, the own-LAN/public split, and the same `access.log` trace, so a browsed page is logged exactly like a curled one | Forms/POST; images; CSS; multi-tab | A player `lynx http://<host>` → the page renders as text with its links numbered → following a link fetches the next page → the target's `access.log` shows one line per page viewed |
| **D1c** ✔ | **A player finds the pages a server never linked** — **SHIPPED** as slice 1 (the sweep itself, v0.123.0, #378) and slice 2 (the defender's log, v0.124.0, #379), with the live close-out run 2026-08-13 as Act 8 of [`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md) | `gobuster <url>` + its `dirlist.txt`, shipped by the `extraFiles` seam **D2.1 shipped** (add a catalog row, no new mechanism); hits and misses both land in the target's `access.log`, so the defender's tell is the 404 wall D1 already records | Vhost/DNS modes; extensions | A player `gobuster http://<host>` → finds an unlinked path → `curl`s it; the target's `access.log` shows the sweep as a run of 404s with one 200 |
| **D1d** ✔ | **A player sweeps a stranger's server for pages nobody linked** — **SHIPPED** v0.130.0 | The public-IP half of D1c: `gobuster` today refuses a public host outright (`gobuster.ts:208` → `NOT_ON_YOUR_NETWORK`) while `curl` and `lynx` both reach one through `fetchPageAcrossNetwork` (`webPage.ts:115`). Reuses the D1b slice-3/7 doors whole, so the client-side shape is a swap of one refusal for the cross-network path; the target's `access.log` keeps recording the sweep server-side, under the server-derived source IP the cross-player writers already use | Vhost/DNS modes; extensions (as D1c) | B `gobuster http://<A pub IP>` → the same hits/misses a same-LAN sweep reports; A reads the run of 404s with one 200 in `/var/log/access.log`, sourced from B's home address, not from anything B sent |
| **D2** | **A player cracks a credential instead of being told it** — **✔ SHIPPED** as D2.1–D2.6a (v0.111.0–v0.122.0, #377); as-built in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1. **D2.6b (harvestable plaintext loot) is postponed** — see "Next action" | ~~`hydra <host> [service] [user]`~~ ✔; ~~`apt install hydra` ships `passwords.txt` via `extraFiles`~~ ✔; the two-pool split + per-account probability in `buildRemoteHostFs`; uncrackable pool into `secrets.ts`; wordlist-as-sole-gate; server-side md5 batch matching for cross-player; `john`; hydra trace on the target's `auth.log` | ftp/mysql/snmp as hydra *services* — each arrives with its door; **`gobuster`** (→ D1c, 2026-07-31) | B `hydra <NPC host> ssh` → cracks the user account → `ssh` succeeds; a low-probability NPC root cracks, most don't; a player's chosen root password never cracks; A appends a harvested password to `passwords.txt` via `nano` and a previously-failing crack now succeeds |
| **D3** | **A player moves files without a shell** — **ftp only; `scp` split out to D3b 2026-08-14** | `vsftpd` daemon + catalog row + placement; `ftp <host> [user] [pw]` + FTP mode command set (`get`/`put`/`ls`/`cd`/`lls`/`lcd`/`lpwd`/`quit`); `vsftpd.log` trace; ftp as a hydra service. **No content generator** — the target's FS is the content | Virtual users (`virtual_users.conf`); `scp` (→ D3b) | B `hydra`s ftp creds → `ftp <host>` → `get` a file → `put` one the owner then sees; the session authorizes at its tier through L1/L2 exactly as ssh does (decision 2) |
| **D3b** | **A player carries a file between two machines they hold** | `scp <src> <user>@<host>:<path> [port] [pw]`; the **transient** auth session (validate → transfer → end, legacy's `withTransientAuthSession`); two-endpoint resolution (local read + remote write through NAT/forwards); async progress + cancellation. Closes D2.5's named gap — **carrying a grown wordlist onto a rooted box** | FTP mode (D3's); recursive `-r`; directory transfer — decide at planning | A `scp /usr/share/wordlists/passwords.txt root@<NPC host>:/root/` → sweeps from that box with a list the shipped wordlist does not hold; a tier the credential does not carry refuses the write |
| **D4** ✔ | **A defender controls what their box exposes** — **✔ SHIPPED** as slices 0–3 (#407–#410, v0.140.0–v0.142.0); grill record in ["D4 — resolved scope & decisions"](#d4--resolved-scope--decisions-grill-me-2026-08-16), as-built in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7/§9 and [`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md) Act 13 | `systemctl start/stop/status/restart` + `ps`, sharing ONE implementation with the shipped `sshd`/`vsftpd`/`nginx` commands (collapsed first, slice 0); symmetric pidfile open/close; runs anywhere you stand; the two login-gate fixes (`ssh` exemption + same-LAN service check) | `kill` and session **eviction** (→ D5, where a planted backdoor is worth killing); `chmod` (independent capability, out of the epic row); `enable`/`disable`; a service-state log | A `systemctl stop sshd` → pidfile gone → B's scan drops `:22` and ssh-via-forward `404`s; A `ps` lists what is running; A restarts it and reachability returns |
| **D5** ✔ | **A player plants a backdoor and re-enters through it** — **✔ SHIPPED** as slices 0–8 (#415–#423, v0.143.0–v0.151.0); grill record in ["D5 — resolved scope & decisions"](#d5--resolved-scope--decisions-grill-me-2026-08-16), as-built in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7/§9 and [`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md) Acts 14-15 | `nc <host> <port>` → restricted NC shell (no PATH); `nc -l <port>` listener with owner metadata in the pidfile; **backdoor chain forwarding** — append a `forward` on every gateway out to the public edge and report the reachable address | Exploit-planted backdoors (Phase 3) | B (inside a host) `nc -l 4444` → forward auto-appended → B leaves, `nc <public IP> <fwd>` → lands as the listener's owner; the defender greps `rules.v4` and finds the breadcrumb |
| **D5b** ✔ | **NPC machines have a kind, and it shows** — **✔ SHIPPED** as slices 1–5 (#428–#432, v0.153.0–v0.157.0); grill record in ["D5b — resolved scope & decisions"](#d5b--resolved-scope--decisions-grill-me-2026-08-18), close-out in ["D5b — what shipped"](#d5b--what-shipped-and-what-it-deliberately-did-not-do-closed-2026-08-19-v01570), as-built in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7 | A real role model, widening `LanHost.kind` (today `'machine' \| 'router' \| 'switch'`, `generateHomeLan.ts:31`) toward legacy's nine — webserver, database, mailserver, fileserver, iot, dns, switch, router, workstation; role-driven hostnames (today `DEVICE_TYPES` is consumer devices — `desktop-7`, `iphone-12` — and golden-locked at `homeNetwork.ts:30`); **role-weighted service placement** (a database box almost always runs mysql; a phone almost never runs nginx); role-keyed content pools, starting with the web pages D1 ships flat | Mission-specific roles (post-ship) | `nmap` a LAN and the boxes read as a *population*: `web-04` serves nginx and a corporate portal, `db-11` runs mysql, `cam-31` is an IoT box with a camera panel. A player can tell what a box probably is before touching it |
| **D6** | **A player reads a machine's database** | `mysqld` catalog row + placement; **generated schema + data** (legacy `generateDatabase.ts`, `pools/database.ts`); `mysql <host> <user> [pw]` → `mysql>` prompt (parser/formatter/executor); hydra `mysql` service | Writes/`UPDATE` — decide at planning | B `hydra <host> mysql` → creds → `SHOW TABLES` / `SELECT` returns generated data worth reading |
| **D7** ✅ | **A player reads a machine's key-value store** — **SHIPPED v0.174.0-v0.182.0 (#452-#461)**; twelve locked decisions in ["D7 — resolved scope & decisions"](#d7--resolved-scope--decisions-grill-me-2026-08-24) | `redis` catalog row + placement (flat 0.05, webserver 0.35, database 0.3); generated data (`generateRedisData.ts`, `pools/redis.ts`); `rediscli <host> [pw]` → `redis>` sub-shell, seven verbs; `requirepass` as an md5 in the root-only datadir; hydra `redis` service against the 60% that are locked | Redis 6 ACLs (they arrive as a VERSION difference in Phase 3, not as a door decision); `FLUSHALL`; `CONFIG GET`; `TYPE`/`SCAN`/`INFO` | B `rediscli <host>` → `KEYS *` / `GET` on the 40% that are open; `hydra <host> redis` → password (no login field) on the rest; an open store's arrival line is the defender's whole view |
| **D8** ✅ | **A player reconfigures a device without holding a shell on it** — **SHIPPED v0.185.0-v0.193.0 (#465-#473)**; eleven locked decisions in ["D8 — resolved scope & decisions"](#d8--resolved-scope--decisions-grill-me-2026-08-27), as-built in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7/§9 | `snmp` catalog row at `161/udp` (a new `protocol` column) placed on routers + switches only; `snmpwalk <host> [community]` (public = identity, RW = + the port table); `snmpset <host> <community> <oid=value>` with parity to `nano`; **the OIDs are a VIEW over the `rules.v4` / `acl.conf` v2 already parses**, never a second copy; the RW community as an md5 in a root-only file, swept by `hydra snmp` via `secretOn`; its own `/var/log/snmpd.log`; `snmpd` installable, planting a `deny <port>` local firewall on a workstation | legacy's `snmpFirewallParser` / `snmpAclParser` and the `firewall*`/`acl*` OIDs inside `snmpd.conf` — REFUSED, not deferred: they are a third and fourth authority over a fact v2 already owns; `nmap -sU`; NAT on a workstation | B `snmpwalk` with `public` → identity only; B cracks the RW community → the forward table renders as OIDs → `snmpset` opens a port **without B ever logging in**, and A's `snmpd.log` names B |
| **D9** ✅ | **A player automates an attack with a script** — **SHIPPED v0.196.0-v0.200.0 (#475-#480)** as slices 1, 2a, 2b, 3 and 4; eleven locked decisions in ["D9 — resolved scope & decisions"](#d9--resolved-scope--decisions-grill-me-2026-09-01) plus six more made at slice 4, as-built in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §2/§4/§7/§9 | `apt install node` → `node <path> [args]`; ONE always-async mode (`execute` returns a promise, so legacy's sync mode cannot port); every command as a camelCase global returning `string[]` with `.exitCode`; a trailing flags object with dashed keys; ambient `fs` (`readFile`/`writeFile`/`appendFile`); `console.log`; real `process.argv`; `sleep(ms)`; Ctrl-C at every await | **programmatic auth — REFUSED, not deferred** (`env` is a per-line snapshot, so a script that hopped would answer about the box it left); `chmod`; world content and an example script; an `sh()` escape hatch; a Web Worker sandbox; `script_exec` as a CVE effect (Phase 3) | A writes `/root/sweep.js` chaining `hydra` across many hosts, runs `node /root/sweep.js`, and captures the results to a file; `ssh(…)` from a script refuses in the same words the prompt would |
| **D10** ✅ | **The terminal feels like legacy's** — **SHIPPED COMPLETE v0.201.0-v0.205.0 (#481-#486)**, all five slices; fifteen locked decisions in ["D10 — resolved scope & decisions"](#d10--resolved-scope--decisions-grill-me-2026-09-02); five slices, not one | `clear` (banner + scrollback, Ctrl-L) via a new `env.clearScreen()`; `theme` — legacy's four palettes over the eight tokens v2 paints, `localStorage`-persisted and applied pre-render; `author` as a third `ModeChange` overlay; `xterm` opening a genuinely FRESH tab (skips hop rehydration); `whoami`; **plus locked decision 9's whole long tail** — `find` (legacy's positional shape), `strings`, `chmod` (read-modify-write, write-tier authz, no `-R`) and `gpg -c`/`-d` (legacy's codec keyed by md5, masked prompt, `.gpg`). `clear`/`whoami` join `SYSTEM_UTILITY_NAMES` | **`bash` — REFUSED, not deferred** (it ran binaries by path for a PATH-less NC shell v2 does not have, and `availability.ts` already resolves the search path and the execute bit); world content for `strings`/`gpg` (the loot rule owns it); a perms-only patch state; `chmod -R`; legacy's six unpainted theme tokens; a renderable `TerminalLine` kind | A player clears the screen, switches to green phosphor and it survives a reload; `author` opens the card and ESC returns; `xterm` from inside an ssh hop lands on the player's OWN box; `chmod` opens a root-only file to their tier and the change survives a reload; `gpg -c` leaves an intruder holding root with nothing readable |

## Phase 2 — discovery

| # | Slice | Includes | Acceptance |
|---|---|---|---|
| **X1** ✅ | **A player resolves a name to an address** — **SHIPPED v0.206.0–v0.209.0 (#487–#490); all four slices closed.** Grilled 2026-09-04, fourteen locked decisions in ["X1 — resolved scope & decisions"](#x1--resolved-scope--decisions-grill-me-2026-09-04); four slices | `apt install dnsutils`; the AP gateway as every network's resolver (its own LAN) + an occupant fallback; a name accepted anywhere an address is, through ONE shared client-side resolve step; a `dns` catalog row at `53/tcp` with `named` on the rare (3%) dns-role box; generated `named.conf` (`allow-transfer` open ~3 in 4) and a zone file spanning the WHOLE network — Layer 1's servers and infrastructure plus every deep layer; `nslookup`; `dig` + `dig @<server> axfr` reading that file as the authority; `/var/log/named.log` on transfers | Public/world domains (→ X2, which inherits a per-network name to index); a zone authoritative for RESOLUTION (poisoning `ssh`) — refused, it needs a round-trip per lookup; occupants in the zone; MX/CNAME/TXT; `dig -x`; `host`; dual-protocol port rows | `nslookup web-04` → IP on any network, and `ssh root@web-04` lands without the player ever reading an address; `nmap` finds `53 open` on `ns-12`, `dig @192.168.4.12 axfr` returns the zone — including `10.x` hosts on layers behind gateways the player has never rooted — and the box's `named.log` names them for whoever roots it next |
| **X2** | **A player finds a network they were never told about** — **GRILLED 2026-09-26, un-deferred ahead of the ship gate: fifteen locked decisions (91–105) and a six-slice spine in ["X2 — resolved scope & decisions"](#x2--resolved-scope--decisions-grilling-2026-09-26).** Supersedes the Includes cell (no `world_networks`; publishers are catalog networks) | `world_networks` + themed-network registry; **common networks that run websites** (the owner's shape — they are findable *because* they serve something); `findit.io` search handler over peer networks' metadata; registration/indexing | `curl "http://findit.io?q=<term>"` → ranked results → `nmap` that network → real ports. The player never learned the address out-of-band |

## Phase 3 — vulnerabilities

| # | Slice | Includes | Acceptance |
|---|---|---|---|
| **V1** ✅ | **A scanner reads what version a service runs** — **GRILLED**, delivered as slices 1-2; **SHIPPED v0.210.0-v0.212.0 (#491, #494, #496)** | `/var/lib/dpkg/status` generated on every box (services + the 8 libraries + firmware on routers); `nmap -sV` VERSION column; `WORLD_EPOCH` + each package's first publication + the severity roll (the forward walk moved to slice 4); a CVE id and severity on a live one | `nmap -sV <host>` → real versions; the world is clean for ~3 days, then CVEs start landing; tier-3 readable (already allowlisted) |
| **V2** ✔ | **A player breaks in with no credentials** — **GRILLED**, delivered as slices 3, 5, 6; **slice 3 SHIPPED v0.213.0 (#497)**, **slice 5 SHIPPED v0.218.0-v0.223.0 (#502-#507)** and **slice 6 SHIPPED v0.224.0-v0.230.0 (#508-#514)** | `msfconsole <host> <port> [arg]`; all 8 effect kinds; the exploit session row; the `formatExploit` catalog column tracing BOTH outcomes; **server-side CVE recomputation** through the one shared module the client renders from | B finds a vulnerable version → `msfconsole` → `shell_full` with no password; a patched version refuses and the target logs the bounce |
| **V3** ✅ | **A defender patches and the exploit goes inert** — **GRILLED**, delivered as slices 4 and 7; **slice 4 SHIPPED v0.214.0-v0.215.0 (#498, #499)** and **slice 7 SHIPPED v0.231.0-v0.234.0 (#515-#518)**; `pkg=<version>` pinning moved to the attacker slices by decision 39 and **SHIPPED there at v0.229.0 (#513)**, with the trace it needed at v0.230.0 (#514) | `apt upgrade [pkg]`; `apt list -u` with the ETA status; `apt install pkg=<version>` downgrade-only; install sharing the upgrade resolver; `reboot` ending every session on the machine | A upgrades → B's working exploit now fails; inside the delay window A is told no fix exists; A reboots and B's shell drops |
| **V4** ✅ | **A player escalates locally through a vulnerable library** — **GRILLED**, delivered as slices 8 and 9; **slice 8 SHIPPED v0.235.0–v0.243.0 (#519–#527)** and **slice 9 SHIPPED v0.244.0–v0.247.0 (#528, #529, #531, #532)**, closed out 2026-09-21 — this row and the whole V-series are CLOSED; as-built in `### Phase 3 slice 8` and `### Phase 3 slice 9` near the end of this file, both plan files deleted | Library timelines; `ldd`; `msfconsole --local`; the syslog trace; the extended dependency map + its effect pools; `metadata.libraryLinks` deleted; firmware as the third axis, its severity contest with the service, and `sysDescr` naming the firmware a walk reports | B (guest) `msfconsole --local su` → root without the root password; `ldd /bin/su` shows the vulnerable lib; A upgrades to close it. **Slice 9**: a gateway whose every service scans clean still falls to `msfconsole <gw> 22`, through the firmware its manifest names and `snmpwalk` reports |

**Phase 3 is GRILLED — twenty-three locked decisions and a nine-slice spine** in
["Phase 3 — resolved scope & decisions"](#phase-3--resolved-scope--decisions-grill-me-2026-09-09).
The V1-V4 rows above are kept as the acceptance statement; the **spine is the nine slices**, which
cut across them (V2's effect set alone spans three). Ordered **loop-first** so the attack → patch →
inert cycle is provable at slice 4 rather than slice 6.

**One cross-cutting fix sits beside the spine, not in it.** The **own-LAN scan fix** ✅ **SHIPPED
v0.216.0–v0.217.0 (#500, #501)** — `nmap` resolved the player's own LAN from seeded trees while a
public-IP scan replayed the target's journal, so a box that had been patched, bricked, backdoored,
filtered or shut scanned as the box the world shipped. Open since D5; slice 4's browser run exposed
its fourth face and ended the deferral, because that face lies about the VERSION and CVE columns and
so contradicts the very loop Phase 3 exists to build. Decisions 40-43, as-built at the end of this
file.

**D2.6b's postponed job is discharged by decision 21**: `password_reset` overwrites any account
including a player's chosen root, so it is the route by which a player obtains a plaintext they did
not already hold. See "Next action" for why `/etc/passwd` does not count.

**D5b landed before D6** ✔ (v0.157.0), as this ordering required (placement was recommended, not
locked): role-weighted placement is what makes "find a database box" mean something, rather than a
flat probability sprinkling mysql across a LAN of phones. It also had to land **before ship** — it
re-rolls the generated world, and the no-backward-compat licence sunsets at multiplayer announce.
D6 therefore arrives to a `database` role that already has a placement cell waiting for `mysqld`.
Every earlier door stays role-agnostic, so D5b is additive to all of them: it changes which
content and services get picked, never the shape of what is stamped or how a door authorizes.

---

## D3 — resolved scope & decisions (grill-me, 2026-08-14)

D3 was interrogated with `grill-me` after `scp` was split out to D3b. Nine decisions, each
grounded in code first. They feed straight into `planning`.

**What grounding changed before a single question was asked**: the split's phrase "FTP mode
command set" reads as a UI item, and it is not. Legacy's `useFtpCommands.ts` swaps in an
11-command map (`pwd`/`lpwd`/`cd`/`lcd`/`ls`/`lls`/`get`/`put`/`help`/`quit`/`bye`) carrying
**two live machines at once** — a remote machine+cwd+tier and an origin machine+cwd+tier. v2 has
never held two. Everything in `ui/state.ts` is singular and follows `activeSession()`:
`patchClientDeps`, `patchApi`, `patches()`, `servedRoot`, `activeRoot`. **That, not the command
count, is what D3 costs.**

### Locked decisions

1. **FTP mode is a terminal sub-shell, not an overlay screen.** The prompt becomes `ftp>` and
   `executeLine` dispatches to a restricted command map while an `ftpSession` signal is set;
   scrollback, history, Ctrl-C and completion are inherited rather than rebuilt. `nano` and `lynx`
   are overlays because an editor and a hypertext browser need custom rendering — a line-oriented
   sub-shell needs a terminal, which already exists. `OverlayMode` (`state.ts:224`, narrowed to
   `'nano' | 'lynx'`) is untouched, and `state.ts:1069` keeps dropping unhandled mode kinds.
   **This sets the pattern for `nc`, `mysql` and `redis`** — three more prompt modes behind it.
   `ModeChange { kind:'ftp' }` carries only `{ target: { ip } }` today and predates everything the
   door needs; reshape it (no backward-compat burden pre-launch).
2. **The ftp session is PARALLEL to the hop chain, not pushed onto it.** A real `sessions` row at
   `kind:'ftp'`, held in its own signal; the player keeps standing where they stood. A stack has
   one top and ftp needs origin and remote live simultaneously, so a push would force `lls`/`lcd`
   to reach *down* the stack and would make `exit` ambiguous. Schema-legal: `session_id` is the PK
   and the active index is on `(player_key, machine_id, created_at)` — **no uniqueness constraint**,
   so a parallel session on a machine the player also holds an ssh hop on is fine.
3. **The transfer runs CLIENT-side through two patch bindings.** `get` = read the remote tree,
   write the origin; `put` = read the origin, write the remote — both through the **shipped**
   `upsertPatch`. `authorizeMachineAccess` is **kind-agnostic** (it looks up `(player_key,
   machine_id)` with no kind filter), so the ftp row satisfies L1 exactly as an ssh row does, and
   L2 runs the walker at the session's tier. **This is decision 2 of the epic made concrete: the
   door adds no authorization dimension.** A server-side copy endpoint was rejected — it would
   duplicate the write path, add a second authorization site, and still need the remote tree
   client-side for `ls`/`cd` anyway. Cost is a second journal + `servedRoot` signal;
   `resolveActiveRoot` already takes everything as parameters and needs no change.
4. **`ftp` catalog row: `placement` 0.30, `altPorts` [2121], `altPortChance` 0.2, pidfile
   `vsftpd.pid`, port 21, `runUser` root** — level with `http`, below `ssh`'s 0.40. Rolls are
   independent per service in `hostServices` (`remoteHostFs.ts:96`), so on an 8-host LAN expect
   ~2.4 hosts running ftp and **~1.4 reachable only by ftp** — a box hydra's ssh sweep cannot open.
   `vsftpd` joins `SYSTEM_DAEMON_NAMES` in `/usr/sbin` alongside `sshd`, which `binaries.ts:85`
   already parks it next to, so a rooted box can bring the door up. The **client** stays apt-gated:
   `{ name: 'ftp' }` is already in `APT_PACKAGES`. The codebase already has the real-world
   asymmetry right — `scp` ships pre-installed in `/bin` (it comes with openssh), `ftp` does not.
5. **`vsftpd.log` records logins AND transfers, in vsftpd's own format.** Not syslog: a daemon
   writing its own file is exactly why `access.log` broke from syslog, and the same applies here.
   ```
   Fri Aug 14 13:55:31 2026 [pid 4471] CONNECT: Client "10.0.0.9"
   Fri Aug 14 13:55:34 2026 [pid 4471] [guest] FAIL LOGIN: Client "10.0.0.9"
   Fri Aug 14 13:55:38 2026 [pid 4471] [guest] OK LOGIN: Client "10.0.0.9"
   Fri Aug 14 13:56:02 2026 [pid 4471] [guest] OK DOWNLOAD: Client "10.0.0.9", "/etc/passwd", 1243 bytes
   Fri Aug 14 13:56:20 2026 [pid 4471] [guest] OK UPLOAD: Client "10.0.0.9", "/tmp/x.sh", 88 bytes
   ```
   **Accepted deliberately: this makes ftp the LOUD door.** Reading a file over ssh is silent — no
   command logs a `cat` — so the same theft is invisible through one door and itemised through the
   other. That is what real FTP does, and it is the fair price of ftp being a second way in: the
   defender learns *what* was taken, which is a signal ssh cannot give. `formatSyslogTimestamp` is
   not reusable here (different date shape), but `MONTHS` is, exactly as `access.log` shares it.
6. **Pivot-aware from day one** — `ftp` carries `caller_machine_id`, joining `hydra` and
   `gobuster` on the honest side of §9's split rather than becoming the fifth tool that stamps the
   actor's home. Nearly free by D1d's finding: authorizing the caller's machine yields their
   session, and `resolveVantageSourceIp` already takes `{ actorKey, standingEssid }`. Nothing has
   shipped to correct, so this costs a decision rather than a migration. Keeps D2.4's rule — a
   false address in a defender's log is worse than a refusal.
7. **hydra's trace routes BY SERVICE.** `hydraCrack.ts` is already service-generic — `:212` matches
   `payload.service` against the pidfile-derived service name, so `hydra <host> ftp` works the
   moment the catalog row exists — but `:136` hardcodes `AUTH_LOG_PATH`, so an ftp sweep would
   write ~110 **sshd-tagged** lines to `auth.log` for a door nobody knocked on, while the break-in
   itself landed in `vsftpd.log`. The wall and the entry must be in one file or decision 5's whole
   point is lost. `SERVICE_CATALOG` grows a logging column (path + formatter); **`mysql`, `redis`
   and `snmp` inherit the seam.**
8. **Cross-player is IN, as D3's final slice** — not a follow-up. Unlike hydra (five slices) the
   machinery is shipped and reused unchanged: `machineServing` routes **purely by port**
   (`machineServing.ts:31`), so a `forward 2121 to <ws>:21` reaches vsftpd with no change;
   `resolveCrossPlayerFs` is keyed by a `machine_id` any login yields; `upsertPatch`'s L1/L2 are
   kind-agnostic. "Protocol is UX, tier is truth" is what makes this cheap — the server never
   checks which protocol knocked.
9. **A refresh ENDS the ftp session; it does not restore the mode.** `rehydrateSessions`
   (`state.ts:562`) replays **all** active rows through `rehydrateSessionStack` as a stack with no
   kind filter, so an active `kind:'ftp'` row would come back as a *hop* — precisely the pushed
   model decision 2 rejected. Filter to stack kinds (`ssh`/`su`) and end any active ftp row with a
   reason. Two reasons beyond the trap: `remoteCwd`/`originCwd` have no schema home and persisting
   them is a migration for a foreground app, not a place you stand; and an abandoned active ftp row
   is a **silent write grant** on someone else's box that L1 keeps honouring, since sessions have
   no TTL.

### Slice spine (each vertical + observable; walking skeleton first)

> **SHIPPED 2026-08-15, v0.131.0 → v0.136.0 (#393–#398).** The spine below was delivered as
> **six** PR-sized slices (D3.2 and D3.3 were two PRs each); the plan file is deleted and the
> as-built lives in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1 (D3)
> and §7 (the invariants it established). Nothing here was re-decided. Planning grounding added
> two findings that changed the work and both held: the ftp session is parallel, so the **origin
> binding already existed and only the remote one was new**, and **`put`, not `get`, is where
> decision 3's claim got proven** (`get` writes to your own box; only `put` asks an ftp row to
> satisfy L1). The live two-player run is Act 11 of
> [`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md).

- **D3.1 — the door exists, and sweeping it is recorded.** Catalog row + `vsftpd` command
  (mirrors `sshd`: root gate → already-running → port → streamed pidfile write) + the `vsftpd.log`
  formatter + hydra's service-routed trace. **No client mode at all.** *Observable*: `nmap` shows
  `:21` on LAN hosts; `hydra <host> ftp` returns creds; the target's `vsftpd.log` holds the FAIL
  wall and the OK LOGIN. **The ordering is the design, per D2's lesson** (the wordlist read landed
  before the gate so no shipped version showed a list the sweep denied existed): the catalog row is
  what makes `hydra <host> ftp` work, so decision 7's routing must land in the SAME slice or a
  shipped version writes sshd-tagged lines for a door nobody knocked on.
- **D3.2 — a player logs in and looks around.** `ftp <host> [user] [pw]`; `authCreateSession`
  parameterized on kind (it hardcodes `'ssh'` at `:54` and `:211`); the parallel session; the
  sub-shell (`pwd`/`ls`/`cd`/`help`/`quit`/`bye`); the remote binding; login traces; decision 9's
  refresh filter. *Observable*: `230 Login successful` → `ls` their files → `quit`.
- **D3.3 — a player takes a file and leaves one.** `get`/`put` + the origin binding +
  `lpwd`/`lcd`/`lls` + the DOWNLOAD/UPLOAD traces. *Observable*: `get /etc/passwd` → `john` it;
  `put` a file the owner then sees. **This is where ftp pays into the shipped credential layer** —
  unlike the web door, ftp has real content on day one because the base FS *is* the content.
- **D3.4 — a player reaches a stranger's door.** Public IP through a NAT forward. *Observable*: A
  forwards `2121→ws:21`; B sweeps, logs in, takes `/etc/passwd`, and A reads B's real address out
  of `vsftpd.log`.

### Open for planning (named, deliberately not decided)

1. **Anonymous ftp** — assumed OUT (every login checks a real `/etc/passwd` account), consistent
   with the row deferring `virtual_users.conf`. Confirm at D3.2.
2. **Where `vsftpd.log` is seeded.** `access.log` exists only where http is served
   (`remoteHostFs.ts:155` gates `/var/www/html` the same way); matching that means gating on the
   ftp service, which interacts with `appendMachineLog` creating an absent file anyway. Decide at
   D3.1.
3. **`get` onto an existing origin file** — overwrite silently, or refuse.

**Not open**: `/var/log/vsftpd.log` is tier-2 like `auth.log`/`kern.log` — NOT added to the tier-3
allowlist. You must get in to read it, which is the same rule the other trace files hold.

---

## D3b — resolved scope & decisions (grill-me, 2026-08-14)

Grilled straight after D3, same day. **D3b is the smaller half despite legacy building it larger**
(417 lines against ftp's 218), because it INHERITS: kind-parameterized `authCreateSession` from
D3.2 and the remote patch binding from D3.3. `scp` is also already in `/bin`
(`generation/binaries.ts`) — it ships with openssh, exactly as in life, so there is no availability
or apt work. The command simply does not exist behind the binary yet.

Two things are forced rather than chosen, and planning should not re-litigate them:

- **The transient session is not a design choice.** `upsertPatch`'s L1 requires an active
  `sessions` row on the target, so create → transfer → end is the only shape that can write at all.
- **scp reaches exactly what `ssh` reaches** — it auto-detects the open ssh service port, so a box
  with sshd down is refused no matter what else it runs.

### Locked decisions

1. **Both directions.** Whichever operand matches `user@host:path` is the remote side; the other is
   local. Legacy was **upload-only** (`parseDestination` only ever parsed argument 1), which was a
   limitation rather than a design. Upload closes D2.5's wordlist-carry gap; download is the
   **silent harvest** — the counterpart to ftp's `get`, which D3 decision 5 made itemise every byte.
2. **The trace is a login line only, indistinguishable from an interactive ssh login.** One
   `Accepted password for <user> from <ip>` through the shipped `formatSshdAuthLine`; no line names
   the file. Real sshd logs the auth before it ever knows the session is a copy. **Accepted
   consequence, stated so it is not read as an oversight: scp DOMINATES ftp for exfiltration once
   you hold ssh creds.** That is the intended specialisation — ftp is easier to OPEN (its own
   `placement`, crackable without ssh) and itemises what moves; scp needs credentials you already
   earned and takes the file in silence. Two doors, two costs.
3. **Announce, then one final line — no rewriting progress.** `Connecting to <host>...` paints while
   the round-trip is pending, then scp's completed line lands once
   (`passwords.txt   100%  1243 bytes`). A live in-place progress bar is what real scp does and it
   is exactly what `streaming.ts` rules out: an append-only terminal cannot rewrite a line, which is
   the same reasoning that killed the `Done` marker. `100%` is truthful at the moment it prints.
   **Ctrl-C unwinds before the single atomic `upsertPatch`, so a partial file cannot exist by
   construction** — no cleanup path to get wrong.
4. **Cross-player IN; remote-to-remote and `-r` OUT.** scp rides ssh and `machineServing` routes by
   port, so reaching a stranger through a NAT forward is nearly free — consistent with D3 including
   cross-player rather than deferring it. **Deferred and named**: `scp root@A:/f root@B:/g` (two
   transient sessions in one command, letting loot move between two compromised boxes without ever
   touching the player's own — a laundering move worth its own slice, and genuinely interesting
   given decision 2's silence), and `-r` for directories.
5. **`-p` takes the port, matching v2's `ssh` — a DELIBERATE divergence from real scp.** Real scp
   uses `-P` and reserves `-p` for preserve-times. Recorded as a named divergence because it is the
   one place this epic bends its own realism principle for internal consistency, and a future
   reviewer citing that principle would otherwise "fix" it back. **The cost is accepted**: a player
   who knows real scp is surprised, and preserve-times can never have its real name. (`-P` as an
   additional alias stays free if it is ever wanted.)

### Folded in as routine (recorded so they are not re-decided)

- **scp does NOT create missing parent directories** — real scp errors, and both `mkdir -p` and
  `apt` already cover the gap (`apt.ts:168` walks `ancestorsOf` and mkdirs each level).
- **Overwrite is silent**, as real scp is.
- **`SessionKind` gains `'scp'`** — provenance only; tier stays the truth (epic decision 2).
- **The source is validated BEFORE connecting**, so a typo'd filename never reaches the target's
  log. Keeps D2.3's guardrail: log only once a credential was actually checked.
- **The "local" side is the box you are STANDING on**, not the player's workstation — *tools run
  where you stand* (D2.5's locked principle).
- A directory as source errors `scp: <path>: Is a directory`, as legacy did, until `-r` lands.

### Why the carry matters (the question planning will otherwise ask)

*Why carry a wordlist at all, rather than sweep from home?* **Reachability.** D2.4 slice 5 shipped
deep-chain hydra, so the boxes worth sweeping are often ones the player's home box cannot reach
directly. The carry is what turns a rooted box into a usable pivot:

```
ssh root@<npc>              a box you rooted, fronting a deep layer
apt install hydra           creates /usr/share/wordlists/ (apt walks ancestorsOf)
scp ~/passwords.txt root@<npc>:/usr/share/wordlists/passwords.txt
hydra -p <fwd> <inner gw>   sweeps with words the shipped list does not hold
```

**The `apt install` step is load-bearing, not filler.** A generated NPC box's `/usr` holds only
`bin` and `sbin` (`remoteHostFs.ts:189`) — there is no `/usr/share/wordlists/`, which is exactly
where `WORDLIST_PATH` points. Without that step (or a manual `mkdir -p`) the scp fails on the
missing containing directory, and the acceptance would have been written against something
impossible. Grounding caught this; do not drop the step from the criterion.

### Slice spine (each vertical + observable)

- **D3b.1 — a player carries a file onto a box they hold.** ✔ SHIPPED v0.137.0 (#401). Upload,
  own-LAN: the transient session (create → write → end), source-first validation, decision 3's UX,
  `-p`. *Observable*: the carry above — a sweep succeeds from the pivot with a word the shipped
  `DEFAULT_WORDLIST` does not hold. (That E2E run itself lands in slice 3, with the wire-check.)
- **D3b.2 — a player takes a file without being seen.** ✔ SHIPPED v0.138.0 (#402). Download.
  *Observable*: `scp root@<host>:/etc/passwd ./` → `john` it; the target's `auth.log` shows a
  login and **nothing about the file**, set against ftp's transfer record for the same theft —
  asserted with one ledger watching both doors, so the silence is measured, not assumed.
- **D3b.3 — a player reaches a stranger's box.** ✔ SHIPPED v0.139.0. Cross-player, both
  directions, through a NAT forward — and client-only, because D3.6 had already made the public
  login kind-parameterized. *Observable*: Act 12 — B carries a wordlist onto A's box through A's
  ssh forward, takes it back, and A's `auth.log` holds four logins that name no file.

### Open for planning — RESOLVED 2026-08-15 at planning, and both shipped as decided

1. **An existing active session on the target** — reuse it, or always create-and-end? **Always
   create-and-end**: the row's lifetime stays exactly one command, and reuse would make `scp`
   behave differently depending on invisible state. A second `Accepted password` line when the
   player already holds a session there is truthful, and is what real sshd does.
2. **`-P` as an alias** for `-p` — **not shipped**. An alias nobody can observe in-game has no
   test that can fail; free to add later, and decision 5 makes `-p` canonical regardless.

---

## D4 — resolved scope & decisions (grill-me, 2026-08-16)

**Scope: `systemctl start/stop/status` + `ps`. Nothing else.** `kill`, session eviction and
`chmod` are all named below as living elsewhere — the epic's original D4 row bundled four
capabilities, and three of them are not this door.

D4 is the defender's half of everything Phase 1 has shipped: D1, D3 and D3b opened three doors
and **nothing in the game can close one**. But the grill's first finding reframes the size of it.

### Grounding that reshaped the scope before any decision

Five things the code says that the epic row could not have known:

1. **The "start" half already ships — three times over.** `sshd.ts` (128 lines), `vsftpd.ts`
   (117) and `webServer.ts` (148) are one module written three times: a diff of the first two
   shows they differ *only* in which `SERVICE_CATALOG` row they bind and their prose.
   `vsftpd.ts` says so outright — "Deliberately a mirror of `sshd`". So D4 is **stop + a
   reduction**, not "add daemon control".
2. **`ps`, `kill` and `chmod` are already planted binaries that do not run.** They sit in
   `BASE_BINARIES`, so `ls /bin` lists them and typing one says `command not found`.
   `systemctl` is in **no** binary list — one comment calls it "deferred to later slices".
3. **The `ssh` listening exemption is narrower than §9 claims, and the real gap is elsewhere.**
   The client already gates (`ssh.ts:307` refuses when the pidfile port does not match), and
   the public and same-LAN endpoints gate with no kind exemption — so **stopping sshd already
   locks strangers out cross-player**. §9's stated consequence (a router with `hasSsh: false`)
   is currently unreachable: `ROUTER_SSH_PROBABILITY = 1` and every other call site passes
   `true`. The genuinely large number it does not mention is `SERVICE_CATALOG.ssh.placement =
   0.4` — **~60% of NPC LAN hosts run no sshd**, and the client refuses those today. Net:
   closing the exemption is anti-cheat hardening with **zero gameplay change**.
4. **A live bug the grill found, which D4 turns from obscure into ordinary.**
   `authCreateSessionSameLan:221` checks `open.port === port` — the **port**, not the service —
   though its own comment claims it verifies sshd. On a shared ESSID, `ssh <neighbour> -p <their
   ftp port>` therefore opens an **ssh** session through a port serving **ftp**, and the client
   does not gate that path at all (it prompts, then hands straight to the server). Today it
   needs an uncommon setup; after D4, when players deliberately stop sshd and start daemons on
   chosen ports, it is the ordinary case. This is D2.4's `reachedPort` rule — which §7 says
   binds the login gate — applied to public and own-LAN and missed here.
5. **`readOpenPortsFromPidfiles` has zero callers.** The server materializes the FS and calls
   `readOpenPorts` on the tree instead. Dead since it was written; it goes with the reduction.

### Forced rather than chosen (planning should not re-litigate)

- **Stopping IS removing the pidfile**, and tombstoning a *generated* file is proven — it is
  exactly how the brick works (`/boot/vmlinuz`). The server materializes base + patches and then
  reads ports off the tree, so a stop propagates cross-player through the shipped pipeline with
  no new mechanism.
- **State persists across reboot whether or not anyone wants it to.** The pidfile is a patch row,
  patches persist, and `reboot.ts` never touches the journal. A daemon started once is already
  running forever.
- **Live sessions survive a stop for free.** Nothing re-checks a daemon after login — the gate
  fires once, at the door, and `findActiveSession` reads the row and nothing else.

### Locked decisions

1. **`systemctl` and the daemon commands share ONE implementation.** All four names stay —
   they are real binaries, and the apt-install hint depends on `nginx`/`apache2` — but the 393
   duplicated lines collapse into one catalog-driven module first, in its own
   behavior-preserving PR. Two independent writers of the same pidfile with separately
   maintained gate order is precisely the drift `pidfile.ts` exists to prevent.
2. **No PID — the SERVICE is the unit.** The pidfile holds no PID (`sshd:port=22`), and the
   only PIDs in the game are log decoration (`derivePid(stamp)`, computed per line, so two lines
   from one daemon disagree). `ps` lists services; **`kill` defers to D5**, where a planted
   `nc -l` backdoor is something worth killing and is not a `SERVICE_CATALOG` row. Adding the
   column then is cheap; adding it now is speculative, against the catalog's own discipline.
3. **`systemctl` runs anywhere you stand**, root-gated. "Tools run where you stand" is a locked
   principle shipped at v0.118.0; refusing here would be its first exception. Three consequences
   accepted deliberately: **you can lock yourself out** (stop sshd on a rooted NPC and the client
   refuses your way back), **the AP gateway is contested** (its sshd is shared by every occupant,
   including you), and **one player can now degrade another's services**, not just their files.
4. **One state, and it persists.** The pidfile is the whole truth; no `enable`/`disable`. A
   second state beside the one four readers and the server already agree on is what drifts. **A
   stopped daemon stays stopped until someone restarts it** — the persistent cost is what makes
   the attack worth performing and `ps` worth running.
5. **A stop does not evict.** Live sessions survive; only new logins are refused, which is what
   real sshd does. **Eviction pairs with `kill` in D5** — "shut the door" and "remove who is
   already inside" are two defender verbs, and bundling them makes D4 the second one in disguise.
   Two consequences named rather than discovered: an **intruder outlives the door**, and a
   surviving session is L1-valid so the **intruder can re-open the door behind them**.
6. **`chmod` is out of D4.** It shares nothing with the daemon model — no pidfile, no catalog
   row, no port. It is also not trivial: `availability.ts` reads a binary's own `perms.execute`
   at execution time, so a working `chmod` lets a player make a binary unusable on someone
   else's box. Its own decision, later; not D10 polish either.
7. **The player types the DAEMON name** — `systemctl stop sshd` — matching the epic's own
   acceptance line, the command names players already use, and `daemonOf(spec)`, which derives
   exactly this from the pidfile basename. `systemctl stop http` is a string no Linux user has
   typed. **`apache2` ships as a real alias** onto the same `http` unit because it is
   observable, and its replies name the **conflict** rather than the program, reusing the rule
   `webServer.ts` established. No `ssh`/`ftp` aliases — unobservable, per the `-P` precedent.
8. **No new log.** The intrusion is **already logged**: to stop A's daemon, B had to log in as
   root, which wrote `Accepted password … from <B's server-derived address>` into A's
   `auth.log`. The stop also has a louder tell than any line — the port is gone, permanently.
   Recorded so it is not re-solved: **the forensics already exist server-side**, since the
   pidfile removal is a patch row stamped with `writer_key` from the verified pubkey, so a
   future "who touched my box" surface needs no new log format and no change to D4.
9. **Both login-gate fixes ship in D4** — drop the `ssh` exemption on `authCreateSession`, and
   make `authCreateSessionSameLan` check the SERVICE rather than the port (finding 4). One rule,
   two missing applications. §9 kept the exemption backlogged pending "what happens to a player
   mid-session on such a router" — **decision 5 answers that**, so the blocker is gone. D4 is
   also what gives both teeth: it is the first time "this service is not running" is a player's
   deliberate act rather than a generation artifact, and shipping the lock and the hole in one
   door would be indefensible.
10. **`/usr/bin/systemctl`, pre-installed everywhere**, planted on generated hosts exactly as
    `SYSTEM_DAEMON_NAMES` is — decision 3 requires it to exist on a box you rooted. Not
    apt-installable: a box you cannot administer is an obstacle, not a puzzle. **`start`/`stop`
    root-only at runtime, world-executable on disk** (the shipped `sshd` pattern); **`status`
    and `ps` at any tier**, since real ones need no root and letting a guest see what runs is
    recon that costs the defender nothing they control. **Not-installed and unknown-unit
    collapse into one reply** (`Unit <name>.service could not be found`) — distinguishing them
    would tell a guest which packages a box holds, which is `dpkg`-grade recon V1 gates.

### Folded in as routine (recorded so they are not re-decided)

- **`systemctl restart` ships** in slice 1. Unlike the `-P` alias it is directly observable and
  something players type, so it has a test that can fail.
- **Bare `systemctl` refuses with usage.** Real systemd lists all units, which duplicates `ps`.
- **A NAT forward pointing at a stopped service already behaves.** `resolveInnerGatewayTarget`
  documents "a forward to a stray address, or to a port the target is not listening on" as a
  handled case, so stopping a daemon behind a forward closes that path with no new code.

### Slice spine (each vertical + observable)

- **Slice 0 — the reduction, its own PR before D4.** Three daemon modules → one catalog-driven
  module with three thin registrations; `readOpenPortsFromPidfiles` deleted. Behavior-preserving:
  `reduce-system-complexity` + `refactoring`, **no RED**, existing tests green.
- **Slice 1 — a defender shuts a door, and it stays shut.** `systemctl start|stop|status|restart`
  wherever you stand. The whole loop is one slice because the acceptance is one sentence: stop →
  pidfile gone → port closes → `status` says inactive → start → reachability returns, across a
  reboot. `start` is nearly free once slice 0 has parameterized it.
- **Slice 2 — a player sees what a box is running.** `ps`, any tier, on the box you stand on
  including one you rooted. Its own slice for its own design question (columns, and what a guest
  may see) and its own RED.
- **Slice 3 — the door a crafted client cannot walk through.** Both gate fixes from decision 9.
  Server-side only, no client surface. **Carries D4's wire-check**, proving a stopped daemon is
  refused on every login path — the one thing here provable only live. Last deliberately: it has
  nothing a player can see, so leading with it would open the door with a PR that proves nothing.
- **E2E** rides slice 1 or 3, appended to `e2e-shared-network-verification.md`: A stops sshd, B's
  `nmap` drops `:22`, B's `ssh` gets `Connection refused`, A restarts it, B gets back in.

---

## D5 — resolved scope & decisions (grill-me, 2026-08-16)

**Scope: `nc <host> <port>` + `nc -l <port>` + `kill` + generated NPC backdoors.** D4's two
deferred verbs arrive as promised — `kill` and eviction — and the epic row's open design question
("a backdoor is not a `SERVICE_CATALOG` row, so *what is running here* and *shut this down* both
need a second shape") is answered by a discriminated union, not by a new catalog row.

D5 is the first door with **no credential at all**, which is the one thing decision 2 parked. It
is also the first thing in the game a player leaves *behind* on someone else's machine.

### Grounding that reshaped the scope before any decision

Three things the code says that the epic row could not have known:

1. **`nc -l` can only be planted by root, so legacy's privileged-port gate is unreachable.**
   `/var/run` is `TRAVERSABLE_DIR` (`write: ['root']`, `baseFs.ts:21`), so writing
   `/var/run/nc-<port>.pid` needs root on that box already. Legacy's `nc.ts:47` ("ports below
   1024 require root") assumed any user could listen. It is the same unreachable branch D4
   already rejected for daemons — the root gate fires before a port is ever parsed.
2. **v2 has no backdoor ports at all, and legacy's producer was the CVE system, not `nc`.** Zero
   hits for `elite`/`31337` across `v2/src`. Legacy's came from `attackPatterns.ts`
   (`{kind:'backdoor_port_open', tier:'user', port:31337}`) — this epic's **Phase 3**. `nc -l`
   was the manual half of a mechanism whose main producer arrives much later, which is why
   decision 4's content half had to be decided here rather than inherited.
3. **The two halves of `nc` have very different day-one value.** Connect-mode works immediately
   against every generated host running sshd/ftp/http. The *interactive* backdoor connect has
   nothing to find unless someone planted one — so without placement, D5 ships a persistence tool
   rather than a door.

**And one live defect whose stated cause in §9 is wrong.** §9 records `ps` on an ENTERED box
showing nothing, and proposes fixing it by "projecting `/var/run` to a foreign session regardless
of tier — a change to the cross-player read filter". It is not a read-filter problem: **two
producers of the same file disagree about its permissions.** The generator stamps
`PIDFILE_PERMISSIONS` (`read: ['root','user','guest']` — `routerFs.ts:107`), while `daemon.ts:149`
passes no permissions and gets `defaultFilePermissions('root')` → `read: ['root']`. So a generated
NPC host's pidfiles are world-readable and `ps` works there after a hop; a **player's** box is the
odd one out, and the filter is correctly pruning a file the box really does call root-only.
`PatchApi.write` already takes a `permissions` option for exactly this class of bug — its own doc
cites `apt install` stamping a world-executable binary. **The fix is one argument.**

### Forced rather than chosen (planning should not re-litigate)

- **`kill` is root-only.** Removing the pidfile goes through the L2 walker at the session's tier
  and `/var/run` is `write: ['root']`. Legacy let a non-root user kill their own process by
  deliberately bypassing FS perms (`kill.ts:177` — "deletion always uses root perms"); that branch
  is unreachable here, and it matches `systemctl`'s rule that changing what runs is root's.
- **A pidfile asserting its own user is safe.** Forging one means writing to `/var/run`, which
  needs root on that box already, so there is no escalation to be had. The server reading it is
  authoritative, exactly as legacy's `proof: 'pidfile'` was.
- **An nc session is an ordinary session row at the pidfile's tier.** Decision 2 forbids a new
  authorization dimension, so a server-enforced read-only "nc mode" would BE that dimension. The
  protocol limits the command surface; the tier is the truth.
- **Cross-LAN reach costs nothing.** `machineServing` already routes a public port to
  `internalIp:internalPort`, and `scanResult` already shows a forward iff its target is serving
  that internal port — which, with the union below, a listener now does. So **crack the gateway
  (40%) → root a neighbour → plant → add a forward** is a complete persistent-access loop in which
  only the planting step is new.

### Locked decisions

1. **D5 ships connect + listen + `kill` + NPC backdoor placement.** Decision 4 is honoured
   literally rather than deferred to Phase 3: without placement, connect-mode's interactive half
   has nothing to find, and the slice is demoable only as a two-player loop.
2. **A generated backdoor lands you at USER tier; a planted one carries the planter's tier.**
   Matches legacy's `tier: 'user'` exactly. A generated backdoor is a FOOTHOLD, not a jackpot — it
   skips the credential and still leaves you needing a root password. **Locked decision 1
   survives**: a no-credential root would be cheaper than the 12% crackable NPC root and would
   quietly outrank the gateway as the pre-CVE root target. Planted listeners necessarily assert
   root, since only root could have written the file — one rule, and the pidfile records who left
   the door open.
3. **One walk, a labelled result.** `readRunningServices` keeps its single pass and returns
   `{kind:'service'; spec; port} | {kind:'listener'; port; user; userType; pid}`. `ps` reads the
   label to print an owner; `nmap`, `machineServing`, `scanResult` and the four login gates keep
   taking `.port` and never notice. **A listener carries only the fields it has** — no fabricated
   `placement`/`altPorts`/`sweepLog`, the last of which would be a lie, there being no credential
   to sweep. §7's single-walk invariant holds unchanged.
4. **A listener's SERVICE column reads `unknown`.** The honest answer for a port with no catalog
   row, and it is what gives `nc <host> <port>` a job: an unaccounted-for open port is a question,
   and connecting is how you answer it. `elite` would hand over the answer and make connect-mode a
   formality.
5. **Services are units, listeners are processes — one verb each.** `ps` gains a PID column,
   filled for listeners and `-` for services; `kill <pid>` handles processes, `systemctl stop`
   keeps handling units, and neither duplicates the other. **Nothing in `/var/run` changes
   format** — only the nc pidfile carries a pid, derived through `createPrng('<machineId>:nc:<port>')`
   so it survives rereads and reboots. This NARROWS D4's decision 2 rather than reversing it: the
   SERVICE is still the unit, and a PID appears only where there is genuinely a process. Legacy's
   PIDs were **not** stable (`kill.ts:46` counted from 100 at read time, so starting another
   service renumbered the one you were about to kill).
6. **A backdoor is silent — nothing is logged, ever.** Modelled on the real thing: a stock Linux
   box produces zero log entries for `nc -l` or for connections to it. No PAM involvement, so no
   `auth.log` line; no `utmp`/`wtmp` entry, so `who`/`w`/`last` show nothing; netcat has no syslog
   integration, and its `-v` output goes to the launching terminal's stderr, which for a detached
   backdoor goes nowhere. Real detection is **live state** — `ps`, `ss -tlnp`, `lsof -i` — never
   log review. The intruder's original ssh still writes its own `auth.log` line, so the defender
   gets the same two disconnected facts a real one does ("root logged in at 04:12" + "something is
   listening I did not start") and has to join them up.
7. **Full shell, minus what needs a TTY.** `su` and `nano` refuse in their real words
   (`su: must be run from a terminal`, `Error opening terminal: unknown`) because a bind shell has
   no PTY — which is why every real writeup opens with `python3 -c 'import pty;pty.spawn(...)'`.
   Legacy's restricted set (`src/commands/nc/` — pwd/cd/ls/cat/whoami/help/exit) corresponds to no
   real netcat mode: plain `nc -l` is a dumb pipe that runs nothing, and `nc -e /bin/bash` is an
   unrestricted shell. **The bricking worry is answered without a command list**: a generated
   backdoor is user tier, so `/boot` is refused by the ordinary walker, and `su` cannot run to fix
   that. Bricking works only through a root-planted listener — someone's own deliberate root
   shell, which is precisely the real hazard.

   **AMENDED 2026-08-17, at D5 slice 4's approval: the rule is WIDER than the two commands named
   above.** No pty blocks everything that has to reach a human through the terminal — `ssh`, `scp`
   and `ftp` all prompt for a password, and `lynx` draws a screen. This decision named the two
   famous ones and read them as the whole set; they are two instances of one property. The widening
   is *more* faithful, not less: a pty-less `ssh` really does fail at password auth. It is also what
   makes the three doors differ — `ftp` moves files, `nc` looks and breaks, and **`ssh` is the only
   one you can pivot ONWARD from**, so a cracked password stays worth having. `apt` is deliberately
   NOT blocked: it is the one named tool that genuinely works over a pty-less shell, and tier
   already refuses it everywhere that matters. Still no allowlist — each command declares the
   refusal itself.
8. **A planted listener survives a reboot.** Inherited, not designed: the pidfile is a patch row
   and `reboot` never touches the journal, exactly as a stopped service already behaves. A real
   bind shell never survives a power cycle, so this is a knowing departure — taken because `kill`
   is already the one answer to a backdoor, and reboot-clearing would be a redundant second answer
   that also needed tombstone patches for generated listeners.
9. **`kill` drops the intruder on their NEXT command.** The binding finds the pidfile gone and
   closes in netcat's own words. That is how a real terminal behaves — you learn the socket died
   by writing to it — and it costs nothing: no push channel, and no widening of `endSession`,
   which is deliberately scoped so a caller can only end their own rows. It is also where `kill`
   and `systemctl stop` differ **for a real reason**: sshd forks a child per session, so a stop
   leaves them running, while netcat is the one process that both listens and serves.
10. **Placement 0.10, NPC hosts only.** Roughly 0.8 per 8-host LAN, so most networks have one and
    the mechanic teaches itself, while finding one still reads as a find. **Never the AP gateway**
    (locked decision 1 makes it the contested pre-CVE root target) and **never another player's
    workstation** (nobody opts into being backdoored by the generator). The listener claims a real
    account from that host's `/etc/passwd` at user tier; the port is drawn from legacy's own list
    (`attackChain.test.ts:122` — `[4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234]`). Note what
    this is worth: NPC user passwords are already 70% crackable, so a backdoor's value is not the
    tier but that it needs **no wordlist at all** — an early-game gift, before hydra is installed.
11. **The credential step becomes pluggable.** The shared spine keeps resolving the target,
    boot-gating, checking the reached port and inserting the row; only the middle step varies —
    ssh/ftp/scp validate against `/etc/passwd`, nc derives user and tier from the listener it just
    found. `SERVICE_BY_DOOR` gains `nc: 'unknown'` and the shipped reached-port check works
    untouched, honouring §7's rule that a non-daemon door adds a ROW there and a column nowhere.
    Four gates, five doors, one path — so a future gate cannot forget the boot check or the
    reached-port rule, which is the drift D4 slice 3 existed to remove.
12. **Banners are version-free, on a catalog column.** `SERVICE_CATALOG` gains `banner`, consumed
    by this slice as its own discipline requires. **No version in the string**: the epic's standing
    warning reserves the version column for V1, and `readFilter.ts:57` already names
    `/var/lib/dpkg/status` as where `nmap -sV` versions come from — a hardcoded banner version
    would be a second, contradicting source of truth for a fact CVEs are keyed on.
13. **D5 owns the §9 defect, as a permissions fix on both producers.** Pass `PIDFILE_PERMISSIONS`
    on the `daemon.ts` write and on the nc write. This makes the world **consistent** rather than
    more permissive — the recon/defence balance §9 worried about is already live on every generated
    host, and player-started daemons are the exception. D5 has to touch this code anyway to add a
    third producer of a `/var/run` pidfile.
14. **Netcat is not on the target — the attacker installs it.** Generated hosts ship
    `SYSTEM_UTILITY_NAMES` + `systemctl` + `sshd`/`vsftpd` and no `nc`, so planting is: root the
    box, `apt install netcat` there, then `nc -l`. `nc` is already an `APT_PACKAGES` row
    (`{name:'netcat', binaries:['nc']}`), and `apt` gates on `env.network.isOnline()` — the
    caller's connectivity, not the target's. It is the real reflex (`which nc` exists because the
    OpenBSD netcat most boxes ship has no `-e`, and half of them carry no netcat at all), and it
    pairs with decision 6: **the door leaves no log, but installing the door leaves a file** the
    defender can find in `/usr/bin`.

### Folded in as routine (recorded so they are not re-decided)

- **A listener is an open port to everyone**, because `readOpenPorts` projects both arms of the
  union. A box cannot look one way from outside and another from within — that is what decision 3
  is for.
- **Connecting to your own box stays refused** (`nc: connect to localhost: Connection refused`),
  as legacy did. Planting is local; connecting is not.
- **`nc -l` on the shared AP gateway is possible by construction** — gateway root is 40% crackable
  and nothing forbids it. A contested backdoor on a contested box is consistent with D4's decision
  3, which already accepted that one occupant can degrade the gateway for everyone. Verify it
  behaves; do not add a rule.

### Slice spine (each vertical + observable)

- **Slice 0 — the pidfile a visitor can read.** The §9 fix: `daemon.ts` stamps
  `PIDFILE_PERMISSIONS`, so a player's box agrees with every generated host. Leads because it is
  what makes every later `ps` observable across a hop, and because a shipped defect deserves its
  own revertible PR rather than burial inside a feature.
- **Slice 1 — a player grabs a banner off a stranger's port.** `nc <host> <port>` against existing
  services: the catalog `banner` column, target resolution, refusal on a closed port, the network
  guards. The walking skeleton — a command that resolves a target and speaks.
- **Slice 2 — a player plants a listener, and can see it.** The union in `pidfile.ts`, the
  `nc-<port>.pid` format, `ps`'s PID column, `nmap`'s `unknown`. Plant on your own box; nothing
  connects yet.
- **Slice 3 — a defender takes a listener away.** `kill <pid>`, root-gated, against a listener that
  survives a reboot until someone does.
- **Slice 4 — connecting to a backdoor drops you in a shell.** The pluggable credential step, the
  session row, the no-TTY refusals, eviction on the next command. Demoable single-player with no
  generation: root an NPC host (12%, or the gateway at 40%), `apt install netcat` there, plant,
  leave, `nc` back in.
- **Slice 5 — the world already has backdoors.** Placement 0.10, **measured across a population**
  the way D2.2's crackable knobs were, not asserted.
- **Slice 6 — a stranger's backdoor, across the network.** Cross-player gates + NAT-forward reach.
  **Carries D5's wire-check**; the browser run appends as Act 14 of
  `e2e-shared-network-verification.md`.

### Open for planning (named, deliberately not decided)

- **The exact nc pidfile content format** — legacy's was
  `nc:port=4444,user=eve,userType=root,home=/root`; v2 adds a pid and may not need `home`.
- **Whether the blind-typing texture of a real bind shell is modelled** — no prompt, no echo, no
  tab completion. Flavour with a real UI cost; decide when slice 4 has a screen.
- ~~**Whether `apt install` works against a remote rooted box.**~~ **RESOLVED 2026-08-17, before
  slice 4** — it does. `scripts/testRemoteAptInstall.ts`, 5/5 live: root installs `/usr/bin/nc` on
  an ordinary NPC LAN host, on another player's workstation and on an inner gateway; a **guest** on
  the same host is refused `permission_denied`; no session is refused `no_session`. **Locked
  decision 14 stands.** The guest refusal is the load-bearing half — `apt`'s root gate is
  CLIENT-side (`handleInstall` reads `env.session.userType`) and §7 records that a client with a
  valid keypair can mint its own session, so L2 is the only real gate. It holds; without it `apt
  install` would be privilege escalation on any box you can open a guest shell on. Corroborates
  D3b's already-load-bearing `apt install hydra` step on a rooted NPC box, which was reasoned but
  never asserted at the endpoint.

---

## D5b — resolved scope & decisions (grill-me, 2026-08-18)

**A LAN stops being a bag of boxes and becomes a population.** Every generated NPC gains a role it
did not have, and that role decides what the box is called, what it runs, what it serves, who
lives on it, and what it admits when you read its `/etc`.

### Grounding that reshaped the scope before any decision

- **`machine` is an unsplit role, not a different axis.** `LanHostKind` (`generateHomeLan.ts:31`)
  is already a subset of legacy's nine — legacy's `MachineRole` (`src/generation/types.ts:19`) is
  the same `router`/`switch` plus seven machine roles. This splits a placeholder rather than
  introducing a concept.
- **Legacy was role-DETERMINED, not role-weighted.** `portTemplatesByRole` (`pools/ports.ts:11`)
  fixes the port set per role — a webserver always has 22/80/443, a database always 3306, no
  probability anywhere. v2 is the opposite: independent flat rolls (ssh `0.4`, http `0.3`, ftp
  `0.3`). The epic's word "weighted" describes neither codebase. It is a third model, and it is the
  one this slice builds.
- **Legacy assigned roles uniformly** — `prng.pick(allRoles)` over seven (`topology.ts:287`), with
  only the entry machine constrained. There was no "what kind of network is this" concept to
  inherit, so the weighting here is new work, not a port.
- **`themedNetworks/` is not a LAN role model.** It is hand-authored internet destinations with
  HTTP request handlers (`findit.io`, `techparts.io`) — the epic's X2, not this row. Nothing about
  per-LAN archetypes exists to inherit.
- **Role is needed at exactly two sites, and both already hold the seed.** `hostServices` has ONE
  caller, `buildRemoteHostFs`, because services bake into `/var/run` at build time and everything
  downstream — `nmap`, `ps`, `readOpenPorts` — reads the filesystem rather than the roll.
- **`pools/webPages.ts` predicted this slice in its own docstring**: "When hosts gain a kind … this
  grows a `role` argument and the pool becomes role-keyed buckets; today's entries are the
  general-server bucket, so that change is additive and no caller moves." The seam is pre-built.
- **`DEVICE_TYPES` has two callers and only one is an NPC.** The other is `assignHomeNetwork`
  (`homeNetwork.ts:53`) — the PLAYER's own DHCP hostname, and the one that is golden-locked.
- **The hostname is inside the machine_id.** `hostMachineId` (`remoteHostId.ts:20`) prefixes the
  host's own name to a hash of `host:essid:ip`. The docstring's "derived from its network
  COORDINATES" is true of the suffix; the prefix is the name. **Renaming every NPC re-keys every
  NPC machine_id.**

### Forced rather than chosen (planning should not re-litigate)

- **The catalog held three services when this was written.** `ssh`, `http`, `ftp` — with `mysql`
  D6, `redis` D7 and `snmp` D8. The first two have since shipped, so the catalog holds five and
  only `snmp` is still owed. The rule the note exists for is unchanged: a role whose signature
  service has not shipped is a name, a weighting and a config file until it does, which is why
  decision 1 carries a cost rather than avoiding one.
- **`nmap`'s host list includes real players.** Fellow occupants and the player's own box are rows
  in the same table (`nmap.test.ts:797`) and carry no role, so no role can ever be total in that
  OUTPUT even though it is total for generated hosts.
- **Renaming re-keys.** Given `hostMachineId` above, orphaned NPC rows are a consequence of naming,
  not a separate choice made alongside it.

### Locked decisions

**1. All seven machine roles ship now — empty columns and all.** `webserver`, `database`,
`fileserver`, `workstation`, `mailserver`, `iot`, `dns`. The world reads as a full population
immediately and each later door becomes a table edit rather than a re-roll. **Cost accepted:** at
D5b a `db-11` runs no database, because none exists yet. Decision 9 is what keeps that box from
being empty, and decision 4 is what keeps it rare.

**2. Placement is sparse per-role overrides over today's flat default.** `spec.placement` stays a
service-level property and remains the answer for any `(role, service)` cell nobody names. A role
names only the cells that differ — `iot { ssh: 0.15 }`, `webserver { http: 0.9 }`. Rejected: a full
9×7 table (63 numbers nobody would tune, and population-testing each cell is impractical when
today's assertions sweep 8 networks × 253 octets), and legacy's deterministic templates (they
delete the variance the ftp row deliberately bought — "a share of these hosts run NO ssh at all",
the box a `:22` sweep can never open).

**3. Role is DERIVED, not stored.** `hostRole(seed, host)` sits beside `hostServices` and
`hostBackdoor`; `LanHost` is untouched. Two occupants scanning one box agree because they run the
same derivation, which is the property `generateHomeLan`'s docstring exists to protect — and it is
D5's own lesson applied again, where a listener's PID is derived for exactly that reason. No wire
change, and the 85 test files that pattern-match `kind` stay as they are.

**4. The draw is weighted, not uniform.** `workstation` and `iot` common; `webserver` and
`fileserver` occasional; `database`, `mailserver`, `dns` rare. These are home wifi LANs reached by
wardriving — `generateHomeLan`, ESSID-seeded, found with `airdump` — so a mailserver on a flat's
network should be a find, not a coin flip. It also softens decision 1 for free: the roles with
nothing behind them yet are exactly the ones a player meets seldom.

**5. Names keep `<prefix>-<octet>`; the prefix becomes role-keyed.** `cam-31`, `web-04`, `db-11`.
Uniqueness stays free from the octet and a hostname keeps encoding its address, which the terminal
leans on constantly. Today's consumer `DEVICE_TYPES` is not deleted — it becomes the `workstation`
role's pool unchanged, and every other role gets one of its own. Rejected: legacy's full-name pools
(`web01`, `db-primary`), which drop the address encoding and need a dedup legacy never had.

**6. The role is total, so `router` and `switch` are members — known from `kind`, never drawn.**
The union is legacy's nine. `routerFs` KEEPS its own builder (it has a different job: gateway
config, forwards, NAT, the chain out to the public edge), but its private `ROUTER_SSH_PROBABILITY
= 1` moves into the shared table as the router row's `ssh` override. One table describes what every
host in the world runs, read by two builders — a net removal of one hardcoded constant, with no
slice-sized risk to the NAT machinery every cross-player door stands on.

**7. Deep-layer NPCs get roles; players never do.** `generateDeepLayer` builds hosts identically,
so the derivation drops in with a different seed — and the layers behind an inner gateway are
exactly where someone is hunting something worth finding, so they must not be the flattest part of
the world. A player's box is excluded: its services are what they installed and its name is the
golden-locked DHCP draw, so a role would be a label nothing generates and nothing honours.
`assignHomeNetwork` and its golden lock are untouched by this slice.

**8. `nmap`'s third column stays `KIND`.** `machine`/`router`/`switch` is the one fact true of
every row, generated or human. Role reaches the player through the hostname and through what a port
scan finds — the recon loop the game is built on. Rejected on a gameplay ground, not a cosmetic
one: any role column leaves occupant rows either wearing a label we declined to invent or showing a
blank, and that blank tells a player which addresses on a shared LAN belong to real people, for
free, before touching anything.

**9. Web pages, NPC account names and one `/etc` config file are all role-keyed, sparsely.**
Pages: `pickWebPage` grows its role argument as promised, today's four become the general-server
bucket, and buckets are authored only where a flat page now reads as a contradiction — `cam-31`
serving "Internal corporate portal v3.1.0" being the first. Accounts: the uid-1000 name comes from
a role pool (`sensor`, `mqtt` on a camera; `mailops` on a mailserver) rather than the flat eight,
because it is the name `hydra` targets and the one a player types at `su`. Config: legacy's
`serviceConfigNames` (`machineConfig.ts:160`) — one world-readable file per role, so `ls /etc` is a
tell at guest tier, the lowest recon a player has. That file is what gives `database`, `mailserver`
and `dns` something real to find before their doors ship.

**10. The NPC machine_id re-key is accepted, not avoided.** Renaming changes every NPC
`machine_id`, orphaning any server row holding one. The no-backward-compat licence exists for this,
and the slice re-rolls the world anyway — names, services, accounts, passwords. The id also stays
readable, which is worth real money when debugging a cross-player hop. Rejected: making the id
purely coordinate-derived first, which is the right long-run shape but puts the most load-bearing
identity function in the cross-player system inside a slice about flavour.

### Folded in as routine (recorded so they are not re-decided)

- **The account pool change re-rolls every NPC password.** The username is drawn from the same prng
  immediately before the password, so touching the pool shifts the draw — and with it the wordlist
  progression's difficulty. Free under the licence, but it is a re-roll of the crack curve, not
  only of names.
- **Population evidence, not single-host assertions.** Every probability here is proved the way
  D2.2's crackable knobs and D5's `0.10` backdoor placement were — measured across a sample large
  enough to reject a flipped or doubled value, per `remoteHostFs.test.ts`'s 8 networks × 253
  octets.
- **The golden locks split cleanly.** `homeNetwork.test.ts`'s golden is the PLAYER side and must
  not move. `generateHomeLan.test.ts`'s golden is the NPC side and is expected to.
- **A wire-check holding a machine_id across the rename will fail confusingly.** That is decision
  10's blast radius meeting the existing rule that ESSID-seeded ids make scripts each other's stale
  rows. Re-run alone before believing a RED.

### Slice spine (each vertical + observable)

- **Slice 1 — a LAN reads as a population.** `hostRole` + the weighted draw + role-keyed hostname
  pools, for LAN siblings and deep-layer hosts alike. `nmap <subnet>` returns `cam-31`, `web-04`,
  `db-11` where it returned `iphone-40` and `desktop-7`. The walking skeleton: the role exists and
  shows, before anything depends on it.
- **Slice 2 — what a box is called matches what it runs.** Sparse placement overrides, plus the
  router constant moving into the shared table. A `web-04` answers on `:80` far more often than a
  phone does, and a `cam-31` rarely offers `:22` — measured across a population.
- **Slice 3 — a box admits what it is when you read it.** The `/etc` role config file, guest-
  readable. `ls /etc` on `db-11` shows `mysql.cnf` before any mysql exists to run.
- **Slice 4 — the page a box serves fits the box.** Role-keyed `pickWebPage` buckets with the
  general-server fallback. `curl http://cam-31` returns a camera panel, not a corporate portal.
- **Slice 5 — the account you crack fits the box.** Role-keyed NPC account names. `hydra <cam-31>
  ssh` hands back `sensor`, not `deploy`.

### Open for planning (named, deliberately not decided)

- **The seven weights.** How rare is rare — and whether `dns` deserves to exist on a home LAN at
  all before X1 ships `nslookup`.
- **Which override cells get written now, and their values.** In particular whether the three
  service-less roles take a today-expressible signature (`fileserver { ftp: 0.9 }`,
  `database { ftp: 0.6 }` — a dump has to leave somehow) or stay unweighted until their door lands.
- **Prefix pool contents per role**, and how deep each pool must be before repeats inside one LAN
  start to read as generated.
- **Which roles earn a web bucket beyond `iot`**, and whether each bucket honours the existing
  property test that no page links a path its host does not serve.
- **Config file contents** — a stub header naming the role, or something with recon value in it.
- **The deep-layer role seed's composition**, given deep hosts seed off `parentMachineId` rather
  than the essid.

## D6 — resolved scope & decisions (grill-me, 2026-08-19)

**A player reads — and rewrites — a machine's database.** The fourth door in the locked order, and
the first one whose credential is not the box's own. A `db-11` stops being a name with a config
file behind it and becomes a box with something in it worth taking.

### Grounding that reshaped the scope before any decision

- **Legacy ships a complete mysql** — 2,274 lines across `commands/mysql/{parser,executor,
  formatter,types}.ts`, `generation/generateDatabase.ts` + `pools/database.ts`,
  `filesystem/mysqlDataHelpers.ts` and `logging/handlers/mysqlAuth.ts`. The parser, executor and
  formatter are pure functions over a parsed statement and a `MysqlDatabase`; they port almost
  verbatim. What MOVES is where the executor runs, not what it does.
- **Legacy stores the database as a FILE**, `/var/lib/mysql/data.json`, read and written through
  the filesystem, with mutations persisted straight back. v2's whole cross-player persistence is
  journal patches over files, so legacy's storage choice is the one that costs v2 nothing.
- **Legacy's database carries its OWN accounts, and says so deliberately.** `mysqlDataHelpers.ts`:
  "userType derives from the JSON entry directly, NOT from `/etc/passwd` — MySQL users may not have
  system accounts."
- **v2's ftp door states the opposite rule for itself** — "one `/etc/passwd`, one tier — the door
  adds no authorization dimension" (`ftp.ts`). mysql is the first door where those two positions
  collide, which is why decision 2 is a decision rather than an inheritance.
- **`authorizeMachineAccess` never looks at session KIND.** Its entire rule is own-workstation
  bypass, else an active `sessions` row for `(player_key, machine_id)`. A mysql session row
  inserted naively therefore grants `listPatches` and `upsertPatch` on the target — read AND write
  of the whole box at that row's tier. **A `readonly` database credential would have been a guest
  shell.** This is what forced decision 8.
- **`SessionKind` already contains `'mysql'`, `'redis'` and `'mission'`** — inherited from legacy,
  unused by the auth path. `DOOR_KINDS`, which the four gates actually compile against, does not.
- **There is no single "resolve this address from my vantage" function.** Sessions fan out to four
  handlers (`authCreateSession{,Public,SameLan,InnerGateway}`), hydra to three. A new door pays
  that fan-out TWICE — once for its statement path, once for its sweep. It is the largest cost in
  the story and the reason vantages are sliced rather than assumed.
- **D5b already claims the datadir.** Every `database` box's `/etc` config is a real `[mysqld]`
  stanza naming `port=3306`, `datadir=/var/lib/mysql`, `user=mysql` — guest-readable today, and
  pointing at a directory that does not exist. D6 is what pays that note.
- **`{ name: 'mysql' }` is already in `APT_PACKAGES`.** `apt install mysql` succeeds today and
  plants a binary for a command the registry has never heard of. (`metasploit`, `snmp`,
  `redis-tools` and `node` sit there too — the apt list advertises the whole roadmap.)
- **The flat rate would have drowned the role.** At a flat `0.08` with no role cells beyond
  `database`, per 100 drawn machines: `database` 7 × 0.9 = 6.3, everything else 77 × 0.08 = 6.2.
  **Fewer than half the database boxes in the world would be named `db-*`**, and most of the rest
  would be phones and TVs — exactly what D5b's naming was built to stop being a lie.

### Forced rather than chosen (planning should not re-litigate)

- **The banner cannot be MySQL's real greeting.** The catalog demands banners be version-free
  because versions belong to `/var/lib/dpkg/status`, and MySQL's greeting IS a version string. The
  bad-handshake error is what is left, and it follows the `http` row's precedent: what the daemon
  says to a client speaking the wrong thing at it.
- **Writes must exist or the credential tiers are unobservable.** Three account tiers with a
  read-only surface are three names for one capability — structure nobody can observe, and no test
  that can fail. Decision 2 obliges decision 4.
- **The player's own box runs no services at boot.** `/var/run` ships empty and the player starts
  daemons by hand, so a player-side database is a daemon command plus a boot-time datadir, on the
  same precedent `workstationFs.ts` states for `/var/www/html/index.html`: a freshly started server
  must have something to answer with.
- **Functional loot is not D6's to invent.** D2.6b (harvestable plaintext) is postponed by owner
  decision and V2 inherits it as a `password_reset`-shaped effect. A working password in a
  generated table would answer that parked question through the one door where the wordlist did not
  earn it.

### Locked decisions

**1. The database is a real file at legacy's path** — `/var/lib/mysql/data.json`. Writes ride the
journal like every other write; a dump leaves the box through `ftp` or `scp` because the file is
really there. **Cost accepted:** `cat` is a second path to the data for whoever already holds root
on the box, and `ls /var/lib` tells a visitor a database is present before any `mysql` is typed.

**2. mysql accounts live in the database file, not `/etc/passwd`** — legacy's `credentials` array,
md5-hashed, three tiers. **This is the first door in the epic to add an authorization dimension,
and it is deliberate**: ssh and ftp ask the same question twice ("who are you on this box"), while
mysql asks one `/etc/passwd` genuinely cannot answer ("who are you to this database"). **A mysql
connection grants zero filesystem read.** Rejected: mapping database root to a root-tier session —
it would make a mysql credential strictly better than an ssh one, and every other door decoration.

**3. Statements execute SERVER-side, per statement, with no own-LAN exception.** The server
materializes the target with journal replay, reads the datadir, executes, and returns only a result
set. Applies D5's `nc` lesson in advance: own-LAN resolution replays no journals, so a client-side
executor would show a pristine database to one occupant and a mutated one to another. It also all
but closes the shared-file write-wipe for this door — read, mutate and write happen inside one
request, so there is no player-held stale buffer.

**4. The full statement set, tiered.** `SELECT`/`SHOW TABLES`/`DESCRIBE` for every account,
`UPDATE`/`DELETE` for `user` and above, `DROP TABLE` for `root` only. The ladder reads as recon /
sabotage / demolition. **Cost accepted:** a dropped table is permanent and journal-derived, like the
`/boot` brick, but silent until the owner looks.

**5. The door is symmetric; the player's half ships later.** A player's box can run a database and
be attacked through it — that is slices 6-7, not "never". A door that cannot be turned on a person
would be the first single-player feature in a cross-player epic.

**6. Crackability is the world's existing mechanic, unchanged.** Database passwords draw from the
same two pools through `drawPassword`, on the tuned ladder: `readonly` → `guest` (1), the drawn app
account → `npcUser` (0.7), database root → `npcRoot` (0.12). **Demolition is therefore rare** — one
box in eight hands over its `DROP`. **Database root is drawn independently of system root**: two
locks, two keys, which is what justifies the door existing.

**7. One catalog row and four placement cells.** `mysqld.pid` / `3306` / `runUser: mysql` /
`ERROR 1043 (08S01): Bad handshake` / flat `placement: 0.08`. Roles: `database { mysql: 0.9 }`,
`webserver { mysql: 0.2 }` (the classic pairing — some web boxes, not all), `iot { mysql: 0 }` (a
doorbell runs an appliance, not a database), `workstation { mysql: 0.03 }` (a developer's laptop is
a rare treat). **`database`'s ftp stand-in comes down 0.6 → 0.4**: D5b put it there because the role
had no door of its own, and that job is over — it stays above the flat rate only because a dump has
to leave the box somehow.

**8. A mysql connection is NOT a session row.** The credential is re-validated on every statement.
Given decision 3 that costs nothing, and it buys three things: zero-filesystem-read becomes
structural rather than enforced (there is no row, so there is nothing to leak); daemon liveness is
re-checked every statement, so `systemctl stop mysqld` and `kill <pid>` evict a connected player for
free and honestly; and `authorizeMachineAccess` — the most load-bearing function in the codebase —
needs no carve-out. **Cost accepted:** the datadir write cannot ride `upsertPatch`, so the handler
writes it directly and **must stay hard-scoped to that one path, forever**; `sessions` lists nothing
and the box shows no live connection; and the password rides each request.

**9. Own-LAN and inner-gateway vantages in D6; public-IP and same-LAN arrive with the player's half,
together.** The two deferred vantages have no reachable database until a player can run one, so
shipping them now would be handlers with nothing behind them. This is NOT the drift D4 slice 3
closed — that was one rule applied unevenly across gates that all had live targets. The moment
`mysqld` becomes a player command, both remaining vantages land in the same slice.

**10. The `mysql>` prompt is parallel, not a hop**, like `ftp` and unlike `ssh`/`nc` — forced by
decision 2, since a connection with no filesystem read has no tree to stand on. The mode swallows
every line as SQL (`ftpShell.ts`'s stated rule: an outer `cat` at an inner prompt would quietly read
the wrong machine). Credentials are prompted and masked, not passed as arguments. **Semicolons are
lenient**, as legacy's normalizer already is — real mysql's `->` continuation is fidelity that pays
off in a tool you live in, not one you visit to read four tables, and a player stuck at `->` is a
support cost with no gameplay behind it. Legacy's ASCII formatter ports verbatim.

**11. The content exists for BELIEVABILITY, not for missions or loot.** Nothing generated is a
password, key or token that works anywhere — `api_keys.key_value` and `sessions.token` are inert.
Legacy's mission machinery (`enrichForDbExfiltrate`, `tamperScenarios`, `fixScenarios`,
`sabotageTargetTables` — most of what makes `pools/database.ts` 508 lines) does **not** port; it is
scaffolding for a mechanic v2 does not have. The database is **about its box**: the `users` table is
seeded from the host's real accounts among plausible colleagues drawn from D5b's role-keyed pool.
**`config.site_name` derives from the page the box actually serves**, so a `www-04` publishing a
plumbing company does not hold `AcmeCorp`'s tables — the seam the `webserver` cell would otherwise
hand the most engaged player in the game. `smtp_host: 'mail.internal'` is audited out: it names a
host that resolves nowhere until X1 ships `nslookup`.

**12. Reads are silent, writes are attributable.** `/var/log/mysql.log` takes the connect line
(user, source IP, database name) and the access-denied line, as legacy's did, **plus a line for
every `UPDATE`/`DELETE`/`DROP`**. `SELECT` never writes. The asymmetry is the design and it matches
the shape the rest of the game already has — a scan is loud, a backdoor is silent, a brick is
obvious — and it is the only thing that makes a quiet single-row `UPDATE` discoverable at all.

**13. Five slices, then two.** See the spine below. `hydra` comes BEFORE the prompt: without a sweep
there is no way to obtain a database credential, so the door would otherwise ship unopenable.

### Amended at slice-3 planning (2026-08-20) — the database has its own `/etc/passwd`

**14. The datadir's `credentials` array is reachable from `mysql>` as a table, on `/etc/passwd`'s
exact permission shape.** Listed by `SHOW TABLES` and describable at every tier; `SELECT` refused
below `user` with `ERROR 1142`. This is not an analogy — it is the same rule one door in. `/etc` is
traversable at every tier so a guest sees `passwd` in an `ls`, while `PASSWD_FILE` is
`read: ['root', 'user']` so a guest cannot read it. The database answers "who are you to this
database" the way the box answers "who are you on this machine", and the bottom rung can SEE what
the next credential buys.

**This needed reconciling with decision 11** ("nothing generated is a password, key or token that
works anywhere"), because a database credential hash IS working material for the very door it came
from. The reconciliation is that it transfers **no capability, only silence**: `john`'s own
docstring records that it and `hydra` run the same wordlist through the same `md5`, so for any hash
a player can reach the two return an identical set of plaintexts. Cracking database root's hash
offline therefore yields root at exactly the 12% `hydra` already yields it — measured in slice 2.
What changes is who finds out: a sweep writes a wall of denials into the target's own `mysql.log`,
and `john` writes nothing anywhere. **That is the middle tier's reward, and the measured ladder is
untouched.**

Slice 1's `DATADIR_FILE` is NOT amended and stays root-ONLY on the filesystem, narrower than
`PASSWD_FILE` beside it. Reading the file and querying the door remain two different achievements —
which is the whole reason decision 2 exists.

**Consequence for the spine:** slice 3 ships one tier rung after all. It belongs to the READ set
(who may read the account table) rather than being a preview of slice 4's write ladder, so slice 4's
scope is unchanged.

### Folded in as routine (recorded so they are not re-decided)

- `nmap`, `ps` and `systemctl status` see `mysqld` for free the moment the catalog row exists — they
  read `/var/run`, not a service list.
- `apt install mysql` starts meaning something; the package row already exists.
- Ctrl-C at either credential prompt aborts holding nothing (exit 130), as `ftp` does.
- `man`/`help` entries ship with the command, as every other door's did.

### Slice spine (each vertical + observable)

- **Slice 1 — a box runs a database.** Catalog row, the four placement cells, `generateDatabase`
  ported without the mission half, the datadir planted, `config.site_name` linked to the served
  page. `nmap` returns `3306/tcp open mysql` on `db-11`; `nc :3306` answers with the bad handshake;
  `ssh` in and `ls /var/lib/mysql` agrees with `ps` and `systemctl status`. **The `[mysqld]`
  config's `datadir` claim is honoured for the first time since D5b wrote it.**
- **Slice 2 — a player cracks a database account.** `hydra <host> mysql` against the database's own
  `credentials`, own-LAN, writing attempt lines to `mysql.log`. `readonly` falls almost always, the
  app account often, database root rarely — and the defender greps the wall of denials.
- **Slice 3 — a player reads a database.** The `mysql>` prompt, the read set, the per-statement
  endpoint, the connect line. `mysql db-11` → `SHOW TABLES` / `DESCRIBE` / `SELECT` in ASCII tables.
  **This is the epic row's stated acceptance.**
- **Slice 4 — a player changes a database.** The write set, the tier ladder, the mutation lines.
  `readonly` is refused an `UPDATE`; the app account changes a row; database root drops a table;
  every write leaves a line and every read leaves none.
- **Slice 5 — a database on a deep layer answers.** The inner-gateway vantage, for the statement
  endpoint and for hydra.

**Deferred half — two slices, and they must not be one:**

- **Slice 6 — a player runs their own database.** `mysqld` as a daemon command plus the workstation
  boot datadir. `mysqld` → `:3306` open on your own box with something real behind it.
- **Slice 7 — a player reaches another player's database.** Public-IP and same-LAN vantages, for the
  statement endpoint AND hydra, landing together.

### Open for planning (named, deliberately not decided)

- **Which of legacy's seven table templates are retained, and their row counts.** Believability is
  the criterion, not parity.
- **How `config.site_name` re-derives the served page** without coupling the two generators badly —
  both seed off the same host, so the draw is available, but the shape of the reach matters.
- **Whether a mutation log line carries the statement verbatim or a summary.** Verbatim is a
  wonderful artefact for a defender to read; it also writes arbitrary player-typed text into a file
  other players `cat`.
- **Which existing `api/*.ts` file takes the statement action.** A file in `api/` IS a published
  Vercel function, so no new file may be added for a helper.
- **Whether `hydra <host> mysql` reports the database NAME alongside the credentials**, given the
  connect line already knows it.
- **Slice 1's seed stream.** It adds draws to generation, so it takes its own stream or it moves the
  octets the lease allocator excludes and puts an occupant on top of an NPC — D5b's hardest-won
  invariant, and the one that most directly threatens this slice.

## D7 — resolved scope & decisions (grill-me, 2026-08-24)

**A player reads — and rewrites — a machine's key-value store.** The fifth door in the locked
order, and the first whose secret belongs to the SERVICE rather than to a person. Four stores in
ten have no secret at all, which is what makes this a different door rather than a mysql with
fewer verbs.

### Grounding that reshaped the scope before any decision

- **v2 already carries three pieces of redis, and one contradicts D6.** `redis-tools` is a real apt
  package with binary `rediscli` (`aptPackages.ts:150`), asserted in `availability.test.ts`;
  `SessionKind` includes `'redis'`; and `ModeChange` still declares
  `{ kind: 'redis'; target: { ip } }` — an OVERLAY. Three lines above it sits the note explaining
  why mysql's variant was DELETED: a database prompt is a sub-shell over the same terminal, not a
  screen. Both redis declarations are pure ghosts — declared, never constructed, never read.
- **Redis has no accounts.** Legacy authenticates a single `requirepass`, no users. But
  `ServiceSpec.accountsOn` is a REQUIRED column returning `SweepableAccount` = `{ username, hash }`,
  and redis honestly has neither field. Legacy's own hydra proves it: its line reads
  `[6379][redis] host: …   password: …` with no `login:` at all. **Redis 6 ACLs are the road not
  taken** — real users exist there, but adopting them makes redis into D6 with different verbs, and
  they arrive naturally as a VERSION difference once Phase 3 ships `dpkg` + `nmap -sV`.
- **Three in four legacy stores have no password whatsoever** (`REQUIREPASS_CHANCE = 0.25`), and
  once connected — authed or not — `SET` and `DEL` both work. There is no tier ladder, so D6's
  whole slice 4 has no analogue here.
- **`requirepass` is plaintext, and the rung it would sit on is world-readable.**
  `SERVICE_CONFIG_FILE` admits guest and states why it may: *"this file names neither"* — neither
  account names nor inline hashes. A `requirepass` line makes that comment false, and would ship
  the harvestable plaintext loot **D2.6b postponed by owner decision**, through the back door.
- **mysql is already split, and the split IS the house rule.** `/etc/mysql.cnf` is world-readable
  and carries `port`, `datadir`, `user`, `bind-address` across five templates with not one password
  among them; `/var/lib/mysql/data.json` is `DATADIR_FILE` (root only) and carries the hashes.
  Every role config in the game works this way — `mysql.cnf`, `postfix.conf`, `named.conf`,
  `device.conf`.
- **The verb surface is tiny** — 59 lines of parser and 68 of executor, against mysql's 659-line
  `statements.ts`.
- **Legacy's generated content is web-application state**, not database state: `sess:<token>`,
  `sess:jwt:*`, `cache:user:*`, `perms:<user>`, API keys — and it already draws the usernames from
  the box's own non-guest accounts. Legacy nevertheless places redis on DATABASE-role boxes only,
  contradicting the data legacy itself generates.
- **v2 already has redis's log model and did not build it for redis.** `SweepLog` carries
  `formatAttempt` plus an optional `formatArrival`, filled by ftp and left empty by sshd. Legacy's
  redis handler reached the same split independently and wrote down why: *"real Redis treats
  socket-open and AUTH as two events, one line each"*, where mysql sends credentials in the connect
  handshake and so collapses them.

### Forced rather than chosen (planning should not re-litigate)

- ~~**`rediscli` can never become `redis-cli`.**~~ **WRONG — reversed 2026-08-26.** What is
  forced is that a JS *identifier* cannot hold a hyphen, not that a *command name* cannot.
  Legacy's sandbox is `new Function(...contextKeys, content)` where
  `contextKeys = Object.keys(context)` (`src/commands/node.ts:167,171`), so it made the two the
  same thing by construction. v2 has no `node.ts` at all, and when it builds one the context is
  keyed by a camelCase identifier derived from the command name (`redis-cli` -> `redisCli`).
  The commands are now `redis-cli` and `redis-server`, alongside `aircrack-ng`, `airmon-ng`,
  `airodump-ng` and `new-game`. See `conventions-and-gotchas.md` §2.
- **`/var/log/redis.log` and `/var/lib/redis/` are named by the conf the box itself publishes.**
  Any other path makes the box contradict its own file.
- **The deep-layer resolver trap is waiting.** D6 slice 5 found the chain resolver hands back the
  terminal box's SEEDED tree — survivable for a door authenticating against seeded accounts, fatal
  for one answering with DATA. It was worked around in `reachMysqlHost` and recorded in §9 as the
  resolver's to close for every door at once. Slice 5 hits it again.

### Locked decisions

**1. Bare password, no accounts — the contract widens rather than faking a username.**
`ServiceSpec` gains an optional `secretOn: (fs) => string | undefined` beside `accountsOn`, and
`accountsOn` becomes optional; a row fills one or the other. No discriminated union and no strategy
object — the two functions ARE the discrimination, and `databaseOn` already established the pattern
of an optional column only one row fills. A single `authOn` returning a tagged union would make
every existing row change shape to say what it already says fine, which relocates mechanism rather
than removing it. The sweep then **omits** the login field rather than blanking it:
`[6379][redis] host: 10.0.1.20   password: hunter2`.

**2. An open store gives reads AND writes to anyone who reaches it.** Authentic — it is the most
famous real-world Redis exposure and the door's entire character. It also gives the epic something
it lacks: a door where the FIND is the whole play, with no crack in between. This is the game's
first no-credential write; every other door writes only behind a session or a re-validated
credential, and `curl` reaches a page with no credential but only reads.

**3. Both halves ship — the player's own store and the cross-player reach.** An NPC-only door is a
dead end for what the epic is for; `redis-tools` having no daemon is a live defect either way (a
generated box can run redis while `apt` provides no server — the exact asymmetry slice 6b was built
to kill); and deferring is the more expensive order, not the cheaper one, because D6 slice 7's
grill found three gaps where the one-line plan claimed two.

**4. Daemon `redis`, package `redis` (renaming `redis-tools`), client `rediscli`.** Not
`redis-server` (the hyphen constraint above), not `redisd` (a name no Linux box says). It matches
the `nginx` and `apache2` rows exactly — package name IS daemon name, no `d` suffix — and legacy's
own generated conf already says `pidfile /var/run/redis.pid`, so `ps` reads `redis:port=6379`. One
package carrying client and server is the rule the mysql row already wrote down: a player who
installed `redis` should not have to learn a second name the world never says out loud.

**5. Split like mysql: the conf is public and secret-free; the secret is a hash in the datadir.**
`/etc/redis/redis.conf` keeps `SERVICE_CONFIG_FILE` and carries `port 6379`, `bind`, `dir`,
`logfile`, `pidfile`, `daemonize` — real recon, no secret. The `requirepass` moves into
`/var/lib/redis/data.json` (`DATADIR_FILE`, root only) as an **md5 hash** beside the keys. This
makes `hydra <host> redis` crack through the same `sweepAccounts` hashing path as every other door
instead of needing a bespoke plaintext compare, and it keeps D2.6b postponed. The divergence from
real redis is one v2 has already made once: real Linux has `/etc/shadow`, and v2 puts hashes inline
in `/etc/passwd` instead. A player who `cat`s the conf looking for `requirepass` learns what real
Redis tells them — `NOAUTH Authentication required.`

**6. A player's own store mirrors the box's root password, with no opt-out.** `ownDatabase`'s
reasoning transfers whole: they reach their own prompt with nothing to look up, a chosen password
is almost never in the wordlist so their store is out of a SWEEP's reach, and whoever cracks the
box's root hash and runs `su root` is holding it already — the harder path reaching what the easier
one cannot. **The consequence, deliberately accepted: the wide-open store exists only on NPC
boxes.** Cross-player damage should cost skill, and the free wipe never becomes reachable. No
opt-out, because with the secret hashed there is no coherent `nano` story and the defender's lever
already shipped in D4 — `systemctl stop redis`.

**7. Placement, and how often a store is locked.** Flat `0.05`; `webserver: 0.35`; `database: 0.3`;
`workstation: 0.05`; `iot: 0`. The webserver cell is the correction to legacy's database-only
placement, and it gives the web door a SECOND follow-on distinct from mysql's `0.2` "find the tables
behind it" — read the page, then read the **sessions** behind it. **60% of stores carry a
`requirepass`, 40% are open** — raised from legacy's 25% so the crack is the main way in and the
open find stays a real but secondary outcome, still landing 4 times in 10 for the epic row's
`rediscli <host>` → `KEYS *` acceptance example.

**8. A sub-shell that mints no session row, and both ghosts deleted.** No session row for the
reason D6 found and more so: `authorizeMachineAccess` never looks at session kind, and a
passwordless connection carries no credential at all, so a row would hand `listPatches` and
`upsertPatch` to anyone who reaches 6379. The server instead re-derives the target's state from its
own datadir — open, or locked with this hash — and re-validates per statement, which also makes
`kill redis` evict a connected player for free. Prompt is **`redis> `**, bare: legacy's own
(`SessionContext.tsx:506`), the epic row's, and the rhythm of `mysql> ` / `ftp> `. The target is
named at connect time in the scrollback, and v0.173.0's echo fix means every statement scrolls back
under `redis> ` — **the bare prompt is safe because of the fix that just shipped**, and redis is the
third rung `subShellPrompt()` was consolidated to accept.

**9. Seven verbs: `KEYS` `GET` `SET` `DEL` `DBSIZE` `AUTH` `QUIT`/`EXIT`.** `KEYS` keeps its glob,
unknown input answers `(error) ERR unknown command '…'`, and invocation stays positional
(`rediscli <host> [password]`) to match `mysql` and `ftp` rather than real redis-cli's `-a`.
**Deliberately absent, so a later slice does not rediscover them as gaps:** `FLUSHALL` (a griefing
amplifier, not a new capability — `DEL` already says a stranger can destroy your data);
`CONFIG GET requirepass` (**impossible to answer honestly** now the secret is hashed — it would
return a hash, a lie, or reopen decision 5, and a verb that must lie is worse than an absent one);
`TYPE` (every value is a string); `SCAN` (a cursor over a store `KEYS` handles); `INFO` (it wants a
version, and the catalog's banner comment is explicit that versions are `/var/lib/dpkg/status`'s to
tell). `hydra` against an open store keeps legacy's genuinely useful refusal — *no password set
(open access)* — because it tells the player to stop cracking and just connect.

**10. `/var/log/redis.log`, world-readable and root-write like `mysql.log`.** Both `SweepLog` fields
filled, ftp-style: an arrival line per connection, an attempt line per `AUTH`. Mutations append,
reads never — D6 slice 4's rule and real Redis's behaviour both. **Accepted knowingly:** against an
open store there is no `AUTH`, so there is no wall of failed attempts, and the defender's ENTIRE
evidence is one arrival line naming the source IP plus a line per mutation. The 40% of stores that
are open are also the ones where theft is nearly invisible.

**11. Content is believability, not loot — and it is about the box it sits on.** D6's rule
unchanged: nothing generated is loot that works; that stays D2.6b's postponed job. Redis is where
it would erode fastest, because session tokens and API keys beg to be used more than a `customers`
table does. Legacy's tie to the box's own non-guest accounts is kept and extended the way D6
extended mysql — a webserver's store references the site that box actually serves. Legacy's 8–15
key count and generator pool port as-is.

**12. An open store discloses the box's account list, and that is a FEATURE.** Those keys name real
users, and `/etc/passwd` is `PASSWD_FILE` — guest cannot read it — so a 40%-open store hands out
with no credential the names a whole permission rung exists to protect. Kept on purpose: it is
precisely the real-world *exposed Redis leaks your user table* problem, and it gives the open store
a job beyond flavour. Mechanically modest — `hydraCrack` already sweeps EVERY account in a target's
passwd without being told any names — so what a player gains is the ability to aim and a read on
who matters, not a shortcut past the crack. Named here because it is a permission boundary crossed
by a door, and D6 shipped a bug of exactly that family in slice 2.

### Folded in as routine (recorded so they are not re-decided)

- `nmap`, `ps` and `systemctl status` see `redis` for free once the catalog row exists — they read
  `/var/run`, not a service list.
- `apt install redis` starts meaning something the moment the package row gains its daemon.
- Ctrl-C at the password prompt aborts holding nothing (exit 130), as `ftp` and `mysql` do.
- `man`/`help` entries ship with the command, as every other door's did.
- `rediscli` prints `Connecting to <ip>:6379…` then `Connected to Redis <hostname>.`, which is what
  keeps the bare `redis> ` prompt honest about its target.

### Slice spine (each vertical + observable)

- **Slice 1 — a box runs a key-value store.** ✔ **SHIPPED v0.174.0 (#452).** Catalog row
  (`redis`, 6379, banner, flat 0.05), the placement cells, `generateRedisStore` + `pools/redis.ts`
  ported, the public conf and the root-only datadir planted, the pidfile, and the package rename
  `redis-tools` → `redis` with `daemons: ['redis']`. **Three cells, not five** — the `workstation`
  number is the flat rate, so a cell would be the first in that table to change nothing. **The conf
  follows the SERVICE**, not the role, because a store is likeliest on a webserver whose `/etc` slot
  belongs to httpd. **`/var/lib` is composed once**: as two spreads the second replaces the first,
  and a box running both daemons would silently lose a datadir.
- **Slice 2 — a player opens an unlocked store.** ✔ **SHIPPED v0.175.0 (#453).**
  `rediscli <host>` → `redis> ` → `KEYS` / `GET` / `DBSIZE` / `QUIT`, one arrival line on the
  target, both type ghosts deleted along with the `state.ts` narrow that existed only to keep
  one of them out. **The reach became `reachServiceHost`** — one parameter, not a second copy,
  so slice 5's seeded-tree trap stays one gap to close. **`NOAUTH` shipped HERE rather than
  with `AUTH`**, because reads answering a locked store with no credential would have left 60%
  of the world's stores open for a slice; the accepted cost was a locked store naming a verb that
  did not exist — discharged at v0.176.0, one slice later.
- **Slice 3 — a player cracks a locked store.** ✔ **SHIPPED v0.176.0 (#454).** `secretOn`
  lands; `hydra <host> redis` returns a password with no login field; an open store answers *no
  password set (open access)*; attempt lines land in the target's log; `AUTH` and the `[password]`
  positional open the wall slice 2 put up. **Both defects it shipped over were disagreements
  between two SIDES of one rule** — the door accepted `AUTH` with extra words while the prompt
  refused to hold a password off such a line, and `hydra` asked the catalog about a service with
  nothing testing the miss. Each side was correct alone, which is why only mutation found them.
- **Slice 4 — a player changes a store.** ✔ **SHIPPED v0.177.0 (#455).** `SET` and `DEL` land
  and append; `GET`/`KEYS`/`DBSIZE` never do. An open store takes a write from whoever reached
  the port — no account, no tier, no credential — which makes it the game's first write with
  nothing behind it; a locked one refuses in the same words it refuses a read. **The open
  question is answered: verbatim, normalized, capped**, following D6's `Query` line. What
  settled it was that the KEY is player-chosen too, so the summary form removes no player text
  either — the choice was payload size, not presence, and a defender who can tell a poisoned
  session from a deleted one is worth the difference. **The persist is keyed on the store having
  CHANGED, not on the verb**: a `DEL` that matched nothing files nothing, because nothing
  happened.
- **Slice 5 — a store on a deep layer answers.** ✔ **SHIPPED v0.178.0 (#457).**
  `rediscli -p <fwd> <inner gateway>` opens a store on a layer no scan will ever show, and
  `hydra` sweeps the same box down the same walk. **The trap named above was half inherited
  already**: slice 2's `reachServiceHost` carries D6's workaround, so the whole server side
  was already correct and wholly untested, and what was missing was a way to NAME a deep
  target — `rediscli` had no `-p` where `mysql` and `hydra` both do. The slice therefore
  spent its budget proving a shipped path rather than building one, with seven mutants
  applied by hand to show the already-green tests stood on it. Its one real defect was the
  `-p` FLAG DECLARATION, which the shell reads and no test did.
- **Slice 5b — a deep box's own journal is finally read.** Split out of slice 5 rather than
  carried by it. The chain resolver boot-gates and replays every GATEWAY hop but hands the
  terminal box back seeded, so an account a player added there cannot log in, a box bricked
  through its own journal still answers, and a sweep reports what the door then refuses. Redis
  is the first door where the sweep and the door read the SAME file, which turns that last one
  from latent into reachable. **Slice 5 found a THIRD symptom the §9 entry does not name**:
  a daemon a player moved to another port down there is invisible to ROUTING, not merely to
  a door — the same trap one layer earlier, which is what makes per-door compensation the
  wrong place to fix it. Closes the §9 entry for `ssh`, `hydra` and both data doors at once,
  and takes the compensating replay back out of `reachServiceHost`.
- **Slice 6 — a player runs their own store.** `apt install redis` → `systemctl start redis` → the
  mirrored `requirepass` hash. The own-box vantage answers on the CLIENT, so it composes against the
  machine (`env.fs.reload()`) per the v0.172.0 invariant, not against this client's copy of it.
- **Slice 7 — a player reaches another player's store.** The four vantages plus a wire-check.
  Always locked, so always a password — the vacuous-authorization case never arises between players.

**No 6b analogue.** Slice 6b's rule already shipped, so `daemons: ['redis']` makes a generated redis
box's doors closable for free.

**Two things D6 paid for that D7 gets free:** the four-vantage reach is now generic (§7), and
`subShellPrompt()` is a ladder redis adds one rung to — v0.173.0's fix earning its keep on first
reuse.

### Open for planning (named, deliberately not decided)

- **Which of legacy's key generators are retained, and the mix between them.** Believability is the
  criterion, not parity — the same call D6 made about table templates.
- **How a webserver's store reaches the site name** the box serves, without coupling the two
  generators badly. Both seed off the same host, so the draw is available; the shape of the reach
  is what matters.
- **Whether a mutation log line carries the key and value verbatim or a summary.** Verbatim is a
  fine artefact for a defender; it also writes arbitrary player-typed text into a file other players
  `cat`. D6 left the same question open.
- **Which existing `api/*.ts` file takes the statement action.** A file in `api/` IS a published
  Vercel function, so no new file may be added for a helper.
- **Slice 1's seed stream.** It adds draws to generation, so it takes its own stream or it moves the
  octets the lease allocator excludes — D5b's hardest-won invariant, and the one that most directly
  threatens this slice. The same trap slice 1 of D6 carried.
- **Whether `secretOn` returning `undefined` and an absent `secretOn` need to read differently.** An
  open store and a door with no secret concept are not the same statement, and only one row has an
  opinion today.

## D8 — resolved scope & decisions (grill-me, 2026-08-27)

Ten locked decisions. The row above was written in July against legacy's shape and is
**superseded by this section wherever the two disagree** — most of all on `snmpd.conf` carrying its
own firewall and ACL OIDs, which is the one thing this grill refused.

### Grounding that reshaped the scope before any decision

- **The row's port-authority design is already obsolete.** v2 shipped both files legacy's OIDs
  would duplicate: a router's `/etc/iptables/rules.v4` (default-DENY, `forward <public_port> to
  <internal_ip>:<internal_port>`) and a switch's `/etc/switch/acl.conf` (default-ALLOW, `deny
  <port>`), each with a lenient parser and each already in the cross-player read allowlist. Porting
  `snmpFirewallParser` and `snmpAclParser` verbatim stands up a THIRD and FOURTH authority over the
  same fact — which is precisely the bug #462 fixed and #463 wrote guards for, one week earlier.
- **Scaffolding exists for a door that was never built.** `aptPackages.ts` already carries
  `{ name: 'snmp', binaries: ['snmpwalk', 'snmpset'] }`; `availability.test.ts` already maps both
  binaries to it; and `readFilter.ts` has listed BOTH `/etc/snmp/snmpd.conf` and
  `/etc/switch/acl.conf` in `EXTERNALLY_OBSERVABLE_ALLOWLIST` since Story 2 — ported from legacy's
  filter, with no live consumer to this day. Neither binary is affected by #464: `snmpwalk` and
  `snmpset` are already the real names.
- **v2 models no protocol at all.** Legacy's `snmpwalk` gates on `p.protocol === 'udp'`; v2 ports
  carry no protocol, and `nmap` hardcodes `/tcp` at the render. UDP/161 is a NEW MECHANISM here,
  not a port number.
- **A switch is a second inner gateway, not a leaf appliance**, and `rolePlacement.switch` is `{}` —
  it runs literally nothing. Today a switch is a gateway a player can scan and never touch.
- **Default-deny kills legacy's write model outright.** `RULES_V4_SEED` is a header and a commented
  example that parses to an EMPTY table, so legacy's flip-an-existing-line `snmpset` is a permanent
  no-op against every router in v2 — and appears to work on switches only because `ACL_CONF_SEED`
  happens to ship one active `deny 8080`.
- **Tier 3 is defense-in-depth, not a player path.** `resolveCrossPlayerFs` is keyed by a
  `machine_id` obtained from a login and every client caller passes a live session's id, so gating
  the port table behind the RW community is a real secret rather than a lie a player can route
  around by reading the file.

### Locked decisions

#### 1. Generation places snmpd on routers and switches only

Flat `placement: 0` plus `switch: 0.9` and `router: 0.6` in `rolePlacement` — the target set falls
out mechanically, with no special case, because `placementOf` returns the flat rate for every role
that has no cell. The switch is near-certain because it runs NOTHING else: a switch that fails its
snmp roll stays the untouchable gateway this decision exists to end, so a low rate there would
defeat its own purpose. The router sits at a clear majority but not a given, so an SNMP-managed
router is a lead rather than scenery and `ssh` stays the reliable way in. **The player's own AP
gateway is PINNED** — it always runs `snmpd`, the way `seedApGatewaySshd` already resolves to 1 via
`placementOf('router', ssh)`. Rolled instead, a minority of players would draw a world where this
door's cross-player half simply does not exist for them: nothing to defend, and slice 7 untestable. This is the door that distinguishes a network device from a host, and it gives the
`switch` role its first reason to exist. Flat placement would have repeated the mistake redis was
corrected for: at any non-zero flat rate, more SNMP boxes in the world would be laptops and TVs
than routers.

#### 2. OIDs are a VIEW over `rules.v4` and `acl.conf`, never a second copy

`snmpwalk` RENDERS the existing files as OIDs and `snmpset` writes them back. A router's
`forward 2222 to 10.0.0.10:22` reads as `natForward.2222`; a switch's `deny 22` reads as
`aclPort.22`. ONE fact, TWO interfaces — nano-over-ssh, and snmp-without-a-shell. Nothing
downstream changes: the scan and routing paths keep reading the same single source, so the door
cannot desync from what the box actually does, and the row's promise becomes exact rather than
approximate.

#### 3. No session row — the community is re-validated per set

An `snmpSet` action re-reads the target's community and validates it on EVERY set, exactly as
`mysqlStatement` and `redisStatement` do. D6's grill found that minting a session row hands over
the whole box, because `authorizeMachineAccess` never inspects session kind — any row grants
`listPatches`/`upsertPatch` at its tier. Legacy mints its SNMP session at `userType='root'`, which
is that same hazard at maximum blast radius. It also makes `systemctl stop snmpd` evict a connected
player for free, as it did for mysql.

#### 4. The read-only community is plaintext; the read-write one is an md5 in a root-only file

`snmpd.conf` stays world-readable and carries the identity OIDs plus `rocommunity public` in the
clear — the RO string being public is the actual joke of real SNMP, so plaintext there is correct
rather than a leak. The RW string ships as an md5 in root-only `/var/lib/snmp/snmpd.conf`
(net-snmp's real persistent-state path), and `secretOn` reads it. Left plaintext, it would sit on a
NO-SESSION-readable rung and be handed to anyone for free, which defeats `hydra` and the whole door
before it ships — the trap D7 caught for `requirepass`, one tier worse.

**Legacy's `nsExtendArgs` credential leak is REFUSED, not deferred-by-omission.** Legacy's
`snmpd.conf` carries `nsExtendArgs.backup --user <username> --pass <password>` — a real account's
password in plaintext, visible to an RW walk. It is a strong beat and it is also D2.6b, which is
POSTPONED by owner decision. Shipping it here would reverse a standing decision as a side effect of
a different door, and would put a plaintext credential on a tier-3-readable rung. **What it gains
instead is a destination**: an RW-gated OID on infrastructure is a better home for harvestable loot
than anything D2 proposed, so when D2.6b arrives this is the vehicle to reach for, and the
postponement stops being merely parked. The rule that binds it then: a leak from the UNCRACKABLE
pool bypasses locked decision 6 outright, so whatever lands must come from the crackable half —
a time-saver, never a way past the wordlist.

#### 5. `public` returns identity; the RW community returns identity plus the port table

`sysDescr`/`sysName`/`sysContact`/`ifDescr`/`ifAddr` for the RO string — you learn what the device
IS. The RW string additionally renders the NAT or ACL table, so you see WHICH ports are forwarded
and where they go before writing one. Matches legacy's `isPublicOid` split and gives the crack a
payoff a player can SEE, which is what tells them the sweep landed.

**The rendered form** is real MIB prefixes and real types, column-aligned, over only the OIDs the
game models — the `rules.v4` treatment: unmistakably the real tool at a glance, with every line
mapping 1:1 onto a fact the world actually holds.

```
Querying 10.0.0.1 with community string "public"...
[READ-ONLY] Community "public" accepted.

SNMPv2-MIB::sysDescr.0    = STRING:    Linux gw-main
SNMPv2-MIB::sysName.0     = STRING:    gw-main
SNMPv2-MIB::sysContact.0  = STRING:    netops@corp.local
IF-MIB::ifDescr.1         = STRING:    eth0
IF-MIB::ifDescr.2         = STRING:    eth1
IF-MIB::ifAddr.1          = IpAddress: 10.0.0.1
IF-MIB::ifAddr.2          = IpAddress: 82.14.203.77

7 OIDs returned. Community "public" is READ-ONLY.
Retry with a read-write community to see this device's port table.
```

The read-write walk appends the port table, rendered from the file rather than stored twice:

```
NAT-MIB::natForward.2222  = STRING:    10.0.0.10:22     (a router, from rules.v4)
ACL-MIB::aclPort.8080     = STRING:    deny             (a switch, from acl.conf)

Writable: snmpset <host> <community> natForward.<port>=<ip>:<port>
```

`IpAddress` rather than `STRING` for addresses is the one place real SNMP typing carries
information, so it is kept. The full net-snmp walk was REJECTED: `sysObjectID`, `Timeticks`,
`ifPhysAddress` and `ipAdEntAddr` are OIDs the game can neither model nor let a player act on, and
they bury the one actionable line in noise. The `Writable:` trailer is neither legacy's nor real
net-snmp's — it turns a cracked community into an immediately actionable next step instead of a
manual lookup, on the one door whose whole promise is the write.

> **SUPERSEDED at v0.195.0 — the rendered form only; every other part of decision 5 stands.** The
> module prefixes and the type column are gone, an interface is one line, and the trailer carries
> the address and community the caller actually used. What forced it: the walk printed
> `NAT-MIB::natForward.2222` while `snmpset` accepted `natForward.2222` alone, so a player pasting
> back the device's own line was told the name did not exist — the door's own output refused by the
> door. Realism was being spent on a surface the player has to AUTHOR from, and the invariant that
> replaces it is **what a walk prints is what a set takes, on every line**. `natForward` also became
> `forward`, the verb the device's own `rules.v4` already uses. The read-only/read-write split, the
> `Writable:` trailer, the kind-not-version rule and the rejected full net-snmp walk are all
> unchanged. As-built in `conventions-and-gotchas.md` §7.
>
> ```
> [READ-WRITE] Community "corpnet" accepted on 10.0.0.1.
>
> sysDescr     = Linux gw-main
> sysName      = gw-main
> sysContact   = netops@corp.local
> interface.1  = eth0 (10.0.0.1)
> interface.2  = eth1 (82.14.203.77)
> forward.2222 = 10.0.0.10:22
>
> 7 OIDs returned.
> Writable: snmpset 10.0.0.1 corpnet forward.<port>=<ip>:<port>
> ```

**A device names its KIND, and no version.** A router reads `Linux <hostname>` with `eth0`/`eth1`;
a switch reads `Cisco IOS L3 Switch <hostname>` with `GigabitEthernet0/1`. That split is what makes
a switch feel different from a router in the only tool that ever inspects one closely. Legacy's
versions (`5.4.0-generic`, `15.2(4)E`) and its `# net-snmp 5.9.1` config header are all OMITTED: a
version stated here is a second source of truth for the fact vulnerabilities are keyed on, two
phases before V1 decides where a device version lives, and `readFilter`'s own tripwire is already
watching for kernel CVEs. `sysDescr` is the obvious CARRIER for a non-Debian device's version when
V1 arrives — a gift to that phase rather than a conflict with it.

#### 6. `ServiceSpec` gains a `protocol` column, defaulting to `'tcp'`

`nmap` renders `${port}/${protocol}`, so snmp reads `161/udp` and every existing row is untouched.
Honest to the protocol without inventing a UDP transport. This is a COLUMN ARRIVING BECAUSE
SOMETHING CONSUMES IT, which is the catalog's own stated discipline. Snmp stays visible to a plain
`nmap` rather than waiting behind an unbuilt `-sU`: D7's whole lesson was that a door nobody can
discover is a door nobody plays.

#### 7. The device gets its own `/var/log/snmpd.log`, with three line kinds

`formatArrival` for a walk reaching the agent, `formatAttempt` for one community guess (the hydra
wall), and a SET line naming the oid, `old → new`, and the source IP — derived server-side from the
caller's verified key, never from anything the client claimed. Legacy logs NOTHING here. On every
other door silence is a gap; on this one it is a defect, because an `snmpset` rewrites the NAT
table with no shell and no session, so the log is the defender's only possible tell.

#### 8. The AP gateway answers SNMP with its own independently seeded RW community

Drawn from the EXISTING two pools in its own seed namespace, separate from `ap-gw-admin-`, at a new
`CRACK_CHANCE.community` of **0.6**. Same pools because locked decision 6 makes the wordlist the
sole gate: a dedicated community pool would need a second wordlist and a second progression to
tune, and the shipped `passwords.txt` already cracks these. The believability cost is accepted — a
community reads like a password rather than like `private` — and real communities are arbitrary
strings anyway. Softer than the gateway's root at 0.4 for two reasons that agree: a community
string is the weakest secret on a real network, left at defaults far more often than a root
password, and this one buys port control ONLY. A rate at or below root's would make the door
pointless, since root already grants `nano` on the same file. So snmp is a
genuinely independent second way in: a player may crack the community without ever getting admin,
and open a forward into someone's LAN with no shell. It does not trivialise the box locked decision
1 names as the root target, because SNMP grants PORT CONTROL AND NOTHING ELSE — no file read, no
command — so it is orthogonal to root rather than a cheaper version of it. Mirroring it onto the
admin password (D7 slice 6's move) would protect nothing here: that password is ESSID-seeded and
deliberately crackable at the best rate in the game, so the mirror would only make snmp a redundant
path to a credential already cracked.

#### 9. `snmpset` has parity with `nano`, and a forward must target the device's own segment

It may add or remove a forward on a router and add or remove a deny on a switch, reusing each
file's existing parser as the single validity gate. This is FORCED rather than chosen: default-deny
means a fresh router has no line to flip, so anything less makes `snmpset` dead on arrival against
the exact box the epic aims players at.

#### 10. One package, both halves — and a workstation agent gets a local firewall

`snmp` ships `snmpwalk`, `snmpset` and `snmpd`, installable anywhere, following mysql and redis.
On a workstation the install plants `/etc/iptables/rules.v4`, and `iptablesRules.ts` gains a
**`deny <port>`** rule kind beside `forward` — the INPUT chain to the router's NAT chain, which is
what a real `rules.v4` carries. NAT itself does not port to a workstation: NAT needs a public-facing
address and a segment behind it, and a workstation has one interface and a leased octet, so a
forward table there would parse empty forever. The local filter needs no topology, no public IP and
no new parser, and it buys a verb the game does not have — today the only defence against a door is
`systemctl stop`, which kills the service outright, whereas a filter keeps it running for you while
closing it to the network. The attacker's prize is symmetric: crack the community, re-open a port
the owner filtered, without a shell.

#### 11. A set overwrites, reports both values, and may lock the caller out

A public port that already carries a forward is OVERWRITTEN, and the `snmpd.log` SET line records
`old → new` — decision 7's shape doing real work. A forward table is keyed by public port, so one
port holding two destinations is not a state the file can represent: overwrite is the only coherent
answer, it is what the owner's own `nano` edit would do, and the log is what keeps it from being
silent. Refusing until the port is freed would be two round-trips for one intent, and unlike any
editor of the same file.

**A caller may remove the forward they arrived through, and the device then stops answering them.**
No guard. SNMP reaches a gateway on its own port, so most removals cannot sever the caller's path
at all; where one can, the device going quiet is the honest consequence and what real equipment
does. A guard would require the resolver to carry a fact it does not have — which route the caller
came in by — in order to prevent a mistake the player can undo from the LAN side.

### Forced rather than chosen (planning should not re-litigate)

- **`snmpd` must land in `DAEMONS` and `UNITS` the moment the catalog row exists.** `systemctl`'s
  own guard — "gives every door in the catalog a daemon a player can act on" — goes red otherwise.
  Written one week earlier, in #463, against this exact failure.
- **The one-row-per-device guarantee is already free.** `targetWriterKey = writerKey ?? publicKey`
  resolves to the OWNER's key for a player-owned box, so however many strangers reconfigure a
  device it keeps one row and one log. The warning the D7 close-out left for this row is already
  answered by the resolver it left behind.
- **`accountsOn: () => []` plus `secretOn`** — redis's shape verbatim, and the reason `secretOn`
  was widened in the first place. A community string is a service's secret, not a person's, and the
  sweep line omits the login field.
- **The local filter blocks remote traffic (world AND same-LAN) but never localhost**, so D7 slice
  6's `redis-cli 127.0.0.1` own-box path is unaffected. Real INPUT chains behave this way, and it
  is what makes "keep the service for yourself, close it to the network" true rather than a slogan.
- **A forward and a local deny are both gates.** Traffic needs both to permit. Neither file learns
  about the other; the reach path already consults each where it lives.
- **A stopped `snmpd` reads as unreachable, not as refused.** D7 slice 5b split routing from
  liveness so `service_not_running` and `host_unreachable` mean the same thing at every depth; this
  door inherits that and invents no third answer. A device whose agent is stopped is simply not
  there, which is also what makes `systemctl stop snmpd` a real defence.
- **Slices 3, 4 and 7 touch `api/` and therefore owe a `scripts/test*.ts` wire-check.** The sweep
  and the set are server-executed; slices 1, 2 and 6 may be able to record `N/A` on checked facts
  the way D7 slice 6 did, but only after re-examining rather than by assumption.

### Slice spine (each vertical + observable)

```
D8 slice 1  a device answers SNMP            nmap shows 161/udp snmp on a router/switch
D8 slice 2  a player walks it with `public`  identity OIDs return; the walk lands in snmpd.log
D8 slice 3  a player cracks the RW community hydra <host> snmp (no login field) → the port table
D8 slice 4  a player opens a port, no shell  snmpset adds a forward; nmap shows it; the box answers
D8 slice 5  a device on a deep layer answers the inner-gateway vantage, via reachServiceHost
D8 slice 6  a player runs their own agent    owner filters a port; a neighbour fails, 127.0.0.1 works
D8 slice 7  a player reconfigures another's  B opens a forward into A's LAN; A's snmpd.log names B
D8 slice 8  a player's own agent answers     an installed agent gets a community; B re-opens a
                                             port A filtered  (found while planning slice 7)
```

### Gaps closed (find-gaps, 2026-08-27)

Ten candidates surveyed against the plan checklist; eight material, all closed, none parked.

```
[Blocker → decision 1]   placement rates + whether the AP gateway is pinned
[Blocker → decision 4]   legacy's nsExtendArgs plaintext credential
[Blocker → decision 8]   which password pool, and the community crack rate
[Should  → decision 11]  snmpset onto an already-forwarded port
[Should  → decision 11]  removing the forward the caller arrived through
[Should  → decision 5]   legacy's `# net-snmp 5.9.1` version header
[Should  → decision 5]   the rendered walk output, and the Writable: trailer
[Should  → decision 5]   what sysDescr says, and the router/switch split
[Nice    → forced list]  the error a stopped snmpd reports
[Nice    → forced list]  which slices owe a wire-check
```

The three Blockers shared one shape: **decisions 1 and 8 named a mechanism and omitted the numbers
that make it real** — the same gap D7's grill had to close for redis, and the reason
`rolePlacement` carries exact cells rather than adjectives.

One consequence emerged only from combining two answers, and is recorded because neither implies it
alone: the AP gateway is PINNED to run `snmpd` and its community cracks at **0.6**, so a majority
of players can have their gateway's port table rewritten by any neighbour who sweeps. That is the
door working as designed — `snmpset` grants port control, never a shell or a file read, and the
defender keeps `snmpd.log`, `systemctl stop snmpd` and a rewritable community — but it is a
materially higher exposure than any door before it, and the first number to retune if the world
turns out to feel hostile.

### Open for planning (named, deliberately not decided)

- **How `snmpwalk` addresses a forwarded inner gateway.** D7 used `redis-cli -p <fwd> <inner
  gateway>`; legacy's `snmpwalk` has no `-p` and real `snmpwalk` takes `host:port`. Slice 5 picks
  one and the choice binds `snmpset` too.
- **Whether slice 5 needs any production change at all.** `reachServiceHost` takes the daemon as a
  PARAMETER, so D7 paid nothing for reach and spent two slices proving paths that already worked.
  Budget slice 5 for EVIDENCE, not plumbing, and expect RED to come from mutating production.
- **Whether an installed agent on a workstation is scannable from off-box.** Placement covers
  generation only; a player who installs and starts one has opened a port the placement table never
  rolled.

## D9 — resolved scope & decisions (grill-me, 2026-09-01)

Eleven locked decisions. The row above was written in July against legacy's shape and is
**superseded by this section wherever the two disagree** — most of all on programmatic auth, which
is the one thing this grill refused: v2's `CommandEnv` is a per-line snapshot, so a script that
hopped would go on answering about the box it left.

### Grounding that reshaped the scope before any decision

- **Legacy's whole mechanism is gone.** Legacy commands were `fn(...args) => unknown`, so
  `useCommands.ts:445` could snapshot every `cmd.fn` into a namespace and hand it straight to
  `new Function`. v2's contract is
  `execute(env, args: readonly string[], flags: ReadonlyMap) => Promise<CommandResult>`
  (`commands/types.ts:1207`). A script-facing function is now an ADAPTER — JS arguments in, a
  collected `CommandResult` out — and every call is necessarily awaited.
- **`env` is a point-in-time snapshot, built once per submitted line** (`ui/state.ts:1557`).
  `env.session` is a value, not a getter. Legacy's documented *"`su` is synchronous so subsequent
  lines run as the new user"* (`commands/README.md`) cannot port: a pushed session is invisible to
  the rest of the script.
- **The result kind cannot tell you what a command did.** `ssh`/`su` push a session and return
  `{kind:'sync', lines: [], exitCode: 0}` — byte-identical to a no-op. `mysql`/`redis-cli`/`ftp`
  call `env.*.enter()` and return a greeting. Only `nano`/`lynx`'s `mode_change` is visible in the
  type, so a refusal rule cannot be derived from the return shape.
- **`withoutTty` is a DIFFERENT fact from "cannot be scripted", and reusing it would be wrong at
  both ends.** It marks eight commands; it misses `nc`, `exit`, `reboot` and `new-game`, and it
  catches `scp` — which pushes no session, returns no `mode_change` and enters no sub-shell. `scp`
  is a transient transfer that only prompts because v2 dropped legacy's password positional
  (`scp.ts:375` prompts unconditionally).
- **A `const`/`let` collision with an injected name is a SyntaxError that kills the whole script.**
  Verified: `new AsyncFunction('fs', 'const fs = 1')` throws
  `Identifier 'fs' has already been declared`, because context keys are formal PARAMETERS. Since
  every command name is injected, `const cat = …` would take a script down for a reason the player
  cannot see. Block-wrapping the body fixes it outright —
  `new AsyncFunction('fs', '{ const fs = 1; … }')` shadows legally and passthrough still resolves.
  Same family as the hyphen trap conventions §2 already warns about.
- **The execute bit is a hard block with no in-game way out.** `defaultFilePermissions` stamps
  `execute: ['root']` on every new file and v2 has **no `chmod` command** — `/bin/chmod` is one of
  six binary stubs (`find`, `strings`, `nslookup`, `dig`, `ldd`) that answer `command not found`.
  The codebase already documents the trap from the other side: `PatchApi.write` carries a
  `permissions` override because *"the default file perms are root-only-executable, which the
  user-tier player could never run"* (`commands/types.ts:200`). Port legacy's read-AND-execute gate
  (legacy `node.ts:88-94`) and no non-root player can run a script they just wrote.
- **Writes are asynchronous; reads are not.** `env.fs.read` is sync, `env.patches.write` returns
  `Promise<PatchResult>` (a server round-trip). A `writeFileSync` would be a lie.
- **All four of legacy's script pools are mission machinery.** `scriptAuto`, `scriptFix`, `malware`
  and `forensics` are driven by `attackChain.ts` and `objectiveType`. Missions are post-ship by
  owner decision, so legacy generated no scripts outside them.
- **Already solved, already free.** `{ name: 'node' }` is in `APT_PACKAGES` and deliberately NOT in
  `LOCALHOST_PREINSTALLED_TOOLS` (`binaries.ts:76`, *"Don't 'restore' them here"*); the hyphen trap
  is settled (conventions §2 — derive a camelCase identifier); cancellation is `env.signal` +
  `env.sleep`, so legacy's `ScriptCancelledError` / `innerCancel` / `sleepReject` machinery is dead
  weight; `writeFile` is `env.patches.write`, the same call `>` uses.

### Locked decisions

#### 1. A script runs entirely inside the session that launched it — the pivot is OUT OF SCOPE

The row's *"programmatic auth (`ssh(…, pw)`)"* is **refused, not deferred by omission**. `env` is a
per-line snapshot, so `ssh('root@10.0.0.5','pw')` followed by `cat('/root/flag')` would push a
session the script cannot see and then read the box the player was standing on — not a limitation
but a lie, the same class as the whole-file-write-against-a-stale-tree defect fixed at v0.172.0.
Legacy documented the pivot and never wrote a test for it.

The alternative was a `rebuildEnv: () => CommandEnv` seam so each call re-derives — feasible, since
every adapter in `state.ts` already closes over signals, but it inverts the core↔UI boundary by
having `core/` ask the UI to re-derive itself mid-command. The valuable half of the row needs none
of it: `hydra`, `nmap`, `curl`, `gobuster`, `snmpwalk`, `john`, `cat`, `grep` and the file helpers
are a recon-and-capture loop, not a pivot loop. **The row's acceptance example changes
accordingly**: chaining `hydra` across many hosts and capturing the results to a file, not chaining
`hydra` + `ssh`.

#### 2. `withoutScript` declares the refusal, per command; `nc -l` is the one exception

A new `Command` field mirroring `withoutTty`, whose own doc comment argues the case: *"a field
nobody had to fill in is a field that can be declared without being enforced… declaring the rule
and saying what it sounds like are the same act."* Checked once, centrally, in the script adapter,
BEFORE `execute` — so nothing side-effects first.

Membership is derived from three structural facts, not taste:

| Why | Commands |
|---|---|
| pushes or pops a session the script cannot see | `ssh`, `su`, `nc` (connect form), `exit`, `reboot` |
| returns `mode_change` — a screen | `nano`, `lynx` |
| calls `env.*.enter()` — a sub-shell prompt | `mysql`, `redis-cli`, `ftp` |

Ten in all. `scp` is **not** among them, and neither is `new-game`: it prompts for confirmation,
`env.prompt` resolves fine from a script, and refusing it would break decision 8's invariant for no
gain.

**`nc -l <port>` is exempt**, by owner decision, and the reason is Phase 3: `script_exec` as a CVE
effect makes *opening a backdoor on a box you never logged into* one of the best beats in the game,
and legacy's own remote-script surface (`runScriptOnTarget`) already carries `nc` for exactly that.
The encoding falls out of `nc.ts:279`, where the listen/connect split is already the first line of
`execute`, keyed on a declared boolean flag: `withoutScript` is
`string | ((args, flags) => string | undefined)` — nine commands state a refusal, `nc` states a
function of the form, making the same test one layer up, still before any side effect. One narrow
at one call site.

The rejected alternative was **structural enforcement** — no field, a `pushSession`/`enter` that
throws, a rejected `mode_change` return. It splits `nc` for free and is impossible to forget, but
the refusal lands AFTER the side effect: `ssh` authenticates against the server, writing a real
line into the target's `auth.log`, and only then does the script error. That is precisely the
hazard `prepareStage` avoids by validating every stage before running any.

#### 3. A call returns `string[]` carrying `.exitCode`; stderr goes to the terminal

Exit codes are real and load-bearing in v2 — `cat.ts:91` returns 1 when any line errored, a refused
door returns 1 — and a sweep that had to string-match output to learn which host fell would rot.
An array with an extra property is canonical JS, not a trick: `String.prototype.match` returns
exactly this shape (`.index`, `.input`, `.groups` on an array). So `.join`/`.filter`/`.map` and
`fs.writeFile(path, out)` all work unchanged, and the exit code is there when wanted:

```js
const out = await hydra(host, 'ssh');
if (out.exitCode === 0) await fs.writeFile('/root/loot/' + host + '.txt', out);
```

The cost, which the manual page owns: spreading the array (`[...out]`) silently drops the property.

`error` and `dim` lines go straight to the terminal as the command emits them, matching the
pipeline's stderr rule (`runLine.ts` pipes only `text` lines) — so a script's failures are visible
even when the script ignores the return value.

#### 4. Output is CAPTURED, not printed; the busy label tracks the inner command

Exactly `child_process.execSync`: stdout returns to the caller, stderr is inherited. Legacy did
both — `wrapCommandForAsync` forwards every line to the terminal *and* returns it — which makes the
natural script double-report, splatting twelve lines of `hydra` per host underneath its own
one-line summary. Capturing is also what makes the row's *"captures results to a file"* mean what
it says.

The cost is that a script sweeping eight hosts is **silent for as long as it takes**. Two things
answer it: a script can `console.log` its own progress, which is what real scripting looks like,
and **the busy indicator tracks the inner command** rather than reading `node` for the whole run
(`runningCommand` is set from the first word of the line, `state.ts:1573`). One callback, and it is
the difference between "working" and "hung".

#### 5. `console.log`, not `print` — its three sinks are the three `TerminalLine` kinds

Not taste: #464 renamed six commands to their real binaries and conventions §2 locked *"command
names carry the real binary's name."* A runtime called `node` whose print function is `print`
contradicts the rule the project just spent a PR enforcing; `print` is Python's.

It costs nothing, because `console`'s three methods are already the three line kinds the
terminal renders:

| script | `TerminalLine` kind | renders as |
|---|---|---|
| `console.log` | `text` | normal — and this is the script's **stdout** |
| `console.error` | `error` | error styling — a script's stderr |
| `console.debug` | `dim` | dim |

**AMENDED 2026-09-01 at slice-1 planning, by owner approval.** This decision first routed the
three methods through `env.output`. That is the wrong pipe: `env.output` appends straight to
scrollback and **bypasses the pipeline entirely**, because `collectStageOutput` reads
`result.lines` — so `node sweep.js | grep OPEN` and `node sweep.js > /root/out.txt` would both
have seen nothing, while real `node` pipes stdout like anything else. **A script's output is
therefore the `node` command's own `CommandResult` lines**, which makes it pipeable and
redirectable for free and keeps `console.log` meaning stdout. The user-visible mapping above is
unchanged. Consequence for the spine: **slice 1 returns `kind: 'sync'`** (nothing in it is slow,
so streaming buys nothing and would cost a producer/consumer bridge, since `console.log` is
called from arbitrary depth and cannot `yield`), and **slice 2 moves to the existing
`streamedResult` convention** (`commands/streaming.ts`) when commands make liveness real — which
is also where decision 4's live busy label lands.

Multiple arguments join with a space; objects stringify as JSON rather than `[object Object]`,
and a `string[]` renders one element per line — one formatter, shared with `fs`, so that
`console.log(await hydra(…))` prints captured output as lines rather than as a JSON array.

#### 6. `fs` is ambient — no import, no `require` — and the sandbox body is block-wrapped

Three methods, all awaited, so **one rule governs the whole language: everything in a script is
awaited.**

```js
await fs.readFile(path)          // → string
await fs.writeFile(path, data)   // data: string | string[] | object
await fs.appendFile(path, data)  // the shell has no >>, so a script gets append FIRST
```

No `exists`: it is the only one that could legitimately be synchronous, so it would be the single
exception to the rule, and `await fs.readFile` in a try/catch already answers the question. No
`readdir`/`unlink`/`mkdir`/`stat` — `await ls(…)`, `await rm(…)`, `await mkdir(…)` are already
there as commands. No `*Sync` names at all: writes are a server round-trip
(`PatchApi.write` → `Promise<PatchResult>`), so a synchronous name would be a lie about when the
write landed.

**The body is wrapped in a block, `{ …source… }`**, which is what makes shadowing work: a script's
own `const fs = …` legally shadows the injected parameter instead of throwing
`Identifier 'fs' has already been declared` and killing the script. The rule is then simply true of
every injected name, commands included.

#### 7. Flags are a trailing object with dashed keys, validated against the command's own `FlagSpec`

`hydra('10.0.0.5', 'ssh', { '-p': '2222' })`, `apt('list', { '--installed': true })`. The object
IS the flags map — `new Map(Object.entries(flags))`, zero mechanism — and dashed keys survive every
shape v2 actually has: `-p` is `'boolean'` on `mkdir` but `'string'` on six other commands, `rm`
distinguishes `-r` from `-R` by case, long flags exist (`--installed`, `--yes`), and `nmap -sV`
arrives with V1. Any bare-key rule ("one char → `-x`, more → `--xx`") breaks on `-sV`. For this
game it also reads BETTER: it is the shell line the player already knows.

Three details bind with it: the trailing object is always flags and every other argument coerces to
a string, so `nc(4444, {'-l': true})` works; numbers coerce (`{'-p': 2222}` → `'2222'`); and **the
script gets the shell's errors as thrown exceptions**. A script bypasses `bindFlags` entirely, so
nothing would otherwise catch `{'-P': 2222}` against a command declaring `-p` — the prompt says
`unrecognized option`, and a script that silently ignored it would have a failure mode the prompt
does not. Undeclared flag, `true` passed to a `'string'` flag, and a string passed to a
`'boolean'` one all throw.

#### 8. Read permission only — no execute gate, no `chmod`

Real `node script.js` opens the file for reading; the execute bit governs `./script.js`, which is
the kernel-plus-shebang path, not node's. So the realistic answer is also the unblocking one:
`chmod` stays in the long tail where locked decision 9 put it, and D9 does not grow a second
command whose only content is a friction step.

It carries the invariant that IS this feature's security posture:

> **A script can do exactly what the player could type at that prompt, and nothing more.** Every
> call goes through the same `Command.execute`, with the same `env`, at the same session tier,
> through the same walker. `node` grants no capability — it removes typing.

A guest scripting `hydra` is therefore fine: they need it installed, and `apt` is root-only,
exactly as at the prompt.

#### 9. Ctrl-C at every await; a synchronous infinite loop is an accepted tab-hang; `sleep(ms)`

`new AsyncFunction` runs on the browser's main thread and an `AbortSignal` cannot interrupt
synchronous JavaScript, so `while (true) {}` in a player's script locks the tab dead. This matters
more here than in most software, because the player writes these scripts in `nano` on a box.

The adapter checks `env.signal` before and after every command invocation and throws the abort, so
the realistic accident — `while (true) await nmap(…)`, or a sweep over the wrong array — **is**
interruptible, and streamed commands already unwind on it (`state.ts` catches the abort and prints
`^C`). A purely synchronous infinite loop is **accepted, documented and parked**: the real fix is a
Web Worker with `worker.terminate()`, but then every command call becomes a postMessage RPC across
a boundary `CommandEnv` does not serialize (live functions, `AsyncIterable` results, server calls)
— a large mechanism for a self-inflicted wound whose blast radius is one tab, since progress lives
in the patch model server-side and a reload costs scrollback and history, nothing else.
Conventions §2: *"scope creep kills indie multiplayer faster than security holes."*

**`sleep(ms)` maps to `env.sleep`** rather than being left to
`await new Promise(...setTimeout...)` — precisely because the hand-rolled form is not abort-aware,
and a sleeping script would otherwise be the one thing Ctrl-C could not reach. Wiring it to the
env's abort-aware sleep keeps the interruption rule absolute at every await.

#### 10. Errors go to stderr and exit 1; no stack traces; real `process.argv`

Legacy printed `Error: <message>` as a normal line and completed successfully, so a script that
blew up on line 1 looked like a script that ran — and could hide inside a pipeline. Instead: the
error goes to `output.error`, formatted as real node's final line
(`TypeError: cat is not a function`), `node` exits **1**, and everything the script already printed
stays, because it was streamed as it happened. A refused command throws its declared refusal, so
`ssh: cannot be run from a script` reads identically to a refusal at the prompt. A nonzero
`exitCode` from an inner command does **not** throw (decision 3) — only genuine JS errors and
refusals do.

**No stack trace, as a deliberate refusal rather than an omission.** V8 wraps a `Function` body in
two synthetic lines of its own before ours, so every line number in a stack is offset by a constant
the player cannot see, pointing at `<anonymous>`. A stack that lies about where the error is, is
worse than none. Real node's caret-and-source-line block is a follow-up if ever wanted.

**`process.argv` gets real Node semantics** — `argv[0]` is `/usr/bin/node`, `argv[1]` the resolved
script path, user arguments from index 2, so `process.argv.slice(2)` is what a script writes.
Legacy put the first user argument at `argv[0]`, which is wrong against the real thing, and #464
just spent a PR establishing that this project uses the real names.

#### 11. No content generation, and no example script

D3 is the precedent for a row that legitimately generates nothing — *"no content generator, since
the target's filesystem is the content"* — and D9 is that, more so: the script the player writes IS
the content.

Scattering `.js` files across generated boxes is **refused on D8's own reasoning**: a script worth
finding is one that carries a credential, and that is **D2.6b, postponed by owner decision**, which
D8 declined to ship through the back door precisely because reversing a standing postponement as a
side effect of a different door is the wrong way for it to arrive. When D2.6b lands, a planted
script is a good vehicle for it; it should not be the reason it lands.

An example script shipped by `apt install node` via `extraFiles` was proposed and **declined by
owner decision (2026-09-01)**, and rerouted rather than refused: believable per-machine content and
a set of tutorials dropped into the player's home folder are both planned as their own later work
(see "Parking lot"). D9's discoverability is `man node` until then.

### Forced rather than chosen (planning should not re-litigate)

- **Every command call in a script is awaited.** `execute` returns `Promise<CommandResult>` and a
  promise cannot be unwrapped synchronously, so legacy's dual mode — expression-first sync, the
  `HAS_AWAIT` regex, `AsyncFunction` only when a script says `await` — **cannot port**. One mode.
  Legacy's two context builders, echo buffering and expression-vs-statement fallback are deleted
  rather than ported.
- **The context is keyed by a camelCase identifier derived from the command name**, so `redis-cli`
  is reachable as `redisCli`. Already locked in conventions §2; the "no hyphens" note it corrects
  is already marked wrong in D7's grill record.
- **The script host is a pure function over `(source, env, commands)`** — not a design choice, just
  what it is once you notice `execute` receives `env` as a parameter. Phase 3's `script_exec` then
  supplies a different env and reuses the host, instead of duplicating the sandbox the way legacy's
  `utils/remoteScriptRunner.ts` + `buildTargetCommandContext` did (~200 lines re-adapting eight
  commands by hand). **No speculative machinery for it now.**
- **No `api/` change in any slice — wire-check `N/A` throughout, with reasons.** The host is pure
  client: `env` is fully built by the time `node.execute` runs, and `fs.writeFile` routes through
  `env.patches.write`, the same call `>`, `nano` and `touch` use and that is already proven
  cross-player. Nothing new reaches a server. D7 slice 6 set the precedent for recording `N/A`
  rather than running one.
- **`_system` does not port.** It is mission machinery (`script_fix` / `script_auto` objectives),
  and missions are post-ship by owner decision.

### Folded in as routine (recorded so they are not re-decided)

- The host lives in `core/scripting/`, mirroring legacy's `src/scripting/`; `node` itself is a
  thin `Command` in `core/commands/node.ts` joining the registry.
- `{ name: 'node' }` already exists in `APT_PACKAGES` and **stays out of
  `LOCALHOST_PREINSTALLED_TOOLS`** — `apt install node` is the route, exactly as `binaries.ts:76`
  says.
- `node` ships a `manual` page like every other command; it is the whole discoverability story
  until the tutorial work lands, so it carries the API surface — the flags object, `.exitCode`,
  `fs`, `console.log`, `process.argv`, `sleep`.
- One shared stringify helper serves `console.log` and `fs` (strings as-is, `string[]` joined with
  a newline, everything else JSON).
- An empty or whitespace-only script is a no-op at exit 0, as legacy had it.
- Version bump per feature slice in both `v2/package.json` and `v2/package-lock.json`.

### Slice spine (each vertical + observable)

D9 is the one Phase 1 row that is not a door: no daemon, no port, no placement, no target, no
cross-player half. The seven-slice door shape (box runs it → crack it → read → write → deep layer →
own box → someone else's) has nothing to bite on, so the spine is the **capability surface**.

| # | Slice | Observable |
|---|---|---|
| **1** | **A script runs and speaks** | `apt install node`; the sandbox (block-wrapped `AsyncFunction`), `console.log`/`error`/`debug`, the read-permission gate, errors to stderr + exit 1. The player nanos `console.log('hi')`, runs it, sees it; a broken script says so and exits nonzero |
| **2a** | **A script runs the tools** | The adapter: every command as a camelCase global, positional coercion, `string[]` + `.exitCode`, the trailing flags object with `FlagSpec` validation, stderr straight through, and the ten `withoutScript` refusals including `nc -l`'s exemption. `await nmap(…)` returns what the prompt shows; `ssh(…)` refuses in the same words |
| **2b** | **A script speaks while it works — SHIPPED v0.198.0 (#477)** | **SPLIT OUT of slice 2 at 2a's planning (owner decision, 2026-09-01)** — the liveness half is separately observable and fails differently. `node` moves to `streamedResult` so the script's own `console.log` paints as it happens, and decision 4's live busy label lands here, which needs a new `CommandEnv` seam because `runningCommand` is set from the submitted line's first word |
| **3** | **A script keeps what it found** | `fs.readFile` / `writeFile` / `appendFile` + the shared stringify. **The row's own acceptance**: `/root/sweep.js` chains `hydra` across hosts and captures the results to a file |
| **4** | **A script is reusable and can be stopped** | `process.argv`; Ctrl-C at every await; `sleep(ms)`. `node /root/sweep.js 10.0.0.5 ssh`; a long sweep takes `^C` and leaves its partial output |

**The close-out is a browser run, and it has a beat worth targeting**: `ssh` into a box already
rooted, `apt install node` THERE, `nano` a script THERE, run it THERE — the script sweeps from that
box and its `fs.writeFile` lands under that machine. That completes D3b's "carry a wordlist onto a
rooted box" story, and it is exactly the vantage conventions §7 warns wire-checks cannot see.

### Deliberately NOT built (recorded so nobody re-opens them)

The session pivot (decision 1); an `sh('cmd | grep x > f')` escape hatch — a second way to do
everything, needing the whole refusal gate re-applied, when `.filter()` plus `fs.writeFile` already
covers it; `chmod`; world content and the example script (decision 11); a Web Worker sandbox
(decision 9); faked stack traces (decision 10).

### Open for planning (named, deliberately not decided)

- **`scp` is scriptable but always prompts.** v2 dropped legacy's password positional
  (`scp src dst [port] [pw]`), so `scp.ts:375` prompts unconditionally and an UNATTENDED script
  cannot use it. Giving `scp` a password argument is a D3b follow-up if wanted, not D9's job — but
  it is the one surviving piece of the row's "programmatic auth", so decide explicitly rather than
  by drift.
- **What the busy label reads during an inner command** — `hydra` alone, or `node → hydra`. One
  callback either way; slice 2 picks.
- **The exact wording of the ten refusals.** They are player-facing strings and the mutation gate
  will treat them as such (conventions §4: *"a command's mutation score is mostly its manual"*).
- **Whether `withoutScript`'s predicate form earns a second user** beyond `nc`. If nothing else
  ever needs it, collapsing back to a plain string is a cheap later reduction.

## D10 — resolved scope & decisions (grill-me, 2026-09-02)

Fifteen locked decisions. The row above was written in July as *"one polish slice"* over five
comfort commands; this section **supersedes it wherever the two disagree**. It grew in one
direction and shrank in another: locked decision 9's whole long tail folds in here (nothing ever
"first needed" `find`, `strings`, `chmod` or `gpg`, so without D10 they never ship), while `bash`
is **refused rather than ported** — it existed in legacy to run binaries by path inside a PATH-less
NC shell, and v2 has neither.

### Grounding that reshaped the scope before any decision

- **Three of these binaries already exist with no command behind them.** `find`, `strings` and
  `chmod` are stamped into `/bin` on every generated machine (`generation/binaries.ts`
  `SYSTEM_UTILITY_NAMES`), and `gpg` is already a row in `APT_PACKAGES`. `ls /bin` lists tools that
  answer `command not found` — D10 closes three of the six phantoms. The other three are spoken
  for: `ldd` by V4, `nslookup`/`dig` by X1.
- **The client-comfort commands need capabilities that do not exist yet, and the precedent for
  adding one is shipped.** `env.resetGame()` (`ui/state.ts`) is a UI act reached from `core/`
  through the env; `ModeChange` (`nano`, `lynx`) is a screen reached the same way. `clear`,
  `theme` and `xterm` are the same shape.
- **v2 already paints from CSS variables, but only eight of them.** `index.css` defines
  `--theme-{bg,text,text-bright,text-dim,error,caret,scroll-thumb,scroll-thumb-hover}` and every
  `var(--theme-*)` in the tree reads one of those eight. Legacy's palette carries fourteen; the
  other six exist purely for nano chrome, links and the author avatar.
- **A second tab does NOT open a fresh terminal.** `startGame` calls `rehydrateSessions`
  (`ui/state.ts`), which rebuilds the hop stack from the server's active session rows — so a new
  tab lands inside the box the first tab is ssh'd into, and `exit` in one ends a row the other
  still believes it holds. Legacy's `?fresh` param existed to prevent exactly this by clearing the
  per-tab sessionStorage. **The hazard pre-exists `xterm`; without decision 12 the command would
  advertise it.**
- **A node's `owner` is display-only.** `filesystem/types.ts` says it outright: *"the walker
  doesn't read this; permissions are tier-based via `perms`"*. Legacy's chmod rule — only the owner
  or root — has no v2 equivalent that would not make `owner` a second authority over permissions.
- **"Change the permissions, keep the content" is not expressible today.** A patch row is
  `(machine_id, path, writer_key)` carrying `content: string | null`, where `null` **already
  means deleted**. A perms-only patch would need a third state — a migration, an `applyPatches`
  change, an `api/patches` change and a wire-check.
- **The house style for argument surfaces is already settled, and it is not realism.** Every v2
  synopsis simplifies: `hydra [-p port] <host> [service] [user]` (real hydra is `-l`/`-P`/`-t`),
  `john <file>`, `snmpwalk <host> [community]`, `redis-cli [-p port] <host> [password]` (real
  redis-cli is `-a`). #464 bought realism in the binary NAMES, not in the arguments.
- **The masked prompt is shipped and used.** `mysql`, `ftp` and `scp` all ask for a secret through
  `env.prompt({ masked: true })`, which echoes the label and never the value.
- **Only the mission generator ever produced an encrypted file.** Legacy's `attackChain.ts` called
  `encryptContent` and planted the key on a DIFFERENT machine; nothing else in legacy ever wrote
  ciphertext. Missions are post-ship by owner decision, so `gpg` arrives with no producer unless it
  brings one.
- **Two categories and one gate already decide where these land.** `COMMAND_CATEGORIES` is
  `general | filesystem | mission | network | wifi`, and `availability.ts`'s own comments name the
  absentees: *"legacy also had exit/clear/whoami/bash"* (builtins) and *"legacy also had
  missions/accept/abort/mail/author/theme/xterm — re-add each as it ships"* (game commands).

### Locked decisions

#### 1. Nine commands ship; `bash` is REFUSED, not deferred

`clear`, `theme`, `author`, `xterm`, `whoami`, `find`, `strings`, `chmod`, `gpg`. Locked decision
9 split the long tail into "lands in the slice that first needs it" and "one polish slice" — but
nothing ever needed `find`, `strings`, `chmod` or `gpg`, so the first half never fired. D10 takes
the whole tail.

`bash` is the one subtraction. Legacy's `executeBash` resolved a path to a binary, checked the
execute bit and dispatched — machinery that existed because legacy's NC shell had no PATH. v2's
`availability.ts` already resolves `/bin`, `/usr/bin` and `/usr/sbin` and reads each binary's own
`perms.execute` on every command, and v2's backdoor shell is an ordinary session minus what needs
a tty. A `bash <path>` would be a second way to run what the shell already runs.

#### 2. Tools only — D10 generates no world content

`strings` and `gpg` ship ahead of the content that makes them interesting, and that is accepted.
The parking lot's **believable per-machine content** item is what fills them, and it inherits
D2.6b's rule: content carrying a usable credential is **loot**, and loot arrives through the
postponed harvest route. A polish slice planting a credential in a binary, or an `.enc` file with
its key on a neighbouring box, would be building that route ahead of its owner. `strings /bin/ls`
therefore prints only what the shared stub carries, on every machine alike, until the content work
lands — and that is the correct amount of nothing.

**Amended 2026-09-02, planning slice 3.** The sentence above originally said "prints one stub
line", which the constant could not deliver: `BINARY_STUB` is `\x7fELF\x02\x01\x01\x03\x3e\x01`,
whose longest printable run is `ELF` — three characters against `strings`' fixed four-character
minimum — so every binary and every `.so` on every machine printed **zero** lines, and the tool
would have shipped indistinguishable from broken. Slice 3 therefore extends the stub with the
readable tail a real ELF carries (an interpreter path and a glibc version). That is **not** the
world content this decision forbids: this rule owns **loot** — content carrying a usable credential
— and a constant byte-identical on every machine carries no secret and rewards no search.

#### 3. `gpg` is the real CLI, and it ships BOTH halves

`gpg -c <file> [passphrase]` encrypts to `<file>.gpg`; `gpg -d <file> [passphrase]` decrypts to
stdout. The passphrase omitted means the masked prompt (`mysql`/`ftp`/`scp`'s seam); supplied means
no prompt, which is what makes the command usable from a pipeline or a `node` script. The trailing
positional is `redis-cli`'s shape, not real gpg's `--passphrase`, per the house style; `-c`/`-d`
survive as flags because they name two different operations, exactly as `nc -l` does.

The encrypt half is what stops the command shipping dark: it gives the format ONE implementation
**with a producer inside the game**, so the tool is provable end-to-end on day one, a player can
hide something from whoever roots them, and the later content generator reuses this codec instead
of inventing a second one. Legacy's decrypt-only `gpg <file> <64-hex-key>` does not port.

#### 4. The cipher is legacy's codec, keyed by md5 — and a wrong passphrase says so

`base64( FNV-1a(plaintext)[4] ⊕ key[0..3] ‖ XOR(plaintext, key) )`, ported from legacy
`utils/crypto.ts`, with the key derived from the passphrase through v2's existing `md5`
(`generation/md5.ts`). Three things fall out of it, all wanted:

- the 4-byte checksum makes a wrong passphrase a clean `decryption failed`, not a screen of garbage;
- base64 output is NUL-free by construction, so the patch store's TEXT column takes it — the same
  constraint `BINARY_STUB` already documents;
- it stays honest with the game's md5-is-deliberately-weak stance, which leaves a future
  `john`-cracks-a-`.gpg` arc reachable instead of shipping the one secret in the game that cannot
  be cracked.

WebCrypto AES-GCM was the alternative and was refused for that last reason as much as for the
async-everywhere cost.

#### 5. `chmod` is a read-modify-write against the MACHINE

`chmod` re-reads the file through the `env.fs.reload()` seam v0.172.0 shipped for exactly this
hazard, then writes ONE patch carrying the same content and the new permissions. No patch-model
change, no migration, no `api/` change — the wire-check stays `N/A` and D10 stays polish.

Two consequences, both accepted and both documented in the manual:

- **chmod refuses a file it cannot read** (`Permission denied`). It never bites root, which reads
  everything, and never bites a player on their own file; it bites a guest-tier caller on a file
  they could not have opened anyway.
- **A directory carries no content**, so a directory chmod is exact rather than a rewrite.

The alternative — a third patch state beside content-and-null — is the clean model and is written
down in the grounding above, so a later slice that needs perms-only writes knows what it costs
rather than rediscovering it.

#### 6. Whoever may WRITE a node may chmod it

Authorization reads the node's `write` tier allowlist — the same walker decision `nano`, `rm` and
`touch` already make, and the same L1/L2 rule that governs a cross-player write. Legacy's
owner-or-root rule would make the display-only `owner` string load-bearing for the first time: a
SECOND authority over permissions beside the tier allowlists, which is the exact shape D8 refused
when it made the SNMP OIDs a view over `rules.v4` rather than a second copy.

An intruder holding root on your box can therefore chmod anything on it — which is no new power,
since they can already overwrite it.

#### 7. No `-R`

Under decision 5, a recursive chmod copies every descendant's content into the caller's writer
rows: a patch storm where each row is a whole-file write carrying the clobber hazard §7 names. D9
shipped the right tool for bulk work three weeks ago — a loop in a `node` script — so `-R` is
**refused in the manual** rather than silently ignored.

#### 8. Four themes, over the eight tokens v2 actually paints

Amber (default), green phosphor, cyan and light, ported from legacy `theme/themes.ts`. The palette
is the **eight** `--theme-*` variables v2 renders today, plus whatever the author card introduces
(a link colour and an avatar border). Legacy's other five tokens paint nothing in v2 and are not
ported: this is the `SERVICE_CATALOG` discipline the epic has kept for nine doors — rows arrive
when the thing ships, columns when a slice consumes them — and a token nothing paints is dead data
that still has to be right in four places.

#### 9. The theme lives in `localStorage`, applied before the first paint

Its own key, read synchronously in `main.tsx` ahead of `render` so there is no flash of amber —
legacy solved the same problem from its IndexedDB cache. Four consequences, all matching legacy:

- `new-game` resets you to amber, because it clears the whole origin;
- an `xterm` tab inherits the theme, because it reads the same key at boot;
- an already-open tab keeps its colours until reload (no `storage`-event listener — one more
  mechanism for a cosmetic sync);
- nothing reaches a server, so a cosmetic preference does not become a server-authoritative fact.

#### 10. `author` is a screen, not a line

A third `ModeChange` beside `nano` and `lynx`: a full overlay card with the avatar, the bio and
real clickable links, ESC or `q` back to the terminal. v2's scrollback is a list of plain
`{ kind, content }` strings and cannot hold a component; the alternative was teaching
`TerminalLine` a renderable kind, which would make pipes, redirects, `node`'s capture and the log
writers all answer what a non-string line means — six subsystems changed for one command.

The copy is **legacy's, verbatim**, including the avatar URL and the LinkedIn/GitHub links. It is
the owner's own text; edits arrive as data during the slice, not as a rewrite.

#### 11. `clear` clears the banner too, and Ctrl-L does the same thing

Scrollback and banner both go; **command history survives**, so ↑ still walks it — legacy's
documented behaviour and what a real `clear` does. Mechanism: a new `env.clearScreen()` capability
in the shape of the shipped `env.resetGame()`, with the banner becoming a signal that starts true
and returns on reload. **Ctrl-L is bound to the same capability**, because every terminal a player
has used does that and it costs one branch in the handler that already owns ↑/↓/Tab.

#### 12. The client-comfort four need a real terminal — `withoutTty` AND `withoutScript`

`clear`, `theme`, `author` and `xterm` all declare both refusals. The principle is one sentence:
**these are acts ON a terminal, so they need one that exists and one the player is looking at.** A
backdoor is a pipe with no screen to clear — `clear` on a pty-less shell authentically errors — and
a script's output is CAPTURED (D9 decision 4), so there is no screen for it to clear or take over,
while a loop calling `xterm` is a popup storm.

This is a DIFFERENT rule from D9's *"refuse what would lie about where the script is standing"* —
a theme change lies about nothing — and it is recorded as its own principle so a later slice does
not try to derive one from the other.

#### 13. `xterm` opens a FRESH terminal

The new tab boots at the player's own workstation, as their own user, and **skips hop
rehydration** — v2's equivalent of legacy's `?fresh`, keeping legacy's documented promise that
*"each tab runs an independent session with its own user, machine, path, and command history"*
while the filesystem and wifi state stay shared.

Without this, `xterm` would ship the two-tabs-one-session-stack desync described in the grounding
as a feature. Residual, recorded rather than solved: if the fresh tab later elevates, a RELOAD of
either tab rebuilds one stack from both tabs' rows — the same lossiness `sessionRehydrate` already
documents for a refresh.

#### 14. `find` keeps legacy's positional shape — and the realism debt gets a name

`find <path> <pattern> [user]`, globbing `*`/`?` as legacy did, walking only what the session can
traverse and read so that what `find` reports and what `cat` will open cannot disagree. `-user`
filters the display-only owner string — a report, never an authorization input.

A `-name`-parsed find would be the strictest-parsed command in the game and the outlier among
`hydra`/`john`/`snmpwalk`/`redis-cli`. The realism-versus-simplicity tension is real and is
**deferred deliberately, not lost**: a *pre-release realism pass over every command's argument
surface* is now a named parking-lot item, so the whole set gets tweaked together, once, with a
player's muscle memory in view — rather than one command at a time.

#### 15. `clear` and `whoami` become stamped binaries

Both join `SYSTEM_UTILITY_NAMES`, so every machine carries `/bin/clear` and `/bin/whoami` and the
existing availability gate applies — consistent with `find`, `strings` and `chmod` sitting right
there, and keeping ONE rule about what a binary means. Legacy classed both as shell builtins;
v2's rule is *"real Linux tools have a binary and are gated by it; game commands don't"*, and these
are real tools.

Consequences: `rm /bin/whoami` breaks whoami on that box, as it does for every other tool; and
while ssh'd into a box that lacks `/bin/clear`, your screen does not clear — which is exactly what
real ssh does. The cost is near zero — the workstation/remote/router `/bin` tests assert against
`SYSTEM_UTILITY_NAMES` itself rather than a typed-out list — but **the stamping must land in the
same slice as the commands** (slice 1), or `whoami` ships answering `command not found`.
`theme`, `author` and `xterm` stay ungated game commands (no binary), joining `identity` and
`new-game` in `GAME_COMMANDS`.

### Forced rather than chosen (planning should not re-litigate)

- **No `api/` change in any slice — wire-check `N/A` throughout, with reasons.** Nothing here
  reaches a server that is not already reached: `chmod` writes through `env.patches.write`, the
  same call `nano`, `touch` and `>` use and that is already proven cross-player; `gpg` reads and
  writes files through the same seam; the other seven are pure client or pure filesystem. Every
  close-out proof is a browser run — the vantage conventions §7 warns a green wire-check cannot
  see.
- **`clear`, `theme` and `xterm` cannot be pure `core/` commands.** They act on the browser, so
  each needs a `CommandEnv` capability; `core/` never reaches into UI state. That is the shape
  `env.resetGame()` already has, not a new idea to weigh.
- **`author` cannot feed a pipe.** No `mode_change` can (`runLine.ts`), so `author | grep` is a
  shell-level fact, not an author-level decision.
- **`gpg` stays apt-installed.** `{ name: 'gpg' }` is already in `APT_PACKAGES` and deliberately
  out of `LOCALHOST_PREINSTALLED_TOOLS` (`binaries.ts`: *"a fresh box ships neither a JS runtime
  nor GPG… Don't 'restore' them here"*). A package with no `binaries` list ships one binary named
  after itself, so `apt install gpg` already stamps `/usr/bin/gpg`.

### Folded in as routine (recorded so they are not re-decided)

- `strings <file>` with legacy's fixed 4-character minimum and no `-n`, per the house style.
- `gpg -c` **keeps** the plaintext and writes `<file>.gpg`; legacy's `.enc` is dropped, so the
  later content generator emits `.gpg` too. `gpg -d` decrypts whatever it is handed, extension or
  not.
- `whoami` prints the ACTIVE session's username only — `root` after `su`, the remote user after an
  `ssh` hop.
- Categories, from legacy's own placement: `clear`/`theme`/`author`/`xterm` → `general`;
  `whoami`/`find`/`strings`/`chmod`/`gpg` → `filesystem`.
- `theme` with no argument lists the four with `*` on the current one; an unknown name errors and
  names the four.
- Every command ships a `manual` page — `help` and `man` pick them up from the registry.
- Version bump per feature slice in both `v2/package.json` and `v2/package-lock.json`.

### Slice spine (each vertical + observable)

D10 is not a door either — no daemon, no port, no placement, no cross-player half — so the spine is
the **comfort surface**, ordered so the two slices carrying real mechanism land last and alone.

| # | Slice | Observable |
|---|---|---|
| **1** | **The terminal is yours** | `clear` (banner + scrollback, history intact) via `env.clearScreen()`, Ctrl-L on the same seam, the four themes with pre-render `localStorage` persistence, `whoami`, and `/bin/clear` + `/bin/whoami` joining `SYSTEM_UTILITY_NAMES` (decision 15 — the stamping rides with the commands it gates). A player clears the screen, switches to green phosphor, reloads and it is still green |
| **2** | **The card and the second window** | `author` as the third `ModeChange` overlay; `xterm` opening a fresh tab that skips hop rehydration. `author` shows the card and ESC returns; `xterm` from inside an ssh hop opens a tab standing on the player's OWN workstation |
| **3** | **The box answers questions** | `find` and `strings` — both binaries already stamped, so this slice is pure command work. `find / passwd` finds the file across a box the session can traverse; `strings /bin/ls` reads the ELF stub; a stripped `/bin` makes each say `command not found` |
| **4** | **Permissions change hands** | `chmod` — symbolic modes, write-tier authorization, the reload-then-write seam, `-R` refused. A player opens a root-only file to their own tier and then reads it; a guest is refused; the change survives a reload because it is a patch |
| **5** | **A file nobody else can read** | `gpg -c` / `-d`, the md5-keyed codec, the masked prompt and the positional passphrase. A player encrypts a file, `cat`s it and sees base64, decrypts it back; a wrong passphrase fails cleanly; an intruder holding root finds nothing readable |

**The close-out is a browser run with a beat worth targeting**: `ssh` into a box already rooted,
`gpg -c` something there, then read it back from the OWNER's side — the encrypted file is a patch
like any other, so the defender sees ciphertext on their own machine.

### Deliberately NOT built (recorded so nobody re-opens them)

`bash` (decision 1); world content for `strings`/`gpg` (decision 2); a perms-only patch state
(decision 5); `chmod -R` (decision 7); legacy's six unpainted theme tokens (decision 8);
server-side theme persistence (decision 9); a renderable `TerminalLine` kind (decision 10); a
cross-tab theme `storage` listener (decision 9); `-name`-parsed find (decision 14).

### Open for planning (named, deliberately not decided)

- **Whether `clear`'s banner-hidden state survives a `new-game`-less reload.** It is one signal
  either way; slice 1 picks, and the answer only shows when a player reloads mid-session.
- **The exact wording of the four `withoutTty` / `withoutScript` refusals**, and whether `clear`'s
  no-tty message borrows the real one (`TERM environment variable not set`). Player-facing strings,
  so the mutation gate will treat them as such (conventions §4).
- **Whether the author overlay reuses `Lynx`'s scroll/keyboard chrome or gets its own.** A shared
  screen shell may or may not exist by slice 2; the card is static content either way.
- **Whether `chmod`'s symbolic parser is worth sharing with anything.** Nothing else parses
  `[ugoa][+-][rwx]` today, so it starts private to the command and only moves if a second caller
  appears.

## X1 — resolved scope & decisions (grill-me, 2026-09-04)

Fourteen locked decisions, and the first section in this file for a slice legacy could not simply
hand over. Legacy HAS `nslookup` and `dig` — but its DNS is mission scaffolding: `resolveDomain`
answers out of `dnsRecords` built by `generation/topology.ts` for `.mission` domains, and both
themed networks ship `dnsRecords: []`. v2 has no missions, so the commands port and **the world
behind them is designed here**.

The purpose is the owner's, from legacy, and it survived being tested against reality: a player
discovers the machines in a network, **including the ones behind the deep layers**, through a DNS
box and `dig`. Zone transfer is the genuine article — `allow-transfer` is the textbook
misconfiguration, and a real internal zone spans every subnet an organisation runs, because DNS is
a naming layer and not a topology one. What the grill changed is WHERE the value sits: not in the
transfer itself, but in the boundary it crosses.

### Grounding that reshaped the scope before any decision

- **`nmap` already sweeps what you can stand on.** `nmap x.y.z.1-254` enumerates the LAN you are
  on, and `deepScanHosts` makes a layer behind an inner gateway scannable — but only from a
  **pivot vantage**, which `nmap.ts:279` defines as the active shell's own machine. Mapping Layer 3
  means rooting Layer 2's gateway first, in order, all the way down. That ordered cost is the only
  thing a zone transfer removes, and it removes it for RECON alone: knowing an address is not
  reaching it, so the NAT forward and the credential are untouched.
- **A zone transfer against a network you are inside is nearly a duplicate scan.** This is why the
  reward had to be scoped to what scanning cannot reach, and why the zone spans layers.
- **v2 already left the door open.** `network/http.ts:29` — *"The host as written — an IP address
  today; a name once DNS lands."* `nslookup` and `dig` are two of the six phantom binaries in
  `SYSTEM_UTILITY_NAMES` (D10 closed three; `ldd` is V4's).
- **The `dns` role exists with nothing behind it** — 3% per drawn machine in `machineRole.ts`,
  prefixes `dns`/`ns`/`resolver`/`bind`. D5b's close-out named X1 as what makes it answer. A LAN
  draws 3-8 machines, so **roughly one network in seven has a DNS box** — the rarity is the
  balance, and it is why decision 2 exists.
- **AP gateways forward nothing by default.** `routerFs.ts:148` — *"Opt-in default: NO active
  forward (it parses to an empty table)."* Every forward in the game is player-authored or D5's
  backdoor auto-append, so "transfer a stranger's zone from outside" is a scope addition this world
  cannot serve today. X1 is therefore an INSIDE-the-network door: you crack the WiFi first.
- **Deep layers are viewer-independent.** `generateDeepLayer`'s header claims a `pubkey` in its seed
  tuple; the signature is `(essid, frontingGateway, options)` and the PRNG key is
  `deep-layer-${essid}-${machineId}`. Every player walks the same chain — which is what lets ONE
  generated zone describe the whole network. **The comment is stale and slice 2 should correct it.**
- **The chain walk already exists.** `lanHostIdentity.ts` walks every inner gateway and every deep
  child gateway to `seedNetworkDepth(essid)`, deliberately as one walk with several consumers. The
  zone generator is another consumer, not a second traversal.
- **`APT_PACKAGES` already ships multi-binary packages** (`apt.ts:88`: a package whose `binaries` is
  omitted ships one named after itself; one that declares them ships several), and the binary gate
  resolves by command NAME across `/bin`, `/usr/bin`, `/usr/sbin`. So the install path costs one row
  and two deletions.

### Locked decisions

#### 1. One zone per ESSID, covering the whole network, every layer

A DNS box is authoritative for the entire address plan: Layer 1's hosts plus every deep layer's NPC
and gateway, down the chain to the seeded depth. Not per-layer — a deep layer carries exactly ONE
reachable NPC plus a child gateway (`generateDeepLayer.ts`), so a layer-scoped zone would name two
hosts and be worth nobody's command.

The payoff is bounded by construction: a transfer changes what a player KNOWS, never what they can
touch. The route and the credential are still the pivot chain's price.

#### 2. The AP gateway always resolves its own LAN; the DNS box holds the authoritative zone

Six networks in seven have no DNS box, so name service cannot depend on one. The gateway answers
lookups for the hosts on its own LAN — which is precisely what a real home router does, because
dnsmasq knows the names it handed DHCP leases to.

That produces the door's information gradient, and it is a real one rather than a designed one: the
**gateway knows its own subnet**, the **BIND box knows what the admin wrote** — the whole plan,
deep layers included. `nslookup` is useful on the first network a player cracks; the zone is the
jackpot.

#### 3. `<host>.<essid-slug>.lan`, with the bare hostname resolving too

`web-04.acme-corp.lan`, `cam-31.apt-3b-wifi.lan`. The suffix is what a real consumer router serves
(dnsmasq's `domain=`; OpenWrt defaults to `.lan`), and the per-network label makes a name carry
WHERE it belongs — so a name found in a config file or a zone names a place, and X2 inherits a
per-network name to index. A bare `web-04` resolves as well, the way a resolver appends its search
domain, so nothing is long to type in practice.

#### 4. A name works anywhere an address does — ONE shared resolve step

Legacy threaded `resolveDomain` into ten command contexts. v2 does it once: a small shared helper
turns a name into an IP at each command's target parse (`ssh`, `curl`, `nmap`, `ftp`, `nc`, `scp` —
about six call sites), and the existing IP path runs untouched. No command learns what DNS is.

It needs no round-trip, because a generated LAN is deterministic from its ESSID: `web-04.acme-corp.lan`
to `192.168.x.y` is a pure client-side function. `env.scan.resolvePublic` stays what it is — a
server call about a PUBLIC target, not a name lookup.

#### 5. The zone lists what an admin would name

Webserver, database, mailserver, fileserver and dns, plus the gateway, the inner gateway and the
switch, plus every deep layer's NPC and gateway. **Workstations and IoT stay out** — 58% of the
drawn population, and DHCP clients that no authoritative zone would carry.

Nothing is lost by the omission: those names already resolve through the gateway (decision 2) and
already appear in `nmap`. And it answers a question a static generated zone otherwise could not —
fellow PLAYERS are dynamic occupants, so "DHCP clients are not in the zone" keeps the file
generated, offline and free of a cross-player round-trip.

#### 6. Roughly three DNS boxes in four allow the transfer

BIND's own default for `allow-transfer` is open; restricting it is something an admin goes and
does, which is exactly why the finding is so common. A coin flip on top of a one-in-seven find
would put the whole door behind a door. The locked minority is real and answers `; Transfer
failed.`, and because `named.conf` is a file the journal owns, a player who roots the box can
restrict it themselves — the same authority `rules.v4` and `acl.conf` already have.

#### 7. A full `dns` row in `SERVICE_CATALOG`

`named.pid`, port 53, a banner, placement on dns-role boxes. This is what closes the loop: `nmap`
reports `53 open`, which is HOW a player finds the box worth transferring — without it they would
be guessing at hostnames. It inherits D4 for free, so `systemctl stop named` takes name service off
a network and `dig` gets the refusal a dead daemon earns.

#### 8. The row is `tcp`

A default `nmap` (no `-sU`) reports exactly `53/tcp open domain`, and in this game the port serves
exactly one operation — the zone transfer, which is TCP in reality. Ordinary lookups never touch
it; decision 2 sends those to the gateway. Dual-protocol rows are refused in "Deliberately NOT
built": one open port emitting two scan rows would touch the `OpenPort` shape the client render,
the deep resolver and the server-side `kern.log` trace all share.

#### 9. The zone FILE is the authority for the transfer

`dig` parses `/etc/bind/zones/db.<zone>`, as legacy's did. One authority, not two — the rule D8
enforced when it refused SNMP's parsers for a fact the game already owned.

Three things follow at no cost: rooting the box yields the same intelligence with `cat`; the owner
can edit or delete records; and because a rooted NPC's edits persist server-side, **an edited zone
is what the next player's transfer returns** — a poisoned zone, with no new machinery. Resolution
stays with the gateway, so a lie in the zone misleads whoever reads the zone, not the resolver.

#### 10. Transfers are logged; lookups are silent

`/var/log/named.log` takes the transfer and the refused attempt, naming the source. Ordinary
lookups write nothing — BIND's real defaults exactly (querylog off, AXFR logged on the default
channel), and the game's own asymmetry: a scan is loud, a backdoor is silent, a transfer is
attributable. Since every name-target now resolves through DNS, a query log would fill with the
traffic of ordinary play.

One signed fire-and-forget action plus its wire-check, mirroring `nmapScanDeep`. It is the ONLY
`api/` work in the door, which is why it is its own slice.

#### 11. An unmatched name falls back to the occupant seam

Generated hosts resolve purely client-side (the common case, no round-trip). A name that matches
nothing generated asks `resolveOccupants`, which already returns `machineName` + `localIp` and is
already how `nmap` shows a fellow player as a real host. A player you can SEE in a scan is a player
you can name — and the alternative is `nmap` listing a host by a name `nslookup` denies exists.

#### 12. Nothing in this door paces

`nslookup` and both forms of `dig` answer instantly. This is the REALISTIC behaviour, not a
concession: a lookup answered by your own router from its DHCP table is local memory (0-2 ms), and
the 20-100 ms figure people associate with DNS is a cold recursive lookup out across the internet.
Every name here is local. A transfer of fifteen records is milliseconds too.

It is also forced on the query side — resolution now runs inside every command that takes a host,
so a paced lookup would make `ssh web-04` measurably slower than `ssh 192.168.1.4` and train
players to type addresses. The flavour comes from `;; Query time: N msec` and `;; XFR size: N
records`: output that REPORTS speed instead of spending it, the same trick decision 14 uses. X1
having no paced command is a fact about DNS — every other network command paces because its real
counterpart genuinely takes time.

#### 13. `apt install dnsutils` ships both binaries

A Debian-family server does not have `dig` or `nslookup`; they come from `dnsutils` /
`bind9-dnsutils` (`bind-utils` on the RHEL side, `bind-tools` on Alpine), and `dig: command not
found` on a fresh box is one of the most familiar frictions in Linux administration. One
`APT_PACKAGES` row with `binaries: ['dig','nslookup']`, and both names come OUT of
`SYSTEM_UTILITY_NAMES` — free before launch.

It lands in the groove the game already teaches (crack WiFi, `nmcli connect`, `su root`,
`apt install nmap`) and earns a realistic asymmetry: the DNS box runs BIND, so it ships the
utilities as a dependency — the one machine in the world that could have interrogated its
neighbours.

#### 14. A records in the output; the zone file keeps its full SOA header

Legacy solved simplicity-versus-realism here without paying for it, and it ports verbatim:
`generateDnsZoneContent` writes a real zone file — `$ORIGIN`, `$TTL`, a proper SOA block with
serial/refresh/retry/expire/minimum, an NS record — and `dig` prints only the A records. Realism
lives in static text the player can `cat`; simplicity lives in a one-line filter.

MX, CNAME and TXT are refused rather than deferred, and for the game's own reason: an MX would name
the mailserver that decision 5 already lists as an A record, and a CNAME would say what a box is
for when D5b's role-driven hostnames and `/etc` role config already say it twice. Each is a second
authority over a fact the world already hands the player another way.

### Forced rather than chosen (planning should not re-litigate)

- **Resolution is client-side because generation is deterministic.** Nothing about decision 4 is a
  performance choice; the world is a pure function of the ESSID, so a lookup that needed the server
  would be inventing a dependency.
- **X1 is an inside-the-network door.** AP gateways forward nothing by default, so a foreign
  network's DNS box is unreachable from outside. Public naming belongs to X2.
- **Removing a binary is what makes a command not-found** — the gate is filesystem-driven
  (conventions §7), so decision 13's two deletions from `SYSTEM_UTILITY_NAMES` ARE the gating.
- **The zone reuses the existing chain walk** to `seedNetworkDepth(essid)`; a second traversal would
  be the drift D8 warned about in a new place.

### Folded in as routine (recorded so they are not re-decided)

- `dig`'s `@server` prefix and flexible argument order port from legacy verbatim, as do the NXDOMAIN
  and `; Transfer failed.` wordings and the `; <<>> DiG 9.16.0 <<>>` header.
- Offline, both commands say what every network command says; a bricked gateway takes name service
  with it, because it takes the whole address dark already.
- The `essid-slug` is the ESSID lowercased with its existing hyphens kept — `SHINRA-5G` to
  `shinra-5g`. No new vocabulary.
- The player's own workstation resolves like any other occupant (decision 11), not as a special case.

### Slice spine (each vertical + observable)

X1 is a door in the ordinary sense — a service, a port, generated content and a defender-side
trace — but it inverts the usual order: the CLIENT half is useful before the world half exists,
because the gateway resolver needs no DNS box.

| # | Slice | Observable |
|---|---|---|
| **1** | **A name resolves** | `apt install dnsutils`, `nslookup <name>` through the gateway resolver with the occupant fallback, and the shared resolve step wired into `ssh`/`curl`/`nmap`/`ftp`/`nc`/`scp`. A player connects, types `ssh root@web-04` and lands — never having read an address |
| **2** | **A box answers as a name server** | The `dns` catalog row, placement, `named.conf` + zone-file generation across the whole chain, `53 open` in a scan, `systemctl stop named`. Rooting the box and `cat`-ing the zone already pays out the deep-layer intelligence — before `dig` exists |
| **3** | **The zone transfers** | `dig <name>` and `dig @<server> axfr`, the `allow-transfer` gate read from the box's own `named.conf`, A records only, instant with a reported query time. One command hands over addresses on layers the player has never reached; a locked box says `; Transfer failed.` |
| **4** | **The transfer leaves a trace** | `/var/log/named.log` on the DNS box, naming who transferred the zone and when — refusals included, lookups absent. Readable by whoever roots the box next. The only `api/` work in the door: one signed action plus its wire-check |

**Slices 1 and 2 are independent of each other** (the resolver needs no DNS box; the DNS box needs
no resolver), so either could go first; 1 leads because it is the half a player meets on every
network. 3 needs 2. 4 needs 3.

### Deliberately NOT built (recorded so nobody re-opens them)

Public and world domains (X2's, and X2 inherits a per-network name to index for free); a zone
authoritative for RESOLUTION as well, so a poisoned record misdirects `ssh` — **refused, not
deferred**, because it would need a server round-trip on every lookup and reopens decision 2;
occupants inside the zone (reverses decision 5); dual-protocol port rows (decision 8); query
logging (decision 10); MX, CNAME and TXT records (decision 14); `dig -x` reverse lookups and
`host`; pacing of any kind (decision 12).

### Open for planning (named, deliberately not decided)

- **What the gateway's resolver IS, structurally.** It answers for its own LAN by construction, but
  whether that is a function, a seam on `env`, or a fact the shared helper computes directly is a
  shape question for slice 1 — and the answer decides how slice 3's `dig <name>` reuses it.
- **Whether the DNS box's own zone contributes to resolution on its network.** Decision 2 gives the
  gateway the answer and decision 9 keeps the file authoritative for the TRANSFER; the case where
  both could answer (a name on a network that has a DNS box) is one line either way and should be
  picked deliberately in slice 3, not drifted into.
- **The zone's exact host-name column width and record ordering.** Legacy sorted A records
  numerically by octet and padded names to 15; worth keeping unless the deep layers' `10.x` addresses
  make the sort read oddly beside the `192.168.x` ones.
- **Whether `named` belongs in `SYSTEM_DAEMON_NAMES`** the way the other daemons do, and what a
  dns-role box's `/etc` role config file (D5b slice 3) should say now that the box has a real
  service behind it.

## Phase 3 — resolved scope & decisions (grill-me, 2026-09-09)

Twenty-three locked decisions spanning V1–V4, the last item in the epic before the ship gate.
Unlike X1, legacy CAN hand this one over: `src/generation/timeline/`,
`pools/{serviceTemplates,systemLibraryTemplates,vulnerabilities,routerFirmware}.ts`,
`commands/{msfconsole,apt,ldd,libraryDeps}.ts` and `network/{dpkgStatus,applyVersionOverlay}.ts`
are a complete, working implementation of the feature. What the grill changed is **which half of
it is worth taking**, and the answer turned on discovering that the half legacy is famous for
never actually ran.

The purpose is the owner's: every service and library accumulates vulnerabilities as time passes,
on one clock shared by everyone, and the only cure is upgrading. A window exists between a CVE
publishing and its fix shipping, so nobody is ever completely immune. Services are the way IN to a
machine; libraries are the way UP once you are on one.

### Grounding that reshaped the scope before any decision

- **Legacy's service treadmill was inert.** `machineConfig.ts:536` seeds every machine's
  `/var/lib/dpkg/status` with all 8 libraries at their `startTuple`, so the LIBRARY treadmill
  genuinely ran from day 3. Services are seeded from `port.serviceVersion`, which on every
  ordinary generated box is `defaultServiceVersion()` → the literal string `'latest'`, chosen so
  *"findVulnForService(anyService, 'latest') always returns undefined"*, and `applyVersionOverlay`
  skips that sentinel explicitly. A service CVE could only ever land on a box that mission
  enrichment had FORCED onto a hand-authored version. Legacy shipped the walker, the timelines and
  all eight effects, and **no ordinary NPC was ever exploitable through a service.** Filling that
  hole is the first thing Phase 3 does.
- **Legacy's clock is per-browser.** `session/gameTime.ts` anchors on
  `localStorage['jshack.gameStartedAt']`, set on that browser's first launch. Two players who
  started a week apart sit on different days of the same timeline, and clearing storage resets the
  world. Nothing about it survives.
- **Legacy's effect tier was envelope-trusted**, and said so in its own comment: *"tier comes from
  the effect (envelope-trusted today; forge-bypass closure deferred)"*.
- **v2 has already shipped the library PRESENCE layer.** `core/commands/libraryDeps.ts` is ported
  verbatim and wired into `registry.ts` inside the binary check; `core/generation/libraries.ts`
  stamps eight `/lib/<lib>.so` stubs. `rm /lib/libpcre.so` already breaks `ls`, `grep`, `cat`, `rm`
  and `chmod` with the real dynamic-linker error and exit 127 — today, with no `apt remove` needed.
- **v2's service catalog was written for this epic.** On `banner`: *"DELIBERATELY VERSION-FREE… a
  build (`OpenSSH_8.9p1`) is not [fine]. Versions are the package manifest's to tell —
  `/var/lib/dpkg/status` is where a version scan reads them — and a version baked in here would be
  a second, contradicting source of truth for the fact vulnerabilities are keyed on."* Every row
  also already carries `sweepLog: { path, owner, permissions, formatAttempt }`.
- **Two binaries are stamped with no command behind them** — `ldd` in `SYSTEM_UTILITY_NAMES`
  (`binaries.ts:75`) and `msfconsole` via `apt install metasploit` (`aptPackages.ts:143`). The
  `dig` situation X1 called out, standing open for two more slices.
- **`metadata.libraryLinks` is declared, round-tripped by the codec, and never populated or read** —
  and its only example value (`/lib/libc.so.6`) contradicts the deliberate libc exclusion.
- **Rooting a shared AP is already reachable.** Its admin password is ESSID-seeded and `hydra`
  sweeps the gateway behind any public IP (D2.4). Firmware adds a second route to a beat that
  already exists, not a new class of risk.
- **PvP cannot currently reach root at all.** A player's chosen root password *"never cracks"*, and
  D2.6b is postponed — so `msfconsole` is the FIRST real route to rooting another player. This
  phase, not any earlier door, is what sets the game's PvP stakes.
- **v2 sessions never expire** (`ended_at IS NULL` is active indefinitely) and `reboot` pops only
  the REBOOTER's own hop chain (`reboot.ts:64`), client-side. Nothing in the game today removes
  another player's session row from a machine.

### Locked decisions

#### 1. World time is a hardcoded epoch constant — not a row, not a round trip

`WORLD_EPOCH` lives in `core/` beside the timing config, and `gameDay = floor((now − EPOCH) /
86400000)` off UTC. Identical for every player by construction, with no table to seed, no fetch to
cache and no offline story to write.

The client computes it to RENDER (`nmap -sV`, `apt list -u`); the server recomputes it from its own
clock to AUTHORIZE. That is the same client-renders / server-enforces split `deepScanHosts`,
`sweepWord` and `contentHash` already use, and it means a forged client clock changes what a player
SEES and never what they GET.

#### 2. The epoch starts at zero, and the hand-authored CVE table is dropped

`WORLD_EPOCH` is the launch date. The world is genuinely clean for the first ~3 days, then CVEs
begin landing one at a time while the earliest players watch — the treadmill introduces itself
rather than arriving pre-loaded.

This is what lets legacy's `pools/vulnerabilities.ts` (410 lines of hand-authored day-0 CVEs) AND
the two-layer lookup inside `findVulnForService` both go. One procedural source of truth for every
CVE in the game, on every axis.

#### 3. Legacy's timing config ports verbatim

Safe window 3–14 game days between CVEs for a package, patch delay 1–2 days, bump weights 80% patch
/ 15% minor / 5% major, and **1 game day = 1 real day**. On a box running two or three services plus
the eight libraries that is a new CVE roughly every 0.8 days, so a player is almost always exposed
on something and daily attention is the price of safety.

`assertCveTimingInvariants` ports with it: `maxPatchDelayDays` must stay strictly below
`minSafeWindowDays` or a fix could arrive after the next version's own CVE, leaving no safe window
at all. All four values are constants in one file — retuning after playtest is a one-line change.

#### 4. NPC boxes freeze at `startTuple` and never patch

Every generated machine's services sit on their template's starting tuple forever. Its CVE
publishes on day 3–14 and stays live permanently, because the box never moves off that version.

This is **a deliberate placeholder for NPC maintainer actors**, not a claim that unattended boxes
never patch: simulated owners who run their own upgrades are planned, and they are what will close
the decay. Recording the reason matters, because the alternative considered — a seeded per-box
patch LAG making the version a pure function of game time — is a different and incompatible model,
and it should not be reintroduced as a "fix" for a consequence that is already understood.

#### 5. NPC libraries freeze too

One rule for every package on every generated box. The consequence is named plainly in the
accepted-costs section below: from ~day 14, any shell on any NPC escalates to root through
`msfconsole --local`, permanently. Accepted; the same maintainer actors close it.

The rejected alternative was Debian's `unattended-upgrades` asymmetry — libraries auto-patching
while services stay frozen, so local privesc becomes a rotating 1–2 day window keyed to whichever
library is currently unfixed. It is more realistic and better balanced, and it was declined in
favour of one rule with one later fix.

#### 6. The player's own libraries freeze too — patch or die

The player's box is generated like any other, so their `/lib` starts at `startTuple` as well.
`apt upgrade` is the entire defence, and neglect is genuinely fatal. This is the strongest form of
the engagement loop the feature exists to create, and it needs no asymmetry to explain.

The kill chain this creates against an inattentive player is spelled out in the accepted-costs
section. It is closed completely by upgrading.

#### 7. `apt install` gives the current latest-safe version, through the upgrade resolver

Install and upgrade resolve their target version through ONE function — an install is an upgrade
from nothing. A fresh install is therefore born clean rather than born six months stale, and inside
a patch-delay gap it falls back to the newest published version, so installing into a window leaves
you exposed exactly as everyone else already is.

The generated baseline stays `startTuple` (decision 4). Two boxes running "nginx" can sit on very
different versions depending on how each got it, and that is correct: the world was built once,
what you install today comes from the repo as it is today.

#### 8. All eight effect kinds

`shell_full`, `shell_limited`, `file_read`, `dir_list`, `file_write`, `password_reset`,
`backdoor_port_open`, `script_exec`.

The weak effects are load-bearing, not padding: they are what stops a frozen NPC from being
uniformly generous. Trimmed to only the access-granting four, more than half of every exploitable
box would hand over a real door and `hydra` would lose its job.

Four map onto machinery v2 already has — `shell_full` and `shell_limited` mint sessions (the
restricted NC shell exists), `backdoor_port_open` writes an `nc` pidfile patch with D5's chain
forwarding, `password_reset` writes an `/etc/passwd` patch. `file_read` and `dir_list` need only a
server-computed response payload. `file_write` and `script_exec` need a CVE-authorized write and
exec path. `script_exec` is pre-committed: D9 deferred it here by name and kept `nc -l`
script-runnable specifically to serve it.

#### 9. Severity decides the tier

`critical` → root, `high` → user, `medium`/`low` → guest. **Libraries floor at user**: `critical`
and `high` → root, `medium` and `low` → user, because the library route IS the privesc route and a
critical-only root rate would make the trip not worth taking.

Legacy's `severity` was decorative and admitted it — *"all four produce the same mechanical
outcome"*. Coupling it to tier gives the field a job, collapses two independently-rolled facts into
one, and makes `nmap -sV` genuinely predictive: read the severity, know what the door is worth
before spending a move on it. The draw is still random, because severity itself is rolled
(`pickGeneratedSeverity`: 10 / 50 / 30 / 10), which lands services at root 10% / user 50% /
guest 40%.

This also fixes the delta between legacy and the design: legacy's `SYSTEM_COMMAND_EFFECT_POOLS`
hardcodes `tier: 'root'` on every entry, so `--local` always jumped straight to root. Under the
floor it is a real guest → user → root ladder.

#### 10. Three CVE axes — services, libraries, and router firmware

Firmware ports as legacy has it: per-vendor timelines, a `firmwareVendor` on router-role machines,
a synthetic `firmware` package in dpkg, and `findExploitableCve` falling back to it when a port has
no service CVE. Routers, switches AND the shared AP gateway are all in.

A fully patched gateway can therefore still fall, which makes network infrastructure a target class
in its own right. It does not introduce the network-brick beat — rooting a shared AP is already
reachable through `hydra` against its ESSID-seeded admin password.

#### 11. `libraryDeps` is the single authority for what a command links; `metadata.libraryLinks` is deleted

`ldd` and `msfconsole --local` read the same map, so they cannot drift — `ldd` can never point at a
library the exploit will not use. Deleting the FS field removes speculation rather than behaviour:
nothing populates it, nothing reads it, and its only example value contradicts the libc exclusion
it was meant to serve. One codec test updates.

#### 12. The dependency map extends to the game's own tools, keeping eight libraries

`libraryDeps` covers 17 of 67 commands today. Plausible links get added for the uncovered
toolchain — `nmap`, `node`, `hydra`, `gpg`, `lynx` and their kin — while shell builtins and UI
commands (`cd`, `echo`, `pwd`, `whoami`, `clear`, `theme`) stay deliberately library-free. The
map only ever GROWS, so the ported mapping's "must not be invented or simplified" rule holds.

The thematic grouping stays and is load-bearing, not sloppiness: eight commands share `libpcre`,
but each rolls its OWN effect from its own pool, so one library CVE lets the player **pick their
payload by picking the command** — `ls` for `dir_list`, `grep` for `file_read`, `rm` for
`file_write`. A realistic re-derivation against real Debian link sets would scatter that, grow the
library set well past eight and re-roll `/lib` on every box; it was declined for exactly that.

Every command added to the map needs its own `SYSTEM_COMMAND_EFFECT_POOLS` entry, or it is mapped
but not exploitable.

#### 13. `nmap -sV` reports the version, the CVE id and its severity — never the effect

A VERSION column always; a CVE line carrying its id and severity when one is live. **Severity
forecasts the privilege, the exploit reveals the capability.** The player learns a known bug exists
and how high they would land, and still has to fire to find out what they get.

Legacy printed the description and an effect hint too (`formatEffectHint`), which made `msfconsole`
a confirmation rather than an act. That is trimmed.

#### 14. The version scan reads `/var/lib/dpkg/status` server-side; the banner stays version-free

Resolve the target, read its filesystem, report — exactly how `resolvePublicScan` already reads a
target's `rules.v4` and `readOpenPorts` reads its pidfiles. The file is world-readable in Debian
and already tier-3 allowlisted.

The rejected alternative was making `banner` a FUNCTION of the dpkg version, which would keep one
source of truth while letting the daemon announce its own build (and hand `nc` a fingerprinting
job for free). It is the better fiction and it was declined as a change to a shipped catalog field
and every banner test, for a difference invisible in play.

#### 15. A successful exploit writes through a `formatExploit` column on the catalog row

The destination reuses that row's existing `sweepLog` path, owner and permissions; the row gains
one sibling formatter saying what an EXPLOIT looks like on that daemon, because `formatAttempt`
formats a credential attempt and writing "Failed password" for an exploit would be a lie. An http
CVE leaves a traversal in `access.log`, a mysql one a suspicious query in `mysql.log`.

**The line must name the CVE.** That is not decoration — under decision 21 it is the defender's
only route back to their own root password.

This is legacy's per-service truthfulness without legacy's `AttackPattern` model (a six-variant
union on every CVE plus a 389-line formatter dispatch). v2's rows already know where each service
logs; a second authority over that fact is exactly the drift D8 refused.

#### 16. A failed exploit writes to the same log as a successful one

A refused-attempt line from the same `formatExploit` family, in the service's own log. One
destination per service for both outcomes, so a defender greps one file and sees the whole story —
and patching finally pays a visible dividend: *someone came for you and bounced*.

Legacy split these, sending failures to `/var/log/syslog` while successes went to the service log,
scattering one attacker's activity across two files.

#### 17. `msfconsole --local` writes a syslog line naming command, library and tier

> **SUPERSEDED by decision 69 (slice 8 grill, 2026-09-18)** — no real system writes this line.
> The trace is now only what a real box records: a `kern.log` crash line on a miss, the ordinary
> `auth.log` session line on a shell success, nothing else. Kept below as the record of why.

`/var/log/syslog`, because a library has no daemon and `auth.log` would dress a memory-corruption
exploit as an authentication event. It closes the incentive legacy left open: with `su` logging
`Successful su for root by guest` and `--local` logging nothing, the exploit was a strictly better
AND quieter route to the same place.

It is also the defender's one clue that says *patch your libraries, not your services*.

#### 18. Root is root — an exploit session is an ordinary session row, brick included

The exploit mints a `sessions` row at the granted tier, kind `exploit`, and every existing gate
treats it exactly like an ssh login. No special cases anywhere, including the `/boot` path: a
CVE-granted root shell can `rm /boot/vmlinuz` and permanently brick the target.

The odds keep it dramatic rather than routine — root needs a `critical` roll (10%) and a
shell-class effect (roughly 2 in 10 of a service pool), so about **2% of a player's vulnerable
services hand a stranger a root shell with no credential at all** — and only inside a window the
player can close by upgrading or by stopping the service.

#### 19. Sessions persist through a patch

Patching stops NEW exploits; it does not terminate a live shell, which is what happens in
reality. `apt upgrade` is not an eviction tool.

The rejected alternative — patching a package evicts sessions opened through it, recorded via one
nullable column on the session row — would have made V3's title literally true at the cost of a
mechanic that does not exist outside the game.

#### 20. `reboot` ends every session on the machine, server-side

The defender's answer to *"I think I am compromised"* is the real-world one. `reboot` today pops
only the rebooter's own hop chain client-side, so decision 19 without this would leave an exploit
session permanently in place with no tool in the game able to remove it.

The interaction is deliberate and worth knowing: if the intruder already deleted `/boot/vmlinuz`,
the defender's reboot-to-evict is what bricks them.

#### 21. `password_reset` has full power, is deterministic, and offers no recovery hint

The effect overwrites any account's hash including a player's chosen root, with
`md5("pwned-<last4-of-cve>-<tier>")`, and tells only the attacker the plaintext. This is the job
the epic assigned this phase — the route by which a player obtains a plaintext they did not already
hold, without which D2.6b's wordlist progression stays inert.

Recovery exists and is earned, not given: the trace names the CVE (decision 15), and any player who
has ever run `password_reset` themselves has seen the `pwned-XXXX-<tier>` shape. A defender who
reads their own logs and understands the mechanic gets their root back. One who does not has
permanently lost root on their own machine.

The rejected alternatives were naming the new credential in the trace line (recovery for free, and
the attacker's window becomes "until they read their logs"), and extending v2's existing "a
player's chosen root password never cracks" rule from being REACHED to being OVERWRITTEN — which
would leave the effect able to reset only `guest` on a player's box, the account the attacker
already came in through, and leave the epic's job unmet.

#### 22. The apt surface is upgrade, list -u, and downgrade-only pinning

`apt upgrade [package]`, `apt list -u` carrying the `[vulnerable, no fix yet — ETA ~N days]`
status, and `apt install pkg=<version>` restricted to **already-published** versions. Legacy's
730-day forward walk is dropped as time travel.

Pinning earns its place as an attacker tool, not a defender one: root someone's box and pin their
`sshd` back to a version with a live CVE, and you have planted a backdoor that looks like
nothing — no pidfile, no forward rule, no new account, just a version number in a file nobody
reads. A subtler persistence mechanic than D5's `nc` breadcrumb.

Legacy's four library meta-packages (`auth-libs`, `crypto-libs`, `system-libs`, `data-libs`) and
`apt remove <library>` are deferred: bare `apt upgrade` already covers the bundle case, and
`rm /lib/<lib>.so` as root already breaks the linked commands, so both are convenience over
capability the player already has.

#### 23. `msfconsole` runs from a script; shell effects report instead of entering

From a `node` script the exploit runs and state still changes — a backdoor is planted, a password
reset, a file written, a script injected — but a shell effect REPORTS (`root shell available on
<host>`) rather than pushing a session, and the player enters from the prompt.

This mirrors the grammar the game already has (`hydra` finds a credential, `ssh` uses it), keeps
D9's per-line-snapshot rule intact, and makes mass exploitation scriptable, which is what D9's own
`sweep.js` example was reaching toward. A `withoutScript` function of the arguments could not have
decided this: two of the eight effects push a session and which one fires is unknowable until the
exploit runs.

### Slice 2 — resolved decisions (grill-me, 2026-09-10)

Seven more, continuing the numbering. This grill was narrow by design: it settled the two opens
slice 1 carried forward (24 and 25) and the five consequences that fall out of them. It did not
reopen 1-23.

#### 24. `WORLD_EPOCH = Date.UTC(2026, 8, 1)`, shipped as a development anchor

The epic calls this the only irreversible number in the phase, and it is — but only from announce.
No CVE is ever persisted, every NPC box is frozen at `startTuple`, and the
**no-backward-compat-until-launch** rule has not sunset, so moving it today rewrites nothing. It
becomes irreversible the moment real players exist, because shifting it would retroactively rewrite
every published CVE and every player's exposure.

The alternative considered was stamping the merge date, which is truest to decision 2: development
would live through the same three clean days the first players will. It was declined because it
buys that fidelity at the cost of every slice after it — slice 4's "A upgrades, B's exploit now
fails" needs a world with published CVEs and shipped fixes, and a world at day 0 has neither. A
guessed launch date was rejected outright: game time would be negative through all of Phase 3,
nothing would publish, and no part of the loop would be playable end to end.

Ship day lands near game day 11-14. Under decision 3's 3-14 day first gap that means most packages
already carry a live CVE the moment the slice merges, which is what makes it E2E-verifiable on the
day it lands rather than a fortnight later.

#### 25. One axis-blind derivation; interpretation attaches per axis

`liveCve(key, version, gameDay)` returning `{ cve, severity, publishedAt } | undefined` is the whole
shared half, and it is identical for a daemon, a shared object and a firmware image. What differs
per axis is what a CVE *grants* — decision 9 floors libraries at user where services floor at guest,
and decision 12 has libraries rolling from per-command pools where services roll per-service — and
every bit of that lands in slices 3, 8 and 9 as a separate small interpreter.

This is what lets slice 2 derive for all three axes while rendering only one: decision 13 keeps the
effect and the tier off the wire entirely, so the axis-aware half has no caller yet and none of it
is written speculatively.

`key` is the apt package name, or the **firmware vendor** on the third axis. The manifest records
`Package: firmware` with a bare tuple and no vendor, but `pickFirmwareVendor(identity.firmwareSeed)`
(`routerFs.ts:177`) means the server can always re-derive which of the six a box runs — which
settles slice 1's "revisit `<vendor>-firmware` only if slice 9 finds the vendor unreadable from the
manifest alone". It is readable, from the seed rather than the file.

The rejected alternative was three entry points, one per axis. It would have written the walk, the
id scheme and the severity roll once and then copied them twice — the drift decision 11 refused when
it made `libraryDeps` the single authority for what a command links.

#### 26. The CVE serial is a stable package number plus a scrambled index

`serial = packageNo * 100000 + scramble(pkg, index)`, where `scramble` is a per-package affine
bijection on `[0, 100000)` — unique by construction, collisions impossible rather than unlikely. The
year comes from the real calendar date of `WORLD_EPOCH + publishedAt`, not legacy's
`2026 + floor(days / 365)`, which with a September epoch would stamp `CVE-2026` on CVEs publishing
well into 2027.

Two flaws in legacy's scheme are fixed rather than ported:

- **`TEMPLATE_KEY_IDS` sorts every template key alphabetically and assigns positions**
  (`generatedVuln.ts:16`), so adding one package renumbers every CVE alphabetically after it.
  Harmless in legacy, whose own comment notes ids are regenerated each run and never persisted; here
  it would silently rewrite ids already sitting in players' log files. Package numbers are
  hand-assigned in the template row and never move.
- **The last four digits were the timeline index.** Decision 21 keys the reset password on
  `md5("pwned-<last4-of-cve>-<tier>")`, and legacy's packing ends every package's first CVE in
  `0000`. Under decision 4 every NPC in the world is frozen on its first CVE forever, so
  `pwned-0000-<tier>` would have been a near-universal password for a player who never read a log —
  and reading the log is the entire recovery mechanic decision 21 built.

#### 27. Five columns, fixed widths, severity in its own

`PORT 9 · STATE 6 · SERVICE 9 · VERSION 16 · CVE 18 · SEVERITY` unpadded last: 66 characters at the
widest a table can get. `VERSION` becomes a padded column for the first time, which is the one real
cost — slice 1 put it last precisely so it needed no padding.

Sixteen is enough because **firmware has no port**. The widest version a port table can hold is
`net-snmp 5.9.4` at fourteen characters, not a router's `MikroTik RouterOS 7.14.2`; firmware
surfaces in `apt list -u` (slice 4) and in the manifest, never in a scan.

Severity gets its own column rather than trailing the id inside one, so it lines up vertically —
which is the job decision 9 gave it when it made severity forecast the privilege. Content-sized
columns, the way real nmap sizes its own, were rejected: two scans of different boxes would stop
lining up with each other, and slice 1 established fixed constants.

A port has exactly **0 or 1** CVE, ever: one installed version is one timeline entry is one CVE.

#### 28. There is no clock override, in any environment

`gameDay` is a plain parameter through every `core/` function. Tests name a day directly; to
playtest a future world you edit `WORLD_EPOCH` and restart, which moves client and server together
because there is only one number and neither can override it. The constant is the dial.

A dev-only client override was rejected as an active liar: from slice 3 on it would render a CVE and
an exploit door that the server, on its own clock, refuses — producing playtest failures that are
not bugs. A client-and-server override was rejected as the one environment variable that, left set,
hands every player an arbitrary world clock in the phase where time *is* the authorization.

#### 29. A dated tripwire test guards the anchor

One test fails once `WORLD_EPOCH` is ~90 days stale, with a message naming the choice: re-stamp it
for launch, or move the runway forward deliberately. It cannot be forgotten, only answered, and it
is deleted at launch.

The cost is real and accepted — one red CI run on a PR that has nothing to do with it. A checklist
line was rejected because it is exactly the mitigation this repo has already watched fail twice:
`ldd` and `msfconsole` sit stamped as binaries with no command behind them, "the `dig` situation X1
called out, standing open for two more slices", and `metadata.libraryLinks` was declared,
round-tripped by the codec, and never populated or read.

#### 30. Slice 2 delivers as one PR

Clock, derivation, the two new columns, the two wire fields and the extended
`testCrossPlayerScanTrace.ts` land together — roughly slice 1b's size. The split considered was
local vantages first and the cross-player wire second; it was declined because in between, a
stranger's box would show a version with a blank CVE cell while your own LAN showed both. Slice 1
threaded the version through all five vantages at once for the same reason.

### Slice 2 — forced rather than chosen

- **The CVE rides the same wire as the version, and `OpenPort` grows two optional fields.** Slice 1
  deliberately put only the RENDERED string on the wire — "not a package and a tuple to be joined
  later" — so a client cannot re-derive a CVE from what it receives without reversing the render.
  The derivation therefore happens where the package name and the raw tuple live, and this extends
  slice 1's existing wire-check rather than adding a new one.
- **`gameDay` is an integer** — `floor((now − WORLD_EPOCH) / 86400000)`, ported from legacy's
  `getGameTime`. The whole world turns over at one instant each day rather than CVEs trickling in at
  odd hours.
- **A CVE is global.** Every box in the world running `openssh-server 9.7.0` carries the same id and
  the same severity, because that is what a CVE is — legacy seeds its timeline on the package name
  alone, and nothing about v2's per-machine or ESSID-shared seeding changes that. Recon compounds:
  learn a version's CVE once and you know it everywhere. Under decision 21 it also makes a reset
  password portable across every box ever reset through that CVE.
- **By game day 14 every NPC service and library carries a permanent live CVE.** The first gap is
  3-14 days and decisions 4 and 5 freeze NPCs at `startTuple`, so the world reads as near-uniformly
  vulnerable rather than as a mix. Accepted there already, and already named as what NPC maintainer
  actors will close.
- **A player-installed package still has no CVE**, because `apt install` writes a binary patch with
  no manifest row beside it. Slice 1's recorded debt to slice 4, unchanged by this slice.

### Carried forward from slice 2's implementation

- **The forward timeline walk lands in slice 4, not slice 2.** Every box is frozen at `startTuple`
  (decisions 4 and 5) and nothing moves a version until `apt upgrade`, so `liveCve` is only ever
  called with index-0 versions and the walk past entry 0 has no caller and no observable. Slice 2
  draws the first gap on the same PRNG stream the walk will use, so extending it is purely additive
  and republishes nothing. Deferred by owner decision 2026-09-10, mid-implementation.
- **A root player can hide a CVE by hand-editing `/var/lib/dpkg/status`.** The manifest is the
  version authority by design, and it is a world-readable, root-WRITABLE file — so writing
  `Version: 9.9.9` makes a scan report no CVE at all, on the server's own recomputation as much as
  the client's. Harmless while nothing is exploitable, and free immunity from slice 3 on. It is
  decision 22's pinning mechanic pointed the other way, and it wants the same answer: **slices 3 and
  4 own deciding whether an unrecognised version is treated as clean, as its nearest known
  ancestor, or as unpatchable.** Do not let it default silently.

### Out of scope for slice 2

No effect and no tier — decision 13 keeps both off the wire until slice 3. No `apt list -u` and no
patch-delay ETA (slice 4). No library or firmware RENDERING: the derivation is axis-blind and gets
tested with a library key, but nothing displays either axis until slices 8 and 9. Nothing is
exploitable — the player can only watch it happen.

### Slice 3 — resolved decisions (planning, 2026-09-10)

Five questions the phase grill did not reach, settled before any code was written. Numbering
continues the phase's own sequence.

#### 31. An effect slice 5 has not built yet collapses to a LIMITED shell

The full eight-kind pools ship in slice 3 and **the roll is final**: slice 5 changes what a rolled
effect DOES, never which effect a CVE has. That is the same discipline slice 2 applied to the
timeline walk — draw on the stream you will keep drawing on, so extending the code republishes
nothing a player has written down.

The cost is recorded rather than discovered: for slices 3 and 4 every exploitable service hands
over a shell, so the world is far more generous than decision 8 intends and `hydra` is temporarily
out of a job. It is accepted because the alternative — an unbuilt effect reading as a module that
failed — would bury the attack → patch → inert signal under refusals that mean nothing, at exactly
the slice the loop-first ordering exists to make provable. Under this rule, every refusal in slices
3 and 4 means one thing: **the CVE is not live on that box.**

#### 32. `formatExploit` is a REQUIRED column on every catalog row

All seven rows (ssh, http, ftp, mysql, redis, snmp, dns) get one when the column lands, and the
type makes a service row impossible to add without deciding where its exploits show up. An optional
column with a generic syslog fallback would let a future door quietly file its break-ins somewhere
the defender does not look — a second authority over where a service logs, which is the drift
decision 15 cites D8 for refusing.

**A follow-up comes with it.** Decision 15's own example says an http CVE leaves its trace in
`access.log`, but the rule in the same paragraph — reuse that row's `sweepLog` destination — puts it
in `auth.log`, because the http row's sweep destination is auth.log by INHERITANCE (the catalog row
says so in its own comment: *"a real HTTP brute-force belongs in access.log as a run of 401s — that
is the web door's call to make"*). The rule wins: one service's evidence stays in one file. Moving
the web door's evidence to `access.log` would move its credential sweeps too, and that is its own
correction — **left open, not smuggled into slice 3.**

#### 33. `shell_full` is an ssh hop, `shell_limited` is an nc backdoor shell, and the row says which

The behaviour ports from legacy unchanged: a full shell has a TTY, lands in the account's home and
can pivot onward; a limited one has none, so `ssh`, `nano` and every prompting command refuse it —
a room you can search but not a door you can pivot onward through, which is already the shipped
comment on the `nc` backdoor.

What does NOT port is the absence of a row. Legacy minted no session for either and trusted the
client's envelope for the tier, which is the hole decision 18 exists to close. v2 records
`kind: 'exploit'` for a full shell and a new `exploit_limited` for a limited one, because three
places already read that field per kind: `hasTty` (`shell/runLine.ts`), the refresh allowlist
`HOP_KINDS` (`ui/sessionRehydrate.ts` — a full shell survives a refresh, a limited one is ended like
any other parallel session), and `isCrossPlayerHop` (`ui/activeRoot.ts`). Reusing `ssh` would show a
defender running `ps` a login that `auth.log` never recorded — contradicting the very trace decision
15 requires — and reusing `nc` would report a CVE-granted shell as a backdoor somebody planted.

#### 34. Slice 3 targets generated NPC hosts only

The edge router and every seeded sibling `ssh` already reaches through `resolveLanHostIdentity`. A
fellow occupant on the same ESSID is deliberately OUT even though they are on the same LAN: every
cross-player question — whose journal, whose log, whose source IP — is answered once, in slice 6,
for the public, forward and deep routes together. It also means the first player rooted by a CVE
happens after the trace has been exercised against NPCs for two slices rather than before.

#### 35. Slice 3 is ONE PR

About twenty files, comparable to slice 2's twenty-one. Splitting the derivation (effect pools,
tier ladder, the seven formatters) into a lower PR would make it a horizontal layer with no
observable behaviour — the thing the epic's own slicing rule rejects. One mutation gate, one
wire-check, one review of the whole door.

**Narrowed at planning, and needing the same sign-off slice 2's deferrals got: decision 23's script
grammar moves to slice 5.** `msfconsole` carries `withoutScript` until then. The grammar exists so a
scripted exploit still changes state while a shell effect merely reports — but under decision 31
every effect in slice 3 IS a shell, so a scripted run could only report, would mint a session row
nobody enters, and would write a trace for an exploit the player must then fire again from the
prompt. It earns its keep the moment a non-shell effect exists.

### Slice 4 — resolved decisions (planning, 2026-09-11)

Four more, continuing the numbering. Slice 4 was grilled with the phase's other twenty-three
decisions, so it needed `planning` rather than another grill; these are the four questions planning
had to settle before slices could be written. Both PRs have landed and the plan file is deleted;
the as-built is
["Phase 3 slice 4 — the defender patches"](#phase-3-slice-4--the-defender-patches--shipped-v02140v02150-498-499).

#### 36. An off-timeline version resolves to its nearest known ancestor

The manifest is the version authority and it is root-writable, so a player can type a version the
world never published. Until now that read as clean everywhere — free immunity since slice 3, and
the debt slices 3 and 4 were told to decide rather than let default.

The rule is total and has no carve-out: a version resolves to the newest timeline entry at or below
it; a version below the starting tuple, or one that is not a tuple at all, resolves to the starting
version. `Version: 9.9.9` therefore buys exactly what being fully patched buys and nothing more —
lying becomes **pointless** rather than punished — while `Version: banana` drops the box to birth
exposure. Decision 22's downgrade-pin is untouched, because the version an attacker pins to is a
real entry and resolves to itself.

The rejected alternatives were leaving it clean (one line in one file makes a box permanently
unexploitable and `apt upgrade` optional — the phase loses its pressure), and resolving every
unrecognised version to the starting tuple (harsher than honesty: typing a real future version
would backfire, teaching the player that touching the file is dangerous rather than futile).

#### 37. Slice 4 delivers as two PRs — a fix is visible, then the defender patches

4a ships the forward walk, the resolver and `apt list -u`: read-only, and the first time a CVE
appears on the player's OWN box rather than through a scan of somebody else's. 4b ships
`apt upgrade`, install through the same resolver, the manifest patch on install, and the live loop.

The pair mirrors slices 1 and 2 for the same reason those were split: a read surface is
independently useful and independently wrong-able. Slice 3 was one PR (decision 35) and this slice
is larger — two command surfaces, a rewritten derivation core, a write path and a wire-check
rewrite. Splitting at the walk instead was rejected: the walk alone renders nothing, which makes it
a horizontal slice with no observable.

#### 38. The manifest's ten base-image packages become apt rows that apt never lays down

Slice 1 left the two namespaces disagreeing: the manifest emits `openssh-server`, `vsftpd` and the
eight library names, and `apt install` has never heard of any of them — so `apt list -u` would
print rows a player cannot type back at apt.

They become catalog rows marked as shipped with the image. `apt install openssh-server` answers
*"openssh-server is already the newest version"*, which is **true on every box in the world** and so
is not a fiction, while `apt upgrade` and `apt list -u` work on them normally. Apt never lays down a
binary or a `.so` for them, so no install path is invented for software that is already everywhere.
This closes slice 1's check — every package name the manifest can emit is one apt knows — with
`firmware` as the single declared exception, synthetic by design and owned by slice 9.

The rejected alternatives were making them fully installable (libraries would need apt to write
`/lib/*.so`, and `binariesForService` would start matching `sshd` and `vsftpd`, shifting world
generation for no player-visible gain) and leaving the split (keeps the wart that
`apt upgrade openssh-server` works while `apt install openssh-server` denies the package exists).

#### 39. `apt install pkg=<version>` pinning is deferred to the attacker slices

Decision 22's apt surface includes downgrade-only pinning and the slice spine does not name it here.
It stays out. This slice is the DEFENDER's loop and is already the phase's biggest; pinning is pure
attacker persistence with no defender value, so it does nothing for the playtest slice 4 exists to
enable. It also needs its own surface — `pkg=version` parsing, downgrade-only validation, and a
refusal for a version the world has not published yet. Owed to slice 5 or 6, and it gets the
resolver this slice builds for free.

### Own-LAN scan fix — resolved decisions (planning, 2026-09-13)

Four more, continuing the numbering. Not one of the nine Phase 3 slices: a cross-cutting defect
whose fourth face slice 4's browser run exposed, delivered as two PRs — **✅ SHIPPED v0.216.0–v0.217.0
(#500, #501)**, as-built above. The client resolved an own-LAN scan from seeded trees while a
PUBLIC-IP scan replayed the target's journal, so `nmap` misreported a box that was patched, bricked,
backdoored, filtered or shut — open since D5 and recorded in the conventions doc's own gotcha list
ever since, now CLOSED there.

#### 40. All four faces close together, and the `.1` gateway is in scope

One missing journal replay causes all four, so one change closes all four; splitting by face ships
the same endpoint twice. The AP gateway is included despite its different builder and vantage,
because leaving it out knowingly preserves the `snmpset` face on the one box every occupant of a
network shares. Fixing only the VERSION/CVE columns was rejected: `readOpenPorts` answers ports and
versions from the SAME read precisely so a scan cannot name a version and a hole belonging to
different software, and halving that reintroduces the drift the design exists to prevent.

#### 41. A failed resolution reports the host UP with no port table

`resolveOccupant`'s rule, unchanged: the host list has already placed the box on the LAN, so
collapsing our own failed round trip into "down" blames a live neighbour for our outage. Falling
back to the seeded read was rejected — the fallback IS the lie being fixed, and it would be silent.

#### 42. The verified signature is the whole authorization

Matching `resolveInnerGatewayScan`, whose comment already settles it: the boxes belong to the access
point, so every occupant scanning an address is scanning one box. **Recorded delta, accepted
knowingly:** an ESSID is readable from `airodump-ng` without cracking it, so a crafted client could
learn what players have DONE to a network's NPCs without joining it. Today that leaks nothing
because NPC state is computed from a seed anyone can compute; afterwards it leaks journal state. It
is the exposure the inner-gateway endpoint already accepts, and the alternative costs an occupancy
lookup on every single-host scan. Revisit if a mission makes NPC state valuable before entry.

#### 43. Only single-IP scans resolve — a range needs no journal

The recorded open question ("single-IP only, or batch a range, since a `/24` would resolve up to 253
journals") answers itself in the code: `resolveHostPorts` is passed only to `scanSingle`, so a range
scan prints `IP / HOSTNAME / KIND` and no ports at all — confirmed live, twelve hosts and not one
port. There is no batching endpoint to design and no 253-journal problem to solve. **This retires
the blocker that deferred the fix.**

### Slice 8 — resolved decisions (grill-me, 2026-09-18)

Eighteen decisions, numbered 63–80, each grounded in code first: twelve grilled on this date, three
added at PR4's planning (75–77, 2026-09-19) and three at PR6's (78–80, 2026-09-20). **Decision 69
supersedes decision 17**, and **decision 80 corrects decision 68**. `find-gaps`-checked 2026-09-18 —
seven gaps closed and written into decisions 63, 69, 71 and the routine list (each marked
"find-gaps, 2026-09-18"); none parked. Shipped as nine independent PRs, #519–#527; the as-built is
in `### Phase 3 slice 8 — libraries fall` near the end of this file, and the plan file it was
planned in (`plans/libraries-fall.md`) is deleted.

**An earlier grill the same morning** answered several of these questions, but its record never
reached the file, and the later grill re-decided some of them without it. Its answers were
re-put to the owner one at a time and written back into decisions 67, 68, 69, 71, 72 and the new
74 and the routine list (each marked "recovered grill, 2026-09-18"). Where the two grills
disagreed, the owner kept the later answer — decision 71's carry-it-in model over the earlier
"`msfconsole` runs from the player's own workstation".

**What grounding changed before a single question was asked:**

- **Library timelines already shipped.** All eight libraries carry a `PACKAGE_TEMPLATES` row
  (`packageVersions.ts` — `libpam` is package 8, `startTuple` 1.5.3) and `liveCve.test.ts` already
  derives live library CVEs (`libpam` goes medium on day 3, `libpcre` high on day 9). The slice
  row's "library timelines" is done; what is left is the per-axis INTERPRETER decision 25 deferred
  here, the pools, `ldd`, `--local`, the trace and the `libraryLinks` deletion.
- **`su` is already split by who is at stake** (`su.ts:112-120`). On the player's own box and an
  NPC hop it is client-local — reads the local `/etc/passwd`, pushes a local session. On another
  player's workstation it is server-authoritative (`suElevate`, `api/sessions.ts:940`), because
  the patch L2 gate reads the SERVER row's tier. `--local` is `su` with a CVE where the password
  was.
- **The exploit gate resolves by address and port** (`exploitCreateSession.ts`). It has no notion
  of "the box I am standing on"; `exploitOutcome` returns `undefined` for a library by design.
- **Nothing ships `msfconsole` except `apt install metasploit`** (`aptPackages.ts:145`), which
  needs root, and no command runs by path — the search path is `/bin`, `/usr/bin`, `/usr/sbin`
  only (`availability.ts`). So V4's own acceptance line, *"B (guest) `msfconsole --local su` →
  root"*, could not happen on any box B had not already rooted.
- **`msfconsole` has no `withoutTty`**, so it already runs inside the PTY-less shells (`nc`,
  `exploit_limited`, `runLine.ts:73`), where `su` refuses.

#### 63. Authority follows `su`'s split — client-local on own box and NPC hops, server on a player's workstation

On the player's own box and an NPC hop the client reads that box's `dpkg/status`, runs `liveCve`
plus the library interpreter, and performs the effect locally, exactly as NPC `su` already does.
Nothing there is anyone else's to protect: an NPC box is the player's own copy, and its root
password was crackable anyway.

On another player's workstation a new server action beside `suElevate` regenerates the box,
replays its journal (so the owner's `apt upgrade` history counts), recomputes the library CVE from
that manifest, and mints the row at the granted tier. This is the path that decides decision 6's
"patch or die" — B holding a guest shell on A's stale box becomes root — and a client that could
claim the outcome could forge root on another player's machine.

Rejected: every `--local` through the server. Uniform, but a round trip and a new resolve path for
NPC boxes where no other player is at stake, and stricter than the `su` it replaces.

**An owner who has left the network answers exactly as `su` does** (find-gaps, 2026-09-18). The
server action resolves A's box through occupancy, as `suElevate` does; with no occupancy row it
returns `404 host_unreachable` (`authElevateSession.ts:180`), which `msfconsole` renders in the
wording it already uses — `No route to host` (`msfconsole.ts:239`). Nothing is written: no session
row, and no `kern.log` line, because nothing ran on a box that is not up to crash. Rejected:
resolving from the persisted identity regardless — it would let B escalate on a machine that is
off the network, which `su` refuses and nothing else in the game allows.

**Standing on the box IS the authorization, so the server proves it** (find-gaps, 2026-09-18).
`suElevate` stores `parent_session_id` but never checks it — safe there, because a password is its
authority. `--local` has no password, so a copy of that shape would let any signed player name any
online workstation's machine id and walk away root without ever holding a shell on it. The request
names the caller's current session, and the server requires that row to be **open** (`ended_at IS
NULL` — so slice 7's reboot eviction ends the right to escalate too), **owned by the verified
signer** (the player key from the signed envelope, never a body field), and **on that exact
machine**. Its tier is irrelevant (decision 66). Any check failing refuses with the same `No route
to host` as an offline owner and writes nothing — a caller who does not hold the box learns nothing
about it.

#### 64. When a command links two libraries, the highest-severity live CVE wins; ties go to `libraryDeps` order

`su`, `apt` and `ssh` each link two. Legacy took the first live one in link order, but under
decision 9 severity decides the tier, so link order would let a medium `libpam` shadow a critical
`libcrypt` — the player reads critical in `apt list -u`, fires `--local su`, and lands as user.
The scan and the exploit would disagree, which slices 2–3 were built to make impossible. (Today's
`apt list -u` prints no severity at all; decision 74 is what puts it in that row.)

#### 65. The effect is seeded on `(command, library, release)`, never the machine

`effect:local:${command}:${library}:${release.index}`, parallel to the service axis's
`effect:${key}:${release.index}`. A local hole is learned once and holds everywhere; the client
and the server compute it with no machine id, so decision 63's two paths cannot disagree; and
decision 12's "pick your payload by picking the command" survives, because each command keeps its
own pool.

Rejected: legacy's `local-exploit:${machineId}:${command}:${cve}` — every box its own lottery, and
a break from the rule the service axis already keeps.

#### 66. No tier comparison — a same-or-lower grant fires normally

A shell effect pushes a hop at the granted tier even when it is no higher than the caller's, and
`exit` pops it like a pointless `su`. A read, list or write runs at the granted tier. The trace
(decision 69) lands either way. One rule and no second refusal message; the tier was already
predictable from the severity the player could read before firing. Rejected: refusing with
"nothing to gain" — a branch, a message, and the same comparison repeated server-side against the
caller's row.

#### 67. `ldd` ports verbatim — presence and paths, no version, no CVE

Legacy's `\t<lib>.so => /lib/<lib>.so (0x…)` with a stable per-library address, `not found` when
the `.so` is missing, and legacy's line for a command that links nothing. It reads `libraryDeps`
(decision 11) and the `/lib` of the box the player stands on. The version is the manifest's to
tell — a version in `ldd` would be a second copy of the fact decision 14 kept out of the banner.
Recon is two tools, each reporting its own fact: `ldd su`, then `grep libpam
/var/lib/dpkg/status` (or `apt list -u`).

**It takes a name or a path, and the file must exist** (recovered grill, 2026-09-18). A path is
taken literally; a bare name resolves through `/bin`, `/usr/bin`, `/usr/sbin` as the shell does.
Either way the binary must be on this box, and the map is looked up by the tool its stub CONTENT
names (decision 71), not its filename — so `ldd /tmp/foo`, where `foo` is a copied `su`, lists
`libpam` and `libcrypt`. A missing file prints `ldd: <arg>: No such file or directory`; a present
file that links nothing (`mkdir`, a daemon, a text file) prints real `ldd`'s `not a dynamic
executable`, replacing legacy's game-voiced line. This is what makes V4's acceptance line, `ldd
/bin/su`, true as written. Rejected: legacy's name-only form (it answers from the map for a binary
that is not there, and cannot see a carried copy); path-only (`--local su` takes a name, so the
player would type the same binary two ways).

#### 68. Legacy's seventeen pools first; the map extension and its pool contents are the last PR

The seventeen `SYSTEM_COMMAND_EFFECT_POOLS` entries port with ORDER AND REPETITION intact, as
**effect kinds only** — legacy baked `tier: 'root'` into every entry, and decision 9's library
floor is what sets the tier now. Decision 12's extension to the game's own tools (`nmap`, `node`,
`hydra`, `gpg`, `lynx` and kin) lands as slice 8's final PR, with each new command's link AND pool
together (a mapped command with no pool is not exploitable), and the pool contents — including
whether `node` gets one at all — decided at that PR's planning, once the axis is playable.

**The boundary is decided now: every apt-installed client tool, and nothing else** (recovered
grill, 2026-09-18). `nmap`, `hydra`, `john`, `nc`, `ftp`, `gpg`, `node`, `gobuster`, `lynx`,
`dig`, `nslookup`, `mysql`, `redis-cli`, `snmpwalk`, `snmpset`, the aircrack trio, and
`msfconsole` itself. Daemons stay out — they are the service axis. The eight library-free system
utilities (`mkdir`, `touch`, `man`, `ping`, `ifconfig`, `nmcli`, `clear`, `whoami`) stay out, as
the ported comment lists them. So an NPC's local surface stays exactly legacy's seventeen
(**wrong on the facts — corrected by decision 80**), and every tool a player installs widens their
own — tooling up becomes a defensive cost, a trade-off without a new rule. Libraries come from the existing thematic grouping (network clients link
`libssl`, matchers and parsers `libpcre` or `libxml2`, prompt-driven tools `libreadline`). Only
the pool CONTENTS wait for that PR's planning. A consequence to plan for: mapping a tool switches
on `wrapWithLibraryCheck` for it, so `rm /lib/libssl.so` starts breaking `nmap`. Rejected: only
the five decision 12 named ("and kin" stays undefined); every binary-backed command (it changes
every NPC box and widens decision 5's day-14 surface).

#### 69. The trace is only what a real box would record — supersedes decision 17

A real Linux box has no "exploit" log line: nothing on the system knows a library was misused.
What it records is whatever the affected program and the kernel ordinarily write, and that is all
the game writes:

- **A miss** — a linked library, none of them live — is a crash, and the kernel records it:
  **one `kern.log` line naming the command and the library** it faulted in (the realistic shape is
  `su[pid]: segfault … in libpam.so`). `kern.log` already exists on every box (`kernLog.ts`,
  root-write, world-read). A command that links nothing crashed nothing and writes nothing.
- **A shell success** writes the ordinary `auth.log` session line that opening such a session
  writes — with no password line before it and no CVE id. The missing authentication is the whole
  tell, and a careful defender can see it.
- **Every other success** — a read, a list, a write — writes nothing. Stock Linux does not log
  file access without auditd configured.

Decision 17's `/var/log/syslog` line naming command, library and tier is dropped because no real
system writes it. **The cost is accepted by name:** a working local exploit is now quieter than
`su`, which is the incentive decision 17 existed to close. Under this model that is the trade — a
quiet success is the reward for finding a live library, a miss is loud, and the defender's clue
that says *patch your libraries* is the same library name recurring in `kern.log` crash lines.

**How each line is written** (find-gaps, 2026-09-18). On the client-local path both go through
`env.log`, the route `su` already uses (`su.ts:84-107`): the SERVER stamps the game time, so a
crafted request cannot dictate it, and the append is best-effort — a failed write never fails or
reverses the exploit. That needs two additions: `env.log.appendKernLog` for the crash line (the
client supplies only the command and library), and a new `AuthLogEvent` variant for a session
opened with no authentication before it (today the type describes only a `su` switch). On the
server path (decision 63) the action writes both itself under the owner's writer key, as
`suElevate` already does, with no client call. Rejected: direct client-side file patches — one
route fewer, but the client would pick its own timestamps.

**A local `password_reset` leaves no clue, and that is accepted** (recovered grill, 2026-09-18).
Decision 21's recovery rests on "the trace names the CVE" — true on the service axis (decision 15),
false here, where a non-shell success writes nothing. So a player whose root was reset through a
library has lost it unless they work the new password out: `apt list -u` (decision 74, no root
needed) shows the id and severity of every live CVE on their own box, and the `pwned-XXXX-<tier>`
shape does the rest — but nothing tells them a reset happened, or through which axis. Rejected:
PAM's real `password changed for root` line (the defender would learn the fact and the time for
free); restoring a CVE-naming line (overturns this decision by name).

#### 70. All eight effects on both paths; the server reuses slice 5's handlers

The eight effect handlers slice 5 built in `exploitCreateSession.ts` each act on a machine at a
granted tier; for `--local` that machine is the one the caller stands on, located through the
caller's own session on it rather than by an address and a port. On the client-local path each
effect is the ordinary local operation at the granted tier. Decision 23's third-argument grammar
carries over (`msfconsole --local <command> [path | local:remote]`, both halves on the same box),
as does its scripting rule — a shell effect from a `node` script reports rather than entering.
Rejected: decision 31's collapse-to-limited while effects land later — it was right when the
handlers did not exist, and would now be a temporary branch written only to be deleted.

#### 71. A copied binary runs by explicit path, gated exactly like an installed one

`/tmp/msfconsole --local su` and `./msfconsole …` resolve the named file, which must be a real
binary stub the caller's tier may execute; bare names still resolve only through `/bin`,
`/usr/bin`, `/usr/sbin`. One rule — *you need the tool on the box you stand on* — satisfied the
way a real attacker satisfies it: carry it in (`scp` or `ftp put` into a writable place) and run it
by path. A copy that lost its execute bit is fixed by `chmod +x` on the player's own copy, which D10
already allows (*whoever may WRITE a node may chmod it*). It works for every tool, not only
`msfconsole`.

**A binary is what is IN it, not what it is called** (find-gaps, 2026-09-18). Every binary today
carries the one identical `BINARY_STUB` (`binaries.ts:39`), so dispatching a path by its FILENAME
would let `cp /bin/cat ~/msfconsole` mint any tool from any binary — voiding this decision's
"carry it in" and every binary-presence gate the game has. So each stub's content names its tool
(`BINARY_STUB` plus the tool name, stamped by the one function generation and `apt install` both
use), and path execution dispatches on the CONTENT. Renaming a copy changes nothing — `~/foo` copied
from `/bin/cat` runs `cat` — and `strings` on a binary shows its name. A file whose content names
no registered tool is not executable. This re-rolls every generated binary's content, which the
pre-launch no-backward-compat licence allows.

**Path execution is prompt-only** (find-gaps, 2026-09-18). D9's script globals keep resolving
through `/bin`, `/usr/bin`, `/usr/sbin` exactly as shipped — a script has no path syntax for a
global to take. A carried tool is usable by hand; scripting it needs a box where it is installed,
which means root. Rejected: an `exec('/tmp/msfconsole', …)` script helper — new sandbox surface of
the kind D9 refused by name (`sh()`).

**On another player's workstation the server checks the carried binary itself** (recovered grill,
2026-09-18). Decision 63's authorization proves the caller stands on the box; it does not prove
they brought the tool, so a forged client could skip carrying it in. The request names the path
the client ran, and the server checks that file on the replayed box: it exists, its content names
`msfconsole`, and the caller's session tier may execute it. Any failure is the same `No route to
host`, writing nothing — only a forged client reaches it, so the refusal owes it no explanation.
This relies on the `scp`/`ftp put` onto that box being journaled, so the replay sees the copy;
planning verifies it. Rejected: any `msfconsole`-content file anywhere on the box (it would
authorize a fire the client could not have made); trusting the client.

The other route already exists and costs nothing: a player who reaches root by any other means can
`apt install metasploit`. Path execution covers the case that route cannot — a guest, who can
install nothing.

Rejected: exempting `--local` from the binary check (a carve-out, and unrealistic); shipping
metasploit on a share of generated boxes (escalation by placement luck); accepting the gap (V4's
acceptance line unreachable).

#### 72. Slice 8 delivers as six independent PRs to trunk

Six since the recovered grill (2026-09-18) added decision 74's `apt list -u` change as its own PR.

1. **`ldd`**, plus deleting `metadata.libraryLinks` (decision 11). `ldd su` lists libpam and
   libcrypt, and `not found` once one is removed.
2. **Explicit-path execution** (decision 71). A binary copied into `~` or `/tmp` runs by path once
   its execute bit is set.
3. **`apt list -u` names the CVE and its severity** (decision 74) — the forecast the escalation
   reads from.
4. **`--local` client-local** — the library interpreter (decisions 64–66, the library floor), the
   seventeen pools, all eight effects, the realistic traces. A guest on an NPC box carries the tool
   in and becomes root without the root password.
5. **`--local` on another player's workstation** — the server action, reusing slice 5's handlers,
   with decision 71's server-side check of the carried binary. B, a guest on A's stale box, becomes
   root; A's `apt upgrade` closes it.
6. **The map extension** to every apt-installed client tool (decision 68), with its pools decided
   at that PR's planning.

1, 2 and 3 are independent of everything; 4 needs 2 only for the "guest carries the tool" story (it
runs on a box the player already roots without it) and 3 only for decision 64's forecast to be
readable; 5 needs 4's interpreter. Independent PRs, not a stack — no layer needs an evolving shared
baseline before its predecessor merges, and slices 5–7 delivered the same way.

#### 73. The escalated shell inherits the TTY of the shell it was fired from — `--local` raises the tier, never the door

From a shell with a terminal, `shell_full` and `shell_limited` open what they rolled. From a
PTY-less shell (`nc`, `exploit_limited`) both open a PTY-less shell at the granted tier. A root
exploit run inside a netcat pipe gives root inside the same pipe, and `hasTty`'s rule — *only a real
login, or the full grant, can be pivoted onward from* — stays whole: root through a backdoor is a
root that can search and break, not pivot, until the player earns a login (`password_reset`, then
`ssh`). Rejected: refusing from a PTY-less shell as `su` does (it shuts `--local` out of the vantage
it is most wanted in); letting `shell_full` upgrade to a TTY (a quiet bypass of the pivot rule).

#### 74. `apt list -u` rows name the CVE and its severity — never the effect

(recovered grill, 2026-09-18.) Today a row reads `libpam 1.5.3 [upgradable → 1.5.4]` or
`[vulnerable, no fix yet — ETA ~N days]` (`apt.ts:258`): it says a package is exposed, never how
badly. Services have `nmap -sV` for id and severity; libraries had nothing, so decision 13's
"severity forecasts the privilege" had no library half and decision 64's reasoning described output
that did not exist. A row that carries a live CVE now shows its id and severity beside the move, in
one format for every package, services included — e.g. `libpam 1.5.3 [CVE-… high · upgradable →
1.5.4]`. It never shows the effect: that stays the act of firing (slices 2–3). It needs no root
(the manifest is world-readable), gives the defender a triage order, and gives a player whose root
was reset through a library their only route back (decision 69). Rejected: fire to find out
(severity public for services and secret for libraries, with no principle behind the split);
severity without the id (the defender loses the id to match, and it is no use to an attacker —
`--local` fires by command, not by CVE).

#### Slice 8 — folded in as routine

- **One uniform miss message**, legacy's `msfconsole: no known vulnerability on <command>`, for an
  unmapped command, no live library and a missing `.so` alike — a miss never says which it was.
- Library CVEs surface in `apt list -u` (decision 74), not in `nmap -sV`, which reads ports.
- **No new session kind** (recovered grill, 2026-09-18). A local shell effect mints the same
  `exploit` / `exploit_limited` rows `exploitCreateSession.ts` already uses — nothing could observe
  a third kind, and slice 7's reboot eviction already ends every row alike.
- **Routers, switches and the AP gateway are in, with no carve-out** (find-gaps, 2026-09-18). All
  three builders stamp the eight libraries (`remoteHostFs.ts:391`, `routerFs.ts:273`,
  `workstationFs.ts:138`), so any box the player stands on is in scope through the client-local
  path. The library axis there is independent of slice 9's firmware axis — slice 9 adds a second,
  separate way in, and its planning should not assume routers were excluded here.
- **A missing `.so` writes no crash line** (find-gaps, 2026-09-18). A program whose library is
  gone never loads, so nothing faulted and a real box has nothing for `kern.log`; `--local` prints
  the uniform miss message, so a deleted library and a patched one are indistinguishable to the
  caller. That leaves the defender a real, costly lever: `rm /lib/libpam.so` as root closes the
  hole silently, and breaks `su` for everyone on the box.
- Evidence: PR 5 carries a `scripts/test*.ts` wire-check against `vercel dev` + supabase; PR 4 a
  solo browser run. Every PR bumps the version.

#### 75. PR4 splits into three: shells, effects, traces (PR4 planning, 2026-09-19)

Planning PR4 found `api/` work its Evidence line had not counted: nothing on the client can append
to `kern.log` (only the server writes it, for `nmap` and reboot), and `appendAuthLog` formats only a
`su` switch and refuses any box but the caller's own workstation. So decision 72's PR4 ships as
**4a** (interpreter, seventeen pools, `--local` with both shell rolls and the miss), **4b** (the six
non-shell effects) and **4c** (the two traces, with their server actions and a wire-check) —
each playable and reviewable alone. Eight PRs, versions 0.235.0 → 0.242.0. Rejected: one PR (the
largest of the slice by far, mixing a client feature with a wire-checked server change); two PRs
(the client half still carries all eight effects at once).

#### 76. On an NPC box `--local` inherits `su`'s limits, by name (PR4 planning, 2026-09-19)

Decision 63 says the client-local path works "exactly as NPC `su` already does", and that includes
two limits `su` has today. A write to an NPC box is authorized server-side at the tier of the
caller's SERVER session row there (their `ssh` hop) — a client-local escalation never raises it, so
a root `file_write`, `password_reset`, backdoor or script lands at the ssh tier, exactly as a write
after a local `su root` does. And `appendAuthLog` refuses any box but the caller's own, so an NPC
box records no trace, as it records none for `su`. Shells and reads are fully client-side and
unaffected; on the player's own box every effect runs at the granted tier. Accepted as a known gap
shared with `su`; fixing it is one change for both and its own slice. Rejected: fixing it here (new
`api/` surface that `su` needs identically).

#### 77. `--local` names the library that fell (PR4 planning, 2026-09-19)

The phase output follows the service path's, with the library appended to the vulnerability line:
`[*] Exploiting <command> locally`, `[*] Sending exploit payload...`, `[*] Payload delivered,
waiting for callback...`, `[*] Vulnerability: <CVE> (<severity>) in <library>.so`, `[+] Exploit
successful!`, then the effect's line (`[+] Full shell as <user>@<hostname>` / `[+] Got shell as
…`). Legacy's `[*] Targeting <ip>:<port> (<version>)` has no meaning with no port. Naming the
library is recon the attacker already did (`ldd`, `apt list -u`); naming it on the way in, not up
front, keeps the service path's rule that the tool learns the hole from the target. An escalated
shell pushes `exploit` / `exploit_limited` (no new kind, as already folded in), and so — like any
NPC hop — does not survive a refresh on the player's own box, where the server stores only `su`
rows. Rejected: pushing `su` to persist it (the PTY-less case still needs `exploit_limited`, and
`exit` and refresh would read an exploit as a password switch).

#### 78. The toolchain links by thematic group, and `libcrypt` becomes the crackers' (PR6 planning, 2026-09-20)

Each of decision 68's nineteen links **every thematic group it belongs to** — the rule the
seventeen already follow (`ssh` is a network client that prompts, so `libssl` + `libreadline`; `su`
authenticates and hashes, so `libpam` + `libcrypt`), not a new one. Seven link two, the rest one.
The recovered grill named three groups and left `john`, `gpg` and the aircrack trio with no group
at all, so a fourth is named here: **`libcrypt` is hashes and ciphers**. That makes it a
first-class window for the first time — today only `su` links it, always behind `libpam`, so it
decides an outcome only when strictly higher-severity. `libpam`, `libsystemd` and `libz` stay
base-only, leaving `su` the authentication window alone.

    nmap, dig, nslookup, nc, snmpwalk, snmpset      libssl
    ftp, msfconsole, mysql, redis-cli               libssl + libreadline
    gobuster                                        libssl + libpcre
    lynx                                            libssl + libxml2
    hydra                                           libcrypt + libssl
    john, gpg, airmon-ng, airodump-ng, aircrack-ng  libcrypt
    node                                            libreadline

Link order is load-bearing — decision 64 breaks ties on it — so the group a tool is *named for*
comes first: `libssl` leads every row where the tool is a network client before it is anything
else, and `hydra` leads with `libcrypt` because hydra is a password tool that happens to use the
network. `libssl` lands on 13 of 19, because most attack tooling genuinely is a network client;
that concentration is decision 12's thesis working rather than a flaw — one live library, many
commands, a different payload through each. The aircrack trio shares `libcrypt` rather than
splitting by job (`airmon-ng` flips an interface, `airodump-ng` captures, `aircrack-ng` breaks),
because the package is the theme and the pools already differentiate the binaries. Rejected: one
library each (breaks the seventeen's own rule for tools that sit in two groups); two each uniformly
(invents a second link for `john`, `gpg` and the trio); all eight in play (puts a second door on
`su`'s authentication window).

#### 79. Toolchain pools top out at `shell_limited`, and every mapped tool is exploitable (PR6 planning, 2026-09-20)

`shell_full` stays with the system-control verbs and `ssh`. The toolchain's ceiling is
`shell_limited` — again the seventeen's own rule rather than a new one, since `scp` and `curl`
already top out there — and it reads exactly right: you exploited a client tool, so you get a room
you can search, not a door you can pivot onward through. `su` keeps the escalation headline.

**No mapped command is poolless.** Decision 68 allowed that state; PR4a's rule retires it. On a day
when a tool's library is live, `ldd` lists the library and `apt list -u` names its CVE, so a miss
reading `no known vulnerability on <command>` would be the exact lie PR4a rejected when it chose to
name the kind of hole rather than deny one existed. That forces a pool onto the two tools that
resisted. `node` rolls `script_exec`, whose circularity is cosmetic — the player already owns
`node`, so the prize is the TIER the library floor rolled, not the ability to run a script, and
decision 70 already governs a shell roll from inside a script. `airmon-ng` rolls `dir_list`, a
deliberately weak effect proportionate to the thinnest mapping in the table.

    nmap         dir_list, script_exec
    dig          file_read, dir_list
    nslookup     file_read
    nc           shell_limited, backdoor_port_open
    ftp          file_read, file_write, dir_list
    msfconsole   shell_limited, script_exec, backdoor_port_open
    airmon-ng    dir_list
    airodump-ng  file_read, file_write
    aircrack-ng  password_reset, file_read
    gpg          file_read, password_reset
    node         script_exec
    hydra        password_reset, shell_limited
    gobuster     dir_list
    lynx         file_read, dir_list
    snmpwalk     file_read, dir_list
    snmpset      file_write
    mysql        file_read, file_write
    redis-cli    file_read, file_write
    john         password_reset

Order and repetition stay load-bearing, as in the ported seventeen; none of the nineteen weights a
duplicate, so each rolls uniformly over its own pool. `msfconsole` maps itself and keeps the
strongest pool — turning a player's own exploit tool on them is the sharpest form of decision 68's
defensive cost. Rejected: `shell_full` for the access tools (costs `su` its monopoly and floods the
game with shell routes); no shells at all (a hole in `nc` that cannot yield a shell is a hard
sell); weighting each attack tool's signature effect (irreversible once shipped, for a
distribution nobody asked for).

#### 80. An NPC service box does gain its own clients — corrects decision 68 (PR6 planning, 2026-09-20)

Decision 68 recorded that "an NPC's local surface stays exactly legacy's seventeen". **That was
wrong on the facts.** `remoteHostFs.ts` lays `binariesForService` onto every generated host, and
that union hands a box the client binaries of the package its service comes from — so a `dns` box
already carries `dig` and `nslookup` (bind9 depends on dnsutils), an `ftp` box the `ftp` client, a
`mysql` box the `mysql` client, a `redis` box `redis-cli`, and an `snmp` box both `snmpwalk` and
`snmpset`. Mapping the toolchain therefore widens seven kinds of NPC box, not zero.

It is accepted rather than worked around, because the widening is close to inert. `su`, `nano`,
`ssh`, `curl` and `scp` are base binaries on every box, so the seventeen already cover every
library group everywhere — `libssl` through `ssh`/`scp`/`curl`, `libcrypt` through `su`,
`libreadline` through `nano`, `libpcre` through the matchers, `libxml2` through `apt`. An NPC box
gains **no new library reach, no new effect kind and no new tier**: only alternative pools on
libraries already covered, standing behind `ssh` and `su`, which both roll `shell_full` and
outrank every pool the clients add. A DNS box being a little more exploitable for carrying `dig`
is thematically right. Rejected: a box-dependent map (threads box identity through a flat global
table and splits one honest answer to "what does `nmap` link" into two); shrinking decision 68's
boundary to the twelve a player installs by choice (makes `ldd` lie on the player's own box for
seven common tools, and reopens a boundary decision 68 settled).

### Slice 9 — resolved decisions (grilling, 2026-09-21)

Ten decisions, numbered 81–90, each grounded in code first. **Decision 89 supersedes decision 82's
ordering**, and **decision 81 takes up slice 1a's own escape hatch**: the deferred item below said
to revisit `<vendor>-firmware` only if slice 9 found the vendor unreadable from the manifest alone,
and it is unreadable. Two of the ten are corrections the grill found rather than choices it made —
without **84** the axis lands a silent refusal on every router-class box, and without **89** it is
unreachable from the world's second fortnight onward.

#### 81. Firmware joins the one package namespace as `<vendor>-firmware`

The manifest records `mikrotik-firmware 7.14.2`, not `firmware 7.14.2`. Slice 1a left the trigger
condition explicit and it has fired: `installedPackages` writes
`startingFirmwareVersionOf(vendor)`, which is `formatVersion(tuple)` — a bare `7.14.2` with the
vendor-distinguishing `displayPrefix` stripped. Start tuples are distinct today but walked
timelines can collide, so tuple → vendor is not a function. The only authority is
`pickFirmwareVendor(identity.firmwareSeed)`, and every consumer that needs the answer
(`apt.ts`, `pidfile.ts`, `exploitCreateSession.ts`, `msfconsole.ts`) reads
`parseDpkgVersions(readDpkgStatus(fs))` — the filesystem alone, with no identity in scope.

`PACKAGE_TEMPLATES` splits into the two roles it currently conflates: **timeline authority**
(services + libraries + the six vendors) and **apt catalog** (services + libraries only). Firmware
has a version history and is not installable, which is also true of real firmware. The axis then
costs no new derivation — `liveCve('mikrotik-firmware', …)` resolves, `apt list -u` gains its row
from the manifest it already iterates, `upgradeStatusFor` and `displayVersion` work unchanged.

Two currently-pinned rationales reverse. `repoHolds` becomes true for firmware keys, so a rooted
router can be patched — which is what keeps slice 4's attack → patch → inert loop intact on the
third axis; without it the defender has no move at all. `apt list` still never names firmware,
because the catalog table does not hold it, and `apt install <pkg>=<version>` independently refuses
on a box that does not already carry the package.

What slice 1a actually defended survives: its "indistinguishable in the manifest" property was
about device **kind**, and all three kinds still draw from the same six-vendor pool, so
`mikrotik-firmware` says nothing about whether the box routes or switches.

Rejected: threading `identity.firmwareSeed` into four files to avoid six table rows — per-axis
plumbing of exactly the kind decision 25 exists to prevent; a `Vendor:` line in the dpkg entry (a
parser change for one package); and the vendor in the version string (corrupts the tuple three
other systems compare).

#### 82. The door is the port, and no new grammar is added

`msfconsole <host> <port>` reaches firmware. Firmware owns no port and gets no flag of its own, so
the command keeps one shape across both remote axes. Legacy does the same — `findExploitableCve`
takes `(machine, port, gameTime)` and consults the machine's firmware when the port's service has
nothing. **Superseded in part by decision 89**, which replaces "when the service has nothing" with
a severity contest; the grammar decided here stands.

Three consequences are accepted deliberately, because they are the character of the axis. A router
can **scan clean and still fall**: `nmap -sV` reads ports, firmware has none, so the CVE column is
empty while the exploit opens — decision 10's "a fully patched gateway can still fall", made
literal, and the inverse of the lying miss PR4a rejected (the scan under-promises rather than the
miss over-denying). Patching a router's services **does not close the door**, it changes which CVE
answers. And stopping every service **does** close it: nothing listening means no port to carry a
payload, which is consistent with how the rest of the game gates on pidfiles.

Rejected: `msfconsole --firmware <host>` (a third mode beside remote and `--local`, and a second
thing `--local` must not collide with); a portless `msfconsole <host>` (overloads an arity that
currently prints usage).

#### 83. Firmware reuses the LIBRARY tier floor, not the service one

`critical/high → root`, `medium/low → user`. The service floor bottoms at guest, which is wrong for
a device that has no unprivileged half.

Root-always was rejected by the owner in favour of keeping severity predictive here: under the
floor a `medium` firmware CVE reads the world-readable half of a gateway while a `critical` reaches
`rules.v4`, which is `read: ['root'], write: ['root']` — so severity still decides whether the NAT
forwarding table is in reach. That gradient is the whole reason not to flatten the axis to root.

#### 84. The tier is a FLOOR — the lowest account at or above it

`TIER_BY_SEVERITY` has always been documented as a floor and implemented as equality:
`accountsIn(hostFs).find((candidate) => candidate.userType === outcome.tier)`. Read as written, the
resolver takes the lowest account **at or above** the granted tier and refuses only when the box
holds nobody that high.

This is a correction, not a new rule. Router-class boxes build `/etc/passwd` from a single root
entry and have no `/home`, so against a severity distribution of 10/50/30/10 and the service floor,
**90% of a router's live service CVEs already refuse silently** — indistinguishable from
`not_vulnerable` — while the comment above that line asserts "Every generated box carries all three
tiers". Nothing in the suite holds the claim down. The floor reading repairs the pre-existing case
and the new one in the same line.

Accepted cost, deliberate and sharper than its slice 8 cousin: **deleting your `user` account
promotes a `user`-tier hole to root.** Hardening by deleting accounts stops working, the way
hardening by deleting a `.so` became a standing cost rather than permanent immunity.

Rejected: giving router-class boxes a second account (breaks the root-only design that the gateway
crack rate and every gateway ssh login rest on); a distinguishable refusal message (leaks which of
two misses happened, which the uniform-miss rule exists to prevent).

#### 85. The lift is uniform — `password_reset` included

`password_reset` is the one effect that uses the account for more than a name: it rewrites *that
account's* hash, and the tier never enters it. So on a root-only box a `low` firmware CVE resets
**root**, and the effect is severity-blind on the whole router class.

Kept uniform rather than carved out. A firmware hole that reaches the credential store rewrites the
only credential the device has, and the power is less of an outlier than it looks: gateway root
already cracks at roughly 37–40% through `hydra`, so this is a second route to a prize the game
hands out already, at one roll in twelve, behind the severity contest.

Recorded explicitly as a consequence of the floor rather than an oversight, so it is not read later
as a bug.

#### 86. One `FIRMWARE_EFFECT_POOL`, holding all eight effect kinds

Per-vendor pools were rejected because they add variance without agency. Decision 12's per-command
library pools earn their split by letting a player **pick their payload by picking the command**;
nobody picks a router's vendor, and the only facts that differ per vendor are a display prefix and
a start tuple. One pool, reached through the same `isFirmwarePackage(key)` predicate decision 81
already needs for the timeline lookup.

Every other pool in the game is shaped by what the thing is FOR — `ftp` reads and writes files, a
scanner leaks what it can see. **Firmware is not for anything in particular; firmware is the
device**, so it is the one pool that can legitimately hold the full effect set.

Twelve entries: `file_read` ×3, `shell_full` ×2, `file_write` ×2, then `shell_limited`,
`script_exec`, `password_reset`, `backdoor_port_open` and `dir_list` ×1 each. That is shells at
25%, file-aimed effects at 50%, and the two strongest-but-narrowest at 8% apiece. `file_read` leads
because a gateway holds the richest reading in the game — `/etc/passwd`'s root hash for `john`,
and at root tier the hashed SNMP RW community. `file_write` is the device-specific prize: rewriting
`rules.v4` is `snmpset`'s power without cracking the community. `dir_list` is weakest for a
concrete reason — **every router-class box has a byte-identical skeleton**, so listing one teaches
nothing a player could not already know.

Rejected: cutting `dir_list` (a carve-out in a pool whose principle is "no functional limit", and
weight 1 already says what it is worth); legacy's behaviour, which lands `shell_limited` on every
firmware CVE — not by design but because `SERVICE_EFFECT_POOLS[vendor]` does not exist and
`pickEffect` falls through to its default.

#### 87. The port's catalog spec writes the trace

A firmware exploit through port 22 writes an `sshd`-tagged line into `auth.log`, carrying the CVE.
`writeTrace` is built entirely from `target.spec.sweepLog` and `target.spec.formatExploit`, and
firmware — owning no port — has neither and will never have a catalog row, which is why decision
32's "required on all seven rows" is untouched by this axis.

The line is true about the **door** and silent about the **hole**, and the CVE is the thread that
joins them: `apt list -u` on the box shows `openssh-server` up to date and `mikrotik-firmware`
vulnerable at that same id. This rhymes with decision 77, where the library stands in for the
service in the attacker's preamble; here the service stands in for the firmware in the defender's
log. The attacker gets the tell from the other side — the scan showed port 22 with an empty CVE
column and the exploit opened anyway.

Accepted cost: a defender who reads only the log patches `sshd` and stays holed. The manifest is
where the answer is, and the game gives them both halves.

Rejected: a synthetic `sweepLog`/`formatExploit` for firmware (a catalog row for a thing with no
port — decision 25's "three entry points" drift in miniature); writing no trace at all (would make
the strongest route the only invisible one).

#### 88. `sysDescr` carries the firmware vendor and version — never a CVE

`walk.ts` parked this decision for this slice by name: "NO VERSION is stated anywhere … stating one
before the game decides where a device version lives would make this block a competing authority
for the fact vulnerabilities are keyed on." Decision 81 is where the game decides, so the block can
render the manifest's answer without becoming an authority — the caller reads it and passes the
display string in on `SnmpIdentity`.

It also kills a lie by construction rather than by editing one string: `PLATFORM.switch.description`
is the hardcoded `'Cisco IOS L3 Switch'`, so every switch walks as Cisco regardless of the vendor
its manifest names.

A version is not a verdict. The player learns **what** a device runs and must still fire to find
out whether it is holed, so decision 82's scan-clean-but-falls survives intact. The recon is earned
rather than free: `snmpwalk` must be installed, needs the read community, and `snmpd` places at 0.6
on routers and 0.9 on switches — roughly 40% of inner gateways cannot be walked at all. The shared
AP gateway is the exception, pinned always-walkable, which is right for the one box everybody
shares.

The router/switch distinction moves entirely to interface naming (`eth0` vs `GigabitEthernet0/1`),
so `walk.ts`'s claim that the description carries it is rewritten rather than left to falsify.

Rejected: rendering a CVE too (makes firmware just another service and throws away the scan-clean
signature); fixing only the Cisco string (leaves the axis invisible from outside, and leaves the
deferral standing with nothing to show for it).

#### 89. When both are live, the higher severity wins; a tie falls to the service

**Decision 82 alone would have shipped the axis dead.** Every router-class box always runs `sshd` —
`hasSsh: true` literally for inner gateways, deep gateways and switches, rate 1 for the AP gateway.
NPC boxes are frozen at `startTuple`, and timeline entry 0 publishes inside the first safe window
of 3–14 days. So from roughly day 14 onward **every NPC router's port 22 carries a live
`openssh-server` CVE permanently**, the service never misses, and a fallback-only firmware never
fires. Port 161 is the same story with `snmp`. Decision 81 closes the other route: a player who
roots a gateway and runs `apt upgrade` patches the service and the firmware in one act.

The contest rule is decision 64's, already implemented and tested on the library axis — the winner
chosen by severity, a tie falling to the fixed order. Here the tie falls to the service. No third
scheme is invented and the grammar of decision 82 is untouched.

Each router gains a **stable identity**: both versions are frozen, so a given gateway always falls
the same way, and "this box goes through its firmware" is durable knowledge about it.

Accepted cost: a router's `ssh` and `snmp` pools fire less often than elsewhere, masked by a more
severe firmware CVE; and `nmap -sV` can under-forecast, since it shows the service's severity while
the firmware may outrank it. Decision 9 made severity predictive — on router-class boxes it becomes
a **floor** on the prize rather than the prize, and always in the player's favour.

Rejected: firmware first with the service as fallback (kills the routers' service pools instead —
the same problem the other way round); separate doors via `--firmware` (revisits decision 82's
grammar to solve a resolution problem).

#### 90. No reboot to flash — firmware upgrades like any other package

`apt upgrade` writes the manifest and the new version is live. A pending-version state is a new
mechanism for one package, and every reader — `liveCve`, `exploitOutcome`, `nmap -sV`,
`apt list -u`, `sysDescr` — would have to learn which of two versions it means. It also drifts
toward the network-brick beat decision 10 kept out.

The reboot tension is worth having later as its own slice covering **all** packages ("a patched
daemon needs a restart"), reusing the `systemctl` and reboot-eviction work already shipped, rather
than as a firmware-only carve-out.

#### Slice 9 — folded in as routine

- **Firmware downgrade is an offensive move, and arrives free.** `apt install <pkg>=<version>` is
  the downgrade path; under decision 81 a player who roots a gateway can push it back onto a holed
  release and leave — a permanent door they installed themselves.
- **Cross-player works through the paths already shipped.** The resolution sits in
  `exploitCreateSession` and reads the materialized `hostFs`, so a stranger's AP gateway resolves
  through `resolvePublicTarget` exactly as a same-LAN one does.
- **`apt list -u` on a rooted router gains its firmware row from the manifest** it already
  iterates, in the raw `<pkg> <version>` shape every other package uses — `upgradableRow` does
  not call `displayVersion`, so nothing there needs the prefix. `displayVersion` needs the
  firmware table for decision 88's `sysDescr`, which is the only place the pretty form shows.
- **`msfconsole --local` on a router is untouched.** Slice 8 put routers in scope for the library
  axis with no carve-out; firmware and libraries do not interact.
- **`nmap -sV` still never shows firmware** (decision 27) — a router's image answers to no port,
  and decision 88 gives the remote read a different tool and a real cost.
- A workstation and an NPC host still carry no firmware entry at all.

#### Slice 9 — recorded claims the code contradicts

Four corrections this slice must make, in decision 80's style — each a comment or test rationale
that states as fact something the generators already deny:

1. `exploitCreateSession.ts` — "Every generated box carries all three tiers, so a miss is reachable
   only once a rooted player has edited the file." False for every router-class box, which builds
   `/etc/passwd` from one root entry.
2. `packageTimeline.ts` — the `no-timeline` doc names "a router's firmware" as its example. Decision
   81 gives firmware a timeline.
3. `apt.test.ts` and `packageTimeline.test.ts` — "a router's owner does not upgrade its firmware
   through apt" and "there is no shelf to take a release off" both reverse, and both tests should
   assert against the six vendor keys rather than the retired `'firmware'` string.
4. `walk.ts` — the per-kind description no longer carries the router/switch distinction; interface
   naming does.


### Forced rather than chosen (planning should not re-litigate)

- **`/var/lib/dpkg/status` is THE version source.** Settled by the catalog's own shipped comment,
  not by this grill. Every consumer — `nmap -sV`, `msfconsole`, `apt`, the server's authorization —
  reads that file, base FS plus journal replay like everything else.
- **`msfconsole` resolves targets through `resolvePublicTarget` / `resolveInnerGatewayTarget`** —
  the same modules `ssh` and `hydra` authenticate through. D2.4 made "hydra must never disagree with
  ssh" structural; a third tool resolving its own targets would undo that.
- **The server recomputes the CVE independently through one shared `core/` module.** Nothing the
  client sends about version, CVE, severity, effect or tier is trusted. The client calls the same
  pure function to render.
- **`ldd` and `msfconsole` attach to binaries v2 already stamps.** No packaging work: the binaries
  exist, the gate is filesystem-driven, and the commands are what is missing.
- **A stopped service is not exploitable.** No pidfile means no open port means no target, through
  the reachability chain every other door already shares.

### Folded in as routine (recorded so they are not re-decided)

- `nmap -sV` on your own box or `localhost` reports your own CVEs — a second defender view beside
  `apt list -u`, at no extra cost.
- Deep-chain hosts and inner gateways are exploitable through the resolvers slice 6 wires, not
  through a parallel path.
- Legacy's `msfconsole` phase output (`[*] Targeting …`, `[*] Vulnerability: …`, `[*] Sending
  exploit payload…`, `[+] Exploit successful!`) ports as-is, jitter and Ctrl-C included.
- A `--local` exploit may run on your own box; skipping `su` on a machine you already own costs
  nobody anything.
- `apt list -u` covers services, libraries and firmware alike — one manifest, one status view.

### Slice spine (each vertical + observable)

Ordered **loop-first**: the attack → patch → inert cycle is provable at slice 4, so the treadmill
can be played and retuned before the effect set widens. Capability-first ordering (the whole
attacking surface, then a defence) was rejected — it ships the world lopsided and leaves the
central mechanic unplayable until slice 6.

| # | Slice | Observable |
|---|---|---|
| **1** ✅ | **A version is visible** — **SHIPPED v0.210.0-v0.211.0 (#491, #494)** | `/var/lib/dpkg/status` generated on every box from the daemon binaries it CARRIES (not what it runs — see the close-out) + eight libraries (+ firmware on routers); `nmap -sV` gains a VERSION column; the file reads on your own box and on one you hold. No CVEs yet |
| **2** ✅ | **A CVE is visible** — **SHIPPED v0.212.0 (#496)** | `WORLD_EPOCH` + each package's FIRST publication + the severity roll (the forward walk moved to slice 4, where `apt upgrade` is what first reaches past it); `nmap -sV` prints a CVE id and severity for a live one. The world is clean for three days and then starts moving. Nothing is exploitable yet — the player can only watch it happen |
| **3** ✅ | **A door opens** — **SHIPPED v0.213.0 (#497)** | `msfconsole <host> <port>` against a generated NPC host on your own LAN; `shell_full` and `shell_limited`; the exploit session row; the `formatExploit` catalog column with BOTH outcomes traced. A stale NPC service hands over a shell with no credential, and the box records it |
| **4** ✅ | **The defender patches** — **SHIPPED v0.214.0-v0.215.0 (#498, #499)** | `apt upgrade [package]`, `apt list -u` with the ETA status, install through the SAME resolver, a manifest row written on install, and **the forward timeline walk + the nearest-ancestor rule** deferred here from slice 2. **The loop closed**: A upgrades, B's working exploit now refuses, the session B already holds survives it, and inside the delay window A is told plainly that no fix exists |
| **5** ✅ | **Six more effects** — **SHIPPED v0.218.0-v0.223.0 (#502-#507)** | `file_read`, `dir_list`, `file_write`, `password_reset`, `backdoor_port_open`, `script_exec` — decision 23's third-argument grammar, the CVE-authorized write and exec paths, and D5's backdoor chain forwarding reused whole. Six independent PRs to trunk, each peeling one effect off decision 31's collapse; `msfconsole` became scriptable on the way |
| **6** ✅ | **The exploit crosses networks** — **SHIPPED v0.224.0-v0.230.0 (#508-#514)** | Public IPs, NAT forwards, inner gateways and the deep chain, through the resolvers `ssh` and `hydra` already share. The first real route to rooting another player. Seven independent PRs to trunk, one vantage each; decision 34's three cross-player questions answered once in a shared rule, and decision 39's pinning shipped with the trace that makes it visible |
| **7** ✅ | **Reboot evicts** — **SHIPPED v0.231.0-v0.234.0 (#515-#518)**, decisions 52–62 and four independent PRs to trunk; as-built in ["Phase 3 slice 7"](#phase-3-slice-7--reboot-evicts--shipped-v02310v02340-515518) | `reboot` ends every session row on that machine server-side, not just the rebooter's stack. The defender gets an answer; the intruder who deleted `/boot/vmlinuz` gets the last laugh. A server-minted **boot id** on the box is how a live shell finds out, read through the re-pull `executeLine` already does per line; a failed eviction fails loudly, because silence hands the defender a convincing animation and a live intruder |
| **8** | **Libraries fall** — ✅ **SHIPPED v0.235.0–v0.243.0 (#519–#527)**, closed out 2026-09-21; decisions 63–80, nine independent PRs (decision 72, PR4 split by 75 and PR5 split at delivery); as-built in `### Phase 3 slice 8` near the end of this file, plan file deleted | ~~Library timelines~~ (already shipped with slice 2); `ldd`; explicit-path execution of a carried binary; `apt list -u` naming the CVE and severity; `msfconsole --local <command>`, client-local on own/NPC boxes and server-side on a player's workstation; the realistic trace (decision 69, superseding 17's syslog line); the extended dependency map with its new effect pools; `metadata.libraryLinks` deleted. Guest becomes root without the root password |
| **9** | **Firmware falls** — ✅ **SHIPPED v0.244.0–v0.247.0 (#528, #529, #531, #532)**, closed out 2026-09-21, **closing V4 and the V-series**; decisions 81–90, four independent PRs to trunk; as-built in `### Phase 3 slice 9` near the end of this file, plan file deleted | The third axis on routers, switches and the shared AP gateway: firmware as a package with its own timeline; the exploit tier as a floor so a root-only router hands over the shell the CVE earned; the service-vs-firmware severity contest (higher wins, tie to the service) so a gateway that scans clean still falls through the image it runs; `snmpwalk`'s `sysDescr` naming that firmware. A fully patched gateway can still be taken |

Slices 1 and 2 could merge; they are split because a VERSION column is independently useful and
independently wrong-able. 3 needs 2. 4 needs 3 and is the first slice worth playtesting. 5, 6 and 7
each need 3. 8 needs 2 (the walker) and 3 (the effect dispatch), not 5. 9 needs 8's second-axis
shape.

### Deliberately NOT built (recorded so nobody re-opens them)

Legacy's hand-authored day-0 CVE pool and the two-layer lookup (decision 2); a seeded per-box patch
LAG making NPC versions a function of game time (decision 4 — a different model, not a fix);
`unattended-upgrades` asymmetry between libraries and services (decisions 5 and 6); an effect hint
or description in `nmap -sV` (decision 13); version-bearing banners and `nc` fingerprinting
(decision 14); legacy's `AttackPattern` union and its formatter dispatch (decision 15);
patch-triggered session eviction (decision 19); naming the reset credential in the defender's trace
(decision 21); library meta-packages, `apt remove <library>` and forward version pinning
(decision 22); a full re-derivation of the dependency map against real Debian link sets
(decision 12); `libc` as a modelled library, whose blast radius would collapse play to *am I in a
libc window?*.

### Open for planning (named, deliberately not decided)

- ~~**The exact `WORLD_EPOCH` date**~~ — **RESOLVED 2026-09-10 at slice 2** (decision 24). It is
  `2026-09-01`, an openly-labelled DEVELOPMENT anchor guarded by a dated tripwire test that fails
  once it is ~90 days stale. Freely movable until launch — nothing is persisted and every box is
  frozen at its starting version — and irreversible after, because every CVE id, publication date
  and severity derives from it. **Shipping the development value would begin the world months deep
  in CVEs**; re-stamping it is the tripwire's whole job.
- ~~**The effect pools for the newly-mapped commands**~~ (decision 12) — **RESOLVED 2026-09-20 at
  slice 8's PR6 planning** (decisions 78, 79, 80). All nineteen links and all nineteen pools are
  fixed; `libcrypt` becomes the crackers' group, the toolchain's ceiling is `shell_limited`, and
  every mapped tool is exploitable — so "mapped but poolless" no longer exists, because a miss
  denying a hole `ldd` and `apt list -u` both show would be the lie PR4a rejected. `node` rolls
  `script_exec` after all: the prize is the tier, not the ability to run a script. The same pass
  found decision 68's "an NPC's local surface stays exactly legacy's seventeen" to be false and
  corrected it (decision 80).
- ~~**The firmware vendor set and its placement**~~ — **RESOLVED 2026-09-09 at slice 1a.** The
  six legacy vendors port as-is (cisco, mikrotik, ddwrt, openwrt, pfsense, ubiquiti), and all
  three device kinds draw from the one pool on their own seeded stream, with no per-kind
  carve-out — the manifest is one flat namespace, so a router, a switch and an AP gateway are
  indistinguishable in it by construction. One package name, `firmware`, per decision 10;
  revisit `<vendor>-firmware` only if slice 9 finds the vendor unreadable from the manifest
  alone. **That trigger fired: RESOLVED again 2026-09-21 at slice 9's grill (decision 81)** —
  the manifest carries a bare tuple with the vendor prefix stripped, so the package becomes
  `<vendor>-firmware` and the timeline table splits from the apt catalog. The kind stays
  indistinguishable, which is the property this item actually defended.
- ~~**Where the CVE derivation module lives and what it is called**~~ — **RESOLVED 2026-09-10 at
  slice 2** (decision 25). `src/core/cve/worldClock.ts` and `src/core/cve/liveCve.ts`, beside the
  other shared pure resolvers the client renders from and the server authorizes with. **One
  axis-blind entry point** — `liveCve(key, version, gameDay)` — serves all three axes, so slices 8
  and 9 attach per-axis INTERPRETATION rather than growing a second derivation.
- ~~**Whether `formatExploit` is a required or optional catalog column**~~ — **RESOLVED 2026-09-10
  at slice 3 planning** (decision 32). REQUIRED, on all seven rows at once, so a service cannot be
  added without deciding where its exploits show up. It carries one follow-up of its own: the http
  row's trace lands in `auth.log` rather than decision 15's example `access.log`, because that is
  where its credential sweeps already land — moving the web door's evidence is a correction of its
  own and stays open.

## X2 — resolved scope & decisions (grilling, 2026-09-26)

Grilled 2026-09-26, un-deferred ahead of the ship gate at the owner's request: `findit.io`, a
search engine over the public web, so a player finds a network they were never told about.

### Grounding that reshaped the scope before any decision

- **The public web is EMPTY today.** Every seeded gateway runs only `sshd` and its `rules.v4`
  forwards nothing (`routerFs.ts`), so no network publishes a website. Generated webservers — the
  16% `webserver` role plus the 0.3 incidental `http` placement — are reachable on their own LAN
  only. The one public page that can exist is a player's own nginx behind a forward they wrote on
  their own gateway, and only while they stay on that wifi (`resolveForwardTarget`).
- **There is no world DNS.** `resolveName.ts` says so in its module doc; `findit.io` passes through
  unchanged and fails as an unknown target.
- **There are no dynamic HTTP handlers.** Every response is a static file read; `?q=x` becomes part
  of the path and 404s. Legacy's `searchEngine.ts` has no v2 counterpart.
- **A public IP exists only once somebody has joined the ESSID** (`registerNetwork` →
  `network_public_ips`), so an un-joined network has no address to index.
- **Generated sites carry a `<title>` and 80% carry a `robots.txt`**; none carries a
  `<meta name="description">`.
- **No themed / internet-only network kind exists in v2**; every public IP is bound to an ESSID.

### Locked decisions

#### 91. The public web is the existing ESSID networks publishing their own sites

No second network kind. A subset of the 50 catalog networks gets a seeded gateway forward (public
`:80` → its own webserver), so "the university's website" is the university network's own
webserver, now reachable from the internet. Airports, police, libraries and shops arrive as new
`ESSID_CATALOG` entries, whose `category`/`place` already say what a network is. Rejected: legacy's
internet-only `world_networks` kind — a second generator, storage and address allocator for what
the catalog already expresses — which stays open for later if this proves thin. It follows that a
publishing network needs its public IP at world creation rather than first join.

#### 92. The category decides who publishes — no dice

Institutional categories — university, corporate, cafe, public, and the airport/police/library/shop
entries still to come — ALWAYS publish; residential, iot and hacker NEVER do. A publishing network is
GUARANTEED a `webserver` box, and its gateway forwards public `:80` to it. "The police have a
website" is true every time, and every publishing network is in the index, so the index is
predictable to build and to test. Residential and iot stay dark because nobody's home router serves a
site; hacker stays dark because a den listing itself on a search engine is out of character, and
what it offers is better found by other means. Rejected: a seeded per-category chance, and "whoever
happened to roll a webserver" (both let the dice decide what an institution is).

#### 93. A small world DNS: every publishing network has a domain that resolves anywhere

Each publishing network gets a domain derived from its catalog entry (`ridgemont.edu`,
`harbor-cafe.com`, `metro-police.gov`) that resolves, from any network, to that network's public IP;
`findit.io` is one more entry. Results show the domain, and every command accepts it through X1's one
`addressForTarget` step, with a world-name step ahead of the LAN step. This is the "public/world
domains" X1 explicitly handed to X2. Rejected: a lone special-cased `findit.io` with results as bare
IPs (a search engine of addresses is not the web), and domains that must be `dig`ged by hand first (a
chore with no play in it). How a world name reaches its address — a server round trip, or an address
the client can derive — is decided separately (decision 94).

#### 94. A publisher's address is DERIVED from its ESSID, never allocated

A publishing network's public IP is computed from its ESSID under a first octet RESERVED for
publishers and absent from `publicFirstOctets` (e.g. `193`), so the random allocator can never draw
it; a test over the fixed catalog proves publishers never collide with one another. The world DNS is
then a pure client-side table (domain → derived IP), the same no-round-trip shape as X1's LAN names,
and the server's public-IP lookup falls back to the same derivation, so a publisher is reachable
before anybody has joined it — which is how decision 91's "IP at world creation" lands with no
seeding step. Rejected: server-side name resolution (a round trip per lookup, the design X1 already
refused) and seeding `network_public_ips` at deploy time (stored state for what is derivable).

#### 95. `findit.io` is a server-side handler on the existing public-fetch path

`findit.io` resolves through the world DNS to a reserved derived address, and `resolveHttpFetch`
answers that address from a pure `core/` search function (query + index → ranked results) instead of
a file read. The index is computed from the publishers' own generated site files — their `<title>`,
their `robots.txt` — so it is a VIEW over what they serve, not a second authority; player pages join
the same index because the server already holds their files. This is v2's FIRST dynamic HTTP handler,
and the rule it sets is: an address with a registered handler answers from a pure function, and
everything else reads a file. Rejected: answering on the client (NPC sites are derivable but player
pages live in the server's `patches` journal, so it would need a second index later) and a static
directory page with no query (a directory, not a search engine).

#### 96. findit reads the homepage's title, meta description and body — nothing else

Generated homepages gain a `<meta name="description">` derived from the catalog place and category.
The search reads ONLY `/index.html` — no crawl of the rest of the site — and scores title >
description > visible body text; a result shows title, domain and description, falling back to the
body's first line when a page has none. Body text is what lets "admissions" find the university and
"parking" find the airport. Everything read is on the page, so a player shapes their own listing by
editing their own `index.html` — SEO as play. Rejected: legacy's authored `keywords` (its only honest
source would be `<meta name="keywords">`, dead on the real web for decades) and title-only matching.

#### 97. Player pages are crawled, not submitted — opt out with `robots.txt`

Every page served on a public `:80` is listed automatically, player or NPC, unless its `robots.txt`
says `Disallow: /`. Listing is decided AT QUERY TIME through the same resolution a `curl` makes, so a
player who leaves the wifi or stops nginx simply drops out, and no index is stored to go stale. Being
public is already deliberate — a fresh gateway forwards nothing, so a page reaches `:80` only after
its owner writes a forward — which is what makes automatic listing fair rather than an ambush. A
generated publisher never emits `Disallow: /` (decision 92's every-publisher-is-listed would
otherwise break at random). Rejected: opt-in by submission (the owner preferred the realistic
crawler; it also needs a submissions table) and no player listing in X2.

#### 98. A player's result shows its bare public IP

A player's network has a random public IP and no catalog entry, so its result reads `<title> —
<public IP> — <description>`. The tell is deliberate play: an IP-only result is a person's box (or a
gateway somebody has repointed), and learning to read for it makes hunting on findit a skill.
Rejected: player domains (a server-only name needs a round trip or a synced table, against decision
94, plus claiming rules) and title-only results (`curl` cannot click through).

#### 99. The response is legacy's HTML: a form that documents itself, ten results, everything escaped

`/` serves a page whose search form (`action="/" method="GET"`, `name="q"`) IS the documentation —
no tutorial copy; a player reading the markup infers `?q=`. `/?q=<term>` re-renders the form above an
`<ol>` of at most ten ranked results (title linked to `http://<domain or IP>/`, the domain on its own
line, the description); none gives `No matches for "<term>"`. Every interpolated string is
HTML-escaped, which decision 97 makes load-bearing: other players now author the titles. It serves
`curl` raw and `lynx` rendered through the one fetch path. No pagination while the index is ~30
publishers. Rejected: plain-text lines (not the web, nothing for `lynx`) and content negotiation to
JSON (no consumer).

#### 100. `findit.io` is a real, attackable box — refines 95

The whole world is attackable, findit included. It is a machine with a filesystem at its derived
address, not an untouchable service. `/` serves its own `/var/www/html/index.html`, so a rooted findit
can be defaced; `?q=` is still answered by decision 95's handler, but ONLY while the box is serving
`http` — a bricked findit, or one whose nginx was stopped, takes search down with it, exactly as it
would a file. What stays true from 95: the index is a view over the publishers' pages and never a file
on findit, so rooting it defaces the front door without poisoning anybody's results. Rejected:
findit as infrastructure with no box behind it (the owner: everything in this world can be hacked).

#### 101. An operator script restores it — nothing in the world heals it

`scripts/restoreFindit.ts` deletes findit's `patches` rows, returning the box to its generated state —
brick included, because a brick IS the `/boot/vmlinuz` tombstone in that journal and has no separate
flag. The operator runs it when they choose to. Rejected: a nightly in-world restore (rows older than
the last restore time ignored on read) and the pair — the owner judged the script alone enough.

#### 102. findit is an ordinary hardened box; a live CVE is the way in, and its log is the prize

A one-machine network whose box OWNS its public address (no NAT behind it), running `sshd` + `nginx`
with a root password from the UNCRACKABLE pool, and a `dpkg/status` whose versions ride the existing
CVE timeline — so it falls when a window opens, on the world's schedule, with no bespoke weakness:
hydra fails, `nmap -sV` + `apt list -u` find the door. The prize needs no design: every public hit
already lands in the target's `/var/log/access.log` under a server-derived source IP, so a rooted
findit reads WHO searched for WHAT from WHERE — intel on other players. (Planning confirms the logged
line carries the query string.) Decision 101's script wipes that log with everything else. Rejected:
a deliberately soft findit (a crackable password or planted hole) and versions pinned so a window
opens on a known day.

#### 103. One website per INSTITUTION: a catalog entry may carry the `site` it hosts — refines 92

The institutional categories hold 36 networks, several of them PARTS of one institution (the
university's five — Dorm 7, the CS lab, the grad office, the campus, the library's second floor —
none of whose `place` names the school). An `ESSID_CATALOG` entry gains an optional
`site: { domain, name }` naming the institution whose website THAT network hosts: the university's
sits on `CAMPUS-GUEST-OPEN` alone, and its other four are ordinary networks of the same school.
Decision 92 is refined, not reversed: the category still decides which KINDS publish, a test holds
that only institutional-category entries carry a `site`, and each institution is hosted exactly once
— which keeps 93/94's one-domain-one-public-IP exact. Corporates and cafés are one network per
institution, so each of theirs carries one. The same move as `place`: the catalog states what a
network is rather than having it guessed. Rejected: a site per network (five university websites) and
one institution's site spread across several networks' webservers as sub-pages.

#### 104. New institutions are X2's LAST slices — one new category per slice: `government`, then `retail`

A category is not a label: ten content pools are typed `Record<NetworkCategory, …>` (MOTDs, home
notes, mail threads, phone downloads, share folders, front pages, site pages, people roles, database
archetypes, persona places), so a new category must fill all ten and the compiler refuses a
half-written one. findit is complete without new categories — the existing catalog already hosts ~32
institutional sites (20 corporate, 6 cafés, 1 university, 5 public places) — so X2's first slices ship
on it, and its closing slices add `government` (police, city hall, courts) and then `retail` (shops),
each a whole, playable category. The airport stays a `public` entry whose lounge network hosts the
airport's site (103). Rejected: police and shops squeezed into `public`/`corporate` (their content
would read as a park's or an office's) and new categories gating findit's first slice.

#### 105. Publishing IS exposure — wifi and the internet become two routes into one network

Decision 92's forward makes every publisher's webserver reachable from anywhere: `nmap <domain>`
shows the gateway's `22` plus the forwarded `80`, `-sV` shows the webserver's version, a live CVE on it
is exploitable across networks through slice 6's existing routing, and a shell there lands INSIDE the
LAN without the wifi ever being cracked. This is the point, and it is X2's acceptance line as the epic
first wrote it — find it, scan it, real ports, a way in. No new mechanism. Rejected: a forwarded
webserver that serves but cannot be exploited from outside (a special case, and against "the whole
world is attackable").

### Deliberately NOT built (recorded so nobody re-opens them)

- **Any in-world pointer to findit.io.** How a player learns it exists is the job of the tutorial the
  owner is introducing later, which will name it; X2 plants no hint in notes, mail or MOTDs.
- **Missions and products** (legacy's `techparts.io`). Both stay post-ship; under this design a
  mission board or a shop is simply one more publisher findit indexes, so nothing is reserved for them.
- **Internet-only `world_networks`** (91), **player domains** (98), **pagination** (99), **an in-world
  restore** (101) and **a crawl beyond `/index.html`** (96).

### Slice spine (each vertical + observable; independent PRs to trunk, no stack)

1. **An institution has a website you reach by name** — catalog `site` (103), derived publisher
   addresses under the reserved octet (94), a guaranteed webserver behind a gateway `:80` forward (92),
   the world-name step in `addressForTarget` (93). *Acceptance:* from any network,
   `curl http://<university domain>/` returns its homepage and `nmap <domain>` shows `22` + `80` —
   before anybody has ever joined that wifi.
2. **findit.io answers a search** — the findit box at its derived address (100, 102), the pure search
   function behind the `resolveHttpFetch` handler (95), `<meta name="description">` on generated
   homepages (96), the escaped HTML response (99). *Acceptance:* `curl "http://findit.io/?q=university"`
   ranks the university first; `lynx findit.io` renders the form.
   *Carried from slice 1:* generated homepages are titled with the network's `place` ("The campus"),
   not the site `name` ("Ridgemont University"); findit ranks titles, so this slice titles a
   publisher's homepage with its site name.
3. **A player's page is found** — query-time listing of every player's public `:80` forward that is
   actually serving, `robots.txt` `Disallow: /` as the opt-out, IP-only results (97, 98).
   *Acceptance:* A publishes nginx and B finds A's title and public IP; A adds `Disallow: /` and drops out.
4. **findit falls and comes back** — the query string in findit's `access.log` (102) and
   `scripts/restoreFindit.ts` (101). *Acceptance:* a rooted findit reads who searched what, a defaced
   `/` shows for everyone, and the script restores it.
5. **The `government` category** — police, city hall, courts; all ten per-category pools (104).
6. **The `retail` category** — shops (104).

### Open for planning (named, deliberately not decided)

- **The reserved first octet** (94) and each institution's **domain and TLD** (103).
- ~~**The cost of the query-time player listing** (97): it walks every player public IP's gateway forward
  and occupant per search — fine at pre-launch scale, but planning sizes it.~~ — **ANSWERED by slice
  3 (108):** one read of the stored addresses, their gateways inside the one journal batch, and a full
  resolution only for a gateway answering `:80`; measured at 1398 ms per search against 1339 ms per
  single fetch.
- ~~**Whether findit's `access.log` line already carries the query string** (102), or the log writer
  needs it added.~~ — **ANSWERED by slice 2a:** a search is a fetch, so the log already records the
  raw path, `/?q=<term>`, under the searcher's server-held address; slice 4 only proves it readable.
- ~~**How `lynx` follows a result link** to a world domain.~~ — **ANSWERED by slice 2:** results
  link absolute `http://<domain>/`, which `lynx` resolves through the world names (1b) like any
  typed address; 2b adds submitting the search form itself.

### As-built: X2 slice 1 — an institution has a website you reach by name

Shipped v0.265.0–v0.268.0 as four independent PRs against trunk (#551–#554), 2026-09-26. From any
network `curl ridgemont.edu` reads Ridgemont University's homepage, `nmap ridgemont.edu` shows the
gateway's `22` and the forwarded `80`, and a live CVE on the webserver behind that forward opens a
session inside the university's LAN — before anybody has joined its wifi.

#### Decided at planning (owner-confirmed as a set, 2026-09-26)

1. **Reserved octet `193`.** A publisher's IP is `193.x.y.z` from `createPrng('publisher-ip-<essid>')`;
   `isPublicIp` accepts `193`, `generatePublicIp` never draws it. A catalog-wide test proves the 32
   addresses distinct.
2. **Joining stores the derived address**, and the server's IP → network lookup falls back to the
   derivation on a miss — ONE pure `core/` function wrapped around each of the three `api/` lookups
   (module scope inside each endpoint; no new `api/` file).
3. **The webserver is guaranteed by override, never by a draw.** If no sibling is a webserver, the
   lowest-addressed ordinary sibling becomes one; the publisher's webserver always runs http; the
   gateway seeds `forward 80 to <ip>:<httpPort>` with the port it actually rolled.
4. **All three forward resolvers fall back to the generated LAN box** at the forwarded address when no
   occupant matches (fetch and scan in 1a, public target in 1c).
5. **World names resolve inside `resolveName`**, so `nslookup` sees them; `nmap` and `ssh` resolve
   before the public check; `lynx` goes through `addressForTarget`. `gobuster`/`hydra` stay out.
6. **Names** — one fictional city, Ridgemont:

   | ESSID | domain | name |
   |---|---|---|
   | 20 corporates | `acme.com`, `initech.com`, `globex.com`, `waystar.com`, `dundermifflin.com`, `hooli.com`, `umbrellacorp.com`, `starkindustries.com`, `cyberdyne.com`, `oscorp.com`, `weyland-yutani.com`, `tyrellcorp.com`, `aperturescience.com`, `shinra.com`, `abstergo.com`, `wonkalabs.com`, `ocp.com`, `piedpiper.com`, `vandelayindustries.com`, `nakatomi.com` (catalog order) | their `place` |
   | 6 cafés | `brewandcode.com`, `beanthere.com`, `midnightdiner.com`, `nightowlcafe.com`, `groundzerocoffee.com`, `espressoexpress.com` | their `place` |
   | `CAMPUS-GUEST-OPEN` | `ridgemont.edu` | Ridgemont University |
   | `LIBRARY-PATRON` | `ridgemontlibrary.org` | Ridgemont Public Library |
   | `CITY-PARK-WIFI` | `ridgemontparks.gov` | Ridgemont Parks Department |
   | `METRO-COMMUTER` | `ridgemontmetro.gov` | Ridgemont Metro |
   | `AIRPORT-LOUNGE-VIP` | `flyridgemont.com` | Ridgemont International Airport |
   | `TRAIN-STATION-FREE` | `ridgemontcentral.org` | Ridgemont Central Station |

7. **Independent PRs**, each closed by a `v2-e2e` browser run; 1a and 1c carry an `api/` change and
   so a wire-check. Planned as three; a fourth (1d) was added after 1b with the owner's agreement.

#### 1a — a publisher's website answers at its public IP (v0.265.0, #551)

- **Decided mid-slice — the AP log key.** A fetch of a publisher nobody had joined had no writer key
  to log under (shared logs keyed to the lowest lease holder). Owner chose a stable per-network key,
  `ap:<essid>`, for EVERY AP's ownerless boxes; lease reads that only picked the key were removed,
  and a player's write to a generated database now lands in the network's row too.
  `docs/cross-player-architecture.md` updated.
- New modules: `generation/publisher.ts` (`publisherSite`, `publisherIp`, `publisherAt`),
  `generation/siteServer.ts`, `network/generatedLanBox.ts` (the shared fetch/scan fallback).
- Gates: suite 6120 green; wire-checks `testPublisherWeb` 6/6 plus 37 others live; browser run from
  `BOFH-KEEPOUT` — `curl http://193.46.209.111/` returned the campus homepage, `nmap` showed
  22/161/80, no stored address, hit logged under `ap:CAMPUS-GUEST-OPEN`. Mutation in four scoped
  batches: all own-line mutants killed or hand-verified (module-load statics the vitest runner
  cannot reload), `isPublicIp` gained direct tests, two redundant conditions removed.
- **Carried to slice 2:** the generated homepage is titled with the network's `place` ("The
  campus"), not the site `name` ("Ridgemont University"); findit ranks titles, so slice 2's homepage
  work should title a publisher's page with its site name.

#### 1b — a domain resolves, anywhere, for every command that takes an address (v0.266.0, #552)

- **World names first.** `siteAddress(domain)` in `generation/publisher.ts` (a catalog-derived
  domain → `193.` table) is consulted first in `resolveName`, case-folded, with no occupant round
  trip; a player who names their box `acme.com` cannot take Acme's traffic.
- **`nmap` and `ssh` resolve before `isPublicIp`.** `ssh` keeps one occupant read via a lazily
  cached promise (a test pins the single read); a domain or an address costs none.
- **`lynx` resolves, and so does a followed link** (`followLink` in `ui/state.ts`) — not in the plan,
  but a page opened by domain carries the domain in every relative link. The address bar keeps the
  typed name.
- **Resolved by 1d (v0.268.0):** `lynx`/`curl` rejected a scheme-less URL, so the AC's bare
  `lynx ridgemont.edu` is built and tested as `lynx http://ridgemont.edu/`. Accepting bare hosts
  (as real `lynx` and `curl` do) is a separate `parseHttpUrl` change.
- **Gates:** 6134 unit tests green, typecheck and lint clean. Stryker (scoped, 95 mutants): 84
  killed; survivors are `publisher.ts` module-load statics (hand-verified: the mutant throws at
  import) and one pre-existing X1 regex; 3 NoCoverage on `followLink`'s pre-existing offline alert.
- **Browser (v0.266.0, from `APT-3B-WIFI`):** `nslookup` → `193.46.209.111`; `nmap` → 22/161/80;
  `curl` → the campus homepage; `lynx` → homepage, then About followed by link; `ssh
  admin@ridgemont.edu` → password prompt, refused server-side.

#### 1c — the forward is a way in (v0.267.0, #553)

- **The fallback lives in `resolvePublicTarget`'s forward resolver**, reusing 1a's
  `generatedLanBox` (which now also hands back the host, for its hostname and kind). No occupant at
  the forwarded address → the generated box, boot-gated, journal-replayed, logging under
  `ap:<essid>`. So every door on that resolver gains it at once: login, `hydra`, the data doors,
  `snmpset` and `msfconsole`. No consolidation with the fetch and scan resolvers: the three
  target shapes differ, and the shared knowledge is already `generatedLanBox`.
- **Filtered or stopped reads as dark**, like an occupant's box: the forward's internal port
  must be open to the network on the generated box too (`listensOn`, now shared by both
  branches), else `host_unreachable`.
- **The generated box keeps the segment it fronts from inside** (`frontedSegment` with its own
  kind), so an inner router reached through a player's forward takes `snmpset` NAT writes into its
  hidden layer and refuses LAN ones. This was not in the plan; a mutation survivor showed it
  untested, and two `snmpSetCrossPlayer` tests now pin it.
- **Found in play:** on today's game day (76) every publisher's webserver ships `nginx 1.26.0`,
  whose live hole is `script_exec` (high, user) and not a shell. So the shell criterion is proven
  in unit tests and in the wire-check by walking the manifest onto `1.27.0` (`shell_full`, guest).
  The browser proves the same path with the stock hole.
- **Gates:** 6142 unit tests green, typecheck and lint clean. Stryker (scoped,
  `resolvePublicTarget.ts` + `generatedLanBox.ts`): `generatedLanBox` 19/19; `resolvePublicTarget`
  141 killed, 1 survived (pre-existing `kind: 'router'` on the AP gateway: equivalent, since
  `frontedSegment` ignores kind for the AP), 2 NoCoverage (pre-existing `?? []`).
- **Wire-check:** new `scripts/testExploitPublisherSite.ts`, 6/6. The session lands on `www-59`,
  the trace is in its `auth.log` under `ap:CAMPUS-GUEST-OPEN` naming the server-held attacker
  address, and a clean release refuses `not_vulnerable`. Re-run green:
  `testExploitApGateway` 15/15, `testPublisherWeb` 6/6, `testExploitCrossPlayer` 14/14,
  `testHydraCrossPlayer` 16/16, `testMysqlCrossPlayer` 8/8, `testRedisCrossPlayer` 13/13,
  `testSnmpCrossPlayer` 15/15, `testCrossPlayerRouter` 8/8.
- **Browser (v0.267.0, from `APT-3B-WIFI`):** `nmap -sV ridgemont.edu` → `80/tcp http
  nginx/1.26.0 CVE-2026-0269486 high`; `msfconsole ridgemont.edu 80 pwn.js` → `Script injected
  on 193.46.209.111 as user`. The script's `/tmp/through-the-forward.txt` landed on
  `www-59-650d566f`, and its `auth.log` line (under `ap:CAMPUS-GUEST-OPEN`) names the
  attacker's home address.

#### 1d — a bare address is a URL (v0.268.0, #554)

Added after 1b: real `curl` defaults a scheme-less URL to HTTP and real `lynx` assumes `http://`, so
the game's tools do too.

- **A new entry point, not a change to `parseHttpUrl`.** `parseTypedUrl` in `network/http.ts` reads a
  string with no `://` as `http://<input>` and hands back the parsed URL plus the spelling to show.
  `parseHttpUrl` stays strict because `resolveHref` needs it that way: a href with no scheme is
  RELATIVE, and `about.html` must never become a host. `gobuster` still takes only full URLs.
- **`lynx`'s address bar spells shorthand out in full** (`http://ridgemont.edu/`, the web's own
  port left unwritten). That is required, not cosmetic: the address bar is the base every link
  resolves against, so a bare base would break following links. A URL typed with its scheme
  keeps its typed spelling.
- **Manuals** for both commands name the shorthand and carry a bare-domain example. The `v2-e2e`
  runbook row that said "lynx wants a URL" is corrected.
- **Gates:** 6146 unit tests green, typecheck and lint clean. Wire-check `N/A`: client-only, no
  `api/` change. Stryker on `http.ts`: 111 killed, 1 survived — the pre-existing
  `host === undefined` guard, equivalent since the pattern always captures a host. The two
  pre-existing `^`/`$` anchor survivors were killed by new `parseHttpUrl` cases; they matter more
  now that typed input reaches the parser.
- **Browser (v0.268.0, from `UPSTAIRS-NEIGHBOR`):** `curl ridgemont.edu` → the campus homepage;
  `lynx ridgemont.edu` → address bar `http://ridgemont.edu/`, then link 3 (About) followed to
  `http://ridgemont.edu/about.html`.

#### Risks carried forward

- **Re-rolled content on publisher LANs.** The webserver override changes one sibling's role on
  publishers that had none; that box's content changes. Allowed pre-launch; the non-publisher
  snapshot test guards everyone else.
- **Build budget.** A publisher's gateway now forwards to a box the server must materialize per
  request; measure the fetch path against the existing same-LAN scan cost.
- **A publisher whose rolled webserver port is `8080`/`8000`.** The forward maps public `80` to it;
  `nmap` of the gateway must still say `80`.

### As-built: X2 slice 2 — findit.io answers a search

Shipped v0.269.0–v0.270.0 as two independent PRs against trunk (#555–#556), 2026-09-26. From any
network `curl "findit.io/?q=university"` ranks Ridgemont University first, linking
`http://ridgemont.edu/`; in `lynx findit.io` a player selects the search field, types a term, presses
Enter and follows a result. findit.io is a real box: `nmap` shows `22` and `80`, and its root
password does not crack.

#### Decided at planning (2026-09-26)

**Owner decisions:**

1. **The index is live, read in one batch.** Every search reads each publisher's homepage as served
   now, patches included, so a rewritten `index.html` changes its own listing at the next search. The
   ~64 machines (32 gateways, 32 site servers) are read in ONE batched patch query; a publisher whose
   gateway no longer forwards `:80` to its generated site server falls back to full single-target
   resolution. A dark publisher (bricked, nginx stopped, filtered) is absent.
2. **The lynx form ships in two PRs** — 2a renders the field and searches by URL; 2b makes it
   interactive.

**Derived from existing conventions:**

3. **findit is its own one-machine network** keyed `findit.io` (never broadcast). Its "AP gateway"
   tree IS the findit box, so fetch, scan, login, exploit and logging (`ap:findit.io`) all reach it
   through the gateway arm with no new resolver.
4. **The box (102):** `sshd` + `nginx` only; root from the UNCRACKABLE pool; `dpkg/status` on the CVE
   timeline; `/var/www/html/index.html` is the search form, so a rooted findit can be defaced.
5. **Its address** is `193.x.y.z` derived from its key, in the world DNS beside the 32 publishers; a
   catalog-wide test proves it distinct.
6. **A URL may carry a query.** The host stops at `?`; every file read ignores the query; the access
   log records the raw path, query included.
7. **One dynamic handler** (95): findit's own box, path `/`, non-empty `q` → the pure search, run
   only after `resolveWebTarget` succeeds, so a bricked or stopped findit takes search down (100).
8. **Scoring** (96): decoded, split on whitespace, lower-cased, substring per term; title 3,
   description 2, body 1, summed across terms; positive scores only, at most ten, ties by domain.
9. **Reading a page without a DOM:** `<title>` (else the domain), `<meta name="description">` (else
   the body's first non-empty line), body text with comments, scripts and tags stripped.
10. **The results page** (99), all interpolations escaped: legacy's shape, the `GET` form re-filled,
    an `<ol>` of linked titles, domain and description; `No matches for "<term>".` otherwise.
11. **Publisher homepages name themselves** with the catalog `site.name` in `<title>`/`<h1>` and a
    per-category `<meta name="description">`; they never emit `Disallow: /` (97, pinned by a test).

#### 2a — findit.io answers a search (v0.269.0, #555)

- **Decided mid-slice — a gateway that serves the web itself is listed.** Mutation testing asked what
  happens when a rooted gateway stops forwarding and serves `:80` from its own disk; that IS what
  answers, so it is fetched the ordinary way and listed. Only a network where NOTHING serves the web
  is absent.
- **findit is a network whose gateway is the box.** `buildApGatewayBaseFs` returns `buildFinditFs()`
  for the findit key; `resolvePublicTarget`'s gateway arm names it `findit` with no fronted segment.
- **A URL may carry a query.** `URL_PATTERN` ends the host at `?` and accepts a query with no path;
  `resolveWebPath` cuts the query before resolving a file. The raw path is still what the access log
  records — slice 4's prize, already in place.
- **The index is a view, read in one batch.** `indexedWeb` reads the 32 publishers' gateways and web
  servers through one new `findPatchesForMachines` dependency (`.in('machine_id', ...)`, module scope
  inside `api/network.ts`; no new `api/` file). `servesWebOn` was extracted so the crawl and the fetch
  share one definition of "serving the web".
- New modules: `core/findit/{readPage,search,page,publisherIndex}.ts`, `core/generation/findit.ts`,
  `core/network/webServing.ts`.
- **Gates:** 6237 unit tests green, typecheck and lint clean. Mutation in two scoped batches
  (`search.ts` 37/39, `page.ts` 43/44, `readPage.ts` 146/166, `http.ts` 114/115, `webServing.ts`
  10/10, `publisherIndex.ts` 59/72): three real gaps closed (whole-document byte assertions for both
  served pages; an unterminated comment a later `>` had been hiding; a journal whose EARLIER row
  decides); six module-load statics hand-verified; the rest equivalent or defensive.
- **Wire-check:** new `scripts/testFindit.ts`, 9/9 live — ten results for "services"; a rewritten
  homepage listed by its new title; a bricked webserver drops out; a query on an ordinary site serves
  its page; the search lands in findit's `access.log` as `/?q=services` under the searcher's address.
- **Browser (v0.269.0, from `MIDNIGHT-DINER`):** `curl findit.io/?q=university` ranked Ridgemont
  first; `lynx findit.io/?q=coffee` rendered `[coffee] [ Search ]` above six numbered cafés and
  followed result 1 to `http://beanthere.com/`; `nmap -sV findit.io` showed `80 nginx/1.26.0` and
  `22 OpenSSH 9.7.0`, each with a live CVE.
- **Fixed in passing:** five source files carried a cp1252 `0x97` byte where an em-dash belonged.

#### 2b — lynx submits a form (v0.270.0, #556)

- **`renderPage` segments gained `field` and `submit`**, each carrying a `FormTarget` (`id`, resolved
  `action`, `get`/`post`) or `null` when there is nowhere to send it (no form, or an action
  `resolveHref` refuses such as `mailto:`). An empty or whitespace-only action is the page's own URL.
  An untyped `<button>` and `<input type="submit">` are submits; `type="button"`, password and hidden
  fields stay unselectable.
- **Links keep their numbers; fields are not numbered**, so a form above the results leaves the first
  result `[1]`. Selection is by position in ONE list of selectable items (links, fields, buttons) in
  page order, compared by identity; the link segment's `index` field was dropped.
- **Editing is "a field is selected and the reader has not pressed Escape".** Every character types
  (`q` included; Ctrl/Cmd/Alt excluded), Backspace deletes, Left/Right do nothing (no cursor model),
  Up/Down, Enter and Escape pass through. The field being typed into shows a trailing `_`; typed
  values are kept per position and forgotten on arrival anywhere.
- **Submitting is a follow.** `formSubmissionUrl` (`core/network/http.ts`) replaces the action's query
  with the named fields, form-encoded by `URLSearchParams` (the codec findit decodes with), and `Lynx`
  follows it through the same `go` path as a link — same log line, same Back. A nameless field is left
  out (it was a real defect: `?=unnamed&q=...`). POST forms and formless fields render but never send;
  the hint offers `⏎ Submit` only for a form that will send, and `Esc Leave field` while typing.
- **Gates:** 6297 unit tests green, typecheck and lint clean. Mutation: `formSubmissionUrl` 10/10;
  `Lynx.tsx` 281 killed, 3 runtime errors, 8 survived; `renderPage.ts` 503 killed, 7 survived. The
  first run surfaced eleven real gaps, all closed; survivors are equivalent or on untouched lines.
- **Wire-check:** `N/A`, no `api/` change.
- **Browser (v0.270.0, from `ESPRESSO-EXPRESS`):** `lynx findit.io` opened on `[_] [ Search ]`;
  typing `university` and Enter opened `http://findit.io/?q=university` with Ridgemont as `[1]`;
  following it opened `http://ridgemont.edu/`; Back returned to the results. On the form `q` typed
  `[q_]`; after Escape, `q` quit. agent-browser's `keyboard type` fires no `keydown`, so it cannot
  type into lynx — recorded in the `v2-e2e` runbook (use `press` per key).

#### Risks carried forward

- **Search cost.** One batched read of ~64 journals plus 32 homepage materializations per search, not
  yet measured against a single fetch. Fallback if slow: a pure index over generated homepages that
  consults journals only for publishers with patches on their site server or gateway. Slice 3 adds
  every player's public forward to the same query, so size both together.
- **The findit key in ESSID-shaped code.** `networkPersona`, `generateHomeLan`, `frontedSegment`,
  `seedApGatewayHostname` and anything else assuming a catalog ESSID must never be asked about
  findit, or must answer sanely; the public-target, scan and fetch tests against findit are the guard.
- **Stripping tags with a pattern, not a parser.** Player HTML arrives in slice 3; the reader must
  stay total on malformed markup and only ever feed text into escaped output.

### As-built: X2 slice 3 — a player's page is found

Shipped v0.271.0 as one PR against trunk (#557), 2026-09-26. When player A publishes nginx behind a
public `:80` forward, player B's `curl "findit.io/?q=<a word on A's page>"` lists it by its title and
A's bare public IP. Once A's `robots.txt` says `User-agent: *` / `Disallow: /`, the next search no
longer does.

#### Decided at planning (2026-09-26)

**Owner decisions (refine 97):**

106. **`robots.txt` is read the way a real crawler reads it.** `Disallow: /` opts out only inside a
     group for `User-agent: *` or `User-agent: findit` (names in any case). A `findit` group, when
     present, is the ONLY group findit obeys. `Disallow: /admin/`, an empty `Disallow:` and a
     `Googlebot` group hide nothing. It applies to every page on a public `:80`, publishers included.
     Rejected: any `Disallow: /` line anywhere, and "any robots.txt opts out" (would break 92).
107. **The crawl leaves no trace.** Building the index writes nothing, so no `access.log` line lands on
     a crawled box. Rejected: logging the crawl (writes per search, and it would leak findit's search
     traffic to every listed player, undercutting 102).
108. **The player walk is a batched pre-filter.**
     - one read of every stored public address;
     - their gateways inside ONE journal batch;
     - a full `curl` resolution only for a gateway that answers `:80`.

     Rejected: a plain `curl` per stored address, and a stored listing table (a second authority, 97).
109. **One PR.** Automatic listing is fair only because the owner can refuse it, so the listing and
     the opt-out ship together.

**Derived from existing conventions (110–115):**
- **Who counts as a player page:** a player page is any stored address whose network is neither a
  publisher nor findit. A joined publisher is listed once, by its domain.
- **One batch:** the stored gateways join the publishers' machines in the one batch.
- **What "serving" means:** exactly what a `curl http://<ip>/` gets. A refusal, or no `/index.html`,
  means no listing.
- **Where `robots.txt` is read:** from the box that serves the homepage. A missing file allows.
- **Failures:** a failed stored-address read yields NO index.
- **A player's result:** an ordinary `IndexedPage` whose address is the IP.

#### As built (v0.271.0, #557)

- **`core/findit/robots.ts`: `robotsAllowFindit(robotsTxt | null)`, a pure reader of 106.**
  - Consecutive `User-agent` lines share a group.
  - The site is refused only by `Disallow: /` without an `Allow: /` of the same reach.
  - Only `Allow`/`Disallow` count (`Noindex: /` does nothing).
  - A line with no colon is ignored without ending its group (strict, as RFC 9309 reads it).
- **`publisherIndex.ts` is now `webIndex.ts`** (`WebIndexDeps`), since it indexes every page on the
  public web.
  - **`siteAt`:** `resolveElsewhere` became `siteAt`, returning `ServedSite = { homepage, robotsTxt }`
    from the same box through a shared `siteOn(fs)`. So a publisher's own site server and any fetched
    address are read one way.
  - **Shared gateway check:** `webBehind` is the gateway's `:80` gate, shared by both paths.
- **`api/network.ts` gains `listPublicAddresses`**, which reads `network_public_ips` (`essid,
  public_ip`) at module scope, with no new `api/` file.
- **Gates:** 6345 unit tests green, typecheck and lint clean.
- **Mutation, scoped:**

  | Target | Killed | Survived |
  |---|---|---|
  | `robots.ts` | 103 | 2 |
  | `webIndex.ts` | 99 | 12 |
  | the handler's `answerSearch` | 4 | 0 |

  The first run found seven gaps, all closed:
  - a colonless line ending a group;
  - an unknown directive read as a rule;
  - agents named findit-first;
  - a middle group dropped when a later group joins;
  - a deleted front page;
  - empty (`data: null`) reads of the stored addresses and of the journal batch.

  The survivors:
  - equivalent `slice` copies;
  - unreachable guards;
  - `'/'` vs `''`;
  - the `?? []` defaults;
  - module-load statics;
  - one false survivor (the repointed-publisher branch), which fails three tests when applied by hand.
- **Wire-check:** `scripts/testFindit.ts` 18/18 live (9 new).
  - Covered:
    - a staged player listed by IP;
    - a rewrite found by its new word;
    - `robots.txt` in and out;
    - leaving and rejoining the wifi;
    - the forward deleted;
    - the campus obeying a rewritten `robots.txt`;
    - zero crawl rows.
  - **Cost:** 11 stored networks and 7 journal rows; 1398 ms per search against 1339 ms per single
    fetch.
- **Browser (v0.271.0):**
  - **A publishes.** A, on `CASA-DE-RAMIREZ` (residential), published nginx and wrote
    `forward 80 to 192.168.199.232:80` on the rooted gateway.
  - **B finds it.** B, on `ESPRESSO-EXPRESS`, ran `curl "findit.io/?q=quokkagarden"` and got
    `Ada Quokka Garden` at `198.97.57.103`; `lynx` followed `[1]` to A's page.
  - **A opts out.** A's nano-written `Disallow: /` took the page out of findit, while a direct `curl`
    still served it.
  - **No trace.** A's `access.log` held only B's two real visits.
- **Runbook:** the `v2-e2e` runbook gained "Putting a player's page on findit". A's public IP is shown
  nowhere in-game; `echo >` writes one line, with no `>>` and no `-e`, so `robots.txt` needs nano.

#### Risks carried forward

- **The API caps a read at 1000 rows** (`max_rows` in `supabase/config.toml`). The stored-address read
  is unfiltered, and the journal batch carries every row of up to 64 + N machines, logs included.
  Past 1000 of either, the read is cut short with no error. A player page then goes unlisted, or a
  journal replays incomplete. That is far off at pre-launch scale. The fix is to page the reads, or
  to narrow the gateway rows to the paths the pre-filter needs (boot files, `rules.v4`).
- **Search cost grows with the world.** It is flat against a fetch today; re-measure with
  `testFindit.ts`'s COST line when the world grows.
- **Player HTML reaches the pattern-based page reader.** It stays total and escaped, as slice 2
  required.
- **Players can outrank institutions** by stuffing titles. This is intended ("SEO as play", 96).

## Open branches (named, not yet decided)

1. ~~**`nc -l` semantics (D5)**~~ — **RESOLVED 2026-08-16 at D5's grill.** A session with no
   credential, whose user is asserted by the pidfile, is an ordinary session row at the pidfile's
   tier: the login gate's credential STEP becomes pluggable (nc reads the listener where ssh reads
   `/etc/passwd`), and the spine, the row and the tier are unchanged. Generated backdoors land at
   USER tier so locked decision 1 survives; planted ones necessarily assert root, since only root
   can write `/var/run`. See "D5 — resolved scope & decisions", decisions 2 and 11.
2. ~~**Where `lynx` and `gobuster` sit**~~ — **RESOLVED 2026-07-29, gobuster REVISED
   2026-07-31.** Neither rides with D1. `lynx` becomes its own fast-follow slice (a full overlay
   browser screen — legacy carried `LynxBrowser.tsx` + `lynx/render.ts` + `lynx/fetch.ts`).
   `gobuster` was originally moved into D2 for the shared `apt install` → `extraFiles` seam;
   D2's split found that seam is *all* it shares with the credential layer, so it becomes
   **D1c** instead — it brute-forces paths, not credentials, and its whole defender-side tell is
   a wall of 404s in the `access.log` D1 shipped. D2.1 still builds the seam.
3. **Exposure defaults** — derived, not decided: new services are **opt-in** for players (like
   `sshd` today) and generated onto NPC hosts via `placement`. Correct unless stated otherwise.
4. **Phase 2 contents** — the owner has a shape in mind (common networks discoverable because
   they run websites). Worth its own grilling when Phase 2 starts.
5. ~~**Probability knob values** for the crackable/uncrackable draw~~ — **RESOLVED 2026-07-31 at
   D2.2 planning.** Guest **100%**, NPC user **70%**, NPC root **12%**, gateway root **40%** —
   about one crackable root per 8-host LAN, with the gateway the best root odds in the game
   (decision 1 names it the pre-CVE root target). "Rare" is measured across a **population** of
   generated hosts, since a generation-time probability is a property of the world, not of one
   box. Planning also found a **third** pool the split missed: every gateway drew from
   `ROUTER_ADMIN_PASSWORDS`, two of whose eight words shipped in the default wordlist, so 23.8% of
   gateways cracked by accident. **All four knobs are now shipped and measured** (guest 100%,
   npcUser 70.3%, gateway 37.0-38.9%, npcRoot 11.9%); `ROUTER_ADMIN_PASSWORDS` is retired. See
   [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1.

## Parking lot

- **`john`** rides with D2 — it is the same gate (dictionary attack against your wordlist)
  applied to a stolen hash rather than a live service.
- **`techparts.io`** and further themed networks — content, not capability. Drop-ins once X2's
  registry exists.
- **Wordlist hardening** (ship md5 hashes to the client, keep plaintext server-side, make
  hydra/john server calls) — the recorded path if decision 7's accepted cost ever bites.
- **`nmap`'s SERVICE column as a port→name GUESS.** Real nmap labels a port from `/etc/services`
  rather than from what is actually listening (31337→elite, 4444→krb524, anything unlisted→
  unknown), so the column is never evidence. One small table, flavour only. Raised at D5's grill
  and parked: a listener reads `unknown` either way, and probing stays how you learn the truth.
- **Missions** (`missions`/`accept`/`abort`/`mail` + mission network generation) — post-ship
  epic, by owner decision.
- **Believable per-machine content** — populating generated machines with random, plausible
  files so a box reads as somebody's rather than as a fixture. Owner intent, stated 2026-09-01;
  its own later work, not any door's. **Now its own epic, grilled 2026-09-21 and inside the ship
  gate, now shipped: [`world-content-architecture.md`](../v2/docs/world-content-architecture.md)** — believability only, loot stays with
  missions (its decision 2). **It inherits D2.6b's rule**: content that carries a
  usable credential is loot, and loot arrives through the postponed harvest route, not as
  scenery.
- **A pre-release realism pass over every command's argument surface.** Named at D10's grill
  (2026-09-02) when `find` chose legacy's positional shape over real find's `-name`. v2's house
  style is deliberate — `hydra [-p port] <host> [service] [user]`, `john <file>`,
  `snmpwalk <host> [community]`, `redis-cli <host> [password]` all simplify what the real tool
  spells with flags — and #464 bought realism in the binary NAMES, not in the arguments. The
  realism-versus-simplicity tension is real, so the whole set gets tweaked **together, once,
  before release**, with a player's muscle memory in view, rather than one command at a time.
- **Tutorials dropped into the player's home folder** — readable in-game files explaining the
  mechanics, landing before release. Owner intent, stated 2026-09-01; shape still to be
  decided. **D9 routed its example-script idea here** rather than shipping one via
  `apt install node`, so scripting is one of the things this must cover.

## Warnings

- ⚠️ **V2 turns the accepted L3 gap load-bearing.** `conventions-and-gotchas.md` §7 records
  that a client with a valid keypair can already mint an `effect_one_shot`/root session via
  `createSession` and call effects directly. Harmless while nothing uses it; it becomes the
  primary anti-cheat surface the moment `msfconsole` ships. **Decide server-side effect
  re-authorization before V2's RED.**
- ⚠️ **Decision 2 is load-bearing — do not quietly re-open it.** If a future slice starts
  adding per-protocol server-side restrictions, that is a new authorization dimension every
  later door must extend. The realism argument is the reason it does not exist.
- ⚠️ **Do not split these by layer.** "Add the daemon", "add the client command", "add the
  server handler" are tasks inside a slice, not slices.
- ⚠️ **`SERVICE_CATALOG` discipline holds**: rows arrive when a service ships, columns when a
  slice consumes them. V1 is where the version column earns its place — not before.
- ⚠️ **The tier-3 allowlist TRIPWIRE**: `/var/lib/dpkg/status` leaks the whole package list.
  Harmless while CVEs are port-bound; V4 (off-port library CVEs) is exactly the condition the
  tripwire names — narrow it to running-service entries there.
- ⚠️ **Phase 2 vs. multiplayer item #6**: that item deliberately makes shared-AP encounters
  rarer. X2 is what replaces them as the way strangers meet. Sequence X2 before it.

## Next action

**D1 is COMPLETE** (2026-07-31, v0.109.0). Five slices shipped — #344 `c54caa7`, #345 `9b05f6f`,
#346 `c408fb2`, #347 `2030004`, #348 `de357ca` — plus the close-out. A host serves a page; the
player runs their own web server and edits what it serves; a stranger reads that page across the
network **with no session and no credential**; and every fetch that reached a server is written to
that box's `/var/log/access.log` — owner-keyed writer, server-derived source IP cross-player, 200s
and 404s alike, traversals recorded verbatim. Its plan file has been deleted; the as-built lives in
`conventions-and-gotchas.md` §1 and the full journey in `e2e-shared-network-verification.md` §7.

**D2.1 is COMPLETE** (2026-07-31, v0.111.0). Two slices — #351 `4627621` (`apt` installs a
package's data files) and #352 `b227a0b` (hydra + the server-side crack). Its plan file has been
deleted; the as-built is `conventions-and-gotchas.md` §1. **A player can now earn a credential
in-game** — `apt install hydra` → `hydra <LAN host> ssh` → `ssh` in with what came back. `ssh` had
been decorative outside tests since it shipped, because nothing could produce a password for it.

**D2.2 is COMPLETE** (2026-07-31, v0.113.0). Three PRs — #354 `f9ad49b` (two pools + the account
curve), #356 `3af0b92` (the duplicate guest pool retired) and #357 `f69b05d` (the gateway knob).
Its plan file has been deleted; the as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1. **The mechanism is now a game**: every door
draws from one crackable pool and one uncrackable pool, and four knobs are the entire difficulty
curve — guest 1.00, npcUser 0.70, gateway 0.40, npcRoot 0.12.

Three things it settled that outlive it:

1. **The third pool is gone.** `ROUTER_ADMIN_PASSWORDS` is retired, not split: its factory
   defaults folded into the single crackable pool, so gateways draw at their own knob instead of
   cracking 23.8% of the time by wordlist overlap. One pool pair serves every door kind — a themed
   router pool bought flavour only in the half a player never sees, and would have split wordlist
   growth into two progressions.
2. **`__encoded.ts` reaches the server safely.** Proved rather than reasoned: the file was deleted,
   `npm run build` regenerated it via `prebuild`, and the bundle grep found the uncrackable pool 0
   times against a crackable control at 2. Both wire-checks then passed live.
3. **A rate needs a bigger population than it looks.** Systematically-generated seeds
   (`NET-0`, `NET-1`, …) have correlated FNV-1a hashes, so a 0.40 knob read 35.8-43.5% at 400
   samples and only 39.4-40.0% at 20000. Never tune a knob to close that gap — the roll is uniform
   to within 0.3pp on unrelated seeds.

**D2.3 is COMPLETE** (2026-08-09, v0.114.0). One PR — #358 `bae79f8`. Its plan file has been
deleted; the as-built lives in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1. **A sweep is
now the loudest thing a player can do to a box**: the target records one `auth.log` line per
password *tried*, `Accepted` for the one that matched and nothing after it, and writes nothing at
all when the sweep never reached the box.

**The split's ordering was wrong, and grounding caught it before any code.** D2.5 (`john`) was
slated next on the reasoning that D2.2 made root accounts hold, so a stolen root hash is a real next
move. The code said otherwise: `hydraCrack.ts:176` already sweeps **every** account in a target's
`/etc/passwd` against the caller's own wordlist, so `john` on any hydra-reachable hash returns
exactly what hydra already printed — same list, same `md5`. When root holds, it holds against `john`
too. Building D2.3 first is what gives `john` something hydra lacks: silence.

Two things it settled that outlive it:

1. **Volume is the behaviour.** Per-password, not per-account — a summary line would make a
   three-account sweep quieter than three ordinary ssh logins. ~110 lines per sweep, written as one
   append. Unbounded log growth is the attacker's accepted cost.
2. **Same-LAN traces trust the client's source IP, cross-player traces do not.** hydra now matches
   `ssh` on the LAN (`payload.source_ip`); the server-authoritative
   `resolveCrossPlayerSourceIp` stays for the cross-player writers. **D2.4 must switch.**

**D2.5 is COMPLETE** (2026-08-09, v0.115.0). One PR — #359 `aa70cfc`. Its plan file has been
deleted; the as-built lives in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1. **`john <file>`
finds exactly what hydra finds and leaves no trace doing it** — same list, same `md5`, but no packet
at the box the hashes came from. It reads both the file and the shared wordlist from whichever
machine the player is standing on, and needs no `api/` change, so there is no wire-check either.

**A locked principle arrived with it, from the owner: tools run where you stand.** `hydra`, `john`
and `apt install` must all work on an NPC box, and a player must be able to carry things from home
onto one. Ordinary tier gates still apply — `apt` needs root on that box, as real apt does — but no
"this is not your machine" refusal on top. `john` honoured it for free; **`hydra` violated it at
both ends**, which became its own slice — see below, shipped in v0.118.0. Carrying a *grown*
wordlist onto a box additionally needs `scp` (D3).

**The wordlist wipe is FIXED** (2026-08-09, v0.116.0, #362 `a382174`). `apt install` no longer
overwrites an `extraFile` that already exists, so a reinstall keeps a curated `passwords.txt` and
says so. Per-FILE rather than an already-installed short-circuit, because hydra and john both tell
a player with no wordlist to reinstall hydra to get one back — an absent file is still written and
that recovery keeps working.

**hydra's workstation-only gate is LIFTED** (2026-08-09, v0.118.0, #370 `aea2450`). Two slices, and
their order was the whole design: the wordlist read first, the gate second, so no shipped version
ever had `cat` showing a list the sweep denied existed. Its plan file is deleted; the as-built lives
in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1. **The loop the owner described now works
end to end with no `scp`** — root an NPC box, `apt install hydra` there, sweep the LAN from it.

**A second owner principle arrived with it: an NPC box is one box, and tier is the only lens.**
Everything on it is shared; what a player sees is decided by the tier they hold there, never by who
wrote it. The journal and the filesystem already worked that way — hydra's writer-scoped wordlist
read was the codebase's single divergence, and it is gone.

Three things it settled that outlive it:

1. **The replacement rule already existed.** `authorizeMachineAccess` — own workstation, or an
   active session on the machine — is what the patch endpoints already use, so the slice **removed**
   a bespoke check rather than adding one, and got the session's tier for free.
2. **An origin the server cannot place is refused, not guessed.** A deep-chain box or another
   player's workstation yields `caller_not_on_lan`: a false address in a defender's log is worse
   than a refusal, now that the log is an attack's whole visible cost.
3. **`env.network` inside a remote session is the PLAYER's connectivity, not the box's**
   (`ui/env.ts:179-192`). The essid is still right; `wlan0.ipv4` is not. Any future command that
   reads `env.network` from a hop inherits this trap.

**D2.4 is COMPLETE — all five slices** (v0.119.0 #371 `9b431d7`, v0.120.0 #374 `8838aaf`,
v0.121.0 #375 `f6748da`, v0.122.0 #376 `f160b31`). **hydra now reaches every target `ssh` does**,
each through the same resolver `ssh` authenticates through, so the two cannot disagree about a
target or a credential. As-built folded into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1; the slice plan is deleted.
**The pivot works**: an attack launched from a box the player only holds a session on is traced to
THAT network. `sessions.essid` was already the answer — stamped server-side at hop time and returned
by `authorizeMachineAccess` — so the slice deleted `caller_not_on_lan` rather than replacing it.
A refusal standing in for a lookup, removed rather than rewritten.
**Still open from it**: `ssh` and `nmap` carry no `caller_machine_id`, so they cannot pivot and still
trace to the actor's home — one shell, two different origins, until its own slice.
**Cracking now reaches outside the player's own generated world**: `hydra <a stranger's public IP>`
sweeps the access point's gateway, through the same resolver `ssh` authenticates against — proven
live, by posting the password hydra reported straight to `authCreateSessionPublic` and getting a
root session back.
Grounding corrected the row's own acceptance example: a public IP's **default port reaches the AP
gateway**, not the owner's workstation, so "cracks A's guest account" needs a NAT-forwarded port and
hydra has no port argument. The gateway target is the smaller slice *and* the better one (the
`gateway` knob is 0.40). The one open question there was **settled** (2026-08-10) and then **shipped** (v0.122.0, #376): the
deep-chain seam took its own PR after slice 4, because the deep layer was furnished and sealed —
every deep host force-runs sshd with an always-crackable `guest`, and there was no way in game to
obtain its password. There is now: `hydra -p <fwd> <inner gateway>`.

**D2.6 was confirmed on 2026-08-11, SPLIT, and its reachable half shipped.** Both tools do read the
file, so the append half (**D2.6a**) was tests and nothing more — #377 proved end to end that a
word appended to `/usr/share/wordlists/passwords.txt` opens a door the shipped `DEFAULT_WORDLIST`
cannot, through `hydra` and through `john`.

**D2.6b is POSTPONED — owner decision, 2026-08-12, taken during its own planning session.** The
loop it would close is real and stays closed: every password is drawn from two pools, and the
shipped wordlist covers one completely while the other exists only as an md5 in a target's
`/etc/passwd`. Cracking therefore teaches a player nothing they did not already hold, and
**coverage cannot grow**. The call is that **parity breadth comes first, and the harvest route can
arrive with the CVE phase** (decision 6 already names `password_reset` as one) rather than as
bespoke loot content. Hidden credentials remain wanted later, as content, whenever they are worth
placing.

**What V2 now owes, stated so its planning inherits it**: `/etc/passwd` is NOT a harvest route. It
yields an md5, and `john` against that hash only returns words already in the caller's wordlist —
that is the closed loop, not an escape from it (`hydraCrack.ts` sweeps every passwd account against
the caller's own list, which is exactly why D2.5 found `john` returns what hydra already printed).
So V2 must ship a route that produces a **plaintext** the player did not hold, or the progression
stays inert however many doors parity adds. Verify this when V2 is grilled.

Three designs were worked out before the postponement and are recorded so the option set does not
have to be rebuilt: the loot names **(a)** a bare uncrackable-pool word — cheapest, but the gain is
statistical and invisible at 1-in-48, with no acceptance criterion a player can observe; **(b)** a
named neighbour's account on the same LAN that really holds it — guaranteed, observable payoff and
the mechanic made visible, at the cost of one pure `hostAccounts(essid, host)` seam so the note and
the box cannot disagree (`hostServices` is the precedent); or **(c)** the box's own root password —
instant `su`, but it retunes the measured `npcRoot` 0.12 knob and makes the win the escalation
rather than the append. (b) was the recommendation. Placement is unresolved beyond "NPC LAN hosts
first". Two constraints are locked either way and both are load-bearing: uncrackable-pool or the
harvest is a no-op, and behind a tier gate or a guest walk-in reads it. Full grounding in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1 (D2 block) and §9. Lower
priority: `AvailabilityRule` is declared
on ten commands and read by nothing — hydra's declaration is now truthful, but the field is still
inert. Enforce it or delete it.

**D1c (`gobuster`) is DONE** — selected 2026-08-12 over D3 once D2.6b was postponed; its plan is
deleted, as closed-out plans are. **Slice 1 merged** (v0.123.0,
#378): the tool exists, the path list is the sole gate, and a player can grow it by hand. **Slice
2** (v0.124.0, #379): every probe lands in the target's `access.log` as one append under one
timestamp, so the sweep costs the attacker the loudest page in the defender's log — proven by an
11/11 wire-check and, on 2026-08-13, **by the live close-out**: a player built two directories by
hand, swept, widened the list with `nano`, swept again, and read 84 lines back out of one row.
Written up as Act 8 in
[`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md).

**The row is shipped once #379 merges.** Nothing is outstanding; pick the next slice from the
phase list rather than from this row.

**Planning found a gap, and the owner scoped it OUT rather than in.** Every web root in the game
holds exactly one file: `buildRemoteHostFs` and `buildWorkstationBaseFs` both stamp
`/var/www/html/index.html` and stop, so a path sweep over today's world finds `/index.html` and
nothing else. The obvious reading of decision 4 would make generated unlinked pages slice 1. The
owner's call (2026-08-12) is that **generated world content is its own epic** — believable per-box
files, web trees, and later MySQL and Redis data are one design with one shape, and a narrow
version built here would have set the pool shape, per-box volume and variation model that epic
should own. So the rule is now recorded: **a door slice does not invent its own content system to
have something to point at.** See
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §9.

**What stands in for it as evidence: the player makes the content.** `mkdir`, `touch`, `nano` and
`rm` all ship in `/bin`, and `curl`/`gobuster` resolve the player's own address to their LIVE tree
— so `su root` → `mkdir /var/www/html/<dir>` → `nano` a page → `nginx` → `gobuster
http://localhost` proves the tool against real content at no content-design cost. That live journey
was a required close-out step, not an optional smoke test, and **it ran** — see Act 8. Pick `<dir>`
from `DEFAULT_DIRLIST` or widen the list with `nano` first: an unlisted directory is correctly not
found, which reads as a broken tool if you were not expecting it.

Two consequences accepted with it: against a generated NPC host `gobuster` finds `/index.html` and
nothing else until the content epic lands (the tool is correct, the world is thin — **not** D2.6b's
failure, where the mechanic itself had no input); and the shipped **D1 defect** — pages advertising
six paths that all 404 — stayed live through D1c. **D1b fixed it on 2026-08-13** by removing the
advertisements rather than adding the pages, because a browser makes a dead link the headline
interaction rather than a footnote. A property test now holds the line: no generated page links a
path its host does not serve.

**`gobuster` is own-LAN, and cross-player is its own slice** — exactly as `hydra` was after D2.1.
The shape already exists: the cross-network fetch and the server-side resolution behind it, so a
sweep across networks is that path plus the batched `paths[]` form slice 2 built. It is a slice and
not a follow-up because hydra's equivalent took five (D2.4). **This became D1d, selected 2026-08-14
— see the block at the end of this section for where the code actually sits now** (D1b moved the
door this note originally pointed at).

**D1b (`lynx`) is DONE** — selected 2026-08-13 as the fast-follow, planned as seven slices and
delivered in six (v0.125.0 → v0.129.0), with the live browser run recorded as Act 9 of
[`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md).

Slice 1 (v0.125.0, #381) stopped generated pages advertising doors that do not exist, which had to
happen before the browser existed rather than after — `curl` makes a dead link a shrug, a browser
makes it the headline interaction. Slice 2 (v0.126.0, #382) is the walking skeleton: the overlay
screen, the `DOMParser`-based renderer, and `q` to get back out. Slice 3 (v0.126.1, #384) gave
`curl`, `gobuster` and `lynx` one door to a web host instead of three copies. Slice 5 (v0.127.0,
#386) made it a browser rather than a viewer: links render numbered and selectable, and following
one fetches through the same path the command uses. Slice 6 (v0.128.0, #387) added going back.
Slice 7 (v0.129.0, #388) reached another player's page by public IP, and gave the cross-network
fetch the same one-definition treatment slice 3 gave the local one. Slice 4 was absorbed into
slice 2 — the renderer lost its width parameter to CSS, and most of slice 4 was that arithmetic.

**The decision worth remembering: going back RE-FETCHES.** It keeps one rule for the target's log
— a line per page viewed — instead of a second rule saying which views do not count, and the live
run proved it from the defender's side: three pages read left exactly three `access.log` lines.

Two consequences of that ordering are accepted and recorded in the plan — do not rediscover them
as bugs. Generated hosts now render **linkless**, so link-following is proven against a page the
player writes with `nano`, exactly as D1c proved discovery; and `lynx` on a generated page shows
*less* than `curl` does, because comments are deliberately not rendered. Both resolve themselves
when the content epic lands, with no change to `lynx`.

**D1d (`gobuster` across networks) is DONE** — v0.130.0, one slice, merged as the plan called it.
Its plan file is deleted, as closed-out plans are; the as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1 and the live journey is
Act 10 of [`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md).
**The web door's cross-player parity is now complete**: `curl` reached across from D1, `lynx` from
D1b slice 7, and the sweep was the last tool that refused a stranger.

Three things it settled that outlive it:

1. **A tool's ammunition is read where the tool stands, by the SERVER.** The path list never
   crosses the wire — the caller names the machine they are on and the server reads that box's
   `dirlist.txt` off the journal, exactly as the credential sweep reads the password list. The
   precedent applied because the two files have identical provenance: `apt install` is the only
   thing that writes either, so both exist purely as patches and neither can be faked by a
   client. Planning had chosen the opposite (post the words) and grounding reversed it.
2. **A defender's tell is a shape, not a count.** Forty words land as ONE append under ONE clock
   reading — 42 lines including the directory retry. Per-word round-trips would have written the
   same lines and destroyed the evidence, because a wall scattered across forty timestamps no
   longer reads as one act.
3. **Free ingredients are not free scope.** Authorizing the caller's machine yields their session,
   which made a vantage-aware trace nearly free — so the sweep tells the truth about a pivot while
   `curl` and `lynx` still stamp the actor's home on the same handler. Two rules in one door,
   accepted deliberately and recorded rather than discovered later.

**Still open from it, unchanged**: `curl` and `lynx` carry no `caller_machine_id`, so their
cross-player traces cannot follow a pivot. Their slice, alongside the one `ssh` and `nmap` need.

**It hit the known log staleness, which is decided, not open**: after any server-side append the
client shows that log as EMPTY until something else syncs its journal — proven still pre-existing
by control, since a `curl` through the same forward is equally invisible. That was decided
2026-07-31 (no Supabase Realtime; the staleness accepted, a PULL as the approved fix shape if ever
taken) and is recorded in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §9,
which D1d re-confirmed rather than discovered. Read the row from the DB when a log looks empty.

**D3 ✅ SHIPPED AND CLOSED OUT** (2026-08-15, v0.131.0 → v0.136.0, #393–#398) — six slices, plan
file deleted, as-built in `conventions-and-gotchas.md` §1 + §7 and Act 11 of
`e2e-shared-network-verification.md`. **D3b ✅ SHIPPED AND CLOSED OUT** (2026-08-16, v0.137.0 →
v0.139.0, #401–#403) — three slices, plan file deleted, as-built in `conventions-and-gotchas.md`
§1 + §7 (the four `scp` bullets) and Act 12 of `e2e-shared-network-verification.md`. Both
directions work own-LAN and against a stranger's box through a NAT forward; the transient row
opens and closes around one transfer on every exit path; and the target's `auth.log` gains a login
line that names no file in either direction. Both grill questions were resolved at planning and
shipped as decided (always create-and-end; no `-P` alias), and three more the plan deliberately
carried are settled rather than inherited by a fourth path: the `isNew` flag is **omitted in both
directions** (it is verifiably inert — §7), a relative remote path **resolves from the account's
home**, and a write failing for network reasons **says so** instead of blaming the player's tier.
Slice 1's deferred wire-check is discharged by `testScpTransfer` 19/19 live over both door-kind
paths. **The pair is done, and with it every way into a machine that moves a file.** Everything
below is the grill that produced both doors; read it as the record of what was expected, not as
work outstanding.

D3 was selected (2026-08-14) straight from decision 8's locked door order once the web
door was complete on both sides — **and it was split first: `ftp` is D3, `scp` is D3b, each with its
own `grill-me` and its own `planning`** (owner call, 2026-08-14). The original row fused them under
"file transfer", which is the only thing they share.

**Why they separate.** `scp` is not a door. Grounding legacy found `scp.ts` at **417 lines against
`ftp.ts`'s 218** — the rider is the bigger build — and the reason is structural:

| | **D3 — `ftp`** | **D3b — `scp`** |
|---|---|---|
| Shape | a **door**: daemon, catalog row, placement, an open port | a **transfer**: no daemon, no port, nothing to place |
| Session | **held**, with a client mode (`ModeChange kind:'ftp'` is already stubbed at `types.ts:92`, as `nano` was) | **transient** — `withTransientAuthSession` validates, transfers, then *ends* the session; closer to `curl` than to `ssh` |
| Endpoints | one remote | **two machines, two authorizations, one command** (local `getNode` → remote `createFileOnMachine`, through NAT/forwards) |
| Its own grill owns | the mode command set's size, ftp as a hydra service, `vsftpd.log` | session lifecycle, where the trace lands (source, target, or both), async progress + cancellation |

Legacy's own comment records that its transient-auth wrapper **replaced** an earlier non-auth
`withTransientSession` — legacy changed its mind about scp's auth model mid-flight, which is exactly
the kind of question a shared grill would have buried under ftp's mode UX.

**Order: D3 before D3b** — ftp is the door decision 8's order names, and D4 (daemon control) is
justified by "a player runs sshd + a web server + **ftpd** with no way to stop any of them", so ftp
feeds the next slice and scp does not. ftp's `get`/`put` also build the tier-gated copy primitive
D3b reuses. Both should land before D4.

**D3 WAS GRILLED** (2026-08-14) — nine locked decisions and a four-slice spine live in
["D3 — resolved scope & decisions"](#d3--resolved-scope--decisions-grill-me-2026-08-14) above, and
all nine survived contact. The two findings that reshaped it, both borne out:

- **The cost is not the command count, it is that ftp holds TWO machines at once.** Everything in
  `ui/state.ts` is singular and follows `activeSession()`. That was the slice, and the shape it
  produced (a second binding + a second journal beside the shell's) is what D3b inherits.
- **hydra already sweeps ftp for free** (`hydraCrack.ts:212` matches the service generically) but
  hardcoded its trace to `auth.log` — so the catalog row and the log routing shipped together, in
  that order, which is why no version ever wrote sshd-tagged lines for a door nobody knocked on.

**D3b HAS BEEN GRILLED TOO** (2026-08-14) — five decisions and a three-slice spine in
["D3b — resolved scope & decisions"](#d3b--resolved-scope--decisions-grill-me-2026-08-14). It closes
**D2.5's named gap**: *tools run where you stand* is honoured by `hydra`, `john` and `apt install`,
but a player still cannot move a curated `passwords.txt` onto an NPC box they rooted. Two findings
from its grill:

- **Legacy's scp was upload-only**, so download — the *silent* harvest, against ftp's itemised
  `get` — is net-new rather than a port. The two doors specialise instead of overlapping.
- **The carry's `apt install` step is load-bearing.** An NPC box has no `/usr/share/wordlists/`,
  which is where `WORDLIST_PATH` points, so without it the acceptance describes something
  impossible.

D3b is the SMALLER half despite legacy building it larger (417 lines vs ftp's 218) — it inherits the
kind-parameterized session from D3.2 and the remote binding from D3.3, which is why D3 went first.
**What D3 actually leaves it** (all shipped, all live-verified): a `kind` on both the LAN and the
public login gates, `standingVantage` for an honest source address, the tier-gated copy primitive
in both directions (`land()` in `ftpShell.ts`), and `recordFtpTransfer`'s provenance split. What
D3b still owns alone is its own: the transient session lifecycle, two authorizations in one
command, async progress + cancellation, and where a *silent* transfer's trace lands.

**✅ D4 — daemon control. COMPLETE 2026-08-16 (#407-#410, v0.142.0).** Four slices; the plan
file is deleted and its as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7 (the daemon descriptor,
the single "what is running here" policy, `systemctl`'s unit-vs-program rule, the `env.fs`
snapshot) and §9 (the one defect left open), with the browser run in
[`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md) Act 13.

A defender can now close a port and have it stay closed — to their own scan, a neighbour's, a
stranger's across the network, and across a reboot — and see what their box is running.

- **Slice 0** (#407, no bump) — the three daemon commands became one. `sshd.ts`/`vsftpd.ts`/
  `webServer.ts` were 393 lines differing only in which catalog row they bound; 407 source lines
  became 252 and the 850 lines of daemon tests passed with nothing but their import specifier
  changed. A terminal reduction, both gates passed.
- **Slice 1** (#408, v0.140.0) — `systemctl start/stop/status/restart`. Found that `restart`
  could not route through the daemon's own front door: `env.fs` is a point-in-time snapshot, so
  the already-running gate re-read the pidfile the same command had just deleted and left the
  service DOWN. Now an architecture invariant.
- **Slice 2** (#409, v0.141.0) — `ps`. `readOpenPorts` gained a richer sibling rather than a
  second walk, so one policy decides what counts as a service.
- **Slice 3** (#410, v0.142.0) — every login gate asks the same question. The `ssh` exemption was
  protecting nothing (`ROUTER_SSH_PROBABILITY` is 1, so no router generates without sshd), and the
  same-LAN gate compared the port rather than the service. Proved with a wire-check that
  reproduces both bugs against the pre-fix code before closing them.

**What D4 deliberately did not do**, and who inherits it: `kill` and session **eviction** → D5,
where a planted `nc -l` backdoor is something worth killing and is not a `SERVICE_CATALOG` row.
`chmod` left the epic row entirely as an independent capability. No `enable`/`disable` — one
state, and it persists. No service-state log — the `auth.log` line that admitted the intruder is
the attribution.

**One defect is open and belongs to whoever owns the recon/defence balance**: `ps` on a box you
have ENTERED shows nothing, because pidfiles are root-only and a foreign session's tree is
projected at the tier the credential bought. Found by the Act 13 browser run; recorded in §9.

**✅ D5 — `nc` connect + the `nc -l` backdoor. COMPLETE 2026-08-18 (#415-#423, v0.151.0).**
Nine slices; the plan file is deleted and its as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7 (the `/var/run` union,
the derived PID, units-vs-processes, the no-TTY shell and pull eviction) and §9, with the browser
runs in [`e2e-shared-network-verification.md`](../v2/docs/e2e-shared-network-verification.md)
Acts 14 and 15.

**A player can now leave something behind, and a defender can find it and take it away.** Plant a
listener on a box you have rooted, forward the port, and walk back in from another network with no
credential asked for and nothing written to any log — into a shell that is full minus what needs a
TTY, so a root-planted door can brick and a user-tier one cannot be escalated in place. The
defender's half is `ps` to see it, `nmap` to find the port it opened, and `kill <pid>` to remove
it, which drops whoever is inside on their next command. ~10% of generated NPC machines already
carry one, so the first backdoor a player finds is one the world left.

All fifteen grilled decisions survived contact. What planning added to the locked six-slice spine:
eviction split out of the connect slice (two concepts, two observables), and the credential step
landed in **all four** login gates at once rather than own-LAN first — D4 slice 3's lesson applied
in advance, since a rule applied to some gates and not others is the drift that slice existed to
remove. Adding `'nc'` to `DOOR_KINDS` then broke `authCreateSessionPublic`'s compile, which is the
compiler enforcing "four gates, one path".

Five things it settled that outlive the plan:

- **Slice 0 fixed the `ps` defect D4 left open, and the first diagnosis was wrong.** It was a
  permissions drift between two producers, not the read-filter change §9 had proposed — the grill
  caught that before any code. §9 is rewritten CLOSED, including the wrong diagnosis.
- **`nc` asks the BOX rather than consulting its own map**, forced mid-slice by a discovery: the
  client's own-LAN resolution reads the GENERATED tree with no journal replay, so a listener
  planted on a rooted NPC is visible from ON the box and invisible from outside it. The local view
  now answers only "does the catalog name this port?"; anything else is a round trip.
- **The replay gap is wider than `nc` and is NOT closed.** An own-LAN `nmap` replays no journals
  either, so a door planted on the AP gateway is invisible to every occupant scanning that LAN
  while an outsider scanning the public IP sees it. Diagnosis and the shape of the server-side fix
  are in §9; it predates D5, which only made it observable. **It needs its own slice.**
- **Two browser acts, and the second existed because the first found a defect.** Act 14 proved the
  reach; standing in that shell it also showed `ls /var/run` disagreeing with what `ssh` into the
  same box printed. That became slice 8 — and then its twin one door along, `ftpRoot`, which
  shipped as its own PR (#424, v0.152.0). **Three sites decide which tree a session reads and they
  must all agree**; §9 carries the rule and the fixture blind spot that hid both.
- **The wire sweep caught its own rot.** `testScpTransfer` check 8 asserted an `ssh` exemption
  PR #410 had removed the same day the script was written — the sweep read 44/45 for two doors
  before anyone looked. Fixed at close-out; a wire-check written against behavior that is itself
  in flight needs re-running after the PR it raced.

**What D5 deliberately did not do**, and who inherits it: no push channel for eviction (a pull is
how a real terminal behaves, and it cost nothing); no below-1024 root rule (the root gate fires
before a port is parsed, so it would be an unreachable branch); no `-9` (v2's flag binder answers
first, and the words are not `kill`'s to choose). The own-LAN journal-replay gap and `nmap`'s
5-digit port padding are both open in §9.

### D5b — what shipped, and what it deliberately did not do (closed 2026-08-19, v0.157.0)

Five slices, `#428`–`#432`, v0.153.0 – v0.157.0. The plan file is gone; the durable part lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7. A generated LAN reads as a
population end to end: `nmap` returns `cam-31` and `db-11` rather than `iphone-40`, a webserver-named
box answers `:80` at 0.95 where a camera offers `:22` at 0.1, a box you stand on keeps an `/etc`
config a **guest** can read, the page it serves fits it, and the account `hydra` hands back belongs
to it — `mail-139` answers with `dkim`, `thermostat-207` with `mqtt`, a laptop with somebody's name.

- **The role is DERIVED and read back off the hostname.** `LanHost.kind` was never widened, no wire
  format moved, and nothing about a role travels. The hostname is the only carrier, which is why the
  prefix pools are load-bearing — see the invariant in the conventions doc before renaming one.
- **The whole epic re-rolled nothing but names.** Locked decision 10 accepted new NPC `machine_id`s
  (the hostname feeds `hostMachineId`) and that is real. Locked decision 9 accepted re-rolling every
  NPC password, and **that cost was never charged**: `pick` consumes one `next()` at any pool width
  and the host-fs seed is the box's address, so every credential in the world stayed put. The octets
  never moved either, which is what kept the lease allocator honest.
- **Three roles took a placement cell before their door exists** — `fileserver` and `database` wear
  the ftp signature (a dump has to leave the box somehow, and ftp is the only door either can
  express today), `iot` suppresses ssh to 0.1. `workstation`, `mailserver` and `dns` stay flat,
  because a cell invented before its door ships is a number with no claim behind it. **D6 inherits
  the `database` cell**: when `mysqld` lands it gets a real one.
- **What it deliberately did not do**, and who inherits it: no web bucket for `database` or
  `fileserver` (15% of served pages between them — the `/etc` config already speaks for both, and
  the volume question belongs to the generated-content epic); no split of `iot` into camera and
  sensor, so a TV can draw `modbus`; no revisit of prefix-pool DEPTH, where repeats inside one large
  LAN are visible (4–7 names per role, against 15 per role for accounts). All three are content
  decisions, and the generated-world-content epic is where they belong.
- **`dns` exists with nothing to run against it.** Kept at 3% on the reading that a role a player
  meets rarely is worth having named when they do; X1's `nslookup` is what makes it answer.

**✔ DONE: D6 — a player reads a machine's database (`mysql`)**, fourth door in the locked order
(ftp → daemons → nc → **mysql** → redis → snmp → node). **GRILLED 2026-08-19 — thirteen locked
decisions and a seven-slice spine in
["D6 — resolved scope & decisions"](#d6--resolved-scope--decisions-grill-me-2026-08-19). PLANNED in
`d6-mysql.md` (deleted on close-out; the as-built lives here and in the conventions doc), and
**slice 1 shipped v0.158.0 (#434)** — a box that runs `mysqld` now
holds a real database, and one that does not holds no `/var/lib/mysql` at all. Its mutation debt was
then paid in full across **#435 and #436**, which took `pools/database.ts` from a score inflated by
masked timeouts to **88.69% with 0 timeouts** and 44 survivors that are each accounted for — 42
column-metadata mutants slice 3 must kill by asserting `DESCRIBE` **over the population**, and 2
equivalent float comparisons. **Slice 2 then shipped v0.159.0 (#437)** — `hydra <host> mysql` returns the
accounts in the box's database rather than its `/etc/passwd`, which was a SHIPPED BUG and not a
missing feature: slice 1's catalog row made the door reachable while all three vantage handlers
still read the wrong file, so on a box holding a `root` in both it returned the right name against
the wrong secret. Proven by `scripts/testMysqlSweepTrace.ts` **13/13** on the wire. Two things it
taught that the plan had not predicted: the **application account is the commonest** credential a
sweep returns (67.7% of database boxes, against `readonly`'s 48.8% and root's 12.0%, measured over
800 networks) because half the databases carry no `readonly`; and this slice's `api/` production
diff was **empty**, so the row's blanket "slices 2-5 and 7 touch `api/`" does not hold — the wire
-check earned its place for a narrower reason, that a `patches` row at a SECOND log path lands and
reads back under a key the upsert's conflict target does not swallow.

**D6 IS COMPLETE at v0.171.0**, and its plan file is deleted. Slices 4-7 after the block above:
**slice 4** (v0.163.0 #441) put the tier ladder on the wire — `readonly` refused an `UPDATE`, the
app account performing one, only database root dropping a table, with every mutation appending to
`/var/log/mysql.log` and no `SELECT` ever doing so. **Slice 5** (v0.166.0 #442) reached a database
on a deep layer through a forward, and found two of its criteria already true; it also found that
the chain resolver hands back the terminal box's SEEDED tree, which is survivable for a door
authenticating against seeded accounts and fatal for one answering with DATA — worked around in
`reachMysqlHost`, recorded in §9 as the resolver's to close for every door at once. **Slice 6**
(v0.167.0 #443) gave the player their own database, and with it the root chain that decision 3 of
slice 7 later made explicit: `ownDatabase` mirrors the box's chosen password onto the database's
root account, so whoever cracks the box and runs `su root` is holding the database's root password
already. **Slice 6b** (v0.168.0-v0.169.0) was a world-generation correction D6 made visible — a
generated box now carries the packages for the services it runs, so its doors can be shut.

**Slice 7 (v0.170.0 #447, v0.171.0 #448) is the cross-player one, and it shipped as TWO PRs split
by vantage.** It was grilled first, and the grill changed its shape: checking the gap map cell by
cell found THREE gaps rather than the two the one-line plan claimed, and one of them was not a
database gap at all.

- **PR 1 — the public vantage.** `hydra <A's public IP> -p <fwd> mysql` turned out to be already
  working and completely untested (`hydraCrackPublic` was written service-generic), so it was
  proved by MUTATING PRODUCTION rather than by a fabricated RED. The mysql half was RED and small:
  a public address resolves through the same `resolvePublicTarget` that `ssh` and `hydra`
  authenticate through, so a credential either earns is one this door then accepts by construction.
  Wire-check `testMysqlCrossPlayer` 8/8 live.
- **PR 2 — the same-LAN vantage, and the gap that was not the database's.** `hydraCrack` resolved
  its target from `generateHomeLan().hosts` alone, so it could not sweep a fellow occupant for ANY
  service. Fixing that generically (decision 1) is what makes a same-LAN `hydra … ssh` against a
  neighbour work at all — a mysql-only fix would have left one tool answering by a different rule
  depending on the service named. Wire-check `testMysqlSameLan` 12/12 live, including the two
  claims only a live run makes: a real occupant answering at an address the generator also filled,
  and that address falling back to the seeded sibling the moment the player leaves the WiFi.
- **What it settled that outlives D6** is in §7 of the conventions doc: the four-vantage reach
  decided from the ADDRESS server-side, the cross-player write of DATA landing under the target's
  key (because `patches` folds rather than accumulates), and occupant-beats-sibling as a rule of
  target RESOLUTION rather than of any one service.

**The close-out was a browser smoke test, and it earned its keep.** Two players on one WiFi,
18 checks across the NPC vantage, the own box and the same-LAN neighbour — then one real defect:
A ran a single statement on **her own** database and B's row reverted while B's line vanished from
`/var/log/mysql.log`. Every vantage the SERVER answers re-materializes the target per statement;
the own-box vantage answers on the CLIENT and composed its whole-file writes from the tree this
client last pulled, refreshed by a cross-TAB hint but never by another player. So the accepted
window was not one request, it was the owner's whole session, and the file being shortened was the
defender's own evidence. Fixed at **v0.172.0 (#449)** with `env.fs.reload()`; the general rule is
now §7 of the conventions doc — **a whole-file write to a path SOMEBODY ELSE can write must
compose against the machine, never against the client's copy of it.** Three smaller findings were
left open on purpose in §9, and **two of them closed at v0.173.0**: the mysql sub-shell echoed the
shell prompt (two places deciding the same thing, now one `subShellPrompt()`) and a player saw
herself under a generated cover name every other path already contradicted (self now uses the
workstation name). The third — a product decision rather than a bug: a neighbour's open ports were
invisible to `nmap`, so nothing told a player their neighbour ran a database and they had to guess
the service and let `hydra` find it — stayed open three doors longer and **closed at v0.182.0**,
in D7 slice 7b, when the same-LAN doors it was waiting on had actually opened. All four findings
are now resolved. **A door is not proven by its wire-checks alone** — the wire-checks were 20/20
green and could not see any of this, because the defects live in the one vantage no endpoint
answers. One session's browsing produced four findings, three of them invisible to a green suite.

### Phase 3 slice 1 — a version is visible ✅ SHIPPED v0.210.0–v0.211.0 (#491, #494)

Retired here from `phase3-1-a-version-is-visible.md`, the way D3–D10 and X1 each were. Two PRs:
1a put a real `/var/lib/dpkg/status` on every box in the world; 1b made `nmap -sV` read it.

**A manifest lists what is INSTALLED, not what is RUNNING.** The slice was scoped as "generated
from its running services", which is legacy's basis, and taking that literally would have shipped
two bugs. `buildDeepHostFs` patches `sshd:22` onto its tree AFTER `buildRemoteHostFs` builds it,
so every deep host would have advertised an ssh port with no `openssh-server` behind it; and the
player's own box runs nothing at start, so its manifest would have held libraries only and
`systemctl start sshd` would have opened a port with no package to upgrade — on the one box the
whole defence exists for. Deriving the manifest from the daemon binaries a box CARRIES dissolves
both, and equals the original wording on every NPC.

**`Package` is the apt package name; `Version` is the bare tuple.** `openssh-server` / `9.7.0`,
never `ssh` / `OpenSSH 9.7.0`. The vendor prefix is presentation, owned by the version template a
scan renders — the same reason the catalog's `banner` stays version-free. `ServiceSpec` gained a
`package` column so apt cannot answer to two names for one thing. One version table covers all
three axes, because the manifest is itself one flat namespace in which a daemon, a shared object
and a router's firmware are indistinguishable.

**The manifest is the authority, never the version table.** `apt upgrade` will move a box off what
it shipped with, and a scan answering from the table would keep pointing at a hole the defender had
already closed. `readOpenPorts` therefore reads the file, not `PACKAGE_TEMPLATES`.

**`-sV` is a display decision, not a resolution one.** The version is always resolved; the flag
only decides whether the column prints. The manifest is already tier-3 externally observable
(`readFilter` had allowlisted the path since before it existed, naming `nmap -sV` as its reader),
so gating resolution would hide nothing a second scan would not hand over, and would cost the
server a second scan mode. The flag itself is **declared, not parsed** — `FlagSpec`/`bindFlags`
were already here, and `stacking`'s own doc names `nmap -sV` as the reason stacking defaults off.

**An `OpenPort` is constructed in exactly two places** — `readOpenPorts` and the forward synthesis
in `scanResult` — which is why the version reaches all five scan vantages without five changes.
`portsOpenToNetwork` filters; `resolvePublicScan`, `resolveOccupantScan`,
`resolveInnerGatewayScan` and `deepScanHosts` pass ports straight through. A forward advertises the
version of the box it LANDS ON, so scanning an access point's public IP names the occupant's
software — recon crossing a player boundary on purpose, and the price of opening a forward.

**There were no zod schemas to widen, and that is the hazard, not the relief.** All three client
paths cast (`body as Partial<PublicScanResolution>`) rather than parse, so the field rides the wire
for free and nothing at the type or schema level could catch a server that stopped sending it. The
wire-check is the only thing that can: 24/24 across the four scan scripts, with B scanning A's
public IP and reading `22=OpenSSH 9.7.0 161=net-snmp 5.9.4` off A's own manifest.

**The mutation gate paid for itself twice.** In 1a it found a latent defect inherited from legacy:
`/^Package:\s*(.+)$/m` — `\s` matches the newline, so a `Package:` line with an empty value
swallows the line below it, and a block reading `Package:` then `Version: 3.0.0` parsed as a
package literally named "Version: 3.0.0". **That bug is still in the frozen legacy tree.** In 1b it
found the mirror image: `/^Version:` needed the same anchor defence, or a crafted `Description:`
line could preempt the field it describes. Both live on a file a player owns root on can hand-edit,
which is what makes them reachable rather than theoretical.

**Two debts are owed to slice 4, and are not reachable before it:**

- **`apt install` does not update the manifest.** The manifest is generated from the box's base
  tree, and `apt install nginx` adds `/usr/sbin/nginx` as a journal PATCH over that base — so a
  player who buys a daemon carries a binary the manifest does not name. **Slice 4 must write a
  manifest patch alongside the binary patch**, exactly as `apt install` already writes its data
  files. It is invisible until then: the VERSION column simply shows no version for a port whose
  package is unlisted, which is the same cell a planted backdoor gets.
- **`openssh-server`, `vsftpd` and the eight libraries are not rows in `APT_PACKAGES`.** Nothing
  currently enforces that the manifest's namespace and apt's agree. Adding installable rows now
  would let a player `apt install openssh-server` for a daemon every box already has, and no test
  demands them. **Slice 4 owns closing this**, with a check that every package name the manifest
  can emit is one apt knows.

Left open in `nmap.ts` and named rather than fixed: nothing pins the host-discovery table
(IP/HOSTNAME/KIND) or the router `.1` `sameLAN` vantage, so a mutant swapping that vantage to
`external` — which would leak NAT forwards to anyone inside the LAN — survives. It predates the
slice.

**Slice 2 followed and SHIPPED at v0.212.0 (#496) — its close-out is the next section.**
`WORLD_EPOCH` and the severity roll; `nmap -sV` gained a CVE id and severity on a live one (the
forward walk moved to slice 4). Nothing is exploitable yet — the player can only watch it happen.
It carried the server-owned world epoch that replaces legacy's `localStorage`-anchored per-browser
clock, which was the larger of the two known deltas the grill went in with.

Both opens slice 1 carried forward are **SETTLED** in
["Slice 2 — resolved decisions"](#slice-2--resolved-decisions-grill-me-2026-09-10): the epoch is
`2026-09-01` as an openly-labelled development anchor guarded by a dated tripwire test (24), and the
three CVE axes share **one axis-blind derivation** with per-axis interpretation attached in slices
3, 8 and 9 (25). Five more decisions came with them — the CVE serial, the column layout, the absence
of any clock override, the tripwire, and one-PR delivery.

Phase 3 was **grilled 2026-09-09**: twenty-three locked decisions and a nine-slice, loop-first spine
in ["Phase 3 — resolved scope & decisions"](#phase-3--resolved-scope--decisions-grill-me-2026-09-09).
X2 (`findit.io` and networks a player was never told about) stays **deferred by decision** and
ungrilled — see the X2 rows in the spine and the acceptance table.

**What the Phase 3 grill found before deciding anything**, and the reason the port is a partial
one: **legacy's service treadmill never actually ran.** `machineConfig.ts:536` seeds every machine's
`/var/lib/dpkg/status` with all 8 libraries at their `startTuple`, so the LIBRARY treadmill worked
from day 3 — but services are seeded from `defaultServiceVersion()`, the literal string `'latest'`,
chosen so *"findVulnForService(anyService, 'latest') always returns undefined"*, and
`applyVersionOverlay` skips that sentinel explicitly. A service CVE could only ever land on a box
mission enrichment had FORCED onto a hand-authored version. Legacy shipped the walker, the
timelines and all eight effects, and **no ordinary NPC was ever exploitable through a service.**
The other two deltas were known going in: legacy's clock is `localStorage`-anchored per browser,
and its effect tier was envelope-trusted by its own admission.

**Three consequences are accepted knowingly** and are recorded in the decision section rather than
left to be rediscovered as bugs. From ~day 14 any shell on any NPC escalates to root through
`msfconsole --local`, permanently (decision 5 — closed later by the planned NPC maintainer actors).
`hydra` guest → `--local su` → root → brick is a live kill chain against any player who stops
upgrading, and `apt upgrade` closes it completely (decision 6). And `password_reset` can
permanently cost a player root on their own box if they never learn the convention (decision 21),
which is why decision 15 requires the exploit trace to name the CVE.

### Phase 3 slice 2 — a CVE is visible ✅ SHIPPED v0.212.0 (#496)

Retired here from `phase3-2-a-cve-is-visible.md`, the way D3–D10, X1 and slice 1 each were. One PR,
21 files, +855/−79. The world has a clock now, and every package on every box has a vulnerability
derived from it rather than from a table somebody wrote by hand.

```
$ nmap -sV 192.168.29.1
PORT     STATE SERVICE  VERSION         CVE               SEVERITY
22/tcp   open  ssh      OpenSSH 9.7.0   CVE-2026-0149031  medium
161/udp  open  snmp     net-snmp 5.9.4  CVE-2026-0712758  medium
4444/tcp open  unknown
```

**`WORLD_EPOCH` is a DEVELOPMENT anchor and has to be re-stamped before launch.** It is
`2026-09-01`, set in the past so the treadmill is already running while the phase is built.
Shipping that value would hand the first players a world months deep in CVEs — the exact state
decision 2 dropped legacy's hand-authored day-0 table to avoid. It is freely movable until launch,
because nothing is persisted and every box is frozen at its starting version, and irreversible
after, because every CVE id, publication date and severity in the game derives from it. The dated
tripwire in `worldClock.test.ts` fails once the anchor is ~90 days stale, and its failure asks a
question rather than reporting a fault: **launching, or extending the runway?** It is the only
thing standing between a forgotten constant and a world that begins already lost.

**One derivation, and the axis is not a parameter.** `liveCve(key, version, gameDay)` answers
identically for a daemon, a shared object and a router's firmware image, because
`/var/lib/dpkg/status` is one flat namespace in which the three are indistinguishable. What a CVE
*grants* differs per axis — the library privilege floor, the per-service effect pools — and is
deliberately absent from this module: it belongs with the tool that fires an exploit. Slices 3, 8
and 9 attach interpretation to one derivation rather than each growing a second one.

**No clock override exists anywhere, in any environment.** `gameDay` is a plain number below
exactly two entry points: a command's `env.now()`, and the server's own clock at the three scan
actions in `api/network.ts`. To move the world you edit `WORLD_EPOCH` and restart, so client and
server shift together — and a forged client clock can only mislead the client, because the server
recomputes the same number from its own.

**Two flaws in legacy's CVE id are fixed rather than ported.** Legacy numbered packages by an
alphabetical sort, so adding one renumbered every CVE after it; each `VersionTemplate` row now
carries a permanent hand-assigned `cveNumber`, required by the type so a package cannot be added
without one, and the doc comment says it must never be derived from file order or a sort. And
legacy's serial ended every package's FIRST CVE in `0000` — with decision 21 keying the reset
password on those four digits and every NPC frozen on its first CVE forever, `pwned-0000-<tier>`
would have been a master key for a player who never read a log. A per-package scatter fixes it:
`9031`, `9486`, `8750`, `7580`.

**`readOpenPorts` takes the day as an OPTIONAL parameter.** Thirty callers — `ftp`, `scp`, `nc`,
`hydra`, the login gates — ask only whether a port is open and have no opinion about time. A caller
that names no day gets no answer about holes rather than a default one. The hazard is the same one
slice 1 named about the wire: a new scan path can forget to pass it and silently drop the CVE, and
the wire-check is what catches that, not the type system.

**The mutation gate found three real gaps**, each closed and each verified by hand to fail without
its fix. `assertCveTimingInvariants` — the guard that keeps the treadmill winnable by forbidding a
config where a fix arrives at or after the next vulnerability — had zero coverage. No package in
the world rolls exactly 10, 60 or 90, so all three severity band boundaries were unpinned and a
band shifting by one would have quietly changed what a whole class of targets is worth. And
dropping the day from `scanResult`'s `sameLAN` branch survived: the router `.1`, the first thing
anyone scans from inside their own LAN, would have read permanently clean.

**Two survivors were justified rather than killed, and one was a mis-report.** Both year-arithmetic
mutants on `WORLD_EPOCH + publishedAt * DAY_MS` still produce `2026`, because every publication day
is ≤ 14 by configuration and therefore inside the epoch's own year — no test written against the
public interface can distinguish them, and they become reachable when slice 4's walk reaches
versions a year out. The `ConditionalExpression → false` on `liveCve`'s early return is killed by
two tests, confirmed by applying the edit by hand: the `coverageAnalysis: perTest` failure mode
§4 of the conventions doc documents.

**The wire-check is the only proof the `api/` half is right**, because all three client paths cast
the response body rather than parsing it — nothing at the type or schema level could catch a server
that stopped sending the field. 46/46 across six scan scripts, live against `vercel dev` +
supabase, with B reading A's CVE off A's own manifest. It compares the wire against what `core`
derives locally rather than against a hardcoded id, so it asserts the field survived the round trip
instead of re-asserting the derivation — and stays true whatever day the world stands on.

**Two debts move forward**, both recorded above under
["Carried forward from slice 2's implementation"](#carried-forward-from-slice-2s-implementation):

- **The forward timeline walk is slice 4's**, with `findLatestSafeVersion`. Nothing in slice 2 can
  reach past entry 0, because every box is frozen at its starting version until `apt upgrade`
  exists. Slice 2 draws only the first gap — on the walk's own FIRST PRNG draw, so extending it
  into a loop republishes nothing that players have already written down.
- **A root player can hide a CVE by hand-editing `/var/lib/dpkg/status`.** The manifest is the
  version authority and is root-writable, so an unrecognised version reads as "no CVE" on the
  server too. Harmless while nothing is exploitable; free immunity from slice 3 on. It is the
  pinning mechanic pointed the other way and wants the same answer — slices 3 and 4 own deciding
  whether an unknown version reads as clean, as its nearest known ancestor, or as unpatchable.

Left open and named rather than fixed, unchanged from slice 1: nothing pins `nmap`'s host-discovery
table or the router `.1` `sameLAN` vantage, so a mutant swapping that vantage to `external` — which
would leak NAT forwards to anyone inside the LAN — still survives. It predates both slices.

### Phase 3 slice 3 — a door opens ✅ SHIPPED v0.213.0 (#497)

Retired here from `phase3-3-a-door-opens.md`, the way D3–D10, X1 and slices 1 and 2 each were. One
PR, seven RED-first increments. Everything slice 2 renders is now actionable: the player stops
watching the world get worse and makes the first move recon earned them.

```
$ nmap -sV 192.168.78.85
PORT     STATE SERVICE  VERSION         CVE               SEVERITY
6379/tcp open  redis    Redis 7.2.5     CVE-2026-0597580  critical

$ msfconsole 192.168.78.85 6379
[*] Targeting 192.168.78.85:6379
[*] Sending exploit payload...
[*] Payload delivered, waiting for callback...
[*] Vulnerability: CVE-2026-0597580 (critical)
[+] Exploit successful!
[+] Full shell as root@192.168.78.85
```

...and in the target's own `redis.log`, the file its credential sweeps already land in:

```
4290:M 11 Sep 2026 08:33:21.000 * Client 192.168.78.50 exploited CVE-2026-0597580; shell opened as root
```

**FULL SHELLS ARE RARE, and this is the single most load-bearing fact for slices 4-6.** The effect
roll is seeded and permanent, and the four services every box runs all landed on non-shell effects:
`openssh-server` rolls `file_read`, `nginx` `script_exec`, `vsftpd` `dir_list`, `snmp` `file_write`
— all of which collapse to the LIMITED shell under decision 31. Only `mysql`, `redis` and `bind9`
roll `shell_full`. So the common doors hand over a shell with no terminal behind it, and a
pivot-capable shell is something a player has to go looking for: a store, a database or a name
server. This softens the "the world is too generous" cost decision 31 accepted, and it is why the
wire-check's full-shell case targets a store. The mapping is pinned in `exploitEffect.test.ts` and
**must not move** — it is a world constant now, not an implementation detail.

**The trace destination follows the row's `sweepLog`, with no carve-out.** Decision 15's own example
suggested an http CVE should land in `access.log`; the rule in the same paragraph says reuse that
row's sweep destination. The rule won, because it is what keeps one service's evidence in one file
a defender can grep. The dns row is the harsh case and was put to the owner explicitly: its
`sweepLog` is an admitted placeholder whose own comment says *"The column has no optional form"*, so
a break-in through `named` traces into `auth.log` tagged `named[pid]:`. One rule everywhere beat a
carve-out.

**`formatExploit` is a sibling on `ServiceSpec`, not a field inside `SweepLog`.** Three rows share a
sweep destination; putting the formatter inside the destination would have collapsed their tags, and
each daemon has to sound like itself in a file that holds all three. The column is REQUIRED, so a
future service row cannot ship a door with no way to record being forced.

**A limited shell CAN still fire `msfconsole`.** Ruled by the owner at PR readiness: tools run where
you stand — the same rule that lifted `hydra`'s own-machine gate, because a box you have opened is a
place to attack FROM. The weak grant stays weaker where it was designed to be (no credential login,
no editor, no prompting command at all); what it keeps is the ability to keep moving, and a `nc`
backdoor keeps it for the same reason. The rejected alternative was a one-line `withoutTty`, on the
argument that decision 31 collapses six unbuilt effects to a limited shell precisely to make them
weaker. Declined — pivoting is the point of opening a box at all.

**Decision 23's script grammar moved to slice 5, with the owner's sign-off.** `msfconsole` carries
`withoutScript` for now. The grammar exists so a scripted exploit still changes state while a shell
effect merely reports — but under decision 31 every effect in this slice IS a shell, so a scripted
run could only report, would mint a session row nobody enters, and would write a trace for an
exploit the player must then fire again by hand. It earns its keep the moment a non-shell effect
exists.

**A box holding no account at the granted tier refuses and logs**, rather than inventing a name the
box would not know. Reachable the moment a rooted player edits `/etc/passwd` — it is the
root-writable-manifest hole pointed at a second file, and slice 4 owns the same question for
`/var/lib/dpkg/status`.

**The client decides nothing, and there is no field in which it could.** The request carries an
address and a port. No username, password, version, CVE, effect or tier — a door that asks for
nothing has nothing for a caller to lie about. The server recomputes the game day from its own
clock, regenerates the target, replays its journal, honours the owner's own port filter, and reads
that box's own manifest. A refusal is uniform: a patched daemon, a filtered port, a planted `nc`
listener and silence all answer `not_vulnerable`, because a bounce that said which would turn a
failed exploit into a free scan. The difference lives in the defender's log, which is what makes
patching pay a visible dividend.

### Evidence, and the two numbers that need reading twice

Suite 4664 / 216 green; `npm run typecheck` and `npm run lint` clean. `scripts/testExploitOwnLan.ts`
**18/18 live** against `vercel dev` + supabase — its targets derive from the world at the SERVER's
own game day rather than being hardcoded, so it does not rot as the world publishes more CVEs.

Mutation gate, three runs, **0 timeouts in all of them**: `exploitCreateSession.ts` 86.3% →
**97.1%**, `exploitLog.ts` 88.9% → **100%**, `msfconsole.ts` 63.6% → 68.2%, `exploitEffect.ts`
41.6% unchanged. **Excluding the effect pools and the manual page: 197/205 = 96.1%**, with all eight
remaining survivors hand-accounted — seven equivalent, one a blank output line.

**`exploitEffect.ts` reads 41.6% and that is correct, not debt.** The arithmetic settles it: the
pool block holds 52 entries, exactly **7** died — one per service, the entry each seed actually
draws — exactly **45** survived, and **zero** survivors sit anywhere outside the pool block. Every
survivor is a pool entry the world cannot draw while the roll is pinned at the first index. **They
become reachable in slice 4**, when `apt upgrade` moves a package to a later CVE and the index
widens — so slice 4 should expect this file's score to climb on its own, and should not "fix" it
with a test that restates the table. Counting only reachable mutants the file is 32/32.

The gate earned ten tests for claims nothing checked. The two best: the server's 500 paths, where a
code comment promised no trace is written for a session that failed to persist and **nothing
verified it**; and `syslogExploitLine`'s failure branch, which forced down the success arm writes
`opened as undefined` into a defender's log — a break-in they never had, which is exactly the lie
the two-formatter split exists to prevent.

### Found by running it, and only by running it

- **A tombstone keeps its `owner` and its `node_type`.** `content: null` alone is the deletion
  marker; both other columns are NOT NULL in the `patches` table. The in-memory replay tolerates
  nulling `node_type` and the database does not, so a unit-test helper and a real journal write
  disagree about how a brick is spelled. The wire-check's first run died on the constraint.
- **No jitter.** The grill said legacy's phase output ports "jitter and Ctrl-C included". v2 has no
  jitter helper and every streamed command paces on a fixed abort-aware `env.sleep` — so Ctrl-C came
  free and the random spread did not come at all. Cosmetic, and adding a PRNG to pacing would make
  the output untestable for nothing.
- **Every sleep happens BEFORE the round trip.** A Ctrl-C after the server minted the row would
  otherwise leave a session standing on a box the player was never put on.
- **The CVE is named on the way IN, not up front.** Legacy printed it first because legacy computed
  it client-side; here the client never worked out which hole this was, and printing it before the
  callback would be the tool claiming knowledge only the target could have given it.

**➡️ NEXT: Phase 3 slice 4 — the defender patches.** `apt upgrade [package]`, `apt list -u` with
the ETA status, install sharing the upgrade resolver, and **the forward timeline walk +
`findLatestSafeVersion`** deferred here from slice 2. **THE LOOP CLOSES**: A upgrades, B's working
exploit now fails, and inside the delay window A is told no fix exists. It is the first slice worth
playtesting — until it lands, the world only ever gets worse and a defender has no move at all.

**SHIPPED as TWO PRs** (decision 37) — **4a a fix is visible** (v0.214.0, #498), then **4b the
defender patches** (v0.215.0, #499). Its plan file is deleted and its close-out is the next
section; the four questions planning had to settle are decisions 36-39 in
["Slice 4 — resolved decisions"](#slice-4--resolved-decisions-planning-2026-09-11). The three
things slice 3 handed it are all accounted for there: the effect index widens past the first entry,
making 45 currently unreachable pool entries live (so `exploitEffect.ts`'s mutation score climbs on
its own and must not be "fixed" with a test restating the table); `apt upgrade` is what first
reaches past a package's starting version, so a version off the timeline stops being exotic; and the
root-writable-manifest question is answered by decision 36 — **nearest known ancestor**, which makes
lying pointless rather than free.

Planning also found a fourth, which only running slice 3's own evidence could surface: the CVE id is
seeded on `cve-id:${key}` with **no index**, so entry 1 would mint entry 0's serial. It has to take
the index by drawing that stream FORWARD rather than re-seeding it, because entry-0 ids are already
written into real journal rows by slice 3's traces. And `testExploitOwnLan.ts` closes its door with
`9.9.9-never-shipped` — under decision 36 that string resolves to the starting version and leaves
the door OPEN, so a shipped wire-check inverts and is rewritten in 4a.

### Phase 3 slice 4 — the defender patches ✅ SHIPPED v0.214.0–v0.215.0 (#498, #499)

Retired here from `phase3-4-the-defender-patches.md`, the way D3–D10, X1 and slices 1–3 each were.
Two PRs as decision 37 required — **4a a fix is visible** (v0.214.0, #498) then **4b the defender
patches** (v0.215.0, #499), seven RED-first increments each, the second cut from trunk after the
first landed rather than stacked on it. **The loop closes here.** Until this slice the world only
ever got worse at the player; this is the first move a defender has, and the first slice worth
playtesting.

Captured verbatim from the close-out browser run, on a fresh box at game day 10:

```
root@skylab:/root# apt list -u
Listing...
  openssh-server 9.7.0 [upgradable → 9.7.1]
  vsftpd 3.0.6 [upgradable → 3.0.7]
  libpam 1.5.3 [vulnerable, no fix yet — ETA ~1 day]
  libcrypt 4.4.36 [upgradable → 4.4.37]
  libsystemd 255.4.0 [vulnerable, no fix yet — ETA ~1 day]
  libreadline 8.2.10 [upgradable → 8.2.11]
  libz 1.3.1 [upgradable → 1.3.2]
  libxml2 2.12.5 [upgradable → 2.13.0]
  libpcre 10.43.0 [upgradable → 10.43.1]

root@skylab:/root# apt upgrade openssh-server
Reading package lists...
Building dependency tree...
Calculating upgrade...
The following packages will be upgraded:
  openssh-server
1 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Unpacking openssh-server (9.7.1) over (9.7.0) ...
Setting up openssh-server (9.7.1) ...
```

**Nine of the base image's ten packages need a move on day 10, and two of them cannot make it** —
which is the treadmill arriving at the right weight. A bare `apt upgrade` then reports
`6 upgraded, 0 newly installed, 0 to remove and 2 not upgraded.` with a `W:` line for each package
still inside its window, and running it again says `0 upgraded … and 2 not upgraded` rather than
nothing at all.

...and the exploit that opened that door a moment ago now answers `not_vulnerable`, while the
session it already granted keeps working.

**"No fix yet" is a one-or-two-day state, and that is the treadmill's whole pace.** `CVE_TIMING`
holds a 3–14 day safe window and a **1–2 day** patch delay, so the ETA line a player meets is
always `~1 day` or `~2 days`. The window is real pressure but never a wall: waiting it out is a
plan rather than a gamble, which is what makes a true countdown better than legacy's config
midpoint. Anything later that assumes a wide gap — a mission that wants a package stuck open, a
fixture built on a three-day delay — is wrong about this world and will fail against it.

**One resolver answers both of apt's version questions** (decision 7), as one shared private
frontier walk rather than one verb calling the other's public surface. `upgradeStatusFor(key,
version, gameDay)` answers *where can this version move to* — `up-to-date` | `upgradable{target}` |
`no-fix-yet{etaDays}` | `no-timeline`. `newestReleaseOn(key, gameDay)`, added in 4b, answers *what
does the repo hold today*: the birth version before the first hole publishes, the fix once it has
shipped, and — the case that matters — **the exposed release itself while its fix is still inside
the patch delay**, so installing into a window leaves you exposed exactly as everyone else is
rather than buying immunity by arriving late. A package with no history at all answers `undefined`
and apt lays down no row.

**`apt install` on a package the box already carries routes to the upgrade path.** The owner's call
mid-build, and it narrows decision 38: real apt upgrades a package it already has, and saying
*"already the newest version"* on a box that `apt list -u` calls exposed would be apt contradicting
itself one command later. The line survives only where it is **true**. This is also what keeps a
reinstall honest — it moves the box exactly as far as `apt upgrade` would and no further, instead
of stamping today's release onto a box still running last year's binary.

**A manifest patch must restate owner and permissions, or it hides the file it just wrote.** A
write left at the session's defaults lands root-only, and the one file the whole phase trusts
vanishes from every version scan and from `apt list -u` below root — a patch that reads as a
disappearance. `DPKG_STATUS_PATH`, `DPKG_STATUS_OWNER` and `DPKG_STATUS_PERMISSIONS` are now shared
constants that the generator stamping the file and every command rewriting it both read, so a
patched manifest and a generated one cannot drift apart.

**Decision 19 holds by construction, which is why increment 6 is a test-only commit.** Nothing in
the patch path touches sessions: the shell re-checks only `nc` sockets through `socketAlive`, and
the server's `authorizeMachineAccess` consults the session row rather than the box's exposure. Two
guard tests pin it from both ends — one at the shell, one at the patch endpoint — so an exposure
check added to either later fails loudly instead of quietly evicting whoever is already inside.
Upgrading is a defence, not an eviction tool; `reboot` is the eviction tool and it is slice 7's.

**Entry 0 still has not moved.** The walk grows forward from the version every box already sits on:
gap and bump draw from `timeline:${key}`, the patch delay from its own `:patchDelay` side stream,
and the CVE id stream is **walked** rather than re-seeded per index, because entry-0 ids are
already written into real journal rows by slice 3's traces. Severity goes the other way — re-seeded
per index, because its seed already carried one. Each stream got whatever left entry 0 exactly
where the world had published it. The fifteen world pins prove it in the suite, and
`testCrossPlayerScanTrace` proves it on the wire: `openssh-server 9.7.0` still derives
`CVE-2026-0149031` through the server path.

**`withPackageVersion` rewrites the block the parser hands back**, spliced in where that block was
read from — the last of its name, which is the one a reader reads. It had carried its own rule for
where a manifest block begins and ends, a second copy of what the parser already knows; the
mutation gate found the two agreeing only by luck. A manifest apt rewrote somewhere nobody looks is
a patch that never happened.

**`apache2` is still the one apt daemon with no version template.** It installs as it always did
and writes no row. Flagged for the content pass — giving it a template is a world-data decision,
not this slice's.

### Evidence

Suite **4762 / 217 green**; `npm run typecheck`, `npm run lint` and `npm run build` clean at
v0.215.0.

`scripts/testExploitOwnLan.ts` **19/19 live** against `vercel dev` + supabase, and it is the proof
the whole slice exists for: at game day 10 the ssh door on `192.168.78.18:22` opens on
`CVE-2026-0149031`, `apt upgrade` moves the box 9.7.0 → 9.7.1, the same exploit refuses, the
defender's log holds **both** the break-in and the bounce, and the session opened before the patch
still writes to the box afterwards. `testRemoteAptInstall` 5/5 and `testCrossPlayerScanTrace` 10/10
beside it.

Mutation, both gates: 4a took `packageTimeline.ts` to **98.68%** measured alone with `liveCve.ts`
and the base-image lines at 100%, and killed five real survivors — one of which had **inverted the
80/15/5 bump weighting with every covering test still green**, a hole in an acceptance criterion
rather than a missing assertion. 4b ran 663 mutants, 57 → 45 survivors: `apt.ts` 89.90% → **91.41%**,
`dpkgStatus.ts` 82.29% → **87.91%**, `packageTimeline.ts` **98.83%**. What survives is hand-classified
— manual and usage prose, the load-time `CVE_TIMING` invariant that throws at import, the
library-install path no package reaches yet, and regex anchors and optional-chaining forms that
change nothing.

**`exploitEffect.ts`'s score did NOT climb, and slice 5 must not chase it.** Slice 3 predicted its
45 survivors would die here once `apt upgrade` widened the effect index past entry 0. They did not:
every one is `StringLiteral → ""` on a `readonly ExploitEffectKind[]` literal — a compile error
(`TS2322`) that Stryker, running no type checker in this configuration, scores as survived.
Reachability was never what kept them alive. The class is in the conventions doc's equivalent-mutant
list; do not "fix" it with a test that restates the pool table.

### Proven in the browser, and what it caught

Run headless on close-out day, one identity, the whole loop through the real terminal: crack
`VANDELAY-INDUSTRIES` → `192.168.211.38` → `apt list -u` (the nine rows above) → `apt upgrade
openssh-server` → the package leaves the list → bare `apt upgrade` (6 moved, 2 warned) → run it
again (`0 upgraded`) → `apt install metasploit` → `msfconsole 192.168.211.90 6379` against a critical
redis → **full root shell with no credential** → `apt upgrade redis` **from inside that shell**
(7.2.5 → 7.3.0) → `whoami` still answers `root` → `exit` → the same exploit answers
`[-] Exploit failed — no known vulnerability`. The offline gate refuses in apt's own words before any
of it, and `nmap -sV` of the player's own patched box reads `OpenSSH 9.7.1` with the CVE column
empty.

**Decision 19 is no longer only an argument from construction.** The session that patched the very
hole it came through kept working, in the UI, with the patch landing on the box the player was
standing on. That is the claim the two guard tests pin and the browser is where it was watched.

**It also caught the fourth face of a defect older than this slice.** `nmap -sV` of the NPC we had
just patched still advertised `Redis 7.2.5 / CVE-2026-0597580 critical`, one command before
`msfconsole` refused it — the scan and the server disagreeing about the same box, with the journal
reading `Version: 7.3.0`. The cause is the own-LAN scan's journal blindness recorded in the
conventions doc since D5: a sibling resolves from `buildRemoteHostFs`, seeded and journal-free,
while a public-IP scan is server-resolved. **Nothing in slice 4 caused it and nothing in slice 4
regressed** — the own box reads correctly, the server refuses correctly, and this slice is simply
the first thing that could move a neighbour's version. It was fixed as its own two-PR slice under
decisions 40-43 — **✅ SHIPPED v0.216.0–v0.217.0 (#500, #501)**, as-built above — with the runbook
acts as [Act 16 and Act 17](../v2/docs/e2e-shared-network-verification.md).

The honest reading of 4b's *"after the upgrade, `nmap -sV` reports the new version with no CVE"*:
**true** for the player's own box and for the server's own recomputation, **false** for a client-side
scan of an NPC they patched — the half no wire-check can see, which is exactly why the browser act
exists.

**➡️ NEXT: Phase 3 slice 5 — six more effects.** `file_read`, `dir_list`, `file_write`,
`password_reset`, `backdoor_port_open` and `script_exec`, with decision 23's third-argument grammar
that slice 3 deferred (`msfconsole` still carries `withoutScript`) — it earns its keep the moment an
effect reports instead of opening a shell. Decision 39's `apt install pkg=<version>` downgrade-only
pinning is owed to slice 5 or 6 and inherits this slice's resolver for free. Two things slice 4
hands it: a version off the timeline is now **ordinary** rather than exotic — every path that
resolves one meets them routinely and the server agrees with the client about all of them — and
`newestReleaseOn` already answers what a pin must be validated against.

### Phase 3 slice 5 — six more effects ✅ SHIPPED v0.218.0–v0.223.0 (#502–#507)

Retired here from `six-more-effects.md`, the way D3–D10, X1 and slices 1–4 each were. **Six
independent PRs sequenced to trunk, not a stack** — each cut fresh from updated `main`, each
peeling one effect off decision 31's collapse: `file_read`+`dir_list` (v0.218.0, #502),
`password_reset` (v0.219.0, #503), `backdoor_port_open` (v0.220.0, #504), `file_write`
(v0.221.0, #505), a scriptable `msfconsole` (v0.222.0, #506) and `script_exec` (v0.223.0,
#507). Every intermediate `main` stayed shippable because an un-built effect kept collapsing
to a limited shell until its own PR landed, and a refusal kept meaning exactly one thing —
**the CVE is not live on that box**.

**The roll was frozen throughout; only what an effect DOES changed.** `SERVICE_EFFECT_POOLS`
and the seeded draw were never re-rolled, so nothing already published moved.

**An effect is reachable only once a release CARRYING it has published.** This is the fact the
slice kept re-learning and the one slice 6 should start from. No package's *starting* release
rolls `password_reset` or `backdoor_port_open`, so a test reaches those only by walking the box
onto a later release through the journal, exactly as `apt upgrade` does — which is why the
wire-check pairs a door with a release rather than going looking for one. `file_write` and
`script_exec` are different: both are rolled at the versions boxes ship (snmp 5.9.4 and nginx
1.26.0 at index 0), so they needed no walk at all. Confirm reachability before writing a case;
two PRs here assumed and were wrong.

**`WORLD_EPOCH` moved twice, and both moves were forced by reachability rather than chosen.**
2026-09-01 → 2026-08-01 (day 44) in PR2 to make `password_reset` reachable, then → **2026-07-12
(day 65)** in PR6. Day 65 rather than day 61 deliberately: day 61 is the day openssh 9.8.3
publishes, and anchoring a live global constant on a publication boundary is a fragility the
plan had already avoided once. `worldClock.test.ts`'s staleness tripwire asserts `< 90` and
needed no edit either time; 25 days of runway remain.

**The account gate now answers ABOVE the refusal that requires an account at the granted tier.**
An effect aiming at a *file* needs nobody to BE — it acts AS the tier. Without this the
`file_write` hole was unreachable at all, snmp being guest-tier on root-only routers. Recorded
cost, and it is a gameplay consequence rather than a bug: a rooted player can no longer close a
`file_read` hole by deleting the account at its tier. It was never the way in.

**A backdoor's port is seeded on the CVE, so a collision is ordinary rather than exceptional.**
Every box running that release opens the same port and nothing is stored; a listener already
holding it is overwritten at the effect's tier rather than refused — refusing there would make
a bounce mean something other than "the CVE is not live on that box".

**`script_exec` runs on the CLIENT and the SERVER decides what it was allowed to have done.**
Server-side eval was rejected outright and stays rejected: `runScript` builds a real
`AsyncFunction` over player-supplied source, so firing it from the handler would execute player
JavaScript inside the Vercel function — the one thing in this repo that would not be simulated.
Instead the script runs against the target's regenerated tree, its writes are COLLECTED, and
they ride the one existing exploit fire; the server re-walks each at the granted tier through
the same `resolveWriteTarget`/`createFsView` pair `file_write` uses. A write the tier could not
make is **dropped** while the rest land, and a script that throws keeps what it already wrote —
the script had already run, so a refusal would describe a veto nobody held. No new endpoint and
no new signed action were needed: `file_write`, `password_reset` and `backdoor_port_open` all
reach `upsertPatch` with no session behind them already.

**Removing the last collapse removed the wire-check's limited-shell door with it.** Not
anticipated, and the one thing that made PR6 more than an effect. `shell_limited` is rolled in
exactly TWO places in the whole world — `openssh-server` 9.8.3 (index 6, day 61, high → user)
and `snmp` 5.11.0 (index 19, day 163, medium → guest) — and neither is a shipped version, so
once the collapse went the script's door-finder had nothing left to find and hard-exited. The
door became a **walked** one and `mintsLimitedShell` was deleted rather than extended, its only
caller gone. A walked door also cannot share the read door's box: both are ssh doors, the walk
rewrites that box's manifest, and the read section fires afterwards expecting the shipped hole.

**The blueprint's sandbox is half enforced, and this is a gap, not a closure.** §3.1.8 asks for
"sandboxed — the script cannot call system commands or reach back to localhost". The injected
context is `{ fs }` only, so no command is callable and that half is tested. But an
`AsyncFunction` walls off no browser global, so **`fetch` remains reachable** from an injected
script. Pre-existing behaviour of the script host rather than anything slice 5 introduced, and
written down here rather than marked met.

### Evidence

Final suite **4885 tests / 218 files**; `npm run typecheck`, `npm run lint` and `npm run build`
clean at v0.223.0.

`scripts/testExploitOwnLan.ts` grew with the slice and stayed live against `vercel dev` +
supabase: **26/26 → 31/31 → 36/36 → 45/45 → 45/45 (PR5 unchanged, no `api/` behaviour moved) →
52/52**. The last run is the slice's own proof: the planted file lands with user-tier terms, the
`/etc/passwd` write is dropped while the other lands, the trace names the CVE as `developer`, no
session is minted, and the read door still answers `file_read` after the walked door has run on
a different box.

Mutation ran once per PR at its readiness gate. PR3 took `exploitCreateSession.ts` to 168/173
killed with zero survivors in the changed branch; PR4 ran 473 mutants (82 → 70 survivors, 390 →
402 killed); PR5 ran 599 across three files with none of its 68 survivors in the code it added;
PR6 ran three times — **83.19% → 87.52% → 87.85%**, killed 500 → 528, no-coverage 23 → **0**,
**zero timeouts on every run** (which is what makes the number quotable rather than a measure of
machine load), ending at `worldClock.ts` 100%, `exploitCreateSession.ts` 98.51%, `msfconsole.ts`
79.03%.

**Two honesty notes kept deliberately.** PR5's `shell_limited` test and its two scripted-effect
tests are characterization, not RED-first. PR6 is more mixed still: genuinely RED-first were the
first handler test, all three adapter tests, three of four rendering tests and both
script-running tests — while handler tests two through six are characterization, because that
increment's GREEN over-implemented the write loop rather than writing the minimum, as are the
seven tests added afterwards to kill mutants. The mutation delta is what earns those their
place, not a RED they never had. **Three PR6 survivors are recorded UNRESOLVED** rather than
claimed equivalent — the `written !== undefined` branch in `currentAt` and the two ternaries
deciding whether a bare token was read and whether a script ran.

**`exploitEffect.ts`'s 45 survivors were left alone, as slice 4 instructed.** They are
`StringLiteral → ""` on a `readonly ExploitEffectKind[]` literal: compile errors Stryker scores
as survived, not unreachable code. Slice 6 should leave them alone too.

### Phase 3 slice 6 — the exploit crosses networks ✅ SHIPPED v0.224.0–v0.230.0 (#508–#514)

Retired here from `exploit-crosses-networks.md`, the way D3–D10, X1 and slices 1–5 each were.
**Seven independent PRs sequenced to trunk, not a stack** — PR1 a pure refactor lifting the reach
out from under the service check (v0.224.0, #508), then one vantage per PR so the blast radius
arrived in identifiable commits: a shared box keeps one log (v0.225.0, #509), the deep chain
(v0.226.0, #510), the access point (v0.227.0, #511), another player (v0.228.0, #512), decision
39's `apt install pkg=<version>` pinning (v0.229.0, #513), and the downgrade's trace (v0.230.0,
#514). Seven rather than the six planned: PR6's fourth criterion — the trace on another player's
box — proved to be a new signed endpoint rather than an extension of `apt.ts` and became PR7
mid-slice, which kept the pinning mechanic and the surveillance mechanic separately reviewable and
separately revertable.

**Decision 34's three deferred questions are answered once, in one shared rule.** Whose journal,
whose log, whose source IP: on a box somebody OWNS, the line lands under the owner's writer key at
an address derived server-side from the actor's verified key; on a generated host it stays the
caller's own record at the address they reported. That rule lives in `traceProvenance.ts`, shared
by the ftp and downgrade handlers rather than copied — two copies of something this consequential
is two chances to get one wrong and never notice, and getting it wrong splits one visit across two
writer keys, where the journal replays with one row winning outright and the defender reads half a
story.

**The invariant this slice was planned to CHECK was already broken, and PR2 is what closed it.**
`exploitCreateSession.ts` trusted the CLIENT-supplied `source_ip`, contradicting the shipped
cross-player rule that the address in a defender's log is the server's to derive; two players
acting on one shared box were also erasing each other's lines. The wire-check was falsified to
**2/7** by reverting the fix, and the failures were the data loss itself on the real journal —
rows collapsing, one player's lines at `+0`, an address simply missing — rather than broken
assertions. PR3 and PR4 repeated that falsification discipline (11/11 → 4/11, 12/12 → 5/12), which
is what separates a boundary guard from evidence.

**The vantage is the hop BELOW the active session, and that is not obvious.** For an action with a
target of its own — a transfer — target and vantage differ naturally. For one that happens where
the player is STANDING, a downgrade, naming the active session addresses the victim's log from the
victim's own network: the one address it can never have been. `launchVantage` exists as a named,
tested rule precisely because the first draft got this wrong. An `su` elevation needs no special
case — it pushes a session on the same machine, and the own-box bypass resolves it by the ordinary
route.

**The mutation gate found untested refusal arms for four consecutive slices, then a fifth time
inside a single PR.** PR5's new same-LAN branch had three failure arms with no test at all; its
client half then produced two more, one being the negative-fixture trap this repo's own conventions
doc already records twice — met again by the person who wrote the rule down. PR6's catch was
`pinVersion`'s write options: dropped, the manifest comes back root-only, invisible to every scan
and to `apt list -u`, so a box would look clean while sitting on an open hole. PR6 also produced a
rule worth keeping: **a new exported predicate needs tests in its OWN module's test file, or
Stryker reports it uncovered whatever else exercises it** — two reported survivors were
misattribution, proved by hand-mutating, and writing tests for them would have been chasing ghosts.
PR7 closed at **126/126, zero timeouts, zero no-coverage**, the timeout column read beside the
score because Stryker folds timeouts into kills and a loaded run therefore scores higher.

**A Path line describing one layer while the Actor line promises an end-to-end outcome leaves
everything between them unexamined.** PR5's acceptance named the player; its Path named only the
server; and `msfconsole` answered `No route to host` client-side — without a request ever leaving
the box — while the server-side door stood open behind it. Found by reading the command before
driving the browser, not by the E2E failing.

**Carried forward, recorded rather than closed.** `exploitEffect.ts`'s 45 `StringLiteral → ""`
survivors sit on a `readonly` literal and are compile errors Stryker scores as survived — slice 7
should leave them alone, as slices 4, 5 and 6 each did. `msfconsole.ts`'s 79.71% is 54 declarative
`manual` survivors over an executable half carrying 16; split at the `export const msfconsole:
Command = {` line before judging that number either way. Three PR6 survivors stand UNRESOLVED
rather than claimed equivalent. `install` and `upgrade` lines in `dpkg.log` were weighed and
deferred as scope — PR7 logs downgrades only, so the file's existence is itself the alarm.
`runScript` still reaches browser globals, unchanged by crossing networks. PR5's observed
500-vs-400 on an unsigned `{}` POST was seen answering **400** during PR7's preflight — an
observation only; nothing in this slice investigated it or claims the fix. And
`hydraCrackPublic.test.ts` failed once under full-suite load and passed 48/48 three times in
isolation; identified circumstantially, not proven, and left as a flake to watch.

**➡️ NEXT: Phase 3 slice 7 — reboot evicts.** `reboot` ends every session row on that machine
server-side, not just the rebooter's stack. Slice 6 is what makes it matter: sessions on a box now
belong to strangers, so the defender's one eviction lever has to reach rows the rebooter does not
own — while the intruder who deleted `/boot/vmlinuz` gets the last laugh. It inherits the
two-identity wire-check fixture this slice built, and **V3 closes when it lands**.

**X1 slice 1 SHIPPED at v0.206.0 (PR #487)** — a name resolves. `apt install dnsutils` installs
`nslookup` and `dig`, and a name is now accepted anywhere an address was, through ONE shared
client-side step: `core/network/resolveName.ts` — `resolveLanName` pure over `generateHomeLan`,
`resolveName` adding the fellow-occupant fallback, and `addressForTarget` the single call `ssh`,
`curl`, `nmap`, `ftp`, `nc` and `scp` each make before their existing address path. An unresolvable
name passes through unchanged, so each command reaches its own unknown-target answer — no seventh
error message, and `ssh` exits 255 there rather than 1. **`dig` shipped here rather than in slice
3** (owner's call, mid-build: installing `/usr/bin/dig` with no command behind it for two slices
would have answered `command not found` with the binary in plain sight), leaving slice 3 to add only
`@<server> axfr`. The mutation gate (313 mutants) found a real defect: the occupant fallback matched
on PRESENCE rather than the name, so a typo would have handed the player somebody else's box. One
world-generation wart surfaced and was left alone — two routers on one LAN can draw the same
`ROUTER_HOSTNAMES` name (8 of the 50 crackable networks); `nmap` already prints both, and the lookup
answers with the lower octet. Wire-check `N/A`. Proven live on SHINRA-5G: both tools `command not
found` until `apt install dnsutils`, then `nslookup warehouse-28` → `192.168.167.28`, a foreign slug
→ NXDOMAIN, and `nslookup loot-rig` resolving a real fellow player's box through the occupant
fallback.

**X1 slice 2 SHIPPED at v0.207.0 (PR #488)** — a box answers as a name server. A `dns` catalog row
at `53/tcp` with `named` runs on the rare (3%) dns-role box; a generated `named.conf` (its
`allow-transfer` line open ~3 in 4) and a zone file at `/etc/bind/zones/db.<slug>.lan` span the
WHOLE network — Layer-1 servers and infrastructure plus every deep layer, addresses included. **The
payout lands before `dig` exists**: the zone is a file, and a rooted box's files already read. Five
config templates were deleted (content the generated file replaces, not a mechanism retired), and
increment 0 was a preparatory pure refactor breaking an import cycle. Two-thirds of the name servers
sit deep, which is why the door's demo needs a pivot. Wire-check `N/A` — the zone is generated
client-side from the ESSID like every other file. Proven live on GRAD-STUDENT-WIFI: swept a cracked
network, found `53/tcp open domain` on a deep box reached through a NAT forward the player writes on
the gateway, rooted it, and read both files — the deep records agreeing with a live pivot-scan of
that segment rather than by a shared seed, and `systemctl stop named` closing the port while the
files stood.

**X1 slice 3 SHIPPED at v0.208.0 (PR #489)** — the zone transfers. `dig @<server> axfr` hands the
whole address plan over, reading the zone as its authority: a client-side round-trip that
regenerates exactly the bytes slice 2 placed on the box, gated on the `allow-transfer` line. Proven
live byte-exact on GRAD-STUDENT-WIFI's deep `ns-116`: eight records in the zone's own order —
including `portal-244` and `workstation-46` on segments never reached — with `;; XFR size: 8
records` identical to the unit test's whole-file vector; a closed Layer-1 box answering `Transfer
failed.`; and a non-DNS machine answering `no DNS service on target`. One bounded, pre-existing
finding was logged to the backlog: a Layer-1 dns box does not advertise `53/domain` in `nmap`
(home-LAN NPCs draw generic ports), but both open-transfer name servers are deep and correctly
discoverable, and `dig` is role-based regardless. Wire-check `N/A`.

**X1 SHIPPED COMPLETE at v0.209.0 (`30f6b7f1`, PR #490)** — four slices, #487–#490, and the first
door of Phase 2 (discovery). Slice 4 gave the door its trace: a zone transfer runs entirely
client-side, so the name server would otherwise learn nothing — `recordZoneTransfer` is how the
transfer leaves its mark, writing a BIND-format line to `/var/log/named.log`. The client says only
WHICH network and WHICH server; the server derives the source IP from the caller's verified key
(degrading to `unknown`, never guessing), stamps its own clock, and recomputes the verdict
(handed-over vs refused) from generation — a defender's log a visitor could author is not evidence.
It is the door's ONLY `api/` work, so it carries the door's only **wire-check (5/5 live)**: no-DNS
writes nothing, an open transfer lands the AXFR-ended line, a forged source is ignored, transfers
accrete, and a closed box logs the denial. The trace is the fifth cross-player log (scan→kern.log,
login/su→auth.log, ftp→vsftpd.log, transfer→named.log). Proven live end to end on GRAD-STUDENT-WIFI:
`dig @10.165.42.116 axfr` fired the real notify and a second transfer accreted a second line; then a
deep pivot — forward `2222` on `router01`, `hydra -p 2222` cracked the deep guest, `ssh -p 2222`
landed on `ns-116` — where `cat /var/log/named.log` rendered both accreted lines from the attacker's
own home public IP `203.71.168.235`, server-derived, oldest-first. The whole attacker/defender loop
— transfer → server-written trace → deep pivot → rooted read — runs in the shipped UI.

**X1 ✅ COMPLETE — v0.206.0–v0.209.0 (#487–#490), closed out 2026-09-08.** Fourteen locked decisions
at the grill in ["X1 — resolved scope & decisions"](#x1--resolved-scope--decisions-grill-me-2026-09-04);
the per-slice plan file was retired at close-out and the as-built lives in this record. The first
door whose world legacy could not hand over — its DNS was mission scaffolding — so the commands port
and the world behind them was designed here.

**🏁 PHASE 1 IS COMPLETE.** Every door in the locked order has shipped: web, hydra, ftp, scp,
daemons, nc, machine kinds, mysql, redis, snmp, node and the terminal itself.

**D10 slice 1 SHIPPED at v0.201.0 (`dd1cc5cf`, PR #481)** — the terminal is the player's: `clear`
empties the screen and takes the banner with it while leaving the history alone, Ctrl-L does the
same without submitting a half-typed line, `theme` switches between four palettes and remembers
the choice, and `whoami` names the session you are standing in — proven live through an `su`
elevation and an `ssh` hop onto an AP gateway. `clear` and `whoami` ship as real `/bin` binaries
rather than legacy's builtins, so `rm /bin/whoami` takes the tool away and putting it back
restores it. The stored palette is applied in an explicit boot step before `render`, and the
browser's own first-paint timing proves there is no frame of amber on the way to it. The per-slice plan file carrying its RED
table, mutation triage and recorded gap was retired at D10 close-out, as D3-D9 each were; the
durable rules it produced live in [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md).

All five slices have now shipped, and with them **Phase 1 is complete**: every door — web,
hydra, ftp, scp, daemons, nc, machine kinds, mysql, redis, snmp, node and the terminal itself.
Next is Phase 2 (discovery: DNS/`nslookup`/`dig`, then `findit.io` and networks a player was never
told about).

**D10 slice 2 SHIPPED at v0.202.0 (`dc1e294c`, PR #482)** — the card and the second window.
`author` opens a full-screen card, ESC or `q` hands the terminal back with the scrollback
untouched, and it leaves no line behind. `xterm` opens a second tab that comes up on the player's
OWN workstation as their own user — proven live from three sessions deep on an AP gateway, with the
first tab left standing exactly where it was. The flag carrying that instruction is spent as it is
read, so a reload of the fresh tab rehydrates normally; that reload is what proves it, because it
changes behaviour. `author` needed no capability at all (a `mode_change` travels the road `nano`
and `lynx` already use), so the slice added exactly one, `openTerminal`. Two of legacy's six
unpainted tokens (`link`, `avatarBorder`) arrived with the card and a third was argued down. The
slice also paid off the two-tabs-one-session-stack hazard named in the grounding, because `xterm`
is the command that makes anyone hit it. Its plan and close-out were retired with the D10 plan file; the
`env.ui.*` verdict it settled is in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §7.

**D10 slice 3 SHIPPED at v0.203.0 (`ed71cee1`, PR #484)** — the box answers questions. `find`
searches a tree by glob and `strings` reads the text inside something that is not text, and both
were already half-present: their binaries have been stamped on every machine since generation
shipped, and both were declared in `COMMAND_LIBRARY_DEPS` for the library-CVE chain, so `ls /bin`
promised two tools the prompt denied. `find` descends only where `list` succeeds — `stat` carries no
permission check, so a walk built on it would report the contents of every locked directory — and
that rule now lives in one shared `walkTree` rather than in two copies, because `grep` had the same
loop. Proven live with a file planted behind a root-only door: the same command one second apart
shows root `/root/` and `/root/notes.private`, and the user tier `/root/` alone. Planning turned up
one finding that changed the scope — **`strings /bin/ls` printed nothing on every machine**, the
stub's longest printable run being `ELF` against a four-character minimum — so decision 2 is amended
above and the stub now carries a real ELF's readable tail. Its plan and close-out were retired with the D10 plan file; the
`perTest` false-survivor rule it opened, now carrying three citations, is in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §4.

**D10 slice 4 SHIPPED at v0.204.0 (`190e7e05`, PR #485)** — permissions change hands. `chmod`
makes a permission something players hand back and forth: symbolic modes over the three tiers, `u`
resolved to the tier of the account that OWNS the node through the same `/etc/passwd` reader both
ssh auth gates use, a removal that never strips root (the walker exempts it, so the bit would only
make `ls -l` lie), authorization through `canWrite`, and no `-R`. Proven live in both directions —
`chmod go+rx /root` takes a locked directory to `drwxr-xr-x` and survives a reload, and
`chmod go-x /bin/ls` leaves the box's own user answering `bash: ls: Permission denied`, because
`availability.ts` reads each binary's own execute bit.

Planning turned up two findings that changed the scope. **A directory chmod was a silent no-op** —
`applyPatches` dropped a permissions patch for a directory that already existed, so the row was
stored, replayed and ignored, and neither `write` nor `mkdir` could express it — and **`patches.write`
re-owns a file** unless the caller names the owner, which would have transferred alice's file to root
on any chmod root ran over it. Both fixed. The first is the one place this door touched shared
client+server code, so it carries a wire-check (15/15) that fails against the pre-slice materializer
rather than the browser-only proof the other slices used.

**D10 SHIPPED COMPLETE at v0.205.0 (`bc414895`, PR #486)** — five slices, #481-#486, and with it
the last door in the locked order. Slice 5 gave the game its first protection that survives being
rooted: `gpg -c` writes `<file>.gpg` and `gpg -d` reads it back, under legacy's own codec keyed by
md5 of the passphrase, so what lands in the machine's journal is base64 to an intruder holding root
and to the server storing it alike. Proven live end to end — installed over cracked WiFi, encrypted
at a masked prompt, piped through `grep` with the passphrase on the line, still ciphertext after a
reload, and refused with `bash: gpg: Permission denied` once `chmod g-x` took its execute bit away.
The strongest beat was cross-machine: `gpg` answers `command not found` on an AP gateway until
installed THERE, and the ciphertext written on it survived a full session teardown and a fresh
`ssh`.

Five things the grill settled beyond the locked decisions. **`withoutTty` grew the function form
`withoutScript` already had for `nc`** — the need for a terminal belongs to the FORM, since
`gpg -d loot.gpg hunter2` asks nobody anything and must work in a planted backdoor shell. **The
installed binary is world-executable**, deliberately NOT porting legacy's root-only
`RESTRICTED_EXECUTE` entry: real `/usr/bin/gpg` is 0755, and the encrypt half exists so a user-tier
player can hide something from whoever roots them. An existing `<file>.gpg` is **refused rather than
overwritten**; both halves **answer instantly** where legacy paced its decrypt; and the codec stays
private to the command until the content generator needs it.

Two findings worth carrying. The mutation run measured that **`Command.availability`, `tier` and
`description` are documentation** — nothing reads them at runtime, since the gate resolves binaries
by command NAME and the install hint comes from the apt catalog. And a journal query during the
close-out found the plaintext original still sitting beside the ciphertext, which is correct by
decision but was not something the manual said; it says it now. Both are folded into
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §4/§5/§7, along with the third
`perTest` false survivor in three slices, the golden-vector rule for any ported codec, and the fact
that two players never share a WiFi neighbourhood.

**D9 SHIPPED COMPLETE at v0.200.0 (#480)** — the seventh and last door in the locked order
(ftp → daemons → nc → mysql → redis → snmp → node), across five slices
(#475-#478, #480). A player writes JavaScript on a box and it drives the machine's whole
toolset: `await nmap(gw)` returns the scan's stdout carrying `.exitCode`, the ten commands that
would lie about where the script is standing refuse, output paints as it is produced, the busy
bar names the tool actually running, a sweep keeps what it found through `fs.readFile` /
`writeFile` / `appendFile` composed against the machine rather than this client's copy, and a
script now takes `process.argv`, paces itself with `sleep(ms)`, and answers Ctrl-C with `^C`
while keeping everything it had already printed.

**The wire-check was `N/A` across all five slices**, as the grill predicted — no `api/` change
anywhere in the door. Seventeen locked decisions in total (eleven at the grill, six more at
slice 4). The plan file is deleted; the as-built lives in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §2 (the camelCase
identifier rule, now shipped fact), §4 (two sandbox/stub testing traps), §7 (the scripting
host's invariants — injection order, the interrupt rule, the guards) and §9 (the silent
interrupted redirect).
**D9 ✅ COMPLETE — v0.196.0–v0.200.0 (#475–#478, #480), closed out 2026-09-01.** Eleven locked
decisions at the grill in ["D9 — resolved scope & decisions"](#d9--resolved-scope--decisions-grill-me-2026-09-01)
plus six more at slice 4; the plan file is deleted and the durable rules live in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §2, §4, §7 and §9. The door in
full: `apt install node`, then a script the player writes in `nano` on the box drives that box's
whole toolset — every command a camelCase async function returning the stdout it would have printed,
carrying `.exitCode`; flags as a trailing object with the dashed keys already typed; refusals in the
prompt's own words for the ten commands that would move the shell somewhere the script cannot
follow; output painting as it is produced, with the busy bar naming the tool actually running;
`fs.readFile`/`writeFile`/`appendFile` composed against the MACHINE, so an append on a shared box
cannot eat a fellow occupant's edit; `process.argv` with real node numbering; `sleep(ms)` on the
abort-aware seam; and Ctrl-C that ends a run at its next await, keeps everything already printed,
and sends nothing more.

**The row's one refusal held all the way through**: programmatic auth stays refused rather than
deferred, because `env` is a per-line snapshot and a script that hopped would go on answering about
the box it left — the same class as the stale-tree write fixed at v0.172.0. That same reasoning came
back as slice 3's `readFile` defect, found in the browser after a green suite, which is what turned
the v0.172.0 reload rule into a general one: **a shell may read its own copy because it is rebuilt
per line and the player is the only editor; anything that is neither — a daemon-reachable file, or a
caller that WRITES during the line — must ask the machine.**

**It is the one Phase 1 row that was not a door** — no daemon, no port, no placement, no
cross-player half, and no `api/` change in any slice — so the wire-check was `N/A` throughout and
every close-out proof was a browser run. Two things it taught that outlive it: an injected sandbox
name colliding with a real Node global silently resolves to the HOST's under vitest (`process` was
the first, and a length assertion passed against a `node` injecting nothing), and a test that stubs
a global without restoring it makes its neighbours pass — the first test to clean up properly is the
one that appears to break them.

---

**Own-LAN scan fix ✅ COMPLETE — v0.216.0–v0.217.0 (#500, #501), closed out 2026-09-14.** Four
locked decisions (40–43) in ["Own-LAN scan fix — resolved decisions"](#own-lan-scan-fix--resolved-decisions-planning-2026-09-13);
the plan file is deleted and the durable record lives in `conventions-and-gotchas.md` §5 as a CLOSED
gotcha. Not one of the nine Phase 3 slices — a cross-cutting defect open since D5 (2026-08-22) whose
fourth face slice 4's browser run exposed.

`nmap` resolved an own-LAN scan from seeded trees while a PUBLIC-IP scan replayed the target's
journal, so one box answered two different ways depending on where the player stood. All four faces
were the same missing journal replay: a planted or closed `nc` door invisible to occupants, a
`systemctl stop` the scan ignored, an `snmpset` filter that moved the public view only, and a
patched package still advertising its old version with a live CVE.

- **S1 (#500, v0.216.0)** — `resolveSameLanScan`, mirroring `resolveInnerGatewayScan`: regenerate
  the host from the ESSID, resolve it through `resolveLanHostIdentity`, replay its journal with
  `materializeMachineFs`, gate on `canBoot`, answer its ports. Closed faces 1, 2 and 4 for NPC
  siblings. Act 16 step 14 flipped from a written-down known failure into the act's headline.
- **S2 (#501, v0.217.0)** — the `.1` gateway and face 3. The server needed **no new branch**:
  `generateHomeLan` already places the `.1` and `resolveLanHostIdentity` already seeds it from
  `buildApGatewayBaseFs`, so the entire remaining defect was that the client never asked.
  `lanHostResolver`'s last arm became unconditional, which left the client's local port reader
  reachable only for the player's own box — it collapsed to one line and `nmap.ts` stopped importing
  `scanResult`, `buildApGatewayBaseFs` and `buildRemoteHostFs` at all. Reading through `scanResult`
  at the `sameLAN` vantage closed the filter face, and **the same line closed it on siblings too**:
  `snmpset inputPort.<port>=deny` works on any box keeping a filter of its own, so a sibling's
  filter had been invisible as well. Act 17 is its browser act.

**Two decisions worth not re-litigating.** The player's OWN box stays a local read — a runtime
`sshd` no journal has heard of must still show, which is why `lanHostResolver` returns `null` for
exactly one address. And decision 43 answered itself in the code: a RANGE scan reaches only
`scanSingle`, prints no port table, and therefore never wanted a journal — the "253 journals"
batching blocker that deferred this work for three weeks never existed.

**One guarantee is doubled on purpose.** `resolveSameLanScan` passes both `vantage: 'sameLAN'` and
`resolveTargetPorts: () => []`, and either alone keeps the NAT forward table off a LAN scan — the
mutation gate proved it by flipping the vantage to `'external'` with all 140 tests still green. The
vantage is documentation and defence in depth; the stub is the operative guard. Anyone who later
passes a real resolver makes the vantage load-bearing that moment.

### Phase 3 slice 7 — reboot evicts ✅ SHIPPED v0.231.0–v0.234.0 (#515–#518)

Retired here from `reboot-evicts.md`, the way slices 1–6 each were. **V3 closes with this** — the
defender's one eviction lever now reaches every active row on the box, not just the rebooter's own
hop chain (locked decision 20, from the phase's original grill). **Four independent PRs sequenced to
trunk, not a stack**, so the blast radius arrived in identifiable commits: the machine's rows close
in one authoritative act that reports its own failure (v0.231.0, #515), a box carries a boot id and
a live shell learns it moved (v0.232.0, #516), the reboot evicts strangers and arms a shell the
moment it arrives (v0.233.0, #517), and the reboot leaves a `kern.log` trace naming who ordered it
(v0.234.0, #518). Eleven decisions numbered 52–62, grilled 2026-09-17.

**The one property that makes it safe: the closed row is the authority, the marker is only how the
terminal finds out.** A tampered client that ignores the boot-id marker gains nothing — its rows are
ended, so `resolveCrossPlayerFs` serves it the tier-3 allowlist and the L1 gate refuses its writes.
That split is what lets the player-facing half be a cheap client-side equality check instead of a
round trip per line, the same posture the conventions doc already takes for L1.

**Authorization is reused, not reinvented (decision 55).** `authorizeMachineAccess` — the own-box
suffix bypass the patch endpoints already gate on — carries it, with a root-tier requirement as
reboot's own extra (`403 not_root`). It is checked BEFORE anything moves, because a machine id
travels on every row and in every hop: an unauthorized reboot that reached the rows or left a marker
would evict the box's occupants just as effectively as one that was allowed. The AP gateway needed
no branch (decision 61) — nobody owns an access point, so only the root-session arm can carry it.

**The owner arm cannot be conditioned on a session row, and only the wire-check made that concrete.**
After the first reboot the box has zero open rows, so an authority read off the session table would
refuse the owner their own second reboot. The owner arm is the pure `isOwnWorkstation` suffix match
instead — which is also what protects the panic sequence (decision 59): a defender who runs `nmcli
disconnect` then `reboot` has no occupancy row, and an occupancy-based owner check would refuse them
exactly when they are using the tool correctly.

**The browser run earned its place by finding a defect nothing else could (PR3).** The boot id was
stamped on the first line a session RUNS, so an intruder who breaks in and waits reads the box for
the first time AFTER the reboot, records the new id as though they had always held it, and is never
evicted — and the shell they keep serves the tier-3 allowlist, so their next command answers
`command not found`, the silent tier downgrade decision 53 rejected, arriving through the back door.
Every unit test passed with the hole in place, because each types a line first to establish the
reading. Fixed by stamping in `acquireTree` the moment the client holds the box's tree; the per-line
call is the fallback. PR2's outcome was corrected in place — right about WHERE the stamp is taken,
wrong about WHEN.

**PR4's trace is unconditional and server-authored (decision 58).** Every reboot writes one
`kern.log` line naming the address it was ordered from, with no carve-out for your own box — exactly
as your own `su` shows in your own `auth.log`, and an exception would only tell an attacker which act
is invisible. The address is derived from the verified key (`crossPlayerSourceIp`), never a client
value; whose row it accretes under is resolved once — the box owner's key so several attackers' lines
pile up instead of erasing each other, the network's stable lease key for an ownerless gateway or
generated host, the caller's own key only as the last honest resort (your own box, rebooted after
`nmcli disconnect` took your occupancy row away). Written at the shutdown beat once the rows have
closed, best-effort from there: a log that cannot be written never fails a reboot whose rows are
already gone.

**The two-player browser scenario PR4 asked for could not be staged, and that is recorded rather
than worked around.** A brand-new player workstation runs no service (`nmap -sV` shows no open ports;
`hydra` answers “no such service”), and player root is uncrackable by design — the CVE arc is the
intended way onto a box that runs a service — so B can never reach A's fresh box to reboot it. What a
browser uniquely proves, that the real client materializes the line and shows it on
`cat /var/log/kern.log`, was shown single-player; the distinct-attacker address and the accretion of
two actors' lines stay the wire-check's, where two identities on two networks exist at once (PR4's
tenth section runs 29/29 live, with 26/29 and 28/29 negative controls).

**Durable rules landed in `conventions-and-gotchas.md` §7**: ending a row and ending a machine's rows
are two actions with two authorities; a session is armed against the box when it ARRIVES, not on the
first line it runs (and the test that types a line first can never see the difference); a closed row
does not close the shell on your OWN box, and that is priced rather than broken. Two follow-ups are
recorded, not fixed: the `acquireTree` mutation window that needs a two-remote-hop fixture this slice
had no other use for, and the same own-box re-pull cost the re-pull rule has refused to pay since it
was first priced.

**Out of scope, carried forward:** a bricked gateway evicting the sessions already inside it (the §9
backlog entry, with a preferred lazy-re-validation shape), session TTL/expiry (v2 sessions still
never expire — reboot is *an* answer to a stale session, not a general one), and libraries/firmware
as exploit axes (slices 8 and 9).

---

### Phase 3 slice 8 — libraries fall ✅ SHIPPED v0.235.0–v0.243.0 (#519–#527)

Retired here from `libraries-fall.md`, the way slices 1–7 each were. **This does NOT close V4** —
V4 is delivered as slices 8 and 9, and firmware is the half still standing. **Nine independent PRs
sequenced to trunk, not a stack**: `ldd` and the deletion of `libraryLinks` (v0.235.0, #519), a
carried binary running by its path (v0.236.0, #520), `apt list -u` naming each CVE and severity
(v0.237.0, #521), `--local` escalating a shell (v0.238.0, #522), every effect it can roll doing what
it does (v0.239.0, #523), the trace a real box would record (v0.240.0, #524), the cross-player server
half with its wire-check (v0.241.0, #525), the client half that reaches it (v0.242.0, #526), and the
dependency map covering the game's own toolchain (v0.243.0, #527). Eighteen decisions numbered
63–80: twelve grilled 2026-09-18 and `find-gaps`-checked the same day, three added at PR4's planning
(75–77, 2026-09-19) and three at PR6's planning (78–80, 2026-09-20).

**The property that makes the axis coherent: one map, two readers.** `libraryDeps` is the single
authority (decision 11), so what `ldd` shows a player and what `msfconsole --local` actually fires
through cannot drift apart — the recon IS the exploit surface, read twice. `metadata.libraryLinks`
was deleted rather than kept in sync, because a second copy is the only way they could disagree.

**Severity beats link order, and the seed carries no machine.** When a command links two libraries
the highest-severity live CVE wins, ties falling to link order (decision 64), so what `apt list -u`
forecasts and what `--local` lands can never contradict each other. The effect is drawn on
`(command, library, release)` and never on the box (decision 65), which is what lets recon compound:
a hole learned on one machine holds on every machine in the world sitting on that release.

**The library tier floor is a deliberate fork from the service floor, and the risk register said so
first.** `exploitEffect.ts`'s `tierForSeverity` bottoms at guest; libraries bottom at user
(decision 9), because the library route IS the privilege route and a critical-only root rate would
make the trip not worth taking. The plan named reusing the service helper as a risk before any code
was written, and the interpreter carries its own table.

**Decision 69 superseded 17, and the cost was accepted by name.** The trace is only what a real box
would record — a `kern.log` crash line on a miss, an ordinary `auth.log` session line on a shell
success, nothing else. Legacy's `/var/log/syslog` line naming command, library and tier is gone
because no real system writes it. That makes a working local exploit **quieter than `su`**, which is
the exact incentive decision 17 existed to close; it is accepted rather than patched over.

**Planning caught what the Evidence line missed, twice.** PR4 split into 4a/4b/4c (decision 75) when
planning found the traces needed `api/` work nothing had priced: `kern.log` had no client appender,
and `appendAuthLog` formatted only a `su` switch and refused any box but the caller's own. And PR6's
grill found a *recorded decision that was false* — decision 68 said an NPC's local surface stays
exactly the seventeen, while `remoteHostFs.ts` had been laying `binariesForService` onto every
generated host all along. Decision 80 amends the record rather than working around it, and the
correction is near-inert only because `su`, `nano`, `ssh`, `curl` and `scp` are base binaries
everywhere, so the seventeen already cover every library group on every box.

**Mapping a tool has two consequences that only appeared at implementation.** It turns
`wrapWithLibraryCheck` on for that tool, so removing a linked `.so` starts breaking tools a player
bought — and it wakes `installPackageLibraries`, wired into `apt install` since the
binary/availability slice as a deliberate no-op. So `rm /lib/libssl.so` followed by `apt install
nmap` puts libssl back: **hardening by deleting a library is a standing cost, not a one-off move
buying permanent immunity to a whole library's CVEs.** Accepted as designed — a tool that cannot
link is a tool that cannot start.

**Accepted gaps, named and left standing.** On an NPC box a root-tier `file_write`,
`password_reset`, backdoor or script lands at the caller's ssh-session tier and records no trace
(decision 76) — a known gap shared with `su`, whose fix is one change for both and its own slice. A
local `password_reset` leaves no clue, so a player whose root was reset has only `apt list -u` and
the `pwned-XXXX-<tier>` shape to work back from. A missing `.so` writes no crash line, so a deleted
library and a patched one are indistinguishable to the caller. An escalated `--local` shell pushes
`exploit`/`exploit_limited` and does not survive a refresh on the player's own box, where the server
stores only `su` rows.

**What slice 9 inherits.** Routers, switches and the shared AP gateway are IN this slice for the
library axis, with no carve-out — **slice 9's planning must not assume they were excluded here.**
Firmware is a second, separate way in, attaching its own per-axis interpretation to the same
axis-blind `liveCve(key, version, gameDay)` (decision 25) rather than growing a second derivation,
exactly as this slice's interpreter did. `apt list -u` already covers services, libraries and
firmware alike — one manifest, one status view. Still deliberately NOT built on this axis: a full
re-derivation of the dependency map against real Debian link sets (decision 12), and `libc` as a
modelled library, whose blast radius would be every command on every box.

---

### Phase 3 slice 9 — firmware falls ✅ SHIPPED v0.244.0–v0.247.0 (#528, #529, #531, #532)

Retired here from `firmware-falls.md`, the way slices 1–8 each were. **This is the slice that
closes V4 and the entire V-series** — the last of the nine Phase 3 slices, and the last acceptance
row before the ship gate. **Four independent PRs sequenced to trunk, not a stack**: firmware
becoming a package with its own timeline (v0.244.0, #528), the exploit tier becoming a floor so a
root-only router hands over the shell the CVE earned (v0.245.0, #529), the gateway that scans clean
falling through its firmware (v0.246.0, #531), and `snmpwalk` naming that firmware in `sysDescr`
(v0.247.0, #532). #530 between the second and third was an unrelated public-database sweep-test fix.
Ten decisions, 81–90, grilled and planned 2026-09-21; two of them — 84 and 89 — are corrections the
grill found, not choices it made.

**The axis is a third reader of one timeline, not a third timeline.** Firmware attaches its own
per-axis interpretation to the same axis-blind `liveRelease(key, version, gameDay)` (decision 25)
that the service and library axes read, exactly as slice 8's interpreter did — `firmwareExploit.ts`
sits beside `exploitEffect.ts`'s service reader and `localExploit.ts`'s library one. One manifest,
one status view: `apt list -u` already covered services, libraries and firmware alike, so the
defender's half (PR1) was mostly wiring a package the generator had stamped since slice 1a onto the
readers that had been ignoring it. `startingFirmwareVersionOf` and `FIRMWARE_PACKAGE` were retired
into the one `PACKAGE_TEMPLATES` table rather than a parallel lookup.

**Firmware answers to no port, so the resolver spots it in the manifest.** There is no dialled port
to name a router's image (decision 27 keeps it out of `nmap -sV`), so `handleExploitCreateSession`
reads the firmware straight off the box's own `/var/lib/dpkg/status` and contests it against the
service the port did name. The contest is decision 64's rule reused verbatim (decision 89): higher
severity wins, an equal severity falls to the **service**. The tie falling to the service is
load-bearing, not cosmetic — every router-class box runs `sshd` whose hole is permanently live from
the world's second fortnight on, so a firmware-first rule would mask the daemon on every box in the
world. A shared `severityRank` was extracted into `packageTimeline.ts` and `localExploit.ts` dropped
its private copy; the two per-axis tier-floor tables stayed separate, each with its own rationale.

**The tier is a floor, and that repaired a live silent gap (decision 84).** Router-class boxes carry
only root, so against the severity roll and the service floor roughly 90% of a router's live service
CVEs refused today and read exactly like "not vulnerable". PR2 made the exploit land on the lowest
account **at or above** its tier through one shared `accountAtOrAbove` resolver, replacing three
exact-tier `.find` lookups across the remote, own-box `--local` and cross-player-elevate sites. The
firmware axis then reuses the **library** floor (decision 83) — critical/high → root, medium/low →
user, never guest — because a gateway has no unprivileged half.

**One pool over all six vendors, holding all eight effects (decision 86).** Nobody picks a router's
vendor, so a per-vendor split would add variance without agency; firmware IS the device, so it is
the one pool that can legitimately hold the full effect set. The roll is seeded on the release, never
the box, so a given gateway always falls the same way — a stable identity a player can learn once and
rely on everywhere that image runs. The trace lands in the **port's** own sweep log tagged with that
daemon (decision 87) — no firmware-specific log, no new catalog row.

**A version is not a verdict (decision 88).** `walk.ts` had parked this by name — "NO VERSION is
stated anywhere" — until the game decided where a device version lives; decision 81 is that decision,
so `sysDescr` now renders the firmware display string the manifest names (`MikroTik RouterOS 7.14.2`,
`EdgeOS 2.0.9`) without becoming a second authority over it. It kills a lie by construction: the
hardcoded `Cisco IOS L3 Switch` is gone, so a switch running a non-Cisco image no longer claims to be
a Cisco, and the router/switch distinction a walk can see moves entirely to interface naming (`eth0`
vs `GigabitEthernet0/1`). `PLATFORM` collapsed to the interface namer. A box carrying no firmware — a
workstation that installed an agent of its own — answers `Linux`, the plain machine it is; every
generated router-class box carries firmware, so that fallback reaches only it. A player still learns
WHAT a device runs and must fire to find out whether it is holed, so the scan-clean-but-falls
signature survives intact.

**Accepted costs, named and left standing.** `nmap -sV` can under-forecast a router, showing the
service's severity while the firmware outranks it — always in the player's favour (decision 89). A
router's `ssh` and `snmp` pools fire less often, masked by a more severe firmware CVE. Firmware
downgrade is a free offensive move: `apt install <vendor>-firmware=<earlier release>` on a rooted
gateway pushes it back onto a holed image — a permanent door the attacker installed. And **no reboot
to flash** (decision 90): `apt upgrade` writes the manifest and the new version is live, because a
pending-version state would be a new mechanism for one package that every reader would have to learn;
the reboot-to-flash tension is worth its own later slice covering all packages, not a firmware-only
carve-out.

**What the V-series leaves the ship gate.** Three CVE axes — service, library, firmware — read from
one timeline through one axis-blind derivation, each with its own interpretation and none a second
authority. A defender patches all three with `apt upgrade` and reboots to evict. The deferred items
are recorded, not lost: reboot-to-flash as its own cross-package slice (90), and `snmpwalk`'s missing
own-box local path (D8 §9), untouched here.

---

**D8 ✅ COMPLETE — v0.185.0–v0.193.0 (#465–#473), closed out 2026-08-31.** Eleven locked decisions
in ["D8 — resolved scope & decisions"](#d8--resolved-scope--decisions-grill-me-2026-08-27); the
plan file is deleted and the durable rules live in `conventions-and-gotchas.md` §7 and §9. The door
in full: `snmpwalk <host> public` reads a device's identity and points at the community worth
cracking, `hydra <host> snmp` recovers the read-write community from the caller's own wordlist,
`snmpwalk <host> <rw>` renders the port table read from the device's own `rules.v4`/`acl.conf`, and
`snmpset` rewrites that table — a forward opened, a port filtered — all a VIEW over the files v2
already parses, with no third authority over one fact. Cross-player throughout: B reconfigures an
access point they have never stood on, reached only by the address the internet routes it by, and
the gateway's own `snmpd.log` accretes every visit — walk, set and refused guess — under the
owner's row with the attacker's server-derived source IP. The grill's headline held: the
`snmpd.conf` firewall/ACL OID parsers legacy named would have duplicated the `rules.v4`/`acl.conf`
v2 already ships, so the OIDs became a VIEW over those files — one fact, two interfaces,
nano-over-ssh and snmp-without-a-shell.

**D7's three gifts paid off exactly as predicted.** `resolveOccupantScan` made `snmpd` scannable
the day it could start, so D8 needed no scan change for discovery; `reachServiceHost`'s four
vantages carried public / same-LAN / inner-gateway / own-LAN reach for free, so the middle slices
spent their budget proving paths rather than plumbing them; and `secretOn` was the right shape for a
community string with no account. **D7's one warning bound exactly as hard as it said**: `snmpset`
writes to a box the caller holds no session on, so a gateway reconfigured by strangers stays ONE
`snmpd.log` row keyed on the TARGET, and the writer-key rule is what keeps the last write from
erasing the rest.

**Boundary 2 (the final slice) was the payoff and the sharpest law.** The scan stops advertising
what the filter hides: a filtered port goes DARK from the world — one silence with an address
bearing no network, a bricked box, a stopped daemon and a service the box fronts elsewhere — so a
wordlist cannot tell a defended port from an absent one. The terminate-vs-pass-through line fell out
of it: a gateway's INPUT filter closes its OWN ports and leaves a forward it merely passes through
alone, while the forward's TARGET filter closes it — and precedence is decided by what the box RUNS,
never by what its filter answers, so a denied port a router serves cannot re-open through somebody
else's forward. **The real AC-12 leak was found here, not at the scan**: `resolvePublicTarget`
routed on the raw pidfiles, so a stopped daemon failed as `host_unreachable` while a filtered one
routed fine and was refused as `service_not_running` — two names for one silence, an oracle. Gating
the reach on `portsOpenToNetwork` closed it.

Two things it settled that outlive it:

1. **The filter honours the scan only at the CONTRACT layer, and the same-LAN gap is wider than the
   filter.** `scanResult` reads the filter from both vantages, but the client's same-LAN scan of
   `.1` resolves a seeded `buildApGatewayBaseFs` and is journal-blind — so an `snmpset`-written deny
   or forward is visible from the PUBLIC scan and invisible from inside the LAN, exactly as a
   `systemctl stop` on the gateway already was. That belongs to the deferred `resolveSameLanScan`,
   not to D8; recorded in §9.
2. **`snmpwalk` is the one own-box door with no local path**, so a player cannot read their own agent
   over SNMP though a stranger can. Surfaced at boundary 1, recorded in §9, deferred.

**Its whole arc was run live in the UI on close-out day**, two browser sessions for the cross-player
half: install names the community once and hashes it, a walk and a hydra sweep and a read-write
walk, then `snmpset inputPort=deny` and the re-scan drops the port while the host stays up, a forward
standing when the gateway denies its public port and dying when its target denies the internal one,
and `ps` proving the daemon never stopped. The cross-player wire-check ran 15/15 live, and its checks
8/9/11 are the defender's-view proof the UI's crack-gated gateway-log read could not show by hand:
the gateway log carrying two strangers' writes and refused guesses under the owner's row. **One false
alarm the run nearly turned into a fix**: a workstation walk looked unlogged because the live session
read stale client state — the row was correct in the journal and a reload surfaced it. It is the
shipped shape of every cross-player writer (§9), not a bug.

---

**D7 ✅ COMPLETE — v0.174.0-v0.182.0 (#452-#461), closed out 2026-08-26.** Twelve locked decisions
in ["D7 — resolved scope & decisions"](#d7--resolved-scope--decisions-grill-me-2026-08-24); the
plan file is deleted and the durable rules live in `conventions-and-gotchas.md` §7 and §9. The
door in full, against one box, one hop further in, the player's own box and another player's:
`nmap` finds a store, `rediscli` opens it, a locked one refuses with `NOAUTH`,
`hydra <host> redis` recovers the password, `AUTH` spends it, `SET`/`DEL` rewrite what the store
holds while the box's own log records that somebody did — and `rediscli -p <fwd> <inner gateway>`
reaches a store on a layer no scan will ever show, with `hydra` sweeping the same box down the
same walk. The open question is answered — verbatim, normalized, capped. **The seeded-tree trap
slice 5 was expected to DECIDE about turned out to be already worked around generically**: slice
2's `reachServiceHost` carries D6's compensation for every data door, so slice 5 spent its budget
proving an untested path rather than building one — and its single real defect was a flag
DECLARATION the shell reads and no test did. **Slice 5b then closed that trap where it belongs**,
in `resolveInnerGatewayTarget` and in the scan's own walk, for `ssh`, `hydra`, both data doors and
`nmap` at once, and took the compensation back out. It shipped with FOUR player-reachable
symptoms, not the two §9 named: slice 5 found that a daemon a player moved down there is
invisible to ROUTING rather than merely to a door, and grounding 5b found the scan advertising
what the box was GENERATED running. Fixing that meant splitting a question the resolver had been
answering twice — routing names the box, each door decides liveness — which is why
`service_not_running` and `host_unreachable` now mean the same thing at every depth. The §9
backlog entry is deleted rather than narrowed, its stated condition (`testInnerGatewayReach` re-run
live) met in the same slice.

**Slice 6 then made the player's own box a target worth defending.** `apt install redis` plants
the datadir AND the conf — redis is the first catalog package to ship two data files —
`systemctl start redis` opens the port through a daemon unit the catalog had DECLARED since slice 1
and nothing had ever registered, and `rediscli 127.0.0.1` answers CLIENT-side against
`env.fs.reload()` per the v0.172.0 invariant rather than this client's copy. The store's lock
mirrors the box's own root password with no opt-out, which puts it out of a sweep's reach and
inside the reach of whoever cracks root: the harder path reaching what the easier one cannot. The
own-box vantage is not a convenience — `resolveSameLanOccupant` excludes self deliberately, so a
self-addressed reach would otherwise have fallen through to whatever the generator put at the
player's own leased octet. **Its wire-check was the first in D7 to be re-examined and recorded
`N/A`** rather than run, on four checked facts: no server-executed path changed.

**Slice 7a then pointed the door at another person's box — and changed no production code doing
it.** B opens, reads and rewrites the store on A's own machine, reached across the world through
the forward A opened on their access point, and A's store is ALWAYS locked because slice 6 mirrors
their root password onto it with no opt-out. So `hydra <A's public ip> redis` is a DEAD END between
players by design — a chosen password is out of a sweep's reach — and the real route is
`ssh guest@A` → A's root hash out of `/etc/passwd` → crack the md5 with a real external tool →
`AUTH`. The wire-check proves both directions live. **The public vantage had been generic since
slice 2 and untested since slice 2**, so RED came from MUTATING PRODUCTION, and the slice's whole
value is the witness it left behind: every row B writes lands under A's key, so a defender's box
keeps one datadir and one log however many strangers touch it, and the address in that log is
derived server-side from B's verified key rather than from anything B's client claimed.

**Slice 7b then closed the door and the gap in front of it.** The same-LAN vantage — B on A's WiFi
with no router, no NAT and no forward — needed no production change either, so the door half's RED
came from mutating production for the SECOND slice running. That is what a genuinely shared
resolver looks like from the test side: the last door built pays nothing for reach, and nothing
tells you the evidence is missing. The real work was the tool. `nmap` had been reporting a
neighbour as `Host is up.` with no port table, correctly — a generated sibling's ports come off a
filesystem keyed on the host IP, and letting a real player fall through would have reported the NPC
that octet rolled as THEIR services — but it left a store nobody could discover, on a door whose
own header says the FIND is the whole play. `resolveOccupantScan` resolves it from the occupant's
own journal, boot-gated, generic to every service, and lazily: one address, only when scanned.

Two things that slice found which its plan had not. The structural cost it named in advance —
making the client's port resolver async — turned out to be **avoidable**, because a single-IP
occupant scan returns early beside the inner-gateway branch before that resolver is built. And a
two-state resolution would have made the tool LIE: collapsing a failed round-trip into `found:
false` reports a live neighbour as down, so this seam keeps three outcomes where the public one
keeps two. The mutation gate then showed the old blank-port guard had become unreachable, and it is
removed rather than left stating a second rule where it can no longer apply.

Four things that grill settled which the row above could not have predicted:

- **Redis has no accounts, and the catalog assumed every door does.** `ServiceSpec.accountsOn` is a
  required column returning `{ username, hash }`, and a `requirepass` is neither. Faking a username
  would have reprised D6 slice 2's shipped bug — the right name against the wrong secret — so the
  contract widens with a `secretOn` sibling and the sweep line omits the login field entirely.
- ~~**A hyphen in a command name would take `node` down for every script in the game.**~~
  **WRONG — reversed 2026-08-26.** The sandbox is `new Function(...contextKeys, content)` with
  `contextKeys = Object.keys(context)`, so legacy welded the shell name to the JS parameter name.
  Deriving a camelCase identifier from the command name lifts it entirely, and v2 has not built
  `node` yet. The epic's original `redis-cli` spelling was right all along; the daemon is
  `redis-server`.
- **The plaintext `requirepass` would have shipped D2.6b through the back door.** It lands on a
  world-readable rung whose comment says "this file names neither" — so redis is split the way
  mysql already is: a public secret-free conf, and an md5 hash in the root-only datadir.
- **Legacy places redis on database boxes only, contradicting the data legacy itself generates.**
  The keys are `sess:*`, `cache:user:*`, `perms:*` — web-application state. The webserver cell is
  the correction, and it gives the web door a second follow-on: read the page, then read the
  sessions behind it.

The three things that grill settled which the row above could not have predicted:

- **A mysql session row would have handed over the whole box.** `authorizeMachineAccess` never
  looks at session kind, so a `readonly` database credential would have granted `listPatches` and
  `upsertPatch` on the target. D6 therefore mints **no session row at all** and re-validates the
  credential per statement — which also makes `kill mysqld` evict a connected player for free.
- **The flat placement rate would have drowned the role it was built for.** At `0.08` across the
  roles with no cell, more database boxes in the world would have been phones and TVs than boxes
  named `db-*`. The fix is suppression (`iot: 0`, `workstation: 0.03`), not the `database` cell.
- **The content is for believability, not missions.** Legacy's mysql was built to carry mission
  objectives; v2's carries none. The mission machinery does not port, nothing generated is loot
  that works (that stays D2.6b's postponed job, inherited by V2), and `config.site_name` links to
  the page the box actually serves so a web box's database is about its own site.

**D5b paid its debts to this row**: the `database` placement cell was waiting, and every database
box has been shipping an `[mysqld]` config naming a `datadir` that does not exist since v0.155.0 —
slice 1 is what honours it.

Run `grill-me` against each remaining row before planning, as D3/D3b/D4/D5/D5b/D6 each did.

Per slice, before any code: load `tdd`, `testing`, `mutation-testing`, `refactoring`; run full
RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR; present before starting the next. Any `api/` change
needs a `scripts/test*.ts` wire-check against `vercel dev` + supabase (`tsc` cannot see DB
columns or constraints).

**Foundations to read first**: [`cross-player-architecture.md`](../v2/docs/cross-player-architecture.md)
(§3 reachability/login, §4 authorization, §5 read filter, §8 traces) and
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1/§7.
Legacy references: `src/commands/README.md`, `src/network/README.md`,
`src/themedNetworks/README.md`.
