# Plan: Cross-LAN seed-regen + useForeignNetworks (Problem C of cross-LAN trilogy)

**Branch (plan)**: `feat/cross-lan-seed-regen-plan`
**Branches (impl)**: one per PR, off `main`
**Status**: Active

## Goal

First touch of a foreign public IPv4 (the router IP of another player's home network) makes that LAN fully accessible from every existing primitive — `findMachineByIp`, `applyDynamicOverrides`, `buildMergedRouterView`, the FileSystem subscription pipeline — without any per-command synthesis or merge helpers.

## Context

After PR #145 (Problem A, gateway-alias canonicalization) and PRs #147/#148/#149 (Problem B, LAN/WAN scan asymmetry), foreign-network access is the last unresolved piece of the cross-LAN trilogy. PR #142 attempted this via per-command synthesis (`mergeForeignRouterForwards`, `wellKnownService`, `addCrossLanMachineId`, etc.) and was closed because each new command needed its own merge hook. This plan replaces that approach.

**Core insight**: every cross-LAN command (`nmap`, `curl`, `lynx`, `hydra`, `gobuster`, `msfconsole`, `ssh`, `ftp`, `dig`, `nslookup`) already operates on `findMachineByIp` / `getMachine` and the merged-router view. The data they read from doesn't care whether a network is the player's own or a stranger's. If we regenerate the foreign `HomeNetwork` deterministically client-side and slot it into the same React state pipelines the local home network uses, every command works for free.

**Determinism**: the server stores `seed = home-${public_ip}` for new networks (`src/homeNetworks/handler.ts:165`). The seed is server-of-record but fully derivable from `public_ip`. Returning the stored seed from the lookup endpoint keeps the regen authoritative (defensive against any historical row whose seed diverges).

**Decisions already taken** (see `project_cross_lan_seed_regen_approach`, `project_cross_lan_lazy_subscription_design`, `project_cross_lan_trilogy` memories):

- **State slice**: new `useForeignNetworks` context (cleaner lifecycle than augmenting `useHomeNetworks`; easier to test in isolation).
- **Subscription scope**: eager — first touch of a foreign public IP subscribes to ALL machine_ids on that LAN (router + occupants). Same-LAN density caps the bandwidth; lazy occupant-by-occupant proved fragile in PR #142.
- **Lifecycle**: foreign networks cached for the session, dropped on page reload (refs reset, no IndexedDB persistence).
- **Trigger location**: IP-resolution layer, via a single async variant `findMachineByIpAsync`. Commands call the async variant at entry; downstream sync lookups continue working.
- **Realism vs PR-B**: LAN-side asymmetry (PRs #148/#149) is preserved — foreign networks inherit the same WAN-shows / LAN-hides PREROUTING semantics via the existing `gatewayAliasMap` mechanism.

## Acceptance Criteria

- [ ] Player A can `nmap <B's home router public IP>` and see B's router's open ports plus any iptables-forwarded ports from B's LAN (WAN-side view).
- [ ] Player A can `curl <B's home router public IP>` to reach a daemon B has forwarded via `nano /etc/iptables/rules.v4`.
- [ ] Player A can `hydra ssh <B's home router public IP>` and crack a credential from a wordlist.
- [ ] Player A can `ssh user@<B's home router public IP>` with the cracked credential and land on B's router (foothold).
- [ ] After foothold, Player A's `nmap` inside B's LAN sees B's LAN's occupants/NPCs and inherits same-LAN behavior (LAN-side asymmetry — no forwarded ports visible on `.1`, matching PR #149).
- [ ] Player A's `msfconsole` can target a CVE-eligible port on B's router and establish a session via the normal exploit flow.
- [ ] Changes B makes to their router's `/etc/iptables/rules.v4` propagate to A's nmap of B's public IP in real time (existing Realtime hint mechanism).
- [ ] Refreshing A's page drops the foreign-network cache; revisiting the same foreign public IP regenerates it from scratch.
- [ ] An RFC1918 / loopback / non-IPv4 input never triggers the foreign-network lookup (no wasted API calls on local addresses).
- [ ] None of the dropped PR-#142 primitives (`mergeForeignRouterForwards`, `wellKnownService`, `addCrossLanMachineId`, `resolveForeignRouter`) are re-introduced.

## Out of Scope

- **World networks** (findit.io, techparts.io, playground): already in local state via `world_networks`. No change.
- **Mission networks**: still per-player ephemeral; not covered by this plan. The mission-instance migration is its own track.
- **Tier-1 server-side merge** (from the lazy-subscription brainstorm): deferred. Tier-2-only (eager subscription on first touch) is simpler and the bandwidth math holds at indie scale.
- **Cross-LAN write-path canonicalization**: already shipped in PRs #145/#147; foreign networks reuse the canonical-keyed writes for free.
- **Persistent foreign-network cache across reloads**: deliberately not persisted to IndexedDB; per-session only.
- **Forgery-resistant publish authorization**: addressed by the existing HINTS-based broadcast model (`project_realtime_publish_authorization`). The new context plugs into the same channel pattern.

## PR Breakdown

5 implementation PRs + 1 smoke verification (no-code). Ordering is strict A → B; tests in each PR mock the prior layer where needed.

| PR  | Title                                         | Size   | Depends on |
| --- | --------------------------------------------- | ------ | ---------- |
| 1   | `/api/lookup-home-network` endpoint           | small  | —          |
| 2   | `useForeignNetworks` context + resolver       | medium | PR 1       |
| 3   | Plumb foreign FS into FileSystemProvider      | small  | PR 2       |
| 4   | Plumb foreign network into NetworkProvider    | medium | PR 2       |
| 5   | Wire async resolver into command entry points | medium | PR 4       |
| 6   | Smoke matrix (manual)                         | none   | PR 5       |

PRs 3 and 4 are independent and can ship in either order after PR 2.

---

## PR 1 — `/api/lookup-home-network` endpoint

**Branch**: `feat/api-lookup-home-network`

A read-only POST endpoint that returns a `home_networks` row by `public_ip`. Signed envelope (matches `joinHomeNetwork` / `patches` / `sessions` auth pattern). Returns 404 if no row exists.

### Step 1: Zod schema for the lookup endpoint

**RED**: A new `lookupHomeNetworkSignedPayloadSchema` test asserts that `{ action: 'lookupHomeNetwork', ts: <num>, nonce: <hex32>, public_ip: '162.174.39.103' }` parses successfully and that an unknown field (e.g. `extra: 1`) is rejected (`.strict()`).
**GREEN**: Define schema in `src/homeNetworks/types.ts` next to `joinHomeNetworkSignedPayloadSchema`; mirror its shape. Add `LookupHomeNetworkSignedPayload` inferred type.
**MUTATE**: Mutate `.strict()` → omit; mutate `z.string().min(1)` → `z.string()`; mutate `public_ip` literal name. Verify each fails RED.
**KILL MUTANTS**: Tests already cover; if unknown-field rejection slips, add explicit `expect(...success).toBe(false)`.
**REFACTOR**: None — schema is data.
**Done when**: schema unit tests pass; running mutations on the schema produces failing tests.

### Step 2: Pure handler `handleLookupHomeNetworkRequest`

**RED**: New test file `src/homeNetworks/lookupHandler.test.ts` with three behaviors:

- Found row → `200 { public_ip, essid_template, density_tier, max_slots, seed }`.
- Not-found row → `404 { error: 'not_found' }`.
- Replay nonce → `409 { error: 'replay' }` (matches existing handler nonce-store contract).
- Malformed payload (bad ts / nonce / public_ip) → `400 { error: 'malformed' }`.
  **GREEN**: New `src/homeNetworks/lookupHandler.ts` with `handleLookupHomeNetworkRequest(body, deps)` shape mirroring `handleJoinHomeNetworkRequest`. Deps: `findNetworkByPublicIp`, `verifySignature`, `nonceStore`, `rateLimiter`. Returns `{ status, body, headers? }`.
  **MUTATE**: Mutate the `404` → `200`; mutate the row projection to omit `seed`; mutate the action literal in `signRequest('lookupHomeNetwork', ...)`. Each must fail RED.
  **KILL MUTANTS**: Tests cover. If projection mutation slips, assert exact response shape (not just status).
  **REFACTOR**: Share verify/nonce/rate-limit helpers with `handleJoinHomeNetworkRequest` if duplication > 10 lines.
  **Done when**: handler unit tests pass + mutation testing kills all assertions.

### Step 3: Vercel adapter `api/lookup-home-network.ts`

**RED**: A smoke script `scripts/testLookupHomeNetwork.ts` follows the `scripts/testCreateSessionUserType.ts` pattern: signs an envelope, POSTs to `/api/lookup-home-network` running locally via `vercel:dev`, asserts the row payload for a known public IP. Add ~4 scenarios: existing row, missing row, malformed envelope, replay nonce.
**GREEN**: New `api/lookup-home-network.ts` mirrors `api/join-home-network.ts`'s adapter shape — env-var checks, Supabase client, `findNetworkByPublicIp` injection, Upstash adapters, dispatch to `handleLookupHomeNetworkRequest`.
**MUTATE**: Manual smoke script catches deploy-config mutations.
**KILL MUTANTS**: Catch via the smoke script's scenario coverage.
**REFACTOR**: Pull shared env-var setup into a helper if it duplicates >20 LoC across `api/*.ts`.
**Done when**: `npx tsx scripts/testLookupHomeNetwork.ts` reports 4/4 green against local `vercel:dev`.

### Step 4: Client wrapper `lookupHomeNetwork(identity, publicIp)`

**RED**: `src/homeNetworks/lookupClient.test.ts` with `vi.fn()` for `fetch`: asserts the POST URL, signed-envelope shape (via signRequest), and that the success path returns a runtime-validated `HomeNetworkLookupResult`. Test 404 → throws; malformed JSON → throws.
**GREEN**: New `src/homeNetworks/lookupClient.ts` exports `lookupHomeNetwork(identity, publicIp, fetchImpl = fetch): Promise<HomeNetworkLookupResult>`. Mirrors `joinHomeNetwork` shape; uses a new `homeNetworkLookupResultSchema` (zod).
**MUTATE**: Mutate URL string → fails. Mutate `signRequest('lookupHomeNetwork', ...)` → fails. Mutate strict schema → must be caught by malformed-JSON test.
**KILL MUTANTS**: Add `expect(fetchMock).toHaveBeenCalledWith('/api/lookup-home-network', ...)` for URL coverage.
**REFACTOR**: If `joinHomeNetwork` and `lookupHomeNetwork` share envelope wiring, extract a tiny helper in `src/signedRequest/`.
**Done when**: wrapper unit tests + mutation testing report clean.

### PR 1 Pre-merge

- [ ] `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all green.
- [ ] `npx tsx scripts/testLookupHomeNetwork.ts` 4/4 against `vercel:dev`.
- [ ] No client-side code consumes the new endpoint yet (intentional — PR 2 will).
- [ ] RLS verifier confirms anon CANNOT SELECT directly from `home_networks` (force traffic through the function).

---

## PR 2 — `useForeignNetworks` context + resolver

**Branch**: `feat/use-foreign-networks-context`

A new context provider holding a session-scoped cache of regenerated foreign home networks plus a single async resolver. Above `NetworkProvider` and `FileSystemProvider` in the React tree; below `HomeNetworksProvider` (uses identity).

### Step 1: `isPublicIpv4` heuristic

**RED**: `src/foreignNetworks/isPublicIpv4.test.ts` asserts:

- `162.174.39.103` → true (public).
- `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `127.0.0.1`, `100.64.0.1` (CGNAT), `169.254.0.1` (link-local) → false.
- `not-an-ip`, `1.2.3` (invalid), `::1`, empty string → false.
- The home router internal `.1` aliases of various subnet patterns → false (they're RFC1918).
  **GREEN**: New `src/foreignNetworks/isPublicIpv4.ts` — re-implementation of the helper PR #142 carried (which was useful but tangled). Pure function, no imports.
  **MUTATE**: Mutate the RFC1918 range checks (e.g. `10.` prefix flip); mutate the IPv4 regex; mutate the boolean inversion. Each must fail RED.
  **KILL MUTANTS**: Tests already enumerate every range; add boundary cases (`9.255.255.255` → true, `10.0.0.0` → false).
  **REFACTOR**: If readability suffers from condition stacking, extract a list of CIDR-shape checks.
  **Done when**: full enumeration of public/private cases passes; mutation testing kills every range check.

### Step 2: `ForeignNetworksContext` skeleton (cache + version)

**RED**: `src/foreignNetworks/ForeignNetworksContext.test.tsx` (rendering via `@testing-library/react`) asserts:

- A `useForeignNetworks()` hook without a provider throws.
- A provider with an empty cache exposes `foreignNetworks: []`, `foreignLanOccupants: []`, `foreignFileSystems: {}`, `foreignLanOccupantHostnames: []`.
- A consumer that calls `ensureForeignReachable('10.0.0.1')` (RFC1918) returns `null` without side effects (verified via `vi.fn()` injected lookup).
- A consumer that calls `ensureForeignReachable(ownActiveHomePublicIp)` returns `null` (own-home short-circuit).
  **GREEN**: New `ForeignNetworksContext.tsx` with the same cache-ref + version-counter shape as `HomeNetworksContext`. `ensureForeignReachable` returns `null` for the short-circuit cases. No API call yet.
  **MUTATE**: Mutate the throw-on-missing-provider; mutate `null` returns to placeholder values; mutate own-home equality check (drop `===`).
  **KILL MUTANTS**: Cover via the existing assertions; add explicit `expect(lookupMock).not.toHaveBeenCalled()` to guard the short-circuits.
  **REFACTOR**: Defer until after Step 4.
  **Done when**: context skeleton tests pass; short-circuits never call into the lookup or `generateHomeNetwork`.

### Step 3: `ensureForeignReachable` happy path

**RED**: Add test scenarios:

- First call for a public IP → invokes `lookupHomeNetwork(identity, publicIp)` once → invokes `generateHomeNetwork({ seed, essid: essid_template, routerPublicIp: publicIp })` once → invokes `listOccupants(publicIp)` once → resolves with the regenerated `HomeNetwork` → state exposes the network in `foreignNetworks` and its fileSystems in `foreignFileSystems` and occupant hostnames in `foreignLanOccupantHostnames`.
- Second call for the same IP → cache hit, no API call.
- Concurrent calls for the same IP during in-flight → coalesce to one API call (single lookup invocation).
- Lookup throws `404` → resolver returns `null`, cache absent, no state update.
  **GREEN**: Implement the resolver body: short-circuit checks first; in-flight ref check; signed lookup + regen + occupants in sequence (do them in parallel? — sequential is fine for first cut, parallel optimization can land later); cache write + version bump.
  **MUTATE**: Mutate the in-flight ref check (drop early return); mutate the `result.seed` argument to `generateHomeNetwork` to a literal; mutate `routerPublicIp` to undefined; mutate the cache `.set` to no-op. Each must fail RED.
  **KILL MUTANTS**: Coalescing test catches in-flight; explicit `expect(lookupMock).toHaveBeenCalledTimes(1)` after concurrent calls.
  **REFACTOR**: If the resolver body grows past ~50 LoC, extract a `resolveAndCache(publicIp)` inner function.
  **Done when**: all happy-path + caching + coalescing tests green.

### Step 4: Derived selectors (`foreignFileSystems`, `foreignLanOccupantHostnames`)

**RED**: Extend the context tests:

- After resolving two foreign IPs, `foreignFileSystems` contains the union of both networks' fileSystems keyed by machine_id; no key collisions on shared `.1` aliases because each foreign network has its own subnet.
- `foreignLanOccupantHostnames` contains the deduped union of occupant hostnames across all cached networks.
- `foreignNetworks` is the array of cached HomeNetwork objects, in cache insertion order.
  **GREEN**: Selectors via `useMemo` on the cache ref + version. Use `Object.assign({}, ...cacheValues.map(n => n.fileSystems))` for union; flatten + dedup hostnames.
  **MUTATE**: Mutate spread order; mutate dedup; mutate the version dependency. Each must fail RED.
  **KILL MUTANTS**: Tests already assert exact keysets and dedup behavior.
  **REFACTOR**: Extract dedup helper if reused.
  **Done when**: derived selectors materialize correctly across multi-network caches.

### Step 5: Provider mount + wire into App

**RED**: `App.test.tsx` (or the closest provider-tree integration test) — assert that `<ForeignNetworksProvider>` wraps `<NetworkProvider>` and `<FileSystemProvider>` and that the default empty cache renders without errors.
**GREEN**: Insert `<ForeignNetworksProvider>` into the App component tree above `NetworkProvider`/`FileSystemProvider`, below `HomeNetworksProvider` (identity context).
**MUTATE**: Move the provider out of the tree → tests crash.
**KILL MUTANTS**: Already covered.
**REFACTOR**: None.
**Done when**: full provider tree renders; no runtime warning for missing context.

### PR 2 Pre-merge

- [ ] `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all green.
- [ ] No call sites yet consume `foreignFileSystems` or `foreignLanOccupantHostnames` — that's PRs 3 and 4.
- [ ] Manual: open browser console, run `(window as any).__crossLanResolve('162.174.39.103')` exposed via a dev-only window hook (drop hook after merge) → verify cache populates.

---

## PR 3 — Plumb foreign FS into FileSystemProvider

**Branch**: `feat/foreign-fs-plumbing`

Two threads: foreign fileSystems get layered into the merged base; foreign machine_ids get added to the subscription keyset. Both are existing seams in `useFileSystemSync.ts`.

### Step 1: Extend `useFileSystemSync` Inputs

**RED**: `src/filesystem/useFileSystemSync.test.tsx`:

- With `foreignFileSystems: { '198.51.100.50': someTree }` passed, `fileSystems['198.51.100.50']` equals `someTree` after mount.
- With `foreignLanOccupantHostnames: ['skylab-9k3']` passed, `machineIdsKey` includes `skylab-9k3`.
- Removing a foreign FS shrinks the keyset and the subscription is torn down.
  **GREEN**: Add `foreignFileSystems?: Readonly<Record<string, FileNode>>` and `foreignLanOccupantHostnames?: readonly string[]` to the `Inputs` type. Fold both into the `machineIdsKey` memo and into the layer-merge sites (rehydration `.then`, hint-refetch, missionFs reseat effect).
  **MUTATE**: Mutate the spread order (foreign should layer AFTER home/mission so foreign network patches don't clobber an own-home file with a same path); mutate inclusion of foreign hostnames in the key.
  **KILL MUTANTS**: Tests assert the exact layered tree + keyset.
  **REFACTOR**: If the four layer-merge sites become repetitive, extract a `mergeAllFileSystems(workstationId, props, foreign, crossPlayer, patches)` helper.
  **Done when**: Foreign FS layered + subscribed + torn down correctly.

### Step 2: Wire foreign data from context into `FileSystemProvider`

**RED**: `FileSystemContext.test.tsx` (or the provider test) asserts that when the `useForeignNetworks()` context exposes `foreignFileSystems` and `foreignLanOccupantHostnames`, those props are passed through to `useFileSystemSync`.
**GREEN**: Read `useForeignNetworks()` inside `FileSystemProvider` and pass through.
**MUTATE**: Drop the props from the call → tests fail.
**KILL MUTANTS**: Assertion already covers it.
**REFACTOR**: None.
**Done when**: provider integration test green.

### PR 3 Pre-merge

- [ ] All tests pass; mutation testing on `useFileSystemSync` keyset + layer logic kills mutants.
- [ ] Manual: with a dev-hook `__crossLanResolve('162.174.39.103')`, observe in DevTools Network tab that `listPatchesForMachines` payload includes the foreign router's machine_id.

---

## PR 4 — Plumb foreign network into NetworkProvider

**Branch**: `feat/foreign-network-plumbing`

Foreign networks need to flow into the four seams: `findMachineByIp`, `findMachineUsers`, `gatewayIps`, `gatewayCanonicalMap`. The dynamic-overrides pipeline and `resolveNat` get foreign data transparently because they're keyed off `gatewayIps` and the canonical-key map.

### Step 1: Extend `NetworkProvider` props

**RED**: `src/network/NetworkContext.test.tsx`:

- With `foreignNetworks: [foreignNet]` and `foreignLanOccupants: [{ ... }]` props, `findMachineByIp(foreignRouterPublicIp)` returns the foreign router's `RemoteMachine`.
- `findMachineByIp(foreignInternalIp)` (a machine behind the foreign router) returns the right machine.
- `findMachineUsers(foreignRouterPublicIp)` returns the foreign router's users.
- `gatewayIps` includes the foreign router IP and any inner gateway IPs.
- `getInterfaces` for the player's own host is unaffected (foreign network must not leak into the local wlan0 interface set).
  **GREEN**: Add `foreignNetworks?: readonly HomeNetwork[]`, `foreignLanOccupants?: readonly OccupantSummary[]` to `NetworkProviderProps`. Extend `findMachineByIp` body to iterate foreign networks AFTER home/mission/world miss. Extend `findMachineUsers` symmetrically. Extend `gatewayIps` memo: `[...local home gateways, ...mission, ...world, ...foreignNetworks.flatMap(collectGatewayIps)]`.
  **MUTATE**: Mutate iteration order (foreign before home — could cause wrong-network lookups); mutate the empty-array fallback. Each must fail RED.
  **KILL MUTANTS**: Test order: home gateway IP shadows foreign? Sanity-check the test setup with two networks sharing a `.1` subnet only differing by public IP → assert findMachineByIp returns the correct one based on input IP, not insertion order.
  **REFACTOR**: If `findMachineByIp` body branches grow past 6, extract `searchNetworks(networks, ip)`.
  **Done when**: foreign machines findable via IP; users readable; gatewayIps extends.

### Step 2: Multi-network `buildGatewayCanonicalIpMap`

**RED**: `src/homeNetworks/homeNetworkHelpers.test.ts` — new tests:

- `buildGatewayCanonicalIpMap([ownNet, foreignNet])` produces the union of `.1` → canonical mappings for both networks.
- No duplicate-key conflict: each network has its own subnet so each `.1` alias is unique.
- An empty input returns an empty map.
  **GREEN**: Refactor `buildGatewayCanonicalIpMap(homeNetwork: HomeNetwork | null)` → `buildGatewayCanonicalIpMap(networks: readonly HomeNetwork[])`. Update sole caller in `NetworkContext.tsx:211` to pass `[homeNetwork, ...foreignNetworks].filter(Boolean)`.
  **MUTATE**: Mutate `.filter(Boolean)`; mutate the map merge to overwrite instead of union; mutate input default. Each must fail RED.
  **KILL MUTANTS**: Already covered.
  **REFACTOR**: Drop the old single-network signature if no callers remain (per `feedback_no_backward_compat`).
  **Done when**: helper tests + NetworkContext memo dependency are unified; canonical-key reads work for both own and foreign gateways.

### Step 3: Wire foreign data from context into `NetworkProvider`

**RED**: `src/network/NetworkContext.test.tsx` — assert that when `useForeignNetworks()` exposes `foreignNetworks` and `foreignLanOccupants`, those props flow into `NetworkProvider`.
**GREEN**: Read `useForeignNetworks()` inside the App component (or wherever `<NetworkProvider>` is mounted) and pass through.
**MUTATE**: Drop the prop pass-through → tests fail.
**KILL MUTANTS**: Covered.
**REFACTOR**: None.
**Done when**: integration test green; `findMachineByIp` returns foreign machines after `ensureForeignReachable` resolves.

### PR 4 Pre-merge

- [ ] All tests pass.
- [ ] `resolveNat(foreignRouterIp, port)` correctly translates via foreign router's iptables (read via `allIptablesRules` against the canonical key).
- [ ] LAN-side asymmetry (PR #149) preserved for foreign router via existing `gatewayAliasMap` logic — verified via unit test where viewer is on a `.1` alias and the iptables-merge branch is skipped.

---

## PR 5 — Wire async resolver into command entry points

**Branch**: `feat/cross-lan-async-resolver-wiring`

Adds `findMachineByIpAsync` to NetworkContext and updates the small set of command entry points so they `await` the loader before doing sync IP resolution.

### Step 1: `findMachineByIpAsync` on NetworkContext

**RED**: `NetworkContext.test.tsx`:

- `findMachineByIpAsync(ip)` for a home machine → resolves to the same `RemoteMachine` as sync `findMachineByIp(ip)`, never invokes the resolver.
- For an unknown public IP → invokes `ensureForeignReachable(ip)` once → re-runs sync `findMachineByIp(ip)` → resolves to the foreign machine.
- For an RFC1918 IP that's unknown → does NOT invoke the resolver (per `isPublicIpv4` gate); resolves to `undefined`.
- Concurrent calls for the same unknown IP coalesce into one resolver invocation (delegates to PR 2's in-flight ref).
  **GREEN**: Add `findMachineByIpAsync(ip): Promise<RemoteMachine | undefined>` to `NetworkContextType`. Implementation: sync lookup → return if hit; `isPublicIpv4` check → return undefined if private; `await ensureForeignReachable(ip)` → sync lookup again → return result.
  **MUTATE**: Mutate the sync-first short-circuit (always go async); mutate the public-IP gate; mutate the post-resolve sync re-lookup. Each must fail RED.
  **KILL MUTANTS**: Covered; verify resolver call count for the "home machine" path.
  **REFACTOR**: Inline single-use helpers if extraction adds noise.
  **Done when**: async variant exposed + tested.

### Step 2: Replace sync `findMachineByIp` with async variant at command entry

**RED**: Per-command tests:

- `nmap <foreign-public-ip>` → calls `findMachineByIpAsync` once on entry; subsequent passes use sync `findMachineByIp` (which now hits cache).
- `curl <foreign-public-ip>:80/path` → ditto.
- `lynx <foreign-public-ip>:80` → ditto.
- `hydra ssh <foreign-public-ip>` → ditto.
- `gobuster <foreign-public-ip>:80` → ditto.
- `msfconsole <foreign-public-ip> <port>` → ditto.
- `dig <foreign-public-ip>` (reverse PTR) → ditto.
- `nslookup <foreign-public-ip>` → ditto.
- `ssh user@<foreign-public-ip>` (via `useAuthentication`) → ditto.
- `scp` / `ftp` / `mysql` / `redis-cli` / `nc` → ditto.

Replace these tests' `findMachineByIp` mock with a `findMachineByIpAsync` mock that returns the same machine. Verify each command awaits it.
**GREEN**: At each command's entry point, replace the sync `findEffectiveMachineByIp(targetIP)` with `await findEffectiveMachineByIpAsync(targetIP)`. Single shared point: `useNetworkCommands.ts:132` `findEffectiveMachineByIp = withOverlay(findMachineByIp(...))` becomes `findEffectiveMachineByIpAsync = async (ip) => withOverlay(await findMachineByIpAsync(ip))`.

Touch points (per the Grep at planning time):

- `src/components/Terminal/Terminal.tsx:593`
- `src/commands/mysql.ts:73`
- `src/commands/rediscli.ts:57`
- `src/commands/nmap.ts:300, 394`
- `src/hooks/useAuthentication.ts:254`
- `src/hooks/useNetworkCommands.ts:132`

The shared `findEffectiveMachineByIp` is consumed by curl, lynx, hydra, gobuster, msfconsole, dig, nslookup, nc — they all flow through `useNetworkCommands`. The remaining direct call sites (Terminal, mysql, rediscli, useAuthentication) need individual updates.
**MUTATE**: Mutate `await` → drop (sync call still works because of cache from prior run, but a cold first call fails); mutate the resolver function name.
**KILL MUTANTS**: Cold-start tests catch missing `await`. Confirm tests don't pre-populate the cache.
**REFACTOR**: If the same pattern repeats across 8+ commands, encapsulate into a `useEffectiveMachineByIp` hook returning both sync + async variants.
**Done when**: all touch-point commands await the resolver; cold-start nmap succeeds for a foreign IP.

### Step 3: Tear down dev-hook from PR 2

**RED**: A test that asserts `window.__crossLanResolve` is undefined in production builds.
**GREEN**: Remove the dev-hook (was only for PR 2 smoke).
**MUTATE**: N/A (deletion).
**REFACTOR**: N/A.
**Done when**: dev-hook gone.

### PR 5 Pre-merge

- [ ] All command tests pass.
- [ ] `npm run test:e2e` (mission playthrough) still green — no regression on local-network primitives.
- [ ] Mutation testing on `findMachineByIpAsync` body kills all mutants.

---

## PR 6 — Smoke verification (manual, no-code)

**Branch**: none — verification only. Closes the trilogy if all rows green.

Two-browser setup: Tab A (Player A) on a freshly-cracked WiFi; Tab B (Player B) on a different WiFi. Player A learns B's public IP out-of-band (or via a forthcoming `findit.io` mechanism — that's piece 3, out of scope here).

Test matrix:

| #   | Action (Tab A)                                                          | Expected                                                                                              |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | `nmap <B's router public IP>`                                           | router's open ports + any iptables-forwarded ports B has live                                         |
| 2   | `curl <B's router public IP>:<forwarded-http-port>/some-path`           | content from B's forwarded apache2/nginx daemon                                                       |
| 3   | `lynx <B's router public IP>:<forwarded-http-port>/some-path`           | rendered HTML from same daemon                                                                        |
| 4   | `hydra ssh <B's router public IP>` (with a default wordlist)            | credential match if B has a weak password live                                                        |
| 5   | `ssh <user>@<B's router public IP>` with cracked credential             | foothold on B's router; `whoami` returns the user; `ls /home` shows B's user dirs                     |
| 6   | `nmap` from inside B's LAN after foothold                               | B's NPCs + occupants visible; no forwarded ports shown on the `.1` view (preserves PR #149 asymmetry) |
| 7   | B edits `/etc/iptables/rules.v4` and saves; A re-runs `nmap` from Tab A | new forward visible without page reload (Realtime hint path)                                          |
| 8   | A refreshes Tab A; A re-runs `nmap <B's router public IP>`              | cold-start works again (regen + subscribe happens once; ~150-400ms latency expected)                  |

Regression spot-checks:

- Single-player (no Tab B): all existing primitives still work locally.
- `nmap 10.0.0.1` (RFC1918) from Tab A: no API call to `/api/lookup-home-network` (verify in Network tab).
- `nmap 127.0.0.1` (loopback): localhost behavior unchanged.
- `nmap <own public IP>`: own-home short-circuit; no extra API call.

If any row fails, file a bug + map it to a PR (the resolver layer, plumbing, or wiring).

---

## Cross-cutting Pre-PR Quality Gate (every PR)

1. Mutation testing on touched files — manual since no Stryker; every test must fail at least once when a mutation is introduced.
2. Refactoring assessment — if the new code grows duplicative helpers, consolidate (per `feedback_consolidate_small_helpers`).
3. `npm run build`, `npm run lint`, `npm run format:check`, `npm run test:run` all green.
4. DDD glossary check — keep "foreign network" as the canonical term in code and tests; avoid synonyms like "remote network" / "cross-LAN network" that drift.

## Notes for future sessions

- **Compact between PRs.** This plan is the durable anchor; per-problem memory live in `project_cross_lan_seed_regen_approach` and `project_cross_lan_trilogy`. Update those after each PR ships.
- **No reintroducing PR #142 helpers.** Specifically: `mergeForeignRouterForwards`, `wellKnownService`, `addCrossLanMachineId`, `resolveForeignRouter`. If any of those names appears in a PR diff, the plan is being violated.
- **Determinism check.** Two clients resolving the same public IP MUST produce the same `HomeNetwork` (machines, ports, gateway topology). The single source of seed truth is the `home_networks.seed` column.
- **L1/L2 enforcement.** All foreign-network writes are subject to the existing L1 (handler.ts) and L2 (machine_filesystems walker) gates — already canonical-keyed per PR #145. No new defense is needed; the existing security boundary covers foreign reads/writes.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
