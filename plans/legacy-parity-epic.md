# Epic: Legacy Parity (v2) — every way into a machine

> **Picking this up cold? Read "Locked decisions" then jump to "Next action" at the end.**
> Split authored 2026-07-29 (`story-splitting`), then grilled to nine locked decisions
> (`grill-me`, same day). Nothing planned yet — no slice has entered `planning`.

**Status**: split authored + grilled. **No slice started.**

**Ship gate**: **all doors + hydra + discovery + the CVE system, minus missions.** Missions are
a **post-ship epic** — the infrastructure this epic builds is what makes them cheap.

## Why this epic exists

The [multiplayer/cross-player epic](./multiplayer-crossplayer-epic.md) is **complete** — the
hard part, the part legacy never solved because of React, is done and proven live. What v2
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

**Left open**: `nc -l` backdoors, where no credential is checked and the "user" is asserted by
the pidfile. Resolve at D5's planning.

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

### 8. Door order: ftp/scp → daemons → nc → mysql → redis → snmp → node

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
  D1  web (apache2/nginx + generated pages + curl)     ← FIRST
  D2  hydra + the wordlist system (+ john)
  D3  ftp / scp
  D4  daemon control (systemctl / ps / kill)
  D5  nc connect + nc -l backdoor
  D6  mysql
  D7  rediscli
  D8  snmpwalk / snmpset
  D9  node scripting
  D10 polish (long-tail comfort commands)
PHASE 2 — DISCOVERY
  X1  DNS + nslookup / dig
  X2  findit.io + common website-bearing networks
PHASE 3 — VULNERABILITIES
  V1  service versions (dpkg + nmap -sV)
  V2  msfconsole + the vulnerability model
  V3  apt upgrade + the patch-delay timeline
  V4  libraries + ldd + msfconsole --local
