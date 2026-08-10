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

**Current version: 0.111.0.**

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

- **D2 (the credential layer) 🔨 IN PROGRESS — D2.1 ✅ (v0.111.0), D2.2 ✅ (v0.113.0), D2.3 ✅
  (v0.114.0), D2.5 ✅ (v0.115.0), both follow-ups ✅ (v0.116.0, v0.118.0), and **D2.4 slices 1-4 ✅**
  (v0.119.0, v0.120.0, v0.121.0). D2.4 slice 5 and D2.6 (wordlist growth) remain.** Split into six
  candidates in `plans/d2-credential-layer.md` — **read its top block for live status**; every
  shipped slice's own plan file is deleted and its as-built lives there (D2.4's plan is still live —
  `plans/d2-4-cross-player-hydra.md`). PRs #351, #352, #354, #356, #357, #358, #359, #362, #370,
  #371, #372, #373, #374, #375.

  **Next up: D2.4 slice 5**, the deep chain behind an inner gateway — the last slice in D2.4. Settled
  2026-08-10 in favour of its own PR, because the deep layer is furnished and sealed: every deep host
  force-runs sshd and carries a `guest` drawn at `CRACK_CHANCE.guest = 1`, yet deep IPs are absent
  from `generateHomeLan().hosts`, so the only entrance is `ssh -p <fwd> <inner gateway>` and the
  gateway holds forwards, not credentials. There is no way in game to obtain a deep host's password.
  Its vantage criterion is already satisfied and proven by slice 4, so what remains is the target
  resolution: reuse `authCreateSessionInnerGateway`'s chain walk rather than growing a second one.

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
  - **`ssh` and `nmap` do NOT pivot yet** (as of v0.121.0). Neither `authCreateSessionPublic` nor
    `resolvePublicScan` carries a `caller_machine_id`, so they cannot derive a vantage even in
    principle and still trace to the actor's home. One shell on a rooted box therefore produces a
    hydra trace pointing at the pivot and an `ssh` trace pointing at the attacker. `resolveVantageSourceIp`
    is already shaped for the fix; the client half (`ssh.ts`/`nmap.ts` naming the box they run from,
    as `hydra.ts` does) is the real work.
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
    makes "grow your wordlist" (D2.6) free rather than a rewrite.
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
    Carrying a *grown* wordlist across still waits on `scp` (D3).
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

---

## 4. Mutation testing conventions

Provably-equivalent mutant classes — accept (don't chase) when they recur:

- **Type-narrowing defensive checks** — e.g. `raw === true` against a `string | true |
  undefined` Map value is unkillable.
- **Stryker static load-throw** — a mutant that throws at module load (`Map([undefined])`)
  makes the Vitest runner report "no tests ran" → Stryker counts SURVIVED. Verify the throw
  by hand, then accept as tooling-equivalent.
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

**Known-equivalent inventory, so a re-run is not a mystery:** `hydraCrack.ts` scores 166/169 with
exactly the three above. `hydra.ts` scores ~63/97 because ~30 mutants are the declarative
`manual`/metadata block — the same shape `john.ts` established. Both are expected, not regressions.

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

---

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
  `STATUS_DLL_INIT_FAILED`). Both clear up on their own — re-check before believing either.
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
- Run: `npx dotenv -e .env.development.local -- npx tsx scripts/<name>.ts` (from `v2/`).
  Exits 0 on all-pass.
- The script seeds the DB via the service-role client, drives the endpoints, asserts, and
  cleans up. Examples: `testDeepChainReach.ts`, `testDeepSwitchChain.ts`,
  `testSameLanConnect.ts`, `testRouterBrick.ts`, `testHttpFetch.ts`.

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

**Story-5b / multiplayer deferred** (detail in `plans/multiplayer-crossplayer-epic.md`
§"Remaining work"):

- **Story-7 reconciliation** — DONE except WiFi density and presence/TTL, which stay deferred.
  Shipped v0.88.0 → v0.96.0: unique per-ESSID public-IP allocation, collision-free LAN leases,
  one shared AP gateway per ESSID, ESSID-seeded shared NPCs and deep chains, and the removal of
  the store whose last-writer-wins PK caused the collisions. As-built in §7 and
  `cross-player-architecture.md`; the plan file was deleted on close-out.
- **Wire-checks are not in CI** — all 32 run only by hand against a local `vercel dev` +
  supabase, and they are the ONLY thing that proves `api/` runtime correctness (`tsc` cannot
  see DB columns or constraints). A regression there ships green. Raised repeatedly and
  deliberately not taken on yet; it needs a CI supabase + a way to boot the functions
  headlessly, which is a piece of work in its own right rather than a config tweak.
- **`AvailabilityRule` is inert — enforce it or delete it.** Every command declares one
  (`{kind:'any-machine'}`, `'localhost-only'`, `'installed-package'`) and **nothing in production
  code reads `command.availability`** — verified 2026-08-10 by grepping `\.availability\b` across
  `src/` excluding tests: no hits. Runtime gating is `availability.ts`, which resolves `/bin/<name>`
  against the live FS and reads the binary's own execute perms — a different mechanism that never
  consults the declared rule. So `localhost-only` on `ssh` is documentation that looks like
  enforcement, which is the dangerous kind: a reader reasonably assumes the rule holds. Decide one
  way. If enforcing, note that `hydra` deliberately runs anywhere ("tools run where you stand") and
  its `any-machine` is load-bearing intent, not a default.
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
