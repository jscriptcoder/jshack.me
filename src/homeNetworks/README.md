# Home Networks

Cracked-WiFi LANs as **shared persistent networks**. When two players crack the same WiFi (e.g. `ACME-CORP`), the server allocates each one a separate slot on the same `/24` subnet. Each player gets a unique LAN IP and an identity-derived hostname suffix; trail-leaving (logs, file writes) flows through the existing cross-player visibility plumbing.

Replaces the previous single-player model where `localhostIp` was hardcoded to `${subnet}.100` in `generateHomeNetwork.ts`. The shipped design + rationale lives in this README; see "Design rules" below.

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│  Player cracks WiFi → nmcli connect <essid> <password>            │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼  (signed POST /api/join-home-network)
┌──────────────────────────────────────────────────────────────────┐
│  Server: handleJoinHomeNetworkRequest                             │
│    1. verify signed envelope (Ed25519, schema, replay window)     │
│    2. rate-limit per verified pubkey                              │
│    3. idempotent existing-row return (one slot per player per     │
│       (essid_template, density_tier))                             │
│    4. find-or-create network — fill existing rows before          │
│       allocating a new public IP                                  │
│    5. allocate slot — random LAN IP in [.10, .250], retry on      │
│       UNIQUE conflict; return 409 on hostname conflict (rare)     │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼  ({ public_ip, lan_ip, hostname,
                              │    network_seed })