────────────────────────── SHIP ──────────────────────────
POST-SHIP — MISSIONS
```

## Phase 1 — the doors

| # | Slice (actor + action + scope) | Includes | Defers | Acceptance examples |
|---|---|---|---|---|
| **D1** | **A player serves a web page and a stranger reads it** | `apache2`/`nginx` daemons (pidfile → port, root for <1024); `SERVICE_CATALOG` http row + generation placement; generated page content (legacy `pools/web.ts`); `/var/www/html` in base FSs; `curl [-i]`; the request pipeline (parse → NAT/DNS resolve → static file); `access.log` trace; `ping` folds in. **A new server handler resolves (public IP, port, path)** — `resolveCrossPlayerFs` is keyed by a `machine_id` obtained from a login, and `curl` has no login | `lynx` (own slice, fast-follow — a full overlay browser screen, UI work of a different size); `gobuster` (→ D2, needs the same `extraFiles` seam); `-X POST`; request handlers; HTTPS specifics | B `curl http://<A pub IP>` → A's page, **with no session and no credential** (tier 3 already allows it); `nmap` shows `:80` on NPC hosts running http; A reads B's hit in `/var/log/access.log` |
| **D2** | **A player cracks a credential instead of being told it** | `hydra <host> [service] [user]`; `apt install hydra` ships `passwords.txt` via `extraFiles`; the two-pool split + per-account probability in `buildRemoteHostFs`; uncrackable pool into `secrets.ts`; wordlist-as-sole-gate; server-side md5 batch matching for cross-player; `john`; hydra trace on the target's `auth.log`; **`gobuster`** — the same `extraFiles` seam ships its `dirlist.txt`, so it is built once | ftp/mysql/snmp as hydra *services* — each arrives with its door | B `hydra <NPC host> ssh` → cracks the user account → `ssh` succeeds; a low-probability NPC root cracks, most don't; a player's chosen root password never cracks; A appends a harvested password to `passwords.txt` via `nano` and a previously-failing crack now succeeds |
| **D3** | **A player moves files without a shell** | `vsftpd` daemon + catalog row + placement; `ftp <host> [user] [pw]` + FTP mode command set (`get`/`put`/`ls`/`cd`/`lls`/`lcd`/`lpwd`/`quit`); `scp`; `vsftpd.log` trace. **No content generator** — the target's FS is the content | Virtual users (`virtual_users.conf`) | B `hydra`s ftp creds → `ftp <host>` → `get` a file → `put` one the owner then sees; the session authorizes at its tier through L1/L2 exactly as ssh does (decision 2) |
| **D4** | **A defender controls what their box exposes** | `systemctl start/stop/status`; `ps`; `kill`; symmetric pidfile open/close semantics; `chmod` folds in | — | A `systemctl stop sshd` → pidfile gone → B's scan drops `:22` and ssh-via-forward `404`s; A `ps` lists what is running; A restarts it and reachability returns |
| **D5** | **A player plants a backdoor and re-enters through it** | `nc <host> <port>` → restricted NC shell (no PATH); `nc -l <port>` listener with owner metadata in the pidfile; **backdoor chain forwarding** — append a `forward` on every gateway out to the public edge and report the reachable address | Exploit-planted backdoors (Phase 3) | B (inside a host) `nc -l 4444` → forward auto-appended → B leaves, `nc <public IP> <fwd>` → lands as the listener's owner; the defender greps `rules.v4` and finds the breadcrumb |
| **D5b** | **NPC machines have a kind, and it shows** | A real role model, widening `LanHost.kind` (today `'machine' \| 'router' \| 'switch'`, `generateHomeLan.ts:31`) toward legacy's nine — webserver, database, mailserver, fileserver, iot, dns, switch, router, workstation; role-driven hostnames (today `DEVICE_TYPES` is consumer devices — `desktop-7`, `iphone-12` — and golden-locked at `homeNetwork.ts:30`); **role-weighted service placement** (a database box almost always runs mysql; a phone almost never runs nginx); role-keyed content pools, starting with the web pages D1 ships flat | Mission-specific roles (post-ship) | `nmap` a LAN and the boxes read as a *population*: `web-04` serves nginx and a corporate portal, `db-11` runs mysql, `cam-31` is an IoT box with a camera panel. A player can tell what a box probably is before touching it |
| **D6** | **A player reads a machine's database** | `mysqld` catalog row + placement; **generated schema + data** (legacy `generateDatabase.ts`, `pools/database.ts`); `mysql <host> <user> [pw]` → `mysql>` prompt (parser/formatter/executor); hydra `mysql` service | Writes/`UPDATE` — decide at planning | B `hydra <host> mysql` → creds → `SHOW TABLES` / `SELECT` returns generated data worth reading |
| **D7** | **A player reads a machine's key-value store** | `redis` catalog row + placement; generated data (`generateRedisData.ts`, `pools/redis.ts`); `rediscli <host> [pw]` → `redis>` prompt | — | B `rediscli <host>` → `KEYS *` / `GET` |
| **D8** | **A player reconfigures a device without holding a shell on it** | `snmpwalk <host> [community]` (public = basic, RW = full); `snmpset <host> <community> <oid=value>`; `snmpd.conf` firewall + ACL OID parsers → live port overrides; hydra community strings | — | B `snmpwalk` with `public` → basic info; B cracks the RW community → `snmpset firewallSSH permit` → port 22 opens **without B ever logging in** |
| **D9** | **A player automates an attack with a script** | `node <path>`; sync + async modes; `await` unwrapping async commands; programmatic auth (`ssh(…, pw)`, `await hydra(…)`); `writeFile` helper | `script_exec` as a CVE effect (Phase 3) | A writes `/root/sweep.js` chaining `hydra` + `ssh`, runs `node /root/sweep.js`, and captures results to a file |
| **D10** | **The terminal feels like legacy's** | `clear`, `theme`, `author`, `xterm`, `bash`, `whoami` — one polish slice | — | Each command behaves as legacy's did |

## Phase 2 — discovery

