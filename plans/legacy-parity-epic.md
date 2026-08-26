# Epic: Legacy Parity (v2) — every way into a machine

> **Picking this up cold? Read "Locked decisions" then jump to "Next action" at the end.**
> Split authored 2026-07-29 (`story-splitting`), then grilled to nine locked decisions
> (`grill-me`, same day).

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
**D7 🚧 IN PROGRESS — slices 1–7a shipped (v0.174.0 #452, v0.175.0 #453, v0.176.0 #454,
v0.177.0 #455, v0.178.0 #457, v0.179.0 #458, v0.180.0 #459, v0.181.0 #460), slice 7b next** — twelve
locked decisions and a seven-slice spine in "D7 — resolved scope & decisions"; per-slice status and
as-built in `d7-redis.md`. It renames the epic's own row: the command is `rediscli`, and
`redis-cli` is unusable because `node`'s sandbox makes every command name a JS parameter.
**D5 🔍 GRILLED 2026-08-16, not yet planned** — fifteen locked decisions and a six-slice spine in
"D5 — resolved scope & decisions"; it also found that §9's `ps` defect is misdiagnosed and owns
the fix. Everything else is split-and-grilled only.

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
  D7  rediscli                                        🚧 IN PROGRESS (7 slices)
      D7 slice 1 a box runs a key-value store         ✔ SHIPPED v0.174.0 (#452)
      D7 slice 2 a player opens an unlocked store     ✔ SHIPPED v0.175.0 (#453)
      D7 slice 3 a player cracks a locked store       ✔ SHIPPED v0.176.0 (#454)
      D7 slice 4 a player changes a store             ✔ SHIPPED v0.177.0 (#455)
      D7 slice 5 a store on a deep layer answers      ✔ SHIPPED v0.178.0 (#457)
      D7 slice 5b a deep box's own journal is read    ✔ SHIPPED v0.179.0 (#458)
      D7 slice 6 a player runs their own store        ✔ SHIPPED v0.180.0 (#459)
      D7 slice 7a a player reaches another's store    ✔ SHIPPED v0.181.0 (#460)
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
| **D7** 🔍 | **A player reads a machine's key-value store** — **GRILLED 2026-08-24**, twelve locked decisions and a seven-slice spine in ["D7 — resolved scope & decisions"](#d7--resolved-scope--decisions-grill-me-2026-08-24) | `redis` catalog row + placement (flat 0.05, webserver 0.35, database 0.3); generated data (`generateRedisData.ts`, `pools/redis.ts`); `rediscli <host> [pw]` → `redis>` sub-shell, seven verbs; `requirepass` as an md5 in the root-only datadir; hydra `redis` service against the 60% that are locked | Redis 6 ACLs (they arrive as a VERSION difference in Phase 3, not as a door decision); `FLUSHALL`; `CONFIG GET`; `TYPE`/`SCAN`/`INFO` | B `rediscli <host>` → `KEYS *` / `GET` on the 40% that are open; `hydra <host> redis` → password (no login field) on the rest; an open store's arrival line is the defender's whole view |
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
epic by a wide margin and the only one that materially changes the security posture. **It also
inherits D2.6b's postponed job**: a `password_reset`-shaped effect is now the route by which a
player obtains a plaintext they did not already hold, so V2's split must produce one or the
wordlist progression stays inert. See "Next action" for why `/etc/passwd` does not count.

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

- **The catalog holds three services.** `ssh`, `http`, `ftp`. `mysql` is D6, `redis` D7, `snmp` D8.
  A role whose signature service has not shipped is a name, a weighting and a config file until it
  does. This is why decision 1 carries a cost rather than avoiding one.
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

- **`rediscli` can never become `redis-cli`.** `node`'s sandbox is
  `new Function(...contextKeys, content)` (`src/commands/node.ts:171,174,208`) — every command name
  becomes a formal PARAMETER of one function, so a single hyphen is a `SyntaxError` that takes
  `node` down for **every script in the game**, not merely that one command. Legacy already met
  this constraint; nothing in v2's ~40-command registry carries a hyphen. **This binds every future
  command name, not just redis's** — which is why the daemon is `redis` and not `redis-server`.
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
workstation name). What remains open is the one that is a product decision rather than a bug — a
neighbour's open ports are invisible to `nmap`, so nothing tells a player their neighbour runs a
database and they have to guess the service and let `hydra` find it. **A door is not proven by its
wire-checks alone** — the wire-checks were 20/20 green and could not see any of this, because the
defects live in the one vantage no endpoint answers.

**➡️ NEXT: D7 — `rediscli`**, fifth door in the locked order. **GRILLED 2026-08-24 — twelve
locked decisions and a seven-slice spine in
["D7 — resolved scope & decisions"](#d7--resolved-scope--decisions-grill-me-2026-08-24).**
**PLANNED 2026-08-24 in [`d7-redis.md`](d7-redis.md)**, where the per-slice status and as-built
live. **Slices 1–7a shipped (v0.174.0 #452, v0.175.0 #453, v0.176.0 #454, v0.177.0 #455,
v0.178.0 #457, v0.179.0 #458, v0.180.0 #459, v0.181.0 #460)** — the door is complete against one
box, one hop further in, and the player's own box:
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

➡️ **Next: slice 7b — a neighbour's store, and the tool that could not see it.** The same-LAN
vantage on both redis doors, plus the fix §9 item 2 parked and named the trigger for: `nmap` blanks
a fellow occupant's port table, so a neighbour's store is a door onto a box you have to guess is
there. The fix is server-side and GENERIC — whatever A is actually running, not redis-shaped —
because one tool must not answer by two rules depending on which service was named. It closes D7.

Four things that grill settled which the row above could not have predicted:

- **Redis has no accounts, and the catalog assumed every door does.** `ServiceSpec.accountsOn` is a
  required column returning `{ username, hash }`, and a `requirepass` is neither. Faking a username
  would have reprised D6 slice 2's shipped bug — the right name against the wrong secret — so the
  contract widens with a `secretOn` sibling and the sweep line omits the login field entirely.
- **A hyphen in a command name would take `node` down for every script in the game.** Its sandbox is
  `new Function(...contextKeys, content)`, so command names are formal PARAMETERS. That is why the
  daemon is `redis` and not `redis-server`, why `rediscli` can never be "fixed" to `redis-cli`, and
  it now binds every future command name. **This is the row's own name being wrong** — the epic has
  said `redis-cli` since it was written.
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
