# Cross-LAN lazy subscription (piece 2b)

**Status**: planned, not started
**Memory**: [[project_cross_lan_lazy_subscription_design]] (architectural brainstorm)
**Parent**: [[project_player_hosted_websites]] piece (2b)
**Architectural call**: Tier-2-only — lazy subscribe at IP-resolution layer, expand to full LAN on foothold. Server-side merge endpoint (Tier 1) deferred — revisit only if findit.io browsing demonstrates real perf pain.

## Goal

Player B (in LAN Y) can curl/lynx/nmap Player A's public IP and see A's home router → exploit forwarded ports → land on A's machines, without B's tab eagerly subscribing to every player's home network in the universe.

## Out of scope (deferred)

- **findit.io domain index** — piece (3). Cross-LAN discovery surface. Without (3), the only way B knows A's public IP is direct knowledge / chat / mail.
- **Server-side merge endpoint** (Tier 1). Possible follow-up if click-through traffic on findit.io results becomes expensive; not on the critical path now.
- **Unsubscribe-within-session.** Subscriptions persist until page reload. Per-session cap is bounded by touched-IPs; revisit only if observed memory/channel count becomes a problem.

## High-level architecture

Two subscription tiers, both live on the client:

1. **Static / eager** (today) — workstation_id + homeFileSystems keys + missionFileSystems keys + lanOccupantHostnames. Driven by props.
2. **Dynamic / lazy** (new) — `crossLanSubscriptions: Set<machineId>`, runtime-mutable. Two triggers:
   - **First touch via foreign public IP** at IP-resolution layer → add the foreign router's `machine_id`.
   - **Foothold on a foreign LAN** (session created on a foreign machine) → expand to that LAN's full occupant set.

Both sets union into `machineIdsKey`; the existing Realtime + rehydration effects in `useFileSystemSync` already react to keyset changes — minimal new wiring on the subscription side.

## Surfaces touched

| File                                                                    | Change                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/filesystem/useFileSystemSync.ts`                                   | Add `crossLanMachineIds` prop. Fold into `machineIdsKey`.                                                                                                                              |
| `src/filesystem/FileSystemContext.tsx` (or provider)                    | Hold the `Set<string>` state. Expose `ensureSubscribed(machineId)`.                                                                                                                    |
| `src/network/NetworkContext.tsx`                                        | New `resolvePublicIp(publicIp)` (server-backed lookup). Wire `findMachineByIp` / `getMachine` / `resolveDomain` to call `ensureSubscribed` on foreign-IP touch.                        |
| `src/homeNetworks/client.ts`                                            | New `lookupHomeNetworkByPublicIp(publicIp)` — fetch foreign router data + LAN occupants + workstation_id for the router.                                                               |
| `api/lookup-home-network.ts` (new)                                      | Server endpoint backing the above. Reads `home_networks` + `home_network_occupants` by `public_ip`. Anon-readable projection (same shape as existing `listOccupants` + router fields). |
| `src/session/SessionContext.tsx` (or wherever `createSession` resolves) | On successful foreign-machine session create, fetch foreign LAN's occupant set + add all hostnames to `crossLanSubscriptions`.                                                         |
| Tests                                                                   | Unit tests per surface + a two-browser smoke for the end-to-end flow.                                                                                                                  |

## Chunks (each = one PR)

### Chunk A — runtime-mutable subscription set in useFileSystemSync

**What**:

- Add prop `crossLanMachineIds?: readonly string[]` to `useFileSystemSync` Inputs.
- Fold the set into `machineIdsKey` (sorted-joined). The existing rehydration + Realtime effects pick up the new IDs automatically.
- No new server calls in this chunk — pure plumbing.

**Why first**: zero-risk extension of an existing dep. Get the wiring in and tests green before any cross-LAN flow exists to push IDs in.

**Tests**:

- `useFileSystemSync.test.tsx`: keyset includes cross-LAN IDs; adding/removing changes keyset; Realtime subscribe sees the new IDs.
- No e2e — Chunk D covers it.

**Definition of done**: prop wired, key includes the new IDs, existing tests green, new tests prove keyset participation.

### Chunk B — server endpoint + client wrapper for foreign-IP lookup

**What**:

- `api/lookup-home-network.ts`: takes a signed envelope with `{ public_ip }`. Returns `{ network_id, router_machine_id, router_public_ip, occupants: OccupantSummary[] } | null`. 404 when no `home_networks` row matches.
- `src/homeNetworks/client.ts` export `lookupHomeNetworkByPublicIp(identity, publicIp)`.
- Signed envelope (consistency with other endpoints), but **the data returned is anon-public** — no secrets here, just publicly-discoverable network shape. Signing is for rate-limit attribution + replay protection.
- Rate-limit: same `rateLimiter` injection as `joinHomeNetwork`. Conservative limit; cross-LAN discovery is not a hot path.

**Why this shape**: we need three pieces of data on first foreign-IP touch:

1. The foreign router's `machine_id` (= `'router-' + network_id` or whatever the storage key is — verify against existing schema), so we can subscribe to its patches.
2. The foreign router's `public_ip` (sanity / canonicalization).
3. The foreign LAN's occupants — NOT subscribed-to yet, but cached for the **foothold expansion** in Chunk C. Returning them here saves a round-trip later.

**Tests**:

- Handler unit tests: 404 on unknown public_ip, 200 on known, malformed envelope rejection, rate-limit injection.
- Client wrapper: signs correctly, parses response.

**Definition of done**: endpoint live in `vercel:dev`, smoke-tested with an existing home_network row's public_ip.

### Chunk C — IP-resolution interception

**What**:

- New context method `ensureCrossLanSubscribed(machineId)` exposed by the FileSystemContext (or a new ConnectivityContext if it grows). Adds to `crossLanSubscriptions` set, idempotent.
- New context method `resolvePublicIp(publicIp)` on NetworkContext: looks up foreign network via Chunk B's wrapper, calls `ensureCrossLanSubscribed(routerMachineId)`, caches the result for synchronous follow-up calls within the session.
- Wire interception in three call-sites in `NetworkContext`:
  - `findMachineByIp` — if no local match AND the IP shape looks like a public IP (not in own subnet, not in a known network), trigger `resolvePublicIp`. **Async-aware** — `findMachineByIp` is currently sync; either make it async or split into a separate `findMachineByIpAsync` for callers that can await. Commands like ssh/scp/nc/nmap/curl already await elsewhere; identifying the right call paths is part of this chunk's surface area.
  - `resolveDomain` — only matters once findit.io lands (piece 3). Leave a comment / TODO; don't wire it now.
  - `getMachine` — same as findMachineByIp but scoped to current-position view; lower-priority. Skip in this chunk.
- **Cold-start handling**: subscribe and `listPatchesForMachines` race. Tolerable for nmap/curl/lynx (already async with jitter). For ssh/scp/nc/nmap/curl, the existing await chain absorbs the latency. Document the ~150–400ms expectation in the PR description.

**Why now**: only useful after Chunks A+B both land — A gives the subscription channel, B gives the data to subscribe to.

**Tests**:

- `NetworkContext.test.tsx`: `resolvePublicIp` calls the client wrapper, adds the router machine_id to subscriptions, caches for re-resolution.
- `findMachineByIp` async path: foreign public IP triggers `resolvePublicIp`; returns the router RemoteMachine after subscription + base-FS fetch complete.

**Definition of done**: from a fresh browser, calling `nmap <foreign-public-IP>` (manually wired in dev console) triggers the right subscription + returns router data.

### Chunk D — foothold-driven LAN expansion

**What**:

- Hook into the `createSession` success path. When a session lands on a foreign-LAN machine (any machine whose `network_id` ≠ player's own home network or any already-known LAN):
  - Fetch the foreign LAN's occupant list (already returned by Chunk B's lookup; cache it).
  - Expand `crossLanSubscriptions` with all hostnames (= workstation_ids) on that LAN.
- Same primitives as same-LAN occupant subscription, just demand-driven.
- The cross-player base-FS fetch (`fetchCrossPlayerBaseFsIfNeeded`) already fires on session-machine change — it'll cover any foreign workstation we land on.

**Why last**: depends on Chunks A+B+C plus the existing session machinery. Foothold expansion is what makes cross-LAN gameplay actually playable, not just visible.

**Tests**:

- Session-change effect test: foreign-LAN session triggers LAN expansion; same-LAN session doesn't.
- Integration test: ssh into foreign machine → subscriptions grow by the LAN's occupant count.

**Definition of done**: two-browser smoke (Chunk E) passes.

### Chunk E — two-browser smoke

**What**: manual playthrough, mirrors the [[project_cve_effect_smoke_matrix]] pattern.

1. Player A in LAN X with apache2 on workstation port 80, router NAT 80 → A's_lan_ip:80.
2. Player B in LAN Y (different home network).
3. B opens dev tools → confirm no subscription to A's machine_ids yet.
4. B runs `lynx http://<A.public_ip>` → observes:
   - Subscription added for A's router machine_id (verified in Realtime channel inspection).
   - A's `index.html` content rendered.
