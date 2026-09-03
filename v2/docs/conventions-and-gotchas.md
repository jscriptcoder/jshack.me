# v2 — conventions, gotchas & project state

Durable working knowledge for the v2 rewrite, graduated out of author-local `~/.claude`
memory so it survives and is shared. Pairs with [`cross-player-architecture.md`](./cross-player-architecture.md)
(as-built system) and the live plans in `plans/`. When this doc and the code disagree, the
code wins — fix the doc.

---

## 1. Project arc & current status

**We are rewriting the game from scratch in Solid.js under `/v2`; the legacy React app at
the repo root is FROZEN.** Why: legacy was single-player-first React with multiplayer
retrofitted (repeated deep scars) + pervasive React stale-closure bugs. The rewrite is
**multiplayer-first / server-authoritative**, Solid signals, with a **framework-agnostic
`core/`**. Design intent: [`rewrite-blueprint/`](./rewrite-blueprint/).

Shipped so far (each milestone is in git history + its as-built doc/plan):

- **Generator epic** (Stories 0–1.5) ✅ — world generation from the Ed25519 identity.
- **Multiplayer / cross-player epic** (Stories 1–7) ✅ COMPLETE (v0.71.0). As-built:
  [`cross-player-architecture.md`](./cross-player-architecture.md) (**read first** for any
  cross-player work). Full live loop:
  `crack → connect → nmap <A pub IP> → ssh guest@<A.publicIp> → (read/create/edit/rm) →
  su root → rm /boot/vmlinuz → reboot`, after which A is **permanently bricked** (a `/boot`
  tombstone on the shared journal — `core/boot/bootFiles.ts` `canBoot`, journal-derived, no
  recovery) and **dark to everyone**. Stories 5 (cross-player home NAT), 6 (scan/connect/su
  traces), 7 (same-wifi shared-LAN occupancy) all shipped. Deferred tail →
  `plans/multiplayer-crossplayer-epic.md` §"Remaining work / deferred follow-ups".
- **Story 5b — multi-layer generated networks ✅ COMPLETE (v0.85.0).** A home has a deep
  gateway **chain** behind its inner gateway: `inner → L2 → L3 …` (`seedNetworkDepth` 1–3,
  a max), keyed by the fronting gateway's `machine_id`. Each chain door is reachable
  (`ssh user@<inner>:<fwd>`), scannable (upstream + pivot), and player-configurable (L2
  write to its `rules.v4`/`acl.conf`). Chains mix **routers and switches** (a switch is a
  chain leaf that forwards nothing but ACL-filters its own downstream via `acl.conf`).
  **Deep-layer traces** log source = the fronting gateway's `<deep subnet>.1`: a deep ssh
  reach appends an `auth.log` line on the landed box (`Accepted`/`Failed password … from
  <.1>`); a pivot `nmap` fires a fire-and-forget `nmapScanDeep` (on `/api/patches`) that
  appends `kern.log` per touched deep host through the shared `core/scan/deepScanHosts`
  resolver (client render + server trace can't drift; a switch vantage records post-ACL
  ports). ⚠️ Two claims here were **superseded by shared-network reconciliation** (below):
  the **octet reservation** in `mergeLanOccupants` is gone (Slice 4), and depth is no longer
  per-player — chains are **ESSID-shared** (Slice 5), so the "cross-player depth deferred"
  note no longer applies. A fixed-IP mission catalog is still deferred (epic doc), as is
  pivot **source-IP masking** — see `plans/multiplayer-crossplayer-epic.md`.

- **Unique public-IP allocation ✅ COMPLETE (v0.87.0).** A network's WAN address is now
  **server-issued and stored**, not derived: `network_public_ips(essid PK, public_ip UNIQUE)`
  plus a server-only `allocatePublicIp(essid, deps)` (lazy allocate on an ESSID's first join →
  draw via `generatePublicIp` → `INSERT … ON CONFLICT (essid) DO NOTHING` to win-or-read →
  redraw on a `public_ip` 23505; permanent, no GC), wired into `registerNetwork` in place of the
  old `home-public-${essid}` PRNG derivation (which could birthday-collide across ESSIDs).
  `assignHomeNetwork` returns `{localIp, hostname}` only — **no client-side public IP remains**.
  Wire-check: `scripts/testPublicIpAllocation.ts`.

- **Shared-network reconciliation 🔨 IN PROGRESS (sharing work DONE at v0.94.0; only the registry removal remains)** (epic doc item #5, grilled & resolved
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

**Current version: 0.200.0.**

**Current epic — legacy parity, IN PROGRESS:** `plans/legacy-parity-epic.md` — every remaining
way into a machine (doors → discovery → CVE vulnerabilities), grilled to nine locked
decisions. The ship gate is legacy parity **minus missions**; missions are a post-ship epic.

- **D1 (the web surface) ✅ COMPLETE (v0.109.0).** Five slices — v0.104.0 #344, v0.105.0 #345,
  v0.106.0 #346, v0.107.0 #347, v0.108.0 #348 — plus the v0.109.0 close-out. The plan file is
  deleted; this is its as-built.
  - **The door.** A generated LAN host rolls the `http` service, `nmap` labels its port, and
    `curl http://<its IP>` returns its seeded page (`curl -i` for headers). `ping` answers
    reachability, seeded per address. The first door since `ssh`, and the only one that opens
    with **no credential** at all.
  - **The player's own server.** `nginx`/`apache2` are **two names for one capability** — both
    write `/var/run/nginx.pid`, so the second is refused and told a web server is already up
    rather than which program. Root-only. `curl` on the player's own address (or `localhost` /
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
    `core/network/http.ts` (`resolveWebPath`), NOT in the filesystem walker — see §7. The
    server reads the document root as ITSELF, never as the requester, or a page the player just
    published at root tier would 404 (see §4).
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
  - **The trace is VANTAGE-derived** (`resolveVantageSourceIp`, as `hydraCrackPublic` does): a
    sweep launched from a box the caller only holds a session on is traced to THAT network.
    ⚠️ **`curl` and `lynx` still stamp the actor's HOME address on the same handler**, because
    neither sends a caller machine — two source-IP rules inside one web door until they get one.
    Accepted knowingly; it is the slice named alongside `ssh`/`nmap` above and **backlogged in
    §9**, which carries the whole four-tool list.
  - **One definition of a probe** (`core/network/webSweep.ts`, `sweepWord`) shared by the own-LAN
    sweep and the server's, and **one reachability chain** (`resolveWebTarget`, extracted from
    `handleResolveHttpFetch`) shared by the fetch and the sweep — so a path found by sweeping a
    neighbour cannot be missed by sweeping a stranger, and neither tool can reach a box the other
    could not.

