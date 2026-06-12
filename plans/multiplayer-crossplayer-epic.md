# Epic Story-Split: Multiplayer / Cross-player (v2)

**Status**: NOT STARTED — story-split authored 2026-06-13. Consolidates the remaining work from two
now-retired plans (`network-generator-epic.md` Story 4; `scan-logging-cross-player.md` Slice 3b) into one
epic. Each child story below graduates to its own `plans/<slice>.md` (via the `planning` skill) when started.

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
   `machine_id`, not `(player_key, machine_id)`). `player_key` demotes from *identity* to *provenance*
   ("who wrote this line"). An `owner_key` marks the player who owns the box (system/NPC = null).
2. **Public-IP registry** — `public IP → network → router → machines`, server-persisted and queryable, so
   a *different* identity's scan of a public IP resolves to real machines server-side (today
   `generatePublicIp` is deterministic but not registered or queryable by anyone but the owner).
3. **3-tier cross-player read filter** (port legacy `listPatchesForMachines`) — owner / active-session +
   permission-walker / no-session + allowlist. The path by which B reads A's box safely.

**Owner security stance (memory `feedback_multiplayer_ship_first`)**: ship-first — L1 + targeted L3
(gameTime / wallet / hop-chain) is enough to launch. The read filter and L1/L2 here are *core*, not
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
   shared record is the player's *own* workstation — the most concrete "another player's machine."
2. **Public-IP + router NAT FIRST** (not same-wifi-LAN first). The headline build target is
   `scan public IP → router forwards ports → internal machine`. Same-ESSID shared-LAN occupancy is a
   deliberate follow-up (**Story 7**), even though it's part of the stated vision.
3. **Consolidate + delete** — this file replaces the two old plans, which are deleted.

---

## Recommended first slice (walking skeleton)

> **Story 1** — Joining a home network registers your workstation as a shared, server-persisted record
> under your network's public IP; another player's `nmap <your public IP>` resolves it server-side and
> returns its open ports.

**Why this first**: it is the irreducible cross-player whole. You cannot observe *any* cross-player
behavior without (a) the shared machine record, (b) the public-IP registry, and (c) server-side
resolution of one identity's scan against another's machine. It burns down all three architecture risks
at once behind the thinnest observable behavior, and it is demonstrable with two browsers. NAT is
**degenerate** here (the public IP maps straight to the single workstation, all ports) — the registry
stores `publicIp → { routerMachineId, forwardTable }` with `forwardTable = "everything → workstation"`,
the exact seam Story 5 swaps for real iptables rules with **no rework of the registry shape**.

## Split candidates (ordered, each vertical + observable)

| # | Slice (actor + action + scope) | Value | Includes | Defers | Acceptance examples | Release |
|---|---|---|---|---|---|---|
| 1 | **Cross-player public-IP discovery** of a shared workstation record (walking skeleton) | First cross-player observable; burns down registry + shared-record + server-resolution risk | Join → register `(publicIp → network → workstation machine_id)` server-side; flip workstation patches to a shared `machine_id` row; `nmap <public IP>` resolves server-side to the workstation's open ports (degenerate NAT) | Selective iptables, multiple internal machines, multi-layer, break-in, read filter, FS write, trace | Two identities A,B; A joins net + has sshd up; **B** runs `nmap <A.publicIp>` → sees port 22 (resolved from A's real record, not a B-side regen); B scans an unregistered IP → no host | Internal-only / flag — observable, not yet a full loop |
| 2 | **B reads A's filesystem** over the public path (the 3-tier read filter) | Cross-player READ — B sees A's *real* files, not a per-viewer regen | `ssh user@<A.publicIp>` (creds in hand) → session on A's shared record → `ls`/`cat` A's actual persisted files via owner/session+walker/allowlist read filter | Writing, root, bricking, trace | B `ssh`es in, `cat`s a file **A created**; an identity with no session/allowlist hit → `403 no_session`; A still reads its own box unchanged | Shippable |
| 3 | **B modifies A's filesystem** | The "make changes" half of the vision | B (session on A's box) create/edit/delete a file → persists to A's shared record → A and other authorized viewers see it; L1 (session) + L2 (walker) server-enforced against the shared record | Root escalation, bricking, trace | B writes `/home/A/pwned.txt`; A reloads and sees it; B writes a path L2 forbids at B's tier → rejected | Shippable |
| 4 | **B escalates to root → bricks A's machine** | The dramatic payoff — persistent cross-player damage | Root escalation via **`su` with the obtained root password** (no privesc-CVE primitive needed — see Parking Lot) → a destructive/bricking action persists to A's shared record; A's box is observably damaged next load | — | B `su`s to root with A's password, performs the brick action; A's machine is broken on next load; B without root cannot | Shippable (bricking is gameplay-renewable) |
| 5 | **Real router NAT / iptables port forwarding** (selective + multi-target + multi-layer) | The owner's explicit iptables ask; "scan public IP uncovers *forwarded* ports → internal machines" becomes real & selective | Replace degenerate NAT: router is the public-IP-bearing machine; PREROUTING DNAT maps specific public ports → specific internal machines; scanning shows only forwarded ports; connecting hits the mapped internal box. **Each dual-homed interface is its own addressable endpoint with its own port view** — `scanResult(address, vantage)` is a clean total function, NEVER a merged view (see Warnings: dual-homed scar). **Absorbs network-generator Story 4** (2–3 layers, dual-homed gateways, `switch` sub-kind, "see only your layer", RFC-1918 subnet variety) | — | `nmap <publicIp>` shows the router's own ports **+** the forwarded ports; `nmap <router .1>` from inside the LAN shows the router's own ports **only**, NOT the forwarded ones (PREROUTING doesn't apply LAN-internal); `ssh <publicIp>:<fwd port>` lands on the mapped internal machine, not the router; scanning from inside a layer sees only that layer + its gateway | Shippable |
| 6 | **Cross-player scan/connection trace** (scan-logging Slice 3b) | Emergent PvP discovery — defender reads logs, sees attacker IP | Re-key the shipped **3a** per-viewer kern.log/auth.log write onto the **shared** record; scanning/connecting a real player workstation leaves a trace its owner (or a 3rd player) reads | New formatters (all shipped in 3a) | B scans A → A `cat /var/log/kern.log` sees B's source IP; a 3rd identity who breaks into A also reads it | Shippable |
| 7 | **Same-wifi shared-LAN occupancy** (deferred branch of the vision) | The "two players on the same wifi" scenario — same `/24`, no NAT, LAN IPs | Two identities who crack the same AP (ESSID) land on the same `/24`; `nmap` of the LAN shows the other's workstation as an occupant; same-LAN source-IP realism (LAN IP, not NAT) | — | A,B both crack ESSID X → both on `192.168.x.*`; B `nmap`s the LAN, sees A's workstation; B connects over the LAN IP | Shippable |

