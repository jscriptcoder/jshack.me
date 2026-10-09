# v2 — project arc & current status

Where the v2 rewrite stands, where to pick up next, and the record of how it got here. The working
rules are in [`conventions-and-gotchas.md`](./conventions-and-gotchas.md), deliberately deferred
work and future ideas in [`backlog.md`](./backlog.md), and the live status of a slice in flight in
its `plans/*.md`. When this doc and the code disagree, the code wins — fix the doc.

---

**The game was rewritten from scratch in Solid.js (v2), which now IS the repo; the legacy React
app was removed (source at git tag `legacy-final`, docs in [`legacy/`](./legacy/README.md)).** Why: legacy was single-player-first React with multiplayer
retrofitted (repeated deep scars) + pervasive React stale-closure bugs. The rewrite is
**multiplayer-first / server-authoritative**, Solid signals, with a **framework-agnostic
`core/`**. Design intent: [`legacy/rewrite-blueprint/`](./legacy/rewrite-blueprint/README.md).

Shipped so far (each milestone is in git history + its as-built doc/plan):

- **Generator epic** (Stories 0–1.5) ✅ — world generation from the Ed25519 identity.
- **Multiplayer / cross-player epic** (Stories 1–7) ✅ COMPLETE (v0.71.0). As-built:
  [`cross-player-architecture.md`](./cross-player-architecture.md) (**read first** for any
  cross-player work). Full live loop:
  `crack → connect → nmap <A pub IP> → ssh guest@<A.publicIp> → (read/create/edit/rm) →
  su root → rm /boot/vmlinuz → reboot`, after which A is **permanently bricked** (a `/boot`
  tombstone on the shared journal — `core/boot/bootFiles.ts` `canBoot`, journal-derived, no
  recovery) and **dark to everyone**. Stories 5 (cross-player home NAT), 6 (scan/connect/su
  traces), 7 (same-wifi shared-LAN occupancy) all shipped. The epic's plan file was retired on
  close-out; its deferred tail lives in `backlog.md` under "Cross-player / multiplayer deferred".
- **Story 5b — multi-layer generated networks ✅ COMPLETE (v0.85.0).** A home has a deep
  gateway **chain** behind its inner gateway: `inner → L2 → L3 …` (`seedNetworkDepth` 1–3,
  a max), keyed by the fronting gateway's `machine_id`. Each chain door is reachable
  (`ssh user@<inner>:<fwd>`), scannable (upstream + pivot), and player-configurable (L2
  write to its `rules.v4`/`acl.conf`). Chains mix **routers and switches** (a switch is a
  chain leaf that forwards nothing but ACL-filters its own downstream via `acl.conf`).
  **Deep-layer traces** log source = the fronting gateway's `<deep subnet>.1`: a deep ssh
  reach appends an `auth.log` line on the landed box (`Accepted`/`Failed password … from
  <.1>`); a deep-layer `nmap` is recorded by the same `nmapScan` action as a LAN one (on
  `/api/patches`), which appends `kern.log` per touched deep host through the shared
  `core/scan/deepScanHosts` resolver (client render + server trace can't drift; a switch
  fronting the layer records post-ACL ports) from the scanner's address on that layer.
  ⚠️ Two claims here were **superseded by shared-network reconciliation** (below):
  the **octet reservation** in `mergeLanOccupants` is gone (Slice 4), and depth is no longer
  per-player — chains are **ESSID-shared** (Slice 5), so the "cross-player depth deferred"
  note no longer applies. A fixed-IP mission catalog is still deferred (`backlog.md` under
  "Cross-player / multiplayer deferred"); pivot source-IP masking shipped as the operate-from-a-hop
  epic.

- **Unique public-IP allocation ✅ COMPLETE (v0.87.0).** A network's WAN address is now
  **server-issued and stored**, not derived: `network_public_ips(essid PK, public_ip UNIQUE)`
  plus a server-only `allocatePublicIp(essid, deps)` (lazy allocate on an ESSID's first join →
  draw via `generatePublicIp` → `INSERT … ON CONFLICT (essid) DO NOTHING` to win-or-read →
  redraw on a `public_ip` 23505; permanent, no GC), wired into `registerNetwork` in place of the
  old `home-public-${essid}` PRNG derivation (which could birthday-collide across ESSIDs).
  `assignHomeNetwork` returns `{localIp, hostname}` only — **no client-side public IP remains**.
  Superseded 2026-09-28 and retired 2026-09-29: every network's address is now derived from
  its place in the world (`world.ts` `publicAddress`), and the allocator, `generatePublicIp` and
  the table are gone (`20260929000000_drop_network_public_ips.sql`).

