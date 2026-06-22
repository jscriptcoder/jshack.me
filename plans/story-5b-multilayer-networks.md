# Story 5b — Multi-layer Generated Networks (v2)

**Branch**: `feat/story-5b-multilayer-networks` (per-slice branches off `main`)
**Status**: Executing Slice 5b.1a (TDD)

> **Status: Slice 5b.1a ✅ COMPLETE (2026-06-22) — all 6 criteria. ⟵ RESUME at 5b.1b.**
> Grill-me (D1–D9) + `planning` (Slices 5b.1a → 5b.5) complete. 5b.1a built in 4 TDD increments on
> branch `feat/story-5b-multilayer-networks` (4 commits). This file is the self-contained source of truth.
>
> **5b.1a — all increments DONE (full v2 suite green @ 1681 · `tsc -b` clean · ~100% mutation, one
> documented equivalent mutant on `activeRoot`'s own-box fast-path):**
> - ✅ **Increment 1 (criteria 1 + 2)** — `generateHomeLan` emits a second router (the inner gateway)
>   via a single `pickN(count+1)` draw (structurally distinct octet); `computeInnerGatewayId(key, octet)`
>   in the `ed25519-inner-gw:` namespace; `seedInnerGatewayHostname`.
> - ✅ **Increment 2 (criterion 3)** — `buildInnerGatewayBaseFs`/`seedInnerGatewayAdminPw` (octet-seeded
>   creds, sshd:22); shared `resolveLanHostIdentity` resolver wired into `ssh.ts` + `authCreateSession`
>   → `ssh root@<inner IP>` auths against its OWN pw, lands on `computeInnerGatewayId` (non-alias proven
>   via the hash-based machine_id, not the pool-collision-prone "edge pw fails").
> - ✅ **Increment 3 (criterion 4)** — `logHostScan` uses the resolver → distinct ids + inner's own `:22`
>   in the scan trace.
> - ✅ **Increment 4 (criteria 5 + 6)** — `ownLanBaseFsForMachineId` reverse lookup in the L2 write-gate
>   (`remoteWritePermission`) + client read-back (`activeRoot`) → `nano rules.v4` persists across reload
>   (root allowed / guest 403); depth stays private (inner gateway never registered → cross-player
>   public-IP scan unchanged; all cross-player unit tests green).
>
> **As-built code anchors:** `core/generation/lanHostIdentity.ts` (resolver + reverse lookup),
> `core/generation/routerFs.ts` (`seedInnerGatewayAdminPw`/`buildInnerGatewayBaseFs`),
> `core/identity/router.ts` (`computeInnerGatewayId`), `core/generation/generateHomeLan.ts` (inner
> gateway host). Consumers: `ssh.ts`, `authCreateSession.ts`, `nmapScan.ts logHostScan`,
> `remoteWritePermission.ts`, `ui/activeRoot.ts`.
>
> **Next:** capstone 5b.1a (version bump + open PR) OR start **5b.1b** (forward through the inner
> router to a hidden Layer-2 machine) — answer Q2/Q3 first.
>
> **Open review questions (block 5b.1b, not 5b.1a):** Q1 RESOLVED — kept 5b.1a standalone.
> (2) deep-layer addressing `10.x` vs other range (decide at 5b.1b);
> (3) keep 5b.2 reachability-pivot in this story or split it out (decide when 5b.1b lands).
>
> **Deferred housekeeping:** fold the 5b reshaping back into `plans/multiplayer-crossplayer-epic.md`
> (5b absorbed the *reachability half* of deferred item #2; depth landed as per-player home playgrounds,
> D5). See "Epic reconciliation" at the bottom of this file.

## Goal

A **general multi-layer network model** for v2 — home networks now, mission/target networks later —
with **router AND switch** device types between layers (legacy had both, with real mechanical
differences), so a player can **discover and play with deep networks**. Noise machines + the full
legacy device-role catalog are explicitly **deferred**.

## Grounding (explored 2026-06-22)

### Legacy multi-layer model (`src/` at repo root — FROZEN reference)
- `src/generation/topology.ts` — `generateTopology()`; `SubnetLayer[]` (type in
  `src/generation/types.ts`): `{ subnet, gateway, gatewayType: 'router'|'switch', entryVariant,
  machines, isForwarded, natForwarding? }`. Difficulty → layer count (easy 1 / medium 2 / hard 3),
  each an isolated `/24` (e.g. `10.0.1.0/24`, `10.0.2.0/24`). Gateways dual-homed (eth0 up / eth1
  down), visible at `.1` on their LAN side.
- **Router** = NAT boundary: forwards a deeper machine's port UPWARD via iptables
  `/etc/iptables/rules.v4` (`NatForwarding` rules). SNMP variant (`snmpset` opens ports). Firmware
  vendor → CVE.
- **Switch** = ACL filter: `/etc/switch/acl.conf` deny rules (`deny tcp any <subnet> port 22`); ports
  behind it read **closed unless allowed**; does NOT forward/NAT. SNMP variant edits ACL OIDs.
- **Two NAT modes per layer**: *forwarded* (deeper ports exposed up the chain, reachable from
  outside) vs *router-first* (nothing forwarded → must compromise the gateway & pivot).
- `src/network/gatewayChain.ts` `findGatewayChainFor()` — ordered gateway chain target→border, used
  to install NAT rules across layers (the pivot/reconfig path).
- Device roles: webserver / database / fileserver / workstation / mailserver / iot / dns + router /
  switch; noise files, role configs, red herrings. **All deferred for 5b.**

### v2 current model (`v2/src/core/` — ACTIVE; the seams 5b plugs into)
- **Flat** `HomeLan { subnet, hosts: LanHost[] }`; `LanHost.kind: 'machine' | 'router'`. `.1` is the
  player's own router (`computeRouterId(ownerKey)`, distinct `ed25519-router:` namespace).
- `scanResult({ vantage: 'sameLAN'|'external', routerFs, resolveTargetPorts })` — the locked
  total function (Story 5; killed the dual-homed scar). `sameLAN` → router own ports only; `external`
  → own ∪ live forwards. `resolveTargetPorts(internalIp)` is INJECTED (server materializes the
  target + `readOpenPorts`; client passes a stub).
- Router FS: `buildRouterBaseFs(ownerKey)` (root-only, seeded admin pw, `/etc/iptables/rules.v4`,
  seeded sshd pidfile). NAT parsed from `rules.v4` (`iptablesRules.ts parseForwardRules`), never a
  registry column.
- `network_registry` (PK `public_ip`, ESSID-seeded, last-writer-wins), `home_network_occupants`
  (PK `(essid, owner_key)`, coexist). NPC siblings `buildRemoteHostFs` seeded by coordinates
  `(essid, ip)`. ssh routes cross-player only if `isPublicIp(target)`.
- **No** layers / depth / switch / router-behind-router today. One flat `/24` per ESSID.

## Locked decisions

### D1 — One general model; home generalizes onto it NOW _(Q1, 2026-06-22)_
There is ONE network abstraction. The home LAN is refactored to be a **1-layer instance** of the
general layered `Network` model (not flat/special-cased, not a separate target generator). New
multi-layer target/mission nets are deeper instances of the same model. Accepted: this reworks
shipped, live home machinery (occupancy / `network_registry` / cross-player materialize-auth-trace),
so every slice must keep that loop green (E2E + wire-checks) — but we get ONE model, no divergent
second network type (the scar the project avoids). _Risk owned by user; mitigation = walking-skeleton
slices that keep the cross-player loop passing at every step._

### D2 — Linear chain of layers; each its own `/24`; edge bears the public IP _(Q2, 2026-06-22)_
```
Network = { layers: Layer[] }              // ordered: layer 0 = edge (bears public IP) → deeper
Layer   = { subnet, gateway, gatewayKind: 'router' | 'switch', hosts: Host[] }
```
Each layer is its own `/24`. A deeper gateway is **dual-homed** (upstream interface on layer N−1's
subnet, `.1` downstream on its own subnet) — the exact addressing `scanResult(address, vantage)`
already disambiguates. Layer 0's gateway bears the **public IP**. **Home = a 1-layer Network**:
layer 0's gateway is the player's existing `.1` router on the public IP; subnet = the ESSID `/24`;
hosts = occupants + NPCs. **Linear chain** (each layer behind exactly one upstream gateway) — matches
legacy `gatewayChain`; `scanResult` recursion is a single walk up the chain. A **tree** (gateway
fan-out) is a clean later extension of `Layer[]`; out of scope for 5b.

### D3 — Switch = transparent ACL port-filter (the contrast to the router) _(Q3 + Q7, 2026-06-22)_
The router (shipped) stays the NAT device. The **switch** is its deliberate mechanical opposite, and
both compose into ONE `scanResult(address, vantage)` total function with **no merged views**:

| | **Router** (shipped) | **Switch** (new) |
|---|---|---|
| Addressing | **Translates** (NAT) — deeper machine unreachable except via a forward on the router's address | **Preserves** — deeper machine keeps its real IP, directly addressable |
| Default | **Deny** (empty `rules.v4` exposes nothing) | **Allow** (open unless a `deny` line) |
| Config | `/etc/iptables/rules.v4` `forward <pub> to <ip>:<port>` | `/etc/switch/acl.conf` `deny <port>` (legacy grammar) |
| Gate sits at | the **gateway's own address**: `scanResult(routerAddr, external) = own ∪ forwards` | the **target machine's address**: `scanResult(machine, through-switch) = machineOwn − aclDenied` |
| Open a port | root the **router**, add a forward | root the **switch**, delete a `deny` |
| Feel | hides topology (opaque; reconfigure the router) | reveals topology (transparent; lift a firewall) |

The switch is a **managed device** at its own `.1` with a seeded admin pw + sshd (attackable like the
router) — settles Q7 (managed L3, not passive L2). Default-allow + explicit denies (legacy
`acl.conf`). The gate's *location* differs (router intercepts at its own address; switch filters at
the target's), so neither merges a view — vantage + scanned address fully determine the answer.

### D4 — Reachability: routers drill via forwards, switches via a scoped reachability-pivot _(Q4, 2026-06-22)_
**Real-network truth that drove this:** reaching `host:port` needs a **route** to the IP + the port
unfiltered. A **NAT router** makes the inner subnet unroutable from outside → reach it via a forward
(DNAT on the edge IP, pivot-free) OR by getting inside. A **switch never NATs** → a host behind it is
reachable ONLY if you already have a route onto that segment, i.e. you must **stand on the segment**
(root the switch or a host on it) and `nmap` the inner range *from there*. That standing-inside **is
pivoting**. So the two device types map onto the two canonical boundary-crossings:

| Device | Get past it | Pivot? |
|---|---|---|
| **Router** (NAT) | root it, add a forward — drill from outside via the edge IP | No |
| **Switch** (ACL) | root it / a host on it, then `nmap` the inner range *from there* | **Yes** |

**Decision:** 5b **pulls in the REACHABILITY half of the deferred pivot (#2)** — while you hold an
active session on box X, `nmap`/`ssh`/connect resolve against **X's network vantage** (X's directly-
connected segment(s), and if X is a gateway its downstream layer), not home. The **source-IP-masking
half stays deferred** (traces don't yet log the hop's IP as the source). Routers stay drillable
pivot-free via cascading forwards; switches are traversed by pivoting onto/through them. v2 already
tracks the current session machine (hop chain / `sessions` table) — the vantage seam exists.
**Epic impact:** 5b absorbs reachability from deferred item #2; only source-IP masking remains in #2.

_Opened by this decision (resolve in planning / a follow-up grill): how "current vantage" is chosen
(deepest hop? explicit?); exactly which segments a box "sees"; per-hop reachability rules; whether
deeper-layer traces stay home-sourced until the masking half lands._

### D5 — Vehicle: home networks become multi-layer playgrounds (per-player NPC depth) _(Q5, 2026-06-22)_
5b's concrete vehicle is **home networks gaining optional depth** — no separate mission catalog/target
net needed; every home is a testable playground. **The player always spawns in Layer 1** (their
existing ESSID `/24`, unchanged). Behind it, **Layer 2+** hangs off a **per-player NPC inner gateway**
(a Layer-1 host whose `kind` is `'router'`/`'switch'` instead of `'machine'`), seeded per-`(pubkey,
essid)` like today's NPC siblings.

**Why it's safe (audited against shipped seams):** `assignHomeNetwork` / `network_registry` /
`home_network_occupants` are all **Layer-1 concepts → unchanged**; `generateHomeLan` / `scanResult` are
**additive** (Layer 1 untouched, deeper layers new); cross-player materialize/auth/trace are
**`machine_id`-keyed → layer-agnostic**. Deep layers are **NOT registered**, so a cross-player attacker
on your **public IP** still sees only your edge router + forwarded workstation — **depth stays private,
single-player** (matches the epic's "NOT cross-player" scope). You explore your OWN depth **from inside
Layer 1**: `ssh`/`ftp`/`nc` the inner gateway directly (it's on your LAN — no forward), then **pivot**
(D4) deeper. Ideal surface for the future `ssh`/`ftp`/`nc`/`msfconsole` practice loop.

**Caveats (accepted):** (1) octet collision between a co-occupant and your inner gateway drops the
gateway via `mergeLanOccupants` — reserve the gateway a fixed octet, or accept the low odds (deferred
DHCP-collision bucket); (2) co-occupants explore their OWN per-player deep nets — **ESSID-shared deep
nets** (co-occupants race/attack the same deep net) is a clean later extension, deferred (it would pull
depth into the cross-player surface). Missions / fixed-IP target nets reuse the same model later.

### D6 — Depth seeded per-`(pubkey, essid)`; every home gets ≥1 deep layer (1–3), knob-tunable _(Q6, 2026-06-22)_
A new seam `seedNetworkDepth(pubkey, essid)` (mirroring `seedRouterHasSsh`) returns a deterministic,
reload-stable layer count: **every home gets at least one deep layer** (so no player is playground-less)
with **1–3** deep layers for variety. The **walking skeleton pins a fixed depth** (e.g. Layer 1 + one
Layer 2) for a known first-slice shape, then opens the distribution — exactly how 5.1 pinned router-sshd
to 1.0 before generalizing.

### D8 — Deep-layer generation reuses NPC primitives + one new `buildSwitchBaseFs` _(Q8, 2026-06-22)_
- **Machines**: reuse `buildRemoteHostFs` (seeded NPC accounts + services + `/var/run/*.pid`), **1–3
  per deep layer**, seeded per-`(pubkey, essid, layer)`, `sshd` up (reachable targets). No new device
  roles / noise files (deferred).
- **Inner-gateway identity**: reuse the **coordinate-seeded** NPC scheme (`hostMachineId`-style,
  `host:<essid>:<ip>` → suffix) — deeper gateways are NPC, not key-derived. Edge router keeps
  `computeRouterId(ownerKey)` unchanged.
- **Gateway FS**: a **router** gateway reuses the `buildRouterBaseFs`/`baseFs.ts` toolkit (admin pw
  seeded by *coordinates*, not `owner_key`); a **switch** gateway = **one new `buildSwitchBaseFs`**
  (`/etc/switch/acl.conf` instead of `rules.v4`).
- **Addressing**: each deeper layer is its own `/24` in **`10.x.x.0/24`** (distinct from home's
  `192.168.X` + sibling layers; mirrors legacy `10.0.N`). Inner gateway = `.1` of its downstream `/24`,
  dual-homed onto the parent subnet.

### D9 — Vantage = head of the active hop chain; a box sees its connected segments _(Q9, 2026-06-22)_
**Routing/reachability model (reconciles D3 + D4 — consistent):**
- A **router** routes/NATs: its downstream `/24` is hidden behind NAT, reachable from upstream **only
  via a forward** (`rules.v4` DNAT). Drill the chain from the edge by rooting each router and adding a
  forward → **pivot optional** for routers.
- A **switch** does NOT expose its downstream upward: Layer N+1 is **dark from Layer N**. You must
  **pivot onto the switch** (root it — it's a reachable host on the parent `/24`) and scan its
  downstream from there; `acl.conf` then filters which downstream ports answer
  (`scanResult(host, from-switch) = own − aclDenied`; delete a `deny` to open one) → **pivot required**
  for switches. This asymmetry IS the device-type gameplay distinction.
- **Vantage is implicit** = the machine at the **head of the active hop chain** (the box your shell is
  on), from the `sessions`/connection state — NOT an explicit "scan from X" flag (matches a real
  shell; reuses v2's hop chain). A box **sees its directly-connected segment(s)**: its own layer `/24`,
  plus — if it's a gateway — its downstream `/24`. Going deeper = pivot again (ssh from the current box
  to one on the next segment).
- **`scanResult` stays the total function** — `scanResult(address, vantage)`; the injected
  `resolveTargetPorts` recurses through the same materialize+`readOpenPorts` machinery for deep targets.
  **No merged views.**
- **Deep-layer traces** reuse today's own-LAN NPC trace path (per-viewer, `hostMachineId`-keyed — deep
  machines are NPC, no `owner_key`); **source IP stays home-derived** until the deferred masking half of
  pivot lands (consistent with D4).

## Open decisions (grill queue)

_(none — core design tree resolved; remaining detail is planning-level)_

## Planning-surfaced seams (verified against shipped code, 2026-06-22)

A focused trace of the own-LAN resolution path (`nmapScan.ts logHostScan`, `ssh.ts` branches,
`remoteWritePermission.ts resolveTargetBaseFs`, `generateHomeLan.ts`, `scanResult.ts`) surfaced two
facts that shape 5b.1:

- **FREE (reuse):** both `logHostScan` and `ssh.ts` already branch on `host.kind === 'router'` →
  `buildRouterBaseFs` + `computeRouterId`, and `isOwnRouter` → `materializeRouterFs` **replays the
  journal**. So an inner gateway recognized as an own-router is sshable + has journal-backed `rules.v4`
  editing **for free** (own-LAN NPC `machine` hosts are NOT journal-backed — but the inner gateway is a
  `router`, so it dodges that gap).
- **GOTCHA (the first real seam):** `computeRouterId(key)` / `buildRouterBaseFs(key)` /
  `seedRouterAdminPw(key)` / `seedRouterHostname(key)` / `isOwnRouter(id, key)` are keyed by **player
  key alone** — exactly ONE router per player. A second router would **alias the edge router** (same
  `machine_id`, FS, creds). 5b.1a must make router identity **per-router**: a NEW
  `computeInnerGatewayId(key, octet)` (distinct namespace, e.g. `ed25519-inner-gw:<key>:<octet>`) + a
  coordinate-seeded router FS/creds, with `isOwnRouter`/`hostForMachineId` recognizing inner gateways
  by **regenerating `generateHomeLan(key, essid)`** (essid-scoped) — the EDGE `.1` id stays
  `computeRouterId(key)` (unchanged, still what `network_registry` holds → cross-player untouched).
- **Vantage-by-side (correctness):** scanning a gateway from its **WAN/upstream** side = `external`
  (forwards visible); from its **LAN/downstream** side = `sameLAN` (own only). The player on Layer 1 is
  **upstream** of the inner gateway → its Layer-1 IP scans as `external` (forwards visible — that's how
  the forward is discovered). The shipped own-LAN `.1` scan is `sameLAN` because the player sits on the
  edge router's **downstream** side. `logHostScan` must pick the vantage by which side the scanner is
  on, not "is it my LAN."

## Acceptance Criteria (story-level)

Test at the lowest level that gives confidence (vitest units for core logic; jsdom +
`@solidjs/testing-library` for UI; agent-browser E2E only for the full loop). Each slice keeps the
shipped cross-player loop green (D1).

- [ ] A multi-layer home: `nmap <home /24>` lists an **inner gateway** (router/switch) distinct from
      the `.1` edge router, with its **own** seeded creds + `machine_id` (not aliasing the edge).
- [ ] **5b.1** Reach a Layer-2 NPC by forwarding through the inner **router**: root it → `nano rules.v4`
      add a forward → `ssh …:<fwd port>` lands on the Layer-2 box.
- [ ] **5b.2** Reach a Layer-2 host by **pivoting**: `ssh` onto the inner gateway, then `nmap <L2 /24>`
      from that vantage lists Layer-2 hosts with no forward configured.
- [ ] **5b.3** A **switch** inner gateway: its downstream is **dark from upstream**; pivot onto it →
      scan downstream **ACL-filtered**; delete an `acl.conf` `deny` → the port opens.
- [ ] **5b.4** Depth is **seeded 1–3** per `(pubkey, essid)`; gateway kind (router/switch) varies;
      chains of deep layers compose; the skeleton's pin is lifted.
- [ ] **5b.5** A deep-layer scan/connect leaves an NPC trace readable on that machine.
- [ ] **Invariant (every slice):** B scanning the player's **public IP** sees ONLY the edge router +
      forwarded workstation — **never** the deep layers; the shipped `crack→connect→nmap→ssh→su→brick`
      loop is unchanged (wire-checks + agent-browser E2E green).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR (load `tdd`, `testing`, `mutation-testing`,
`refactoring` before code). Per-slice acceptance criteria are **confirmed with the human before any
code**. No story/slice/decision tags in code comments.

### Slice 5b.1a — A second, distinct, attackable router (the inner gateway) appears on your home LAN

**Value**: The player discovers a NEW attackable device on their own LAN — a journal-backed inner
router with its own credentials, distinct from the edge `.1`. Foundation for all depth.
**Path**: `generateHomeLan(key, essid)` seeds one extra Layer-1 host `kind:'router'` at a seeded octet
(pinned depth=2 for now) → `nmap <home /24>` (`handleNmapScan`/`logHostScan`) lists it with its own
`machine_id` + ports → `ssh root@<inner IP>` authenticates against its **coordinate-seeded** admin pw
→ `cat /etc/iptables/rules.v4` shows the empty default → `nano rules.v4` **persists** (journal via
`isOwnRouter`→`materializeRouterFs`). Skipped: any Layer-2 host yet (the inner router forwards nothing).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): (1) `generateHomeLan` returns an inner-gateway host
(`kind:'router'`, seeded octet ≠ self/`.1`/siblings, deterministic). (2) NEW
`computeInnerGatewayId(key, octet)` yields a `machine_id` ≠ `computeRouterId(key)` and ≠ any sibling
`hostMachineId`. (3) `ssh root@<inner IP>` succeeds with the inner gateway's **own** seeded admin pw
and FAILS with the edge router's pw (proves non-alias). (4) `nmap <home /24>` lists BOTH routers with
distinct ids; the inner gateway shows its own `:22`. (5) `nano`-editing the inner gateway's `rules.v4`
persists across reload (journal). (6) cross-player public-IP scan + the shipped loop unchanged.
**RED**: unit — `generateHomeLan` includes a deterministic `kind:'router'` non-`.1` host;
`computeInnerGatewayId` distinctness; `isOwnRouter`/`hostForMachineId` recognize the inner gateway
(essid-scoped regeneration). Likely mutants: octet-equality/boundary (`!== selfOctet`, `!== 1`),
the new namespace string, the `||` in the extended `isOwnRouter`.
**GREEN**: add the inner-gateway host to `generateHomeLan`; add `computeInnerGatewayId` + a
coordinate-seeded router-FS variant; extend `isOwnRouter`/`hostForMachineId` + the `logHostScan` /
`ssh.ts` router branches to pass the right id/FS for `.1` (edge) vs non-`.1` (inner).
**MUTATE / KILL MUTANTS / REFACTOR**: per the skills. **Done when**: criteria met, report reviewed,
human approves.

### Slice 5b.1b — Forward through the inner router to reach a hidden Layer-2 machine

**Value**: The full multi-layer payoff — the player exposes and reaches a machine on a deeper layer by
configuring NAT on the inner gateway. Proves the whole topology + addressing + cascading-forward path.
**Path**: generate Layer 2 (a `10.x.y.0/24`, one `buildRemoteHostFs` NPC with `sshd` up, seeded per
`(key, essid, layer)`) → own-LAN scan of the inner gateway uses **`external` vantage** (forwards
visible) with `resolveTargetPorts` materializing the Layer-2 host (liveness-gated) → `nano rules.v4`
add `forward 2222 to <L2 IP>:22` → `nmap <inner IP>` shows `:2222` → `ssh user@<inner IP>:2222` routes
by destination port (`machineServing`) → session on the Layer-2 NPC. Skipped: pivot (5b.2), switch.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): (1) with no forward, `nmap <inner IP>` shows only its
own `:22` and the Layer-2 host is dark. (2) after adding the forward, `nmap <inner IP>` shows `:2222`
**iff** the Layer-2 host's `:22` is live. (3) `ssh user@<inner IP>:2222` lands on the Layer-2 NPC
(auths against ITS `/etc/passwd`), not the inner gateway. (4) Layer-2 `/24` is `10.x` and distinct.
(5) cross-player public-IP scan still shows only edge + ws (deep layer invisible). (6) shipped loop green.
**RED**: unit — own-LAN inner-gateway scan uses `external` vantage; `resolveTargetPorts` liveness gate;
destination-port routing to the Layer-2 host. Likely mutants: vantage branch, the forward liveness
`find`/`=== internalPort`, the port-equality in `machineServing`.
**GREEN**: generate Layer 2; wire the inner-gateway own-LAN scan to `external` + a Layer-2 port
resolver; route `ssh <inner IP>:<port>` through the inner gateway's `machineServing`.
**MUTATE / KILL MUTANTS / REFACTOR**: per the skills. **Done when**: criteria met + a `scripts/`
wire-check + agent-browser confirm of the 5b.1 loop; human approves.

### Slice 5b.2 — Reachability-pivot: scan/connect from the box you're connected to

**Value**: The hopping playground — operate from a box you've breached (reach switch-gated layers;
realism). **Path**: vantage = head of the active hop chain (`sessions`); `nmap`/`ssh` resolve against
the current machine's network (its layer `/24`, + downstream if a gateway) instead of home. Source-IP
masking stays deferred (D4). **Required skills**: `tdd`,`testing`,`mutation-testing`,`refactoring`.
**Acceptance criteria** (confirm before code — detail when reached): after `ssh` onto the inner
gateway, `nmap <L2 /24>` from that vantage lists Layer-2 hosts with no forward; from home that scan
returns nothing; the shipped own-LAN/cross-player scans are unchanged when no hop is active.
**RED/GREEN/MUTATE/KILL/REFACTOR**: detailed at slice start. **Done when**: criteria met, human approves.