┌──────────────────────────────────────────────────────────────────┐
│  Browser: HomeNetworksProvider.ensureJoined                       │
│    → generateHomeNetwork({ seed: result.network_seed,             │
│                            slotIp: result.lan_ip,                 │
│                            hostname: result.hostname })           │
│    → cache the materialized HomeNetwork                           │
│    → activeNetwork resolves once connectedWifi.essid matches      │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  GameInner effect: sync session.hostname from activeNetwork       │
│    → prompt shows user@skylab-9k3                                 │
│    → SSH/log handlers (resolveLogSourceIP, useAuthentication)     │
│      observe the suffixed hostname through session.hostname        │
└──────────────────────────────────────────────────────────────────┘
```

## Schema

Two tables, both with anon SELECT, service-role-only mutate:

```sql
home_networks (
  public_ip       TEXT PRIMARY KEY REFERENCES public_ips(ip),
  essid_template  TEXT NOT NULL,                        -- 'ACME-CORP'
  density_tier    TEXT NOT NULL                         -- crowded | shared | solo
                       CHECK (density_tier IN (...)),
  max_slots       INT  NOT NULL CHECK (max_slots > 0),  -- 8 / 3 / 1
  seed            TEXT NOT NULL,                        -- 'home-${public_ip}'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

home_network_occupants (
  network_id    TEXT NOT NULL REFERENCES home_networks(public_ip),
  player_key    TEXT NOT NULL,                          -- 'ed25519:<hex>'
  lan_ip        TEXT NOT NULL,                          -- '.187' (host octet)
  hostname      TEXT NOT NULL,                          -- 'skylab-9k3'
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network_id, player_key),
  UNIQUE (network_id, lan_ip),
  UNIQUE (network_id, hostname)
)
```

The `(network_id, player_key)` PK is the **idempotency key** — the join handler queries for an existing occupant before allocating, and returns the existing row if found. Re-joining the same WiFi after a page refresh is a pure read, no allocation.

## Design rules (the "why" behind each choice)

These are the load-bearing decisions; reverting any of them would break gameplay or leak information.

### Hostname suffix is identity-derived and **always applied**

Every player's hostname becomes `${workstation_prefix}-${first-4-hex-chars-of-sha256(player_key)}`. The suffix is universal — every occupant on every LAN has one — so getting suffixed carries no occupancy signal. If we only suffixed on collision, the suffix itself would tell you "you're not alone here," which is free reconnaissance.

Stable per identity (same player → same suffix on every LAN), so the hostname acts as a cross-LAN attribution handle for trail-following gameplay.

### LAN slot allocation is **random within `.10-.250`**, flat across all tiers

Sequential allocation (`.100`, `.101`, `.102`, ...) would tell every joiner how many people came before them. Random within a wide range reveals nothing.

`density_tier` controls only `max_slots` (1 / 3 / 8 for solo / shared / crowded). The IP range is the same for all tiers — a tier-narrowed range would leak crowdedness from the assigned IP to anyone observing it.

### Endpoint is idempotent

The server is the source of truth for "did I already join this LAN." Client never has to remember; rejoining is a clean re-read. Lets the client cache materialized networks lazily without persistence concerns.

### Hostname conflict bails immediately (409)

`UNIQUE (network_id, hostname)` exists because the suffix could theoretically collide (~0.05% pairwise across 65k hex space). When it happens, retrying with a new `lan_ip` won't help — the suffix is identity-derived. The handler returns 409 immediately rather than burning the retry budget on a deterministic conflict.

## Files

| File                      | Description                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                | `DENSITY_TIERS`, `MAX_SLOTS_BY_TIER`, the strict Zod payload schema, row shapes, `JoinResult` (Zod-derived), `InsertOccupantResult` discriminator.               |
| `deriveHostnameSuffix.ts` | Pure: `playerKey → first-4-hex-chars-of-sha256(utf8(playerKey))`. Stable per identity.                                                                           |
| `pickRandomLanIp.ts`      | Pure: `prng → '.X'` where X is a random integer in `[10, 250]`.                                                                                                  |
| `handler.ts`              | `handleJoinHomeNetworkRequest(envelope, deps)` — pure orchestration. Verify → rate-limit → idempotent return → find-or-create → slot allocation loop with retry. |
| `createInsertOccupant.ts` | Postgres unique-constraint parser — maps `23505` errors onto `lan_ip_conflict` / `hostname_conflict` / `error` by substring matching the constraint message.     |
| `client.ts`               | `joinHomeNetwork(identity, request, fetchImpl?)` — browser-side wrapper. Signs envelope, POSTs, validates response with `joinResultSchema`.                      |
| `*.test.ts`               | Unit tests. Real Ed25519 signing in handler tests; mocked Supabase + Upstash deps.                                                                               |
| `README.md`               | This file.                                                                                                                                                       |

Plus:

- `api/join-home-network.ts` — Vercel adapter (mirrors `api/allocate-ip.ts` structure; minimal glue — DB ops + Upstash + IP allocator wired via dependency injection into `handleJoinHomeNetworkRequest`)
- `supabase/migrations/<timestamp>_home_networks.sql` — schema + RLS policies for both tables
- `src/game/HomeNetworksContext.tsx` — `HomeNetworksProvider` + `useHomeNetworks()` hook. Cache via ref + version counter; `inFlightRef` coalesces concurrent ensureJoined calls; rehydration `useEffect` materializes on mount when `connectedWifi` is restored from storage.
- `src/generation/generateHomeNetwork.ts` — `generateHomeNetwork({ seed, essid, slotIp?, hostname?, ... })` accepts the server-supplied slot/hostname (single-player path defaults to `slotIp='.100'`)
- `src/commands/nmcli.ts` — `connect` awaits `ensureJoined`, displays `assigned <hostname> (<lan_ip>)`; `status` reads dynamic LAN IP from the active home network
- `src/App.tsx` — `GameInner` wires `activeNetwork.hostname` into `session.hostname` so the prompt and log writers observe the suffixed hostname

## Manual smoke check

To verify two players cracking the same WiFi end up on the same LAN with separate slots:

1. Open the deployed app (or `npm run dev`) in two browsers with different identities — one normal + one incognito works; or clear `localStorage` between tabs.
2. **Force WiFi pool overlap**: both players need the same `gameSeed` so their `airodump-ng` shows the same crackable ESSIDs. The pool is per-seed (per `feedback_no_backward_compat`-era design); per-location visibility is deferred per the plan's Out of Scope.
3. In each browser:
   - Boot through intro
   - `airmon start wlan0`
   - `airdump` — both should see the same crackable ESSIDs (e.g. `ACME-CORP`)
   - `aircrack <BSSID>` for the shared one — same password
   - `nmcli connect ACME-CORP <password>`
4. **Verify divergent assignments**: each browser's `Connected to ACME-CORP — assigned <hostname> (<lan_ip>)` line should show DIFFERENT hostnames and DIFFERENT LAN IPs. Both LAN IPs are in `[.10, .250]`. Both hostnames have the same prefix (workstation name) but different 4-hex suffixes.
5. **Verify shared LAN**: from inside browser A's home network, `nmap` should see browser B's machine (and vice versa). The router's public IP is the same in both browsers (visible in `ifconfig` / `nmap` output).
6. **Verify cross-player trails**: from browser A, SSH into one of the LAN machines. Then from browser B, `cat /var/log/auth.log` on that machine — the SSH attempt from A should appear within ~1s (Realtime broadcast).

If steps 4-6 all pass, the chunk is end-to-end live.

## Deferred / out of scope

Headlines (the design discussion behind each is captured in commit history; the originating plan was retired when this chunk shipped):

- **Per-location visibility** — the global ESSID catalog with per-player subset model. Today the WiFi pool is still per-`gameSeed`, so neighbors-meet only happens by chance overlap (~1/25 per slot with the v0.107.0 pool of 50). Acceptable for ship-first.
- **Slot tombstones / inactivity reclaim** — occupant rows persist forever. Crowded LANs can fill up permanently (allocator falls through to creating a new row with the same essid_template).
- **Router ownership semantics** — the home router is unowned shared infrastructure.
- **Permadeath rejoin policy** — a fresh identity gets a fresh occupancy roll.