- **D2 (the credential layer) ✅ COMPLETE** — D2.1 (v0.111.0), D2.2 (v0.113.0), D2.3 (v0.114.0),
  D2.5 (v0.115.0), both follow-ups (v0.116.0, v0.118.0), D2.4 all five slices (v0.119.0 →
  v0.122.0), and D2.6a (#377). Its split file was deleted on close-out — everything durable from it
  lives in this section, and the one piece of unbuilt work it named (**D2.6b**, harvestable
  plaintext loot) is a content story in `plans/legacy-parity-epic.md` and §9 below. PRs #351, #352,
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
    `hydraCrackPublic`. "hydra must never disagree with `ssh`" is now structural rather than a
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
  - **`ssh`, `nmap`, `curl` and `lynx` do NOT pivot** (accurate as of v0.136.0; the list grew — it
    read `ssh`/`nmap` only while it was written at v0.121.0). `resolvePublicScan` and
    `resolveHttpFetch` carry no `caller_machine_id` at all, so they cannot derive a vantage even
    in principle. `authCreateSessionPublic` now *accepts* one (D3 slice 6 gave the `ftp` door an
    honest vantage), but `ssh` still sends none and therefore still traces to the actor's home —
    the client half is the whole of what is left for that one. One shell on a rooted box
    therefore produces a hydra trace and a `gobuster` trace pointing at the pivot, and an `ssh`,
    `nmap`, `curl` or `lynx` trace pointing at the attacker. `resolveVantageSourceIp` is already
    shaped for the fix; the client half (each command naming the box it runs from, as `hydra.ts`
    and `gobuster.ts` do) is the real work. **Backlogged in §9** — and note `curl` currently needs
    no session at all to fetch, so giving it a caller machine changes that contract, which is the
    part to decide rather than assume.
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
    needs generated loot carrying an uncrackable-pool **plaintext** behind a tier gate (D2.6b, §9)
    — the same shape of finding as D2.5's "`john` cracks nothing hydra has not", and the same
    cause: every credential path is closed over one pool pair.
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
  durable rules it established live in §7 (the four `ftp` bullets); the shape of it:
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
  - **Wire-checks:** `testFtpSession` (**12/14** — the two backward-compat checks have been
    failing for a while; real baseline and the open product question in §9), `testFtpRemoteRead`
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
    (§9) and the web door files its sweeps in `auth.log` (§9).

- **D3b (`scp` — the transfer without a door) ✅ COMPLETE (v0.139.0).** Three slices —
  v0.137.0 #401, v0.138.0 #402, v0.139.0 #403. One file moves between two machines in one
  command, authorized by a credential the player already earned, leaving the target's log a
  login line and nothing else. It closes **D2.5's named gap** (the D2 block above): a *grown*
  `passwords.txt` can now be carried onto a box the player rooted, so "tools run where you
  stand" finally has nothing left waiting on it. The durable rules it established live in §7
  (the four `scp` bullets); the shape:
  - **It is not a door, and one three-row table is where that is said.** `scp` has no daemon,
    no port, nothing to place, and **no `SERVICE_CATALOG` row** — it rides sshd. The `kind`
    stored on the row is provenance; `SERVICE_BY_DOOR` maps it to the service. That is the
    whole mechanism, and §7 says why adding a column instead would have been the wrong shape.
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

To pick up the next slice: read the relevant `plans/*.md` TOP BLOCK (live status +
as-built), then the cross-player architecture doc if the work touches cross-player paths.

---

## 2. Working conventions (process + code)

(TDD, functional style, strict TypeScript, and the skill routing live in the root
`.claude/CLAUDE.md` — these are the project-specific additions.)

- **No backward-compat burden — until launch.** No live players, so freely rename / reshape
  / break schema, generators, IDs. **This rule SUNSETS at multiplayer announce** — after
  launch, schema/patches/CVEs/generators need migration discipline.
- **Ship-first on multiplayer security.** L1 (active-session gate) + targeted L3
  (gameTime / wallet / hop-chain) is enough to launch. Don't gold-plate L2 or a full
  smart-server. Scope creep kills indie multiplayer faster than security holes.
- **Shared world-state mutation is fine, not a tradeoff.** Defacement / bricking of shared
  networks is gameplay-renewable; don't gold-plate isolation/protection in shared-world
  systems.
- **Command names carry the real binary's name, hyphens included** — `redis-cli`,
  `redis-server`, `aircrack-ng`, `airmon-ng`, `airodump-ng`, `new-game`. Nothing in the
  shell constrains the shape: `isFlagToken` and completion test only a LEADING `-`, and
  the registry is keyed by the raw string. The module and its export take the camelCase
  form of the same name (`redisCli.ts` exports `redisCli`), and a hyphenated name used as
  an object key or a local has to be quoted or camelCased — `tsc` finds every one of those.
  **`node` scripting SHIPPED this and it works as predicted** (D9, `scriptIdentifier` in
  `core/scripting/commandContext.ts`): the sandbox keys its context by the camelCase
  identifier, so `redis-cli` answers to `redisCli` inside a script. Legacy built its sandbox
  as `new Function(...Object.keys(context), src)`, which makes every command name a formal
  parameter and a single hyphen a `SyntaxError` that takes down every script in the game.
  Older notes calling the no-hyphen rule "forced" predate this and are wrong.

- **No single-letter variable names.** Name lambda/predicate/reducer params after what they
  represent (`candidate`, `port`, `vuln`, `machine`), never `c`/`p`/`v`/`m`. Classic loop
  indices `i`/`j`/`k` are fine.
- **No Story/Slice/decision-number tags in code or test comments** (nor in `describe`/`it`
  titles). "Story 7.3" / "(D9)" / "slice 7.2a" rot into dangling refs once plans are
  deleted — state the WHY directly. When editing, clean only the refs in *your* change.
- **Don't reference `plans/` or memory files from committed code.** Plans are deleted on
  completion; memory is author-local. Inline the WHY in comments; for longer-form context
  that must survive, link an in-repo `v2/docs/` doc (those code-comment links are allowed).
- **Bump the version on feature changes**, in BOTH `v2/package.json` and
  `v2/package-lock.json` (the latter via `npm install --package-lock-only`). The ASCII
  banner reads the version from `package.json` via Vite's `define`.
- **Command `flags` keys are dashed** — `'-p'`, never bare `p`. Hand-built flag-Map tests
  bypass `bindFlags` and hide the drift.
- **v2 command ports must match the legacy CLI interface.** When porting a command, read the
  legacy `src/commands/` FIRST; preserve its flag set + behaviours + error shape. Don't add
  or drop flags without explicit user opt-in.
- **Consolidate small related helpers** into one `<topic>Helpers.ts` (and a matching test
  file), not file-per-helper.
- **Minimize API projections** — drop fields no client call site consumes, even
  safe-to-expose ones (e.g. public keys).
- **Grep all call sites when replacing a pattern.** A plan that says "fix X in function Y"
  surfaces ONE site; sibling functions usually need the same fix. Grep the pattern shape
  codebase-wide before scoping.
- **Real network latency over fake delays.** When real server round-trips replace fake
  `setTimeout` pacing, take them; don't stack fake on top of real.
- **A command that does slow work streams its progress.** If the work takes real time (a
  server round-trip) — or its real-world counterpart does — the command returns
  `kind: 'async'` and announces each step BEFORE doing it, so the announcement paints while
  the work is pending instead of narrating work already finished. A line ending in `...`
  means "happening now"; the arrival of the NEXT line is what reports it finished; the last
  step is reported by the prompt coming back. **No `Done` / completion marker on the
  in-flight line** — real `apt` gets away with `Reading package lists... Done` only because
  it rewrites the line it already printed, and a terminal that only appends can't. Pace the
  steps with `env.sleep` (abort-aware, so Ctrl-C unwinds mid-sequence). Build the result with
  `streamedResult` from `core/commands/streaming.ts`: it forwards an
  `AsyncGenerator<TerminalLine, number>` and captures the generator's RETURN as the exit code,
  which a bare `for await` would throw away. Where a gate sits decides its shape — a refusal
  that never reached the slow work (apt's root/offline checks) stays `kind: 'sync'` with no
  preamble, while a failure only discoverable AFTER the work started (an unknown package)
  lands beneath the announcements the player has already seen.
- **No `/etc/shadow`.** In-game passwords live inline in `/etc/passwd`. `/etc/shadow` does
  not exist in this game — don't reference it in design or code.
- **Prefer fire-and-forget server calls** alongside existing optimistic state setters over
  making a sync state method async (the `wrapWithRefetch` shape).

---

## 3. Build / test / type gates

- **Type gate = `npm run typecheck` (= `tsc -b`)**, run from `v2/`. It covers `src/`,
  `api/`, AND `scripts/`. A plain `tsc --noEmit` is a NO-OP (root tsconfig has `files: []`)
  — do not use it.
- **`api/*.ts` Vercel functions are NOT typechecked locally and ESLint doesn't flag broken
  imports there.** Only `vercel dev` / deploy catches their type errors, and DB-column /
  constraint correctness needs a **wire-check** (§6). Keep `api/` handlers thin; push logic
  into the typechecked `src/core/`.
- **Format/lint gate = `npm run lint`** (ESLint). **v2 has NO Prettier** — `npm run format`
  only exists at the legacy root and errors inside `v2/`.
- **v2 UI tests = jsdom + `@solidjs/testing-library`, NOT Browser Mode.** E2E =
  `agent-browser` vs `vercel dev` (port 3100).
- **E2E (Playwright/agent-browser) is reserved for browser-only behaviour** Vitest can't
  reach (keyboard/focus, the nano editor, full UI flows). Don't duplicate unit/integration
  coverage there.
- **E2E-test new primitives through the UI before calling them "done".** Unit tests prove
  layers in isolation; integration seams (effect → session → patch → L1 → DB) drift
  silently. Watch the network tab.
- **No metadata-existence tests** (`expect(cmd.name).toBe('foo')`). DO test metadata
  *preservation* through wrappers/HOFs and *consumption* by other commands (help/man).
- **A streamed (`kind: 'async'`) command is LAZY — `await command.execute(...)` performs
  NOTHING.** Its body doesn't start until something consumes the lines, so a test that
  executes and then asserts on `patches.write` calls sees an empty spy and passes or fails
  for the wrong reason. Drain the stream first. In the game every consumer already drains
  (the terminal renders each line as it arrives; a pipe or redirect collects them first), so
  this bites only in tests. The upside: pulling just the FIRST line leaves the command
  suspended mid-flight, which is how "the announcement is out before the work happens" is
  provable at all.
- **A `makeDeps(over)` helper must RETURN the mock that actually landed in `deps`.** The
  common shape — build default `vi.fn`s, then `{...defaults, ...over}` — returns the *default*
  mock even when `over` replaced it. A later `ctx.someDep.mockImplementation(...)` then
  retargets an orphan and the test passes vacuously. Resolve the override BEFORE building
  `deps` and return that value, or take the variation as a typed option on the helper.
- **A test that asserts an ABSENCE ("nothing was written / nobody was traced") is the easiest
  one to pass for the wrong reason.** Mutation testing is what catches it — a guard that
  survives deletion usually means the path was never reached. Before trusting such a test,
  prove the setup reaches the code by asserting the matching PRESENCE with the same inputs.
- **Every gate runs from `v2/`, and parallel tool calls share ONE shell.** Two Bash calls issued
  together run in the same working directory, so a `cd ..` in one leaks into the other — and the
  gates then run the FROZEN root app's suite instead of v2's. It fails, and it reads exactly like
  your own change breaking things. **The tell is the counts**: v2 is ~198 files / ~4200 tests, the
  root app ~651 files / ~12290. `npm run typecheck` also simply does not exist at the root. Prefer
  an absolute `cd` at the start of each gate call over relying on where the shell happens to be.
  Same family as the `v2/node_modules/.bin` fallback below: from the wrong directory, the failure
  looks like your code and is not.

---

## 4. Mutation testing conventions

**A negative fixture must be negative for the REASON UNDER TEST, not negative in general.** Twice in
two slices a surviving mutant traced to the fixture rather than the assertion, so it is a rule now:

- **D6 slice 2** — pointing every catalog row's account source at the database killed 16 tests for
  `ssh`, 1 for `http`, and NONE for `ftp`. Its fixture box ran all three doors and both ladders
  began with an account called `root`, so the trace line was identical whichever file was consulted.
- **D6 slice 3** — pointing the `mysql` command's reachability check at ssh's port instead of 3306
  killed nothing. The "no database" fixture was the first machine running NO SERVICE AT ALL, and a
  box running nothing is refused on 3306 and on 22 alike, so no test could tell which port was read.

Both are the same shape: the negative case was over-negative, and agreed with the mutant by accident.
The fix is to pick a fixture where the two answers DIFFER — a box running ssh and no database, an
account file whose ladders do not share a name. Before trusting a refusal test, ask **what else is
also false about this fixture**, and whether the mutant would notice.

This is the sibling of the same-pool blind spot recorded below: there, an oracle read from the array
the generator reads moves with it; here, a fixture that fails every check agrees with every mutant.
In both cases the test is shaped so that nothing it could catch is left to catch.

**A `find` whose predicate the DATA ORDER already satisfies hides its own mutant.** D6 slice 6:
`accounts.find((account) => account.userType === 'root')` survived `ConditionalExpression → true`,
because `/etc/passwd` lists root first on every box the suite builds, so "the first root-tier row"
and "the first row" are the same row. The mutant was not equivalent — it diverges on a box whose
passwd has been edited, where it would have mirrored the player's own row, whose hash is empty. The
fix was not a test but the right question: the password being read is the one `su root` asks for, so
read it BY NAME through the same `accountIn` every auth gate uses. Third member of the family above
— this time it is the fixture's ORDER, rather than its negativity, that agrees with the mutant.

**A whole-suite dry run is the thing that makes a mutation battery unrunnable here — scope
the RUNNER, not just `--mutate`.** Stryker executes the entire suite under instrumentation
before it applies a single mutant. At 3400+ jsdom tests that never finished on this machine:
concurrency 15 blew the 5-minute dry-run limit, concurrency 4 tripped vitest's 5s per-test
default on `ui/state.test.ts`'s module import (hence `testTimeout: 30000` in
`vite.config.ts` — a timeout there is a correctness setting, exactly as `timeoutMS` is), and
raising `--dryRunTimeoutMinutes` merely hung for 79 minutes with no sandbox writes. What
works is a throwaway vitest config whose `include` lists ONLY the test files covering the
modules under mutation, pointed at via `"vitest": { "configFile": ... }` in a throwaway
stryker config: 180 tests in 3.5s instead of 3431 in 40s+, and the battery finishes in ~6
minutes. Anything a mutant needs that the narrowed `include` omits reports as **NoCoverage**
rather than as survived, so the narrowing is visible in the report rather than silent. Keep
both files out of the repo — the `mutate` and `include` lists are per-slice and would rot.

**That throwaway vitest config must carry three things the real one supplies, or NOTHING runs.**
Copy `include` alone and the battery dies with `ConfigError: No tests were executed`, which reads
like a bad `--mutate` glob and is not. It needs `setupFiles: './src/test/setup.ts'`,
`define: { __APP_VERSION__ }`, and — the one that actually bites — `solid({ hot: false })`.
Stryker's runner does not set mode `'test'`, so solid-refresh stays enabled and its virtual module
is unresolvable under jsdom; every test file fails to transform and the runner reports zero tests
rather than an import error. Start from `vite.config.ts` and narrow `include`, rather than writing
a minimal config from scratch.

**Read the mutation report from `reports/mutation/mutation.json`, not from captured stdout.** The
`clear-text` reporter prints its per-mutant list as it goes, and a captured run keeps only the tail
— a four-file run reported `124 survived` above a list showing 8, with no way to tell whether any
sat in the changed lines. Run scoped batteries as
`npx stryker run --mutate "<files>" --reporters json,progress` and read the JSON, which carries
every mutant's file, line, mutator and status. Note it overwrites the previous report in place, so
copy one you still need first.

**A surviving mutant is a hypothesis, not a hole — hand-check it before writing a test.**
`coverageAnalysis: "perTest"` decides which specs to run per mutant from an instrumented dry run,
and it can get that wrong: D10 slice 3 reported `find.ts`'s usage guard
(`startArg === undefined || patternArg === undefined` → `false`) as SURVIVED, while applying the
same edit by hand killed the suite outright with
`TypeError: Cannot read properties of undefined (reading 'startsWith')`. Believing the report
would have meant writing a second test for a gap that did not exist, and — worse — concluding the
existing one was weak when it was not. The check costs one scripted run. Do it for every survivor
outside the manual-prose family before treating it as work.

**A hand-mutation harness owns the files it snapshots — don't edit them while it runs.** The
house pattern (a Python script that applies one mutant, runs the spec, restores) reads every target
file ONCE at startup and restores from that snapshot. Run it in the background and edit one of those
files in the meantime and the edit is silently reverted when the battery finishes; nothing errors,
because a restore is a plain write. A manual page written mid-battery vanished this way and only the
next full suite run caught it. Either wait for the battery, or edit files it does not touch.

**A mutant that survives a timeout stays applied.** The same harness restores in a `finally`, but a
tool-level timeout kills the process outright — so a battery that runs long leaves the CURRENT
mutant in the tree. Checking one marker is not enough (the control had been restored while a later
mutant had not). Re-run the affected specs, or `git diff`, before trusting a green.

**The harness must decode child output as UTF-8 explicitly.** Python's `subprocess` decodes with
the ANSI codepage on Windows (cp1252), and vitest prints the box-drawing characters this project's
goldens are made of — so the reader threads die with `UnicodeDecodeError` part-way through a
battery. The verdicts stay CORRECT, because `returncode` comes from the process rather than the
buffer, which is exactly what makes it dangerous: the run looks broken, the transcript is shredded,
and the control's verdict scrolls away in stack traces. Pass `encoding='utf-8', errors='replace'`.

**And the other half of that: Python's own stdout ENCODER dies on the same characters.** Decoding
the child correctly only to `print` it raises `UnicodeEncodeError: 'charmap' codec can't encode`,
because Python's stdout on Windows is cp1252 too — so a harness can read a verdict correctly and
then crash reporting it. The `finally` still restores, which is the whole reason it is a `finally`,
but the run reads as a failure. Strip the output to ASCII before printing
(`re.sub(r'[^\x20-\x7e]', '.', line)`) or set `PYTHONIOENCODING=utf-8`; either way, do not assume
that decoding the subprocess was the end of it.

**A large quoted heredoc silently writes nothing.** `cat > file <<'EOF'` with a body of roughly 150
lines or more fails the whole command with ``unexpected EOF while looking for matching `'`` and
leaves the target untouched — so the next command runs against stale content and the failure reads
as a logic bug in code that was never written. Hit twice in one session, on a test file and on a
patch script. Write the body to a file by other means and `cat` it into place, or keep heredocs
short; either way, check the line count before trusting the write.

**`python -c "…"` through bash is the same trap wearing a different hat.** A `\n` inside the
double-quoted argument is consumed by bash, so Python receives a REAL newline and writes it into
whatever string it was building. In D10 slice 3 that turned four `buildFile('decoy\n', …)` literals
into unterminated strings, and the failure surfaced as `Tests: no tests` with a transform error —
not a test failure, and nothing pointing at the edit that caused it. Hit twice in one slice, the
second time producing `not.toContain(\\0)` with no quotes at all. Put the patch in a `.py` file and
run that file. The rule generalises: **any string that has to survive bash AND python AND
TypeScript should travel in a file, not through three layers of quoting.**

**An inline heredoc also EATS backslash escapes, at any length.** A `\n` inside the body arrives in
the file as a real newline, so `join('\n')` in a patch script becomes `join('` + linebreak + `')`
and a regex loses its anchors — the file is written, the write reports success, and the corruption
surfaces later as an assertion failure in code that reads correctly on screen. Quoting the
delimiter does not save you. The rule is narrower and firmer than the length one above: **any body
containing a backslash escape goes through the Write tool**, whatever its size.

Provably-equivalent mutant classes — accept (don't chase) when they recur:

- **Type-narrowing defensive checks** — e.g. `raw === true` against a `string | true |
  undefined` Map value is unkillable.
- **Stryker static load-throw** — a mutant that throws at module load (`Map([undefined])`)
  makes the Vitest runner report "no tests ran" → Stryker counts SURVIVED. Verify the throw
  by hand, then accept as tooling-equivalent.
  **A describe-body population sweep has the same effect, and it reaches ACROSS blocks.**
  D7 slice 1: stubbing any generated-content generator to `() => undefined` takes the suite
  red — but the throw lands while a NEIGHBOURING block builds its own `POPULATION` eagerly,
  so Vitest reports zero tests and Stryker scores a caught mutant as survived. Making the
  new block lazy (compute once, on first use inside a test) flipped six of these to Killed
  and left eight, because the eager block next door still generates every box. Before
  believing a content generator "survived", stub it by hand: a suite that goes red is a
  kill however the runner scored it.
  **Module-scope fixtures mis-attribute `perTest` coverage the same way.** D7 slice 2: the
  `if (occupants.some(...)) return null` branch in `redisCli.ts` was reported Survived under
  a scoped runner, and applying that exact mutant by hand took TWO tests in the same file
  red. The fixtures those tests read (`generateHomeLan` results held in module-scope
  consts) are built at import rather than inside a test body, so Stryker attributes no test
  to the mutant and never runs the ones that would kill it. Same rule as above, and it is
  now the cheapest check in the triage: hand-apply any survivor that looks like it should
  already be covered before writing a test for it.
  **Third instance, D7 slice 4**: `storeIn`'s `datadir === undefined || datadir.kind !== 'file'`
  in `redis/datadir.ts` reported Survived; forced to `false` by hand it took the "a box with
  no store gains one on its first write" test red immediately. The pattern to distrust is now
  specific enough to name — a survivor in a module the mutated file only IMPORTS, whose
  killing test builds its world from generator output rather than from a literal. Two of the
  three instances so far have been exactly that.
- **No-op type-re-narrowing `.filter(typeGuard)`** added only to satisfy types after a guard
  already guarantees the kind. Prefer reduce-append; else keep the imperative early-return
  loop.
- **A `=== -1` guard in front of an index read** — `array[-1]` is already `undefined` on a plain
  array, so mutating the guard to `false` changes nothing downstream that treats `undefined` as
  "not found". (`hydraCrack.ts` `credentialFrom`.)
- **A string literal in the ELSE arm of a two-value branch** whose consumer tests only for the
  other value — `outcome === 'success' ? A : B` means `''` and `'failure'` render identically.
  (`hydraCrack.ts` `traceOf` → `formatSshdAuthLine`.)
- **`?? []` mutated to `["Stryker was here"]`** where the next step reads a property the junk
  string does not have: `rows ?? []` then `.at(-1)?.content` yields `undefined` either way. The
  GUARD is still tested (the `??` → `&&` mutant dies); only the fallback's contents are
  unobservable. (`hydraCrack.ts` `wordlistOn`.)
- Plus per-slice equivalents documented in the relevant plan (e.g. discriminant-by-exclusion
  arms, a default value washed out downstream).

- **A generator invariant that makes a defensive branch unreachable.** Verified 2026-08-11 by
  enumerating the whole crackable ESSID pool: all 100 inner gateways run EXACTLY ONE open port and
  it is always ssh. So in `forwardsIntoDeepLayer` the `find(open => open.service === 'ssh')`
  predicate and the `?.port` short-circuit are both unkillable — with one daemon, "the ssh one" and
  "the first one" are the same port, and the optional never fires. Two of these were a real dead
  disjunct (`ownSshPort === undefined || …`) that collapsed into `?.port !== port`; the two that
  remain are genuinely equivalent. Same invariant retires the reached-port half of
  `hydraCrackInnerGateway`'s service check: a deep host is `FORCE_SSHD_PATCH`'d to one daemon and
  `servesInternalPort` already refused any forward to a port nothing serves, so the port and
  service halves cannot disagree there. **Enumerate the generator before calling such a branch
  equivalent** — one fixture proves nothing about a seeded population, and the enumeration is a
  dozen lines.
- **An early return whose fallthrough reaches the same answer.** `resolveInnerGatewayTarget`'s
  `if (served.kind === 'none') return UNREACHABLE` is a fast path: with the guard mutated away,
  `served.internalIp` is `undefined`, matches neither the deep host nor the child gateway, and the
  final `return UNREACHABLE` produces the identical result. Kept for readability, not behaviour —
  all three mutants on that line are equivalent.
- **A value computed only to be discarded.** `fromIp: target.sourceIp ?? ''` in
  `hydraCrackInnerGateway`: the sweep needs a string to format lines with, and when `sourceIp` is
  null those lines are never written, so the fallback is unobservable. `cracked` does not depend on
  `fromIp` at all.
- **Blank-line spacers in command output** — `yield text('')` between sections. Tests assert the
  content lines, so the empty string is unobservable.

**Known-equivalent inventory, so a re-run is not a mystery:** `hydraCrack.ts` scores 166/169 with
exactly the three above. `hydra.ts` scores 87/133 (2026-08-11, up from ~63/97 when the deep-layer
example and rewritten `-p` description grew the block): 44 of its 46 survivors are the declarative
`manual`/metadata block — the same shape `john.ts` established — and the other 2 are the blank-line
spacers. Its dispatch logic is fully killed. `hydraCrackInnerGateway.ts` 78/80,
`resolveInnerGatewayTarget.ts` 77/80 and `lanHostIdentity.ts` 135/137, each with only the
equivalents named above. All expected, not regressions.

**Read a survivor's `location` span before believing it is impossible.** Stryker mutates
SUB-EXPRESSIONS, and the clear-text/JSON `replacement` field shows only the fragment it swapped —
not the whole line. A `ConditionalExpression => "false"` reported on
`if (username === undefined || hash === undefined)` replaced *only* the first operand, leaving
`if (false || hash === undefined)`. Hand-testing "the same" mutant as `if (false)` killed it, which
looked like a harness bug and was not. Pull `location.start.column`–`location.end.column` out of
`reports/mutation/mutation.json` and slice the source line with it to see the real mutant:

```js
const span = line.slice(mutant.location.start.column - 1, mutant.location.end.column - 1);
```

That survivor turned out to be genuinely equivalent — `String.split` always returns at least one
element, so `username === undefined` is dead. The fix was to delete the operand, not to argue with
the report: an equivalent mutant is often dead code asking to be removed. Confirm with
`tsc -b --force` that a guard is not secretly load-bearing for types before deleting it.

**A mutation PERCENTAGE is the wrong instrument for judging a deduplication — diff the survivor
SETS.** When three copies of the web target-resolution block became one (`reachWebHost`), every
per-file score FELL — curl 81.43 → 76.99, gobuster 82.12 → 77.87, lynx 78.85 → 70.67 — and
nothing had got weaker. 37 KILLED mutants stopped existing along with the two redundant copies,
so the same 74 survivors sat over a smaller denominator. The check that actually answers "did the
tests get weaker" is the survivor set:

```bash
npx stryker run --mutate '<files>' --reporters clear-text > after.txt
grep -A2 '^\[Survived\]' after.txt | grep '^-' | sed 's/^-[[:space:]]*//;s/[[:space:]]*$//' \
  | sort > after.survivors
comm -13 before.survivors after.survivors   # anything listed here is a REAL regression
```

Capture the "before" from the pre-change code — `git stash push --include-untracked` the working
changes, run, then pop; the run is deterministic, so a correct baseline reproduces exactly.
**Never pipe the run through `tail`**: the summary table is the LAST thing printed, so `| tail -60`
looks complete while silently discarding every survivor listing above it. Redirect the whole run
to a file. (Also skip `--incremental` for a scoped run — it pollutes the report with cached
results from files outside the scope.)

**Extracting a welded-in string into a parameter silently unpins it.** `curl: (6) Could not
resolve host: …` used to be a single template literal, so a StringLiteral mutant emptied the whole
message and any `toContain('Could not resolve host')` killed it. Once the program name became an
argument — `reachWebHost({ program: 'curl', … })` — it is its own mutable literal, and every
assertion in all three command files turned out to be prefix-blind: `program: 'lynx'` → `""`
passed the entire suite. **Expect this survivor class from any extraction that turns literal text
into an argument**, and pin the parameter by asserting the full prefix
(`toContain('lynx: (6) Could not resolve host')`) rather than the shared remainder.

**Assembling a string from parts is the same move**, and it unpins the separator too. `lynx`'s
footer went from the literal `'↑↓ Select  ⏎ Follow  q Quit'` — where emptying it broke any
assertion on it — to parts joined by `'  '`, at which point `'↑↓ Select'` → `""` and
`join('  ')` → `join("")` both survived a `getByText(/Follow/)`. **When a rendered line becomes
composed, assert the whole line, not a word of it**: `getByText('↑↓ Select ⏎ Follow q Quit')`
kills both (single-spaced, because testing-library normalizes whitespace before comparing).

**A command's mutation score is mostly its manual.** Every string in `description`, `manual`,
`arguments` and `examples` is its own StringLiteral mutant and none of them is killable by a
behaviour test — so ADDING documentation prose lowers the score without any test getting weaker.
`lynx.ts` fell 70.67% → 63.01% for exactly that reason, and all 27 survivors sat at or below the
`export const lynx: Command = {` line while its executable half had none. **Before reading a
command's score as a regression, split the survivors at the metadata block**; `curl.ts` reads the
same way (24 of 25 in the manual, the 25th a pre-existing `.pid$` anchor).

The same move has a subtler second form: a helper's mutants can MIGRATE. `gobuster`'s and `lynx`'s
own `error` had its `kind: 'error'` killed by their connection-refused tests; once that message
came from the shared module, those tests killed the SHARED copy instead and each command's local
helper went unpinned. When behaviour moves into a shared module, check which tests moved with it —
a file can lose coverage it never stopped deserving.

**A branch that CHOOSES between two sources needs a fixture with distinct values on each, or the
branch mutants are unkillable no matter how strong the assertion.** Slice 4's origin derivation picks
between "the network you are standing on" and "the network you own"; in any fixture where the
standing box is on the caller's own network, both arms return the same string, so a mutant that swaps
them passes every assertion. Killing it required a THIRD network — attacker home, the network stood
on, and the target — with three different public IPs. The tell is that the survivor is a
`ConditionalExpression`/`EqualityOperator` on a branch you believe is well tested: check whether the
two arms can actually produce different observable values in the fixture before hunting for a missing
assertion. (`crossPlayerSourceIp.ts` `resolveVantageSourceIp`, 18/18 once the third network existed.)

**Put the interesting element in the MIDDLE of the fixture, never at the end.** A test that
asserts "the search stops as soon as it matches" proves nothing when the match is the last item:
stop-early and scan-everything produce identical output, and the boundary mutant survives. This
hid a real gap in hydra's sweep trace — with the matching password last in a two-word list,
`matchedAt + 1` mutated to `words.length` and the whole suite stayed green. Adding a third word
*after* the match killed it instantly. The same shape applies to `find`/`findIndex`/`some`/
`indexOf` and to any early-`return` in a loop: the fixture needs an element the correct
implementation must never reach.

**An injected fake can hide the real collaborator completely.** The lease allocator's tests
inject `redrawOctet`, so `drawLanOctet`'s NPC-exclusion `.filter(...)` — the entire point of
the change — could be DELETED with the whole suite green. Mutation was the only thing that
found it. Whenever a dep is faked in every test of its consumer, the real implementation needs
its own direct test, or it is effectively unverified.

**An entry no test ever DRAWS can be blanked without anything failing — assert over the POPULATION,
not over a sample.** Keying a content pool by role multiplies the entries a suite has to reach, and
a test that reads two hosts of a role reads 2 of that role's 5 templates: the other 3 mutate to `""`
and survive. The same trap was walked into twice in one epic — first with rare ROLES (`dns` is drawn
at 3%, so a handful of fixtures never meets one), then with unreached entries INSIDE a role's pool.
The fix has one shape: sweep the 253 host octets against each role's hostname prefix, collect the
distinct results, and assert on the SET — its width, its membership, and that no entry came back
empty. Six survivors and fifteen timeouts became 91/91 with none, and the run fell from 8 minutes to
3, because the sweep also replaced per-test regeneration with one shared pass.

**Compute a population sweep ONCE per block, never per test.** Regenerating it inside each `it` is
fast in a normal run and slow enough under mutation instrumentation to race Stryker's timeout —
which silently converts a SURVIVING mutant into "killed by timeout" and makes the score depend on
how loaded the machine was. A deterministic read-only sample shared across a describe couples
nothing, and it is the reason the account and credential blocks in `remoteHostFs.test.ts` build
their sample in a block-level constant.

**A Stryker TIMEOUT is scored as a KILL, so `timeoutMS` is a correctness setting, not a patience
setting.** `stryker.config.json` ran at `30000` until 2026-08-20, which was under the budget the
generation suites need even when they are structured correctly. Raising it to **120000** converted
78 timeouts on `pools/database.ts` into 78 verdicts, and every single one of them was a SURVIVOR:
the killed count stayed at exactly 311 across both runs, so the masking was total rather than
partial. **Any mutation figure in this repo measured before that change is inflated by an unknown
number of survivors** and must be re-measured before it is cited as evidence. Read the `timeout`
column of a clear-text report first: a non-zero one means the score is not yet a fact.

**A population test over SYSTEMATIC seeds converges far slower than the sample size suggests.**
Measuring a probability knob across `NET-0`, `NET-1`, … looks like an n=400 sample and is not:
those strings differ by a few characters, so their FNV-1a hashes are correlated. A 0.40 knob read
35.8% / 43.5% / 37.0% across three seed namespaces at 400 draws, 37.0% / 38.9% / 38.7% at 2000,
and only reached 39.4-40.0% at 20000. The roll itself is fine — a fresh stream's FIRST draw is
uniform to within 0.3pp when seeds are unrelated (verified across four seed shapes × three
thresholds), so **do not "fix" an off-target rate by tuning the knob**. Either sample an order of
magnitude harder than feels necessary, or accept a band wide enough to hold the drift and say so
in the test.

**Assert over the whole record when a field is drawn from a small pool.** "A different seed
re-rolls the credentials" compared ONE `root` hash out of a ten-word password pool, so it
failed roughly one ESSID pair in ten — a real flake dressed up as a regression. Comparing the
whole `/etc/passwd` makes the same claim with three independent draws behind it. Any golden
pinned to a single pick from a short pool has this problem.

**A test that mints a RANDOM identity and asserts against SEEDED world state is flaky by
construction.** `generateIdentity()` draws fresh keys every run, while the world (NPC accounts,
LAN octets, hostnames) is seeded from the ESSID. Wherever those two spaces can collide, the test
fails at a rate set by the smaller one:

- guest passwords come from an **8-word** pool, so two random identities share one about **1 run
  in 8** — which broke "Bob's password is refused on Alice's box": on a collision it was not a
  wrong password at all.
- a player's LAN octet is drawn from their pubkey while ~10 of 253 octets hold generated hosts,
  so **~1 run in 25** puts a real NPC at the "self" address — which broke `nmapScan`'s
  self-exclusion count (`hostsLogged: 1`, not 0).

**One of those latent instances has now been found**, and it cost a full gate cycle: `nmapScan`'s
"self still skipped" test called `generateIdentity()` directly while a sibling test in the SAME
file already used the `identityOffTheGeneratedLan()` helper written for exactly this. It failed
two consecutive Stryker dry runs while the full suite passed 13/13 — which reads like "the mutation
run broke something" and is really the 1-in-25 collision landing twice. When a dry run fails on a
test that passes standalone, check whether that test mints a random identity BEFORE assuming a
moving tree or tooling noise.

Fix by **drawing again** — recurse until the candidate identity does not collide — so the
failure mode is gone by construction rather than merely rarer. That is different from the
small-pool remedy below, which widens the ASSERTION; here the nondeterminism is in the fixture.
Both instances above passed 8-10 consecutive isolated runs, so treat "it passes now" as no
evidence. Other files mint identities the same way (`resolvePublicScan`, `natHosts`,
`authCreateSessionSameLan`, `createSession`) and are latent until an assertion depends on the
draw; at least one further instance has been observed in a full-suite run without being
pinned to a file.

**A survivor masked by a LATER call is untested, not equivalent.** `withSelfHost`'s sort
survived because `mergeLanOccupants` re-sorts downstream — the mutant is invisible through
the consumer, but the module's own documented invariant (`HomeLan` = ascending octet order)
is real. Kill it with a direct test of that invariant rather than deleting the sort or
waving it through.

**A guard clause duplicated by an EARLIER guard also survives — and its test lies.** An added
`wlan0.ipv4 === null` check looked covered, but `env.network.isOnline()` had already rejected
that state, so the test passed via the wrong branch. Sibling of the vacuous-absence trap in
§5: construct the state that reaches ONLY the new guard (here: another interface addressed, so
the machine is online while `wlan0` is not).

**`stryker run --mutate <file>:<lines>` leaves STALE statuses in
`reports/stryker-incremental.json`** for the untouched mutants in that file — a range-scoped
run reported survivors that a full run had killed. After a scoped run, confirm any survivor by
hand-mutating the line and running the test file.

**A mutant that breaks MODULE LOAD is scored as a SURVIVOR here.** `aptPackages`'s
`pkg.binaries ?? [pkg.name]` mutated to `&&` makes the module throw while the map is being built,
so vitest reports `2 failed (2)` / `Tests no tests` — and with no failing TEST to see, Stryker
banks it as survived. Three of one gate's 63 survivors were this. It is the same "zero tests is not
evidence" trap the TDD rules name, firing inside the mutation harness rather than inside a watcher.
The tell is a survivor whose mutant obviously cannot work — a `??` guarding a `.map`, a callback
replaced by `() => undefined` at module scope. Hand-mutate it and read the RUNNER's output rather
than the test count: an import-time crash and a genuine survivor look identical in the report and
nothing alike on the console. Static mutants that merely produce junk (`{ name: 'gpg' }` → `{}`)
are scored honestly, so this is not "static mutants are unreliable" — it is specifically the ones
that throw.

**`reports/mutation/mutation.json` is NOT written by this repo's configured reporters.**
`stryker.config.json` sets `["html", "clear-text", "progress"]`, so that file silently persists
from whichever older run last had a json reporter enabled — it can be a different SCOPE
entirely. Parsing it after a scoped run yields a confident, fully-formatted classification of
somebody else's mutants; it named 44 survivors in `pools/database.ts` while the run that had
just finished was 13 survivors in `mysql/datadir.ts`. Read the FRESH `mutation.html` instead
(the payload is at `app.report = `, with `"+"` string splices to strip before `raw_decode`), or
work from the clear-text output. Check the file's mtime before trusting it.

**Do NOT run Stryker and the v2 dev server at the same time.** A concurrent `vercel:dev`
(vite/3100) makes Stryker report **false survivors** (verify by hand-mutating) and silently
reloads the live app mid-E2E (resetting `su` elevation). Stop one before the other.

**Do not EDIT source while a Stryker run is in flight either** — same family as the rule
above. A run whose dry run overlapped an edit died with `There were failed tests in the
initial test run` naming a test that passes cleanly on its own. Treat a dry-run failure whose
test passes standalone as tooling noise from a moving tree, not a real regression: leave the
tree alone and re-run.

**An accepted "equivalent" mutant EXPIRES when a new caller reaches it.** `curl`'s
`{ userType: 'root' }` read was classified equivalent in the web surface's first slice, on the
sound reasoning that served pages are world-readable. The next slice added the player's own box
and quietly broke it: a file created under the web root is created BY root, and `patchApi.write`
stamps the creating tier's defaults (`defaultFilePermissions('root')` → `read: ['root']` only),
so reading as the caller would 404 a page the player had just published. Nothing about the read
changed; the WORLD around it did. Re-run mutation over an unchanged file whenever a new path
starts calling it, and treat each inherited classification as a claim about today's callers only.

**Stryker TIMEOUTS count toward the score, and their count drifts between runs.** The same
unchanged file reported 23 then 28 timeouts on consecutive runs here, moving four mutants from
`timeout` into `survived` and turning a "100%" into a visible survivor list. So a bare 100% means
"no survivors *identified this run*", not "no survivors". When a score matters — a keystone gate,
a security-load-bearing branch — read the survivor LIST, and be suspicious of a file whose
timeout bucket is a large fraction of its mutants.

**A file's score can DROP with no change to that file, and the lower number is the true one.**
`curl.ts` went 98.73% → 82.17% between two runs in the same slice: its timeouts collapsed 29 → 2,
so ~27 mutants that had been scoring as *killed by timeout* ran to completion and survived. The
trigger was unrelated — adding tests elsewhere changed the per-test coverage mapping (2.86 →
23.48 tests per mutant). **Never report a score movement as a regression before diffing the
survivor LINE NUMBERS against what the slice actually touched.** Here every survivor sat in the
`Command` metadata block or in two long-classified narrowing clauses, and none in the new code —
so the honest sentence is "the timeouts were masking these", not "this slice weakened the tests".

**A `Command`'s declarative block is an accepted survivor class — with ONE exception worth
knowing.** `description`, `tier`, `availability`, `manual.*` and `arguments[]` have no production
consumer (verified by grep), so their mutants survive and a test asserting them pins data rather
than behaviour. But **`flags` IS consumed** — `runLine.ts` parses argv against it, so
`flags: { '-i': 'boolean' }` → `{}` would send `curl -i http://x` off to fetch the URL `-i`.
It survives only because command tests call `command.execute(env, args, flagMap)` directly and
hand-build the flag map, bypassing the parser entirely. **Any claim about flag PARSING needs a
`runLine`-level test**; the command's own test file structurally cannot make it.

**The default 5s timeout was inflating scores here, so `stryker.config.json` now sets
`timeoutMS: 30000`.** This is the concrete instance behind the two timeout warnings below, and it
was large: `routerFs.ts` reported **95.83% with 46 timeouts against 46 kills**, and re-running the
same unchanged code at `--timeoutMS 60000` gave **87.50%** — timeouts fell 46 → 10 and survivors
rose **4 → 12**. Eight mutants scoring as "killed by timeout" were genuine survivors. The same run
turned `passwordPools.ts` from a clean 100% into 95.83% with one real (equivalent) survivor.

Two things make this file class prone to it: Stryker counts a timeout as a KILL, and `routerFs.ts`
is **64% static mutants** (module-level constants — hostname pools, config seeds, permission
objects), each of which forces a full module reload. Stryker warns about this itself and suggests
`ignoreStatic`. **Treat any file whose timeout bucket approaches its kill count as unscored** until
you re-run it with a raised timeout; the lower number is the true one.

**`prng.next() < chance` → `<=` is a provably equivalent mutant, and will be until a knob becomes
an exact multiple of 2^-32.** `next()` returns `k / 4294967296` for an integer `k` in
`[0, 2^32-1]`, so the two operators differ only when a draw lands EXACTLY on the threshold. No
current `CRACK_CHANCE` value is reachable: `1` would need `k = 2^32` (one past the maximum), and
`0.7` / `0.12` / `0.4` all give a non-integer `k`. Re-check this if a knob is ever set to a dyadic
rational like `0.5` (`k = 2147483648`) — then the mutant becomes killable in principle, though only
by a 1-in-4-billion draw.

**`npm run lint` reports hundreds of errors while a mutation run is in flight.** Stryker copies the
whole project into `.stryker-tmp/sandbox-<id>/` for the duration of a run. That path is in
`.gitignore` but NOT in the eslint config's ignores, so eslint walks the copy and reports every
problem twice over — 400+ errors here, all of them from `vite.config.ts` and generated files inside
the sandbox. Nothing is wrong with the project. Either wait for the run to finish (the sandbox is
removed on exit) or check that every reported path contains `.stryker-tmp` before believing it.

**A timeout is scored as a KILL, so a slow run can flatter the score.** Stryker counts `# timeout`
alongside `# killed` when computing the percentage. A module whose mutants mostly run as *static*
(evaluated at import, so Stryker cannot isolate covering tests and re-runs the whole file set) can
push ordinary runs past `timeoutMS` and bank them as detections. Measured on `commands/daemon.ts`
(55% static): **78.23% with 17 timeouts** at the default 30s, and **64.52% with 0 timeouts** at
`--timeoutMS 180000` — same code, same tests, 14 points of pure measurement artifact. If a run
reports timeouts where a comparable one reported none, re-run it long before trusting the number: a
real infinite loop still times out, a merely slow mutant resolves into an honest kill or survivor.

**A mutation percentage is not comparable across a de-duplication.** Collapsing N copies of a
well-tested function into one removes N-1 copies of its *killed* mutants while leaving the
un-oracled parts (per-instance prose, config literals) roughly constant, so the ratio falls even
though no test got weaker. `commands/daemon.ts` went 73.76% → 64.52% doing exactly this, with every
one of its 44 survivors in manual/description text and not one in the gate ladder it protects. The
comparison that means something is **which mutants survive**, not the percentage — a metric that
rewards copy-pasting a tested function is measuring duplication, not test strength.

**Stryker writes NO `mutation.json` unless you ask for it, and a stale one will answer instead.**
`stryker.config.json`'s `reporters` is `["html", "clear-text", "progress"]` — no `json`. So a
`reports/mutation/mutation.json` found on disk is whatever the last run that *did* request it left
behind, possibly weeks old and about entirely different files. It is read-plausible and wrong:
here it listed survivors in `apt.ts`/`sshd.ts` during a run scoped to the password pools. Pass
`--reporters json,clear-text` on any run whose survivor list you intend to read programmatically,
and sanity-check that the files named in the report are the files you mutated.

**"Unreachable in the product" is not the same as equivalent.** `deniedPortsFor`'s
`vantage.kind === 'switch'` survived because a router's tree carries no `acl.conf` in
practice, so always reading it changes nothing. But the discriminant is a real rule — a router
FORWARDS rather than filters — and a test can state it directly by handing a router vantage a
tree that does carry the file. Prefer stating the rule over arguing the input can't occur.

**A Stryker run that dies leaves a sandbox behind, and `npm run lint` then fails in it.** Stryker
copies the repo into `.stryker-tmp/sandbox-<id>/` and normally removes it; a run that exits
abnormally (a bad `--mutate` glob is enough — it throws `ConfigError: No tests were executed`)
does not. `.stryker-tmp` is in `.gitignore` but **not** in `eslint.config.js`'s `ignores`, which
is only `['dist', 'coverage']` — so the next `npm run lint` walks the sandbox and reports hundreds
of errors in instrumented copies of your own files, `@ts-nocheck` first among them. Hit on
2026-08-17: 394 errors, every one a phantom. **The tell is the paths** — if they start
`.stryker-tmp/`, the tree is fine; `rm -rf .stryker-tmp` and re-run. Adding `.stryker-tmp` and
`reports` to the eslint ignores would retire the trap for good; left undone deliberately, as a
config change riding along on an unrelated slice.

**A script that applies a mutant by hand MUST revert in a `finally`, and must decode the subprocess
explicitly.** Proving a passed-on-arrival test means editing a source file, running vitest, and
putting the file back — and on Windows the middle step is what breaks. Python's `subprocess.run`
with `text=True` decodes using the console codepage (`cp1252`), and vitest's output carries UTF-8
box-drawing and em-dashes, so the reader thread dies with `UnicodeDecodeError` and takes the script
down **between the edit and the restore**. Hit at D10 slice 2: it left `author.ts` with its
`withoutTty` deleted, which the next full run would have reported as a real failure. Pass
`encoding='utf-8', errors='replace'`, wrap the edit in `try/finally`, and check the tree afterwards
(`git diff` on each mutated file) before believing the verdicts.

---

### Porting a renderer: capture the oracle, do not retype it

When a v2 module claims to reproduce legacy output "verbatim" — an ASCII table, a log line, a banner
— **capture the expected blocks by running legacy's own code over the same fixture**, then delete the
temp harness from the frozen tree. A throwaway `src/**/__oracle.test.ts` at the repo root that writes
its output to a file is enough (vitest swallows `console.log` there; use `writeFileSync`).

**Why:** hand-typed goldens make "ports verbatim" an assertion about arithmetic you did in your head.
Captured ones make it a measurement. When the two agree it costs five minutes; when they disagree you
have just found the bug before writing it. Verify the frozen tree is clean afterwards — the legacy app
is FROZEN and a stray test file in it is a real change.

### A golden-output fixture must vary in the dimension each rule acts on

A rendering rule is only tested if the fixture can tell it apart from its absence. Column alignment is
invisible when every cell happens to be exactly as wide as its header; a default-value column is
invisible when no column carries a default; case-insensitive matching is invisible when nothing is
referenced in the wrong case.

**Why:** these are not equivalent mutants, they are equivalent FIXTURES — the rule is real and
unprotected, and the mutation score reads clean because the harness cannot distinguish the two.
Mutation testing surfaces it; a coverage number never will.

**How to apply:** for each rule the renderer implements, ask what fixture value would make its absence
visible, and make sure one exists. Adding a second, deliberately awkward fixture beside the realistic
one is usually cheaper than reworking the realistic one — and it leaves the realistic goldens stable.

### Testing gotchas found at the rendered layer

- **⚠️ The script sandbox runs in the HOST realm, so an uninjected global silently resolves
  to the test runner's own.** `runScript` builds an `AsyncFunction`, which closes over
  whatever the environment already has. `process` is the first injected name that collides
  with a real Node global, and under vitest an uninjected `process.argv` is NODE'S — two
  entries long, so `expect(process.argv.length).toBe(2)` passed against a `node` that
  injected nothing at all. **Assert the CONTENTS of anything the sandbox is supposed to
  provide, never its shape or length.** No browser has `process`, so the game is fine; only
  the test lies. Any future injected name sharing a Node global (`Buffer`, `global`,
  `setImmediate`, `require`) inherits this exactly.

- **⚠️ A test that stubs a global and never restores it makes its NEIGHBOURS pass.**
  `vitest` is configured without `unstubGlobals`, so a `vi.stubGlobal('fetch', …)` survives
  to the end of the file. `Terminal.test.tsx`'s nmcli test had no stub of its own and was
  green only on the airodump-ng test's leaked one; the first test in that file to clean up
  after itself took the lease away and failed it with `the network is unreachable` — a
  failure in a test the change never touched. **Pair every `vi.stubGlobal` with
  `onTestFinished(() => { vi.unstubAllGlobals(); })`**, and when a neighbour then fails,
  give IT a stub rather than restoring the leak.

- **⚠️ A test `FsView` reloads to the tree it already has, so `reload()` is INVISIBLE in
  vitest.** `createFsView` (aliased as `mockFsViewFromTree`) only re-reads through its
  optional `onReload`; without one, a cached read and a live one are indistinguishable and a
  test asserting "composes against the machine" passes against code that never reloads. This
  is how D9 slice 3 shipped a `readFile` that could not see its own writes with a green
  suite. **Any claim about reading or writing the machine as it STANDS must build the view
  with `createFsView(staleTree, { onReload: async () => freshTree })`** and assert the fresh
  content — never that reload was called.

- **A masked prompt has no `textbox` role.** `Terminal.tsx` renders `type={masked ? 'password' :
  'text'}`, and `<input type="password">` has NO implicit ARIA role — so
  `getByRole('textbox', { name: /terminal input/i })`, which every other test in that file uses,
  cannot find the field a password is typed into. Use `getByLabelText(/terminal input/i)` there.
- **Wait on WHICH prompt is pending, not on the field appearing.** A credential prompt keeps the
  input mounted, so finding it proves nothing about whose question it is holding — and between two
  prompts the busy bar takes it away for a beat. Wait on `pendingPrompt()?.masked`, then re-find.
- **The prompt renders `whitespace-pre`, so its trailing space is a rendered character.** Testing
  Library's default matcher collapses whitespace, so `findByText('mysql>')` passes against
  `'mysql>  '`. Assert `.textContent` exactly when the constant's spacing is the claim.

**⚠️ Stryker's config file is a POSITIONAL argument — `-c` is `--concurrency`.** Cost 75 minutes
on 2026-09-01 and it is silent in both directions, so check this before letting any battery run:

```bash
npx stryker run stryker.mutation.json --concurrency 4     # right
npx stryker run -c stryker.mutation.json                  # WRONG — see below
```

`-c <file>` sets concurrency to the FILENAME. That fails validation with
`Config option "concurrency" must match pattern "^(100|[1-9]?[0-9])%$"` — an error naming the
wrong option, which sends you off adjusting concurrency instead of looking at the flag. Supply
`--concurrency 4` to satisfy the validator and it proceeds happily: **the throwaway config was
never loaded at all**, so Stryker falls back to the committed `stryker.config.json` and mutates
every file it lists. On this repo that is **219 files and 15,975 mutants instead of 183**, four
cores pegged, no output (the `progress` reporter writes nothing to a redirected stream), and it
reads exactly like a slow machine. **The tell is the instrumenter's own first line** —
`Instrumented 2 source file(s) with 183 mutant(s)` is right, `Instrumented 219` is not. A properly
scoped battery here finishes in under a minute; if one runs past a few minutes, check that line
before waiting.

**Baseline the narrowed suite before trusting a battery's runtime.** `npx vitest run --config
vite.mutation.config.ts` takes ~2s for a scoped include. Multiply by mutants ÷ concurrency and you
have the expected wall time; anything wildly above it is a scope or hang problem, not patience.

**Read survivors from `reports/mutation/mutation.json`, never from the captured console output.**
A backgrounded Stryker run's log was truncated to its last 72 lines and listed 8 of 77 survivors —
all from one file, which read like a clean run with one weak spot and was not. The summary table
is always right; the `[Survived]` blocks above it are the part that gets cut. Run with
`--reporters json,progress` and parse the JSON, which also carries each mutant's `replacement` —
the only way to tell which of the three mutants Stryker generates for an `a && b` condition
actually lived.

**A golden that compares a generated tree against the list it was generated from agrees with any
list.** `workstationFs.test.ts` and `routerFs.test.ts` assert `/bin`'s keys equal
`SYSTEM_UTILITY_NAMES`, and both generators build `/bin` from that same constant — so dropping a
name from it changed nothing either test could see. Two binaries were added at D10 slice 1 and
pinned BY NAME on all three filesystems as well; the goldens still earn their place (they catch a
stray extra entry), but a by-name assertion is what catches a removal. The same shape applies
anywhere a fixture and the code under test read one constant.

**A test that has never been seen to fail is a decoration.** Three of D10 slice 1's planned RED
steps passed the moment they were written, because the minimum implementation for an earlier step
had already satisfied them — which is the honest outcome, not a reason to skip them. Each was
proven by applying the mutant it exists to catch, watching it fail, and reverting. Write that down
in the close-out rather than reporting a green test as if it had driven anything.

**A test that leaves a full-screen app open hands the NEXT test a terminal with no input field.**
`overlayMode` is a module signal and `startGame` does not reset it — nor should it, because no
player can start a game from inside an overlay: the app holds the keyboard and there is no prompt
to type into. So the reset belongs to the harness, and it goes in an `afterEach` rather than in the
`renderTerminal` helper, because the tests that hand-roll their own `startGame` need it just as
much — the one that broke at D10 slice 2 was exactly that kind. The failure surfaces in an
unrelated test, several `describe`s later, as `Unable to find role="textbox"`, so it reads as that
test's own bug. Applies to any module-level signal a test can leave set.

## 5. Operational gotchas

- **3100 `vercel dev` squatter (recurs).** Killing the `npm run vercel:dev` background task
  does NOT kill its child vite/function process → it orphans on 3100 (502) → a fresh
  `vercel:dev` sees "port in use" and silently falls back to **vite-only on 3101** (no API →
  wire-checks hang on 502). Before restarting, kill the squatter:
  ```powershell
  Get-NetTCPConnection -LocalPort 3100,3101 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }
  ```
  Then `npm run vercel:dev`, and confirm `/api/<fn>` returns non-502 (a 400 to an empty
  `{}` body = serving).
- **A `vercel dev` started any way but `npm run vercel:dev` manufactures a PASSING check.** That
  script wraps the binary in `dotenv -e .env.development.local`; the binary alone does not read the
  file, and every endpoint then answers `500 {"error":"not_configured"}`. The server is otherwise
  healthy — it starts, prints `Ready!`, serves the app — so nothing announces the fault. It surfaced
  as `testSnmpFilter` reporting **1/13**, and the one PASS is the tell: check 5 asserts that a
  FILTERED port answers word for word as a STOPPED one, and two identical env errors satisfy that
  equality perfectly. Any check whose claim is "these two answers are the same" passes hardest when
  the server has stopped answering at all. Hit 2026-08-31. Read a failing wire-check's DETAIL column
  before believing the score, and treat a uniform `not_configured` as an env fault, never a product
  one.
- **A missing `v2/node_modules/.bin` silently runs the FROZEN ROOT app's binaries, and the game
  stops mounting.** npm resolves a script's binary by walking UP from the package, and the repo
  root has its own `node_modules` for the frozen React app. With `v2/node_modules/.bin` absent,
  `npm run vercel:dev` ran the root's **vite 6.4.2** instead of v2's **8.2.1**. Hit 2026-08-26.
  The symptom is not a version error: the server serves, `/@vite/client` connects, `errors` and
  `console` are both empty, and `#root` simply stays empty forever. **The tell is that `fetch()`
  of a module works from the page while `import()` fails** — crawl the import graph from
  `/src/main.tsx` and you find `/node_modules/.vite/deps/*.js` returning **504** while every one
  of our own `/src/**` modules is 200. A cached bundled vite config masks the real crash until
  you `rm -rf node_modules/.vite`, at which point it fails loudly with rolldown's
  `Cannot find native binding`. Check with `ls v2/node_modules/.bin`; fix with `npm install` from
  `v2/` (restores the links, leaves `package-lock.json` alone). **`npx` is NOT affected** — it
  resolves from local `node_modules` directly, which is why `npx vitest run` correctly reported
  v4.1.7 while `npm run vercel:dev` was broken, and why the wire-checks stayed green throughout
  (`/api/*` are Node functions that never touch vite).
- **A same-arity signature change is INVISIBLE to `tsc`.** Re-keying
  `computeInnerGatewayId(ownerKey, octet)` to `(essid, octet)` still typechecks at every call
  site, because a key and an ESSID are both `string`. The compiler is a reliable sweep only for
  arity changes; for a same-arity re-key, grep every call site — otherwise the wrong argument
  silently computes a wrong id, and the failure surfaces as ~35 unrelated-looking test
  failures. The same trap sits in the `scripts/` wire-checks, which `tsc -b` does cover but
  cannot help with here.
- **Don't run Stryker and `npm run lint` / `vercel dev` at the same time.** The in-flight
  `.stryker-tmp/sandbox-*` is inside the lint root, so `npm run lint` reports hundreds of
  `@ts-nocheck` errors from generated code that vanish when the run finishes; the same sandbox
  churn can crash `vercel dev`'s functions (`exit code 3221225794` = Windows
  `STATUS_DLL_INIT_FAILED`). Both usually clear up on their own — re-check before believing
  either. **But "usually" is not "always": a sandbox can be left behind** (a killed or
  timed-out run, or several scoped `--mutate` runs in a row), and then `npm run lint` keeps
  failing with hundreds of errors in paths under `.stryker-tmp/sandbox-*` that are not yours.
  Read the paths in the lint output before debugging your own diff; the fix is
  `rm -rf .stryker-tmp`. It is gitignored, so nothing is at risk.
