# Plan: Story 7 — Same-WiFi Shared-LAN Occupancy (v2)

**Branch**: per-slice PRs (`feat/v2-story-7-...`), squash-merged (`feedback_pr_squash_merge_convention`)
**Status**: Active — plan drafted, **awaiting approval before any code**.

## ▶ Pick-up status (resume here)

`grill-me` ✅ · `planning` ✅. **7.1 split into 7.1a/7.1b (approved).**

**Slice 7.1a ✅ SHIPPED** — ESSID-seeded `/24` (`assignHomeNetwork` subnet seed → `home-subnet-${essid}`;
host octet stays per-`(key,essid)`). RED→GREEN→MUTATE **100% (7/7 killed)**→REFACTOR(none). Full v2 suite
green (1523), typecheck+lint clean. Golden re-pins: `generateHomeLan`/`nmap`/`nmapScan` tests (subnet
`188→29`, self `154→188`, fresh `ROUTER_PORTS_IDENTITY`). **AC#5 live regression GREEN** —
`testCrossPlayerRouter` 8/8 + `testRouterBrick` 9/9 vs `vercel dev`+Supabase.

**Next action**: start **Slice 7.1b** — `generateWifi` ESSID-derived password (`[D3]`), so the same ESSID
cracks to the same password for everyone. Present 7.1b's AC for confirmation *before* code. Watch: its
only ripple is re-pinning the `generateWifi` golden snapshot (removing the per-player password draw shifts
the PRNG sequence) + possibly reseeding `SEED_HIDDEN`; verify `nmcli` client-side pw validation stays
consistent.

**One decision still open (for 7.2, not 7.1):**
- **Nonce/rate-limit store** — keep `noopNonceStore` (ship-first) for the new occupancy + same-LAN
  failed-auth trace writes, or build the real store first? (See "Open question to confirm before 7.2".)

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
regression surface makes one PR unwieldy.

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

## Open question to confirm before 7.2

- **Nonce/rate-limit store** — Story 6's parking-lot dependency (unauthenticated-tier cross-player writes).
  Slice 7.2/7.5 add new signed cross-player writes (occupancy + same-LAN failed-auth traces). Confirm
  whether the real nonce store is required here or stays the `noopNonceStore` for the demo (ship-first).

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
