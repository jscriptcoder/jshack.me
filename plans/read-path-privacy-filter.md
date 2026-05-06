# Plan: Read-Path Privacy Filter (L2-for-Reads)

**Branch**: `read-path-privacy-filter`
**Status**: Active
**Tracks**: `project_read_path_privacy_gap.md` — closes the highest-impact open L2 gap (chunk #1 in the queued work list as of 2026-05-06).

## Goal

Server-side filter `listPatchesForMachines` so the wire payload never exposes content the requester wouldn't be allowed to read in-game — for any machine type (workstations, home-network, world-network, mission), without a session on that machine, only the externally-observable allowlist is returned.

## Background

L2 currently protects WRITES (`upsertPatch` / `removePatch`) but reads (`listPatchesForMachines`) return every patch for the requested machine_ids with no per-path filtering. Cross-player visibility (PR #80/#81) makes machine_ids discoverable on the same LAN; combined, anyone can sign a request and pull `/root/*`, wallet keys, `/etc/passwd` hashes (passwords live inline — see `feedback_no_etc_shadow.md`), `~/.bash_history` from any machine they can name. The client-side perm walker is theatre — Burp/curl/forged envelopes bypass it.

**Wallet-defense premise breaks**: gameplay requires cracking root before stealing the wallet key; today the wallet is readable without cracking by anyone on the same LAN.

**Universal coverage**: the filter applies to every machine the endpoint can return — the rule is machine-type-agnostic. Tier 1 (owner) is a workstation-only bypass; tiers 2 and 3 apply uniformly. Without this, an attacker can read NPC `/etc/passwd` hashes from any home-network or mission box without cracking it, then crack offline → escalation path that bypasses the "must crack root first" gameplay loop via a non-workstation read.

## Three-tier rule (locked in 2026-05-05, refined 2026-05-06)

For each `(machine_id, path)` row returned from the SQL select, apply the first matching rule:

1. **Owner** (workstation_id suffix matches requester's `player_key` suffix) → return. Workstation-only — never fires for other players' workstations, home-net, world-net, or mission machines. Mirrors `isOwnWorkstationOnServer` (already in `handler.ts:155`).
2. **Has active session on the machine** → walk read perms via `permissionWalker.canRead` with target = path, parent chain = ancestors. Drop if denied. Applies to any machine type.
3. **No session** → return only if path matches the externally-observable allowlist. **Default-deny** (single `if (!matchesAllowlist) drop` check, no parallel denylist).

## Allowlist (no-session readable, machine-type-agnostic)

```
/var/run/*.pid           # daemon liveness — port open/closed
/etc/iptables/rules.v4   # gateway NAT rules
/etc/snmp/snmpd.conf     # SNMP firewall + ACL overrides
/etc/switch/acl.conf     # switch ACL deny rules
/var/www/**              # HTTP-served content
/var/lib/dpkg/status     # service versions (nmap -sV reads via applyVersionOverlay)
```

**Tripwire to leave inline in the matcher**: `/var/lib/dpkg/status` leaks the full installed package list — fine today (port-bound CVEs only); if off-port CVEs are ever added, narrow to running-service entries. Document next to the constant.

## Acceptance Criteria

Behaviour-driven, observable from outside the system:

- [ ] A player WITHOUT a session on machine X can only retrieve patches for paths matching the allowlist when calling `listPatchesForMachines([X])`. Forging via curl with a valid signed envelope returns the same filtered set — no DevTools-only filtering.
- [ ] A player WITH a session on machine X retrieves rows whose path passes `canRead` for their session's `userType`, with the full ancestor chain consulted for traverse perms.
- [ ] The owner of machine X (workstation) retrieves every row for X regardless of perms — own-box bypass intact, no behaviour regression for the player's own gameplay.
- [ ] Universal coverage verified: same rules apply when X is a home-network NPC machine, a world-network machine (findit.io / playground), or a mission machine — no per-machine-type special-casing.
- [ ] Wire-payload smoke: a forged `listPatchesForMachines` envelope as non-owner, no-session, secret-path target returns a response body that does NOT contain the secret content. (Per `feedback_e2e_test_new_primitives.md` — must verify the wire, not just unit-mock the adapter.)
- [ ] Two-browser cross-player smoke: Player B cannot read `/root/.notes` or wallet key files on Player A's workstation. Browser A's own gameplay remains unchanged.
- [ ] No regression on existing read-path tests: rate limiting, signature verification, machine_ids forwarding, player_key derivation all unchanged.

## Steps

Each step follows RED-GREEN-MUTATE-KILL-REFACTOR per project CLAUDE.md.

### Step 1: Allowlist constant + path matcher (pure)

**RED**: New file `src/patchRegistry/readAllowlist.test.ts`. Tests describe matching behaviour:

> "Daemon PID files match `/var/run/*.pid`"
> "Single-segment wildcard does NOT cross slash boundaries (e.g., `/var/run/sub/dir.pid` does not match `/var/run/*.pid`)"
> "Recursive `**` matches any depth under prefix (`/var/www/index.html`, `/var/www/app/static/main.js`)"
> "Recursive `**` does NOT escape its prefix (`/var/wwwOTHER/foo` does not match `/var/www/**`)"
> "Exact paths only match exactly (`/etc/iptables/rules.v4` matches; `/etc/iptables/rules.v4.bak` does not)"
> "Paths not in any allowlist entry are denied"
> "`/etc/passwd`, `/root/.notes`, `/home/alice/.bashrc`, wallet key files all fall through default-deny"

**GREEN**: New file `src/patchRegistry/readAllowlist.ts`:

```ts
export const READ_ALLOWLIST: readonly string[] = [
  '/var/run/*.pid',
  '/etc/iptables/rules.v4',
  '/etc/snmp/snmpd.conf',
  '/etc/switch/acl.conf',
  '/var/www/**',
  '/var/lib/dpkg/status',
];
// Tripwire: dpkg/status is currently safe (port-bound CVEs only).
// If off-port CVEs are ever added, narrow to running-service entries.

export const matchesReadAllowlist = (path: string, allowlist = READ_ALLOWLIST): boolean => {
  // compile each pattern → regex once; any match returns true.
};
```

Compile pattern → regex once (escape literals; `*` → `[^/]*`; `**` → `.*`).

**MUTATE**: Run `mutation-testing` skill on `readAllowlist.ts`. Likely surviving mutants:

- Glob char swap (`*` ↔ `**`) — ensure tests cover both segment-bound and recursive cases
- Anchor swap (`^` / `$` removal) — ensure prefix-extension cases (`/var/wwwOTHER/foo`) are tested
- `for...of` → `forEach` early-return change
- Empty-allowlist branch (if any defaulting logic)

**KILL MUTANTS**: Add boundary tests for each survivor.

**REFACTOR**: Assess. Pattern compilation as a separate pure helper if matching grows.

**Done when**: All tests green; mutation score ≥ 90% on the matcher.

### Step 2: Path-ancestor builder (pure)

**RED**: New file `src/patchRegistry/pathAncestors.test.ts`:

> "Returns ancestors root-to-immediate-parent for nested paths (`/home/alice/.ssh/id_rsa` → `['/', '/home', '/home/alice', '/home/alice/.ssh']`)"
> "Top-level path returns root only (`/etc` → `['/']`)"
> "Filesystem root returns empty chain (`/` → `[]`)"
> "Trailing slash is normalised (`/etc/` and `/etc` produce equivalent chains)"
> "Double slashes are collapsed (`/etc//foo` treated as `/etc/foo`)"

**GREEN**: New file `src/patchRegistry/pathAncestors.ts`:

```ts
export const ancestorPaths = (path: string): readonly string[] => {
  // Normalise, split, accumulate.
};
```

**MUTATE**: Mutation testing. Likely survivors:

- Off-by-one on chain length (`includes target` vs `excludes target`)
- Reverse vs forward order (walker requires root-to-immediate-parent ordering — load-bearing)
- Empty-string vs `'/'` handling for the root case

**KILL MUTANTS**: Add boundary tests.

**REFACTOR**: Assess.

**Done when**: Tests green; mutation score ≥ 90%; the chain order matches `permissionWalker.PermissionInput.parentChain` (root-to-immediate-parent, target excluded).

### Step 3: Per-row filter (pure, composes Steps 1-2 + walker)

**RED**: New file `src/patchRegistry/readFilter.test.ts`. Tests describe the three-tier behaviour:

> "Owner of the machine receives every row regardless of perms (tier 1)"
> "Owner check is workstation-only — non-owner with workstation_id-shaped non-match still hits tier 2/3"
> "With session: row passes when walker allows for the session's userType + parent chain"
> "With session: row drops when walker denies (parent execute missing)"
> "With session: row drops when walker denies (target read missing)"
> "With session as root: every row passes (walker root bypass)"
> "With session: row with no machine_filesystems entry permits (mirrors L2 write leaf-only fallback — documented)"
> "No session: only allowlist paths pass"
> "No session: `/etc/passwd`, `/root/*`, `/home/<user>/.bashrc`, wallet key paths all drop"
> "Universal coverage: same rules apply for workstation, home-net, world-net, mission machine_id shapes (parametrised test)"

**GREEN**: New file `src/patchRegistry/readFilter.ts`:

```ts
import { canRead } from '../filesystem/permissionWalker.js';
import { matchesReadAllowlist } from './readAllowlist.js';
import { ancestorPaths } from './pathAncestors.js';
import { deriveHostnameSuffix } from '../homeNetworks/homeNetworkHelpers.js';
import type { PatchSummary, FilePermissions } from './types.js';
import type { Credentials } from '../sessionRegistry/types.js';

export type FsLookup = (machine_id: string, path: string) => FilePermissions | null;
export type SessionLookup = (machine_id: string) => Credentials | null;

const isOwnWorkstation = (machine_id: string, playerKey: string): boolean => {
  const expectedSuffix = deriveHostnameSuffix(`ed25519:${playerKey}`);
  return machine_id.endsWith(`-${expectedSuffix}`);
};

export const isRowReadable = (
  row: PatchSummary,
  requesterPlayerKey: string,
  sessionLookup: SessionLookup,
  fsLookup: FsLookup,
): boolean => {
  if (isOwnWorkstation(row.machine_id, requesterPlayerKey)) return true;
  const credentials = sessionLookup(row.machine_id);
  if (credentials !== null) {
    const target = fsLookup(row.machine_id, row.path);
    if (target === null) return true;  // leaf-only fallback parity with L2 writes
    const parentChain = ancestorPaths(row.path)
      .map((p) => fsLookup(row.machine_id, p))
      .filter((perms): perms is FilePermissions => perms !== null);
    return canRead({ userType: credentials.userType, target, parentChain }).allowed;
  }
  return matchesReadAllowlist(row.path);
};

export const filterReadablePatches = (
  rows: readonly PatchSummary[],
  requesterPlayerKey: string,
  sessionLookup: SessionLookup,
  fsLookup: FsLookup,
): readonly PatchSummary[] =>
  rows.filter((row) => isRowReadable(row, requesterPlayerKey, sessionLookup, fsLookup));
```

`SessionLookup` and `FsLookup` are pure injection points — Step 4 supplies them via batched DB queries; Step 3's tests use in-memory maps.

**MUTATE**: Run `mutation-testing` skill. High-impact survivors expected:

- Tier dispatch order swap (owner check before/after session check)
- `null !== credentials` boundary (fall-through to allowlist when session exists but is null)
- Walker-allowed boolean inversion
- Default-deny vs default-allow on the no-session branch
- Duplicate-call mutants on `fsLookup` (target vs ancestor)

**KILL MUTANTS**: Add boundary tests; the tier-dispatch-order mutant is critical (an "owner check after session" mutation could let an off-LAN attacker with a forged session fall through differently — write a property-style test pinning tier order).

**REFACTOR**: Assess. The two adapter-injection points (`sessionLookup`, `fsLookup`) keep this file pure; if they grow, extract a `ReadFilterContext` type.

**Done when**: All tests green; mutation score ≥ 90%; the leaf-only-fallback test has an inline comment marking it as a tripwire.

---

**END OF PR 1.** Ship Steps 1-3 as PR 1. No behaviour change yet — pure helpers, no handler integration. Reviewer can verify the filter logic in isolation.

---

### Step 4: Bulk FS adapter — `findMachineFsBatch`

**RED**: New file `src/patchRegistry/supabaseFindMachineFsBatch.test.ts`. Tests describe adapter shape:

> "Returns rows grouped per (machine_id, path) for the requested machine_ids"
> "Empty machine_ids returns empty result"
> "DB error returns ok: false"
> "Strict zod validation — bad permissions JSONB → ok: false (defense-in-depth)"
> "Empty result for valid query returns ok: true with empty rows"

**GREEN**: New file `src/patchRegistry/supabaseFindMachineFsBatch.ts`:

```ts
export type FindMachineFsBatchParams = { readonly machine_ids: ReadonlyArray<string> };
export type MachineFsRow = {
  readonly machine_id: string;
  readonly path: string;
  readonly owner: UserType;
  readonly permissions: FilePermissions;
};
export type FindMachineFsBatchResult =
  | { readonly ok: true; readonly rows: ReadonlyArray<MachineFsRow> }
  | { readonly ok: false };

export const createSupabaseFindMachineFsBatch =
  (query: BatchQueryFn) =>
  async (params: FindMachineFsBatchParams): Promise<FindMachineFsBatchResult> => {
    if (params.machine_ids.length === 0) return { ok: true, rows: [] };
    const { data, error } = await query(params);
    // ... strict parse, return.
  };
```

Single SQL call: `.from('machine_filesystems').select('machine_id, path, owner, permissions').in('machine_id', [...machine_ids])`. Returns flat rows; the handler builds the Map<machine_id, Map<path, perms>> in JS for `fsLookup`.

**MUTATE**: Mutation testing. Survivors likely on the empty-input branch and the parse-failure handling.

**KILL MUTANTS**: Address.

**REFACTOR**: Assess.

**Done when**: Tests green against a fake query fn; api/patches.ts wires this in.

### Step 5: Bulk session adapter — `findActiveSessionsBatch`

**RED**: New file `src/sessionRegistry/supabaseFindActiveBatch.test.ts`:

> "Returns credentials per machine_id where the player has an active session"
> "Returns empty when player has no active session for any requested machine"
> "Empty machine_ids returns empty result"
> "DB error returns ok: false"
> "ended_at = null filter is enforced"

**GREEN**: New file `src/sessionRegistry/supabaseFindActiveBatch.ts`:

```ts
export type FindActiveSessionsBatchParams = {
  readonly player_key: string;
  readonly machine_ids: ReadonlyArray<string>;
};
export type FindActiveSessionsBatchResult =
  | { readonly ok: true; readonly sessionsByMachine: ReadonlyMap<string, Credentials> }
  | { readonly ok: false };
```

SQL: `.from('sessions').select('machine_id, credentials').eq('player_key', $key).in('machine_id', [...]).is('ended_at', null)`.

**MUTATE**: Mutation testing on the adapter.

**KILL MUTANTS**: Address.

**REFACTOR**: Assess.

**Done when**: Tests green against a fake query fn.

### Step 6: Wire filter into `handleListPatchesForMachines` + update existing tests

**RED**: Extend `src/patchRegistry/handler.test.ts` describe block "handlePatchesRequest — listPatchesForMachines":

New tests pinning the three-tier behaviour at the handler level:

> "Owner of the machine retrieves all patches (tier 1) — uses suffix-derived workstation_id"
> "Player with active session as user retrieves only walker-allowed paths (tier 2)"
> "Player with active session as guest retrieves a strict subset of what user retrieves (tier 2 walker)"
> "Player with active session as root retrieves everything (walker root bypass)"
> "Player with NO session retrieves only allowlist paths (tier 3)"
> "Player with NO session does NOT retrieve `/etc/passwd`, `/root/.notes`, `/home/alice/.bashrc` (default-deny)"
> "Mixed batch: player owns machine A, has session as guest on B, no session on C — receives all of A, walker-filtered subset of B, allowlist-only of C"
> "DB error from findMachineFsBatch returns 500 fs_lookup_failed"
> "DB error from findActiveSessionsBatch returns 500 session_lookup_failed"

Two existing tests need to be UPDATED — they currently assert "doesn't gate" and "doesn't invoke findMachineFs". Rewrite to: "doesn't run L1 gate (no `no_session` 403)" and "DOES invoke findMachineFsBatch + findActiveSessionsBatch for the filter, but failures map to 500 fs_lookup_failed / session_lookup_failed, not 403". Document the inversion in test comments — refer to this plan.

**GREEN**: Modify `src/patchRegistry/handler.ts`:

1. Extend `HandlerDeps` with `findMachineFsBatch` and `findActiveSessionsBatch`.
2. In `handleListPatchesForMachines`, after the SQL select succeeds, build the Maps and call `filterReadablePatches`. Collapse identical (machine_id, path) lookups via the Map. Return filtered patches.
3. Wire the new adapters in `api/patches.ts`.

```ts
const handleListPatchesForMachines = async (
  publicKey: string,
  payload: Extract<PatchesPayload, { action: 'listPatchesForMachines' }>,
  deps: HandlerDeps,
): Promise<HandlerResponse> => {
  const result = await deps.listPatchesForMachines({
    machine_ids: payload.machine_ids,
    player_key: publicKey,
  });
  if (!result.ok) return { status: 500, body: { error: 'query_failed' } };

  const sessionsRes = await deps.findActiveSessionsBatch({
    player_key: publicKey,
    machine_ids: payload.machine_ids,
  });
  if (!sessionsRes.ok) return { status: 500, body: { error: 'session_lookup_failed' } };

  const fsRes = await deps.findMachineFsBatch({ machine_ids: payload.machine_ids });
  if (!fsRes.ok) return { status: 500, body: { error: 'fs_lookup_failed' } };

  const fsByMachine = buildFsLookup(fsRes.rows);   // Map<machine_id, Map<path, perms>>
  const sessionLookup = (machine_id: string) => sessionsRes.sessionsByMachine.get(machine_id) ?? null;
  const fsLookup = (machine_id: string, path: string) =>
    fsByMachine.get(machine_id)?.get(path) ?? null;

  const filtered = filterReadablePatches(result.patches, publicKey, sessionLookup, fsLookup);
  return { status: 200, body: { patches: filtered } };
};
```

**MUTATE**: Mutation testing on `handleListPatchesForMachines`. Survivors expected on:

- Status code mapping (500 fs_lookup_failed vs 500 session_lookup_failed vs 500 query_failed)
- Order of failure-fast checks (FS error vs session error vs SQL error)
- Whether the filter is actually applied (mutate the `filterReadablePatches` call to identity → tests must catch)
- Empty-machine-ids edge case (still works through filter)

**KILL MUTANTS**: Address.

**REFACTOR**: Assess. `buildFsLookup` is small enough to inline; if it grows, lift to its own pure helper with tests.

**Done when**: All handler tests green; mutation score ≥ 90% on changed branches; `npm run build && npm run test:run && npm run lint` all green.

### Step 7: Wire-payload smoke script — `testReadPathPrivacy.ts`

**Why a smoke script**: Per `feedback_e2e_test_new_primitives.md`, unit tests verify layers in isolation; integration seams (signed envelope → server → DB → filter → response wire) drift silently. We've been bitten before. Smoke must inspect the actual HTTP response body.

**GREEN**: New script `scripts/testReadPathPrivacy.ts` mirroring `testL2Bypass.ts`:

Three scenarios against `vercel:dev`:

1. **No-session forge**: Two fresh keypairs A and B. Seed a patch on A's workstation at `/root/.notes` (root-owned, root-only-readable). Forge `listPatchesForMachines([A's workstation_id])` from B's identity (B has no session on A). Expected: HTTP 200; response `patches[]` does NOT contain `/root/.notes`.
2. **Session-as-guest forge**: Seed an active session row for B on A's workstation as `guest`. Forge same envelope. Expected: 200; response excludes `/root/.notes` (guest can't read root-owned files); response INCLUDES allowlist hits (e.g., `/var/run/sshd.pid` if seeded).
3. **Owner**: Forge from A. Expected: 200; response INCLUDES `/root/.notes` (tier 1 bypass).

Each scenario logs PASS/FAIL with assertion details. Self-cleaning so re-runnable. Add to CLAUDE.md debug-scripts section.

**Done when**: Script passes 3/3 against `vercel:dev`.

### Step 8: Two-browser smoke + memory + docs updates

**Two-browser smoke** (manual; per memory `feedback_e2e_scope.md` Playwright is for browser-only behaviours, not cross-player attack scenarios):

1. Browser A: NEW GAME, write a secret file: `echo "wallet seed" > /root/wallet-seed && chmod 600 /root/wallet-seed`.
2. Browser B: NEW GAME with different identity. Use DevTools Network tab to capture `listPatchesForMachines([A's workstation_id])` — verify response body excludes `/root/wallet-seed`'s content.
3. Browser B: try to crack into A normally (or seed a session manually for speed) as `guest`. Repeat the listPatchesForMachines fetch — verify still excluded.
4. Browser B: escalate to root on A. Repeat — verify `/root/wallet-seed` content is now in the response.

**Verification scripts**:

- `npx tsx scripts/testReadPathPrivacy.ts` → 3/3
- `npx tsx scripts/testL2Bypass.ts` → 3/3 (no regression on writes)
- `npx tsx scripts/testL2BypassWorkstation.ts` → 3/3 (no regression)

**Docs**:

- `CLAUDE.md` — add `testReadPathPrivacy.ts` to the debug-scripts section.
- `docs/architecture.md` — extend the L1/L2 section to note "L2 also gates reads via `listPatchesForMachines`; same walker module, three-tier rule (owner / session / no-session allowlist)".
- `src/patchRegistry/README.md` (if exists) — note the read filter.
- Optionally extend `docs/infrastructure-design.md` if the read path is documented there.

**Memory updates**:

- `project_read_path_privacy_gap.md` — mark CLOSED with date and PR refs; demote from queued #1.
- `project_l2_followups.md` — promote `/etc/passwd` userType validation to top of remaining queue (it had been #2 behind this).
- `project_cross_player_base_fs_gap.md` — note this prerequisite is now satisfied; the deferred chunk's read endpoint will reuse the filter.
- `MEMORY.md` — flip the "Active theme" + "Immediate queued work" entries.

**Cleanup**:

- Delete `plans/l2-own-workstation-backfill.md` (chunk #1b shipped via PR #117 — the file is stale).
- If `plans/` empty after this PR's plan deletion, remove the directory.

**Done when**: Smoke verified; verification scripts green; docs and memory updated.

---

**END OF PR 2.** Ship Steps 4-8 as PR 2. This is the chunk that changes user-observable behaviour and closes the privacy regression.

---

## PR Breakdown

Two PRs, each independently mergeable:

**PR 1 — Pure helpers (no behaviour change)**

Steps 1-3. Adds `readAllowlist.ts`, `pathAncestors.ts`, `readFilter.ts` plus tests. No handler integration, no new adapters wired. Reviewer can verify the filter logic against the locked-in design without worrying about integration regressions.

**PR 2 — Activation + smoke + docs**

Steps 4-8. Bulk adapters, handler wiring, smoke script, two-browser smoke, memory + docs updates. This is the chunk that flips the wire-level behaviour. The privacy regression closes when this lands.

If at PR 2 the handler-test rewrite + adapter work grows large, split out the smoke script + docs as PR 3.

## Pre-PR Quality Gate

Per project CLAUDE.md, before each PR:

1. `mutation-testing` skill on changed source files (Steps 1-3 helpers, Steps 4-5 adapters, Step 6 handler).
2. `refactoring` skill assessment.
3. `npm run build`, `npm run lint`, `npm run format`, `npm run test:run` all green.
4. For PR 2: `testReadPathPrivacy.ts` 3/3, `testL2Bypass.ts` 3/3 (regression check), `testL2BypassWorkstation.ts` 3/3, two-browser smoke verified.
5. DDD glossary unchanged (no new domain terms — owner/session/allowlist are existing).

## Risks

1. **Leaf-only fallback parity.** When a target row is missing in `machine_filesystems`, we permit (mirrors L2 writes). For machines covered by base-FS backfill (home/world/own-workstation since #117), every base-FS path has a row, so the fallback rarely fires. For mission machines (chunk blocked on `mission_instances`) the fallback fires more often. **Mitigation**: document in `readFilter.ts` next to the fallback that this is paired with the L2 write fallback; closing one closes the other. Mission-instances chunk will close it for missions.

2. **Allowlist drift over time.** As gameplay grows (new daemons, new public-protocol files), the allowlist may need entries added. **Mitigation**: keep the allowlist in one constant; a single edit + matcher tests pin it. The dpkg/status tripwire comment flags the off-port-CVE landmine.

3. **Performance: extra round-trips per read.** `listPatchesForMachines` previously made 1 DB call; the filter adds 2 (`findMachineFsBatch` + `findActiveSessionsBatch`). At cap (100 machine_ids) both are bounded and indexed. **Mitigation**: parallelise the two extra calls with `Promise.all`. Measure under load if it bites; today the read-path traffic is well under any concerning rate.

4. **Existing handler tests that asserted "no filtering" must be inverted.** Two tests in handler.test.ts explicitly check that `listPatchesForMachines does not invoke findMachineFs` and `does not invoke findActiveSession`. Both assertions become false. **Mitigation**: Step 6 explicitly calls out the rewrite and links it to this plan in the test comment.

5. **Realtime broadcast metadata leak (out of scope).** The `patches:<machine_id>` Realtime hint payload (`{ machine_id, originator_key }`) leaks "A is currently active on box X" without any patch fetch. Smaller leak (metadata, no content). Out of scope for this chunk; track separately if it materially bites.

6. **Cross-player base FS gap (deferred).** Memory `project_cross_player_base_fs_gap.md` notes the static base FS doesn't replicate cross-player. This filter is a hard prerequisite for that chunk's read endpoint when it eventually ships. **No work needed here**; just note in the memory update that the dependency is satisfied.

---

_Delete this file when the plan is complete. If `plans/` is empty afterward, delete the directory._