- **`commandRegistry.get(name)` is NOT the command module's export.** `registry.ts` wraps every
  non-builtin command in `gate()` (binary check outside, library check inside), so the map holds
  a wrapper. Two consequences that both look like bugs in your own code:
  `expect(commandRegistry.get('curl')).toBe(curl)` fails with *"Compared values have no visual
  difference"* — which reads exactly like a duplicated module instance and is not one; and
  executing the registry's entry runs the **binary gate first**, so a test tree without
  `/usr/bin/<name>` gets `bash: <name>: command not found. Install with: apt install <name>`
  rather than the command's own output. A command test that goes through the registry has to
  install the binary (`BINARY_STUB`, world-executable, as `apt` stamps it); one that goes
  straight to `command.execute` does not. Assert registration by BEHAVIOUR — run it and check
  what it does — never by identity.
- **`vercel dev` injects cloud-scoped env vars at runtime.** If a local function sees cloud
  values despite `.env.development.local`, suspect Vercel's "Development" scope first — uncheck
  Development on local-only vars so `vercel dev` doesn't inject them.
- **Supabase local CLI uses `sb_publishable` / `sb_secret` keys**, not legacy
  anon/service_role JWTs. Function code reads them under the existing `SUPABASE_*_KEY` env
  names; `@supabase/supabase-js` accepts either format.
- **Prod shares the dev Supabase until launch** (legacy note — v2 has its own Supabase
  project). DB resets affect prod until a dedicated prod project is cut over at launch.
- **Windows case-only `git mv` clobbers import edits.** A case-only rename + same-change
  import edits can ship a PascalCase filename with lowercase imports; `tsc`/tests pass on
  Windows but break on Linux/Vercel. Grep-verify import casing after any case rename.
- **The terminal runs commands SERIALLY** (`runInput` → `commandChain` in `ui/state.ts`). Do
  NOT reintroduce concurrent `runInput` — it races on a stale FS view. Since the busy bar
  landed, the prompt input is UNMOUNTED for the whole of `executeLine`, so type-ahead is no
  longer reachable from the UI at all; `commandChain` stays as the guarantee for programmatic
  submissions (and for the microtask between submit and execute).
- **A command is still running after its last output line paints.** `executeLine` streams the
  final line, then awaits `exitCode()` — so a Terminal test that submits the next command
  straight after `findByText(<last line>)` now hits the busy bar instead of an input and fails
  with "unable to find role textbox". Await the prompt's RETURN as well (`awaitPrompt()` in
  `Terminal.test.tsx`), and await it AFTER the output line — called immediately after
  `runCommand` it resolves against the prompt the command has not taken over yet.