### Slice 5b.3 — Switch inner gateway: dark-from-upstream + ACL filter

**Value**: The second device type — a switch you must pivot into, gated by `acl.conf`. Depends on
5b.2. **Path**: `buildSwitchBaseFs` (sibling of the router FS, `/etc/switch/acl.conf` default-allow +
`deny` lines, seeded admin pw, sshd); `switch` as an inner-gateway kind in generation; downstream dark
from upstream; pivot onto the switch → `scanResult(host, from-switch) = own − aclDenied`; deleting a
`deny` opens the port. **Required skills**: `tdd`,`testing`,`mutation-testing`,`refactoring`.
**Acceptance criteria** (confirm before code — detail when reached): switch-gated Layer-2 is dark from
Layer 1; after pivot, downstream hosts show all ports except `acl.conf`-denied; editing `acl.conf`
to drop a deny opens that port; no forward mechanic on a switch.
**RED/GREEN/MUTATE/KILL/REFACTOR**: detailed at slice start. **Done when**: criteria met, human approves.

### Slice 5b.4 — Depth & gateway-kind variety

**Value**: Real generated variety — homes 1–3 layers deep, router/switch mix, chains compose. **Path**:
open `seedNetworkDepth(key, essid)` to 1–3; seed each layer's gateway kind; lift the skeleton's pin;
chain N gateways. **Required skills**: `tdd`,`testing`,`mutation-testing`,`refactoring`.
**Acceptance criteria** (confirm before code — detail when reached): depth seeded ≥1 per home,
deterministic, 1–3; gateway kind varies by seed; a 3-layer home is reachable end-to-end (forward +
pivot); determinism holds across reload. **Done when**: criteria met, human approves.

