# Plan: Home Network Occupants

**Branch**: feat/home-network-occupants
**Status**: Active

## Goal

Ship the `home_networks` + `home_network_occupants` infrastructure: a global catalog of cracked-WiFi home networks with server-allocated LAN slots and identity-derived hostnames, so two players who crack the same WiFi land on the same LAN as separate occupants. Replaces the hardcoded `localhostIp = ${subnet}.100` in `src/generation/generateHomeNetwork.ts:77`.

This is the largest remaining piece of multiplayer infrastructure (per `project_phase_roadmap.md`). Builds on the same machinery as `world_networks` (PR #84) — `public_ips` registry, signed-envelope endpoint pattern, RLS posture — adds an occupant table and a join flow on top.

## Acceptance Criteria

- [ ] `home_networks(public_ip PK, essid_template, density_tier, max_slots, seed, created_at)` migration
- [ ] `home_network_occupants(network_id FK, player_key, lan_ip, hostname, joined_at, last_seen_at)` migration with `UNIQUE (network_id, lan_ip)`, `UNIQUE (network_id, hostname)`, `UNIQUE (network_id, player_key)`
- [ ] `POST /api/join-home-network` signed endpoint that, given `{ essid_template, density_tier }`, **idempotently** returns `{ public_ip, lan_ip, hostname, network_seed }` — returns the player's existing occupant row if one exists for that network, otherwise allocates a new slot
- [ ] Server-side find-or-create: picks an existing `home_networks` row with free slots for the given `(essid_template, density_tier)`; creates a new row (allocating a public IP via the existing allocator) if none has free slots
- [ ] Server-side LAN slot allocation: random within `.10-.250`, retried on `UNIQUE (network_id, lan_ip)` conflict
- [ ] Identity-derived hostname suffix: `${workstation_prefix}-${first-4-hex-chars-of-sha256(player_key)}` — applied to every player on every LAN, so the suffix carries no occupancy signal
- [ ] `generateHomeNetwork` accepts injected `{ networkSeed, slotIp, hostname }` from the join response; the old `(gameSeed, wifiIndex, essid)` signature is retained only for the no-game-seed static-fallback / test path
- [ ] `useHomeNetworks` materializes home networks **lazily on connect** (with in-memory cache during a session) — no longer pre-generates all crackable WiFis at boot
- [ ] `nmcli connect <essid> <password>` calls the join endpoint after authentication succeeds, surfaces the assigned hostname (`Connected to ACME-CORP — assigned skylab-9k3 (10.0.0.187)`)
- [ ] `.100` audit: `useAuthentication`, `getDefaultHomePath`, prompt rendering, gateway `.1` aliasing in `generateHomeNetwork` — all consume the dynamic `slotIp` instead of any hardcoded value
- [ ] **Two-browser smoke**: Player A and Player B with different identities, sharing a `gameSeed` to force WiFi pool overlap, both crack ACME-CORP → both land on the same LAN with different `.X` IPs and different `-XXXX` hostnames; A's `nmap` from inside the LAN shows B's machine; B's `/var/log/auth.log` records A's SSH attempt; cross-browser writes propagate live via Realtime
- [ ] Module README at `src/homeNetworks/README.md`; `docs/infrastructure-design.md` updated to describe the cross-player home-network model

## Out of Scope (deferred)

- **Per-location visibility** — global ESSID catalog with per-player subset ("location" model). Today each player still sees their own per-seed WiFi list; neighbors only collide when independent rolls happen to overlap (~1/25 per slot with the v0.107.0 pool of 50). Acceptable per ship-first; "rare encounters" is the design target. Revisit if neighbors-meet gameplay needs to be reliably engineered rather than statistically rare.
- **Slot tombstones / inactivity reclaim** — once a player joins a LAN, their occupant row persists forever in this PR. No reclaim on inactivity, no permadeath cleanup. Crowded LANs can fill up permanently; allocator falls back to creating a new `home_networks` row with the same `essid_template`. Tombstone with ~30-day reclaim is a follow-up.
- **Router ownership semantics** — the home router on a shared LAN belongs to no one in this PR. First-to-root claims, transferable control, neutral-but-rooted-grants-config-rights are all later design questions.
- **Permadeath rejoin policy** — random-LAN-on-respawn is the implicit default (each new identity gets its own occupancy roll). Memory of past LAN membership is not preserved across permadeath. No code needed in this PR; flag for future design.
- **Tier-influenced LAN address ranges** — flat-random `.10-.250` for all tiers. `density_tier` only controls `max_slots` (1 / 3 / 8). Tier-narrowed ranges (solo deterministic `.100`, shared `.50-.150`, crowded `.10-.250`) were considered for address-space coherence per tier and **rejected**: a tier-bounded IP range could leak crowdedness information from the assigned IP to anyone observing it (defenders reading logs, third-party players doing reconnaissance). Flat range guarantees the IP carries no occupancy signal — same principle that drives random-within-range over sequential.
- **Themed per-LAN flavor** — every cracked ACME-CORP LAN looks topologically identical (same `seed` per row). Future content pass could let server roll per-LAN seed variation for replayability across sessions.
- **LAN address-space negotiation across home_networks rows** — each row is its own `/24`, no shared addressing across rows. Standard model, no work needed.

## Design Decisions (locked)

These were worked out in chat before drafting; capturing them here so the PR doesn't relitigate.

1. **Per-location visibility**: deferred (see Out of Scope). Keep current per-seed WiFi pool; rare-overlap-by-chance is the intended gameplay feel.
2. **Hostname collisions**: always-suffix with identity-derived stable suffix (`${prefix}-${first-4-hex-chars-of-sha256(player_key)}`). Suffix applied universally — every player on every LAN — so getting a suffix is the rule not a signal. Removes the information leak that "only-second-arrival-suffixed" would have created. Stable per identity → cross-LAN attribution handle for trail-following gameplay.
3. **LAN slot allocation**: random within `.10-.250`, server-rolled, `UNIQUE (network_id, lan_ip)` retried. Removes the information leak that sequential allocation (`.100, .101, .102`) would have created. Flat-range across all tiers; `density_tier` only controls `max_slots`. Tier-narrowed ranges were rejected for the same anti-leak reasoning — see Out of Scope.
4. **Endpoint idempotency**: `POST /api/join-home-network` returns the player's existing occupant row if one exists for the requested `(essid_template, density_tier)`; only allocates a new slot if no row exists. Client never has to remember "did I already join this LAN" — server is source of truth.
5. **Lazy generation**: `useHomeNetworks` no longer pre-generates all crackable home networks at boot. Each `nmcli connect` triggers join → generate → cache-in-memory-for-session. Reduces server load and defers work to when the player actually engages.

## Architecture

### Schema

```sql
-- home_networks: catalog of LAN instances. Each row = one shared LAN.
-- Rides public_ips for the public IP (kind='home_network' already exists).
CREATE TABLE home_networks (
  public_ip       TEXT        PRIMARY KEY REFERENCES public_ips(ip) ON DELETE CASCADE,
  essid_template  TEXT        NOT NULL,                  -- 'ACME-CORP' — the join key
  density_tier    TEXT        NOT NULL CHECK (density_tier IN ('crowded','shared','solo')),
  max_slots       INT         NOT NULL CHECK (max_slots > 0),
  seed            TEXT        NOT NULL,                  -- topology seed (derived from public_ip, not player gameSeed)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup-by-template-with-free-slots — driven by the find-or-create flow
CREATE INDEX home_networks_template_tier_idx
  ON home_networks (essid_template, density_tier, created_at);

-- home_network_occupants: per-player slot on a LAN.
CREATE TABLE home_network_occupants (
  network_id    TEXT        NOT NULL REFERENCES home_networks(public_ip) ON DELETE CASCADE,
  player_key    TEXT        NOT NULL,
  lan_ip        TEXT        NOT NULL,                    -- '.187' style host octet on the row's subnet
  hostname      TEXT        NOT NULL,                    -- 'skylab-9k3'
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (network_id, player_key),                  -- one slot per player per network
  UNIQUE (network_id, lan_ip),
  UNIQUE (network_id, hostname)
);

CREATE INDEX home_network_occupants_player_idx
  ON home_network_occupants (player_key);
```

RLS posture: anon-readable (mirrors `world_networks`); INSERT/UPDATE/DELETE service-role-only.

### Endpoint contract

`POST /api/join-home-network` with signed envelope:

```jsonc
// signed payload (verified pubkey stamped server-side as player_key)
{
  "action": "joinHomeNetwork",
  "ts": 1735689600,
  "nonce": "<32-hex>",
  "essid_template": "ACME-CORP",
  "density_tier": "crowded",
  "workstation_prefix": "skylab",
}
```

Response (200):

```json
{
  "public_ip": "203.0.113.42",
  "lan_ip": "10.0.0.187",
  "hostname": "skylab-9k3",
  "network_seed": "home-203.0.113.42"
}
```

Server flow:

1. Verify signed envelope (existing `verifySignedRequest`)
2. Rate-limit on verified pubkey (existing per-pubkey limiter)
3. Compute `hostname = workstation_prefix + '-' + sha256(player_key).slice(0,4)` — deterministic per identity
4. **Idempotent existing-row return**: `SELECT * FROM home_network_occupants WHERE network_id IN (SELECT public_ip FROM home_networks WHERE essid_template = $1 AND density_tier = $2) AND player_key = $verified_pubkey LIMIT 1` — if found, return that row's network + slot
5. **Find-or-create network**: `SELECT public_ip, seed FROM home_networks WHERE essid_template = $1 AND density_tier = $2 AND (SELECT count(*) FROM home_network_occupants WHERE network_id = public_ip) < max_slots ORDER BY created_at LIMIT 1` — if none, allocate new public IP via existing `allocateIp` allocator with `kind='home_network'`, INSERT new `home_networks` row with `seed = 'home-' + public_ip`
6. **Allocate slot**: roll random `lan_ip` in `.10-.250`, INSERT occupant row, retry on `UNIQUE (network_id, lan_ip)` conflict (bounded retries)
7. Return `{ public_ip, lan_ip, hostname, network_seed }`

Errors: 401 for auth failures, 429 for rate-limit, 500 for exhausted retries / DB errors. Mirrors `/api/allocate-ip` mappings exactly.

### Client flow

`nmcli connect ACME-CORP <password>`:

1. Verify password against the WiFi catalog entry (existing logic) — fails fast, no server call
2. Look up the cracked WiFi's `tier` from `crackableEssidPool` (added in v0.107.0)
3. Call `joinHomeNetwork(identity, { essid_template, density_tier, workstation_prefix })`
4. On success: pass `{ networkSeed, slotIp, hostname }` into `generateHomeNetwork` (lazy, cached in `useHomeNetworks`)
5. Display `Connected to ACME-CORP — assigned skylab-9k3 (10.0.0.187)` in the terminal
6. Set `connectedWifi` in session

Disconnect / switch network: clears `connectedWifi`; in-memory cache retains the materialized network. Reconnect to the same ESSID hits the cache (no server call). New ESSID triggers a fresh join.

## Steps

Every step follows TDD: failing test first, minimum implementation, mutation-test the new code, refactor only if it adds value. The step descriptions describe behavior; tests verify behavior, not implementation.

### Step 1: Migration — `home_networks` + `home_network_occupants`

**Acceptance criteria**: New SQL migration `supabase/migrations/<ts>_home_networks.sql`. Creates both tables with the schema above. RLS enabled, anon SELECT policy on both. No INSERT/UPDATE/DELETE policies (service-role only). `npm run db:reset` runs cleanly. `'home_network'` is already in `public_ips.kind` from `20260424180121_public_ips.sql` — no enum change needed.
**Done when**: migration applies cleanly, both tables queryable from anon Supabase client, INSERT denied for anon (verified via integration test).

### Step 2: Pure helpers — `deriveHostnameSuffix` + `pickRandomLanIp`

**Acceptance criteria**: Two pure functions in `src/homeNetworks/` (new module).

- `deriveHostnameSuffix(playerKey: string): string` — returns 4 lowercase hex chars from `sha256(playerKey)`. Tests: same input → same output (stable), different inputs → different outputs (no constant returns), output matches `/^[0-9a-f]{4}$/`.
- `pickRandomLanIp(prng: Prng): string` — returns `.X` where X is a random integer in `[10, 250]`. Tests: 1000 samples produce both endpoints and a spread across the range; never returns out-of-range values.

**Done when**: tests green, mutation report clean, pure modules unit-tested.

### Step 3: Server handler — `handleJoinHomeNetworkRequest`

**Acceptance criteria**: `src/homeNetworks/handler.ts` exports `handleJoinHomeNetworkRequest(envelope, deps)` orchestrating the flow described in Architecture. Pure handler, dependencies injected (DB ops, allocator, rate limiter, nonce store). Tests cover behavior:

- Valid request, no existing occupant, no existing network → creates network + occupant, returns slot
- Valid request, no existing occupant, network exists with free slots → reuses network, allocates new slot
- Valid request, no existing occupant, network exists but full → creates new network, allocates slot in it
- Valid request, **existing occupant** → returns existing slot (idempotent), no new allocation, no DB writes
- Slot collision (random IP already taken) → retries until success or bounded exhaustion
- Invalid signature / replay / ts skew → 401
- Rate-limit exceeded → 429
- Allocator exhausted → 500

Server-stamped `player_key` from verified pubkey, never trusted from payload. `essid_template` and `density_tier` validated via Zod schema.

**Done when**: tests green, mutation report clean.

### Step 4: API adapter — `api/join-home-network.ts`

**Acceptance criteria**: Vercel handler mirroring `api/allocate-ip.ts` structure. Method guard, env-var lookup, Supabase + Upstash client wiring, dependency injection into `handleJoinHomeNetworkRequest`. No business logic in this file. Reuses `buildUpstashAdapters` factory if already extracted, otherwise inlines (parallel to allocate-ip).
**Done when**: integration test against local Supabase + Upstash succeeds end-to-end (request → INSERT → response).

### Step 5: Client wrapper — `joinHomeNetwork()`

**Acceptance criteria**: `src/homeNetworks/client.ts` exports `joinHomeNetwork(identity, request, fetchImpl?): Promise<JoinResponse>`. Mirrors `allocatePublicIp` shape. Signs request, POSTs envelope, parses response with Zod, throws on malformed response or non-2xx status. Tests: happy path, malformed response, network error, idempotent call returns same result.
**Done when**: tests green, mutation report clean.

### Step 6: Generator + hook rework — lazy materialization

**Acceptance criteria**:

- `generateHomeNetwork` gains a new entry path that accepts `{ networkSeed, slotIp, hostname }` and skips the `gameSeed`/`wifiIndex` derivation. Old signature retained for the static-fallback / test path. Internal `localhostIp` reads from `slotIp` instead of `${subnet}.100`. Hostname propagates into the returned `HomeNetwork` shape.
- `useHomeNetworks` switches from "pre-generate all" to "materialize on demand": returns `{ activeNetwork, ensureJoined(essid, password): Promise<HomeNetwork> }`. Internal `Map<essid, HomeNetwork>` cache. `ensureJoined` either returns from cache or calls `joinHomeNetwork` + `generateHomeNetwork` and caches.
- `HomeNetwork` type adds `hostname` field (the assigned `${prefix}-${suffix}`). `useAuthentication`, prompt rendering, gateway aliasing read it.

Tests cover behavior at the public surface: `useHomeNetworks` exposes the right active network after a join, cache hit on second `ensureJoined` for the same essid (no second server call), different essids trigger separate joins.

**Done when**: tests green, mutation report clean, single-player no-game-seed path still works (existing tests unchanged).

### Step 7: nmcli wire-up + `.100` audit cleanup

**Acceptance criteria**:

- `nmcli connect <essid> <password>` flow: verify password locally (existing) → call `ensureJoined` → display `Connected to <essid> — assigned <hostname> (<lan_ip>)` → set `connectedWifi`. Failure modes (server error, rate-limit) surface a usable error message, not a stack trace.
- Grep for hardcoded `.100` references in `useAuthentication`, `getDefaultHomePath`, prompt code, gateway aliasing inside `generateHomeNetwork.ts`. Each call site reads the dynamic `slotIp` / `hostname` from the resolved active network. No references to the old hardcoded value remain in code paths that handle Phase 5 networks.
- `WIFI_NETWORKS` static fallback path: still uses `.100` for the single-player no-server flow (it's the only occupant on a no-other-players LAN — fine).

Tests cover the integration: `nmcli connect` flow returns the right hostname/IP; switching networks rebinds; reconnect to the same network is a cache hit.

**Done when**: tests green, manual smoke shows assigned hostname/IP in the prompt and `ifconfig`.

### Step 8: Two-browser smoke + module README + docs

**Acceptance criteria**:

- Two-browser smoke (manual): Player A and Player B with different identities, both with the same `gameSeed` so they share a WiFi pool. Both crack the same crackable ESSID, both `nmcli connect`. A: `ifconfig` shows e.g. `10.0.0.187 (skylab-9k3)`. B: `ifconfig` shows e.g. `10.0.0.43 (rocket-7c)`. From inside the LAN, A `nmap`s and sees B's machine; B's `/var/log/auth.log` accumulates A's SSH attempts cross-player via Realtime.
- New `src/homeNetworks/README.md` documents the join flow, schema, idempotency contract, suffix derivation rule, and slot-allocation rule. Production framing.
- `docs/infrastructure-design.md` "WiFi Hacking Gate" section updated to describe the new cross-player home-network model — multiple players, shared LAN, server-allocated slots, identity-derived hostnames. Old text described single-player-only assumptions.
- `docs/technology-choices.md` adds a row for the home-network occupant layer alongside missions and world networks.

**Done when**: smoke pass, all docs updated, ready to ship.

## Pre-PR Quality Gate

1. Mutation testing on new modules (`src/homeNetworks/*`)
2. Refactoring assessment after each green
3. `npm run build` + `npm run lint` + `npm run format` + `npm run test:run` all green
4. Two-browser manual smoke verified
5. Memory updates: retire `project_multiplayer_home_network_model.md` design memo (or downgrade to "shipped" reference); update `project_phase_roadmap.md` to mark this chunk done; add a new `project_home_network_occupants_shipped.md` capturing what landed and any gotchas surfaced during implementation
6. Version bump (minor: feature) in `package.json` + `package-lock.json`

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