- **An apt-installed binary is ABSENT for the first few ticks of a game.** `startGame`
  fire-and-forgets the journal refetch (`void refetchPatches()`), and an installed tool lives in
  that journal — so a `ui/state` test that stubs `fetch` to serve `/usr/bin/<tool>` and then runs
  the tool immediately gets `bash: <tool>: command not found. Install with: apt install <tool>`,
  and the assertion fails on a downstream symptom (a mode that never opened, output that never
  arrived) rather than on the real cause. Wait ONE macrotask before the first command:
  `await new Promise((resolve) => setTimeout(resolve, 0))`. That is an ordering guarantee, not a
  sleep — every promise in the refetch chain is already resolved and none waits on a timer or
  real I/O, so the microtask queue drains completely before any macrotask runs. Don't reach for a
  polling `waitFor` here, and don't lengthen the delay: if one tick is not enough, something in
  the chain has started doing real work and that is the thing to look at.
- **Coming back online in a test needs BOTH halves, not just the ESSID.** `restoreConnection`
  returns the COLD state unless the stored ESSID *and* a remembered lease are present, so a test
  that seeds only `CONNECTED_ESSID_KEY` starts offline and every network command answers
  `network is unreachable` — which reads as a broken command rather than a broken fixture. Seed
  the lease too: `lanLeaseCacheIn(storage).remember(essid, ip)` before `startGame`, with an
  address no generated host occupies. This is the unit-test twin of the wire-check rule below.
- **A wire-check clean-slate must clear PERMANENT tables, not just the per-session ones.**
  `network_lan_leases` and `network_public_ips` deliberately outlive occupancy, so a script
  that only deletes `home_network_occupants` leaves a lease holding an octet forever. Every
  re-run then either fails its `UNIQUE (essid, octet)` insert (silently — the scripts don't
  check insert errors) or forces the allocator to redraw, which moves an address the script
  hard-coded. Symptom: a script passes alone and fails in the full sweep, or passes once and
  fails on the second run. Delete the lease rows in BOTH setup and teardown.
- **A wire-check that seeds occupancy directly must seed the lease too.** A real join
  allocates the lease BEFORE writing the occupancy row, so occupancy-without-lease is a state
  the server never produces — and since 3b-i the handlers refuse it (`not_an_occupant`: you
  hold no address here). Scripts that join through the real endpoint should read the issued
  lease back rather than re-deriving an address.
- **`nmap` scan targets: `X.Y.Z.1-254`, not `X.Y.Z.0/24`.** CIDR is not a parsed target form —
  `parseScanTarget` returns not-ok, the handler quietly logs nothing, and a test asserting
  "nothing was traced" passes for the wrong reason. If a scan test asserts an ABSENCE, first
  prove the target parses by asserting a presence with the same string.

---

- **Every `api/*.ts` file is a Vercel ENDPOINT.** There is no `vercel.json`, and `api/` holds
  exactly `network.ts`, `patches.ts`, `sessions.ts` — three files, three serverless functions. A
  helper module dropped in there (`api/deps.ts`, `api/shared.ts`) does not just sit quietly; it
  publishes a bogus function. Shared server-side helpers belong at module scope inside the endpoint
  that uses them, or somewhere outside `api/` entirely.
- **`upsert(row)` and `upsert(row, { onConflict: 'machine_id,path,writer_key' })` are equivalent on
  `patches` — but only by coincidence of the schema.** PostgREST defaults its conflict target to the
  primary key, and `20260614130000_patches_shared_journal.sql` made that PK exactly that triple.
  `api/sessions.ts` now spells it explicitly everywhere (v0.119.0): the explicit form documents the
  dependency instead of relying on it silently, and it stops a future reader "fixing" the wrong copy.