| # | Slice | Includes | Acceptance |
|---|---|---|---|
| **X1** | **A player resolves a name to an address** | DNS records per machine; `nslookup`; `dig` (+ `axfr` zone transfer as a recon reward) | `nslookup <domain>` → IP; `dig <server> axfr` → the zone |
| **X2** | **A player finds a network they were never told about** | `world_networks` + themed-network registry; **common networks that run websites** (the owner's shape — they are findable *because* they serve something); `findit.io` search handler over peer networks' metadata; registration/indexing | `curl "http://findit.io?q=<term>"` → ranked results → `nmap` that network → real ports. The player never learned the address out-of-band |

## Phase 3 — vulnerabilities

| # | Slice | Includes | Acceptance |
|---|---|---|---|
| **V1** | **A scanner reads what version a service runs** | `/var/lib/dpkg/status` parse/write; `serviceVersion` on the catalog + generation; version overlay; `nmap -sV` | `nmap -sV <host>` → real versions; tier-3 readable (already allowlisted) |
| **V2** | **A player breaks in with no credentials** | `Vulnerability` model + `publishedAt`/`patchDelay` timeline; `msfconsole <host> <port> [arg]`; the 8 effect kinds; `exploit`/`effect_one_shot` session kinds; **server-side effect authorization** | B finds a vulnerable version → `msfconsole` → `shell_full` with no password; a patched version refuses |
| **V3** | **A defender patches and the exploit goes inert** | `apt upgrade [svc]`; `apt install pkg=<version>`; patch-delay window (`no fix yet — ETA ~N days`); `apt list -u` | A upgrades → B's working exploit now fails; inside the delay window A is told no fix exists |
| **V4** | **A player escalates locally through a vulnerable library** | Library **versions** on the existing dep model; `ldd`; `msfconsole --local`; library + meta-package upgrade/pin/remove | B (guest) `msfconsole --local su` → root without the root password; `ldd /bin/su` shows the vulnerable lib; A upgrades to close it |

**V2 needs its own `grill-me` and sub-split before planning** — it is the largest item in the
epic by a wide margin and the only one that materially changes the security posture.

**D5b must land before D6** (placement is recommended, not locked): role-weighted placement is
what makes "find a database box" mean something, rather than a flat probability sprinkling mysql
across a LAN of phones. It also **must land before ship** — it re-rolls the generated world, and
the no-backward-compat licence sunsets at multiplayer announce. Every earlier door stays
role-agnostic, so D5b is additive to all of them: it changes which content and services get
picked, never the shape of what is stamped or how a door authorizes.

---

## Open branches (named, not yet decided)

1. **`nc -l` semantics (D5)** — a session with no credential, whose user is asserted by the
   pidfile. The one place decision 2 deliberately left open. Resolve at D5's planning.
2. ~~**Where `lynx` and `gobuster` sit**~~ — **RESOLVED 2026-07-29.** Neither rides with D1.
   `lynx` becomes its own fast-follow slice (a full overlay browser screen — legacy carried
   `LynxBrowser.tsx` + `lynx/render.ts` + `lynx/fetch.ts`). `gobuster` moves into **D2**, where
   the `apt install` → `extraFiles` seam is built once for `passwords.txt` and serves both.
3. **Exposure defaults** — derived, not decided: new services are **opt-in** for players (like
   `sshd` today) and generated onto NPC hosts via `placement`. Correct unless stated otherwise.
4. **Phase 2 contents** — the owner has a shape in mind (common networks discoverable because
   they run websites). Worth its own grilling when Phase 2 starts.
5. **Probability knob values** for the crackable/uncrackable draw — tuning, set at D2 planning.

## Parking lot

- **`john`** rides with D2 — it is the same gate (dictionary attack against your wordlist)
  applied to a stolen hash rather than a live service.
- **`techparts.io`** and further themed networks — content, not capability. Drop-ins once X2's
  registry exists.
- **Wordlist hardening** (ship md5 hashes to the client, keep plaintext server-side, make
  hydra/john server calls) — the recorded path if decision 7's accepted cost ever bites.
- **Missions** (`missions`/`accept`/`abort`/`mail` + mission network generation) — post-ship
  epic, by owner decision.

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

**D1 is in flight** — see [`d1-web-surface.md`](./d1-web-surface.md). **Slices 1–3 of 5 are
shipped** (#344 `c54caa7`, #345 `9b05f6f`, #346 `c408fb2`): a host serves a page, the player runs
their own web server, and a stranger reads a player's page across the network with no session and
no credential.

Next up is **D1 slice 4: a defender sees who fetched their page** (`/var/log/access.log`,
owner-keyed writer, server-derived source IP), on branch `feat/web-access-log`. Then **slice 4b**,
added 2026-07-30: the same log for an own-LAN fetch, including the player fetching themselves —
because an access log belongs to the server, not the network path.

Per slice, before any code: load `tdd`, `testing`, `mutation-testing`, `refactoring`; run full
RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR; present before starting the next. Any `api/` change
needs a `scripts/test*.ts` wire-check against `vercel dev` + supabase (`tsc` cannot see DB
columns or constraints).

**Foundations to read first**: [`cross-player-architecture.md`](../v2/docs/cross-player-architecture.md)
(§3 reachability/login, §4 authorization, §5 read filter, §8 traces) and
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1/§7.
Legacy references: `src/commands/README.md`, `src/network/README.md`,
`src/themedNetworks/README.md`.
