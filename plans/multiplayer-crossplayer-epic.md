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
everyone. **Story 5 is NEXT** (real iptables NAT / multi-layer). Story-split
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

| #                                     | Slice (actor + action + scope)                                                          | Value                                                                                                                       | Includes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Defers                                                                                              | Acceptance examples                                                                                                                                                                                                                                                                                                                                                       | Release                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1 ✅ **DONE** (#234+#235)             | **Cross-player public-IP discovery** of a shared workstation record (walking skeleton)  | First cross-player observable; burns down registry + server-resolution risk                                                 | Join → register `(publicIp → network → workstation machine_id)` server-side; `nmap <public IP>` resolves server-side to the workstation's REAL open ports (read from the owner's existing `/var/run/*.pid` rows via the registry's `owner_key`; degenerate NAT). **No schema flip — deferred to Story 3.**                                                                                                                                                                                                                                                               | Selective iptables, multiple internal machines, multi-layer, break-in, read filter, FS write, trace | Two identities A,B; A joins net + has sshd up; **B** runs `nmap <A.publicIp>` → sees the real port (E2E proved `2222/tcp` from A's `sshd 2222`); B scans an unregistered IP → no host                                                                                                                                                                                     | ✅ Shipped (internal-only — not yet a full loop)                              |
| 2 ✅ **DONE** (#237+#238+#239+#240)   | **B reads A's filesystem** over the public path (the 3-tier read filter)                | Cross-player READ — B sees A's _real_ files, not a per-viewer regen                                                         | 2a join persists A's workstation identity; 2b `ssh guest@<A.publicIp>` → session on A's REAL record; 2c server-materializes A's tree + tier-2 walker filter; 2d tier-1 owner (full) + tier-3 no-session externally-observable allowlist. SERVER-served (D1) — the wire is pruned to the caller's tier before it leaves. **No schema flip — deferred to Story 3.**                                                                                                                                                                                                        | Writing, root, bricking, trace                                                                      | B `ssh`es in, `cat`s a file **A created**; guest can't read `/root`/passwd hashes; no-session → allowlist only; owner reads its own box full + unchanged                                                                                                                                                                                                                  | ✅ Shipped (read loop live: `crack → connect → nmap → ssh → ls/cat`)          |
| 3 ✅ **DONE** (#242+#243+#244+Slice4) | **B modifies A's filesystem**                                                           | The "make changes" half of the vision                                                                                       | Slice 1 flipped `patches` to a shared chronological journal (PK `(machine_id,path,writer_key)`, server `updated_at`); Slices 2–4 added the cross-player L2 (owner-materialized registry branch, D6), the write **boundary** (creates gated by the containing dir), and **tombstone-always** `rm` (a delete is a timestamped event, so delete-then-recreate replays chronologically). L1 (session) + L2 (walker at the login tier) server-enforced.                                                                                                                       | Root escalation, bricking, trace                                                                    | B writes `/tmp/pwned` on A → A sees it; B denied off the guest-writable set; B `rm`s → A sees gone; A re-creates → wins                                                                                                                                                                                                                                                   | ✅ Shipped (write loop live: `crack → connect → nmap → ssh → create/edit/rm`) |
| 4                                     | **B escalates to root → bricks A's machine**                                            | The dramatic payoff — persistent cross-player damage                                                                        | Root escalation via **`su` with the obtained root password** (no privesc-CVE primitive needed — see Parking Lot) → a destructive/bricking action persists to A's shared record; A's box is observably damaged next load                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                   | B `su`s to root with A's password, performs the brick action; A's machine is broken on next load; B without root cannot                                                                                                                                                                                                                                                   | Shippable (bricking is gameplay-renewable)                                    |
| 5                                     | **Real router NAT / iptables port forwarding** (selective + multi-target + multi-layer) | The owner's explicit iptables ask; "scan public IP uncovers _forwarded_ ports → internal machines" becomes real & selective | Replace degenerate NAT: router is the public-IP-bearing machine; PREROUTING DNAT maps specific public ports → specific internal machines; scanning shows only forwarded ports; connecting hits the mapped internal box. **Each dual-homed interface is its own addressable endpoint with its own port view** — `scanResult(address, vantage)` is a clean total function, NEVER a merged view (see Warnings: dual-homed scar). **Absorbs network-generator Story 4** (2–3 layers, dual-homed gateways, `switch` sub-kind, "see only your layer", RFC-1918 subnet variety) | —                                                                                                   | `nmap <publicIp>` shows the router's own ports **+** the forwarded ports; `nmap <router .1>` from inside the LAN shows the router's own ports **only**, NOT the forwarded ones (PREROUTING doesn't apply LAN-internal); `ssh <publicIp>:<fwd port>` lands on the mapped internal machine, not the router; scanning from inside a layer sees only that layer + its gateway | Shippable                                                                     |
| 6                                     | **Cross-player scan/connection trace** (scan-logging Slice 3b)                          | Emergent PvP discovery — defender reads logs, sees attacker IP                                                              | Re-key the shipped **3a** per-viewer kern.log/auth.log write onto the **shared** record; scanning/connecting a real player workstation leaves a trace its owner (or a 3rd player) reads                                                                                                                                                                                                                                                                                                                                                                                  | New formatters (all shipped in 3a)                                                                  | B scans A → A `cat /var/log/kern.log` sees B's source IP; a 3rd identity who breaks into A also reads it                                                                                                                                                                                                                                                                  | Shippable                                                                     |
| 7                                     | **Same-wifi shared-LAN occupancy** (deferred branch of the vision)                      | The "two players on the same wifi" scenario — same `/24`, no NAT, LAN IPs                                                   | Two identities who crack the same AP (ESSID) land on the same `/24`; `nmap` of the LAN shows the other's workstation as an occupant; same-LAN source-IP realism (LAN IP, not NAT)                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                   | A,B both crack ESSID X → both on `192.168.x.*`; B `nmap`s the LAN, sees A's workstation; B connects over the LAN IP                                                                                                                                                                                                                                                       | Shippable                                                                     |

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

## Next step

**Stories 1 + 2 + 3 + 4 ✅ COMPLETE.** Story 1 (#234 + #235); Story 2 (#237–#240, v0.59.0) — read loop;
Story 3 (#242–#245, v0.63.0) — write loop; **Story 4 (#249–Slice-4, v0.67.0) — the brick payoff:**
`crack → connect → nmap → ssh guest@<A.publicIp> → su root → rm /boot/vmlinuz → reboot`, after which A
is **permanently bricked** (a `/boot` tombstone on the shared journal — `core/boot/bootFiles.ts`
`canBoot`, journal-derived, no recovery) and goes **dark to everyone**: `resolvePublicScan` → host-down,
`authCreateSessionPublic` → `404 host_unreachable` (both materialize A via
`core/network/materializeWorkstationFs.ts` then `canBoot` before any port/password work). su-elevation is
server-authoritative (`core/sessions/authElevateSession.ts`); the boot screen
(`ui/screens/boot.tsx`) + `reboot` (`core/commands/reboot.ts`) detect/trigger it. As-built reference:
`v2/docs/cross-player-architecture.md` §7.

**NEXT: Story 5 — real iptables NAT / multi-layer depth** (replaces the degenerate
`router_machine_id = workstation` + wildcard `forward_table` shape Story 1 stored as a deliberate seam;
folds in the retired `network-generator-epic.md` Story 4 — multi-layer depth + dual-homed gateways).
**Model `scanResult(address, vantage)` as a clean total function — each interface its own endpoint, NOT a
merged view** (legacy dual-homed-router scar, `project_dual_homed_router_scan_discrepancy`). Load
`planning` for Story 5 → PR-sized slices; run `grill-me`/`find-gaps` first. Every slice runs full
RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR (`tdd`, `testing`, `mutation-testing`, `refactoring`).
