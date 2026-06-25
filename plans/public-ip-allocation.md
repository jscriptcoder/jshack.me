# Plan: Unique public-IP allocation service (epic item #4)

**Branch**: `feat/v2-public-ip-allocation` (base label; cut a fresh branch per slice off `main` per
`v2/docs/conventions-and-gotchas.md` §8)
**Status**: Active

## Goal

A network's public IP is **server-allocated and stored, globally unique across ESSIDs** — issued once on
first join, shared by every occupant of that AP, and never colliding with another network's address.

## Context & source of truth

Design resolved via `grill-me` 2026-06-25; the full decision block lives in
`plans/multiplayer-crossplayer-epic.md` → "Remaining work / deferred follow-ups" item #4. Read that first,
plus `v2/docs/cross-player-architecture.md` §2 (identity/addressing) and
`v2/docs/conventions-and-gotchas.md` §3/§6 (gates, wire-check infra).

**What this fixes:** today `public_ip` is a deterministic PRNG draw from the ESSID
(`generatePublicIp(createPrng('home-public-'+essid))`), so two *different* ESSIDs can birthday-collide onto
one address. We replace the derive with a server allocation guarded by a DB `UNIQUE` constraint.

**Explicitly OUT of scope (stays epic item #5 / the shared-router story):** `network_registry` keeps PK
`public_ip` and its single-owner shape; the intra-ESSID multi-occupant eviction (N occupants → one registry
row, last-writer-wins) stays handled by #306's `home_network_occupants` fallback. This plan does NOT re-key
the registry or touch the per-player router.

**Grounding that shapes the slices:**
- `.publicIp` is consumed in exactly ONE production site — `registerNetwork.ts:101` writing
  `network_registry.public_ip`. Nothing client-side reads a player's own public IP; downstream
  (`findRegistryByPublicIp` scan resolution, `findRegistryByOwnerKey` Story-6 source-IP traces) reads the
  *stored* value. So moving off derivation is near-free, and there is **no player-facing UI change** — the
  observable proof is at the API/DB boundary (wire-check) plus the regression-guard that the existing
  cross-player `nmap` loop still resolves.
- `assignHomeNetwork`'s `.localIp`/`.hostname` stay pure, per-player, and derived — only `.publicIp` moves.

## Acceptance Criteria

- [ ] Two different ESSIDs never receive the same public IP — DB `UNIQUE`-guaranteed, proven by a wire-check
      including a forced draw-collision that redraws.
- [ ] An ESSID's public IP is allocated once on first join and is stable across re-joins and reloads
      (idempotent — re-join returns the same IP, never a second allocation).
- [ ] Concurrent first-joiners of one ESSID converge on a single IP (no duplicate row, no error).
- [ ] The public IP is server-allocated + stored, not client-derivable: `assignHomeNetwork` no longer returns
      it, `home-public-${essid}` derivation is gone, and nothing client-side depends on it (typecheck-proven).
- [ ] The existing cross-player loop is unbroken: `nmap <A's allocated public IP>` still resolves A's
      router + ports, and Story-6 source-IP traces still log A's (now allocated) public IP.
- [ ] `network_registry` stays PK `public_ip`; multi-occupant eviction behaviour is unchanged (out of scope).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test. Load
`tdd`, `testing`, `mutation-testing`, `refactoring` before code. Wire-checks need local supabase + `vercel dev`
on 3100 (mind the squatter gotcha, conventions §5).

### Slice 1: A pure `allocatePublicIp` resolves an ESSID to a unique IP, retrying past draw-collisions — ✅ MERGED (#322)

> Shipped: `core/network/allocatePublicIp.ts` (fast-path read + bounded draw/claim retry; injected
> `readByEssid`/`drawIp`/`claim(essid, ip) → string | null`). 6 behaviour tests, 100% mutation (14/14).
> The `claim` contract was simplified to `string | null` (the bound IP, or null on inter-ESSID collision)
> so Slice 2's adapter is a single `INSERT … ON CONFLICT (essid) DO UPDATE … RETURNING`.

**Value**: The allocation *logic* (the novel, risky part — retry/fast-path/race) exists and is exhaustively
unit-tested in isolation, unblocking the wired walking skeleton (Slice 2). Permitted horizontal exception
(matches the codebase's "pure primitives first" precedent, e.g. Story 5.1.1a): pure `core/`, zero infra,
independently verified by unit tests + typecheck, strictly smaller than doing it inside the wiring.
**Path**: `core/network/allocatePublicIp.ts` — a pure function with injected deps, no DB import. Signature:
`allocatePublicIp(essid, { readByEssid, drawIp, claim, maxAttempts? }) → Promise<string>` where
`claim(essid, ip) → 'claimed' | 'essid_exists' | 'ip_taken'`. Logic: (1) fast-path `readByEssid` → return any
existing IP without drawing; (2) loop ≤ `maxAttempts`: `drawIp()` → `claim`; `'claimed'` → return the IP;
`'essid_exists'` (lost the first-join race) → return `readByEssid` (the winner's IP); `'ip_taken'` → redraw;
(3) exhausted → throw. `drawIp`'s production impl wraps `generatePublicIp` (server randomness) — injected so
tests force a deterministic draw sequence.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `functional`,
`typescript-strict`.
**Acceptance criteria** (present + confirm before code):
- Unknown ESSID, free IP → draws once, claims, returns that IP.
- Known ESSID → returns the stored IP via the fast path **without** calling `drawIp` or `claim`.
- First draw `'ip_taken'`, second `'claimed'` → returns the second IP (redraw works).
- `claim` returns `'essid_exists'` (concurrent first-joiner won) → returns the winner's IP via `readByEssid`,
  not a fresh draw.
- All attempts `'ip_taken'` → throws after exactly `maxAttempts` draws (bounded, no infinite loop).
**RED**: `allocatePublicIp.test.ts` driving the five cases above with stub deps. Likely mutator gaps from
`resources/mutator-rules.md`: the retry bound (`<` vs `<=`, off-by-one on `maxAttempts`), the conflict-branch
discrimination (`essid_exists` vs `ip_taken` swapped), the fast-path early return (removing it should fail a
test that asserts `drawIp` is never called for a known ESSID).
**GREEN**: implement the fast-path + bounded retry loop.
**MUTATE**: run `mutation-testing` on `allocatePublicIp.ts`.
**KILL MUTANTS**: strengthen tests for survivors (esp. the bound and the branch enum).
**REFACTOR**: assess only if it adds value.
**Done when**: all five criteria green, mutation report reviewed, human approves commit.

### Slice 2: Joining a network allocates + persists a unique public IP, end-to-end — ✅ DONE (pending commit)

> Shipped: migration `network_public_ips(essid PK, public_ip UNIQUE)`; `api/network.ts` `readEssidIp`/
> `claimEssidIp` (`upsert onConflict:'essid', ignoreDuplicates` = `DO NOTHING`; `23505` → null redraw) +
> `drawIp` = `generatePublicIp(createPrng(randomUUID()))`; `handleRegisterNetwork` takes an injected
> `allocatePublicIp` and stamps its result (replaced the derive), mapping allocation failure → 500. 15 handler
> tests green (100% mutation, 45/45); `scripts/testPublicIpAllocation.ts` 6/6 vs `vercel dev`+supabase.

**Value**: A player's join now stores a server-allocated, globally-unique public IP, and another identity's
`nmap <that IP>` still resolves it. The real walking skeleton — the production path from the `/api/network`
`registerNetwork` action through the allocator to `network_registry`, proven against a live endpoint.
**Path**: Actor = a joining player (and a second identity scanning). Trigger = `registerNetwork` round-trip.
- **Migration** `supabase/migrations/<ts>_network_public_ips.sql`: `network_public_ips(essid TEXT PRIMARY KEY,
  public_ip TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`, RLS enabled, no policies
  (service-role only — mirror `network_registry`).
- **Adapter** (`api/network.ts`, register branch ~L369): a `readByEssid(essid)` SELECT and a `claim(essid, ip)`
  = `INSERT … (essid, public_ip) VALUES … ON CONFLICT (essid) DO NOTHING RETURNING public_ip` →
  row ⇒ `'claimed'`, no row ⇒ `'essid_exists'`, caught pg `23505` on the `public_ip` constraint ⇒ `'ip_taken'`.
  `drawIp` = `generatePublicIp(createPrng(<server-random seed>))`.
- **Handler** `handleRegisterNetwork`: add the allocation dep; replace the `assignHomeNetwork(...).publicIp`
  derive at `registerNetwork.ts:101` with `await allocatePublicIp(payload.essid, deps)`; the returned IP flows
  into the `NetworkRegistryRow.public_ip` it already upserts. (`workstation_*` + occupant writes unchanged.)
- **Wire-check** `scripts/testPublicIpAllocation.ts`: drive `registerNetwork` for two distinct ESSIDs →
  assert distinct `network_registry.public_ip` + matching `network_public_ips` rows; re-join one ESSID →
  same IP; force a draw collision (seed/inject so two ESSIDs first-draw the same IP) → assert redraw yields
  distinct IPs; then `resolvePublicScan` against an allocated IP still returns `found:true` + the router's
  `:22`. Seeds via service-role, asserts, cleans up; exits 0.
- **Version bump** in `v2/package.json` + `v2/package-lock.json` (`npm install --package-lock-only`).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `typescript-strict`.
**Acceptance criteria** (present + confirm before code):
- Joining ESSID X writes a `network_public_ips` row and the same IP into `network_registry.public_ip`.
- Re-joining ESSID X returns/stores the identical IP (no second allocation).
- Two ESSIDs whose first draw collides resolve to two distinct IPs (redraw path exercised on the real DB).
- `resolvePublicScan` against an allocated IP still resolves the router + `:22` (existing loop unbroken).
**RED**: unit tests for the `handleRegisterNetwork` allocation wiring (allocator dep called with the payload
essid; its result lands in the upserted registry row) with stubbed deps; then the `scripts/testPublicIpAllocation.ts`
wire-check as the integration RED (fails until the migration + adapter + handler land). Mutator focus: the IP
threaded into the registry row (a mutant that keeps deriving should fail), the `23505`→`'ip_taken'` mapping.
**GREEN**: migration + adapter `claim`/`readByEssid` + handler swap + api wiring until unit + wire-check pass.
**MUTATE**: run `mutation-testing` on the changed `core/` (handler + allocator integration); the adapter/api
runtime correctness is covered by the wire-check (not Stryker — `api/` isn't unit-typechecked).
**KILL MUTANTS**: strengthen as needed.
**REFACTOR**: assess.
**Done when**: all criteria green, wire-check exits 0 against `vercel dev`, mutation report reviewed, human
approves commit.

### Slice 3: The client no longer carries a (now-dead) public IP — SPLIT 3a (scripts/test) + 3b (core)

> **3a** (this branch): migrate the 7 scripts + the `authCreateSessionSameLan` anti-leak test OFF
> `assignHomeNetwork().publicIp` — field still exists, behaviour-neutral, re-run affected wire-checks. No
> production code change → no TDD cycle; verified by the existing tests/wire-checks staying green.
> **3b** (next branch): remove the field + derive from `homeNetwork.ts`; drop the `homeNetwork.test.ts` goldens
> + the `commandEnv` factory `publicIp`; the `networkApi`/`state` type narrows. Atomic + typecheck-gated.

**Value**: Remove the dead, now-MISLEADING `home-public-${essid}` derivation. Post-Slice-2 the real public IP
is allocated, so `assignHomeNetwork().publicIp` is a value that no longer matches reality — a latent trap for
the 7 scripts that compute it. Cleanup that also corrects that staleness (`minimize-api-projections`).
**Scope is bigger than first planned** — removing the field is typecheck-gated, so every consumer moves with it
(~11 files; scripts are typechecked via `tsc -b`):
- **Core**: `core/network/homeNetwork.ts` — `HomeNetworkAssignment` → `{localIp, hostname}`; drop the
  `generatePublicIp(createPrng('home-public-'+essid))` derive + the now-unused `generatePublicIp` import.
- **Type ripple (no logic change)**: `adapters/networkApi.ts` + `ui/state.ts` return `HomeNetworkAssignment`
  (neither reads `.publicIp`); `src/test/factories/commandEnv.ts` `join` stub drops `publicIp`.
- **Unit test**: `core/network/homeNetwork.test.ts` loses its `publicIp` goldens;
  `core/sessions/authCreateSessionSameLan.test.ts` reworks its anti-leak assertion (currently
  `not.toContain(assignHomeNetwork(B).publicIp)`) to assert the LAN-IP line positively / an explicit constant.
- **Scripts — seed-and-expect / anti-leak** (`testCrossPlayerScanTrace`, `testCrossPlayerConnectionTrace`,
  `testSameLanScanTrace`, `testSameLanTrace`): they seed a registry row with the derived IP and assert on it —
  replace with an explicit public-IP constant (self-consistent; re-run to confirm).
- **Scripts — register-and-use / cleanup** (`seedCrossPlayerTarget`, `testSameLanOccupancy`,
  `testSameLanCrossPlayerFs`): `seedCrossPlayerTarget` reads the ALLOCATED IP from `network_public_ips` after
  the join; the two same-LAN ones delete `network_registry` by `owner_key` (not the derived public IP) and drop
  the stale "public_ip is essid-derived" comments.
- **Verify**: re-run the affected wire-checks vs `vercel dev` + supabase.
**Required implementation skills**: `tdd`, `testing`, `refactoring`, `typescript-strict`.
**Acceptance criteria** (present + confirm before code):
- `assignHomeNetwork(pubkey, essid)` returns exactly `{localIp, hostname}` with the localIp/hostname values
  unchanged from before (golden preserved).
- No production code references a client-side public IP (`grep` + `npm run typecheck` clean).
- All existing tests pass after dropping the field.
**RED**: update `homeNetwork.test.ts` to assert the new `{localIp, hostname}` contract (fails against the old
impl that still returns `publicIp`); keep the localIp/hostname golden assertions.
**GREEN**: remove the `publicIp` field + derivation + dead import; follow the types out to the adapter.
**MUTATE**: light — this is deletion; the localIp/hostname goldens guard the surviving behaviour.
**KILL MUTANTS**: n/a beyond the goldens.
**REFACTOR**: n/a.
**Done when**: criteria green, typecheck/lint clean, human approves commit.

## Pre-PR Quality Gate (every slice)

1. Mutation testing — run `mutation-testing` (Slices 1–2; Slice 3 is deletion-guarded by goldens).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` (`tsc -b`, covers `src/` + `api/` + `scripts/`) and `npm run lint` pass — from `v2/`.
4. Slice 2 only: `scripts/testPublicIpAllocation.ts` exits 0 against `vercel dev` (3100) + local supabase;
   version bumped in `package.json` + `package-lock.json`.

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
