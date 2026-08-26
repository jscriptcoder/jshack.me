# 5. Shared World & Cross-Player

The Solid.js rewrite will inherit the full cross-player multiplayer model without significant structural change — home networks, world networks, themed networks, and foreign-network seeding all operate above the filesystem/UI layers that Solid replaces. This section documents the invariants, patterns, and data structures that must port faithfully.

## 5.1 Public IP universe

Every network is anchored by a unique `public_ip` in the `public_ips` table, with a `kind` discriminant:

- `mission_instance` — player current mission instance, allocated on mission start, deallocated on mission end
- `home_network` — shared LAN occupant by multiple players (cracked WiFi), allocated on first join, persists for game
- `world_network` — themed persistent world content (playground, findit.io, techparts.io), seeded in migrations
- `pivot`, `npc_faction`, `darknet_hub` — reserved for future expansion (currently out of scope)

The allocator (`src/ipRegistry/allocate.ts`) rolls random IPs via a seeded PRNG until finding one not in the table; reserved ranges (`203.0.113.0/24`, `192.0.2.0/24`, `198.51.100.0/24`) guarantee no real-world collision. The rewrite generation pipeline stays the same.

## 5.2 Home networks (Model B tiered hybrid)

Home networks model cracked-WiFi LANs as shared persistent infrastructure [[project_multiplayer_home_network_model]]. When two players connect to the same ESSID, the server allocates each a unique LAN slot on the same /24 subnet.

### 5.2.1 Join flow

1. Player runs `nmcli connect ESSID PASSWORD` (WiFi password from aircrack-ng)
2. Browser signs and POSTs to `/api/join-home-network` with workstation identity
3. Server handler verifies Ed25519 signature, schema, 10-minute replay window, rate-limits per pubkey (30 req/min)
4. Idempotency check: queries `home_network_occupants` for existing (network_id, player_key) row, returns if found
5. Find-or-create network: searches `home_networks` for (essid_template, density_tier) with free slots, reuses oldest first
6. Allocates new IP if needed: rolls via `allocateIp`, inserts into `public_ips` (kind=home_network)
7. L2 backfill: regenerates base filesystem from seed, bulk-inserts into `machine_filesystems` (best-effort)
8. Slot allocation: random LAN IP in .10-.250 range, excluding reserved NPC octets and occupied octets
9. Inserts `home_network_occupants` row, publishes hint on `occupants:NETWORK_ID` Realtime channel
10. Browser receives response, `HomeNetworksProvider` generates HomeNetwork, subscribes to occupant updates

Idempotency invariant: endpoint safe to call multiple times. Rejoining same WiFi after refresh reads existing row, returns same slot, no new IP allocated.

### 5.2.2 Slot allocation & density tiers

Allocation is random within .10-.250, independent of density tier — tier only controls max_slots:

- `solo` — 1 slot
- `shared` — 3 slots
- `crowded` — 8 slots

Random flat distribution reveals nothing about occupancy or order.

### 5.2.3 Network generation from seed

Every occupant sees same topology because all call `generateHomeNetwork` with same seed (home-PUBLIC_IP). Generator runs deterministically:

- Difficulty: easy (1 layer, 2 machines) / medium (2 layers, 5-7) / hard (3 layers, 8-11)
- Entry variant: ssh, ftp, nc, exploit, http, snmp (randomly per layer)
- Port closures: approx 30% SSH, approx 30% FTP (independent rolls)
- Filesystem: mission-quality with leaked credentials, web artefacts, config files

All occupants materialize same machines with same machine_ids, so cross-player patches:<machine_id> Realtime subscriptions automatically synchronize writes.

### 5.2.4 Hostname suffix & identity-derived addressing

Every player's hostname is: workstationName-XXXXXXXX (8 hex chars of SHA256(ed25519:pubkey))

The suffix is:

- Stable per identity (same player, same suffix on every LAN)
- Always applied (no occupancy signal leakage)
- 8 hex = 32 bits (65k-player birthday-collision threshold)
- Storage key (patches.machine_id, sessions.machine_id, Realtime channel name)

Computed once at game start and threaded through SessionProvider, BootScreen, generateLocalhost.

### 5.2.5 WiFi strength & pool generation

WiFi networks seeded per game (`generateWifiNetworks`):

- 2-3 crackable: WPA2, strong signal (-35 to -65 dBm), tagged with WifiTier (solo/shared/crowded)
- 3-5 noise: WPA3 / weak signal / hidden ESSID with clear diagnostics

## 5.3 World networks (table + dispatch)

`world_networks` rows represent persistent shared networks visible to every player. Schema:

```sql
world_networks (
  public_ip TEXT PRIMARY KEY REFERENCES public_ips(ip),
  seed TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  theme TEXT NOT NULL DEFAULT playground,
  public_domain TEXT,
  search_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

Browser flow: listWorldNetworks → generateWorldNetworks (theme-specific generator) → every player generates same machine_ids from same seed → writes stream via patches:<machine_id> Realtime → useWorldNetworks exposes handlers to NetworkProvider/FileSystemProvider.

## 5.4 Themed networks

Runtime layer mapping `world_networks.theme` to dynamic behavior (request handlers) or static content. Request handlers are pure functions observing curl requests, returning HandlerResponse or null (fall through).

### 5.4.1 Registry pattern

- `handlerRegistry.ts` maps theme string to RequestHandler
- `generators/registry.ts` maps theme to generator function
- `CurlContext.getHandler(filesystemIp)` resolves handler at request time

Pure-function contract: no closures over DB state, read-only fs, return null to fall through, return HandlerResponse to own request, no custom headers.

### 5.4.2 findit.io (search engine)

Single-machine world network at 192.0.2.80 with theme=search-engine

Handler: GET /?q=QUERY only; reads /etc/findit/index.json (snapshotted from peer rows); scores entries (keywords weight 3, title 2, description 1); returns top 10 as HTML.

Generator: router is only machine; ports 80+443; /var/www/html/index.html landing page; /etc/findit/index.json from peer rows; snapshotted at boot.

### 5.4.3 techparts.io (hand-authored CVE)

Single-machine at 198.51.100.80 with theme=techparts

Content: hand-authored manifest (HTML/text), well-formed semantic, no scripts/styles/class/id, all hrefs resolve.

Generator: no handler, every URL falls through; ports 80 (Apache/2.4.49 with shell_full:user CVE) + 443 (nginx); time-gated CVE exploitable 3-14 days in.

Authorization: one player exploits, write lands in shared machine_filesystems, other players see on next curl.

### 5.4.4 playground (smoke surface)

Single world network at 203.0.113.42. Guaranteed to exist, same machines/IPs across all players.

### 5.4.5 Adding a new themed network

1. Author content in `src/themedNetworks/content/THEME/` (TS module, kind discriminator)
2. Write generator in `src/themedNetworks/generators/THEME.ts`, register in registry
3. If dynamic: write handler in `src/themedNetworks/handlers/THEME.ts`, register in handlerRegistry
4. Add migration: INSERT into public_ips + world_networks
5. Test: `npm run db:reset` → `npm run dev`

## 5.5 Occupants (home_network_occupants)

```sql
home_network_occupants (
  network_id TEXT NOT NULL REFERENCES home_networks(public_ip),
  player_key TEXT NOT NULL,
  lan_ip TEXT NOT NULL,
  hostname TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (network_id, player_key),
  UNIQUE (network_id, lan_ip),
  UNIQUE (network_id, hostname)
)
```

PK = idempotency key. UNIQUE constraints: (network_id, lan_ip) prevents reuse; (network_id, hostname) catches 50% birthday collision around 65k players.

Occupant row projection: `listOccupants` deliberately omits player_key (server-side only). Exposing pubkeys to LAN peers lets observers link identity across LANs. Clients filter by hostname instead.

## 5.6 isOnLayer0 predicate

Determines visible machines when SSH'd into gateway — occupants visible only on same broadcast domain.

Returns true: router public IP, router .1 alias, any NPC on layer-0 subnet, inner gateway layer-0-facing IP.

Returns false: inner-layer IPs.

Critical for gameplay: players can nmap each other on home LAN, but deep-layer machines don't leak to border-router occupants.

## 5.7 Cross-LAN routing (seed-regen approach)

When player accesses foreign IP, browser performs client-side seed-regen [[project_cross_lan_seed_regen_approach]]:

1. Curl/gobuster/nmap on foreign IP triggers `useForeignNetworks.ensureForeignReachable(ip)`
2. Validate public IPv4 (reject RFC1918, loopback, CGNAT)
3. Short-circuit if own active home public IP
4. POST signed envelope to `/api/lookup-home-network`
5. Server verifies signature/nonce, returns home_networks row or 404
6. Browser regenerates foreign HomeNetwork from seed
7. Fetch listOccupants (lazy subscription)
8. Merge foreign fileSystems into FileSystemProvider
9. Merge foreign occupants into targetMachineIdFor resolver

Seed-regen invariant: no persistent server state — network materialized entirely from seed. Reload to refetch.

Uniform across access vectors: same trigger for ssh, curl, nmap, gobuster, hydra, exploit, scp.

## 5.8 Foreign LAN occupant resolution

Once foreign network materialized, occupants visible via same IP→machine_id translation as home LAN.

`buildForeignLanOccupantMap` composes foreign networks+occupants into Map<foreign_lan_ip, ForeignLanOccupantEntry>.

Translation applied at same precedence as own-LAN in `targetMachineIdFor`: gateway-alias canonicalization → own-LAN occupants → foreign-LAN occupants → passthrough.

Wiring: `buildResolveTargetMachineId` threads foreign networks+occupants; write paths (logFs) and read paths use same translation so writers/readers agree.

## 5.9 React closure-capture pattern (ref-wrap recipe)

Commands created during render capture resolver state in closure. When async pre-resolve materializes foreign network, OLD closure has OLD resolver with empty iptables/fileSystems. Fix: ref-wrapping [[project_react_closure_capture_pattern]].

Applied to: resolveTargetMachineIdRef, resolveNatRef, readFileFromMachineRef, getNodeFromMachineRef, createFileOnMachineRef.

Ref object stable across renders; .current always points to LATEST resolver. OLD command closure captured ref (not OLD resolver); when exec runs async AFTER foreign network materializes, .current yields NEW state.

flushSync requirement: When `awaitCrossPlayerBaseFs` populates base filesystem rows, it updates FileSystemContext state. If OLD closure calls `createFileOnMachine` before flushSync, mutation checks OLD parentNode state and fails. Solution: `flushSync(setFileSystems)` inside async pre-resolve.

## 5.10 Cross-player write paths (double-resolution rule)

When Player A writes to Player B workstation (SSH, scp, command), write must resolve to same canonical machine_id at session creation AND inner write time [[project_cross_player_write_path_canonical_id]].

Pattern: FIRST RESOLUTION for session creation → SECOND RESOLUTION for inner write. If different, session rejected.

Defense-in-depth: `resolveTargetMachineId` deterministic once foreign networks materialized. If regen happens between calls (race), write fails loudly (session mismatch) rather than silently landing on wrong machine.

## 5.11 Workstation visibility

Own-LAN visibility (PR #118, 2026-05-05): Occupants visible via lanOccupants array (fetched listOccupants, subscribed Realtime hints). Render as RemoteMachine: IP=subnet+lan_ip, hostname=prefix-suffix, ports closed, no visible users.

Foreign-LAN visibility: Once foreign networks materialize, occupants visible same way. Foreign IP→workstation_id identical to own-LAN.

Workstations remain sealed: players can't enumerate user accounts until they crack root. Threat model [[project_realtime_publish_authorization]]: exposing user lists enables precomputed dictionary attacks.

## 5.12 Per-network public-key scoping & Realtime subscription

Patches scoped to machine_id, published on patches:<machine_id>. For home-network occupants, machine_id is workstation's hostname (identity-derived), so patches from any player converge.

Realtime subscription: subscribe to patches:<machine_id> on load, server publishes hints {checksum, originator_key} on INSERT, ignore hints where originator_key===ownPlayerKey, hints trigger listPatchesForMachines SELECT, cross-player writes converge within ~100-500ms.

Occupant hints: separate channel occupants:<network_id>, payload {network_id, originator_key} only, self-skip, 150ms debounce (rapid hints coalesce into one fetch).

Foreign network subscription (lazy): first curl/ssh/nmap on foreign IP triggers ensureForeignReachable → listOccupants → subscription to foreign occupants Realtime channels → writes stream live → unsubscribe on reload.

## 5.13 Player-hosted websites (apache2/nginx)

Players run own daemons via `apache2 [port]` / `nginx [port]` (root-only for privileged ports).

Generator: `buildInfrastructurePidFiles(ports)` groups daemon ports by binary, emits one multi-line pid file (nginx 80+443 ships one nginx.pid with two lines).

Port state: PID file PRESENCE opens port, ABSENCE closes (canonical source). Player-run writes pid file at start. `systemctl stop SERVICE` deletes it.

Daemon control: apache2/nginx apt-installable in /usr/bin/, require root, write pid; sshd/vsftpd pre-installed in /usr/sbin/; nc -l writes /var/run/nc-PORT.pid with user/tier metadata.

Cross-player NAT forwarding: player who roots home router edits /etc/iptables/rules.v4 to forward public IP to workstation port. Wiring: buildMergedRouterView applies applyDynamicOverrides to occupants, occupant pid files merge into router port state, forward rules resolve NPC+occupant machines, NPC wins on collision.

Sibling-parser: parses Apache /var/run/apache2.pid and extracts owner metadata. Same for nginx, nc, vsftpd.

Pending: mutable router NAT, findit.io registration.

## 5.14 Machine access vector catalog (6 categories)

Every access flow categorized [[project_machine_access_vector_catalog]]:

1. Auth-driven: SSH, FTP, MySQL, Redis (credential login, role-level)
2. CVE-session: msfconsole on vulnerable service (transient session)
3. Backdoor-connect: nc to pre-existing backdoor (reverse shell)
4. CVE-no-session: library/binary vulnerabilities (command-level effect)
5. Hydra: brute-force auth (credential discovery)
6. Read-only: world-readable files, SNMP public, HTTP GET (passive recon)

Rewrite inherits all six. No UI layer changes.

## 5.15 NAT / firewall routing across LANs

Own-LAN NAT: parses /etc/iptables/rules.v4, maps public IP+port → internal IP+port, applied at SSH/FTP/NC boundaries, dynamic changes take effect on next scan.

LAN-side vs WAN-side: real iptables NAT fires only on WAN, forwarded ports invisible from inside. `applyDynamicOverrides` detects LAN-side by comparing visible IP to canonical resolution — when different (gateway .1 alias), NAT-merge skipped.

Foreign router forwarding: out of scope, planned separate piece.

---

## Key invariants for Solid rewrite

1. Seed-based determinism: all topologies regenerated from seed, no persistent state beyond world_networks rows, reload to regenerate.

2. Occupant rows ephemeral: players rejoin, get new slot, old rows age out, state consistent because always re-fetched+filtered.

3. Machine_id canonical: workstation's hostname IS storage key, IP must translate to hostname, cross-LAN writes must double-resolve.

4. Realtime subscription lifecycle: reload unsubscribes foreign channels, reconnect triggers new load+resubscription, Solid effects need same lifecycle.

5. Same resolution path: targetMachineIdFor single source of truth, both logFs.writeFileToMachine and occupantAwareReadNode use it.
