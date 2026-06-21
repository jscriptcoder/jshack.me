# Plan: Story 7 — Same-WiFi Shared-LAN Occupancy (v2)

**Branch**: per-slice PRs (`feat/v2-story-7-...`), squash-merged (`feedback_pr_squash_merge_convention`)
**Status**: Active — 7.1a/7.1b shipped (#292/#293, merged); **7.2.0a approved, no code yet** (see pick-up below).

## ▶ Pick-up status (resume here)

`grill-me` ✅ · `planning` ✅. **7.1 split into 7.1a/7.1b — both ✅ SHIPPED.**

**Slice 7.1a ✅ SHIPPED (#292)** — ESSID-seeded `/24` (`assignHomeNetwork` subnet seed → `home-subnet-${essid}`;
host octet stays per-`(key,essid)`). RED→GREEN→MUTATE **100% (7/7 killed)**→REFACTOR(none). Full v2 suite
green, typecheck+lint clean. Golden re-pins: `generateHomeLan`/`nmap`/`nmapScan` tests (subnet
`188→29`, self `154→188`, fresh `ROUTER_PORTS_IDENTITY`). **AC#5 live regression GREEN** —
`testCrossPlayerRouter` 8/8 + `testRouterBrick` 9/9 vs `vercel dev`+Supabase.

**Slice 7.1b ✅ SHIPPED** — `generateWifi` ESSID-derived password (`passwordForEssid(essid)` =
`createPrng('wifi-pw-${essid}').pick(wifiPasswords)`), so the same ESSID cracks to the same password for
everyone (parallel to `bssidFromEssid`). RED→GREEN→MUTATE **100% (6/6 killed, scoped to changed lines)**
→REFACTOR(none). Full v2 suite green (1524), typecheck+lint clean. Golden re-pins (PRNG sequence shifted
when the per-player password draw was removed): `generateWifi` shuffle snapshot + `airdump` table; `nmcli`
validates against the scan's `password`, consistent by construction. `SEED_HIDDEN` survived unchanged.

**7.1a #292 + 7.1b #293 — both MERGED to `main`.**

**Nonce decision RESOLVED (2026-06-21)**: build the real nonce store NOW (over ship-first), **Supabase-backed**,
rolled out to **ALL signed endpoints** → sequenced as **Slice 7.2.0a/0b** (in Slices below), BEFORE 7.2.

**▶ Slice 7.2.0a — ACs APPROVED, NO code yet.** On branch `feat/v2-story-7-2-0a-nonce-store` (off `main` @ #293;
this plan checkpoint is its only commit). **NEXT ACTION = RED→GREEN→MUTATE:**
1. **RED** — write `v2/scripts/testNonceReplay.ts`: POST a signed `patches` (`upsertPatch`) envelope twice with
   the SAME nonce → assert first `200`, replay rejected (`replay`), no 2nd row; a FRESH nonce → `200`. Run vs
   `vercel dev` (3100) + Supabase — **FAILS today** (the noop store always returns `{fresh:true}`).
2. **GREEN** — migration `nonces` (`nonce text primary key`, `created_at timestamptz default now()`, RLS
   service-role-only); `adapters/nonceStore.ts` `createSupabaseNonceStore(supabase)` = `INSERT … ON CONFLICT
   (nonce) DO NOTHING` → `fresh = (inserted rowcount === 1)`; wire into ALL 5 `api/patches.ts` call sites (drop
   the local `noopNonceStore`).
3. **MUTATE** the `inserted===1 → fresh` mapping; DB dedup proven by the wire-check (api/ not unit-mutated).
Full ACs + test strategy + **7.2.0b** (retrofit `api/network.ts`+`api/sessions.ts`, prune nonces older than
`REPLAY_WINDOW_MS`) are in the Slices section below. After 7.2.0 → **Slice 7.2** (occupancy skeleton).

**Env notes for pick-up**: Vercel CLI IS installed (54.6.1); `v2/.env.development.local` present; start the
server with `npm --prefix v2 run vercel:dev` (port 3100) before any wire-check; stop it before Stryker
(`project_v2_stryker_devserver_contention`). Run vitest/tsx from inside `v2/` (PowerShell cwd has drifted to
`v2`, Bash cwd to repo root — `cd` explicitly).

Everything else (scope, the 12 decisions, slice details, regression gate, testing approach) is captured
below and in `plans/multiplayer-crossplayer-epic.md` §"Story 7 — resolved scope & decisions".

## Goal

Two identities who connect to the same ESSID land on the same `/24`; each `nmap`s the LAN and sees the
other's workstation as a real occupant; B connects to A over the **LAN IP** (no NAT); same-LAN traces
log the **LAN IP**. Organic discovery: an occupied ESSID can surface in another player's scan.

## Source of truth

Scope + the **12 locked decisions** live in `plans/multiplayer-crossplayer-epic.md` §"Story 7 — resolved
scope & decisions (grill-me, 2026-06-21)". As-built foundation to build ON (READ FIRST):
`v2/docs/cross-player-architecture.md` — §2 addressing, §3 reachability/login, §4 authorization,
§5 read filter, §8 traces. **Decision numbers `[D#]` below refer to that epic section.**

## Scope guardrails (from grill-me)

- **LAN-occupancy only.** The WAN/router/public-IP path is **untouched** `[D6]`. `network_registry`
  (PK `public_ip`) is left as-is; its multi-occupant last-writer collision is a NOTED, out-of-scope
  imperfection. The `.1` gateway stays each occupant's own router.
- **Deferred (do NOT build):** IP-clash collision-free allocation (DHCP) `[D5]`; shared router/public IP
  per ESSID; ESSID-seeded shared NPC population; WiFi-strength density; TTL/presence heartbeat;
  organic stranger matchmaking beyond occupancy-injection.
- **Reused verbatim (do NOT re-implement):** the 3-tier read filter, write L1+L2, `su` elevation, and
  the Story-6 trace machinery are all `machine_id`-keyed and occupancy-agnostic — the only net-new auth
  surface is the same-LAN connect front door (Slice 7.4) `[D10]`.

## Acceptance Criteria (whole story)

- [ ] Two identities on ESSID X resolve the **same `/24`** with **distinct host octets**, and both crack
      X to the **same password** `[D3,D5]`.
- [ ] On `nmcli connect`, an occupancy row is persisted server-side; on `nmcli disconnect` it is removed
      `[D7,D8]`.
- [ ] B (a current occupant of X) `nmap <subnet>` sees A's workstation as an occupant at A's LAN IP;
      a non-occupant cannot read X's occupant list `[D9,D11]`.
- [ ] B `ssh guest@<A's LAN IP>` lands a guest session on A's workstation; `su root` then elevates;
      downstream read/write/su behave exactly as the shipped cross-player paths `[D10]`.
- [ ] A reads `Accepted`/`Failed password for guest from <B's LAN IP>` (and the `su` line) on its
      workstation — source = B's **LAN IP**, not B's home public IP `[D12]`.
- [ ] An occupied ESSID can surface in another player's `airdump`; each scan is a fresh roll; a reload
      never kicks a connected player offline `[D2,D4]`.
- [ ] **The shipped WAN cross-player loop still passes** after the `assignHomeNetwork` subnet reseed
      (regression gate — see Slice 7.1).

## Testing approach

- **Unit (vitest)** for all `core/` logic: `generateWifi`, `assignHomeNetwork`, occupancy resolve, the
  same-LAN connect handler, the LAN-IP source resolver, the nmap occupant-merge.
- **Server wire-checks** (`scripts/testCrossPlayer*.ts` lineage) for the signed round-trips that `api/`
  cannot typecheck locally (`project_v2_api_not_typechecked_locally`): occupancy write/read, same-LAN
  connect, trace append.
- **agent-browser E2E** vs `vercel dev` (3100) + Supabase, reserved for the full two-identity loop at the
  end (`feedback_e2e_scope`; playbook `v2/docs/cross-player-e2e-playbook.md`).
- v2 UI tests are jsdom + `@solidjs/testing-library` (NOT Browser Mode). Format gate = `npm run lint`;
  type gate = `npm run typecheck`.

---

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR; load `tdd`, `testing`, `mutation-testing`,
`refactoring` before code. Each slice is its own PR. Some (marked) may sub-split a/b like Story 5.1.

### Slice 7.1 — An ESSID is the same network for everyone (shared subnet + crackable identity)

**Decisions**: `[D3]` (ESSID-deterministic crackability + password) + `[D5]` (ESSID-shared subnet, per-key
host octet).
**Value**: Two players who connect to the same ESSID provably share one network identity — the addressing
precondition every later slice stands on.
**Actor / Trigger / Outcome**: A player / `aircrack` + `nmcli status` / a given ESSID yields the same
crackable password and the same `/24` for any identity (distinct host octets).
**Path**: `core/generation/generateWifi.ts` (seed crackability + password from the **ESSID**, not the
player PRNG — `bssidFromEssid` is already ESSID-seeded) → `core/network/homeNetwork.ts`
`assignHomeNetwork` (subnet seed `home-${pubkey}-${essid}` → **ESSID-only**; keep per-`(key,essid)` host
octet). Per-player/per-scan keeps only *which* subset shows + power/channel.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:
- `generateWifi(keyA)` and `generateWifi(keyB)` both expose ESSID X (when drawn) as crackable with an
  **identical** password; a noise-catalog ESSID is never crackable for anyone.
- `assignHomeNetwork(keyA, X).localIp` and `assignHomeNetwork(keyB, X).localIp` share the **same first
  three octets**, with host octets in `2..254`.
- **Regression**: the shipped WAN cross-player loop is still green — run `scripts/testCrossPlayerRouter.ts`
  + `scripts/testRouterBrick.ts` (they exercise `workstationPortResolver` / `materializeWorkstationFs`
  LAN-IP lookups that depend on `assignHomeNetwork`). Fix any forward→ws drift caused by the reseed.
**RED**: golden tests pinning (a) same-ESSID-same-password across two keys, (b) same-subnet/different-octet
across two keys, (c) noise stays uncrackable. Mutator watch (`resources/mutator-rules.md`): the seed-string
construction (string-literal mutators), the octet-range bounds (`2`/`254` boundary + arithmetic), the
crackable/noise branch (conditional-boundary).
**GREEN**: re-seed the two generators off the ESSID; minimal change.
**MUTATE / KILL MUTANTS**: target the seed strings, octet bounds, and pool-selection picks.
**REFACTOR**: factor a shared `essidSeed(essid)` only if both sites genuinely share it; don't invent an
abstraction (`functional`).
**Done when**: ACs met, shipped-loop regression green, mutation report reviewed, commit approved.
**Note**: may sub-split **7.1a** (`assignHomeNetwork` subnet) / **7.1b** (`generateWifi` identity) if the
regression surface makes one PR unwieldy. **BOTH SHIPPED** (7.1a #292, 7.1b #293).

### Slice 7.2.0 — Real Supabase nonce store, replay protection on every signed endpoint (horizontal unblock)

**Why before 7.2**: 7.2/7.5 add new signed cross-player writes; the user chose to **build the real nonce
store now** (over ship-first `noopNonceStore`) and roll it out to **all** signed endpoints. Backing =
**Supabase table** (no new service); rollout = **all endpoints**. Horizontal but justified: it unblocks
7.2's secure writes and is independently verifiable (replay a signed envelope → rejected).
**Key facts** (verified in code): `verifySignedRequest` (`core/signedRequest/verify.ts`) already takes a
`NonceStore = (nonce) => Promise<{fresh}>` and checks the **timestamp window (`REPLAY_WINDOW_MS`) BEFORE**
the nonce — so the table only needs to retain nonces *within* that window (cleanup = delete older rows).
Every api/ handler (`api/patches.ts` ×5 actions, `api/network.ts`, `api/sessions.ts`) currently defines a
local `noopNonceStore` and passes it at each `verifySignedRequest` call site — the retrofit is a per-site
swap. The nonce is already in the envelope; **no envelope/schema change**.

#### Slice 7.2.0a — Supabase nonce store, proven on the patches endpoint (walking skeleton)
**Value**: A real replay-reject on the busiest signed endpoint — the novel path (migration + adapter +
atomic dedup) proven end-to-end before mechanical widening.
**Actor / Trigger / Outcome**: Any signed client / replays a `patches` envelope (same nonce) / first call
succeeds, the replay is rejected `replay` (403/401) — a fresh nonce still succeeds.
**Path**: migration `nonces` (`nonce text primary key`, `created_at timestamptz default now()`); RLS
service-role-only like the other tables. `adapters/nonceStore.ts`
`createSupabaseNonceStore(supabase): NonceStore` = `INSERT … ON CONFLICT (nonce) DO NOTHING` →
`fresh = (inserted rowcount === 1)`. Wire it into `api/patches.ts` (replace the local `noopNonceStore` at
all 5 handler call sites; construct the store once from the request's service-role client).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`; `hexagonal-architecture`.
**Acceptance criteria**:
- Two signed `upsertPatch` envelopes with the **same nonce**: first → 200, second → rejected (`replay`);
  the second writes **no** row.
- A signed envelope with a **fresh** nonce still succeeds (no false-positive dedup).
- `core/` keeps the `NonceStore` type only; the Supabase impl is in `adapters/`; `api/` stays thin.
- Verified by a new wire-check `scripts/testNonceReplay.ts` (live Supabase): replay-rejected + fresh-ok.
**RED**: the dedup CONTRACT is DB-enforced (unique constraint), so the primary proof is the wire-check
(`project_v2_api_not_typechecked_locally`). Any pure mapping logic (`inserted → fresh`) gets a thin unit
test with an injected fake (first call fresh; repeat not fresh). Mutator watch: the `inserted === 1` /
rowcount→`fresh` mapping (equality/boolean), the ON CONFLICT clause (verified by the wire-check, not unit).
**GREEN**: migration + adapter + patches wiring.
**MUTATE / KILL MUTANTS**: target the rowcount→`fresh` mapping unit; DB dedup verified by the wire-check.
**REFACTOR**: keep `api/` thin; the adapter is the only Supabase touch-point.
**Done when**: ACs met, `testNonceReplay.ts` green vs live Supabase, mutation report reviewed, commit approved.

#### Slice 7.2.0b — Retrofit the remaining signed endpoints + bound the table
**Value**: Replay protection is game-wide (only meaningful if everywhere), and the `nonces` table can't grow
unbounded.
**Actor / Trigger / Outcome**: Any signed client / replays a `network`/`sessions` envelope / rejected
`replay`, same as patches.
**Path**: swap `noopNonceStore` → `createSupabaseNonceStore` in `api/network.ts` + `api/sessions.ts`
(every call site). Cleanup: delete `nonces` rows older than `REPLAY_WINDOW_MS` (a Vercel cron hitting a
tiny cleanup endpoint, or pg_cron) — decide the mechanism at slice start; lazy/periodic is fine for ship.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:
- Replaying a `registerNetwork` (network) and a session-create (sessions) envelope is rejected `replay`;
  fresh nonces still succeed (extend `testNonceReplay.ts` or add per-endpoint checks).
- No api/ handler still references `noopNonceStore` (grep-clean).
- Expired nonces are pruned (cleanup mechanism in place + a note/verification of the bound).
**RED / GREEN / MUTATE / REFACTOR**: per-endpoint wire-checks (DB-bound), thin per-site swap; cleanup
verified by the prune query / wire-check.
**Done when**: ACs met, wire-checks green, `noopNonceStore` gone, mutation report reviewed, commit approved.

### Slice 7.2 — Occupancy is persisted on join/leave and readable by a fellow occupant (server skeleton)

**Decisions**: `[D7]` (new ESSID-keyed table) + `[D8]` (connect upsert / disconnect delete) + `[D11]`
(occupant-gated read).
**Value**: The server can answer "who else is on ESSID X?" to a verified occupant — the irreducible
cross-player state the whole story renders. **Walking skeleton (server half).**
**Actor / Trigger / Outcome**: Identity B (signed) / occupant-list request for X / receives A's
`workstation_machine_id` + LAN IP iff B is itself a live occupant of X; non-occupant → denied.
**Path**: migration `home_network_occupants` (PK `(essid, owner_key)`); occupancy upsert wired into the
join round-trip (alongside/within `handleRegisterNetwork`, server-stamping `owner_key` from the verified
pubkey, `workstation_machine_id` + non-derivable auth/display fields; LAN IP + hostname **re-derived**
from `assignHomeNetwork(owner_key, essid)`, not stored — `minimize-api-projections`); a delete wired into
disconnect (new fire-and-forget signed call — `feedback_react_context_server_integration`); a signed
occupant-list read handler gated on the caller's own live occupancy row; `core/` resolve fn + `api/` +
`adapters/` thin wiring.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`; consult
`hexagonal-architecture` for the core/adapter/api seam.
**Acceptance criteria**:
- After A's signed join to X, an occupancy row exists for `(X, ownerA)`; after A's signed disconnect it is
  gone.
- B's signed occupant-read for X (B a live occupant) returns A's `workstation_machine_id` + re-derived LAN
  IP, **excluding B itself**; a caller with no occupancy row for X is denied; the payload rejects a
  client-supplied `owner_key`/LAN IP (server-derived only).
- Verified by a new wire-check `scripts/testSameLanOccupancy.ts` (two identities, live Supabase).
**RED**: unit tests on the pure resolve (occupant filter, self-exclusion, gate) with an injected store;
schema-rejection test for client-claimed fields. Mutator watch: the self-exclusion predicate
(`owner_key !== caller` — conditional/equality mutators), the gate boolean, the empty-list case.
**GREEN**: minimal table + handlers + resolve.
**MUTATE / KILL MUTANTS**: focus the resolve predicates + gate; `api/` runtime correctness (columns/RLS)
verified by the wire-check, not unit mutation (`project_v2_api_not_typechecked_locally`).
**REFACTOR**: keep `api/` thin, logic in `core/`.
**Done when**: ACs met, wire-check passes against live Supabase, mutation report reviewed, commit approved.
**Note**: may sub-split **7.2a** (table + upsert + read, wire-checked) / **7.2b** (disconnect delete).

### Slice 7.3 — B `nmap <subnet>` sees A's workstation as an occupant (client merge)

**Decisions**: `[D9]` (per-player NPCs + occupant merge, occupant wins on octet collision, self excluded).
**Value**: The headline cross-player observable — a player sees a real other player on their LAN.
**Walking skeleton (client half).**
**Actor / Trigger / Outcome**: B (connected to X) / `nmap <subnet>` (and `nmap <A's LAN IP>`) / A's
workstation appears as a host at A's LAN IP, merged over B's generated NPC siblings.
**Path**: `nmap` (`core/commands/nmap.ts`) gains a server fetch of the current ESSID's occupants → merge
into the generated `generateHomeLan` host list: drop any NPC whose octet collides with a real occupant,
add occupants, exclude self; render. A single-LAN-IP scan resolves a real occupant when present.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:
- With A an occupant of X, B's `nmap <subnet>` lists A's workstation at A's LAN IP; B is not listed as an
  occupant of its own scan.
- On an octet collision (NPC at A's octet) the **real occupant** is shown, the NPC dropped.
- A no-occupant / offline A does not appear (consequence of `[D8]`).
**RED**: unit tests on the merge fn (collision → occupant wins; self excluded; empty occupant list →
unchanged NPC view). Mutator watch: the collision-dedupe key (octet equality), the self-exclusion filter
(`functional_refactor_noop_filter_equivalent` may apply — decide per loop), the merge order.
**GREEN**: minimal merge + fetch wiring.
**MUTATE / KILL MUTANTS**: target the dedupe/collision predicate and self-exclusion.
**REFACTOR**: assess; reuse the LAN-host shape from `generateHomeLan`.
**Done when**: ACs met (jsdom + `@solidjs/testing-library` for the nmap render), mutation report reviewed,
commit approved. (Closes the walking skeleton with 7.2.)

### Slice 7.4 — B `ssh guest@<A's LAN IP>` lands on A's workstation (same-LAN connect front door)

**Decisions**: `[D10]` (new thin same-LAN handler) + `[D11]` (connect gated on occupancy).
**Value**: The payoff — B operates on A's real box over the LAN, unlocking the entire reused cross-player
stack (read filter, write L1/L2, `su`).
**Actor / Trigger / Outcome**: B (occupant of X) / `ssh guest@<A's LAN IP>` / a guest session on A's
`workstation_machine_id`; `ls`/`cat` (read filter) and `su root` (elevation) then behave as shipped.
**Path**: new server handler — resolve `(B's verified current ESSID, target LAN IP)` → occupant's
`workstation_machine_id` via the occupancy table, validate B is a live occupant, auth the typed password
against A's workstation `/etc/passwd` **directly** (no router/NAT/`machineServing`/forward), insert the
session on `workstation_machine_id`. Client `ssh.ts` gains a "private LAN IP that belongs to an occupant"
branch — distinct from the `isPublicIp` cross-player branch (`ssh.ts:155`) and the own-LAN
NPC-regeneration branch; reachability comes from the occupant fetch (7.3). Downstream
`resolveCrossPlayerFs` / read filter / write L1+L2 / `su` reuse unchanged (all `machine_id`-keyed).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:
- B `ssh guest@<A's LAN IP>` → guest session on A's workstation; B `cat`s a file A created (tier-2 read
  filter), then `su root` elevates and reads `/etc/passwd` (existing su path).
- A caller who is not a live occupant of X is refused before any password check; an unknown LAN IP (no
  occupant) → `No route to host`; wrong password → `Permission denied`.
- A bricked / dark A behaves per the existing `canBoot` gate (reused).
**RED**: unit tests on the pure resolve+auth (occupant lookup, occupancy gate, passwd check, machine_id
landing) with injected deps; failure-path tests (no occupant, bad pw, non-occupant caller). Mutator watch:
the occupancy gate, the LAN-IP→occupant match, the auth outcome branch, the session target id.
**GREEN**: minimal handler + client branch.
**MUTATE / KILL MUTANTS**: target the gate + match + auth branches.
**REFACTOR**: factor shared occupant-resolve with 7.2's resolve if it removes duplication, not for its own
sake.
**Done when**: ACs met, wire-check `scripts/testSameLanConnect.ts` (two identities) passes, mutation report
reviewed, commit approved.
**Note**: may sub-split **7.4a** (server handler + wire-check) / **7.4b** (client `ssh.ts` branch + live).

### Slice 7.5 — Same-LAN scan/connect/su leave a trace with a LAN-IP source

**Decisions**: `[D12]` (same-LAN traces, LAN-IP source).
**Value**: The defender half — A reads who touched its box over the LAN, attributed to B's LAN IP.
**Actor / Trigger / Outcome**: A (or a 3rd occupant) / `cat /var/log/{auth,kern}.log` after B acts /
sees `Accepted`/`Failed password for guest from <B's LAN IP>` and the `su` line.
**Path**: a same-LAN source-IP resolver — sibling of `resolveCrossPlayerSourceIp`
(`core/logging/crossPlayerSourceIp.ts`) — returning `assignHomeNetwork(B_ownerKey, essid).localIp`
(server-derived from B's verified pubkey + ESSID). Wire it into the same-LAN connect handler (7.4) and the
same-LAN nmap-scan path for owner-keyed `appendMachineLog` writes (reuse `formatSshdAuthLine` /
`formatSuAuthLine` / `formatNmapScanAggregate`, all shipped). `su` lines stay IP-less.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:
- After B `ssh guest@<A's LAN IP>` (success + a wrong-password attempt), A reads
  `Accepted`/`Failed password for guest from <B's LAN IP>` on its workstation `auth.log` — source is B's
  **LAN IP**, never B's home public IP, never a client-claimed value.
- After B `su root` on A, A reads the `su` line (no source IP).
- A trace line is owner-keyed (`writer_key = ownerA`) so multiple actors' lines accrete into one row
  (Story-6 keystone reused); tier-3 (no-session) cannot read the logs.
**RED**: unit test the LAN-IP source resolver (derives from key+essid; degrades to `unknown` on missing
row); assert same-LAN handlers pass the LAN-IP resolver, not the public one. Mutator watch: the resolver's
data/error branch, the IP-vs-no-IP per line type.
**GREEN**: minimal resolver + wiring.
**MUTATE / KILL MUTANTS**: target the resolver branch + the per-handler source selection.
**REFACTOR**: keep the public vs LAN resolver split clean (one source-derivation concept, two vantages).
**Done when**: ACs met, wire-check `scripts/testSameLanTrace.ts` passes, mutation report reviewed, commit
approved.

### Slice 7.6 — Occupied ESSIDs surface in scans; each scan is a fresh roll (organic discovery)

**Decisions**: `[D2]` (occupancy-injected discovery) + `[D4]` (re-roll per scan + `restoreConnection`
decouple).
**Value**: Discovery becomes organic — a player can stumble onto another player's live network by
re-scanning ("relocating"), without dev-wiring the ESSID.
**Actor / Trigger / Outcome**: B / `airmon` + `airdump` (disconnected) / a fresh random AP list each scan
that **can include** currently-occupied ESSIDs (name-only); reload never drops a connected player.
**Path**: airdump/`generateWifi` re-rolls per scan (base subset + a random subset of occupied ESSIDs read
from the occupancy table — **global but name-only**, `[D11]`); `ui/connectionPersistence.ts:55`
`restoreConnection` re-derives the connected BSSID via `bssidFromEssid(essid)` so a re-rolled list can't
kick a connected player offline. Per-scan variation needs a varying seed (scan nonce/counter — note
`Math.random`/`Date.now` constraints; thread a scan index/nonce through the seam).
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria**:
- With A occupying X, B's `airdump` can surface X (injected); injection exposes only the ESSID name (no
  occupant identity); injected entries render as normal crackable APs (consistent with `[D3]`).
- Two consecutive scans can differ (fresh roll); the injection read does not require B to be an occupant.
- A connected player who reloads stays connected even when the re-rolled scan list omits the connected
  ESSID (BSSID re-derived from ESSID).
**RED**: unit tests — injection includes a sample of occupied ESSIDs; injected entries are crackable with
the ESSID-seeded password; `restoreConnection` returns connected when the ESSID is absent from the list.
Mutator watch: the inject-sample size/bounds, the re-derive path in `restoreConnection`, the
list-membership removal.
**GREEN**: minimal injection + the rehydration decouple.
**MUTATE / KILL MUTANTS**: target the sample bounds + the rehydration branch (was the bug-prone coupling).
**REFACTOR**: assess; keep the seam shaped so density (deferred) can later scale the sample.
**Done when**: ACs met, full two-identity **agent-browser E2E** confirms the organic loop
(A connects X → B scans, sees X, cracks, joins, `nmap` sees A, `ssh`es A, A reads the trace), mutation
report reviewed, commit approved.

---

## Pre-PR Quality Gate (every slice)

1. `mutation-testing` skill — report reviewed (don't run Stryker while `vercel dev` is up —
   `project_v2_stryker_devserver_contention`).
2. `refactoring` assessment.
3. `npm run typecheck` (`tsc -b`, covers `api/`+`scripts/`) + `npm run lint` (no Prettier in v2 —
   `project_v2_no_prettier_format_gate`).
4. Server round-trips verified by the slice's wire-check (api/ isn't typechecked locally).
5. Bump version in `package.json` + `package-lock.json` on the story capstone (per user preference).

## Nonce/rate-limit store — RESOLVED (2026-06-21)

- **Build the real nonce store now** (over ship-first `noopNonceStore`). Backing = **Supabase table** (no
  new service); rollout = **all signed endpoints**. Sequenced as **Slice 7.2.0a/0b** above, BEFORE 7.2.
  (Replaces Story 6's parking-lot deferral.)

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
