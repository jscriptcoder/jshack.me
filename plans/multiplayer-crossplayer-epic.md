# Epic Story-Split: Multiplayer / Cross-player (v2)

**Status**: **Stories 1 + 2 + 3 + 4 SHIPPED & MERGED.** Story 1 (1a #234 `df95ad6`; 1b #235 `ff5342a`, v0.55.0) —
the cross-player public-IP loop is live: crack → connect (register) → `nmap <public IP>` → another
player's REAL open ports, resolved server-side against the registry. **Story 2 (2a #237 · 2b #238
`bbc6e47` v0.57.0 · 2c #239 `1e92503` v0.58.0 · 2d #240 `82a48f9` v0.59.0)** — B `ssh guest@<A.publicIp>`
→ session on A's REAL record → `ls`/`cat` A's actual files, SERVER-materialized + pruned by the 3-tier
read filter (owner full / session walker / no-session externally-observable allowlist). **Story 3 (cross-player
WRITE + the `patches` PK flip): Slice 1 PK flip #242 v0.60.0 · Slice 2 first guest write #243 v0.61.0 ·
Slice 3 write boundary #244 v0.62.0 · Slice 4 cross-player `rm` tombstone-always v0.63.0** — B can
create/edit/delete on A's box, persisted to the shared **chronological** journal (server-stamped
`writer_key` + `updated_at`), L1 (session) + L2 (walker at the login tier against A's owner-materialized
tree) server-enforced. **Story 4 (su-to-root via the obtained password → permanent `/boot` brick →
bricked box dark to others): Slice 1 su-elevation #249 v0.64.0 · Slice 2 `/boot`+boot-screen brick #250
v0.65.0 · Slice 3 `reboot` #251 v0.66.0 · Slice 4 bricked-box-dark v0.67.0** — B `su root` on A → `rm
/boot/vmlinuz` → A is permanently unbootable (journal-derived, no recovery), dark to scans + ssh for
everyone. **Story 5 IN PROGRESS** (real iptables NAT — **SCOPED 2026-06-16 via grill-me to cross-player home NAT
only; multi-layer → new Story 5b; see "Story 5 — resolved scope & decisions" below**). **5.0 `nano` ✅ SHIPPED
(PR #256, 2026-06-17); NEXT = 5.1 (router as a real machine + player NAT).** Story-split
authored 2026-06-13. Consolidates the remaining work from two now-retired plans
(`network-generator-epic.md` Story 4; `scan-logging-cross-player.md` Slice 3b) into one epic. Each child
story below graduates to its own `plans/<slice>.md` (via the `planning` skill) when started.

> **Story 1 outcome (2026-06-14).** Shipped as **1a + 1b** (no 1c). **KEY DECISION: the `patches` PK flip
> was DEFERRED to Story 3** — Story 1/2 resolve the owner's EXISTING per-viewer rows via
> `(machine_id, player_key = owner_key)` from the new `network_registry`, so NO schema change was needed.
> Dropping `player_key` from the PK is only required for cross-player WRITES (Story 3). New code:
> `core/network/registerNetwork.ts`, `core/scan/resolvePublicScan.ts` (+ `findRunFiles` →
> `readOpenPortsFromPidfiles`), `nmap` public-IP routing/render, `adapters/networkApi.ts`,
> `api/network.ts`, migration `20260613000000_network_registry.sql`. Degenerate NAT stored as a VALUE
> (`router_machine_id = workstation`, `forward_table=[{publicPort:'*', → workstation}]`) — Story 5 swaps
> the value, not the shape.

> **Provenance.** This file supersedes and replaces `plans/network-generator-epic.md` and
> `plans/scan-logging-cross-player.md`, both of which were ~95% SHIPPED and converged on a single missing
> primitive: the **cross-player shared machine record**. Their shipped foundations are summarised under
> "Shipped foundations" below so no history is lost. Authored with the `story-splitting` skill (vertical
> slices, walking-skeleton-first, no component/scatter-gather stories).

---

## Parent capability (reframed)

> **A player can find, enter, alter, and persistently damage another player's machine by scanning its
> public IP — and those changes survive for the target's owner (and other players) to discover.**

- **Actor**: an attacking player (identity B), against a victim player (identity A).
- **Capability**: scan A's public IP → discover NAT-forwarded ports → connect to the internal machine →
  navigate + modify its filesystem → escalate to root → brick it.
- **Outcome**: cross-player PvP — the core reason v2 exists. Damage and traces persist server-side and are
  observable by other identities, enabling emergent attacker/defender gameplay.
- **Current constraint (the gate)**: everything in v2 is **per-viewer**. The Supabase `patches` table PK
  is `(player_key, machine_id, path)`; every identity regenerates each host under its own key, so a file
  or trace one player creates is **invisible to everyone else**. There is no cross-player anything yet.

## The architecture gate (what the whole epic turns on)

Three coupled changes flip v2 from single-player-shaped to multiplayer:

1. **Shared machine record** — a machine's patches become a globally-shared `machine_id` row (keyed by
   `machine_id`, not `(player_key, machine_id)`). `player_key` demotes from _identity_ to _provenance_
   ("who wrote this line"). An `owner_key` marks the player who owns the box (system/NPC = null).
2. **Public-IP registry** — `public IP → network → router → machines`, server-persisted and queryable, so
   a _different_ identity's scan of a public IP resolves to real machines server-side (today
   `generatePublicIp` is deterministic but not registered or queryable by anyone but the owner).
3. **3-tier cross-player read filter** (port legacy `listPatchesForMachines`) — owner / active-session +
   permission-walker / no-session + allowlist. The path by which B reads A's box safely.

**Owner security stance (memory `feedback_multiplayer_ship_first`)**: ship-first — L1 + targeted L3
(gameTime / wallet / hop-chain) is enough to launch. The read filter and L1/L2 here are _core_, not
gold-plating; do NOT gold-plate shared-world isolation (bricking/defacement is gameplay-renewable —
`feedback_shared_world_mutation_fine`).

## Shipped foundations (from the two retired plans — do NOT re-port)

- **nmap** host-discovery — `core/commands/nmap.ts`, `core/generation/generateHomeLan.ts` (single-IP +
  range; own-subnet only today).
- **ssh** epic (PRs #219–#228) — cross-machine session-auth, **writable remote FS** (`patches` stream),
  **L1** `core/patches/authorizeMachineAccess.ts` (own-workstation OR active `sessions` row), **L2**
  `core/patches/remoteWritePermission.ts` (server-side `createFsView().canWrite` via FS regeneration),
  `appendMachineLog` (`core/patches/appendMachineLog.ts` — server-internal read-modify-write of a target
  log file), auth.log via that primitive, `remoteHostFs`/`remoteHostId` (coordinate-derived `machine_id`).
- **su** + server-stamped UTC auth-logging (ADR D13); **server `sessions` table**
  (`core/sessions/{create,list,end}Session.ts`, `api/sessions.ts`) — hop chain survives refresh.
- **`generatePublicIp`** (`core/generation/ip.ts`, 12-prefix allowlist, ESSID-seeded) on
  `HomeNetworkAssignment.publicIp` (`core/network/homeNetwork.ts`) — every occupant of an AP shares it.
- **Scan-logging** Slices A + 1 + **3a** (PRs #210/#230/#231) — `formatNmapScanAggregate`
  (`core/logging/kernLog.ts`), `resolveLogSourceIP` (`core/logging/sourceIp.ts`), and the **per-viewer**
  server-internal kern.log write wired to a signed `nmapScan` round-trip (`core/scan/nmapScan.ts`,
  `api/patches.ts`). Slice 3b (cross-player read) is the only piece left → folded in as **Story 6**.
- **Network generator** Stories 0–3 + 1.5 — seeded workstation FS, `apt install`, single-layer LAN scan,
  ssh-into-generated-host. Only Story 4 (multi-layer depth + dual-homed gateways + iptables) is left →
  folded into **Story 5**.

## Locked owner decisions (2026-06-13)

1. **Walking skeleton = player-workstation sharing first** (not the NPC-host trace read). The first
   shared record is the player's _own_ workstation — the most concrete "another player's machine."
2. **Public-IP + router NAT FIRST** (not same-wifi-LAN first). The headline build target is
   `scan public IP → router forwards ports → internal machine`. Same-ESSID shared-LAN occupancy is a
   deliberate follow-up (**Story 7**), even though it's part of the stated vision.
3. **Consolidate + delete** — this file replaces the two old plans, which are deleted.

---

## Recommended first slice (walking skeleton)

> **Story 1** — Joining a home network registers your workstation as a shared, server-persisted record
> under your network's public IP; another player's `nmap <your public IP>` resolves it server-side and
> returns its open ports.

**Why this first**: it is the irreducible cross-player whole. You cannot observe _any_ cross-player
behavior without (a) the shared machine record, (b) the public-IP registry, and (c) server-side
resolution of one identity's scan against another's machine. It burns down all three architecture risks
at once behind the thinnest observable behavior, and it is demonstrable with two browsers. NAT is
**degenerate** here (the public IP maps straight to the single workstation, all ports) — the registry
stores `publicIp → { routerMachineId, forwardTable }` with `forwardTable = "everything → workstation"`,
the exact seam Story 5 swaps for real iptables rules with **no rework of the registry shape**.

## Split candidates (ordered, each vertical + observable)

| #                                     | Slice (actor + action + scope)                                                                                                                                                                | Value                                                                                                                       | Includes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Defers                                                                                              | Acceptance examples                                                                                                                                                                                                                                                                                                                                                       | Release                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1 ✅ **DONE** (#234+#235)             | **Cross-player public-IP discovery** of a shared workstation record (walking skeleton)                                                                                                        | First cross-player observable; burns down registry + server-resolution risk                                                 | Join → register `(publicIp → network → workstation machine_id)` server-side; `nmap <public IP>` resolves server-side to the workstation's REAL open ports (read from the owner's existing `/var/run/*.pid` rows via the registry's `owner_key`; degenerate NAT). **No schema flip — deferred to Story 3.**                                                                                                                                                                                                                                                               | Selective iptables, multiple internal machines, multi-layer, break-in, read filter, FS write, trace | Two identities A,B; A joins net + has sshd up; **B** runs `nmap <A.publicIp>` → sees the real port (E2E proved `2222/tcp` from A's `sshd 2222`); B scans an unregistered IP → no host                                                                                                                                                                                     | ✅ Shipped (internal-only — not yet a full loop)                              |
| 2 ✅ **DONE** (#237+#238+#239+#240)   | **B reads A's filesystem** over the public path (the 3-tier read filter)                                                                                                                      | Cross-player READ — B sees A's _real_ files, not a per-viewer regen                                                         | 2a join persists A's workstation identity; 2b `ssh guest@<A.publicIp>` → session on A's REAL record; 2c server-materializes A's tree + tier-2 walker filter; 2d tier-1 owner (full) + tier-3 no-session externally-observable allowlist. SERVER-served (D1) — the wire is pruned to the caller's tier before it leaves. **No schema flip — deferred to Story 3.**                                                                                                                                                                                                        | Writing, root, bricking, trace                                                                      | B `ssh`es in, `cat`s a file **A created**; guest can't read `/root`/passwd hashes; no-session → allowlist only; owner reads its own box full + unchanged                                                                                                                                                                                                                  | ✅ Shipped (read loop live: `crack → connect → nmap → ssh → ls/cat`)          |
| 3 ✅ **DONE** (#242+#243+#244+Slice4) | **B modifies A's filesystem**                                                                                                                                                                 | The "make changes" half of the vision                                                                                       | Slice 1 flipped `patches` to a shared chronological journal (PK `(machine_id,path,writer_key)`, server `updated_at`); Slices 2–4 added the cross-player L2 (owner-materialized registry branch, D6), the write **boundary** (creates gated by the containing dir), and **tombstone-always** `rm` (a delete is a timestamped event, so delete-then-recreate replays chronologically). L1 (session) + L2 (walker at the login tier) server-enforced.                                                                                                                       | Root escalation, bricking, trace                                                                    | B writes `/tmp/pwned` on A → A sees it; B denied off the guest-writable set; B `rm`s → A sees gone; A re-creates → wins                                                                                                                                                                                                                                                   | ✅ Shipped (write loop live: `crack → connect → nmap → ssh → create/edit/rm`) |
| 4                                     | **B escalates to root → bricks A's machine** — ✅ **DONE** (#249–#252)                                                                                                                        | The dramatic payoff — persistent cross-player damage                                                                        | Root escalation via **`su` with the obtained root password** (no privesc-CVE primitive needed — see Parking Lot) → a destructive/bricking action persists to A's shared record; A's box is observably damaged next load                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                   | B `su`s to root with A's password, performs the brick action; A's machine is broken on next load; B without root cannot                                                                                                                                                                                                                                                   | ✅ Shipped (su root → rm /boot → bricked + dark to others)                    |
| 5                                     | **Real router NAT / iptables port forwarding** — **SCOPED 2026-06-16 (grill-me) → cross-player home NAT only; multi-layer → new Story 5b. See "Story 5 — resolved scope & decisions" below.** | The owner's explicit iptables ask; "scan public IP uncovers _forwarded_ ports → internal machines" becomes real & selective | Replace degenerate NAT: router is the public-IP-bearing machine; PREROUTING DNAT maps specific public ports → specific internal machines; scanning shows only forwarded ports; connecting hits the mapped internal box. **Each dual-homed interface is its own addressable endpoint with its own port view** — `scanResult(address, vantage)` is a clean total function, NEVER a merged view (see Warnings: dual-homed scar). **Absorbs network-generator Story 4** (2–3 layers, dual-homed gateways, `switch` sub-kind, "see only your layer", RFC-1918 subnet variety) | —                                                                                                   | `nmap <publicIp>` shows the router's own ports **+** the forwarded ports; `nmap <router .1>` from inside the LAN shows the router's own ports **only**, NOT the forwarded ones (PREROUTING doesn't apply LAN-internal); `ssh <publicIp>:<fwd port>` lands on the mapped internal machine, not the router; scanning from inside a layer sees only that layer + its gateway | Shippable                                                                     |
| 6                                     | **Cross-player scan/connection trace** (scan-logging Slice 3b)                                                                                                                                | Emergent PvP discovery — defender reads logs, sees attacker IP                                                              | Re-key the shipped **3a** per-viewer kern.log/auth.log write onto the **shared** record; scanning/connecting a real player workstation leaves a trace its owner (or a 3rd player) reads                                                                                                                                                                                                                                                                                                                                                                                  | New formatters (all shipped in 3a)                                                                  | B scans A → A `cat /var/log/kern.log` sees B's source IP; a 3rd identity who breaks into A also reads it                                                                                                                                                                                                                                                                  | Shippable                                                                     |
| 7                                     | **Same-wifi shared-LAN occupancy** (deferred branch of the vision)                                                                                                                            | The "two players on the same wifi" scenario — same `/24`, no NAT, LAN IPs                                                   | Two identities who crack the same AP (ESSID) land on the same `/24`; `nmap` of the LAN shows the other's workstation as an occupant; same-LAN source-IP realism (LAN IP, not NAT)                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                   | A,B both crack ESSID X → both on `192.168.x.*`; B `nmap`s the LAN, sees A's workstation; B connects over the LAN IP                                                                                                                                                                                                                                                       | Shippable                                                                     |

## Parking lot

- **Story 1 ✅ DONE** — shipped as **1a** (register-on-join + `nmap <public IP>` host up/down, #234) +
  **1b** (the resolved machine's REAL open ports from the owner's `/var/run/*.pid` rows, #235). **No 1c:
  the schema flip was deferred to Story 3** (grounding showed Story 1/2 only READ the owner's existing
  per-viewer rows via the registry's `owner_key`, needing no flip). The sub-slicing concern is resolved.
- **Story 4 privesc vector — RESOLVED (2026-06-13).** No privesc-CVE primitive is needed to build or test
  the brick payoff: escalation is **`su` with the root password the attacker has obtained**. For the
  epic's testability the dev authors both identities and knows both root passwords, so Story 4 is testable
  with shipped `su` alone. The _realistic_ gameplay question of how an attacker obtains another player's
  root creds (hydra / leaked creds / library-CVE → `msfconsole --local`, memory
  `project_v2_library_cve_privesc`) is a **separate, parked gameplay concern** — it does NOT block this
  epic. Story 4 just assumes creds-in-hand.
- **Story 6 could be pulled earlier** — it's ~90% shipped (only a re-key onto the shared record from
  Story 1). It's placed after the write/brick payoff by priority, but it's cheap and could slot in right
  after Story 2 (which brings the read filter it depends on) if PvP-discovery is wanted sooner.
- **Story 7 (same-wifi)** is genuinely part of the owner's stated vision but deferred by decision #2. Keep
  it visible — it mostly reuses Story 1's shared record + occupancy registry, minus NAT.
- **`owner_key` / provenance schema** — the exact `patches` schema change (drop `player_key` from the PK,
  add `owner_key`, keep `player_key` as a provenance column) is the central migration. **DEFERRED to
  Story 3** (its first cross-player WRITE is what forces it; Stories 1–2 only read the owner's existing
  rows via the registry's `owner_key`). No live players → free to reshape (`feedback_no_backward_compat`),
  but this rule sunsets at multiplayer announce. Decide the column shape when planning Story 3.
- **Replay/nonce store** — `api/patches.ts` uses a `noopNonceStore` locally. The real nonce/rate-limit
  store should land with cross-player writes (Story 3) — confirm.

## Warnings

- **Story 1 must not bake in a NAT shape Story 5 tears out.** Store `publicIp → { routerMachineId,
forwardTable }` from the start; degenerate `forwardTable` = "all → workstation" is just a value, not a
  different schema.
- **⚠️ DUAL-HOMED ROUTER SCAR (owner-flagged legacy trap — design around it in Story 5).** A router is
  dual-homed: WAN/public IP + internal `.1`. In legacy, scanning the **public IP** (NAT-forwarded ports)
  vs the **internal `.1`** (router's own LAN-side services) gave **different** views, and the same
  recurred for every internal router/switch bridging layers. Legacy fixed it by **accreting patches**
  (merge logic, `isOnLayer0` gating, LAN-side forward-visibility hacks) until it worked — fragile. **v2
  must model `scanResult(address, vantage)` as a clean TOTAL function from the start**: each interface is
  its own addressable endpoint with its own port view (public-IP view = NAT forward table; `.1` view =
  router's own services); never a silently-merged view; a same-LAN scan of `.1` must NOT show forwarded
  ports (real PREROUTING is not LAN-internal). Get this invariant into the topology/addressing model
  up front so multi-layer + multi-target NAT compose instead of triggering another patch. The precise
  rule (owner-confirmed, matches real iptables):
  `scanResult(publicIP, external) = routerOwnPorts ∪ forwardedPorts` and
  `scanResult(routerLanIP, sameLAN) = routerOwnPorts` (forwarded ports NOT visible from the LAN).
  Ship-first: ONE `routerOwnPorts` set shown in both views — only the forwarded ports differ; don't model
  per-interface (WAN-vs-LAN) own-port distinctions. Memory:
  `project_dual_homed_router_scan_discrepancy` (+ `project_router_lan_side_forward_visibility`,
  `project_multi_target_nat`).
- **The read filter (Story 2) is security-load-bearing, not gold-plating** — the ship-first stance trims
  L2/isolation gold-plating, but owner/session/allowlist tiering is the _core_ cross-player boundary.
- **Don't relabel the schema flip as its own story.** It has no observable behavior alone — it rides
  inside the first story that needs it. **UPDATE (2026-06-14): that is Story 3** (the first cross-player
  WRITE), NOT Story 1 — Stories 1–2 only READ the owner's existing rows, so the flip wasn't needed yet.
  (Still no "build the shared-record table" component story.)
- **Story 1 service assumption — CONFIRMED (2026-06-13).** A player workstation can run **sshd** (open
  port 22), so `nmap <public IP>` returns a non-empty result. The only genuinely new mechanism the whole
  epic still needs is **iptables port-forwarding** (router → internal machine, Story 5) — every other tool
  (nmap, ssh, su, writable remote FS, sessions) is shipped. Story 1's plan must wire "open sshd on your
  own workstation" if that isn't already a player-reachable action.

## Story 5 — resolved scope & decisions (grill-me, 2026-06-16)

**Stories 1 + 2 + 3 + 4 ✅ COMPLETE** (v0.67.0; as-built reference: `v2/docs/cross-player-architecture.md`).
Live loop: `crack → connect → nmap <A.publicIp> → ssh guest@<A.publicIp> → su root → rm /boot/vmlinuz →
reboot`, after which A is permanently bricked and dark to everyone.

Story 5 was interrogated with `grill-me` and **scoped down**. The table row's fused
"selective + multi-target + multi-layer" is split: **Story 5 is cross-player home NAT only**; the
multi-layer generated target networks (the absorbed `network-generator` Story 4) move to a **new,
separate, deferred Story 5b** (single-player generation, net-new in v2, NOT cross-player). Grounding
confirmed v2 has exactly ONE network kind today — the player's home LAN (`generateHomeLan` +
`generateWifi`); there is no mission/corporate/target-network concept yet. The registry already stores
`forward_table` but `resolvePublicScan` ignores it and reads the workstation's ports directly; the
`.1` gateway in `generateHomeLan` is cosmetic (`kind:'router'`, no `machine_id`/ports/FS); `ssh` lands
directly on `workstation_machine_id`. Story 5 makes all three real.

### Locked decisions

1. **Scope** — cross-player home NAT only; multi-layer generated networks → deferred **5b**.
2. **Router = a real machine** — a distinct, journal-backed, **registered** machine the player owns
   (joins the workstation as a persistent registered box; NOT a cosmetic regenerated sibling). It
   bears the public IP and runs its own `sshd` on **22**, with a base FS incl. `/etc/iptables/rules.v4`.
3. **Router sshd is a deterministic seeded boolean** — `seedRouterHasSsh(owner_key)`, a probability
   knob **pinned to 1.0 for now** (every router has ssh open, reachable from the LAN AND the WAN).
   Because it's a single per-router boolean, `routerOwnPorts = {22}` is the **same set on the LAN `.1`
   view and the WAN public view** — so NO per-interface (WAN-vs-LAN) own-port distinction is needed yet
   (matches the dual-homed-scar ship-first guidance). Future: `prob < 1` → some routers run no sshd →
   reach them via a CVE on another open port (future) — the seam is left open, nothing fights it.
4. **Router root credential = weak seeded default** — `seedRouterAdminPw(owner_key)`, server-
   recoverable (like the workstation guest pw), so B can target a **fresh** victim's router with no
   action from A. A changing it (defender hardening) is a later slice.
5. **Single source of truth = `/etc/iptables/rules.v4`** on the router, parsed server-side
   (**lenient** — unparseable lines are ignored: "malform your config, lose that forward"). ONE
   `scanResult(address, vantage)` pure function feeds BOTH scan paths (server `resolvePublicScan` AND
   the client own-LAN `nmap` of `.1`), so they can't drift. The registry `forward_table` column is
   **dropped/demoted to a cache** (today stored but never read).
   - `scanResult(publicIP,  external) = routerOwnPorts ∪ forwardedPorts`
   - `scanResult(routerLanIP, sameLAN) = routerOwnPorts` (forwards NOT visible from the LAN)
   - A forwarded port reports **open only if the target machine's internal port is actually up**
     (reads the target's `/var/run/*.pid` rows) — so `2222→ws:22` shows open iff the workstation's
     `sshd` is running.
6. **Access** — A configures the router via `ssh root@<lan>.1` (LAN-side, owner), `nano`-editing
   `rules.v4`; edits persist to the **shared journal** so B's scan reflects them. Reuses the shipped
   ssh + su + write + materialize paths. (New seam: the router is the FIRST own-LAN-but-journal-backed
   machine — own-LAN ssh today stays local against regenerated siblings, so the router must route to
   the journal-backed flow.)
7. **Port layout** — router owns public **22** (its own sshd); A forwards the workstation on
   **2222 → ws:22** (the collision case, by construction of prob=1). `ssh root@A.publicIp` (22) lands
   on the **router**; `ssh …@A.publicIp -p 2222` lands on the **workstation**. ssh routes by
   destination port through the parsed forward table (`machineServing(addr, port)`).
8. **Default exposure = opt-in** — a fresh `rules.v4` has **no workstation forward**; A adds
   `2222→ws:22` as the test action. The shipped Story 2–4 cross-player E2E gains a front step (A starts
   `sshd` on the workstation AND forwards `2222→ws:22`) before B's
   `crack → connect → nmap → ssh -p 2222 → su → brick` loop. No live players → reshaping the E2E is free
   (`feedback_no_backward_compat`).
9. **B attacks the router** is IN scope — cross-player router root (via the recovered seeded creds) +
   cross-player WRITE to rewrite A's forwards + **router brick**.
10. **Dark-gate generalized by role** — `dark-gate(addr) = canBoot(machineServing(addr))`. The router
    bears the public IP, so `resolvePublicScan` / `authCreateSessionPublic` check the **router's**
    `canBoot` first → **bricking the router takes the whole public IP dark**; bricking the
    **workstation** (behind the NAT) only removes its forwarded ports (the router still answers its
    own). Reuses `canBoot` + `materializeWorkstationFs` per-machine.
11. **Edit UX = build `nano` first** — `nano` is a stubbed `ModeChange` type (`core/commands/types.ts`)
    with NO command and NO editor UI (the UI doesn't handle `mode_change` at all). Build it as a
    standalone primitive (broadly useful: configs, `/etc/passwd`, web content, scripts; legacy-proven
    UX). No `iptables` CLI — A edits `rules.v4` directly in `nano`.

### Child-story split (each vertical + cross-player observable; planned via `planning`)

- **5.0 — `nano`** ✅ **SHIPPED (PR #256, squash `e6bbc59`, 2026-06-17)** — the command +
  `ui/screens/nano.tsx` editor screen handling `mode_change: { kind:'nano', path, content }`, save-back
  via `saveEditor` (FS-view `isNew`), Terminal `<Show>` overlay, denied-save status, full tests +
  live agent-browser E2E. Net-new in v2; unblocks ALL file editing (incl. `nano rules.v4` in 5.1).
- **5.1 — Router as a real machine + player-controlled NAT** _(the meat)_ — router becomes a distinct
  journal-backed registered machine (own `machine_id`, base FS incl. `/etc/iptables/rules.v4`, seeded
  root pw, sshd:22); the shared `scanResult(address, vantage)` total function consumes the parsed
  `rules.v4` and feeds both scan paths; ssh routes through NAT; A `ssh root@.1` + `nano rules.v4` adds an
  opt-in forward, reflected cross-player; the dual-homed `.1`-vs-public invariant holds. **Big →
  `planning` sub-slices into PR-sized increments.**
- **5.2 — B attacks A's router** — B uses the recovered seeded router creds → `ssh root@A.publicIp` →
  root session on A's router → B edits A's `rules.v4` (opens/closes A's forwards). Cross-player router
  L1/L2 (reuse Story 3's machinery for the router `machine_id`).
- **5.3 — Router brick → whole net dark** — the generalized role-based dark-gate; B (root on A's router)
  `rm /boot/vmlinuz` → A's whole public IP goes dark.
- **5b — Multi-layer generated target networks** _(separate, deferred)_ — the absorbed
  `network-generator` Story 4: 2–3 layers, dual-homed gateways, `switch` sub-kind, "see only your
  layer", RFC-1918 variety. Single-player generation, net-new; revisit after Story 5.

### Story 5.1 — resolved implementation decisions (grill-me, 2026-06-17)

The 11 locked decisions above fix Story-5 SCOPE + behavior. These fix 5.1's OPEN IMPLEMENTATION
choices (grilled one-by-one, each grounded in code). Feed straight into `planning`.

1. **Router machine_id** — NEW `computeRouterId(key) = router-${sha256('ed25519-router:'+key)[0..8]}`
   (a DISTINCT hash namespace, not `computeWorkstationId('router', …)`). Different suffix than the
   workstation ⇒ `isOwnWorkstation(routerId)` is **FALSE** ⇒ the router never aliases the workstation in
   any suffix-only own-box check. Server-recoverable from the pubkey alone (`identity/workstation.ts`).
2. **Router base FS** — NEW `buildRouterBaseFsFromIdentity({ownerKeyHex, adminPwHash})`, a sibling of
   `buildWorkstationBaseFs` reusing the `baseFs.ts` toolkit. **ROOT-ONLY** passwd (no player/guest — an
   appliance; B targets root), hash = `md5(seedRouterAdminPw(key))`. Full `/bin`+`/usr/bin`+`/usr/sbin` +`/lib` (so `nano`/`ls`/`cat` RESOLVE when A `ssh root`s in — command availability is binary+library
   gated), `/boot` (brickable → 5.3), `/var/log/{auth,kern}.log`, `/var/run`, `/tmp`, `/root`, PLUS
   `/etc/iptables/rules.v4`.
3. **Router sshd liveness** — realize decision 3's seeded boolean as a **SEEDED PIDFILE**: when
   `seedRouterHasSsh(key)` (pinned true), the base FS stamps `/var/run/sshd.pid = 'sshd:port=22'`
   (`formatPidfileContent`, `services/pidfile.ts`). `scanResult` reads ports via the EXISTING
   `readOpenPorts(materializedTree)` walker — **ONE reader for router + workstation**. Future `prob<1`
   just omits the seeded pidfile (the open seam; nothing fights it).
4. **`rules.v4` format** — port legacy's simplified grammar `forward <pub> to <ip>:<port>`
   (`src/network/iptablesParser.ts` `FORWARD_RULE_RE`), **lenient** (skip `#`/blank/malformed lines),
   ports 1–65535. Parse → `{publicPort, internalIp, internalPort}` (pure, `core/`); a SEPARATE resolver
   maps `internalIp` → the workstation machine via the deterministic LAN IP
   (`assignHomeNetwork(owner_key, essid).localIp`). Seeded default = comment header + a commented example
   pre-filled with the player's OWN ws LAN IP + **NO active forward** (opt-in, decision 8). NOT real
   iptables-save (legacy never used it; no gameplay value).
5. **`scanResult`** — single entry `core/scan/scanResult.ts`:
   `scanResult({ vantage: 'external' | 'sameLAN', routerFs: Directory, resolveTargetPorts: (internalIp) => OpenPort[] }) → OpenPort[]`.
   `own = readOpenPorts(routerFs)`; **`sameLAN` → own only** (the LAN-excludes-forwards scar lives in
   this ONE branch); **`external` → dedupe(own ∪ forwards)** where a forward is kept iff
   `resolveTargetPorts(internalIp)` contains its `internalPort` (decision 5 liveness). `resolveTargetPorts`
   is INJECTED — the server materializes targets + `readOpenPorts`; the client passes a stub (never called
   for the `.1` `sameLAN` scan). It OWNS both the vantage branch and the port computation so the two scan
   paths can't drift.
6. **Registry** — `router_machine_id = computeRouterId(owner_key)` (was the ws id — value-only change,
   column exists, no migration). **DROP the `forward_table` column** (`rules.v4` materialized from the
   router's base+journal is the sole parsed source; `no-backward-compat` makes the drop free) — one
   discrete, wire-checked migration step. **No new columns**: the router's admin pw and `.1` LAN IP are
   both recomputable server-side from `owner_key`+`essid`.
7. **Slice spine for `planning`** (each vertical + observable; walking skeleton FIRST):
   - **5.1.1 (walking skeleton)** ✅ **SHIPPED** as **5.1.1a** (pure primitives, #258 `33e7444`) + **5.1.1b**
     (scan flip, #259 `f9c52ea`) — B's `nmap <A.publicIp>` resolves the REAL router and shows its own
     `:22` (seeded sshd pidfile); default `rules.v4` empty ⇒ the workstation is **dark behind NAT**.
     Exercises `computeRouterId` + `buildRouterBaseFsFromIdentity` + seeded pidfile + real
     `router_machine_id` + `resolvePublicScan` materializing the ROUTER + `scanResult` external-branch with
     empty forwards. (Interim: ssh still lands on the ws until 5.1.2 — automated suite stays green; the
     full agent-browser E2E is reshaped at the end per decision 8.)
   - **5.1.2** ✅ **SHIPPED** (#261 `6d742ee`) — ssh routes by **destination port** via the new pure
     `machineServing({ routerFs, port })`: `ssh root@A.publicIp` (:22) → the router (validated against its
     seeded admin pw, session on `router_machine_id`); an unforwarded `-p 2222` → `host_unreachable` (opt-in
     default). The `-p 2222` → **workstation** half (forward → internal host auth) lands in 5.1.3 with the
     forward itself. (6/6 live wire-check; `RegistryWorkstation` relocated to `authElevateSession`.)
   - **5.1.3** — split into **5.1.3a/b/c** (A's own journal-backed router is a NEW machine category, distinct
     from own-workstation / regenerated-sibling / cross-player-foreign):
     - **5.1.3a** ✅ **SHIPPED** (#263 `3d33021`) — A's own-LAN `ssh root@<subnet>.1` routes to the
       journal-backed router (new `isOwnRouter` + shared `buildRouterBaseFs`): root session on
       `computeRouterId` (seeded admin pw), client materializes the router tree (not a sibling, not a served
       cross-player tree), and `nano /etc/iptables/rules.v4` persists to the **shared router journal** through
       L1 (session-gated, no own-box bypass) + L2 (own-router walker). No api/DB change. agent-browser
       confirm deferred to 5.1.3 close.
     - **5.1.3b** ✅ **SHIPPED** (#265 `47d45b9`) — B's external scan reflects the forward: pure
       `buildWorkstationPortResolver` wires `resolveTargetPorts` for real (materialize A's workstation,
       liveness-gate; handler gate-fetches the ws journal only when `rules.v4` has a forward). `nmap
       <A.publicIp>` shows `:2222` iff ws `:22` up. Live confirm landed with 5.1.3c.
     - **5.1.3c** ✅ **SHIPPED** (#267 `6e7bc2f`) — B's `ssh guest@<A.publicIp> -p 2222` lands on the
       **workstation** (forward→ws auth in `authCreateSessionPublic` via one `resolveAuthTarget` unifying both
       arms + the shared `buildWorkstationResolver`). **Restored** the Story 2–4 agent-browser E2E — full
       decision-8 loop confirmed live (B cross-network `nmap` → `:22`+`:2222`, `ssh guest -p 2222` → `guest@A's
       ws`, `su root` → reads A's `/etc/passwd`); also live-verified the untyped `api/` registry select.
   - **5.1.4** — the dual-homed `.1` **sameLAN** client view: `nmap <subnet>.1` shows the router's own
     `:22` but NOT the forwards (`scanResult(.1, sameLAN)`), closing the dual-homed scar cleanly.

## Next step

**5.0 (`nano`) ✅ SHIPPED. 5.1 PLANNED (`plans/story-5_1-router-nat.md`) + IN FLIGHT — 5.1.1a ✅ (#258,
`33e7444`) + 5.1.1b ✅ (#259, `f9c52ea`) + 5.1.2 ✅ (#261, `6d742ee`) + 5.1.3a ✅ (#263, `3d33021`) + 5.1.3b ✅
(#265, `47d45b9`) + 5.1.3c ✅ (#267, `6e7bc2f`) shipped & merged.** 5.1.3 (split into 5.1.3a/b/c — own
journal-backed router = a new machine category) is now **COMPLETE**: 5.1.3a landed A's own-LAN
`ssh root@<subnet>.1` → journal-backed router + `nano rules.v4` persistence; 5.1.3b wired `resolveTargetPorts`
for real (B's `nmap <A.publicIp>` shows `:2222` iff A's ws `:22` is up); 5.1.3c wired the forward→ws auth
(`ssh guest@<A.publicIp> -p 2222` lands on A's **workstation**, session on `workstation_machine_id`) via one
`resolveAuthTarget` unifying the router and forward arms + the shared `buildWorkstationResolver`. The full
decision-8 cross-player loop was confirmed live (agent-browser vs `vercel dev`+Supabase). Next: **5.1.4** —
the dual-homed `.1` **sameLAN** client view (`nmap <subnet>.1` shows the router's own `:22` but NOT the
forwards), closing the dual-homed scar and Story 5.1. Every slice runs full
RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR (`tdd`, `testing`, `mutation-testing`, `refactoring`).
Model `scanResult(address, vantage)` as a clean total function — each interface its own endpoint, NEVER a
merged view (`project_dual_homed_router_scan_discrepancy`).