- **One spelling per query in `api/sessions.ts`** (PR #372). Ten signed actions share that endpoint,
  and each used to build its supabase dependencies inline — six copies of the journal column list,
  seven of the auth.log read. **A column name is a string `tsc` cannot check**, so a read that
  drifted in one action shipped green through every local gate and surfaced only in whichever
  wire-check happened to cover it. Ten module-scope factories (`findPatchesVia`, `readAuthLogVia`, …)
  now own one query each; add a seam by calling one, never by pasting a query.
  - The operator label is an **argument**, not a casualty: `logFailure` emits
    `[sessions] <label> error:`, and with ten actions sharing one function log that label is the only
    thing saying which failed.
  - Three single-use builders stay inline where they are used. They had nothing to deduplicate, and
    hoisting them would relocate mechanism rather than remove it.
  - `insertSessionVia` takes the **union** `SessionRow | AuthSessionRow | SuSessionRow`, not a type
    parameter: a generic cannot flow into supabase's `insert`, and a function accepting the union is
    assignable to each narrower dep by parameter contravariance — so it needs no cast.

## 6. Wire-check infrastructure

`api/` runtime correctness (DB columns, constraints, the signed-envelope path) is not
caught by `tsc`, so each `api/` path has a `scripts/test*.ts` wire-check that drives the
real endpoints against `vercel dev` + local supabase.

- Prereqs: local supabase (`http://127.0.0.1:54421`, per `supabase/config.toml`) + `vercel dev`
  (port 3100) both up (see the 3100 gotcha above). "Serving" = an empty `{}` POST returns 400
  (not 502/000).
- **Start it with `npm run vercel:dev`, never a bare `npx vercel dev`.** That script is
  `dotenv -e .env.development.local -- vercel dev --listen 3100`, and the dotenv wrapper is
  load-bearing: `vercel dev` does NOT read `.env.development.local` into the function runtime by
  itself, so a bare invocation serves happily on 3100 while EVERY request returns
  `500 {"error":"not_configured"}` from the `SUPABASE_URL`/`SERVICE_ROLE_KEY` guard. The tell is
  that `{}` returns 500 instead of 400 — check that before blaming the seed data or the handler.

**Windows can silently reserve supabase's whole port block.** Symptom: `npx supabase start`
reports success and `npx supabase status` prints the usual URLs, but every request to the REST
API returns `000`/`fetch failed` — and `docker ps --format '{{.Names}}\t{{.Ports}}'` shows the
containers with **no host port mapping at all** (`8000/tcp`, not `0.0.0.0:54421->8000/tcp`). A
restart then fails outright with *"bind: An attempt was made to access a socket in a way
forbidden by its access permissions."*

Cause is not Docker: Hyper-V/WinNAT grabs dynamic TCP ranges at boot, and `54352-54451` covers
every port in `config.toml` (54420-54429). Confirm with:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

Two fixes. The proper one is `net stop winnat; net start winnat` from an **elevated** shell,
which releases the reservations. Without elevation, temporarily remap the ports in
`supabase/config.toml` **and** `SUPABASE_URL` in `.env.development.local` to a block above the
highest excluded range (55600+ was clear), `supabase start`, **restart `vercel dev`** so it picks
up the new URL, run the check, then restore both files. Back them up first — reverting from
memory is how a temp port ends up committed.

The remap path was walked again on 2026-08-09 and works exactly as written; three details worth
having. `net stop winnat` answers **"Access is denied"** in a normal shell — that is the missing
elevation, not a broken service, and it is the cue to take the remap path rather than hunt for a
service problem. Neither CLI is installed here, so drive both through npx (`npx -y supabase start`,
and `npm run vercel:dev`, which resolves `vercel` from `@vercel/node`). `supabase stop
--project-id jshack-me-v2` before remapping, or the old containers linger on the old ports.
Restore by copying the backups back and confirm with `git status` — `config.toml` is TRACKED, so a
forgotten temp port is a committed one.

**Check the ranges before assuming you need the remap — they are re-drawn on every boot.** On
2026-08-13 the reservations had moved to `59635-60720` and the whole 544xx block was clear, so the
remap was unnecessary. Two minutes of `netsh interface ipv4 show excludedportrange protocol=tcp`
beats editing two tracked-adjacent files on faith. The reverse also bites: containers left running
from a remapped session **auto-restart on the old ports** while `config.toml` says otherwise, and
the mismatch reads as a dead stack. `docker ps --format '{{.Names}}\t{{.Ports}}'` shows it at once;
`supabase stop --project-id jshack-me-v2` then `start` rebinds them to whatever the file now says.
- Run: `npx dotenv -e .env.development.local -- npx tsx scripts/<name>.ts` (from `v2/`).
  Exits 0 on all-pass.
- The script seeds the DB via the service-role client, drives the endpoints, asserts, and
  cleans up. Examples: `testDeepChainReach.ts`, `testDeepSwitchChain.ts`,
  `testSameLanConnect.ts`, `testRouterBrick.ts`, `testHttpFetch.ts`.

**A wire-check that asserts on a SHARED machine's journal must clean that machine at SETUP and
assert on the DELTA.** Both halves were wrong in the first draft of the deep hydra check and each
produced a green PASS on its own:

1. *Stale rows outlive the run.* Deep hosts, gateways and AP boxes are ESSID-seeded, so their
   `machine_id` is identical across runs even though each run generates a fresh identity. The
   trace assertion passed against an auth.log row written the PREVIOUS DAY, while every other
   check in the same run was failing. Cleaning up at the END is not enough — a crashed or
   half-failing run leaves rows the next run reads as its own. Delete the target machine's
   patches at setup, not only at teardown.
2. *A sibling path writes the same sentence.* `ssh` and `hydra` both append
   `Failed/Accepted password for <user> from <ip>` to the same file on the same box, so an
   `includes()` over the whole log is satisfied by the ssh checks that ran earlier in the script
   regardless of whether the sweep wrote anything. Snapshot the content before the action and
   assert on `after.slice(before.length)`.

The general rule: an assertion that would pass if the code under test did NOTHING is not a check.
On shared, deterministically-named machines that is the default outcome, not an edge case.

**The 45 checks are individually clean and NOT sweep-safe — run them one at a time.** Driving
the whole directory back-to-back in one loop produced three RED scripts
(`testCrossPlayerConnectionTrace` 3/7, `testCrossPlayerRead` 6/7, `testCrossPlayerRouter` 6/8)
that were **7/7, 7/7 and 8/8 when each was run alone**. Nothing was wrong with the code or the
checks: this is the stale-row rule above at suite scale. Machines are ESSID-seeded, so scripts
share `machine_id`s and public-IP rows, and each one's setup-time cleanup only covers the machines
IT knows about. A close-out sweep is therefore a series of individual runs, and **a RED from a
back-to-back loop must be re-run alone before it is believed** — the count in a sweep report means
"scripts that passed individually", not "scripts that pass in sequence".

**`testDeepChainReach` poisons its own next run — it is not even RE-RUN-safe.** Its last check
bricks an intermediate gateway, and the brick is a row that outlives the process. Run it a second
time and the same gateway is already bricked, so every earlier step fails `403 no_session` while
the brick check itself passes — 1/6, with the one PASS being the tell. This survives a
`supabase stop`/`start`, because stopping backs the data up to the docker volume and starting
restores it: **a database is weeks old unless somebody reset it.** `npx supabase db reset` returns
it to 6/6. A red script whose FINAL check leaves state behind should be suspected of this before
it is suspected of a regression — and the test that settles it is a reset, not a re-run.

**Selecting a generated LAN host by "not `.1`" picks an INNER GATEWAY, not an ordinary box.**
`generateHomeLan` returns `kind: 'machine' | 'router' | 'switch'` in ascending-octet order, and a
router or switch above `.1` is an inner gateway whose base FS is a ROUTER tree — not the
`buildRemoteHostFs` box an "NPC host" check means. `testRemoteAptInstall.ts` was written with a
`!ip.endsWith('.1')` filter and silently asserted against `core-rtr` (`inner-gw-…`); it passed, so
nothing pointed at the wrong tree. **Select on `kind === 'machine'`** for an ordinary sibling, and
use `isInnerGateway(host)` when a gateway is what you actually want. The two resolve through
different arms of `resolveTargetBaseFs`, so a check on one proves nothing about the other.

**SEED INSERTS MUST FAIL LOUDLY — a rejected seed is a check that tests nothing.** A bare
`await sr.from('patches').insert([...])` swallows its error, so a row the schema refuses leaves
the scenario un-built while the check still runs and "passes" against the *unmodified* world.
This cost real time in `testHttpFetch.ts`: two bricking checks returned 200 because the tombstone
rows were rejected and nothing was ever bricked. Wrap every seed so a failure exits:

```ts
const seed = async (table: string, rows: readonly Record<string, unknown>[], label: string) => {
  const { error } = await sr.from(table).insert(rows);
  if (error) { console.error(`FATAL: ${table} insert (${label}) failed:`, error.message); process.exit(1); }
};
```

**A RUNNER that reads the wrong exit code reports a false pass** — the same lesson one layer out.
There is no committed all-checks runner, so running the suite means an ad-hoc loop, and the obvious
shape is wrong:

```bash
out=$(npx dotenv -e .env.development.local -- npx tsx "$f" 2>&1 | tail -2); code=$?   # WRONG
```

`$?` after a pipeline is the LAST stage's status — `tail` always succeeds — so every script counts
as passing and the loop cheerfully prints `32/32`. Assign without the pipe and capture `$?` on the
next line (or read `${PIPESTATUS[0]}`). Hit on 2026-08-10; the false `32/32` was caught only because
the number looked too good for a run that included a just-changed resolver.

**All public-IP seeding goes through `scripts/networkFixture.ts`** (`seedPublicIps` /
`clearPublicIps`) — never a hand-rolled delete + insert. `network_public_ips` is keyed on
**essid** (PK) with **public_ip** merely UNIQUE, so a script that hardcodes its own address and
cleans up with `.delete().eq('public_ip', …)` never clears a row the same ESSID holds under a
DIFFERENT address — and a real `registerNetwork` allocates exactly such rows. The seed then
violates the essid PK, the bare insert swallows it, and the scenario silently never gets built.

This cost real time on 2026-08-09: `testRouterBrick` (6/10) and `testCrossPlayerRouter` (7/8) sat at
a **false red** that read exactly like a NAT-forward regression — `resolvePublicScan` returning
`{found:false, ports:[]}` and the forwarded login 404ing. Nothing was broken. Both scripts share
ESSID `ABSTERGO-NET` with different hardcoded IPs, and the live table held
`(ABSTERGO-NET, 203.4.16.180)` from some earlier allocation. Clearing that row alone took them to
10/10 and 8/8; re-injecting it reproduced the failure exactly. **A red wire-check is not evidence of
a code regression until its fixture is proven to have been built.**

Scripts that only ever DELETE from `network_public_ips` (cleaning up after a real `registerNetwork`,
e.g. `testGatewayBrickLanAlive`) need no fixture — they have no seed to block.

**The specific trap behind that one: a `/boot` tombstone keeps `node_type: 'file'`.** `content:
null` is the deletion marker; `node_type` is NOT NULL, so an explicit `null` there is a rejected
row rather than a brick. (`testBrickedDark.ts` says so in a comment — worth reading before
hand-rolling tombstone rows.)

Live browser E2E (agent-browser vs `vercel dev`) is covered by the project skill
**`v2-e2e`** (`.claude/skills/v2-e2e/SKILL.md`) — load it before writing any agent-browser
command. It holds the preflight, recipes for reaching a given in-game state (fresh player →
connected with nmap; a shell on the AP gateway; the two-identity cross-player loop), the
terminal/nano DOM quirks, and how to derive seeded secrets offline. Add a recipe whenever a
state costs you more than one wrong attempt.

---

## 7. Architecture invariants

- **Spend realism where the player READS; spend legibility where the player AUTHORS.** The rule
  that settled the long-running "is `rules.v4` too simple, or is SNMP too complex" question at
  v0.195.0 — the two are not on one axis, and neither had to move toward the other. A player
  never types an OID line, so `snmpwalk`'s block can afford texture a real tool would have; a
  player DOES hand-author `/etc/iptables/rules.v4` in `nano` against a LENIENT parser that skips
  malformed lines in silence, so real `iptables-save` grammar there would turn one wrong character
  into no error and no effect. That file's seed header is a tutorial (`# One rule per line:
  forward <public_port> to <internal_ip>:<internal_port>`) and it only works because the grammar
  is one line. Neither is a placeholder awaiting realism; ask which side of the read/write line a
  surface sits on before adding fidelity to it.

- **What a walk PRINTS is what a set TAKES, on every line.** `snmpwalk` used to render
  `NAT-MIB::natForward.2222` while `SET_OID_RE` accepted `natForward.2222` alone, so a player
  pasting the device's own output back was refused with `noSuchName (The name does not exist in
  the MIB)` — for a name the device had just printed, naming a MIB module it never showed them.
  The module prefixes and the type column are gone for that reason rather than for taste, and
  `snmp/walk.ts` is the single owner of every object name (`forwardOid`, `aclPortOid`,
  `inputPortOid`) precisely so the read and the write cannot drift apart again. `set.ts` and the
  server's own `OBJECT_OF` refusal both spell a name by importing it from there — never inline.
  The port table's name is `forward`, matching the verb `rules.v4` already uses under `nano`: one
  fact reached two ways does not need two words.

- **What a generated box IS gets DERIVED, and read back off its NAME — nothing about a role
  travels.** `generation/machineRole.ts` draws the role from the box's coordinates; everything
  downstream — `hostServices`, the `/etc` config, the page it serves, the account it carries —
  reads it BACK off the hostname through the one reverse lookup, `pools/hostnames.ts`'s
  `roleOfHostname`. Not as an optimisation: re-deriving is impossible at that layer, because a
  deep-layer NPC's role is drawn from `${essid}-${parentMachineId}`, a seed the host-fs builder
  cannot see. Two consequences. **The prefix pools are load-bearing** — renaming a prefix silently
  re-roles every box wearing it, and `DEVICE_TYPES` is the `workstation` pool itself rather than a
  copy, so it is not edited casually. And **a name no role claims is an ordinary case, not a gap**:
  such a box draws a generic account, keeps no `/etc` config, and serves the general page. Every
  role-keyed lookup has to answer for `undefined`, and the honest answer is usually a fallback
  rather than a guard.

- **`prng.pick` consumes exactly ONE `next()` whatever the pool's width — which is what let an
  epic of content ship for free.** `pick` is `items[nextInt(0, items.length - 1)]`, so replacing a
  flat pool with a role-keyed one of any length leaves the stream identical and every value drawn
  after it exactly where it was. Adding a DRAW does the opposite: it re-rolls everything
  downstream, and in the LAN generator's stream that moves the NPC octets `api/network.ts` feeds
  the lease allocator as an exclusion set — issuing an occupant an address an NPC already holds.
  Hence the rule every content pool follows: **new content takes its OWN seed stream**
  (`etc-config-…`, `web-page-…`, `backdoor-…`), never an append to a shared one.
  - **The one exception is the opposite of what it looks like.** The NPC username is drawn from
    the host-fs stream immediately before the three passwords, so `pickUsername` takes the
    CALLER's prng rather than a seed of its own — giving it one would REMOVE that draw from the
    sequence and re-roll every credential in the world. D5b's plan had this backwards and booked
    the re-roll as an accepted cost; measuring the generator says it was never charged. A test in
    `remoteHostFs.test.ts` holds it hash for hash against the nameless box at the same address.

- **Five tables key off `DrawnRole`, and they are five tables on purpose.** Hostname prefixes,
  service placement, `/etc` configs, web pages and usernames share a key and nothing else: the
  cells are a string list, a per-service probability record, a filename-plus-templates record, a
  sparse string list and a string list with its own fallback; two are sparse and three total; and
  no requirement moves two of them at once, because adding a hostname prefix implies nothing about
  accounts. Merging them was assessed when the fifth landed and declined — it would create one
  table every generation module depends on, with every cell typed separately anyway. The shared
  key is `DrawnRole`, and that already has one home.

- **Generated content may not claim what the game cannot honour.** Four forms of one rule, each
  learned by shipping the violation first. A page must not **link a path its host does not serve**
  (`/admin/`, `/metrics` — the recon the page invited always dead-ended). A page must not **hint at
  a mechanic that does not exist** — "default password unchanged" sends a player after nothing, the
  same sin as the dead link. A config or an account must not **name a daemon this world cannot
  run**: legacy put `postgres` under a `mysql.cnf` and `samba` beside a `vsftpd.conf`, and an
  account is weaker evidence than a config stanza but is read the same way. And **no account name
  belongs to two roles**, the generic pool included — a name that could have come from two kinds of
  box is not evidence, which is the whole reason the pool is keyed.

- **A daemon is a DESCRIPTOR, not a module — adding one is a catalog row plus a `Daemon`.**
  `commands/daemon.ts` is one implementation behind four front doors (`sshd`, `vsftpd`, `nginx`,
  `apache2`); it was three near-identical modules until D4 slice 0 collapsed them. The descriptor
  carries only what differs — the command name, the catalog row it binds, the `Starting <banner>`
  line, the already-running wording, availability, and the manual prose. The gate ladder
  (**root → port validity → already-running**, in that order), the pidfile write, the
  `STARTUP_DELAY_MS` beat and the streamed shape are shared, because a second door that refused
  differently from the first would be a second set of rules to learn for no gain. Do not add a
  fifth daemon module; add a row to `DAEMONS`.
  - **A catalog row that NAMES a daemon is a claim `DAEMONS` has to honour, and nothing checks
    that they agree.** `redis` declared `daemons: ['redis']` from D7 slice 1, so the binary landed
    in `/usr/sbin` and `which redis` answered — while `DAEMONS` had no entry, so
    `systemctl start redis` did nothing whatsoever. The two tables sat out of step for five slices
    with nothing to notice, because until a player had to START one, nobody ever had.
    **It then happened AGAIN one table further along, and shipped.** `DAEMONS` was fixed; the
    `UNITS` table in `systemctl.ts` — a THIRD declaration of the same fact — was not, so
    `systemctl start redis` answered `Unit redis.service could not be found` on a box where the
    store was installed and the bare `redis` command started it fine. Caught by playing the game
    on 2026-08-26, not by a test: no test in `systemctl.test.ts` named redis, and every other
    player-facing path worked. Fixed at v0.183.0. Three tables now state which daemons exist
    (`SERVICE_CATALOG[...].daemons`, `DAEMONS`, `UNITS`) and NOTHING enforces that they agree —
    when the sixth door lands, add all three in one change and assert the unit, because the gap
    is invisible from every direction except the idiomatic one a player actually reaches for.
    **`systemctl.test.ts` now holds that check** — three assertions comparing NAMES, so a failure
    says which daemon is stranded and in which table: every daemon a package installs can be
    started, every daemon that can be started can be stopped, and every catalog door names a
    daemon a player can act on. Both historical bugs were re-injected to prove it bites. D8 should
    add its `DAEMONS` and `UNITS` rows in the same change as the catalog row and let the guard
    confirm it, rather than discovering the gap months later through a player's own hands.
  - **`hostServices` governs `machine` hosts ONLY — an offline oracle built on it will invent
    doors the game never shows.** `resolveLanHostIdentity` has four branches (edge router at `.1`,
    inner-gateway router, switch, machine) and only the machine branch runs the `remoteHostFs`
    builder that turns a placement into pidfiles and a datadir. Routers and switches get
    `buildRouterBaseFs`/`buildSwitchBaseFs` and never consult the placement table at all. A scan
    reads the host's actual filesystem, not the table — so the two cannot disagree in the player's
    view. Cost a false defect report on 2026-08-26: an oracle that called `hostServices` for every
    host measured "33% of advertised redis doors have no store", all of them routers or switches;
    the live scans showed no `6379` on any of them. Restricted to `machine` hosts — the only kind
    that consumes it — advertised and furnished agree **29/29, zero bare**. When writing an oracle,
    filter to `kind === 'machine'` or read the same filesystem the game reads.
  - **`nginx` and `apache2` are two names for ONE capability.** They bind the same `http` catalog
    row, so whichever starts first owns the port and the other is refused — and the refusal names
    the CONFLICT ("web server already running"), never the program, because "apache2 is already
    running" is false when nginx was the one that came up.
  - Real Unix reserves ports below 1024 for root, which is tempting to model here. Don't: the root
    gate fires before a port is ever parsed, so the rule would be an unreachable branch.
- **`pidfile.ts` owns the ONLY answer to "what is running here".** `readRunningProcesses` walks
  `/var/run` and is the single policy; `readOpenPorts` is a projection of it for callers that want
  a port scan's view, and `daemonName` is the name both the pidfile line and `ps`'s COMMAND column
  use. A second walk anywhere would let a scan of a box and a survey run on it disagree about what
  is up. Two rules that live there and must not be re-litigated per caller: an unrecognised
  `/var/run` entry is skipped, and a **DIRECTORY** wearing a pidfile's name is not a running daemon
  — `mkdir /var/run/sshd.pid` is something a root player can really do, and reading it as a service
  would let anyone fake a serving box, or bar their own door, with one command.
  - **`/var/run` holds a UNION, and a listener joined it as a variant rather than a catalog row.**
    D5's `nc -l` backdoor is a `RunningProcess` of `kind: 'listener'` beside the daemons — it has
    no service to bind, no banner to serve and no `SweepLog`, so a `SERVICE_CATALOG` row would have
    been four empty columns and a fifth door for every consumer to special-case. The projection is
    what keeps the two honest: `nmap` shows a listener's port `open` with SERVICE `unknown` for
    free, because it reads the same walk.
  - **A listener's PID is DERIVED where it is consumed, never stored.** `listenerPid(machineId,
    port)` computes it; `readRunningProcesses` keeps its one-argument signature and returns no
    `pid`. Storing one would let a planter's own client author the number a defender then types,
    and would fan the machine id through `readOpenPorts`, which has no use for it. **`kill`
    therefore resolves a pid by matching `listenerPid` across the walk, not by reading a field** —
    and must check the `kind` discriminator first, or it reports success for a `/var/run/nc-22.pid`
    that never existed and tells a defender they shut a door that is still open.
- **`systemctl` speaks as the UNIT; only `start` speaks as the program.** `stop` and `status`
  answer `nginx.service - web server` however the player typed it, so stopping via `apache2` can
  never claim apache2 was the one running. `start` keeps the program's banner, because starting IS
  an act on a program. It is the same rule `webServer`'s conflict reply already followed.
  - **Resolving a unit checks the BINARY, or `systemctl` is an apt bypass.** The binary gate lives
    on the `nginx`/`apache2` commands; delegating around it would open port 80 on a box that never
    installed a web server. `unitFor` gates on `binaryExists`, which is also what makes the
    unknown-unit and not-installed answers collapse into one sentence — told apart, they would let
    a guest enumerate a box's packages by probing.
  - **`systemctl` never calls `popSession`.** A stop shuts the door without emptying the room:
    live sessions survive and only new logins are refused, as real sshd does.
- **A service is a UNIT and a listener is a PROCESS — that is why there are two verbs.**
  `systemctl stop <name>` is the only way to shut a daemon and `kill <pid>` the only way to remove
  a backdoor, and neither answers for the other: `ps` prints `-` in the PID column for a service,
  so no number a player can type resolves to one, and `kill sshd` answers
  `kill: sshd: use "systemctl stop sshd"` — echoing the name AS TYPED, because `systemctl stop
  apache2` really works and translating it to the shared unit name would hand the player a program
  they never mentioned. **`kill` checks argument shape before privilege**, so a guest gets the
  pointer rather than a root refusal that would be advice they cannot take. Success is silent, as
  the real thing is. The split is not arbitrary: sshd forks a child per session, so a stop leaves
  the room full, while netcat is the one process that both listens and serves — which is why only
  `kill` evicts.
- **The admin tools are planted, not apt-installable.** `systemctl` ships in `/usr/bin` on every
  machine via `SERVICE_CONTROL_TOOLS` — a box you have rooted must be controllable with what is
  already on it, or stopping a service would depend on the box having internet. `ps` was already in
  `SYSTEM_UTILITY_NAMES` (`/bin`), and note it **also links `libpcre`** in the legacy-inherited
  `libraryDeps` map, so it sits behind the linker gate as well as the binary one. Both are
  world-executable and gate on root at RUNTIME where a rule exists at all.
- **A command whose name predates its implementation inherits gates it never declared — check
  BOTH lists before writing its tests.** `find`, `strings` and `chmod` were stamped into
  `SYSTEM_UTILITY_NAMES` and listed in `COMMAND_LIBRARY_DEPS` long before any of them existed,
  because generation and the library-CVE chain were ported from legacy's full command set. So the
  moment `find` was registered its tests went red a second time with
  `find: error while loading shared libraries: libpcre.so` — nothing wrong with the command, a
  `/lib` missing from the test tree. Two consequences worth knowing up front: a test tree for one of
  these needs `/bin/<name>` AND `/lib/<dep>.so`, and `rm /lib/libpcre.so` is a live way to break
  `ls`, `cat`, `grep`, `find`, `strings`, `chmod` and `ps` in one stroke.
- **`env.fs` is a POINT-IN-TIME SNAPSHOT. A command that patches and then re-reads sees the
  world as it was before its own write.** `buildCommandEnv` calls `createFsView(args.root, …)`
  once, with `root: activeRoot()` evaluated at build time — the comment on `commandChain` in
  `ui/state.ts` says so outright, and command execution is serialized precisely so the next
  command gets a fresh one. Within a single command the snapshot never moves. Any gate that
  re-reads `env.fs` after an `env.patches.*` call is therefore reading stale state. This is not
  theoretical: `systemctl restart` removes the pidfile and then brings the daemon back up, and
  routing the second half through the daemon's own front door left its already-running gate
  staring at the file the same command had just deleted — a restart that would have refused
  itself and left the service DOWN. The rule: a command that changes the filesystem must carry
  what it learned forward in a variable, never re-derive it from `env.fs`. `daemon.ts` splits
  along exactly this line — `bringUp` is the gate-free write, and the gates live in the callers
  that still have a valid view.
- **HTTP confines itself to the document root — the filesystem walker must never be trusted
  to do it.** `resolveWebPath` (`core/network/http.ts`) NORMALIZES the request path and returns
  `null` when it escapes `/var/www/html`. It looks redundant, because `fsView.read` resolves
  through `segmentsOf` and so treats `..` as a literal directory name that never exists — but
  that is an accident of which path helper is on the read path, not a guarantee: `resolveAbsPath`
  normalizes everywhere else (it is how `cd ..` works). Three `..` above the web root is `/`,
  which puts `/etc/passwd` one hop from a caller holding **no session on the box at all**. If a
  walker ever starts normalizing, this function is the only thing standing in the way. An
  escaping path must report the SAME 404 a missing file does — confirming a traversal was
  spotted is itself a hint. Every HTTP reader shares this one function, so the client `curl` and
  the (coming) cross-player server handler cannot disagree about what a URL may name.
- **The wire IS the threat surface.** The trust boundary is the Vercel function + Supabase
  RLS, never the client (Burp/ZAP/a custom client are all the same threat). Patch validation
  is zero-trust; identity is proven by a **signed Ed25519 envelope** on every request, and a
  client never claims its own identity (the server uses the verified pubkey). Defense layers:
  **L1** (caller holds an active session on the target), **L2** (the session's tier may
  write the path — the server regenerates the target FS and asks the shared walker), **L3**
  (server-side game-logic re-run — mostly deferred).
- **Framework-agnostic `core/`.** `core/` has zero framework imports; `CommandEnv` is the
  only seam; the FS walker is shared client + server. This is the rule the whole
  architecture exists for — keep `core/` pure and push framework/IO to the edges
  (`adapters/`, `api/`, `ui/`). Commands stay JS-callable (`execute(env, args, flags) →
  CommandResult`) for a future `node` command.
- **`workstation_id` MUST go through `computeWorkstationId`** — suffix =
  `sha256('ed25519:' + playerKeyHex)[0..8]`. The `ed25519:` prefix is load-bearing; a
  raw-playerKey derivation diverges and silently breaks auth/L1/L2. Routers/gateways have
  their own prefixed namespaces (`ed25519-router:` / `ed25519-inner-gw:` /
  `ed25519-deep-gw:`).
- **Two separate keypairs.** Identity (Ed25519) in browser localStorage, never auto-wiped
  (identity reset = an explicit "new game"). The wallet key lives in the in-game filesystem,
  lost on permadeath or theft — wallet defense is gameplay, not crypto.
- **Game time is a SERVER authority** (ADR D13). A signed event is stamped with the server's
  own UTC clock; there is no forgeable client `gameTime()`. Future CVE eligibility gates on
  game time, so it must be unforgeable.
- **Being on a WiFi is what makes a machine reachable — not whether a player is playing.**
  A box joined to an ESSID is running and attackable around the clock; closing the browser,
  logging out, or simply going away changes nothing. The ONLY thing that takes a machine off
  a network is an explicit in-game `nmcli disconnect` (or `reboot`, which disconnects on the
  way down), and a machine on no network is unreachable by every path — there is no "power
  off" mechanic to distinguish. This is why the defender role works: a player hardens their
  box (`rules.v4`, service state, `/etc/passwd`) and that hardening keeps standing while they
  are away, because the patch journal is never cleaned up on disconnect and the LAN lease is
  permanent. `home_network_occupants` is therefore the source of truth for reachability —
  its rows mean "on this WiFi", not "currently at the keyboard", and no identity or
  reachability lookup may gate on player presence.
- **`home_network_occupants` is the single source for "whose machine is this, and is it
  reachable".** Every cross-player by-`machine_id` resolver reads it and nothing else — there
  is no registry to consult first and no fallback to arbitrate. Its row means "this machine is
  on that WiFi", which is exactly the reachability test, so a machine with no row fails closed
  everywhere. **AP gateways are the one exception, and they need no lookup at all**: a gateway
  has no occupant (it belongs to the access point), its id is a pure function of the ESSID, and
  the only way to touch one is to hold a session on it — so it is resolved from
  `sessions.essid`, which also prevents reaching another network's gateway by claiming its id.
  Note `lanBaseFsForMachineId` deliberately skips octet `.1`, so the gateway always needs its
  own arm rather than falling out of the LAN walk. The table's PK is `(essid, owner_key)`,
  which cannot serve that reverse lookup — `home_network_occupants_workstation_machine_id_idx`
  exists for it and must survive any future reshaping of the table.
  See `cross-player-architecture.md`.
- **L1 asks whether you hold a session, never which KIND.** `authorizeMachineAccess` looks up
  any active `(player_key, machine_id)` row, so an `ftp` session opens the same journal an
  `ssh` hop does — proven live by `scripts/testFtpRemoteRead.ts`, since every unit test fakes
  `findActiveSession`. This is deliberate (a door is not an authorization dimension), and it
  is what every later parallel session — `nc`, `mysql`, `redis` — will inherit for free. The
  consequence to keep in view: **the remote READ is L1-only**, so the tier filter on what a
  session can see is CLIENT-side (`createFsView` + the shared walker), exactly as it is for an
  `ssh` hop. A server-side read filter is a separate, still-deferred plan.
- **A PARALLEL session needs its own journal, and the answer must be checked on arrival.**
  The shell's `patches()` follows the shell; an ftp session addresses a second machine at the
  same time, so it carries `ftpPatches` beside it. The fetch is fire-and-forget, which makes
  the guard load-bearing: when it resolves, compare the SESSION ID it was fetched for against
  the one now held and drop it otherwise. Without that, quitting one box and opening another
  before the first answer lands renders one stranger's files under another stranger's name.
  `state.test.ts` pins both orders (a late answer with a different box open, and with none).
- **A door adds no authorization dimension — and the way to keep it that way is to reuse the
  client, not to teach the server.** `put` writes to another player's box by pointing the
  SHIPPED `createPatchApi` at the ftp session's machine; `authorizeMachineAccess` and
  `remoteWritePermission` were not touched, and never learn a second protocol exists.
  `sessions.kind` is data the gate does not read. If a new door ever *does* require a change
  in either module, that is the signal to stop and re-open the design rather than widen the
  gate — proven live by `scripts/testFtpPut.ts`, one destination refusing a `guest` credential
  and accepting a `root` one over the same door.
- **A client must not pre-check a permission the server owns.** `put` sends the write and
  renders whatever comes back. A client that refuses on its own behalf is one that could
  permit on its own behalf, and worse for tests: a local pre-gate makes every unit test pass
  without the server claim ever being made. The consequence is honest naming — a vitest
  refusal proves what the COMMAND does with an answer, so the tier contrast lives in the
  wire-check and the unit test is named for the message, not the tier.
- **Whose box it is decides whose ROW a trace lands in, and a foreign box's log is never
  keyed to its visitor.** A generated host's log is per-player and caller-keyed; another
  player's is shared, so a visitor-keyed line lands in a different row from the login that
  preceded it and the journal's last-write-wins replay hands the defender half a visit —
  the second visitor erasing the first. `recordFtpTransfer` decides with ONE occupancy
  lookup (`findOccupantWorkstationByMachineId`): a hit means the owner's row and a
  server-derived address, `null` means a generated host and the caller's own row with the
  address they reported. When that lookup fails it writes nothing rather than guessing —
  a line under the wrong key is worse than a line that never arrives.
- **A cross-player write of DATA lands under the TARGET's key too, for a sharper reason than a
  trace does.** `patches` is keyed `(machine_id, path, writer_key)`, so a row per attacker does
  not accumulate — it FOLDS to whichever was written last, and the loser's content is gone. On a
  log that costs a defender half their evidence; on the mysql datadir it silently drops the rest
  of their database. So `mysqlStatement` writes the datadir under the box owner's key, the same
  key the owner's own edits land under, and the two meet in one file that behaves like what it
  is: a document several people are editing. The shared-file write-wipe this accepts is real but
  far smaller here than in `nano` — the door re-materializes on EVERY statement, so the window is
  one in-flight request rather than one editing session.

- **"Re-materializes on every statement" has to be true of the OWNER's door too, and for one
  release it was not — corrected 2026-08-23.** The claim above held for every vantage the SERVER
  answers and silently failed for the one the client answers. The own-box door composed its two
  whole-file writes — the datadir and `/var/log/mysql.log` — from the tree this client was
  holding, which is refreshed on start, on a write of its own, and on a cross-TAB hint, and never
  by another player. So the window was not one in-flight request, it was the owner's whole
  session: a live browser run had a neighbour's `UPDATE` revert to its old value, and the
  neighbour's line vanish from the log, the moment the owner ran a statement of their own. The
  direction is what makes it bad — the writer being reverted is the intruder, but the file being
  shortened is the DEFENDER's evidence, destroyed by their own routine use of their own box.
  `env.fs.reload()` is the fix and the general rule it stands for: **a whole-file write to a path
  somebody else can write must compose against the MACHINE, never against the client's copy of
  it.** A shell may trust its own tree because the player is the only one editing; the moment a
  file is reachable through a daemon, that stops being true. The reload deliberately keeps the
  existing tree when the read FAILS — an unreachable server is not a box whose files went away,
  and blanking it would hand that writer an empty datadir to overwrite the real one with, which
  is why `readOwnPatches` reports whether the read HAPPENED and `fetchOwnPatches` (whose `[]` is
  fine for a reader) is now expressed in terms of it.

- **The same rule caught a SECOND caller at D9 slice 3, and there it had to cover READS too.**
  A script's `fs.writeFile`/`appendFile` are the second thing in the game to compose a
  whole-file write, so an append reloads and names its `baseContent` — a write landing between
  the two is refused rather than flattened. `fs.readFile` needed the rule for a reason the
  mysql door never had: **a script WRITES during the line.** `env` is built once per submitted
  line, so a script that appended twice and then read its own report was handed the content
  from before the run — the journal held four lines and the script said two. Not an error a
  player could notice, just a wrong answer, and invisible to vitest because a test `FsView`
  has nothing behind it and reloads to the tree it already has. So the rule generalizes:
  **a shell may read its own copy because it is rebuilt per line and the player is the only
  editor; anything that is neither — a daemon-reachable file, or a caller that writes DURING
  the line — must ask the machine.** Found by the browser close-out, not by the suite.

- **The VANTAGE is decided from the ADDRESS, server-side, and ONE function decides it for EVERY
  data door.** `reachServiceHost` routes four of them — public IP, a fellow occupant of the
  caller's own ESSID, a port that addresses the layer behind an inner gateway, and a generated
  sibling — and every one of them ends in the same `openServiceOn`: same boot gate, same "is the
  named daemon on the port you REACHED", same refusals. Nothing a client says about where it is
  standing selects a branch. Which daemon is a PARAMETER rather than a second copy of the file,
  which is what let D7's key-value door inherit all four vantages the day it started sharing the
  resolver — and why the last door to be built paid nothing for reach, while nothing said the
  evidence for it was missing.
  Routing in the reach rather than in a second pair of handlers is what keeps a login and every
  statement behind it agreeing about reachability by construction, which is what lets a defender
  stopping a daemon (or pulling a forward, or leaving the WiFi) drop an intruder on their next
  statement with no session row to invalidate.

- **A real occupant BEATS the generated sibling standing on the same octet, and every tool has to
  answer by that rule.** A lease is issued from the whole `/24` and nothing reserves the octets the
  ESSID's seeded NPCs already fill, so the collision is ordinary rather than exotic. `nmap` merges
  the host list, `ssh` and `nc` check occupants first — and any tool that resolves its target from
  `generateHomeLan().hosts` ALONE cannot see a player at all, which is what `hydra` did until D6
  slice 7. The merge belongs to the target RESOLUTION, never to one service: fixing it for the
  database door only would have left one tool answering by a different rule depending on which
  service was named. The rule in full: occupancy is the LAN boundary (you reach a box on a WiFi by
  being on it), the LEASE is the address, self is excluded, and an occupancy or lease read that
  FAILS refuses rather than falling through — quietly dropping to the generated world would sweep,
  or write to, a seeded box standing where a real player is. When a player leaves, the sibling
  underneath answers again.
  - **The merge covers a neighbour's PORTS too, and only since v0.182.0.** Merging the host list
    made a player VISIBLE; it did not make them legible, because a generated sibling's ports come
    off a filesystem keyed on the host IP and a real occupant's cannot. For four slices `nmap`
    answered a neighbour with `Host is up.` and no port table — correct, since falling through
    would have reported the NPC that octet rolled as the neighbour's own services, but it left a
    door onto a box a player had to GUESS was there. `resolveOccupantScan` resolves it server-side
    from the occupant's own journal, boot-gated, and it is generic to every service for the same
    reason the merge is: one tool must not answer by two rules depending on which service was
    named. It resolves ONE address, lazily — a single-IP scan of an occupant returns early beside
    the inner-gateway branch, so the client's sync port resolver never sees an occupant at all,
    and a RANGE renders no port table for anybody and asks nothing.

- **A failed round-trip is not an answer about the target, and a seam that conflates the two makes
  the tool lie.** `resolvePublic` collapses every failure — non-ok, malformed, thrown — into
  `found: false`, and that is honest THERE: nothing local ever established that a public IP has a
  host behind it, so "down" is the truthful shape of "we could not find one". It is wrong for a
  fellow occupant, because the occupant list has already placed that box on the LAN — reporting it
  down would blame a live neighbour for our own outage. So `resolveOccupant` keeps three outcomes
  where the public seam keeps two: `found: true` carries the ports, `found: false` is a RESOLVED
  host-down (bricked, or the occupant left), and `null` is "we could not ask" and renders as the
  host listed with no port table. The same distinction `fetchPublicPage` already draws between
  `host_unreachable` and `network_error`, and for the same reason.

- **Across somebody else's NAT and inside your own network, a door refuses DIFFERENTLY on
  purpose.** A forward onto a stopped daemon answers `host_unreachable` from a public address but
  `service_not_running` down your own chain or on a shared WiFi. That is not drift: from outside a
  stranger's NAT, a forward onto a dead port and a forward that was never opened are the same
  silence — the only thing the gateway can actually observe — and a door that told them apart would
  be telling an outsider which services a box behind that NAT has stopped. Inside the network the
  caller is inside, so the specific answer is the honest one. This is a STRONGER rule than "depth
  must not change the words a player reads", and it is the exception that rule has.

- **The indistinguishability rule binds the SCAN, not only the door.** A port a box filters must go
  DARK from the network — absent from the scan, one silence with an address bearing no network, a
  bricked box, a stopped daemon and a service the box fronts elsewhere — never labelled "filtered".
  A scan that still listed it would hand a stranger the one signal every other dark state hides: a
  pointer to the port worth a wordlist. `portsOpenToNetwork(hostFs)` = `readOpenPorts` −
  `parseInputDenies` is the single view EVERY remote reader judges by — both the public and the
  same-LAN vantage read the filter — while the OWNER's own view keeps reading the pidfiles
  directly. That split is exactly what makes a filter beat `systemctl stop`: the daemon still runs
  and `127.0.0.1` still reaches it, but the world sees nothing.
- **An INPUT rule governs traffic a box TERMINATES, never traffic it passes through.** A gateway's
  own filter closes the gateway's OWN ports; a forward it merely passes through is closed only by
  the TARGET box's filter — so a stranger denying a public port on a gateway does NOT close a
  forward an occupant opened onto their workstation, and the forward's target denying its own port
  DOES. Precedence between an own service and a forward on the same public port is decided by what
  the box RUNS (`readOpenPorts`), not by what its filter lets it answer: otherwise a denied port
  the router serves would re-open through somebody else's forward while the reach, routing on the
  pidfiles, went on refusing it — a scan advertising a door nobody can walk through, the same lie
  as hiding one that works.

- **A caller's claimed VANTAGE is checked, not believed** (`standingVantage`, beside the L1
  gate). Naming the box you operate from is what lets a trace record the network the target
  actually saw, so a caller naming a box they hold no session on is refused rather than
  written up as that network's owner. Naming none means the caller's own workstation — no
  row, no borrowed network, the address they own. That is why `ssh`, which names no box,
  kept its behaviour byte-for-byte when the vantage resolver replaced the home-address one.
- **A service's secret may belong to the SERVICE rather than to an account, and the contract says
  which.** `ServiceSpec.accountsOn` returns `{ username, hash }` and a redis `requirepass` is
  neither — so the spec carries a `secretOn` sibling instead, and a sweep that finds one reports it
  with NO login field. Faking a username there would have reprised D6 slice 2's shipped bug: the
  right name against the wrong secret. Two consequences worth knowing before designing the next
  door. A locked store discloses NOTHING through the statement door until the secret is spent —
  the lock is on every question, not on the connection, so connecting and being told nothing is
  the honest shape. And a PLAYER's store mirrors their own root password with no opt-out, which
  makes `hydra <player> redis` a DEAD END by design between players: a chosen password is in no
  wordlist the game hands out.
  - **That dead end is currently TOTAL between players, and an earlier version of this entry
    claimed otherwise.** It said the route was `ssh guest@them` → their root hash out of
    `/etc/passwd` → crack the md5 externally → `AUTH`. **That route does not exist.**
    `PASSWD_FILE` grants `read: ['root', 'user']` — a guest cannot read `/etc/passwd` on ANY box,
    by design, because it holds the account names and inline hashes a player is meant to earn.
    Verified live 2026-08-26: on a player's own box the owner sees `/etc/passwd`, and a second
    player holding a guest session on that same box sees only `/etc/redis`.
    The other half is what closes it. Against an NPC, `hydra <host> ssh` enumerates the box's real
    accounts and can return `root` or a `user` — tiers that DO read `/etc/passwd`, which is why
    the classic crack-the-hash route works there. Against a PLAYER's workstation the only account
    in any wordlist is `guest`, whose password is drawn from the crackable pool; the owner's is
    chosen. So a guest session is the ceiling, and the hash behind the store is unreachable.
    This is consistent with the CVE arc being the planned second way in — an uncrackable
    credential is not a design gap — but until it ships, one player's store is not reachable by
    another at all. Do not write a route into this file that has not been walked.

- **`SweepLog` is where a SERVICE says how it records being knocked on** — path, owner,
  permissions, `formatAttempt`, and an optional `formatArrival` for a daemon that records
  reaching the door separately from getting through it (vsftpd does; sshd's first line already
  *is* the attempt, so an arrival there would be an invention). It hangs off `ServiceSpec`, so
  a login, a hydra sweep and a cross-network break-in against one service cannot disagree about
  which file the defender reads. Two rules travel with it. **Arrival and attempt land in ONE
  append** — they are one event to the box, and two appends are two read-modify-writes racing
  over the same file. And **the name stays**: it carries logins as well as sweeps, but nothing
  a *transfer* writes goes through it (that is `formatVsftpdTransferLine` on its own endpoint),
  so the rename considered at slices 4 and 5 was closed rather than deferred a third time.
- **A parallel sub-shell is a restricted command MAP, not a screen, and not a hop.** `ftp` set
  the shape every later one (`nc`, `mysql`, `redis`) should follow: a signal the terminal reads
  to dispatch elsewhere, `enter`/`leave` as siblings of `pushSession`, no `OverlayMode` arm, and
  an unknown command refused rather than falling through to the real shell. Two consequences.
  `rehydrateSessionStack` rebuilds only HOP kinds (`ssh`/`su`) — an **allowlist**, so the next
  parallel door needs no second exclusion — and everything else comes back `abandoned` for the
  boot sweep to close, since a lingering active row is a silent write grant on someone else's
  box (sessions have no TTL). `end_reason` is a closed enum (`user_exit` | `abandoned`) so a row
  the player quit is distinguishable from one a refresh dropped. **Do not build a generic
  sub-shell mechanism until a third caller earns it** — one instance is not a pattern.
- **Inside a sub-shell, DATA commands delegate and CONTROL commands do not.** `ls`/`lls` run the
  real `ls` with `{ ...env, fs: <binding>.fs }`, which is what makes the flags, the sort, the
  long format and the permission refusal identical on both machines — "refused exactly as it
  would be over ssh" is not re-implemented, it IS that refusal. `cd`/`pwd` answer in the
  protocol's own numbered responses (`250`/`550`/`257`) because they are control-channel
  commands, and the `l`-prefixed trio speaks unnumbered because nothing it does touches the
  control channel.
- **A backdoor shell is a real hop minus what needs a TTY, and the gates that say so run BEFORE
  the line is parsed.** `nc` is not a sub-shell: it lands a session at the tier its pidfile records
  and everything runs there, except the six commands a raw socket cannot carry — `su`, `nano`,
  `ssh`, `scp`, `ftp`, `lynx`. That is the mechanic, not a limitation to route around: a root-planted
  listener can brick a box while a user-tier one cannot be escalated in place, because `su` is
  exactly what needs a pty. **The eviction check sits beside the no-TTY check**, same seam, same
  shape of rule (*this session cannot do that*), and running both before the parse is what makes a
  typo into a dead backdoor answer `nc: connection closed by foreign host` rather than `command not
  found` — nothing the player typed reached the box, so the box was never there to have looked. It
  also covers pipelines uniformly: `ls | grep x` can no more slip past a dead socket than `su | grep
  x` can past a missing pty.
  - **Eviction is a PULL, not a push.** The intruder learns the socket died by writing to it, as a
    real terminal does. `Session` gained a `port` for it, and only a backdoor sets one — every
    other door spends its port reaching the box and never needs it again, while a backdoor is the
    one that has to keep asking whether it is still there. No push channel, and no widening of
    `endSession`, which is deliberately scoped so a caller can only end their OWN rows.
- **D2.4's `reachedPort` rule binds the LOGIN gate too, and did not until v0.136.0.** hydra
  had checked the service on the reached port since v0.120.0; `authCreateSessionPublic` never
  had, so a forward to :22 was an `ftp` door and a forward to :21 an `ssh` one. Both now
  refuse with `service_not_running`. Reach for `reachedPort` whenever a new door is added to
  that handler — the check belongs to whoever knows which daemon was knocked on. **Completed at
  v0.142.0 (D4 slice 3):** the two paths that still disagreed now obey it too — the own-LAN
  handler's `ssh` exemption is gone, and the same-LAN handler compares the SERVICE on the reached
  port instead of merely finding something open there. All four login gates now ask one question.
- **A session's `kind` is PROVENANCE; the service it rides is a separate lookup.**
  `SERVICE_BY_DOOR = { ssh: 'ssh', ftp: 'ftp', scp: 'ssh' }` (`authCreateSession.ts:57`,
  exported and indexed by BOTH login gates) is the entire mechanism. `scp` is stored as `scp`
  so a row records which command opened it, but it has **no `SERVICE_CATALOG` row and must
  never get one** — it is not a service. That one indirection makes three things true by
  construction instead of by discipline: a transfer is gated on sshd listening, its trace goes
  through the ssh sweep log, and **there is no scp log line to forget to suppress**. A future
  door that is not a daemon adds a row here, not a column anywhere. The asymmetry this once
  produced is **gone as of v0.142.0**: the own-LAN gate was `payload.kind !== 'ssh' && !listening`,
  which refused `scp` against a box with sshd down while letting plain `ssh` through. D4 slice 3
  dropped the exemption, so all three doors are refused by the same `!listening` — `scp` and `ssh`
  ask the same daemon the same question, which is what made the shared lookup right in the first
  place.
- **A remote read must decide LOCAL-or-SERVER before it resolves, because the local resolver
  fails by handing back YOUR OWN box.** `resolveActiveRoot` falls back to `ownBaseFs` when the
  ESSID cannot generate the target (`activeRoot.ts:45`) — correct for a machine this client
  can build (an NPC on the player's LAN, their own deep layer) and silently wrong for another
  player's workstation, where it does not error but returns the CALLER's file tree under the
  target's name. So every remote read asks `isCrossPlayerWorkstation` first and sends a
  stranger's box to `resolveCrossPlayerFs` (server-materialized, tier-pruned before it crosses
  the wire), the same call an ssh hop's `refreshServedRoot` makes; `scpTargetTree`
  (`state.ts:590`) is that split. A door that reads a remote box and skips the check has a bug
  no type can catch and no unit test with a stubbed resolver can see — it took a live
  wire-check to prove, which is why it is written here rather than in a comment.
- **`is_new` on a patch is INERT — do not adopt it for symmetry, and do not believe
  `ftpShell.ts`'s comment about it.** Checked exhaustively when `scp` had to decide whether to
  send one: `applyPatches` and `materializeMachineFs` never read it; `removePatch` deletes the
  patch tree and tombstones with `is_new: false` regardless, so it does **not** decide "a later
  `rm` deletes it" the way that comment claims; the only live read is inside `upsertPatch`'s
  `rejectModifiedSinceOpen` guard, which early-returns when no `base_hash` is sent. Both `scp`
  directions omit it deliberately — the flag asserts "no base-FS file stood here" and the
  upload never looks at the target, so sending one would be a guess. A flag no test can fail is
  a claim nobody is keeping true. The stale comment is a behavior-neutral cleanup left for a
  slice already in that file.
- **A command that awaits the NETWORK must read `env.signal.aborted` itself.** Everywhere else
  Ctrl-C surfaces by rejecting an in-flight `env.sleep`, so a paced tool unwinds for free; a
  transfer awaits a round-trip instead and would otherwise land its bytes after the player
  abandoned it. `scp` is the codebase's only reader, checking at the two moments nothing has
  landed yet — before the transfer starts, and (download only, where a read-then-write gap
  exists) between the remote read and the local write. Any later door holding a session across
  a round-trip inherits the requirement. Related shape: an abort generator with nothing to
  yield is an eslint `require-yield` error, which is why `scp`'s early exits return plain sync
  results and only the path that actually waits paints `Connecting to <host>...`.
- **A log line that names an ACCOUNT reads it off the session row, never off the payload.**
  The client says what it did (`recordFtpTransfer` sends the path, the byte count and the direction); who it
  is comes from the `(player_key, machine_id)` row the L1 gate just looked up. A defender's log
  a visitor can author is not evidence — and the same rule already covers the clock (server
  `now()`) and provenance (`writer_key` stamped from the verified pubkey). Two consequences
  worth stating: `ActiveSession` therefore carries `username`, and a handler that needs an
  identity must **refuse the own-workstation L1 BYPASS**, which returns `session: null` and so
  can name nobody. Proven live by `scripts/testFtpTransferTrace.ts`, which claims `impostor`
  and reads the real account back out of the box's own log.
- **`ActiveSession` is the L1 projection; take a `Pick` of it when you only need the tier.**
  `remoteWritePermission` answers a permission question, which needs `userType` + `essid` and
  no name at all — so it takes `Pick<ActiveSession, 'userType' | 'essid'>`. Without that, every
  field added to the projection for one consumer breaks every fixture of every other one
  (adding `username` broke ~35 call sites; 20 were that module's).
- **The player's OWN box answers its own database — the server door is for other people's.**
  `commands/mysqlOwnBox.ts` runs the whole `mysql` conversation client-side when the target is
  the box the player is standing on: the credential check, `runStatement`, the datadir rewrite
  and the `/var/log/mysql.log` lines. It is not a second implementation — every decision is the
  same shared function `handleMysqlConnect`/`handleMysqlStatement` call, so what differs is
  where it runs. The reason the server exists at all is to stop a client writing to a box it
  does not own, and on your own box there is nothing to protect: you are root, the datadir is a
  file you can open in an editor. Addressing follows the web door: `localhost`, `127.0.0.1` and
  the leased LAN address are ONE address, and the source recorded is loopback or that address
  (`network/interfaces.ts` owns `LOOPBACK_NAMES`, shared by both doors). The cross-player
  direction stays server-side — that is where `reachMysqlHost` learns about player-owned boxes.
- **A SYSTEM write on the player's own box names its own owner.** `PatchApi.write` takes an
  `owner` override for exactly this: a daemon's log line and the datadir it keeps are root's
  whichever tier the shell that triggered them sits at. Without it a user-tier player running an
  `UPDATE` would rewrite `/var/lib/mysql/data.json` as themselves and hand their own ordinary
  account the hashes a sweep is supposed to have to work for. The server has always accepted the
  field on `upsertPatch` (own-machine writes are authorized by machine, not by owner), so this
  needed no `api/` change — it is the CLIENT that used to have no way to say it.
- **A generated box carries the packages for the services it runs — additively.** For each
  running service it gets every apt package that either shares that service's name or ships its
  daemon (`binariesForService`, `packages/aptPackages.ts`), each binary landing where apt itself
  would put it: tools in `/usr/bin`, daemons in `/usr/sbin`. That union is why the two services
  whose daemons come with the base image need no case of their own — nothing in the catalog
  claims `sshd` or `vsftpd`, so ssh matches nothing, ftp matches on its NAME and gets only the
  client, and http and mysql match on their daemon. The daemon's name is always
  `daemonName(spec)` off the pidfile, never a second catalog field, because that is already the
  one name `ps`, `nmap` and `systemctl` agree on.
  - **The base image never shrinks.** `SYSTEM_DAEMON_NAMES` stays on every box whether it serves
    those doors or not, because a binary present with NO pidfile is a service installed and
    stopped — the ordinary condition of a real machine, and what `systemctl status` prints `○`
    for. Planting only what each box runs would strip `sshd` from the ~60% of hosts that draw no
    ssh and erase that state from the world.
  - **Binaries only, never a package's `extraFiles`.** The `mysql` package ships a datadir drawn
    from the PLAYER's identity; a generated box already holds its own, seeded per
    `(essid, host.ip)`. Laying the package's over it would overwrite every NPC database.
  - Why it matters: `unitFor` resolves a unit only when its binary is present, so before this a
    rooted NPC webserver had no way to shut port 80 — `systemctl stop nginx` found no unit and
    `kill` refuses unit names outright.
- **`core/packages/` imports nothing from `core/commands/` — and neither does `core/generation/`.**
  The apt catalog is world DATA, not a command's private table: the world generator reads it to
  decide what a box carries. Its one tie upward was `AptExtraFile.content`, which now takes a
  narrowed `PackageFileContext` (`identity.publicKeyHex`, `hostname`, `fs.root()`) instead of the
  whole `CommandEnv`; `CommandEnv` satisfies it structurally, so `apt` passes its own env through
  unchanged. Keep it that way — a package whose bytes could reach the shell would make world data
  depend on the layer above it.
  - Residual, and deliberately not chased: `packages/` still imports `generation/baseFs` and
    `mysql/ownDatabase`. There is NO module cycle — those edges reach generation's primitives,
    never back to a composer like `remoteHostFs` — so it is a diamond, not a loop. The shape is
    pre-existing: `generation/` holds primitives and composers in one directory.
- **The scripting host (D9) grants no capability — it removes typing.** `runScript` is pure over
  `(source, context)`: it knows nothing about commands, the terminal or `CommandEnv`, so a caller
  that is not `node` reuses it rather than building a second sandbox. There is ONE mode and it is
  async. The body is wrapped in a BLOCK, not used as the function body, so a script's own
  `const console = …` is a legal shadow instead of a redeclaration `SyntaxError`.
  - **Every command reaches a script through `buildCommandContext`, in the SHELL's own order** —
    peel the trailing flags object, coerce positionals, bind and validate flags against the
    command's real `FlagSpec`, ask `withoutScript`, check the tty — and only then `execute`. The
    order is `prepareStage`'s and matters for its reason: a refusal arriving after `execute` would
    arrive after `ssh` had already written a line into somebody's auth.log. So a script runs at the
    same tier, through the same walker, with the same refusals as typing would.
  - **Four names are injected LAST, after the registry spread: `console`, `fs`, `process`,
    `sleep`.** Ordering is the whole protection — a command named `fs` would otherwise silently
    shadow the filesystem for every script on the box. `registry.test.ts` pins
    `identifiers.length + 4`; grow that number with any fifth name.
  - **"Aborted" is a property of the RUN, not of the error.** `node` asks `env.signal.aborted` after
    `runScript` returns — whether the script failed OR finished — and throws `env.signal.reason`.
    Checked on success too because the defensive loop a player actually writes
    (`for (const host of hosts) { try { await nmap(host) } catch {} }`) swallows the abort along
    with the failures it was written for and comes back `ok`; a check scoped to the failure branch
    would let Ctrl-C exit 0 in silence. Matching an `AbortError` by name instead would let a script
    forge an interrupt by throwing its own.
  - **`node` THROWS the interrupt; `state.ts` owns the only `^C`.** The marker is a `text` line —
    stdout — so a command printing it itself would write `^C` into `node sweep.js > out.txt` and
    pipe it into `grep`, and an interrupted pipeline would complete as though the sweep had
    finished. The throw lands AFTER the drain, so everything the script printed survives.
  - **Guards run before AND after every command invocation, and before each `fs` method** — all via
    the standard `env.signal.throwIfAborted()`. They do different jobs: *after* withholds the result
    of a command that finished as the key went down; *before* stops NEW work reaching the server,
    which is the half a script's own `try/catch` cannot defeat — it may swallow every throw, but
    nothing further executes. The `fs` guards are also the only interruption point a loop that
    touches files and never calls a command has. Never post-check a write: once the journal holds
    it, throwing would deny something that actually happened.
  - **A synchronous infinite loop is an accepted tab-hang.** An `AbortSignal` cannot interrupt
    synchronous JavaScript on the main thread; the real fix is a Web Worker with `terminate()`,
    which turns every command call into a postMessage RPC across a boundary `CommandEnv` does not
    serialize. `sleep(ms)` is what gives a computational script a yield point instead.
  - **`node` declares no flags, so `--` is how a script gets a dashed argument**
    (`node sweep.js -- -v 10.0.0.5`). The shell binds flags before `node` sees anything, so it
    cannot do real node's stop-at-the-operand parsing; `bindFlags` already implements the sentinel,
    so this costs no shell mechanism.

- **Known deferred gap (L3 smart-server):** a client with a valid keypair can mint an
  `effect_one_shot`/root session via `createSession` and call `exploitRead` directly,
  skipping the in-game CVE flow. Accepted per the security model; real fix = server-side
  game-logic re-run.

---

## 8. PR / git conventions

- **Squash-merge:** `gh pr merge <#> --squash --delete-branch`.
- **Conventional Commits** with scoped prefixes (`feat(v2):`, `fix(v2):`, `docs(v2):`,
  `test(v2):`). The `(#N)` suffix is appended automatically on squash.
- Commit messages end with the `Co-Authored-By` trailer; PR bodies end with the Claude Code
  generation trailer (see root `.claude/CLAUDE.md` harness rules).
- **Never write "+ the working tree" in a plan header.** It is true for the minutes between writing
  the plan update and committing it, and false forever after — sending whoever picks the work up
  hunting for uncommitted changes in a clean tree. Twice now in one slice. A plan update committed
  ALONGSIDE the work it describes cannot name its own hash, so name only the commits that already
  exist and let the next update add this one.
- Cut a branch per slice off `main`; never commit straight to `main` for code.
- **Do not stack a PR on a branch that will be squash-merged with `--delete-branch`.** Merging
  the base deletes its branch, and GitHub then **closes** the stacked PR instead of retargeting
  it — a closed PR whose base is gone cannot be reopened (`Cannot change the base branch of a
  closed pull request`) and cannot be rebased in place. Squash makes it worse: the base's commits
  never become ancestors of `main`, so a naive reopen would show the base's work as new. Recovery
  is `git rebase --onto origin/main <old-base-sha>`, verify the tree is byte-identical
  (`git diff <pre-rebase-sha> HEAD` empty), re-run the gates on the new base, `push
  --force-with-lease`, and open a replacement PR. Prefer avoiding it: merge the base **without**
  `--delete-branch`, or just wait and branch the follow-up off the merged `main`.
- **`git pull --ff-only` prints "Already up to date" when local is AHEAD of origin, not only
  when it is level.** A docs commit made on `main` at the end of one session was never pushed;
  the next session's `/continue` ran `git pull --ff-only`, read "Already up to date" as "in
  sync", and cut the slice branch off the unpushed commit. The squash-merge then folded that
  commit into the PR (so nothing was lost) but left local `main` diverged by one commit each
  way, and `gh pr merge`'s own post-merge pull died with `fatal: Not possible to fast-forward`
  **after** the remote merge had already succeeded — which reads like a failed merge and is not
  one. Check `git status -sb` (or `git rev-list --left-right --count main...origin/main`), which
  distinguish ahead from level; and if that error appears, confirm with
  `gh pr view <#> --json state,mergeCommit` before touching anything. The recovery is
  `git reset --hard origin/main`, but verify first that the squash really contains the orphaned
  commit (`git diff origin/main <sha>` should show only later additions).

---

## 9. Deferred backlog & future content ideas

Forward-looking direction not yet built (preserved as pointers; design when actually built).

- **An interrupted REDIRECT is silent — no `^C`, no error.** `state.ts` prints the marker
  inside its `if (result.kind === 'async')` branch, but a redirect collects the stream
  first, so the abort's rejection escapes `runCommandLine` during collection and never
  reaches that branch. `airodump-ng > scan.txt` and `node sweep.js > out.txt` both just
  return to the prompt having written nothing. The half that matters is already right —
  no partial file, and the marker cannot be captured INTO the file, which is why `node`
  throws rather than printing (D9 decision 13, verified in the browser). Found at D9
  slice 4's close-out; belongs to a change that owns the redirect path.

- **`Command.tier` is declared by every command and read by NO production code.** The only
  `.tier` outside tests is `snmpwalk.ts`'s unrelated `walked.tier`. Surfaced at D9 slice 3's
  mutation gate, where `tier: 'guest'` survives — and it will survive under every command
  this project ever mutates, alongside `availability`, so recognise the family rather than
  re-triaging it each time. A repo-wide reduction candidate: either delete the field or give
  it the reader its presence implies. Not a bug; nothing is gated wrongly, because nothing is
  gated by it at all.

- **`runLine.ts` `withCarried` has an untested arm that would throw.** Mutating
  `result.kind === 'sync'` to `true` survives the full suite, which means no test has BOTH a
  non-empty carried list AND a non-sync final stage — and in that state the code spreads an
  `AsyncIterable` with `...` and throws. Reachable in principle: an intermediate stage writing
  to stderr ahead of a streamed final stage. Predates D9 by many PRs; found by slice 3's
  mutation gate and deliberately left for a change that owns the pipeline, rather than
  widened into a slice about a script's filesystem.

- **The D6 browser smoke test's findings are ALL closed (last one 2026-08-26).** The run that
  found the own-box write-wipe (fixed in v0.172.0, #449 — see the §7 invariant) turned up three
  more, none of which blocked a player and none of which belonged in that fix. Two closed at
  v0.173.0 — the sub-shell prompt echo and the self-scan cover name — and the third, the one
  recorded as a product decision rather than a bug, closed at v0.182.0 (D7 slice 7b) when the
  decision was finally taken. Kept as a record of what a smoke test is worth: one session's
  browsing produced four findings, three of them invisible to a suite that was green.

  1. **The `mysql` sub-shell echoed the SHELL prompt — RESOLVED (v0.173.0).** Every statement
     scrolled back as `root@box:/root# SHOW TABLES;` while the live prompt correctly read
     `mysql> `, because two places decided the same thing: the echo in `ui/state.ts` branched
     only on `inFtpSession()`, while `Terminal.tsx` had a two-rung ladder. Both now read one
     `subShellPrompt()`, so the next sub-shell gets the echo and the live prompt right by being
     added once — the second special case the entry warned against was never written.

  2. **A fellow occupant's open ports were invisible to `nmap` — RESOLVED (v0.182.0).** A
     neighbour scanned as `Host is up.` with no port table, and the blank was CORRECT: a real
     occupant's services live on THEIR box, `buildRemoteHostFs` keys on the host IP alone, and
     letting them fall through would have FABRICATED the NPC ports that octet rolled. So this
     was a product gap rather than a bug — nothing told a player their neighbour ran a database,
     and finding it meant guessing the service and letting `hydra` look. The fix is the shape
     this entry predicted: `resolveOccupantScan`, server-side, generic to every service, resolved
     lazily for ONE address when it is actually scanned. Two things the entry did not predict.
     The client needed no async port resolver — a single-IP occupant scan returns early beside
     the inner-gateway one, before the sync resolver is built. And a two-state resolution would
     have made the tool lie: collapsing a failed round-trip into `found: false` reports a live
     neighbour as DOWN, so this seam keeps three outcomes where the public one keeps two.

  3. **You saw yourself under a cover name — RESOLVED (v0.173.0).** In her own scan a player
     showed as the generated `desktop-32` while every other path — occupants, public targets,
     same-LAN sessions, elevation — named her `alicebox` from the registry, so the cover was one
     only its owner was behind and it bought nothing. Self now uses the workstation name.
     `env.workstationName` is new beside `env.hostname` because a hop is where the two part:
     after `ssh` the shell STANDS on the remote box, while the player's own workstation keeps the
     name their neighbours already see. `ping` passes a name it never renders, so no behaviour
     was invented there.

- **D6's remaining test debt, graduated on close-out (2026-08-23).** Two items, both narrow and
  both about assertions rather than behaviour. (1) The `mysql` client's prompt WORDING — `Enter
  user: ` and the no-default rule — is written and untested; the `Enter password: ` half and
  `masked: true` are asserted, and the gap shows up as a surviving `StringLiteral` mutant on
  `mysql.ts`. (2) `pools/database.ts` sits at 88.69% with **42 surviving column-metadata mutants**
  that need `DESCRIBE` asserted **over the population** rather than over one drawn box — the
  assertion slice 3 owed and did not write. Neither blocks a player; both are cheap for whoever
  next opens those files.

- **A rooted generated box can have its doors shut — RESOLVED 2026-08-22 (v0.168.0, #444).** The
  rule landed: a generated box carries the packages for the services it runs, so `unitFor` finds
  the binary and `systemctl stop nginx` works on an NPC webserver. See the invariant in §7. What
  remained was the slice's own remainder, and slice 6b is now COMPLETE (v0.169.0): the end-to-end
  evidence landed as `generatedBoxDoors.test.ts` needing no production change, as predicted, and the
  two apache-flavoured `/etc/httpd.conf` templates were rewritten nginx-flavoured so a generated
  webserver's config, its COMMAND column and its `/usr/sbin` all name one program. The one thing it
  surfaced rather than closed is the scan half, recorded with the own-LAN `nmap` entry below.

- **Should `vsftpd` be an apt package rather than base image?** Raised while grilling slice 6b and
  deliberately parked, because the union rule above resolves it with no second decision: the day
  the `ftp` package gains `daemons: ['vsftpd']`, fileservers start carrying both halves and every
  other box stops carrying a daemon it never runs. Today `vsftpd` ships on every machine
  (`SYSTEM_DAEMON_NAMES`) while the `ftp` package installs only the CLIENT — an asymmetry that is
  historical rather than designed, since ftp landed before apt had a `daemons` field.

- **`testFtpSession` is 12/14 against a live stack, and has been for a while.** Two checks fail:
  `a login that names no kind is still an ssh hop` (reads back `kind=no row`) and `and ending one
  without a reason still reads as the player leaving` (`end_reason=undefined`). Both are the
  BACKWARD-COMPAT pair — a session created the way the pre-`kind` client created one — so what
  they guard is that an old-shaped login still lands a row at all. `no row` says it does not.
  Found while running the neighbouring wire-checks for D6 slice 2, on a freshly `supabase
  start`ed stack with migrations applied. Not caused by that slice, which touches neither
  `authCreateSession` nor `api/sessions.ts`'s session path. Deliberately left unfixed rather than
  patched on a guess: it needs someone to decide whether the old shape is still supposed to work,
  and the answer is a product call about launch compatibility, not a test fix. Until it is
  answered the doc's `testFtpSession (14/14)` is wrong; treat 12/14 as the current baseline.

- **A door's error BODY is asserted by one test in ten (found by D7 slice 7a's mutation gate).**
  Nine refusal tests across `src/core/sessions/` assert `expect(response.status).toBe(400)` and
  stop there; exactly one asserts `body: { error: … }` beside it. So
  `body: { error: verified.reason }` mutated to `{}` SURVIVES on every door — a handler could
  answer a bare `400 {}` and the suite would stay green. Narrow (the status is what routes the
  client's message) and entirely uniform, which is why slice 7a left it rather than fixing the two
  redis doors and leaving eight answering by a different standard. Whoever closes it should close
  it across the family in one pass; the mutant to reproduce is `ObjectLiteral` on the
  `STATUS_BY_VERIFY_REASON` return of any door.

- **An INTERMITTENT full-suite flake, seen twice in two days, still unnamed.** 2026-08-26, D7 slice
  7a: the first `npx vitest run` reported `1 failed | 171 passed`, and five later runs on the same
  tree were clean. Same day, D7's close-out: `2 failed | 171 passed` on a tree carrying **nothing
  but documentation edits**, then four clean runs (3737/3737 each). Neither failure was ever named.
  Most likely a timeout under the ~215s environment setup, but that is still a guess and is written
  down as one — twice now the evidence has been destroyed before anyone could look at it.

  **How it keeps escaping, and what to do about it.** The entry used to say "capture the test NAME
  before re-running". That is necessary and not sufficient: the second occurrence was lost to a
  `| grep -E 'Test Files|Tests '` on the FIRST run, which discards the failure block just as
  completely as a clean re-run does. So: **never pipe a full-suite run through a filter that can
  drop the failure detail.** Redirect the whole thing (`npx vitest run > suite.log 2>&1`) and grep
  the FILE. A summary line is the one part of the output that is worthless when something fails.

**Story-5b / multiplayer deferred** (detail in `plans/multiplayer-crossplayer-epic.md`
§"Remaining work"):

- **Story-7 reconciliation** — DONE except WiFi density and presence/TTL, which stay deferred.
  Shipped v0.88.0 → v0.96.0: unique per-ESSID public-IP allocation, collision-free LAN leases,
  one shared AP gateway per ESSID, ESSID-seeded shared NPCs and deep chains, and the removal of
  the store whose last-writer-wins PK caused the collisions. As-built in §7 and
  `cross-player-architecture.md`; the plan file was deleted on close-out.
- **The patch-error map is written seven times.** `{ no_session: 'Permission denied',
  permission_denied: 'Permission denied', network_error: 'I/O error', modified_since_open: … }`
  appears verbatim in `daemon.ts`, `ftpShell.ts`, `mkdir.ts`, `rm.ts`, `touch.ts`, `systemctl.ts`
  and `shell/runLine.ts` — one piece of knowledge (how a `PatchResult` failure reads to the
  player) with seven owners, so a new failure kind or a reworded reason has to be found in seven
  places. Each copy was added by following the one before it, which is why it never looked like a
  decision. Not urgent — the strings agree today — but it is the kind of drift that surfaces as
  two commands blaming different things for the same failure. Consolidating it is a small,
  self-contained refactor touching seven modules; it wants its own slice rather than a ride-along.
  (`const errorResult = …` is duplicated across seven command modules too, but that one is
  incidental shape rather than shared knowledge, and is fine as a local idiom.)
- **CLOSED (v0.151.0) — a backdoor session on an OFF-LAN box showed the intruder's OWN
  filesystem.** Found by Act 14 on 2026-08-18 at v0.150.0. Standing in an `nc` shell on another
  network's AP gateway, `ls /var/run` listed only the planted `nc-<port>.pid` and
  `cat /etc/iptables/rules.v4` said no such file — while `ssh` into the SAME box at the SAME
  public IP, same tier, listed `sshd.pid` too and printed the seeded NAT table.
  **Cause:** `ui/activeRoot.ts` `baseFsFor` resolves a foreign machine's seeded base with
  `generatedBaseFsForMachineId(essid, machineId)` using the VIEWER's current essid, and falls
  back to `ownBaseFs` when nothing matches. Off-LAN, nothing matches, so the intruder got their
  own workstation base with the target's journal replayed over it. `ssh` escaped it because
  `isCrossPlayerHop` routes an off-LAN shell to the SERVER-served tree, and that predicate was
  `kind === 'ssh' || kind === 'su'` — carrying the comment "Service sessions (nc/mysql/…) have no
  served tree and are excluded", true until D5 slice 4 gave `nc` a shell, stale ever since.
  It was not cosmetic: `env.patches` is bound to the TARGET, so a write issued from that shell
  landed on the target's journal while the tree on screen was the intruder's own.
  **Fixed** by counting `nc` in `isCrossPlayerHop` — and that was only half of it. Three things
  the fix turned up, all of which generalize past this bug:
  - **A served tree is not refreshed by a journal re-pull.** An off-LAN backdoor reads the tree
    the SERVER materialized, so slice 5's pre-line `refetchPatches()` left the shell asking a
    stale copy whether its own door was still open — cross-network eviction would have silently
    stopped working. `executeLine` now re-pulls whichever source the active tree comes from:
    served for a cross-player hop, journal otherwise. **Any future "re-read the box before
    acting" gate has the same two sources to choose between.**
  - **"It costs a round trip only in a backdoor" is a testable claim, and needs a test that
    prices a line** rather than reading its output. The mutant making the re-pull unconditional
    survived everything else: it changes no output, only how chatty the client is. The test asserts
    that a command on your own box issues NO requests at all.
  - **A hand-built filesystem is not a box.** A fixture tree without `/usr/bin` answers
    `command not found`, and one without library deps answers
    `ls: error while loading shared libraries: libpcre.so`. Build a served tree as
    `applyPatches(buildRemoteHostFs(essid, host), journal)` — base plus journal, the same two
    pieces the server composes.

  **What it says about coverage:** the session row was correct throughout, so no wire-check could
  see it — it was the tree the CLIENT renders that was wrong, which is why the browser act exists.
  The wire-check added alongside the fix proves the other half, the half no unit test can see:
  `authorizeMachineAccess` gates the served-tree fetch on an active session row regardless of
  kind, so an `nc` row authorizes it (`testNcCrossPlayerReach` 9/9).
- **CLOSED (v0.152.0) — an ftp session on an OFF-LAN box showed the intruder's OWN filesystem,
  the same defect one door along.** Found by reading the code while closing the `nc` one above,
  then reproduced: at `ftp>` on another network's box, `ls /home` printed `tester` — the
  intruder's own account. **Cause:** `ftpRoot` called `resolveActiveRoot` with no cross-player
  check at all, so off-LAN `baseFsFor` found no generated host for the target under the VIEWER's
  essid and fell through to `?? ownBaseFs`. Worse than the `nc` case: `get` reads the same tree,
  so taking a file off a stranger's box handed back a copy of the intruder's own while the
  target's `vsftpd.log` itemised it as a file that left.
  **Fixed** with a served tree held beside `ftpPatches` — a second one, for the same reason the
  journal is a second one: the shell's `servedRoot` follows the ACTIVE session and an ftp session
  is beside it, not above it. Three things worth carrying:
  - **There were THREE places deciding which tree a session reads, and they must agree.**
    `scpTargetTree` (always right), `activeRoot`/`isCrossPlayerHop` (fixed v0.151.0), `ftpRoot`
    (fixed here). Two were found only after a browser act caught the first. **Any fourth reader
    of a remote tree has the same question to answer**, and the answer is never "call
    `resolveActiveRoot` and hope" — off-LAN that resolver's honest answer is your own box.
  - **A fixture can be foreign in address and local in machine, and then it proves nothing.**
    The shipped ftp suite reached its targets at a public IP but generated them on the essid the
    player was CONNECTED to, so the local resolver always succeeded and the fallback never fired.
    The same shape hid the `nc` defect in `activeRoot.test.ts`. **To exercise a cross-player path
    the target must be generated on a DIFFERENT essid** — a public address alone does not make a
    box foreign.
  - **The ftp served tree is deliberately UNTAGGED, unlike the shell's.** Tagging it with its
    machine id produced a mutant nothing could kill: one ftp session is held at a time and
    entering one clears the tree, so a mismatched tag is unreachable. What replaced it is a test
    of the race the tag was imagined to cover — a slow answer about the foreign box, landing after
    the player opened a door on their own LAN — which fails loudly without the session-id guard.
    Structure nobody can observe has no test that can fail; the guard that does the work does.

  **What it says about coverage:** the wire-check added alongside proves the server half no unit
  test can see — an `ftp` row alone authorizes `resolveCrossPlayerFs`, and the tree comes back
  pruned to the tier the credential bought, not the box owner's (`testFtpCrossPlayer` 18/18).
- **CLOSED (D5 close-out) — `testScpTransfer` check 8 asserted behavior a PR had removed the
  same day, and the sweep read 44/45 for two doors before anyone looked.** The check expected 200
  for "a plain ssh login into the same box keeps its documented exemption"; #410 removed that
  exemption so every login gate asks the same question, and a box running no sshd now answers 404
  `service_not_running`. The script was written in #403 and #410 landed the same day, so it was
  never green after its own merge. Production was right throughout — `testDaemonGates` check 1
  asserts the shipped behavior and passes. **The lesson is the race, not the assertion:** a
  wire-check written against behavior that is itself in flight has to be re-run after the PR it
  raced, because nothing else will notice. The script's header comment carried the same stale
  claim and moved with it — a comment that states a rule is part of the rule.
- **`nmap` runs a 5-digit port into the STATE column.** `31337/tcpopen  unknown` — the PORT
  column pads for four digits. Cosmetic, but every port in the generated backdoor pool
  (`BACKDOOR_PORTS`) is 4-5 digits, so it shows up routinely now.
- **An own-LAN `nmap` replays no journals, so it cannot see a planted door — nor a CLOSED
  one.** The client
  resolves an own-LAN scan from seeded trees — the `.1` AP gateway from `buildApGatewayBaseFs`,
  every NPC sibling from `buildRemoteHostFs` — while a scan of a PUBLIC IP is server-resolved
  and replays the target's journal. So a listener planted on the AP gateway is visible to
  anyone scanning the public IP and invisible to every occupant scanning the LAN it sits on.
  It cuts both ways and is worse for the defender: the tool built to give signals gives none,
  though standing on the box (`ssh` then `ps`) still shows it, because that tree is
  materialized. NPC root is crackable at 12%, so this is reachable gameplay rather than a
  corner. **Second way it bites, found 2026-08-22:** a `systemctl stop` is a journal row too, so
  once a generated box carries the daemon behind its doors (v0.168.0), a defender who shuts port
  80 on a box they rooted still sees it open from their own `nmap`. That is the tool lying about
  the player's OWN action rather than about somebody else's, and there is no local workaround —
  a generated box carries no `nmap` (`LOCALHOST_PREINSTALLED_TOOLS` is the aircrack-ng trio, plus
  `systemctl`), so the confirming scan can only come from a box that replays nothing. The port
  really is shut: `readOpenPorts` — the reader the display and the server's scan action share —
  reports it gone, which is what `generatedBoxDoors.test.ts` pins. **The fix has to be server-side** — `listPatches` is gated on an active session, so
  the client cannot read a machine's journal it has no session on. `nmap` already routes an
  INNER gateway's single-IP scan server-side for exactly this reason, and the line after it
  records the carve-out that leaves the edge `.1` and the siblings behind; the work is
  finishing that, as a `resolveSameLanScan` action mirroring `resolveInnerGatewayScan`. Open
  design call first: route single-IP scans only (matching the precedent) or batch a range, since
  a `/24` would otherwise resolve up to 253 journals. Found by writing D5's Act 14; it predates
  D5, which only made it observable. Needs its own slice + wire-check. **Third way it bites, found
  during D8's e2e 2026-08-31:** an `snmpset` deny or forward on the AP gateway is a journal row too,
  so a stranger who filters or re-opens a port over SNMP changes what the PUBLIC scan of that
  gateway shows while a same-LAN `nmap` of `.1` — reading `buildApGatewayBaseFs`, journal-blind —
  still shows the seeded ports. D8 boundary 2 could therefore only close the filter-honours-scan
  claim at the CONTRACT level (`scanResult` reads the filter both vantages); the same-LAN gap is
  wider than the filter and belongs to `resolveSameLanScan` above, not to D8.
- **`snmpwalk` of your OWN address has no client-side own-box path.** `snmpwalk.ts` calls the server
  unconditionally, and the server answers a walk for the box a player is NOT standing on — so
  walking your own agent times out (`No Response`) even while it runs and a STRANGER's walk of the
  same box answers. Every other own-box door (`ps`, `cat`, `rediscli 127.0.0.1`) reads locally; the
  walk is the one that does not, so a player cannot read their own device over SNMP. Surfaced at D8
  boundary 1, re-confirmed live 2026-08-31; a fix is an own-box branch in `snmpwalk`, deferred.
- **A wire-check sweep should read 585/585 across 57 scripts; `testFtpSession` spent from #394
  to v0.183.0 red at 12/14 for a FIXTURE reason.** It picked its target because the host serves
  **ftp** (`kind === 'machine' && serves(ftp)` → `speaker-26` on `VSFTPD-LAB`, `ftp:2121`), then
  asserted a plain **ssh** `authCreateSession` against that same host — which runs no sshd, so
  the login was refused, no session row was written, and the two `kind`-default checks read an
  absent row. Fixed 2026-08-26 by giving the ssh half its own host and credential; the guard now
  names a TRIO so a future ESSID missing any of the three exits 2 loudly. **What it had been
  hiding is the lesson:** once those checks actually ran they reported `kind=ssh` and
  `end_reason=user_exit` — production had been correct the whole time, so a red fixture had
  concealed a PASSING behaviour that nothing else covered. A wire-check that selects its own
  fixture must select one per CLAIM, not one per script; sharing a host across two claims silently
  couples them.
- **Wire-checks are not in CI** — all 43 run only by hand against a local `vercel dev` +
  supabase, and they are the ONLY thing that proves `api/` runtime correctness (`tsc` cannot
  see DB columns or constraints). A regression there ships green. Raised repeatedly and
  deliberately not taken on yet; it needs a CI supabase + a way to boot the functions
  headlessly, which is a piece of work in its own right rather than a config tweak.
- **Four tools cannot pivot: `ssh`, `nmap`, `curl`, `lynx`.** They carry no `caller_machine_id`,
  so a trace they leave names the actor's HOME even when the attack came from a box they only hold
  a session on. `hydra` and `gobuster` do carry one and trace truthfully, so **one shell on a rooted
  box currently produces traces with two different origins** — which is the reason to close it: a
  defender's log is the attacker's whole visible cost, and a false address in it is worse than a
  refusal (the rule D2.4 locked). Server side is ready — `resolveVantageSourceIp` takes
  `{actorKey, standingEssid}` and the authorization that yields the session is the same
  `authorizeMachineAccess` the other two already call. The work is the client half plus one
  decision: **`curl` needs no session at all today**, so giving it a caller machine changes a
  contract deliberately left open (the credential-free door). Detail at §1's cross-player trace
  entry and in D1d's as-built; named as open in `plans/legacy-parity-epic.md`.

- **`scp` moves one file, one hop, one direction at a time.** Named and deferred at D3b's
  close-out (2026-08-16): **remote-to-remote** (`scp root@A:/f root@B:/g` — two transient
  sessions in one command, and genuinely interesting given how silent the door is), **`-r`**
  and directory transfer, and **preserve-times**, which can never have its real name because
  `-p` is the port (a deliberate decision, not an oversight). The **`-P` alias was resolved
  rather than deferred**: not shipped, because an alias nobody can observe in-game has no test
  that can fail — it stays free to add the day something can see it.

- **The terminal cannot rewrite a line, so no tool can draw a live meter.** Real `scp` prints ONE
  progress line per file and overwrites it with `\r` about once a second — filename, percent,
  bytes so far, rate, and ETA that becomes elapsed at the end. Ours announces
  `Connecting to <host>...` and then prints a single completion line, because append-only output
  is all the terminal has. Two separable pieces of work, noticed while running Act 12
  (owner call 2026-08-16: not now):
  - **Cheap and honest:** make the completion line carry the two columns real scp ends with —
    `passwords.txt   100%  285     0.3KB/s   00:00` — timing the round-trip the command already
    awaits, so the rate is measured rather than invented. One change to `landed()` in `scp.ts`.
  - **The real fix:** `\r` semantics in the terminal, which would also give `hydra`, `aircrack-ng`
    and `nmap` honest meters instead of their current paced line dumps. A feature in its own
    right, not a transfer-slice detail. Do NOT approximate it with stepped 25/50/75% lines —
    that appends where the real tool overwrites, and reads *less* like scp, not more.

- **`api/patches.ts` holds four hand-copied `readLog` closures.** Every log appender needs the
  same "one writer's row at one path on one machine" read, and each `if (action === …)` block
  declares its own. A fifth was NOT added for `recordFtpDownload` — it uses a shared
  `readMachineLog` beside `upsertPatch`/`findActiveSession` — but the other four are still
  inline. Folding them on is mechanical and behaviour-preserving; it is left for a slice that
  is already touching those blocks, because `api/` has no unit tests and only a wire-check run
  can prove the fold (and only two of the four have one).
- **An `http` sweep is written up as `sshd`.** `hydra <host> http` is a supported attack —
  `hydraCrackPublic.test.ts` deliberately covers reaching the web service through a forward — but
  the web door has no login, so the trace it leaves is `Failed password for <user> from <ip>` in
  the target's `auth.log`, tagged `sshd`, for a daemon nobody knocked on. D3.1 routed the sweep
  trace **by service** (`SERVICE_CATALOG.<svc>.sweepLog`) and gave `ftp` its own file, but left
  `http` pointing at `auth.log` **byte-for-byte as it was** — the row says so in a comment. It is
  recorded here rather than fixed there because the right destination is `access.log` as a run of
  401s, and that is the web door's decision, not the ftp door's. Fixing it is now one row.

- **CLOSED (v0.143.0) — `ps` on a box you have ENTERED showed nothing. It was a producer
  disagreement, and the first diagnosis recorded here was wrong.** Found 2026-08-16 by the D4 Act
  13 browser run: a guest standing on another player's box ran `ps` and got the header and no
  rows, while that box was running the sshd they had just logged in through.

  The entry originally blamed the read filter and proposed projecting `/var/run` to a foreign
  session regardless of tier — a change to the recon/defence balance. **That was a misdiagnosis,
  and the fix it proposed would have been a hole punched in the filter to route around a bug
  elsewhere.** The filter was correct: it was pruning a file the box genuinely called root-only.
  The three world generators each stamped their pidfiles world-readable, while `bringUp` in
  `daemon.ts` passed no `permissions` at all and took the write's fall-back — the CALLER's tier
  defaults, and a daemon is root-only, so `read: ['root']`. A pidfile the world planted was
  visible to a visitor and one the owner started was not. Same file, same directory, two answers,
  depending only on who put it there.

  Fixed by making the shape explicit and shared: `PIDFILE_PERMISSIONS` is exported from
  `services/pidfile.ts` — the module that already owns the pidfile's FORMAT — and all four
  producers resolve it. It had existed as three private copies (`routerFs.ts`,
  `generateDeepLayer.ts`, and as `PIDFILE_PERMS` in `remoteHostFs.ts`); adding a fourth at the
  call site would have fixed the symptom and left the cause.

  **What generalises past this bug:** a write that names no permissions is not neutral — it
  inherits the writer's tier, so a root-only command silently produces root-only files. That is
  right for a file root authored and wrong for a file that describes the machine to everyone who
  can reach it. And `env.fs.root()` still means two things — the raw tree on your own box, and an
  already-pruned tree across a hop — so a unit test that builds a tree by hand cannot see this
  class of defect at all. `ps.test.ts` now walks the real projection (the write `sshd` makes → the
  patch row → `applyPatches` → `filterTreeForRead` → `ps`), which is the shape any later claim
  about what a visitor sees should copy. Act 13 in `e2e-shared-network-verification.md` is the
  browser-level proof.

- **`AvailabilityRule` is inert — enforce it or delete it.** Every command declares one
  (`{kind:'any-machine'}`, `'localhost-only'`, `'installed-package'`) and **nothing in production
  code reads `command.availability`** — verified 2026-08-10 by grepping `\.availability\b` across
  `src/` excluding tests: no hits. Runtime gating is `availability.ts`, which resolves `/bin/<name>`
  against the live FS and reads the binary's own execute perms — a different mechanism that never
  consults the declared rule. So `localhost-only` on `ssh` is documentation that looks like
  enforcement, which is the dangerous kind: a reader reasonably assumes the rule holds. Decide one
  way. If enforcing, note that `hydra` deliberately runs anywhere ("tools run where you stand") and
  its `any-machine` is load-bearing intent, not a default.

  Re-verified 2026-08-16 while shipping `ps`: still no production read, and the only read anywhere
  is one assertion in `john.test.ts`. It also surfaced independently as a **mutation survivor** —
  blanking `ps`'s `availability` to `{}` changed no observable behavior — which is the cleanest
  evidence of inertness there is, and a reason to expect the same survivor on every command added
  until this is decided.
- **A shared DEEP box's auth.log is written under the ATTACKER's key, so one occupant's lines hide
  another's.** Found 2026-08-11 while grounding D2.4 slice 5. The deep chain is ESSID-seeded and
  shared — `generateHomeLan(essid).hosts` for the entry, `generateDeepLayer(essid, frontingGateway)`
  and `hostMachineId(deep.host, essid)` for the walk — so every occupant of an ESSID reaches the
  same deep boxes. But `authCreateSessionInnerGateway.ts:358` writes its deep-reach line with
  `writerKey: publicKey`. Since `materializeMachineFs` folds so the latest write to each path wins,
  and `appendMachineLog` appends to the writer's OWN row, occupant B's line **replaces** occupant
  A's in the materialized view. This is precisely the collision the credential layer already
  solved on the public path, where `resolvePublicTarget` returns a box-owned `logWriterKey` (the
  reached occupant's key, or the AP's stable key when the box is ownerless) so every attacker's
  lines accrete into ONE row. **Affects THREE paths**, all writing `writerKey: publicKey` onto
  ESSID-shared deep boxes: the deep ssh reach (`authCreateSessionInnerGateway`), the deep sweep
  (`hydraCrackInnerGateway`), and the deep scan's `kern.log` (`nmapScanDeep`). D2.4 slice 5
  deliberately made hydra match the other two rather than diverge — hydra and `ssh` disagreeing
  about one box is the worse failure. A deep NPC is ownerless, so the fix is the
  `apGatewayLogWriterKey` shape: a stable key derived from the box, applied to all three writes in
  one slice, with a test proving two occupants' lines coexist. The stale "private, per-viewer"
  docstrings that hid this were corrected across the codebase at D2.4 close-out.
- **D2.6b — harvestable plaintext loot, the missing input to wordlist growth. POSTPONED by owner
  decision 2026-08-12**, in favour of parity breadth; the harvest route can arrive with the CVE
  phase (decision 6 names `password_reset`) rather than as bespoke loot content. Hidden credentials
  are still wanted later, as content. The gap itself is unchanged and still open: the progression
  the credential layer was built around does not close, because appending a word works (#377) but
  nothing in the generated world hands a player a word they could not already crack (full reasoning
  in §1's D2 block). What it needs is a file on a reachable box holding a **plaintext** drawn from
  the UNCRACKABLE pool — a `credentials.txt`, a config with `password=`, a note. Two constraints,
  both already load-bearing: it must be **uncrackable-pool** or the harvest is a no-op, which is what
  makes `defaultWordlist.test.ts`'s "covers the uncrackable pool NOT AT ALL" the assertion that
  gives the loot its value; and it must sit behind a **tier gate** or a guest walk-in reads it, the
  same reason `/etc/passwd` is `read: ['root','user']`. This also makes `john` genuinely
  non-redundant, by the route D2.5's grounding named second — a plaintext file, not a hash file,
  since a hash file would still hold a hash of one of the two pools.
  **Whatever closes this, `/etc/passwd` does not**: it yields an md5, and `john` against that hash
  only returns words already in the caller's wordlist — the closed loop itself, not a way out of it.
  So the CVE phase must ship a route producing a plaintext the player did not hold, or the
  progression stays inert however many doors parity adds. The three loot designs worked out before
  the postponement are recorded in the parity epic's "Next action" so the option set survives.
- **Generated world content ("random noise") — its own epic, owner decision 2026-08-12.** The
  generated world is furnished thinly on purpose so far, and making boxes feel inhabited is ONE
  design with one shape rather than a tax on each door: believable per-box files, web trees beyond
  the single `index.html` both generators stamp, and — as those doors land — MySQL schemas and
  Redis keyspaces worth reading. The rule that follows: **a door slice does not invent its own
  content system to have something to point at.** D1c is the worked example — sweeping for unlinked
  paths obviously wants generated unlinked paths, and building a narrow version there would have set
  the pool shape, the per-box volume, and the variation model this epic should own. `gobuster` ships
  proven against content the PLAYER makes by hand (`mkdir` + `nano` under `/var/www/html`) instead.
  Three things are already waiting for this epic:
  - **~~A shipped D1 defect: the pages advertise paths that 404.~~ Fixed 2026-08-13 by removing the
    advertisements, not by adding the pages.** Every entry in `generation/pools/webPages.ts` linked
    `/admin/`, `/status`, `/server-status`, `/.well-known/security.txt`, `/api/health` or
    `/metrics` and `curl` 404'd on all six, so a player doing the recon the page invited was told
    the server lies. Found 2026-08-12 planning D1c; forced 2026-08-13 by D1b, because a text
    browser renders links numbered and following one is the whole point, which turns a footnote
    into the headline interaction. Serving the promised pages was the tempting fix and is exactly
    what this epic owns, so the links went instead. **What is still owed here:** generated hosts
    now serve one page with no links at all, so a browser has nothing to follow on an NPC box and
    link-following is proven against pages the player writes. When this epic gives a host pages
    that link each other, the markup comes back — and a property test in `remoteHostFs.test.ts`
    (no page links a path its host does not serve) is what keeps content and links honest.
  - **D2.6b's harvestable loot placement** — postponed as a credential-layer item above, and it is
    content too: a file on a reachable box holding an uncrackable-pool plaintext behind a tier gate.
    If this epic runs before the CVE phase, it is the natural home.
  - **~~Role-keyed pools at D5b.~~ Landed 2026-08-19 (v0.153.0-v0.157.0).** A generated box now
    keeps an `/etc` config, serves a page and carries an account that all fit what it is. What is
    still owed here is the VOLUME, not the keying: one page per box and one config per box, where an
    inhabited box would have several. Two roles were also deliberately left on the general page
    bucket — `database` and `fileserver`, 15% of served pages between them, on the reading that
    slice 3's `/etc` config already speaks for both. Widening either is a content decision, and this
    epic is where it belongs.
  Until it lands, expect thin worlds behind working tools — the accepted trade, and NOT the same
  failure as a mechanic with no input (D2.6b): here the tool is correct and the world is empty.
- **Three things D1b left behind** (plan closed 2026-08-14 at v0.129.0, Act 9 green; the plan file
  was deleted on close-out and these are the only parts that outlived it):
  - **The renderer has no tables and no preformatted blocks.** Deliberate: no page in
    `webPages.ts` has either, and the legacy renderer's table code was the bulk of its 401 lines.
    Add them when content does, not before — and note the renderer takes no width parameter
    (CSS wraps), so nothing here needs wrapping arithmetic.
  - **`followLink` has two untested branches** — the offline guard (4 no-coverage mutants) and the
    "a different overlay is open" guard. Both predate slice 7 and neither was named by a criterion,
    so they were left rather than quietly absorbed. Cheap to close: the harness in
    `state.test.ts` already builds a browsing game; an offline variant needs a store without the
    persisted ESSID, and the other needs `nano` open when `followLink` is called.
  - **`resolveOccupants.test.ts:134` is a coin flip, ~1 run in 222.** Two random identities derive
    the same LAN address 90 times in 20000 (0.45%, measured 2026-08-13), and the guard asserts they
    differ. Pre-existing and unrelated to D1b — it surfaced during a slice-5 full-suite run. Worth
    its own small PR: seed the two identities apart rather than trusting the roll.
- **Nine known surviving mutants in generated config content, never owned.** Exposed by D2.2's
  honest mutation run (once a raised timeout stopped scoring timeouts as kills) in code that slice
  never touched: the `RULES_V4_SEED` / `ACL_CONF_SEED` header lines and their `join('\n')`
  separator, plus `buildDeepSwitchBaseFs`'s config subtree mutating to `{}`. The tests assert those
  files *parse*, so blanking a header a player reads with `cat`, or building a deep switch with no
  `acl.conf`, goes unnoticed. Not blocking anything; small, well understood, and worth a short PR.
- **124 plan tags are still embedded in code comments, and the rule against them is always-apply.**
  Counted 2026-08-11: `Story N` / `Slice N` / `5b.Na` / `D2.N` appears 124 times across 64 files
  (40 production, 24 test), including **9 inside `describe`/`it` titles**, which §2 forbids by name.
  All of it predates the rule. It is exactly the rot the rule exists to prevent: plan files are
  **deleted on close-out**, so every one of these points at something a reader cannot open —
  `ssh.ts:304` explains its dispatch by citing "5b.1a"; `bindFlags.ts:10` narrates four slices of
  its own history instead of stating what the flag parser does; `nmapScan.test.ts:392` names a
  Story in a `describe` title, so the suite prints a dangling reference on every run.
  **Not a mechanical find-and-replace.** Deleting the tag alone often deletes the only explanation
  the comment carried — the fix is to say the WHY the tag was standing in for, which needs the code
  read one site at a time. Sized like several sittings, not one; it conserves behaviour entirely
  (comments and test titles only), so it is a clean `refactoring` candidate with the existing suite
  as its whole preservation evidence. Best done per-file when a slice is already in that file,
  rather than as one enormous unreviewable diff.
- ~~**A NAT forward reaches only ONE occupant of a shared AP**~~ — **FIXED at v0.99.0.** The
  public paths no longer resolve "the box behind the NAT" at all: a forward's `internalIp` is
  matched against the ESSID's `network_lan_leases` + `home_network_occupants`, so it lands on
  whoever actually leases that address. Every occupant is forward-reachable, two forwards on one
  gateway reach two different boxes with two different credentials, and each is gated on its own
  target's liveness. As-built in `cross-player-architecture.md` §3; wire-check
  `scripts/testSharedApForwards.ts`.
- ~~**Saving a shared file deletes another occupant's edits**~~ — **FIXED at v0.101.0 (server
  refusal) + v0.102.0 (the y/n confirm).** An editor save carries a sha256 of the content it was
  SHOWN; the server compares it against the row a reader materializes and answers `409
  modified_since_open`, and nano asks GNU nano's own question rather than reporting an error.
  Last-writer-wins is preserved on purpose — a deliberate clobber is one keystroke, a blind one
  is impossible. An absent fingerprint means an unconditional write, so `>`, `touch`, `apt` and
  the sshd pidfile are exempt by construction. As-built in §1; repro, the fix and the three-player
  re-verification in `e2e-shared-network-verification.md` §6.
- **A shared-file view is still stale, deliberately.** The fix above stops the *destruction*, not
  the staleness: a session on a foreign machine still never learns of a foreign write, because
  the `patches-changed` channel remains workstation-scoped. So refusals are ROUTINE, not rare —
  a co-edited gateway will ask most times. Two cheaper-looking fixes were considered and left:
  a refetch when an editor OPENS a foreign file (narrow — does not help a concurrent save), and
  a machine-scoped invalidation channel — **now decided against, see below.**
- **DECIDED 2026-07-31: no Supabase Realtime. The staleness is accepted; a fresher READ is the
  approved direction if we ever fix it.** Three reasons, in order of weight:
  1. **Legacy shipped this and it leaked.** Broadcasting patch changes let a player read, from
     the browser's Network tab, what other players were changing on machines they were not on
     and had no permission to see. Legacy's fix was to send the broadcast back EMPTY for an
     unauthorized subscriber — which is the tell: the push had already degraded into a bare
     hint, and the hint still needed authorizing.
  2. **There is no identity for RLS to key on.** Realtime's `postgres_changes` evaluates RLS for
     the *subscribing* identity, but a player here is an Ed25519 keypair the API layer verifies
     per request — not a Supabase auth user. Every browser would subscribe as the same anon
     role, so no policy can express "only occupants of this ESSID". That is a mismatch between
     two identity systems, not a config gap. The bridgeable form is Realtime **Broadcast** on
     per-machine topics with API-issued subscription tokens — buildable, but a subsystem with
     its own auth surface.
  3. **It would be the first direct client↔DB channel.** `@supabase/supabase-js` is imported
     ONLY in `api/*` under `service_role`; the browser holds no database connection at all and
     every read is a signed request the server authorizes. That invariant is cheap to keep and
     expensive to restore. Even a data-free hint leaks the existence of a change on a box you
     cannot see.
- **The staleness is worse for LOGS than the entry above implies, and D1 made that plain.** The
  co-edit case is a genuine race and rare. A defender's log is not a race: **every** cross-player
  trace is invisible until the defender happens to do something that triggers a refetch, because
  the server writes it on their behalf and nothing tells them. That is `/var/log/kern.log`
  (someone scanned you), `auth.log` (someone tried to log in) and now `access.log` (someone
  fetched or probed your page) — all three, 100% of the time. Verified live 2026-07-31: a player
  was fetched and traversal-probed from another network four times and her terminal showed
  nothing until she ran an unrelated command. Nothing is lost — the rows are correct in the
  journal — so this is read freshness, not data.
  **If we fix it, the approved shape is a PULL, not a push:** refetch the journal before reading
  a file the server may have written behind your back (the three paths already exist as
  `ACCESS_LOG_PATH` / `AUTH_LOG_PATH` / `KERN_LOG_PATH`, and `refetchPatches` is already written
  and already called on every write). That needs **no new authorization model** — it is the
  existing signed `listPatches` for your OWN machine — and costs one round trip on
  `cat /var/log/*`. Do not re-open Realtime for this.
  **Re-confirmed 2026-08-14 at v0.130.0, and it now covers a fourth writer**: D1d's live run left
  a 3201-character `access.log` row on the swept box while the owner's `cat` printed nothing, until
  an unrelated command that wrote locally brought the whole file in at once. The control matters —
  a `curl` through the same forward was equally invisible, so this is the shipped shape of every
  cross-player writer and NOT a property of the sweep. It is the single most repeated
  false-alarm in this project's E2E runs: **when a log reads empty, check the row before believing
  it**, `docker exec supabase_db_jshack-me-v2 psql -U postgres -tAc "select content from patches
  where path='/var/log/access.log' and machine_id='<box>'"`, and resolve `<box>` from
  `home_network_occupants` rather than by hostname — a previous session's `skylab-…` answers with
  months-old lines and no error. Journey detail: `e2e-shared-network-verification.md` Act 10.
  **Re-confirmed 2026-08-31 at v0.193.0 (D8 close-out), and `snmpd.log` is the fifth writer**: in a
  two-browser-session run, A walked B's workstation agent, B's live `cat /var/log/snmpd.log` printed
  `No such file or directory`, and the row was already correct in the journal (right `machine_id`,
  B's own `writer_key`, `/var/log` present) — a browser reload alone brought the trace in. It is the
  same shape as the four writers above and NOT a defender-audit gap or a D8 bug: the trace is
  recorded and owner-readable, only not pushed to an already-open session. This nearly cost a wrong
  "workstation walks aren't logged" fix; the row check is what caught it.
- **`echo x > rules.v4` is still an unguarded wipe vector.** A redirect carries no base
  fingerprint by design — it truncates by definition, and the player was never shown the
  content — so it overwrites a co-occupant's rules with no question asked. Deliberate by nature
  and arguably correct (that is what `>` means), but it is the one remaining way to destroy
  another occupant's edit without being told. Left open rather than fixed, because guarding it
  would mean `>` no longer means truncate.
- **Two journal fetches for the SAME machine can still land out of order.** Fixed at v0.98.0:
  `refetchPatches` drops a late answer for a machine the player has LEFT, so a hop no longer
  paints the box you came from over the box you are on. What the machine-scoped guard does not
  cover is two in-flight fetches for one machine — a cross-tab `patches-changed` hint racing a
  write's own reconciliation — where the older answer landing last leaves `patches()` one write
  behind until the next refetch. Own-box only (the sync channel is workstation-scoped) and
  self-healing, so it was left. The obvious fix — a monotonic "newest issued fetch wins"
  counter — is NOT a drop-in: it would also discard the reconciliation `wrapWithRefetch`
  awaits, breaking the documented promise that a command's write is visible to the next line it
  runs. Any fix has to keep that one.
- **OPEN DESIGN QUESTION: an established session is never re-validated against its route.**
  Reachability is decided once, at connect time; from then on `authorizeMachineAccess` only
  asks "does this player hold an active session on this machine?", never "does the path still
  exist?". The gateway's `canBoot` gate is consulted by scans but not by live sessions.
  Observed 2026-07-28 in the browser E2E: an OUTSIDER (joined to a different ESSID) entered an
  occupant's box through the AP's NAT forward, and an occupant then bricked that AP gateway.
  The outsider kept the shell, ran commands, watched the public IP go dark from the inside, and
  the session row closed with `end_reason = user_exit` — the brick never touched it. Same shape
  as `nmcli disconnect`, which removes occupancy (new reach fails) without tearing down a
  session already open on the departing box: topology changes govern NEW connections only.
  **This is a design decision, not merely a defect** — "you are already inside, the door closing
  behind you doesn't eject you" is defensible. But it costs the defender their most natural
  panic move: bricking your own router when you notice an intruder currently does nothing to
  them, and hands them a foothold nobody outside can scan or reach. If it is taken, the data
  needed is already persisted: `sessions.source_ip` outside the target's `/24` identifies a
  session that arrived through the NAT, and `parent_session_id` gives the hop chain for the
  deep-chain case. Three shapes: leave it; evict off-LAN-sourced sessions when the tombstone
  lands; or re-validate lazily on the next authorized action (preferred — server-authoritative,
  no fan-out or background job, and it matches how the public scan already asks `canBoot` at
  scan time rather than precomputing darkness). Decide the behaviour before writing RED.
- **Pivot / operate-from-a-hop** beyond what 5b shipped; ssh-from-a-pivot.
- **Replay/nonce store** — built then REVERTED (ship-first): narrow value in this threat
  model (TLS wire + player holds the key → just re-signs with a fresh nonce; only blocks
  byte-identical resubmit; idempotency + per-request authz carry the real guarantee). Keep
  `noopNonceStore` everywhere; revisit at multiplayer-hardening (design preserved in the
  epic).
- **Is the hand-rolled tree walk's mutation noise a house-wide cost or a local one?** Six
  modules reach a known path by walking `entries.get()` a directory at a time, each guarding
  every level with `x === undefined || x.kind !== 'directory'`: `sessions/passwdAccount.ts`,
  `services/pidfile.ts`, `commands/ssh.ts`, `network/iptablesRules.ts`, `network/switchAcl.ts`
  and `mysql/datadir.ts`. On the last of those the guards produce **13 surviving mutants of 46**
  — every one on the four guard lines, twelve needing a system directory to be a FILE or absent
  (states the generator never draws and no patch creates) and one provably equivalent, since a
  directory where `data.json` should be yields `undefined` content that `parseMysqlDatabase`
  already answers `null` for. Accepted there as §4's type-narrowing class.
  **The assumption worth checking is that the other five behave the same.** It was reasoned, not
  measured. If they do, that is a repo-wide floor on the mutation score of every path reader and
  an argument for one shared `directoryAt(fs, segments)` that concentrates the guards in a single
  place; if they do NOT, then `datadir.ts` is doing something the others are not, and the reasoning
  that waved its survivors through is wrong. Cheap to settle — scope Stryker to those five files
  and read the survivor lines. Do it before citing "type-narrowing, accept it" for a third module,
  and note that a shared walker is exactly the kind of abstraction worth proposing collapsed:
  six call sites is the evidence, not the guard count.

**Game-design / content ideas** (same game; may carry to v2):

- **Library-CVE privilege escalation** — `/lib/*.so` libs as a privesc vector (library CVE
  → `msfconsole --local` → root). Build the binary/availability/library model so
  versions/CVEs bolt on without rework.
- **Player-driven service patching (defender role)** — root-tier `apt upgrade` mutates
  `Port.serviceVersion` → a CVE goes inert game-wide; a blue-team mechanic.
- **Wordlist progression** — hydra as progression: a weak default wordlist, harvest
  passwords to expand coverage.
- **Themed persistent networks** — `world_networks` infra + a findit.io directory;
  office/police/university/café as drop-in additions; handler+generator registries dispatch
  on `theme`. CVE-eligible themed ports need `Port.owner` stamped; pages must be well-formed
  HTML; CVE pickers constrain INITIAL state only (not post-`apt upgrade`).
- **Player-hosted websites** — apache2/nginx daemons shipped (legacy); remaining: mutable
  router NAT, findit.io registration/crawl.
- **Workstation daemon expansion** — when mysqld/redis land on workstations, extending
  cross-player hydra is ~10 LOC.
- **Multi-target NAT forwarding** — distribute public-port forwards across multiple
  outer-layer machines.
- **Mission template vs instance model** — catalog templates + per-acceptance instances;
  public IP is the instance key; instances permanent + shareable.

**Realism notes** — same-LAN scans log the LAN IP, cross-network log the public IP (the
same-LAN-IP leak is load-bearing for defender gameplay). `nmap <router.1>` from inside the
LAN shows a merged view real PREROUTING wouldn't — a known realism gap.