### Slice 5b.5 — Deep-layer traces + polish

**Value**: Recon leaves a readable trace on deep NPC machines; loose ends closed. **Path**: deep-layer
scan/connect write owner-less NPC traces (per-viewer, `hostMachineId`-keyed; source IP home-derived per
D4); reserve the inner-gateway octet against occupant collision (D5 caveat 1). **Required skills**:
`tdd`,`testing`,`mutation-testing`,`refactoring`.
**Acceptance criteria** (confirm before code — detail when reached): a deep-layer scan/connect leaves a
readable kern.log/auth.log line on the target NPC; the inner-gateway octet survives a colliding
occupant. **Done when**: criteria met, human approves.

## Pre-PR Quality Gate (every slice)

1. `mutation-testing` on changed units (≈100% on new core). 2. `refactoring` assessment.
3. `npm run typecheck` (`tsc -b`, covers `api/`+`scripts/`) + lint. 4. A `scripts/test*.ts` wire-check
for any `api/` runtime path (api/ isn't typechecked for DB-column correctness). 5. The shipped
cross-player E2E loop confirmed green before the deep-layer behavior is added.

## Epic reconciliation (to fold back into `multiplayer-crossplayer-epic.md`)

- 5b **absorbs the reachability half of deferred item #2 (pivot)** — only **source-IP masking** stays
  in #2 (D4).
- 5b's depth is **single-player / per-player NPC** (D5) — the deferred "ESSID-shared deep nets /
  cross-player depth" and "fixed-IP mission catalog" remain separate later work.
