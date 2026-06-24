# Story 5b — Multi-layer Generated Networks (v2)

**Branch**: per-slice branches off `main` (5b.1a + 5b.1b-i + 5b.1b-ii + 5b.2 + 5b.3a + 5b.3b + 5b.4a + 5b.4b all merged)
**Status**: 5b.1a ✅ (#307). 5b.1b-i ✅ (#308, v0.73.0). 5b.1b-ii ✅ (#309, v0.74.0). 5b.2 ✅ (#310, v0.75.0). 5b.3a ✅ (#311, v0.76.0). 5b.3b ✅ (#312, v0.77.0). 5b.4 (CHAINS) sub-split a/b/c/d — **5b.4a ✅ (#313, v0.78.0); 5b.4b ✅ (#314, v0.79.0)**; next = **5b.4c (variable depth `seedNetworkDepth` 1–3)**.

> **Status: Slice 5b.4b ✅ MERGED (#314, v0.79.0, squash `a95d13b`). NEXT = Slice 5b.4c. ⟵
> RESUME: start **5b.4c** on a fresh branch off `main`. The grilled design tree (D-chain-1..4) + the four
> sub-slices are in the **"Slice 5b.4" section below** — READ IT. The 5b.4b as-built dossier (the seams 5b.4c
> generalizes) is just below. Present 5b.4c's detailed AC for confirmation, then RED.**
>
> **5b.4 GRILLED DECISIONS (2026-06-24 — the open points, now RESOLVED):**
> - **D-chain-1 (topology):** Layer 1 untouched; the chain hangs BEHIND the inner router; 4a chains the inner
>   router only (switch joins in 4d). NOT a flat `SubnetLayer[]` reshape.
> - **D-chain-2 (keying + identity):** a layer's `/24` is keyed by the gateway that FRONTS it —
>   `deep-layer-${frontingGatewayMachineId}-${essid}`. The kind-based `deepLayerIndexForGateway` is REPLACED by
>   deriving the layer off the gateway's `machine_id`. Deep-gateway id = `computeDeepGatewayId(key,
>   parentMachineId, octet)` (`ed25519-deep-gw:` namespace). Existing inner-router L2 / switch L3 RE-KEY —
>   mechanical (tests recompute via `generateDeepLayer`; only literal is `10.9.9.9`, a dead forward). Both
>   server gates drop hardcoded `DEEP_LAYER_INDEX`, key off the gateway `machine_id` they already resolve.
> - **D-chain-3 (reachability):** forward to REACH the next gateway, pivot to SCAN behind it (matches AC's
>   "forward + pivot"). NO new `ssh-from-pivot` (stays deferred). Reach the L2 child gateway via a NAT forward
>   on the L1 router (5b.1b-ii, extended to recognize a deep *gateway* target); pivot-nmap L3 from there.
> - **D-chain-4 (privacy):** depth stays single-player/private — deep layers unregistered, gates own-keyed; a
>   cross-player public-IP scan still sees ONLY the edge router + forwarded workstation (D5).
> - **Sub-split:** 4a generate+discover child gateway · 4b forward-reach it + scan L3 · 4c `seedNetworkDepth`
>   1–3 · 4d per-layer gateway kind. Full per-slice AC in the "Slice 5b.4" section.
>
> **5b.4b AS-BUILT (shipped #314, v0.79.0 — the seams 5b.4c GENERALIZES):**
> - **Reach the child gateway DONE.** `resolveAuthTarget` (`authCreateSessionInnerGateway.ts`) routes a forward
>   to `deep.childGateway.ip` → auth against the child's admin pw, land the session on its `computeDeepGatewayId`
>   id. `buildDeepLayerPortResolver` surfaces the child forward in the upstream scan. Both consume the new shared
>   **`resolveDeepGatewayIdentity(key, parentMachineId, childIp) → {machineId, baseFs}`** (`lanHostIdentity.ts`)
>   — the ONE place the child octet→id+FS mapping lives (reach + scan + pivot share it).
> - **Terminal pin = `generateDeepLayer`'s `hangsChild` option** (default `true`; the NPC is drawn from the same
>   PRNG stream regardless, so flipping a layer terminal never re-rolls its host). A layer fronted by a router
>   hangs a child UNLESS `hangsChild:false`. **5b.4b hardcodes the cap at 3 layers** (≡ `seedNetworkDepth = 2`):
>   an L1-inner-fronted layer hangs a child (default), a deep-gateway-fronted layer is terminal (pivot passes
>   `hangsChild:false`). **5b.4c replaces this binary with depth-vs-position.**
> - **`innerGatewayForMachineId` → `pivotVantageForMachineId`** (`lanHostIdentity.ts`) returns
>   `PivotVantage{machineId,kind,hangsChild}`: matches an L1 inner gateway (hangsChild true) OR a DEEP child
>   gateway one layer down (regenerate each inner router's L2, match `childGateway`'s id; hangsChild false). The
>   vantage keys the deep layer off the SESSION's own machine_id. **Searches only L1 + direct L2 children today —
>   5b.4c widens this to a bounded walk up to `seedNetworkDepth`.** `nmap.ts resolveDeepPivotScan` takes the
>   vantage; DRYs the child FS through `resolveDeepGatewayIdentity`.
> - **Loop live:** `ssh root@<inner>:<fwd>` → session on the child gateway; from there `nmap <L3 /24>` lists the
>   terminal NPC; from L1/home the L3 `/24` is out of range. Wire-check `scripts/testInnerGatewayReach.ts` **8/8**
>   (added the child reach: lands on a `deep-gw-…` id, distinct from gateway + NPC).
> - Mutation: `lanHostIdentity.ts` + `generateDeepLayer.ts` **100%**; survivors are documented equivalents (TS
>   null-narrowing on the unreachable switch-forward path; the child-vs-NPC port branch — both serve exactly
>   `:22`, invisible to a PORT scan, killed in the reach AUTH instead).
>
> **5b.4c PICKUP (variable depth 1–3):** generalize the hardcoded 3-layer cap into a seeded depth.
> - **(1)** new `seedNetworkDepth(key, essid) → 1..3` (deterministic, reload-stable). Semantics from the AC:
>   depth 1 = inner router's L2 is TERMINAL (no child); depth 2 = TODAY (L2 hangs a child, L3 terminal); depth 3
>   = L2 + L3 each hang a child, L4 terminal. So "does the layer fronted by gateway G hang a child?" =
>   `G.position < seedNetworkDepth` (inner router = position 1 fronting L2; an L2 child gw = position 2 fronting
>   L3; …).
> - **(2)** the three `generateDeepLayer` callers must pass `hangsChild` = `(frontingPosition < depth)` instead
>   of the current constants: `resolveAuthTarget` + `buildDeepLayerPortResolver` (inner router = position 1) and
>   `resolveDeepPivotScan` (position from the vantage). The fronting gateway's POSITION must be recoverable —
>   `computeDeepGatewayId(key, parentMid, octet)` chains parent ids, so walking from the L1 inner gateway down
>   recovers it.
> - **(3)** `pivotVantageForMachineId`'s search: today a 2-level (L1 + direct child) lookup → make it a bounded
>   walk that descends up to `seedNetworkDepth` layers, tagging each matched vantage with its position so it sets
>   `hangsChild` correctly. A depth-1 home: the inner router fronts a terminal L2 (no child) → no deeper vantage.
> - **(4)** server gates derive depth from `(key, essid)` (own-keyed, private). Needs a new/extended wire-check
>   (a depth-3 chain reachable end-to-end through TWO forwards). Open question to settle at slice start: the
>   position/depth recovery shape — a small `chainPositionForMachineId` walk vs. threading position through the
>   vantage — grill it before RED.
>
> **5b.3b AS-BUILT (shipped #312 — NOTE: `deepLayerIndexForGateway` below was REMOVED by 5b.4a's re-key; the
> rest still stands):**
> - ~~`deepLayerIndexForGateway`~~ — REMOVED in 5b.4a; the deep layer is now keyed by the fronting gateway's
>   `machine_id` (see the 5b.4a as-built above), not a kind→index map.
> - `innerGatewayForMachineId` (`lanHostIdentity.ts`) widened ROUTER-ONLY → `isInnerGateway(candidate)` (router
>   OR switch); the caller reads the matched host's `.kind` to pick the segment. Both router + switch are pivot
>   vantages now. **(5b.4b extends this to also match a DEEP gateway by `machine_id`.)**
> - `resolveDeepPivotScan(env, essid, rawTarget, gateway)` (`nmap.ts`) takes the matched gateway, keys the deep
>   layer off its `machine_id`, and for a `kind==='switch'` vantage subtracts
>   `parseAclDenies(readAclConf(env.fs.root()))` from the deep host ports. env.fs = journal-replayed switch
>   tree, so deleting the `deny` line via `nano` re-opens the port on the next scan (edit-to-open free). Router
>   pivot forwards rather than filters → unchanged.
> - The old `'does NOT pivot from a SWITCH'` guard was rewritten into the disjoint-segment pair (switch sees its
>   OWN index-3 layer not the router's index-2, and vice-versa). Client-side only, no new `api/`.
> - Mutation 100% on the changed units (`deepLayerIndexForGateway` / `innerGatewayForMachineId` / the ACL
>   filter); ONE documented-equivalent (`nmap.ts:202` `gateway.kind==='switch'` → `true`: a router's FS never
>   has `/etc/switch/acl.conf`, so the filter is a no-op for routers). Pre-existing survivors outside scope:
>   `generateDeepLayer.ts` `FORCE_SSHD_PATCH` (5b.1b-i) + `nmap.ts` `wlan0` online-guard.
>
> **5b.3a AS-BUILT (shipped #311 — still load-bearing):**
> - `LanHostKind = 'machine' | 'router' | 'switch'`. `generateHomeLan` seeds ONE `kind:'switch'` host, drawn
>   LAST from the octets the gateway+sibling `pickN` draw left behind (`taken` Set → `pickN(remaining, 1)`) —
>   NOT `pickN(count+2)`. WHY: `pickN(count+2)` consumes one extra `next()` BEFORE the `prng.pick(DEVICE_TYPES)`
>   sibling-name draws, shifting the sibling HOSTNAMES (octets stay, names churn). Leftover-draw keeps the
>   stream byte-stable. Golden switch for `('a'*64, BEAN-THERE-WIFI)` = **`.80` `vpn-gw`**. **5b.4 reshapes this
>   single-switch seeding into a seeded chain — watch the same byte-stability constraint on the draw stream.**
> - `buildGatewayBaseFs(identity, configEntries)` in `routerFs.ts` — shared root-only gateway skeleton.
>   `buildRouterBaseFsFromIdentity` + `buildSwitchBaseFs(key, octet)` build from it (switch swaps
>   `etc/iptables/rules.v4` → `etc/switch/acl.conf`, seeded `ACL_CONF_SEED` = default-allow header + `deny 8080`,
>   root-only perms `GATEWAY_CONFIG_PERMISSIONS`).
> - `core/network/switchAcl.ts`: `readAclConf(fs)` + `parseAclDenies(content)` (grammar `deny <port>`, lenient,
>   out-of-range rejected; `parseDenyLine` is the single validity gate — no redundant pre-`.filter`).
> - `lanHostIdentity.ts`: `isInnerGateway = (kind==='router'||kind==='switch') && octet!==1`;
>   `machineIdForLanHost`/`baseFsForLanHost` route a switch → `computeInnerGatewayId`/`buildSwitchBaseFs`. So
>   ssh-to-switch:22, server auth, upstream scan (own `:22` only, dark FREE), and `nano acl.conf` persist all
>   work for the switch with no further code.
> **5b.2 as-built (2 commits, full v2 suite green @ 1752, `tsc -b` + lint clean, 100% mutation on the new
> pivot code + `lanHostIdentity.ts`):** `e05236d` feat — `core/generation/lanHostIdentity.ts`
> `innerGatewayForMachineId` (machine_id-keyed reverse lookup: is the active session sitting on an inner
> gateway?) + `core/commands/nmap.ts` `resolveDeepPivotScan` and a vantage-gated branch before the home
> path (`pivotGateway !== null` → scan the deep `/24` via the existing
> `parseScanTarget`/`hostsInScanTarget`/`scanRange`/`scanSingle` machinery, deep host ports from
> `readOpenPorts(buildDeepHostFs(...))`; a non-deep target falls through so the upstream home segment stays
> visible from the gateway too) · `4de045a` v0.75.0. **Resolved CLIENT-side** — deep hosts are deterministic
> NPCs with no journal, so the pivot needs no server round-trip / no new `api/` action (unlike the 5b.1b
> forward-scan, whose forward lived on the gateway's journal). No deep-layer trace yet (the pivot scan
> records no kern.log — deferred to 5b.5). 8 behavioral tests through `nmap.execute` (helper distinctness
> proven behaviorally: edge-`.1` + sibling vantages don't pivot). No wire-check (no `api/` path); the
> shipped cross-player loop is untouched by construction.
>
> **5b.1b-ii as-built (4 commits on branch, full v2 suite green @ 1744, `tsc -b` clean, ~100% mutation on
> changed core w/ documented equivalents):** `72b83f7` server gate
> (`core/sessions/authCreateSessionInnerGateway.ts` — own-keyed, regenerate+`canBoot`+`machineServing`
> route: forward arm → deep host auth/session, router arm → gateway, none → 404; NO trace; extracts shared
> `isInnerGateway`/`innerGatewayAt` onto `lanHostIdentity`, `resolveInnerGatewayScan` now consumes it) ·
> `09f202f` seam+wiring (`SshApi.authenticateInnerGateway`+`InnerGatewayAuthParams`;
> `authCreateServerSessionInnerGateway` adapter; `api/sessions` action branch; env/state wiring + factory
> default) · `1c53edf` client (`ssh.ts` `executeForwardLogin` + `isInnerGateway(host) && port !== runningPort`
> routing branch — reachability via `env.scan.resolveInnerGateway`, auth via `authenticateInnerGateway`,
> lands on the deep host id; port 22 stays the own-LAN path; `nmap` now shares `isInnerGateway`) · capstone
> (wire-check `scripts/testInnerGatewayReach.ts` 6/6, v0.74.0). **Equivalent mutants (documented):** the
> `none`-arm type-narrowing guard (×3 — removing it is runtime-identical, the forward arm's
> `internalIp !== deep.host.ip` catches `undefined`); `.some`→`.every` on the deep-host port liveness
> (coincide on the single-element port array — the catalog holds only `ssh`; killable once it grows);
> `account === null ||` (subsumed by `!passwordOk`, same shape as `authCreateSessionPublic`); the
> `prompt({message,masked})` call args in `executeForwardLogin` (same equivalent class as the two sibling
> remote-login fns — UI-layer concern). **E2E note:** the live wire-check drives the REAL `/api/sessions` +
> `/api/patches` runtime end-to-end (forward→reach-deep-host · wrong-pw→401 · no-forward→404 · port-22→
> gateway · brick→404); a separate agent-browser E2E would duplicate unit + wire coverage with NO
> browser-only behavior (the nano/terminal/prompt flow is unchanged from shipped) — per `feedback_e2e_scope`,
> the wire-check is the integration proof for this slice.
>
> **5b.1b-i as-built (MERGED #308, v0.73.0):** `core/generation/generateDeepLayer.ts`
> (`generateDeepLayer`/`buildDeepHostFs`/`DEEP_LAYER_INDEX`=2) · `core/scan/deepLayerPortResolver.ts` ·
> `core/scan/resolveInnerGatewayScan.ts` (server `external`-vantage scan) · `nmap.ts` `scanInnerGateway` +
> single-IP dispatch · `ScanApi.resolveInnerGateway` seam/adapter/`api/network` branch · wire-check
> `scripts/testInnerGatewayScan.ts` 5/5.

> **Status (prior): Slice 5b.1a ✅ MERGED — #307, v0.72.0 (2026-06-22), all 6 criteria.**
> Grill-me (D1–D9) + `planning` (Slices 5b.1a → 5b.5) complete. 5b.1a shipped via #307 (squash-merged to
> `main`, branch deleted). This file is the self-contained source of truth; pick up at **5b.1b** below.
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
> **Next action (resume here):** start **Slice 5b.1b-i** (Expose — scanning the inner gateway reveals a
> journaled NAT forward to a hidden Layer-2 machine; full spec in the Slices section below). Cut a fresh
> branch off `main`, confirm 5b.1b-i's acceptance criteria, begin RED. 5b.1b-i reuses everything 5b.1a
> built (the `lanHostIdentity` resolver, `buildInnerGatewayBaseFs`, the inner gateway's journal-backed
> `rules.v4`) — it adds Layer-2 generation + a SERVER-resolved `external`-vantage scan of the inner
> gateway with forward liveness. 5b.1b-ii (Reach) then routes `ssh user@<inner>:<fwd port>` via
> `machineServing` onto the Layer-2 box.
>
> **Why the server-resolved scan (the load-bearing design fact):** the forward the player adds via
> `nano rules.v4` persists ONLY to the inner gateway's `machine_id` journal in the DB; `nmap`/`ssh` run
> from the player's OWN workstation, and the client has NO seam to fetch a non-active machine's journal
> (`env.remote.listPatches` is an unexercised stub; `activeRoot` replays only the ACTIVE box). So the
> inner-gateway scan + the forward-routed ssh resolve SERVER-side, mirroring the shipped public-IP path
> (`handleResolvePublicScan` + `machineServing` + `buildWorkstationPortResolver`). This is also why each
> sub-slice needs a `scripts/` wire-check (new `api/` action).
>
> **Open review questions — ALL RESOLVED (2026-06-23):** Q1 — kept 5b.1a standalone. **Q2 — deep-layer
> `/24` = `10.<a>.<b>.0/24` seeded per `(key, essid, layer)`** (reload-stable, varied per player, cleanly
> distinct from the home `192.168.<x>` `/24`; inner gateway is `.1` of it, dual-homed; L2 NPC at a seeded
> octet). **Q3 — 5b.2 reachability-pivot STAYS in this story** (next slice after 5b.1b lands; reassess
> splitting the switch + pivot into their own plan only if this story gets unwieldy).
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

### D10 — Switch lands as a 2nd pinned inner gateway; client-side ACL pivot _(planning, confirmed 2026-06-23)_
Settles the planning-level choices D3/D4 left open, for the SKELETON:
- **Placement:** the switch is a SECOND pinned inner gateway alongside the router (additive — every shipped
  router test/golden LAN intact). Gateway-kind/depth VARIETY (random kind, 1–3 depth, chains) stays in 5b.4.
- **Identity/creds:** REUSE the octet-keyed inner-gateway scheme (`computeInnerGatewayId` /
  `seedInnerGatewayAdminPw` / `seedInnerGatewayHostname`); the switch's distinct octet disambiguates it from
  the router. No new id namespace. Only new primitive: `buildSwitchBaseFs` + `acl.conf` seed/parser.
- **`isInnerGateway`** widens to `(kind==='router'||kind==='switch') && octet!==1` so the switch inherits the
  ssh / journal / L2-write paths; the cross-player `registry.kind==='router'` checks are NOT widened (depth
  is private, the switch is never registered).
- **Dark-from-upstream is structural:** a switch has no `rules.v4`, so the existing `external`-vantage
  upstream scan yields own-ports-only with no new code.
- **ACL pivot is CLIENT-side:** when pivoted onto the switch, `env.fs.root()` is the switch's
  journal-materialized tree, so the 5b.3b downstream scan reads `acl.conf` off `env.fs` (edit-to-open free).
- **`acl.conf`:** `/etc/switch/acl.conf`, root-only perms, default-ALLOW + explicit `deny <port>` lines
  (legacy grammar simplified to a bare port); seeded with one active `deny`. Parser `parseAclDenies`.
- **Generation order (golden-LAN safety):** APPEND the switch as the LAST `pickN` draw (`drawn[count+1]`) so
  the inner-router + sibling octets stay byte-identical (`pickN` is sequential — proven).

## Open decisions (grill queue)

_(none — core design tree resolved; remaining detail is planning-level. 5b.3 plan confirmed 2026-06-23.)_

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

- [x] A multi-layer home: `nmap <home /24>` lists an **inner gateway** (router/switch) distinct from
      the `.1` edge router, with its **own** seeded creds + `machine_id` (not aliasing the edge). _(5b.1a)_
- [x] **5b.1b-i (Expose)** Root the inner **router** → `nano rules.v4` add a forward → `nmap <inner IP>`
      surfaces the forwarded port (server-resolved `external` vantage, L2-liveness-gated). _(v0.73.0)_
- [x] **5b.1b-ii (Reach)** `ssh …:<fwd port>` routes through the inner gateway's `machineServing` and
      lands a session on the Layer-2 box (auth against its own `/etc/passwd`). _(v0.74.0)_
- [x] **5b.2** Reach a Layer-2 host by **pivoting**: `ssh` onto the inner gateway, then `nmap <L2 /24>`
      from that vantage lists Layer-2 hosts with no forward configured. _(v0.75.0)_
- [x] **5b.3a** A **switch** inner gateway appears, is attackable on its own creds/`machine_id`, and is
      **dark from upstream** (`nmap <switch>` → own `:22` only); `acl.conf` seeded + editable. _(v0.76.0)_
- [x] **5b.3b** Pivot onto the switch → scan its downstream **ACL-filtered**; delete an `acl.conf` `deny`
      → the port opens on the next pivot scan. _(v0.77.0)_
- [ ] **5b.4 (CHAINS — sub-split a/b/c/d, grilled 2026-06-24)** Linear chains L1→L2→L3, depth **seeded 1–3**;
      a layer is keyed by its fronting gateway's `machine_id`; forward-to-reach + pivot-to-scan; depth private.
  - [x] **5b.4a** Deep layers re-keyed by fronting-gateway `machine_id` + `computeDeepGatewayId`; the inner
        router's deep `/24` holds a discoverable **child gateway** (pivot-nmap lists it). Shipped loops green. _(v0.78.0)_
  - [x] **5b.4b** Forward to the child gateway → `ssh` lands on it → pivot-nmap **L3**; 3 layers reachable. _(v0.79.0)_
  - [ ] **5b.4c** `seedNetworkDepth(key, essid) → 1–3` gates chain length; deterministic, reload-stable.
  - [ ] **5b.4d** Per-layer gateway kind (router/switch) seeded; a switch layer ACL-filters one level deep.
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

### Slice 5b.1b-i — Expose: scanning the inner gateway reveals a journaled NAT forward to a hidden Layer-2 machine

**Value**: The player exposes a deeper-layer machine by configuring NAT on the inner gateway and SEES it
appear — `nmap <inner IP>` surfaces the forwarded port. Proves topology + addressing + forward-liveness
end-to-end, short of logging in (that's 5b.1b-ii).
**Path**: a new **Layer-2 generator** (subnet `10.<a>.<b>.0/24` from `PRNG(key, essid, layer)`, one
`buildRemoteHostFs` NPC with `sshd:22` up at a seeded octet; the inner gateway is `.1` of this `/24`,
dual-homed onto the home `/24`) → `nano rules.v4` on the inner gateway adds `forward 2222 to <L2 IP>:22`
(journaled via `isOwnRouter`→`materializeRouterFs`, shipped in 5b.1a) → `nmap <inner IP>` routes to a
NEW server action that materializes the inner gateway (base + journal), runs the single
`scanResult({ vantage: 'external', … })` total function with a deep-layer `resolveTargetPorts` (returns
the L2 host's open ports for its `internalIp`, liveness-gated) → the client renders `:2222`. **Mirrors
the shipped public-IP scan path** (`handleResolvePublicScan`) but own-keyed + octet-targeted (the inner
gateway is NOT in `network_registry`; the server regenerates it from the verified pubkey + essid +
octet and fetches its journal by `computeInnerGatewayId`). Skipped: ssh through the forward (5b.1b-ii),
pivot (5b.2), switch (5b.3), deep-layer trace fidelity (5b.5 — the existing own-LAN kern.log trace keeps
recording the gateway's base `:22`).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code): (1) the Layer-2 generator is deterministic + reload-stable:
subnet `10.<a>.<b>` seeded per `(key, essid, layer)`, distinct from the home `192.168.<x>` `/24`; one NPC
host with `sshd:22`; inner gateway `.1` of the deep `/24`. (2) `scanResult` with a deep `resolveTargetPorts`
hides the forward when the L2 host's `:22` is down and shows `:2222` (service from the L2 host) when it is
up — `iff` proven at the resolver/scanResult unit level. (3) the server action: regenerates the inner
gateway from the verified pubkey + essid + octet, refuses a target that is not an inner gateway, fetches
its journal, and returns the `external`-vantage ports (host-down → empty/`found:false`, e.g. a bricked
gateway). (4) `nmap <inner IP>` (client) renders the server-resolved ports — `:22` with no forward, plus
`:2222` once the forward is added; a range scan and the edge `.1`/sibling scans are UNCHANGED. (5)
cross-player public-IP scan still shows ONLY the edge router + forwarded workstation (deep layer
invisible); the shipped `crack→connect→nmap→ssh→su→brick` loop is green. (6) a `scripts/test*.ts`
wire-check exercises the new `api/` action against `vercel dev`.
**RED**: unit — deep-layer generation determinism + `10.x` distinctness; the deep `resolveTargetPorts`
liveness gate (down → `[]`, up → L2 ports); the server action's regenerate/guard/`external`-scan; the
client `nmap` inner-gateway async branch. Likely mutants: the `10.<a>.<b>` octet draws, the
`vantage === 'external'` branch reuse, the liveness `find`/`=== internalPort`, the inner-gateway
`kind/octet` guard in the action, the client branch predicate (inner gateway vs edge/sibling).
**GREEN**: add the Layer-2 generator; add the deep-layer `resolveTargetPorts`; add the server scan
action + `api/` route + `env.scan.resolveInnerGateway` seam/adapter; branch `nmap.ts`'s single-IP scan
to the inner-gateway async resolve.
**MUTATE / KILL MUTANTS / REFACTOR**: per the skills. **Done when**: criteria met + the `scripts/`
wire-check + agent-browser confirm of the expose loop; human approves.
**✅ DONE (v0.73.0, 2026-06-23):** all 6 criteria met; `scripts/testInnerGatewayScan.ts` 5/5 live against
`vercel dev`+supabase (baseline→live forward→dead-forward liveness gate→brick-dark). Agent-browser E2E
substituted by the live wire-check (no browser-only behavior; `feedback_e2e_scope`). 4 commits on
`feat/5b1b-i-inner-gateway-expose`.
**Deferred from this slice (noted 2026-06-23):** in-game DISCOVERY of the L2 host IP — a player learns
which `<L2 IP>` to forward to either via the 5b.2 pivot (scan the deep `/24` from the gateway) or a
future `rules.v4` seed-comment that names the real downstream host (would thread `essid` into
`buildInnerGatewayBaseFs`). 5b.1b-i proves the forward MECHANISM; its wire-check/E2E uses the
deterministic L2 IP. Deep hosts get a guaranteed `sshd:22` (`buildDeepHostFs`), not the probabilistic
`buildRemoteHostFs` roll, so they are reliable targets (D8).

### Slice 5b.1b-ii — Reach: ssh through the forward lands a session on the Layer-2 machine

**Value**: The full multi-layer payoff — the player logs into the deeper-layer box through the NAT
forward they configured. **Path**: `ssh user@<inner IP>:2222` → the inner-gateway target with a
non-own-sshd port routes to a NEW server auth action that materializes the inner gateway (base +
journal), resolves `machineServing(innerFs, 2222)` → `forward → <L2 IP>:22`, regenerates the L2 host,
validates the password against ITS `/etc/passwd`, server-derives the userType, and inserts a session on
the **L2 host's** `machine_id` (`hostMachineId`) — so reads/writes downstream land on the L2 box, not the
gateway. **Mirrors `authCreateSessionPublic`** (port-routed via `machineServing`) but own-keyed +
octet-targeted, with the internal target an L2 NPC instead of the owner's workstation. `ssh root@<inner>`
on port 22 (5b.1a) is unchanged (own sshd → lands on the gateway). Skipped: pivot (5b.2), switch (5b.3).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code — detail at slice start): (1) `ssh user@<inner IP>:2222`
lands on the Layer-2 NPC (auths against ITS `/etc/passwd`; the session's `machine_id` is the L2 host's,
its hostname drives the prompt), not the inner gateway. (2) a port with no matching forward → "Connection
refused" (server `host_unreachable`); a wrong password → "Permission denied". (3) `ssh root@<inner>` (port
22) still lands on the gateway (5b.1a unbroken). (4) cross-player public-IP path + the shipped loop green.
(5) a `scripts/test*.ts` wire-check + agent-browser confirm of the full `nmap→forward→ssh→shell` loop.
**RED/GREEN/MUTATE/KILL/REFACTOR**: detailed at slice start. Likely mutants: the `machineServing` port
equality, the inner-vs-forward routing predicate in `ssh.ts`, the L2 passwd validation.
**Done when**: criteria met + wire-check + agent-browser; human approves.
**✅ DONE (v0.74.0):** all 5 criteria met; `scripts/testInnerGatewayReach.ts` 6/6 live against `vercel dev`+
supabase (forward→reach-deep-host landing on the deep host id · wrong-pw→401 · no-forward→404 · port-22→
gateway id · brick→404). Agent-browser E2E substituted by the live wire-check (no browser-only behavior;
`feedback_e2e_scope`). 4 commits on `feat/5b1b-ii-inner-gateway-reach`. As-built anchors + equivalent mutants
in the status block at the top of this file.
**Deferred from this slice (noted 2026-06-23):** (1) the handler leaves NO deep-layer trace (an `ssh` onto the
deep host writes no `auth.log` line) — deferred to **5b.5** with the rest of deep-layer trace fidelity, consistent
with how 5b.1b-i deferred trace fidelity; (2) in-game discovery of the L2 host IP still rides the deterministic
address (5b.2 pivot or a future `rules.v4` seed-comment will surface it in-game).

### Slice 5b.2 — Reachability-pivot: scan/connect from the box you're connected to

**Value**: The hopping playground — operate from a box you've breached (reach switch-gated layers;
realism). **Path**: vantage = head of the active hop chain (`sessions`); `nmap`/`ssh` resolve against
the current machine's network (its layer `/24`, + downstream if a gateway) instead of home. Source-IP
masking stays deferred (D4). **Required skills**: `tdd`,`testing`,`mutation-testing`,`refactoring`.
**Acceptance criteria** (confirm before code — detail when reached): after `ssh` onto the inner
gateway, `nmap <L2 /24>` from that vantage lists Layer-2 hosts with no forward; from home that scan
returns nothing; the shipped own-LAN/cross-player scans are unchanged when no hop is active.
**RED/GREEN/MUTATE/KILL/REFACTOR**: detailed at slice start. **Done when**: criteria met, human approves.
**✅ DONE (v0.75.0, #310):** all 6 criteria met. Scoped to the **nmap discovery half** (the AC's exact
shape); resolved CLIENT-side (deep hosts are journal-less NPCs) so NO new `api/` action + NO wire-check.
As-built anchors in the status block at the top of this file. **Deferred from this slice:** (1) **ssh-from-
pivot** — `ssh user@<deep IP>` DIRECTLY from the gateway vantage (no forward) needs a new server auth
action + wire-check; login via the NAT forward already works (5b.1b-ii), so this is its own later slice;
(2) no deep-layer scan trace (→ 5b.5).

### Slice 5b.3 — Switch inner gateway: dark-from-upstream + ACL filter — SUB-SPLIT a/b (confirmed 2026-06-23)

The second device type — a switch you must pivot into, gated by `acl.conf`. Depends on 5b.2. See the
status block at the top (DECISIONS 1–3 + KEY FINDINGS) and D10 for the confirmed design. Split into 5b.3a
(device foundation, no deep-layer code) + 5b.3b (pivot ACL scan + edit-to-open).

#### Slice 5b.3a — A switch inner gateway appears, is attackable, and is dark from upstream ✅ MERGED (#311, v0.76.0)

**As-built note:** all 5 AC shipped. ONE deviation from the spec below: the switch is drawn LAST from the
LEFTOVER octets (after the gateway+sibling `pickN` and the sibling-name picks), NOT via `pickN(count+2)` —
the extra `pickN` draw shifted the sibling HOSTNAMES, so the leftover-draw approach is what actually keeps
the existing stream byte-stable. Golden switch = `.80 vpn-gw`. `parseAclDenies` ships with NO redundant
pre-`.filter` (parseDenyLine is the single validity gate). `innerGatewayForMachineId` kept ROUTER-ONLY (a
guard test pins that a switch does not yet pivot — 5b.3b flips it). Full as-built dossier → top status block.

**Value**: The player discovers a SECOND new device on their LAN — a switch (the router's mechanical
opposite): attackable like the router, but it forwards nothing and hides its downstream. Foundation for
the switch half of depth.
**Path**: `generateHomeLan` seeds a 2nd inner gateway `kind:'switch'` (APPENDED as the last `pickN`
draw — golden-LAN-safe) → `nmap <home /24>` lists it (kind `switch`) → `ssh root@<switch IP>` auths
against its octet-seeded admin pw (`seedInnerGatewayAdminPw`, lands on `computeInnerGatewayId`) →
`nmap <switch IP>` (single) routes server-side (`isInnerGateway` → `resolveInnerGatewayScan`) and shows
ONLY its own `:22` (no `rules.v4` ⇒ empty forward table ⇒ dark downstream, free) → `cat /etc/switch/acl.conf`
shows the seed → `nano acl.conf` persists (journal via the inner-gateway L2 path). Skipped: ANY deep-layer
scan/host yet (5b.3b), the ACL filter (5b.3b).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (drafted + confirmed 2026-06-23 — re-confirm at slice start, then RED):
(1) `generateHomeLan` returns a switch inner gateway (`kind:'switch'`, distinct octet ≠ `.1`/self/
inner-router/siblings, deterministic + reload-stable); `LanHostKind` gains `'switch'`; the inner ROUTER
octet + all sibling octets are UNCHANGED (appended-last draw). (2) the switch has its OWN `machine_id`
(≠ edge, ≠ inner router, ≠ siblings) + seeded admin pw; `ssh root@<switch IP>` SUCCEEDS with it and FAILS
with the inner-router's / edge's pw (non-alias). (3) `nmap <switch IP>` from Layer 1 lists ONLY the
switch's own `:22` — its downstream deep hosts NEVER appear (dark; no forward mechanic). (4)
`cat /etc/switch/acl.conf` shows the seeded default (allow-by-default + one `deny <port>`); `nano`-editing
it persists across reload (journal). (5) cross-player public-IP scan + the shipped `crack→…→brick` loop
unchanged (switch unregistered; depth private).
**RED**: unit — `generateHomeLan` includes a deterministic `kind:'switch'` host with router+siblings
stable; `buildSwitchBaseFs` has root passwd + sshd:22 + `/etc/switch/acl.conf` (no `rules.v4`);
`parseAclDenies` (denies parsed, comments/blank ignored); `isInnerGateway(switch)===true`;
`machineIdForLanHost`/`baseFsForLanHost` route a switch to `computeInnerGatewayId`/`buildSwitchBaseFs`.
Behavioral — `nmap <switch>` (own `:22` only), `ssh root@<switch>` (own pw ok / others fail) through the
shipped own-LAN paths. Likely mutants: the `||`/octet guard in `isInnerGateway`; the switch branch in the
identity resolvers; `parseAclDenies` line filter + number parse; the appended-draw index `count+1`.
**GREEN**: `LanHostKind += 'switch'`; seed the switch in `generateHomeLan` (appended draw); add
`buildSwitchBaseFs` + `acl.conf` seed + `parseAclDenies` (sibling of `iptablesRules`); extend
`isInnerGateway`/`machineIdForLanHost`/`baseFsForLanHost`.
**MUTATE / KILL / REFACTOR**: per the skills. **Done when**: criteria met, report reviewed, human approves,
version bumped. **No new `api/` action / wire-check** (own-LAN device on the proven journal path).

#### Slice 5b.3b — Pivot onto the switch → ACL-filtered downstream scan; delete a deny opens the port ✅ MERGED (#312, v0.77.0)

**As-built note:** all 5 AC shipped (squash `a7b3b7f`). Open point resolved as recommended — KIND map via the
pure seam `deepLayerIndexForGateway(host)` (`switch → DEEP_LAYER_INDEX+1`, else base); 5b.4 generalizes that
map. `innerGatewayForMachineId` widened router-only → `isInnerGateway` (the matched host's `.kind` picks the
segment). `resolveDeepPivotScan(env, essid, rawTarget, gateway)` derives the index from the gateway and, for a
`kind==='switch'` vantage, subtracts `parseAclDenies(readAclConf(env.fs.root()))` from the deep host ports —
env.fs = journal-replayed switch tree, so deleting the `deny` line re-opens the port (edit-to-open free). The
old `'does NOT pivot from a SWITCH'` guard was rewritten into the disjoint-segment pair. Client-side only, no
new `api/`. Mutation 100% on the changed units; ONE documented-equivalent (`nmap.ts:202` kind-gate → `true`: a
router's FS has no `/etc/switch/acl.conf`, so the filter is a no-op for routers). Full dossier → top block.

**Value**: The switch payoff — stand on the switch you breached and scan its hidden segment, gated by the
firewall you can edit. **Path**: the switch fronts its OWN deep `/24` (a 2nd pinned deep layer — per-gateway
index; router stays `DEEP_LAYER_INDEX`=2 unchanged, switch gets its own; full depth variety → 5b.4). Pivoted
onto the switch (active session = switch id), `nmap <switch deep /24>` resolves CLIENT-side: list the deep
host(s), ports = `readOpenPorts(buildDeepHostFs(...)) − parseAclDenies(env.fs.root()'s acl.conf)`. Delete the
`deny <port>` line (`nano`) → next pivot scan shows that port (edit-to-open, free via `env.fs`=journal). From
Layer 1 (no pivot) the deep `/24` is out of range. Router pivot (5b.2) unchanged (no ACL filter).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm before code — detail at slice start): (1) the switch's deep layer is
deterministic + distinct from the router's deep `/24`. (2) pivoted onto the switch, `nmap <switch deep /24>`
lists the deep host with ports = own − denied (a seeded-denied port is ABSENT). (3) deleting the `deny`
line opens that port on the next pivot scan. (4) from Layer 1 the switch's deep `/24` is out of range
(must pivot). (5) the router pivot + shipped scans unchanged.
**Open implementation point (resolve at slice start):** the per-gateway → deep-layer-index mapping. Recommended:
the i-th inner gateway (by draw/octet order) fronts index `DEEP_LAYER_INDEX + i` (router=first→2, switch=
second→3); keep `resolveDeepPivotScan` reading the gateway from `innerGatewayForMachineId` and deriving the
index + kind from it. Full 1–3 depth + chains stay 5b.4.
**RED/GREEN/MUTATE/KILL/REFACTOR**: detailed at slice start. **Done when**: criteria met, human approves.

### Slice 5b.4 — Depth & gateway-kind variety (CHAINS) — SUB-SPLIT a/b/c/d (grilled 2026-06-24)

The genuinely-new capability is **linear chains** (L1 → L2 → L3, depth seeded 1–3). "Two gateway kinds" and
"2 layers deep" already shipped (5b.1–5b.3b). Grill-me resolved the design tree:

- **D-chain-1 (topology) — Layer 1 untouched; chain hangs BEHIND the inner router.** `generateHomeLan` is
  byte-stable; the chain is a pure extension of the deep-layer generator. The 4a skeleton chains behind the
  **inner router only** (the switch keeps its single deep layer until 4d). NOT a flat `SubnetLayer[]` reshape.
- **D-chain-2 (keying + identity) — a layer's `/24` is keyed by the gateway that FRONTS it.** Seed
  `deep-layer-${frontingGatewayMachineId}-${essid}` (uniform from L1 down; no global integer). The kind-based
  `deepLayerIndexForGateway` is REPLACED by deriving the layer off the gateway's own `machine_id`. A deep
  gateway's id = `computeDeepGatewayId(key, parentMachineId, octet)` in a new `ed25519-deep-gw:` namespace
  (parent-id + octet ⇒ globally unique across layers/branches); its creds/base FS reuse the inner-gateway
  router toolkit but seeded off that unique discriminator (so its admin pw is unique per deep gateway). The
  existing inner-router L2 / switch L3 subnets RE-KEY to new values — **mechanical churn** (every test/script
  recomputes the deep IP via `generateDeepLayer(...)`; the only literal is `10.9.9.9`, a dead forward target).
  Both server gates (`resolveInnerGatewayScan`, `authCreateSessionInnerGateway`) drop their hardcoded
  `DEEP_LAYER_INDEX` and key the deep layer off the gateway `machine_id` they ALREADY resolve.
- **D-chain-3 (reachability) — forward to REACH the next gateway, pivot to SCAN the layer behind it** (matches
  the AC's "forward + pivot"). No new `ssh-from-pivot` primitive (stays deferred): you reach the L2 child
  gateway via a NAT forward on the L1 router (the shipped 5b.1b-ii path, extended to recognize a deep
  *gateway* as a forward target), then pivot-nmap L3 from that vantage (client-side, 5b.2/5b.3b).
- **D-chain-4 (privacy invariant) — depth stays single-player / private.** Deep layers are never registered;
  every gate is own-keyed. A cross-player scan of the public IP still sees ONLY the edge router + forwarded
  workstation — chains never leak. (D5.)

#### Slice 5b.4a — The chain generates + its deeper gateway is discoverable ✅ MERGED (#313, v0.78.0)

**As-built note:** all 5 AC shipped (squash `9b9f18d`). Re-key landed as designed (D-chain-2); the child gateway
is drawn via `pickN(usableOctets, 2)` (distinct from the NPC) and pinned by a golden test. `computeDeepGatewayId`
+ `buildDeepGatewayBaseFs` shipped as the child's identity foundation that **5b.4b consumes to reach it** —
`resolveDeepPivotScan` reads the child's ports from `buildDeepGatewayBaseFs` (→ `:22`), but no REACH path
consumes the id yet. Wire-checks 5/5 + 6/6 (re-key preserves the shipped scan + forward-login). Full dossier →
top status block.

**Value**: The player pivots onto their inner router and discovers a *deeper* gateway hanging behind it — the
first glimpse of a multi-hop network. Isolates the riskiest reshape (re-key + deep-gateway identity) behind
unchanged reachability. **Path**: re-key deep layers to `machine_id`-keyed (D-chain-2) + `computeDeepGatewayId`;
the inner router's deep `/24` now holds a **child gateway** (kind `router`) at a seeded octet (distinct from
the NPC + the `.1` parent-downstream interface; dual-homed at the NEXT layer's `.1`); both server gates
re-keyed off the gateway `machine_id`. `nmap <inner router's deep /24>` from the pivot vantage lists the NPC
**and** the child gateway. Reaching the child gateway / scanning L3 = NOT yet (4b). **Required skills**:
`tdd`,`testing`,`mutation-testing`,`refactoring`.
**Acceptance criteria** (confirm before code — detail at slice start): (1) deep layers are keyed by the
fronting gateway's `machine_id`; the inner router's and switch's deep `/24`s are deterministic + reload-stable
under the new keying (kind-based `deepLayerIndexForGateway` removed). (2) the inner router's deep `/24` holds a
child gateway (`kind:'router'`) with a unique `computeDeepGatewayId` id + its own seeded admin pw, at a stable
octet ≠ the NPC / `.1`. (3) `nmap <inner router deep /24>` from the inner-router pivot vantage lists BOTH the
NPC and the child gateway. (4) the shipped inner-gateway scan + forward-login + switch pivot + cross-player
loop stay green under the re-key (server gates derive the deep layer off the gateway `machine_id`). (5)
cross-player public-IP scan unchanged — the child gateway is private (unregistered). **Done when**: criteria
met, mutation report reviewed, human approves, version bumped.

#### Slice 5b.4b — Reach the child gateway + scan L3 ✅ MERGED (#314, v0.79.0)

**As-built note:** all AC shipped (squash `a95d13b`). Reach via `resolveAuthTarget` matching `deep.childGateway.ip`
(+ `buildDeepLayerPortResolver` surfacing the forward); terminal pin via `generateDeepLayer`'s `hangsChild`
option; `pivotVantageForMachineId` finds deep child gateways; shared `resolveDeepGatewayIdentity` DRYs the child
id+FS. Wire-check 8/8 live. The 3-layer cap is HARDCODED (≡ depth 2) — 5b.4c makes it seeded. Full dossier →
top status block.

**Value**: Stand on the deeper gateway you discovered and scan the layer behind IT — the chain becomes
traversable to L3. **Path**: extend the forward path (`resolveAuthTarget`/`machineServing`/the deep-layer port
resolver) to recognize a deep **gateway** as a forward target → `ssh admin@<L1 inner>:<port>` lands a session
on the L2 child gateway → pivot-nmap L3 (from that vantage, position-keyed off the child gateway's id) lists
its terminal NPC. **Required skills**: `tdd`,`testing`,`mutation-testing`,`refactoring`.
**Acceptance criteria** (confirm before code — detail at slice start): a forward on the L1 router to the child
gateway's `:22` lets `ssh admin@<inner>:<port>` land a session on the child gateway (auth against ITS admin
pw, lands on its `computeDeepGatewayId` id); from that vantage `nmap <L3 /24>` lists the L3 terminal NPC; from
Layer 1 (no pivot) the L3 `/24` is out of range; a 3-layer home is reachable + scannable end-to-end; the
shipped loops stay green. **Done when**: criteria met, human approves.

#### Slice 5b.4c — Variable depth (1–3)

**Value**: Real generated variety — some homes shallow, some 3 deep. **Path**: `seedNetworkDepth(key, essid) →
1..3` gates how far the chain extends (depth 1 = today's terminal NPC, no child gateway; depth 3 = two nested
gateways); a gateway's layer derives "does a child gateway hang here?" from the seeded depth vs its position.
**Required skills**: `tdd`,`testing`,`mutation-testing`,`refactoring`.
**Acceptance criteria** (confirm before code — detail at slice start): depth seeded ≥1 per home, deterministic,
1–3, reload-stable; a depth-1 home has no child gateway (terminal NPC); a depth-3 home chains two gateways
reachable end-to-end; the chain length is recoverable server-side from `(key, essid)` for the gates.

#### Slice 5b.4d — Gateway-kind variety per layer

**Value**: A chain can mix routers and switches — a switch layer filters its downstream by ACL one level
deep. **Path**: seed each chain layer's gateway kind (router/switch); a switch deep gateway builds
`buildSwitchBaseFs` + its pivot subtracts `parseAclDenies` (5b.3b) a layer down. **Required skills**:
`tdd`,`testing`,`mutation-testing`,`refactoring`.
**Acceptance criteria** (confirm before code — detail at slice start): a chain layer's gateway kind is seeded
+ deterministic; a switch deep gateway forwards nothing (dark from upstream) and ACL-filters its pivot scan; a
mixed router→switch chain is reachable + scannable end-to-end.

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