5. B exploits A's router (forwarded SSH port or similar) → session created → observes:
   - Subscriptions expanded to A's full LAN occupant set.
   - B can now `ls /home/<A.username>` and see A's tree.
6. B page-reloads → all cross-LAN subscriptions dropped; flow re-triggers naturally.

**Definition of done**: smoke ran end-to-end, screenshots / notes attached to the PR.

## Open questions (deferred to implementation discovery)

1. **Public-IP shape detection** — what's the heuristic for "this IP belongs to a foreign LAN and I should hit the lookup endpoint"? Probably: not own subnet AND not in any known home/world/mission config. Spike this in Chunk C; might fall out naturally from the existing `findMachineByIp` miss path.
2. **`getMachine` interception** — sync API today. If we need to lazy-subscribe from current-position view too, async-conversion ripples. Defer until we hit a concrete use case post-Chunk C.
3. **resolveDomain wiring** — only matters with findit.io (piece 3). Document the seam; don't implement yet.
4. **DNS / domain-name discovery before piece 3** — out of scope. Only public-IP entry points work until findit.io lands.

## Risks

- **Async ripple from sync `findMachineByIp`** — biggest unknown. If sync callers are deep (helpers used inside reducer-style flows), conversion gets messy. Mitigation: spike async conversion early in Chunk C; if too invasive, introduce `findMachineByIpAsync` and migrate selectively.
- **Cold-start latency on ssh/scp** — 150–400ms feels slow for an interactive-looking command. Mitigation: parallelize subscribe + fetch in Chunk C; the user-perceived latency is dominated by the round-trip we'd already be making.
- **Subscription unbounded growth within session** — accepted per [[project_cross_lan_lazy_subscription_design]]. Revisit only if observed channel count climbs into hundreds.

## Reverse plan (the easy backout)

If Chunk B's endpoint or the async ripple in Chunk C proves too costly:

- Chunk A's prop addition is free standalone — no rollback cost.
- Drop Chunks B+C+D; the codebase stays at the current "only same-LAN works" state.
- Worst-case fallback: implement Tier 1 (server-side merge endpoint) instead of Tier 2. Different shape entirely; would need its own plan.

## Version bump

`0.135.1 → 0.136.0` on landing Chunk D (feature complete). No bumps for intermediate chunks unless they ship alone (they shouldn't — chunks are paired with their tests, but the feature isn't observable until D).