## Parking lot

- **Story 1 is the largest child** — it bundles registry write-on-join + shared-record schema flip +
  server-side nmap resolution. That is intentional (it's the irreducible skeleton) but `planning` MUST
  sub-slice it into PRs (e.g. 1a register-on-join; 1b shared-record read path; 1c nmap public-IP server
  resolution). Watch for it ballooning.
- **Story 4 privesc vector — RESOLVED (2026-06-13).** No privesc-CVE primitive is needed to build or test
  the brick payoff: escalation is **`su` with the root password the attacker has obtained**. For the
  epic's testability the dev authors both identities and knows both root passwords, so Story 4 is testable
  with shipped `su` alone. The *realistic* gameplay question of how an attacker obtains another player's
  root creds (hydra / leaked creds / library-CVE → `msfconsole --local`, memory
  `project_v2_library_cve_privesc`) is a **separate, parked gameplay concern** — it does NOT block this
  epic. Story 4 just assumes creds-in-hand.
- **Story 6 could be pulled earlier** — it's ~90% shipped (only a re-key onto the shared record from
  Story 1). It's placed after the write/brick payoff by priority, but it's cheap and could slot in right
  after Story 2 (which brings the read filter it depends on) if PvP-discovery is wanted sooner.
- **Story 7 (same-wifi)** is genuinely part of the owner's stated vision but deferred by decision #2. Keep
  it visible — it mostly reuses Story 1's shared record + occupancy registry, minus NAT.
- **`owner_key` / provenance schema** — the exact `patches` schema change (drop `player_key` from the PK,
  add `owner_key`, keep `player_key` as a provenance column) is the central migration. No live players →
  free to reshape (`feedback_no_backward_compat`), but this rule sunsets at multiplayer announce. Decide
  the column shape when planning Story 1.
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
  L2/isolation gold-plating, but owner/session/allowlist tiering is the *core* cross-player boundary.
- **Don't relabel the schema flip as its own story.** It has no observable behavior alone — it rides
  inside Story 1. (No "build the shared-record table" component story.)
- **Story 1 service assumption — CONFIRMED (2026-06-13).** A player workstation can run **sshd** (open
  port 22), so `nmap <public IP>` returns a non-empty result. The only genuinely new mechanism the whole
  epic still needs is **iptables port-forwarding** (router → internal machine, Story 5) — every other tool
  (nmap, ssh, su, writable remote FS, sessions) is shipped. Story 1's plan must wire "open sshd on your
  own workstation" if that isn't already a player-reachable action.

## Next step

Load `planning` for **Story 1** to turn it into PR-sized implementation slices (likely 1a/1b/1c per the
parking lot). Every implementation slice runs the full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR cycle —
load `tdd`, `testing`, `mutation-testing`, `refactoring` before code. Optionally run `find-gaps` on this
split first to harden acceptance examples (esp. the Story 4 privesc vector and the Story 1 service
assumption). No production code until Story 1's plan exists.