- **Shared-network reconciliation ✅ COMPLETE (sharing work at v0.94.0; registry removed in Slices 6a + 6b below)** (epic doc item #5, grilled & resolved
  2026-07-25). The ESSID becomes the seed for the whole LAN. Merged so far:
  - **Slice 1 (v0.88.0)** — one shared, contested AP gateway per ESSID; the per-player router
    retires. `computeApGatewayId(essid)`, ESSID-seeded hostname + admin password.
  - **Slice 2 (v0.89.0)** — a bricked AP gateway is dark on every interface, not just the WAN.
  - **Slice 3a (v0.90.0)** — occupant LAN addresses are **leased**, not derived:
    `network_lan_leases(essid, owner_key PK, octet, UNIQUE (essid, octet))` +
    `core/network/allocateLanLease.ts` (read-first → offer the derived octet → redraw on a
    `(essid, octet)` 23505 → bounded exhaustion), allocated in `registerNetwork` before any
    write. The first candidate is the octet the old derivation issued, so existing occupants
    lease the address they already hold and nobody is relocated. Leases are **permanent and
    outlive occupancy** (no GC) — reconnecting returns you to your address. Wire-check:
    `scripts/testLanLeaseAllocation.ts` (includes a genuinely concurrent colliding join).
  - **Slice 3b-i (v0.91.0)** — every address the SERVER resolves comes from the lease.
    `core/network/lanAddress.ts` holds the split: the `/24` stays ESSID-derived (it belongs to
    the AP), the host octet is the lease. `resolveOccupants` / `authCreateSessionSameLan` /
    `nmapScan` take one `listLeasesByEssid` read behind the LAN-boundary gate;
    `resolvePublicScan` / `authCreateSessionPublic` take a single-row `readLease` and
    `buildWorkstationResolver` now TAKES `lanIp` rather than deriving it, so the NAT-forward
    gate and the same-LAN path can never disagree on where a box is. ⚠️ The public half was
    **superseded at v0.99.0** (below): those two now take the ESSID-wide `listLeasesByEssid`
    like their same-LAN siblings, and `buildWorkstationResolver` is gone.
  - **Slice 3b-ii (v0.92.0, `879dcc4`)** — the player's OWN address is the leased one, and the client
    stops deriving addresses entirely. `registerNetwork` RETURNS the leased `local_ip`, so
    the join is what issues an address; `generateHomeLan` no longer places the player at all
    (it emits NPC filler only, still holding the derived octet vacant because the allocator
    offers that octet first), and the own view appends the player at the address `wlan0`
    holds via `withSelfHost`. **Offline posture**: `lanLeaseCache` remembers the issued
    address per ESSID — written by `persistConnection` (the ONE writer, so every path that
    addresses `wlan0` is covered), read by `restoreConnection` and by `joinHomeNetwork`'s
    fallback. A reconnect to an already-leased network works with the server down; a FIRST
    join to a new ESSID with the server unreachable now FAILS (`nmcli` reports it, `wlan0`
    stays clear) rather than silently addressing the player. `env.homeNetwork.join` returns
    `HomeNetworkAssignment | null` and both unwired fallbacks return null — nothing in the
    client allocates an address any more.
  - **Slice 4 (v0.93.0, `6733821`)** — every occupant of an ESSID sees the SAME LAN. `generateHomeLan`
    takes only the ESSID (no identity at all) and reads `lanSubnetPrefix` directly, so one
    population stands on the AP's `/24` for everybody. The L1 gateway devices moved with it:
    `computeInnerGatewayId` / `buildInnerGatewayBaseFs` / `buildSwitchBaseFs` /
    `seedInnerGatewayHostname` / `seedInnerGatewayAdminPw` are now keyed `(essid, octet)`, so
    two occupants reach ONE inner gateway with one journal and one root password. So are the
    NPC boxes themselves — `buildRemoteHostFs` / `hostServices` / `buildDeepHostFs` are keyed
    `(essid, ip)`: sharing a `machine_id` is not enough, because the journal replays over the
    base tree, and a per-viewer tree meant one occupant's write landed on a machine the other
    did not have. This closes the `hostMachineId` **aliasing bug** (two occupants' same-octet
    NPCs collided onto one id from a 6-name pool roughly 1 in 6 draws, quietly sharing a
    journal between boxes that were not the same box). Two rules died with it: the
    **gateway-octet reservation** in `mergeLanOccupants` (an occupant is never hidden now —
    the occupant wins over any generated host, whatever kind) and the **reserved-octet
    vacancy** in the generator. Both were only ever workarounds for a population no allocator
    could see; `allocateLanLease` now takes the ESSID's NPC octets as an **exclusion set**
    covering the preferred octet AND every redraw, with `drawLanOctet` drawing from the
    allowed pool so an exclusion never costs an attempt. Exclusion governs what may be
    ISSUED, not what is held: an existing lease is returned untouched.
  - **Slice 5 (v0.94.0, `2f79349`)** — the deep chain is shared too, so an ESSID's whole world is one
    world. `seedNetworkDepth(essid)`, `generateDeepLayer(essid, fronting, options)`,
    `computeDeepGatewayId(parent, octet)`, `seedDeepGatewayAdminPw(parent, octet)` and the deep
    base filesystems all dropped the owner key; **no generator in `core/` takes an identity any
    more**. Nothing gained an ESSID parameter it lacked — the parent id is ESSID-derived up to
    the inner gateway, so the chain inherits network separation rather than restating it, and
    `parentMachineId + octet` remains the whole anti-aliasing discriminator. Two names went with
    the concept: `ownLanBaseFsForMachineId` → `lanBaseFsForMachineId`, and
    `ownChainBaseFsForMachineId` → **`generatedBaseFsForMachineId`** — that one is the
    cross-player discriminator, and what it separates is now boxes the NETWORK generates from
    the only machine that genuinely belongs to a person, another player's workstation.
    `enforceRemoteWriteL2` lost its `publicKey` (identity is L1's question), which moved the
    shared-write evidence up to `handleUpsertPatch` where a verified signer still exists.
  - **Slices 6a + 6b** — the registry table is **gone**. 6a re-homed every cross-player lookup
    onto `network_public_ips` + `home_network_occupants` and fixed the bug that fell out of it
    (a machine that had left the WiFi stayed readable AND writable); 6b dropped the table, its
    index, and its write, swapping the reverse-lookup index onto `home_network_occupants`.
    `reduce-system-complexity` governed the pair, `tdd` the behaviour-changing slices before
    them. A follow-up item then makes the ESSID space procedurally generated and large, and
    tunes the occupied-ESSID injector down.

- **Every occupant of a shared AP is forward-reachable ✅ (v0.99.0).** The last piece of item #5's
  decision 1 ("the gateway's ports are its own `sshd` ∪ EVERY occupant's forwards"), deliberately
  left out of the registry reduction so that stayed behaviour-preserving. `ApNetworkLookup` is now
  just `{ router_machine_id, essid }` — the AP itself — and both public paths
  (`resolvePublicScan`, `authCreateSessionPublic`) resolve a forward's `internalIp` by matching it
  against `lanAddressesByOwner(essid, leases)` over the ESSID's current occupants. The shared pure
  half moved to `core/network/natHosts.ts` (`bootableOccupantFs` + `natPortResolver`), replacing
  the single-host `workstationPortResolver`. Two forced consequences: the ownerless gateway's own
  `kern.log`/`auth.log` rows now key on a STABLE writer (`core/logging/apGatewayLogWriter.ts` —
  the lowest octet leased on the ESSID) instead of the most recent joiner, which was silently
  truncating those logs every time somebody joined; and a forwarded-port login now logs under the
  key of the box it actually reached.

- **An editor save never destroys unseen content ✅ (v0.101.0 server, v0.102.0 confirm).** Closes
  the write-wipe found by the v0.99.0 Act 4 run. `PatchApi.write` takes the content the caller was
  SHOWN; the adapter fingerprints it (`core/patches/contentHash.ts`, shared by both ends so they
  cannot drift) and sends `base_hash`. `handleUpsertPatch` compares it against
  `orderPatchesForReplay(rows for that path).at(-1)` — the row a READER materializes, `writer_key`
  tiebreak included, or the guard would reject saves that raced nothing — and answers `409
  modified_since_open`. Three placement decisions are load-bearing: the check runs **after** the
  L1/L2 gates (a caller who may not write the path must not learn somebody is editing it); the dep
  is **path-scoped**, not the machine-wide L2 list, because own-box writes bypass L2 entirely and
  the list is not already on that path; and an **absent** fingerprint is an unconditional write, so
  `>`/`touch`/`apt`/sshd are exempt by construction rather than by a special case. Nano turns the
  409 into GNU nano's own `(y/n)` question, takes the textarea read-only while it stands, and `y`
  re-sends with **no** fingerprint. A landed save advances the base to what it wrote (`^O` keeps
  the editor open); a refused one leaves it alone. Wire-check `scripts/testModifiedSinceOpen.ts`;
  three-player browser verification in `e2e-shared-network-verification.md` §6.

**Legacy parity is COMPLETE — the epic is retired.** Every way into a machine shipped: the doors
(Phase 1), discovery (Phase 2), and the CVE vulnerability system (Phase 3). The ship gate was
legacy parity **minus missions**, and it is met; missions are a post-ship epic. The epic's plan
file (`plans/legacy-parity-epic.md`) was deleted on close-out — its full slice-by-slice as-built is
in git history, and its durable design lives in three as-built docs plus this doc:

- **[`vulnerability-architecture.md`](./vulnerability-architecture.md)** — the CVE system (Phase 3):
  the one recompute-never-store derivation, the three axes, the timeline, effects, traces, and the
  defender's loop.
- **[`discovery-architecture.md`](./discovery-architecture.md)** — DNS and the public web (Phase 2):
  name resolution, the zone transfer, publisher networks and `findit.io`.
- **[`world-content-architecture.md`](./world-content-architecture.md)** — the believable content
  every generated box carries.

The door-by-door as-built (D1–D10) and the cross-cutting design rules stay in this doc and in
`conventions-and-gotchas.md` §6.

**🏁 PHASE 1 (the doors) IS COMPLETE at v0.205.0.** Every door in the locked order has shipped —
web, hydra, ftp, scp, daemons, nc, machine kinds, mysql, redis, snmp, node, and the terminal
itself. **Phase 2 — discovery** opened and closed its first door: X1 (DNS) SHIPPED COMPLETE
(v0.206.0–v0.209.0, #487–#490). X2 (`findit.io`, a search engine over the public web) is grilled;
its slice 1 (an institution has a website you reach by name) SHIPPED v0.265.0–v0.268.0 (#551–#554),
and its slice 2 (findit.io answers a search, and `lynx` submits a form) SHIPPED v0.269.0–v0.270.0
(#555–#556), and its slice 3 (a player's page is found, and can hide behind `robots.txt`) SHIPPED
v0.271.0 (#557), and its slice 4 (findit falls and comes back — a rooted findit's `access.log` is
intel, a defaced front page shows for everyone, and `scripts/restoreFindit.ts` reboots it back to its
generated state) SHIPPED v0.272.0 (#558), and its slice 5 (the `government` category — the police,
the council and the courts, each publishing a `.gov` site, each running the `cases` application)
SHIPPED v0.273.0 (#559). A fix it carried forward shipped v0.274.0 (#560): an institution's site
server serves its public site whatever the box is called, where 15 publishers had served an API
reference or their intranet; and another shipped v0.275.0 (#561): `curl`/`lynx`/`gobuster` read a
router or switch as its own firmware, as `nmap` does, where 66 of 171 had answered a web page on a
port a scan showed closed. Its slice 6 (the `retail` category — four shops publishing `.com`
sites, each running the `shop` application) SHIPPED v0.276.0 (#562), and **X2 is COMPLETE**. The
design and every slice's as-built are in
[`discovery-architecture.md`](./discovery-architecture.md).

**Phase 3 — vulnerabilities is COMPLETE (v0.210.0–v0.247.0, #491–#532).** The whole CVE system
shipped — three axes (service, library, firmware) reading one recompute-never-store derivation, the
attack → patch → inert loop, and reboot eviction; the design and its accepted costs are in
[`vulnerability-architecture.md`](./vulnerability-architecture.md). Three things a v2 session should
still know before touching it:

- **Legacy's service treadmill never ran.** Its 8 libraries were seeded at `startTuple` so the
  LIBRARY timeline worked, but services were seeded `'latest'` — a sentinel picked so no CVE could
  ever match — and `applyVersionOverlay` skips it explicitly. Only mission enrichment ever made a
  service exploitable. Do not read legacy's timeline code as proven gameplay; it is proven
  machinery that was never wired to services.
- **The clock is a hardcoded `WORLD_EPOCH` constant in `core/`**, not a row and not a round trip.
  Client computes `gameDay` to RENDER, server recomputes from its own UTC clock to AUTHORIZE — the
  same split `deepScanHosts` and `sweepWord` already use. Legacy's `localStorage` anchor does not
  survive.
- **`/var/lib/dpkg/status` is the single source of truth for every version**, settled by the service
  catalog's own shipped comment on `banner` ("DELIBERATELY VERSION-FREE … versions are the package
  manifest's to tell"). Nothing else may carry a version.

- **X1 (a name resolves) ✅ SHIPPED COMPLETE — all four slices (v0.206.0–v0.209.0, #487–#490).** The
  fourteen decisions and the as-built per-slice record live in the epic (the per-slice plan file was
  retired at close-out). The durable shape:
  - **A name is an address everywhere an address was.** `core/network/resolveName.ts` owns it:
    `resolveLanName` is pure over `generateHomeLan`, `resolveName` adds the fellow-occupant step,
    and `addressForTarget` is the ONE call `ssh`, `curl`, `nmap`, `ftp`, `nc`, `scp` and `lynx`
    (and a followed `lynx` link) each make before their existing address path. Not a seam on
    `env` — resolution is deterministic from the ESSID, so it needs no round trip and no injection.
  - **The AP gateway resolves, so no DNS box is required.** Names arrive on the first network a
    player cracks rather than the one in seven that draws a `dns` role. A network answers for its
    own names: `<host>.<essid-slug>.lan`, with a foreign slug answering NXDOMAIN.
  - **The world's names come first (X2, v0.266.0).** An institution's domain (`ridgemont.edu`,
    `acme.com` — catalog `site.domain`, case-folded) resolves to its derived `193.` address from
    ANY network, before the LAN and occupant steps and with no occupant round trip. This is why
    `nmap` and `ssh` resolve BEFORE their `isPublicIp` check: a domain has no public shape until it
    is resolved. `gobuster` and `hydra` still take addresses only.
  - **An unresolvable name passes through UNCHANGED**, so each command reaches its own existing
    unknown-target path. There is deliberately no seventh error message. Note `ssh` exits **255**
    there, not 1.
  - **`addressForTarget` only resolves a target with a LETTER in it.** An address, an octet range
    and a CIDR block are digits and separators, and without that guard every ordinary `ssh <ip>` or
    `nmap <range>` would pay an occupant round trip per run. `ssh` reuses the occupant list it was
    already fetching, so a name costs it no extra request.
  - **`dnsutils` ships BOTH binaries and both commands exist** — `dig`'s plain lookup was pulled
    forward from slice 3 rather than leave an installed binary answering `command not found`.
    `dig` REPORTS a query time instead of spending one, seeded off the name.
  - **⚠️ Two routers on one LAN can share a hostname** — both draw from `ROUTER_HOSTNAMES`, and it
    happens on **8 of the 50 crackable ESSIDs**. `nslookup` answers with the lower octet. It
    predates DNS (`nmap` already prints both rows under one name), but slice 2's zone file will
    list the name twice, so decide there rather than rediscovering it.

- **D1 (the web surface) ✅ COMPLETE (v0.109.0).** Five slices — v0.104.0 #344, v0.105.0 #345,
  v0.106.0 #346, v0.107.0 #347, v0.108.0 #348 — plus the v0.109.0 close-out. The plan file is
  deleted; this is its as-built.
  - **The door.** A generated LAN host rolls the `http` service, `nmap` labels its port, and
    `curl http://<its IP>` returns its seeded page (`curl -i` for headers). `ping` answers
    reachability, seeded per address. The first door since `ssh`, and the only one that opens
    with **no credential** at all.
  - **The player's own server.** `nginx`/`apache2` are **two programs for one service**. Each
    writes its own pidfile (`/var/run/nginx.pid`, `/var/run/apache2.pid`), and either is refused
    while either runs, told a web server is already up rather than which program. Root-only. `curl` on the player's own address (or `localhost` /
    `127.0.0.1`) reads their **live** tree, so a `nano` edit changes what a fetch returns.
  - **Cross-player.** `curl http://<their public IP>` returns the page behind that NAT forward
    with **no session and no password**, via `core/network/resolveHttpFetch.ts`.
  - **The defender's record.** Every fetch that REACHED a server writes an Apache-combined line
    to that box's `/var/log/access.log`. Cross-player it is **owner-keyed** with a
    **server-derived** source IP (`core/network/resolveHttpFetch.ts`); own-LAN it is
    caller-keyed via a separate signed action (`core/network/recordLanFetch.ts`), because a
    generated host has no owner and the player's own box is theirs already. 200s and 404s log
    alike, and **a traversal is recorded verbatim as requested, not as resolved** — the
    resolved path would say nothing happened, and a wall of 404s is what `gobuster` will look
    like from the defender's chair in D2.
  - **The confinement.** **Nothing outside `/var/www/html` is fetchable**, and that lives in
    `core/network/http.ts` (`resolveWebPath`), NOT in the filesystem walker — see
    `conventions-and-gotchas.md` §6. The server reads the document root as ITSELF, never as the
    requester, or a page the player just published at root tier would 404 (see
    `conventions-and-gotchas.md` §3).
  - **Wire-checks:** `scripts/testHttpFetch.ts` (17/17) and `scripts/testLanFetchLog.ts` (8/8).
    **Browser-verified end to end** 2026-07-31, both the own-LAN and the two-player
    forward loops — `e2e-shared-network-verification.md` §7.

- **D1d (the sweep across networks) ✅ COMPLETE (v0.130.0).** `gobuster http://<their public IP>`
  finishes the web door's cross-player parity — `curl` reached across from D1, `lynx` from D1b
  slice 7, and this was the last web tool that refused a stranger. Wire-check
  `scripts/testGobusterCrossPlayer.ts` (20/20); live journey as Act 10 of
  `e2e-shared-network-verification.md`.

  - **The path list does NOT cross the wire.** The client sends `caller_machine_id` and the
    server reads `/usr/share/wordlists/dirlist.txt` off THAT machine's journal — the shape
    `hydraCrackPublic` established for the password list, and it applies because the two files
    have identical provenance: `apt install` is the only thing that writes either, so both exist
    purely as patches. The list stays the sole gate with the SERVER enforcing it, and pivoting
    onto somebody else's box means sweeping with whatever list is on it.
  - **`authorizeMachineAccess` runs before anything is read or asked**, so naming a box you
    neither own nor hold a session on cannot borrow its curated list.
  - **One request, one append.** Every path the run asked about lands on the target under ONE
    clock reading — 42 lines for 40 words, the two extra being the directory retry. A round-trip
    per word would re-read and re-upsert the whole log forty times and scatter the defender's
    only tell across forty timestamps.
  - **Sizes come back, pages do not.** Finding a path and reading it stay two acts, and the
    second leaves its own line. Returning bodies here would deliver every page found under the
    sweep's own wall of 404s with nothing recording that they were read.
  - **The trace is VANTAGE-derived** (`resolveVantageSourceIp`): a sweep launched from a box the
    caller only holds a session on is traced to THAT network. ✅ `curl` and `lynx` now derive the
    vantage the same way (operate-from-a-hop slice 7, v0.316.0) — one source-IP rule across the whole
    web door, no home-address stamp.
  - **One definition of a probe** (`core/network/webSweep.ts`, `sweepWord`) shared by the own-LAN
    sweep and the server's, and **one reachability chain** (`resolveWebTarget`, extracted from
    `handleResolveHttpFetch`) shared by the fetch and the sweep — so a path found by sweeping a
    neighbour cannot be missed by sweeping a stranger, and neither tool can reach a box the other
    could not.

- **D2 (the credential layer) ✅ COMPLETE** — D2.1 (v0.111.0), D2.2 (v0.113.0), D2.3 (v0.114.0),
  D2.5 (v0.115.0), both follow-ups (v0.116.0, v0.118.0), D2.4 all five slices (v0.119.0 →
  v0.122.0), and D2.6a (#377). Its split file was deleted on close-out — everything durable from it
  lives in this doc, and the one piece of unbuilt work it named (**D2.6b**, harvestable
  plaintext loot) is a content story in `backlog.md`. PRs #351, #352,
  #354, #356, #357, #358, #359, #362, #370, #371, #372, #373, #374, #375, #376, #377.

  **hydra now reaches every target `ssh` does**, which was the point of D2.4: its own LAN, a
  stranger's AP gateway, the occupant behind a NAT forward, a box on somebody else's network it is
  standing on, and — since v0.122.0 — a host on the deep layer behind an inner gateway. Each of the
  last three resolves through the SAME module `ssh` authenticates through
  (`resolvePublicTarget`, `resolveInnerGatewayTarget`), so the two tools cannot disagree about a
  target or a credential by construction rather than by two resolutions staying in step. Proven on
  the wire, not just argued: `testInnerGatewayReach.ts` feeds the password hydra reported straight
  back into `ssh`, which accepts it and lands on the same box.

  - **The deep layer had no credential door until v0.122.0 (D2.4 slice 5, #376).** Every deep host
    force-runs sshd and carries a `guest` drawn at `CRACK_CHANCE.guest = 1` — content built to be
    entered by a wordlist — but deep IPs are absent from `generateHomeLan().hosts`, so no shell can
    name one, and rooting the gateway yields the forward table rather than any password. The layer
    was **furnished and sealed**. `hydra -p <fwd> <inner gateway>` opens it, and repairs the
    asymmetry the NAT-forward slice created, where `ssh -p 5544 <inner>` reached the deep box while
    `hydra -p 5544 <inner>` attacked the gateway and silently dropped the flag. **The trace there is
    addressed by the ROUTE, not the vantage**: NAT means a deep box only ever sees the fronting
    gateway's `<deep subnet>.1`, whoever is behind it — the one place this departs from the public
    sweep, where the target really does see the attacker's own address.

  - **Cracking reaches other players (D2.4 slices 1-3, v0.119.0 + v0.120.0).**
    `hydra <a stranger's public IP>` sweeps that access point's GATEWAY — a public IP names an AP,
    and `machineServing` routes by destination port before any occupancy work, so the default port
    is the gateway's own sshd rather than any player's workstation. `hydra -p <forwarded port>`
    reaches the OCCUPANT behind a NAT forward: the person, not their gateway. Their guest account
    falls (crackable pool, 1.00); their chosen root password does not, and their own login has no
    password at all — `md5(x)` is never the empty hash, so it is unreachable too.
  - **One resolver decides what a public IP and port reach** —
    `core/network/resolvePublicTarget.ts`, called by BOTH `authCreateSessionPublic` and
    `hydraCrackPublic` (and the exploit, data and snmp doors). A forward to an address no
    occupant leases lands on the box the ESSID generated there (X2, v0.267.0), so an exploit
    through an institution's public `:80` opens a session on its webserver. "hydra must never disagree with `ssh`" is now structural rather than a
    discipline; the wire-check proves it by posting hydra's cracked password straight to the ssh
    action and getting a root session back.
  - **Behind a public IP the PORT is the address, and two rules follow from it** (v0.120.0, #374).
    `PublicTarget.reachedPort` is the port ON THE TARGET that a destination port actually reaches —
    the gateway's own listening port, or the far side of a NAT forward. (1) A caller naming a
    service must match it against `reachedPort`, never against "any port this box has open", or a
    forward to sshd becomes a door to every daemon on the machine — and `ssh` on that port would
    have met the other daemon and refused, so hydra would report a credential `ssh` rejects. (2) A
    result must report the port the CALLER named, not `reachedPort`: through a forward the far side
    is typically `:22`, and `:22` on that public IP is the GATEWAY, a different machine. Reporting
    the internal port names a target the player never attacked. Both were live defects found by
    reading the path before writing the test.
  - **Where the caller is STANDING is a fact the server already holds — the session row** (v0.121.0,
    #375). `sessions.essid` is the network the standing box was generated from, stamped server-side
    when the hop was made, and `authorizeMachineAccess` already returns it. So a trace records the
    address of the network being operated FROM, not the one the actor owns: `hydra` launched from a
    box on somebody else's network is traced to that network. Two rules follow. (1) **Derive the
    vantage from the session, never from the payload** — if placement and the address both came from
    a claimed essid, a player could assert they were standing on A's LAN and write the trace up as A.
    The session row is the whole defence. (2) **A refusal that stands in for a lookup is a bug with
    good manners.** `caller_not_on_lan` existed only because the handler discarded the row it had
    fetched; the slice deleted it rather than replacing it, and a deep-chain box became placeable for
    free because its session carries the caller's own essid. Before adding a refusal for "the server
    cannot know where you are", check whether a session already says.
  - **Every IP tool now pivots ✅** (operate-from-a-hop, #598–#615, v0.307.0–v0.323.0). `ssh`, `nmap`,
    `curl`, `lynx` and the rest each name the box they run from (`caller_machine_id`) and the server
    places the caller (`resolveCallerVantage`), so one shell on a rooted box produces traces that all
    point at the pivot — no mix of pivot and home. `curl` from home still needs no session (decision 6);
    it gains a caller only when the player stands somewhere. As-built: handbook chapter 7
    ("Reachability").
  - **A cross-player trace is written under the TARGET's log-writer key, and its source IP is
    server-derived.** On your own LAN hydra matches `ssh` and trusts the client's address (the
    occupant is an NPC; nobody to frame). Across the network the log is the defender's only
    evidence, so the address comes from the verified key — and a caller the server cannot place on
    their own network is refused rather than traced to a guess.
  - **The first credential earned in-game.** `apt install hydra` → `hydra <LAN host> ssh` →
    a `login:`/`password:` line → `ssh` in with it. `ssh` shipped long ago but took a password no
    player could obtain, so v2's only door was decorative outside tests. This opens it.
  - **`apt` installs data files, not just binaries.** `AptPackage.extraFiles` (path + content +
    permissions) writes through the same journal as everything else, so the wordlist at
    `/usr/share/wordlists/passwords.txt` is an ordinary file — `cat`-able, `nano`-editable, and
    lootable off a box you break into. `apt` scaffolds only the **missing** ancestors: every
    `mkdir` is a permanent journal row, so `mkdir`-ing an existing `/usr` would leave a no-op row
    on the player's box forever. (`patches.write` does NOT create parents — `fsView.ts` refuses
    with `parent_not_traversable`; replay scaffolds, but authorization refuses before replay.)
  - **The crack is server-side, and reads a FILE.** `core/sessions/hydraCrack.ts` mirrors
    `handleAuthCreateSession`'s preamble (regenerate the LAN → resolve the host → materialize its
    journal → `canBoot` → open ports), then sweeps `/etc/passwd` against the wordlist on the box
    the caller is standing on — read from **that machine's journal**, every writer's rows replayed
    with the last write winning (a row with no content is a deletion, so `apt install hydra` stays
    a real recovery). Never a client claim, never an imported constant. Reading the file is what
    makes the APPEND half of "grow your wordlist" free rather than a rewrite — see the next bullet
    for the half it does not buy.
  - **Growing the wordlist works; HARVESTING has no source yet (D2.6, grounded 2026-08-11).** A
    word appended to `/usr/share/wordlists/passwords.txt` opens a door that held — proven end to
    end for both tools by #377, against the real shipped `DEFAULT_WORDLIST`. But a player cannot
    obtain a word they do not already have. Every password comes from `drawPassword` over exactly
    two pools: the crackable one, which the shipped file covers **completely**
    (`defaultWordlist.test.ts` asserts it), and the uncrackable one, which exists **only** as an
    md5 in a target's `/etc/passwd` — nothing prints it and nothing files it, and `john` reverses
    it with the same list that just failed. So cracking teaches a player only words they hold, and
    coverage cannot grow. WPA keys are not a back door: `generateWifi` draws from a separate
    encoded `WIFI_PASSWORDS` pool, so an `aircrack-ng` key opens **zero** ssh doors. Closing the loop
    needs generated loot carrying an uncrackable-pool **plaintext** behind a tier gate (D2.6b,
    `backlog.md`) — the same shape of finding as D2.5's "`john` cracks nothing hydra has not", and
    the same cause: every credential path is closed over one pool pair.
  - **hydra and `ssh` cannot disagree** — both resolve the same `/etc/passwd`, server-side,
    through the same reachability rules. A crack from a locally regenerated baseline would hand
    the player a password `ssh` then rejects, which reads as a broken game.
  - **Not everything falls (D2.2).** One crackable pool and one uncrackable pool
    (`core/generation/passwordPools.ts`), with a `CRACK_CHANCE` per door kind: `guest` 1.00,
    `npcUser` 0.70, `gateway` 0.40, `npcRoot` 0.12. That table is the whole difficulty curve —
    nothing else in the game decides what falls. **A rate is only observable across a
    POPULATION**, and systematically-generated seeds converge slowly; never tune a knob against
    one box or a small `NET-0`/`NET-1` sample.
  - **A sweep is the loudest thing you can do to a box (D2.3).** The target records one
    `auth.log` line per password **TRIED** — not per account, or a three-account sweep would be
    quieter than three ordinary logins — `Accepted` for the one that matched and nothing after
    it, written as ONE append. A refused, dead or serviceless target writes nothing at all, so a
    dead machine cannot be probed through its own log. Unbounded growth is the attacker's
    accepted cost.
  - **`john` is the silent alternative (D2.5).** `john <file>` finds *exactly* what hydra finds —
    same list, same `md5` — so silence is the entire product difference, and it only became worth
    building once the sweep was loud. It reads the file AND the shared wordlist from the CURRENT
    machine, makes no server call, and has no availability gate beyond its binary.
  - **Locked principle: tools run where you stand — SHIPPED (v0.118.0).** `hydra`, `john` and
    `apt install` all work on an NPC box; ordinary tier gates still apply (`apt` needs root on
    THAT box, as real apt does) but there is no "this is not your machine" refusal on top. The
    end-to-end loop needs no `scp`: root an NPC box, `apt install hydra` there, sweep from it.
    Carrying a *grown* wordlist across shipped with D3b (v0.137.0) — `scp ~/passwords.txt
    root@<npc>:/usr/share/wordlists/passwords.txt`, after an `apt install` on that box has
    created the directory `WORDLIST_PATH` points at.
  - **Locked principle: an NPC box is one box, and tier is the only lens.** Everything on it is
    shared; what a player sees is decided by the tier they hold there, never by who wrote it. The
    journal (`listPatches` is machine-scoped) and the materialized tree already worked this way —
    hydra's writer-scoped wordlist read was the codebase's single divergence. A wordlist left on a
    box you rooted is **loot** for whoever roots it next; writes stay root-gated, so growing a
    shared list is still deliberate.
  - **Where you stand is decided by `authorizeMachineAccess`, not a bespoke check.** hydra's
    server half uses the same L1 rule as `upsertPatch`/`listPatches`/`removePatch` — own
    workstation, or an ACTIVE session on that machine — so a sweep and a write from one shell
    cannot disagree about where the player is. It returns the session's `userType`/`essid` too.
  - **A trace names an origin the server can derive, or the sweep is refused.** The address comes
    from the caller's machine resolved on the regenerated LAN, never from the request, so a pivot
    cannot be written up as somebody else. The own workstation keeps the client's `source_ip`
    (matching `ssh` on the LAN). A caller that cannot be placed — a deep-chain box, another
    player's workstation — is refused `caller_not_on_lan` rather than traced: a guessed origin in
    a defender's log is worse than a refusal.
  - **⚠️ `env.network` inside a remote session is the PLAYER's connectivity, not the box's.**
    `networkView` reads one global `connectivity()` (`ui/env.ts:179-192`), so a command run from a
    hop sees the player's own interfaces. The essid that falls out is still correct — it is the
    LAN whose hosts you can reach — but `wlan0.ipv4` is the **workstation's** address. That is why
    hydra's trace address is derived server-side. Any future command reading `env.network` from a
    hop inherits this.
  - **A shipped data file becomes the PLAYER's.** `apt install` never overwrites an `extraFile`
    that already exists — growing the wordlist by hand is the progression, so a reinstall would
    have destroyed it silently. Per-FILE, not an already-installed short-circuit: hydra and john
    both tell a player with no wordlist to reinstall hydra to get one back, so an absent file is
    still written.
  - **Wire-check:** `scripts/testHydraOwnLan.ts` (23/23). Two load-bearing checks. The first
    withholds a single password: with a full wordlist everything cracks, so a handler ignoring the
    list entirely passes every other assertion in the file. The second seeds the wordlist under
    **another writer's key** — a writer-scoped read passes everything else. It also clears *every*
    writer's row at the path between checks, since a leftover foreign row silently arms later ones.
  - **Carried into D2.4:** the same-LAN trace trusts the client's `source_ip` deliberately for the
    OWN WORKSTATION, to match `ssh` (`authCreateSession.ts:196`) where the occupant is an NPC and
    there is nobody to frame; every other vantage is server-derived. **Cross-player must switch to
    `resolveCrossPlayerSourceIp`.** D2.4 also owns extending the shared-wordlist rule to another
    player's box, which is refused today — same slice, since it needs the same derived address.

- **D3 (`ftp` — the door) ✅ COMPLETE (v0.136.0).** Six slices — v0.131.0 #393, v0.132.0 #394,
  v0.133.0 #395, v0.134.0 #396, v0.135.0 #397, v0.136.0. A second way into a machine, from the
  daemon on a generated host all the way to another player's box behind a NAT forward. The
  durable rules it established live in `conventions-and-gotchas.md` §6 (the four `ftp` bullets); the
  shape of it:
  - **The door is a `kind`, never a second authorization dimension.** One `/etc/passwd`, one
    tier, one resolver. `sessions.kind` routes the *log* (`SERVICE_CATALOG[kind].sweepLog`) and,
    since slice 6, the *service check* on the reached port — and nothing else.
    `authorizeMachineAccess` and `remoteWritePermission` were never taught a second protocol
    exists, on the LAN or across the network, which is the claim the whole epic was built to
    test. If a third door needs either module changed, stop and re-open the design.
  - **The session runs BESIDE the shell, not on top of it.** `ssh` pushes a hop and moves the
    cwd; `ftp` holds a parallel session with its own cwd, its own journal (`ftpPatches`) and its
    own tier, so `ls`/`cd`/`pwd` address the remote while `lls`/`lcd`/`lpwd` address the box the
    player is standing on. A refresh ends it rather than restoring it as a hop.
  - **It is the LOUD door — and that is the price of it being a second one.** Reading a file over
    ssh is silent; over ftp the box's own `/var/log/vsftpd.log` names the arrival, the login (both
    outcomes, so a wordlist sweep is a visible wall), and every transfer with its path and byte
    count in either direction. One file, one shape, one row.
  - **Across the network it is the same door.** `ftp [-p port] <public IP> [user]` resolves
    through `resolvePublicTarget` exactly as `ssh` and `hydra` do, so the credential `hydra`
    reports on a forwarded port is the one that opens it. Proved live end to end in Act 11 of
    [`e2e-shared-network-verification.md`](./e2e-shared-network-verification.md).
  - **Wire-checks:** `testFtpSession` (14/14), `testFtpRemoteRead`
    (7/7), `testFtpPut` (12/12), `testFtpTransferTrace` (13/13), `testFtpSweepTrace` (8/8),
    `testFtpCrossPlayer` (16/16).
    Several of them pin the ESSID to a fixture network deliberately: most generated LANs hold no
    host running BOTH doors, and without one "ftp wrote elsewhere" only means "a different
    machine". Pick the fixture ESSID for the box you need before assuming a generator bug.
    **`testFtpSweepTrace` needs both doors and now pins `VSFTPD-LAB-3` (`www-197`)**; it had been
    exiting 2 on `VSFTPD-LAB`, which no longer holds such a box, so the check was dead while still
    recorded here as passing. The four ftp-only scripts still pin `VSFTPD-LAB` and are unaffected.
    A wire-check that selects its own fixture can go dead silently — an exit 2 is not a failure,
    and nothing runs these in CI.
  - **Still open, and named rather than smuggled:** `ssh` does not gate on a listening sshd
    (`backlog.md`) and the web door files its sweeps in `auth.log` (`backlog.md`).

- **D3b (`scp` — the transfer without a door) ✅ COMPLETE (v0.139.0).** Three slices —
  v0.137.0 #401, v0.138.0 #402, v0.139.0 #403. One file moves between two machines in one
  command, authorized by a credential the player already earned, leaving the target's log a
  login line and nothing else. It closes **D2.5's named gap** (the D2 block above): a *grown*
  `passwords.txt` can now be carried onto a box the player rooted, so "tools run where you
  stand" finally has nothing left waiting on it. The durable rules it established live in
  `conventions-and-gotchas.md` §6 (the four `scp` bullets); the shape:
  - **It is not a door, and one three-row table is where that is said.** `scp` has no daemon,
    no port, nothing to place, and **no `SERVICE_CATALOG` row** — it rides sshd. The `kind`
    stored on the row is provenance; `SERVICE_BY_DOOR` maps it to the service. That is the
    whole mechanism, and `conventions-and-gotchas.md` §6 says why adding a column instead would have
    been the wrong shape.
  - **The row lives exactly one command, and one function owns that lifetime.**
    `connectAndTransfer` (`scp.ts:354`) is create → transfer → end for both directions and
    both ways of reaching a box, so "the row closes on every path" is one piece of code rather
    than a discipline each exit has to keep on its own — success, either refusal, and both
    abort windows. It **never reuses an existing session**: a second `Accepted password` line in the
    target's log is truthful (real sshd writes one), while reuse would make `scp` behave
    differently depending on state the player cannot see.
  - **It is the SILENT door, and ftp is the loud one — same theft, two costs.** ftp's `get`
    itemises path and byte count in `vsftpd.log`; `scp` writes one `Accepted password` line in
    `auth.log`, indistinguishable from an interactive ssh login, and **names the file in
    neither direction**. That contrast is a test running the same theft through both doors with
    one ledger watching, not a claim in a doc — and it is a *product* difference, the same way
    `john` is the silent alternative to `hydra`.
  - **Own-LAN and public collapsed into a `Reach`.** They differ only in what establishes the
    port and who names the machine id; after the password is typed they are one piece of code.
    No new type was needed — `PublicAuthResult` is already the shape a LAN login can return,
    with the locally-resolved machine id supplied by the caller. `FtpPublicAuthParams` became
    **`PublicDoorAuthParams`** with it: both doors send `callerMachineId` and only `ssh` names
    no caller box, so the name belonged to the door, not to ftp.
  - **The server needed no change for cross-player at all.** D3.6 made
    `authCreateSessionPublic` kind-parameterized and slice 1 moved it onto `SERVICE_BY_DOOR`,
    so the reached-port check already demanded sshd, the trace already went through the ssh
    sweep log, and the source IP was already server-derived via `standingVantage`. Three of
    slice 3's four criteria were true before a line was written — which is what a door adding
    no authorization dimension looks like when the next one arrives.
  - **Wire-check:** `testScpTransfer` (19/19), covering **both door-kind paths in one run** —
    the own-LAN `authCreateSession` with `kind: 'scp'` and the cross-player
    `authCreateSessionPublic` — which is how slice 1's deliberately deferred wire-check was
    discharged. Checks 17–19 are the part only a live run could prove: a transient `scp` row is
    enough to read a stranger's box (`handleResolveCrossPlayerFs` authorizes on any un-ended row
    with no kind filter), and ending it is enough to stop.
  - **E2E:** Act 12 of
    [`e2e-shared-network-verification.md`](./e2e-shared-network-verification.md), two real
    players on two networks. The carry's `apt install hydra` step is **load-bearing** — a
    generated NPC's `/usr` holds only `bin` and `sbin`, so without it the `scp` fails on the
    missing containing directory. `scp` does not create parents, as real scp does not.

- **D10 (the terminal feels like legacy's) ✅ COMPLETE (v0.205.0).** Five slices — v0.201.0
  #481, v0.202.0 #482, v0.203.0 #484, v0.204.0 #485, v0.205.0 #486 — and the last door in the
  locked order. Nine commands: `clear` (+ Ctrl-L), `theme`, `whoami`, `author`, `xterm`, `find`,
  `strings`, `chmod`, `gpg`. `bash` was **refused, not deferred**. The plan file is deleted; the
  durable rules are in `conventions-and-gotchas.md` §1, §3, §4 and §6, and the shape worth knowing
  here:
  - **Two of the nine carry real mechanism, and they landed last and alone.** `chmod` makes a
    permission something players hand back and forth — symbolic modes over the three tiers, `u`
    resolved to the tier of the account that OWNS the node, a removal that never strips root, and
    authorization through `canWrite`. It also fixed a defect it uncovered: **a directory chmod was
    a silent no-op**, because `applyPatches` dropped a permissions patch for a directory that
    already existed. `gpg -c`/`-d` gives the game its **first protection that survives being
    rooted** — legacy's codec keyed by `md5(passphrase)`, so what the journal stores is base64 to
    root and to the server alike.
  - **The rest were comfort, and cost about what comfort costs.** `clear` and `whoami` ship as real
    `/bin` binaries rather than shell builtins, so `rm /bin/whoami` takes the tool away. `theme`
    persists to `localStorage` and is applied in an explicit boot step BEFORE render, so there is
    no frame of amber on the way to green. `author` is a third `ModeChange` overlay and needed no
    new capability; `xterm` needed exactly one (`openTerminal`) and opens a tab standing on the
    player's OWN box, however many hops deep they were.
  - **`strings` shipped with a fix to what it reads.** `BINARY_STUB`'s longest printable run was
    `ELF` — three characters against the four-character minimum — so every binary on every machine
    printed nothing. The stub now carries a real ELF's readable tail.
  - **`gpg` is the one command here that installs rather than ships**, deliberately absent from
    `SYSTEM_UTILITY_NAMES` like `node`, and its binary is world-executable — legacy's root-only
    entry was NOT ported, because real `/usr/bin/gpg` is 0755 and the encrypt half exists so a
    user-tier player can hide something from whoever roots them.
  - **Wire-check:** `N/A` for four of five slices (no `api/` change, browser proof only, per the
    door's own recorded decision). Slice 4 is the exception: it touched `applyPatches`, the one
    shared client+server module in the door, so `testCrossPlayerWrite` grew checks 13-15 (15/15)
    and was shown to fail against the pre-slice materializer.

**Generated world content — DONE (2026-09-25, v0.264.0):** grilled 2026-09-21 to 25 locked
decisions and a twelve-slice spine, all twelve shipped (#533–#550). Every generated box (never a
player workstation) holds believable, persona-coherent content — no loot, no new verbs, every
reference true within its network, history frozen at `WORLD_EPOCH` in rotated `.1` logs. As-built
and its standing rules: [`world-content-architecture.md`](./world-content-architecture.md); the
epic's plan file was retired on close-out and its open questions are in `backlog.md` under "World
content deferred". Ship waited for it. X2 (`findit.io`) was un-deferred ahead of it and is COMPLETE
(v0.276.0, #562). With it and Phase 3 done, **legacy parity is complete and the ship gate is met.**

**Procedural world — DONE (2026-10-03, v0.306.0):** nine slices in 24 PRs (#572–#596). Beyond
Ridgemont's 57 landmarks lies Harrow Valley: eleven towns of villages, towns and cities, 612
declared networks in all, with institutions, shops, cafés, offices, homes, places of care and 28
placeless corporations with branches. Every public address is derived from a network's place;
`whois` names who holds one; findit lists the world's sites from a memoised index; leads on
boxes reach homes, unlisted businesses and branches; a scan draws from Ridgemont's 178 networks
and shows another player's in about one scan in twenty. As built:
[`procedural-world-architecture.md`](./procedural-world-architecture.md). The plan was retired on
close-out; its open items are in `backlog.md` under "Procedural world deferred".

**Neon themes — DONE (2026-09-28, v0.283.0):** five slices (#567–#571). Three Cyberpunk-style
palettes (`neon`, the default, `redline` and `synth`) with a text glow, a neon font, a glitching
banner, a HUD frame whose bars report live state, and a blinking block cursor; `effects` switches
glow, glitch, HUD and cursor one at a time. Amber, green, cyan and light look exactly as they did.
As built: handbook chapter 4, *Theming*. The plan was retired on close-out; its open items are in
`backlog.md` under "Neon themes deferred".

**Operate from a hop — DONE (2026-10-07, v0.323.0):** #598–#615. Every IP tool runs from the box
the shell stands on, and the server places each trace at that box's address. As built: handbook
chapters 7 and 8 and `cross-player-architecture.md` §8; the summary and its follow-ups are in
`backlog.md` under "Pivot / operate-from-a-hop". Three of its four follow-ups closed at v0.324.0
(#616).

To pick up the next work: there is no active epic. **The owner has postponed the missions epic
(decided 2026-10-07)** to playtest the multiplayer sandbox as it stands first; missions come later
(see `docs/mission-ideas/`). Until then the work is sandbox hardening from `backlog.md`, in this
agreed order:

1. ✅ Operate-from-a-hop leftovers: `whois` from a hop, `man ssh` exit wording, WiFi followed across
   tabs (#616, v0.324.0); the `reboot` `kern.log` line names the address the rebooter's login came
   from and the box's real hostname (v0.325.0).
2. ✅ Wire-check failures (#617, 2026-10-07): every script named in `backlog.md` passes alone.
3. Small bugs a playtester would hit — ✅ `grep -c` (#619, v0.326.0, which also taught
   `head`/`tail` `-N` and `-nN` and every string flag its attached value: `ssh -p2222`); ✅ `nmap`'s
   5-digit port column and ✅ `snmpd` by name (#620, v0.327.0); ✅ `~` expansion (#621, v0.328.0)
   and ✅ planted histories the shell refuses (#622, v0.329.0: `plantedHistory.test.ts` runs every
   pool line and one line per shape of every history the world plants; `grep -i`/`-r`, `ping -c`,
   `apt update` and `apt -y` supported, the rest reworded — `backlog.md` has the record). Found
   while doing it and still open, both small (`backlog.md`): `grep` takes no stacked flags
   (`grep -ri`, `grep -rn`) and no `-n`; `~` has no `~user` form and no tab completion.
4. ✅ A player's own box has an attack surface (#623, v0.330.0; #624, v0.330.1): a workstation's
   first boot leaves it running 1–3 services, born clean, and the boot screen prints one line per
   running service. Browser-verified two-player 2026-10-08: B on A's WiFi scans A's born
   services and gets a `guest` shell over `sshd`. As built: `vulnerability-architecture.md`
   "How a workstation is born". Follow-ups in `backlog.md`: the `apt` patch-window quirk and the
   reason-to-keep-a-service-running epic (`apache2` back into the pool is item 5).
5. ✅ apache2 of its own (#625–#628, v0.331.0–v0.334.0): apache2 is a second web server with
   its own pidfile, systemd unit, release history (CVE number 22) and effect pool; every tool
   reads the RUNNING program; workstations and generated web hosts draw it 50/50 with nginx,
   and fixed sites stay nginx. Browser-verified 2026-10-08: a box born with apache2 reads as it
   in `ps`, `systemctl`, `nmap -sV` and `curl -i`, and a generated apache2 host scans, fires,
   serves an Apache-style `httpd.conf` and logs `apache2[pid]`. As built:
   `vulnerability-architecture.md` "One service, two programs: the web". Left as it is: the
   wire-check scripts that read `spec.package` for a generated host all pass, since none of
   their chosen hosts runs apache2; one that lands on an apache2 host needs the running
   program's package instead.
6. **Then:** defender-side items. ✅ The `echo x > rules.v4` wipe was decided a mechanic, not a
   gap (2026-10-08, `backlog.md`). Left: player-driven service patching (`backlog.md`), whose v2
   remainder needs scoping first, since `apt upgrade` already patches the player's own box.
7. **In flight:** in-game tutorials. A `README` in the player's home bootstraps them to `lynx`,
   and the tutorials live on `hackademy.io`, an in-world site built like findit (attackable,
   restored by the operator). Grilled and planned 2026-10-09 in `plans/in-game-tutorials.md`
   (five slices). ✅ S1, the walking skeleton (#631, v0.335.0): the README walks a new player
   online and to hackademy.io's front page and chapter 1; findit and hackademy share one table
   of fixed sites and one restore script, `scripts/restoreSite.ts <domain>`. ✅ S2 (#632,
   v0.336.0): findit lists every fixed site but itself under its domain, so a search for
   `hackademy`, `tutorial` or `newcomer` finds hackademy.io. ✅ S3 (#633, v0.337.0): chapters
   2–4 — wifi, your box and its network, looking around — each practised on the reader's own
   box. Next: slice 4, chapters 5–7 (getting in, services and CVEs, the web).

When a new slice starts, it gets its own `plans/*.md` while it is IN FLIGHT, with a top block
carrying live status + as-built, and is retired on close-out — between slices there is no slice plan
and that is expected. For the shipped systems, start from the three as-built docs named at the top
of this doc, then the cross-player architecture doc if the work touches cross-player paths, and
`procedural-world-architecture.md` if it touches the world's towns, addresses or scan.
