# Plan: Story 5.2 — B attacks A's router (cross-player router takeover)

**Branches**: `feat/story-5_2_1-router-read` (Slice 1) · `feat/story-5_2_2-router-write` (Slice 2)
**Status**: Active

## Goal

A player (B) gains root on another player's (A's) router and rewrites A's NAT forwards,
changing A's exposure cross-player — the change persists to the shared router journal and a
fresh scan reflects it.

## Context (grounded in code — what's already shipped vs net-new)

Story 5.1 shipped the router as a real journal-backed machine. Re-grounding the codebase shows
two halves of 5.2 are **already done**:

- **Login (B → root on A's router):** `handleAuthCreateSessionPublic`
  (`core/sessions/authCreateSessionPublic.ts`) routes `ssh root@<A.publicIp>` (`:22`) to A's
  router via `machineServing`, validates the typed password against the seeded admin pw
  (recovered server-side from `owner_key` via `materializeRouterFs` → `buildRouterBaseFs`), and
  lands a session on `router_machine_id`. **No `su` step** — the router passwd is root-only
  (`buildRouterBaseFsFromIdentity`).
- **Client cross-player detection:** `isCrossPlayerWorkstation` (`core/network/crossPlayerHop.ts`)
  is `true` for B standing on A's router (not B's own ws, not B's own router, not a LAN sibling),
  so `ui/activeRoot.ts` already fetches the **server-served tree** for the hop and routes writes
  to the server. No client change is expected.
- **Scan reflecting B's edit is FREE:** once a `rules.v4` write hits the shared router journal,
  the existing `scanResult` / `resolvePublicScan` (5.1.3b) reads it. No new scan work.

**Net-new = two server branches:**

1. **Foreign-router READ** — `resolveCrossPlayerFs` + `api/network.ts` only reverse-look-up
   `workstation_machine_id` and call `materializeWorkstationFs`. They must resolve a
   `router_machine_id` and call `materializeRouterFs` so B can `cat`/`nano` A's `rules.v4`.
2. **Foreign-router WRITE (L2)** — `remoteWritePermission.ts`'s `resolveTargetBaseFs` has no
   branch for a registered foreign **router**: `isOwnRouter` is false (it's A's), `hostForMachineId`
   misses, and `findRegistryByMachineId` returns a _workstation_ tree → falls through to
   fail-closed. Needs a foreign-router branch building `buildRouterBaseFs(registry.owner_key)`.
   L1 (`authorizeMachineAccess`) already works unchanged (B has a session row on the router id;
   it's not B's own workstation → session required → present).

**Resolved design decisions (grill-me, 2026-06-18):**

1. **Slices**: 5.2.1 READ (walking skeleton) → 5.2.2 WRITE.
2. **Registry lookup**: ONE `findRegistryByMachineId` matching **either** `workstation_machine_id`
   OR `router_machine_id`, with a **discriminated return** (`kind:'workstation' | 'router'`).
   Handlers branch on `kind`. The caller holds only a `machine_id` and can't know the kind upfront
   (B may hop either box), so a single reverse-lookup that resolves either is required.
3. **Cred discovery**: **creds-in-hand**, parked (same stance as Story 4). B types the correct
   seeded router admin pw; how B discovers it in real gameplay (hydra / leak / wordlist) is a
   separate parked concern. For the E2E, B computes `seedRouterAdminPw(A.owner_key)` offline (the
   `cross-player-e2e-playbook.md` "offline secret compute" pattern).
4. **Rewrite shape**: **both directions**, headline **ADD** (`forward 2222 to <A.ws LAN ip>:22`).
   Precondition for the ADD-shows-live observable: A's workstation `sshd` is up (the 5.1.3b
   liveness gate). Also cover B **removing** an A-configured forward (defacement).
5. **Demonstrator**: unit/integration tests are identity-agnostic (assert the shared-journal write
   plus the scan/read handler reading it). E2E = **B re-scans** (`nmap <A.publicIp>` reflects the
   new `:2222`) **plus reload-as-A** confirms A sees the changed forward (`cat rules.v4` /
   `nmap <subnet>.1`).
6. **Brick boundary**: 5.2 = **forwards only** (no brick assertions). **Story 5.3 stays separate**
   — its mechanism (root + write + tombstone-`rm` + `canBoot`/dark-gate on the router) is already
   shipped, so 5.3 becomes a thin **verification** story, not new mechanism. Do NOT fuse.
7. **Nonce store**: **defer** (keep `noopNonceStore`) — unchanged threat posture from prior
   cross-player writes; Upstash wiring is a separate cross-cutting hardening pass.
8. **Intrusion trace**: **defer to Story 6** — consistent with the shipped workstation login
   (writes no `auth.log`); cross-player log-writes are Story 6.
9. **Type sharing**: **per-module aligned** discriminated unions (keep the existing intentional
   duplication between `resolveCrossPlayerFs` and `remoteWritePermission`; no new shared module).

**No migration** — `network_registry` already has `router_machine_id` + `owner_key` columns; the
lookup only adds an OR-match. (Optional, non-blocking: an index on `router_machine_id` for the
reverse-lookup; flag during the wire-check, not required for correctness.)

**Tier note**: B's `ssh root` session is tier-2 **root** → the read filter returns the full router
tree (`rules.v4` is `read:['root']`). Proven cross-player by Story 4 (B `su root` → reads A's
`/etc/passwd`). No router-specific redaction.

## Acceptance Criteria

- [ ] B (root-session'd on A's router via the shipped `ssh root@<A.publicIp>`) runs
      `cat /etc/iptables/rules.v4` and sees **A's** real NAT rules (the seeded header + any forward
      A configured), served from A's shared router journal — not B's own box, not a regenerated tree.
- [ ] The server reverse-lookup resolves a `router_machine_id` to A's router and materializes the
      **router** tree (`buildRouterBaseFs(A.owner_key)` + journal replay), distinct from the
      workstation tree; a `workstation_machine_id` still resolves the workstation tree (unbroken).
- [ ] A no-session / wrong-tier caller cannot read A's router beyond its tier (tier-3 allowlist);
      a non-router, non-workstation `machine_id` → `404 host_unreachable` (unchanged).
- [ ] B `nano`-edits A's `/etc/iptables/rules.v4` to **ADD** `forward 2222 to <A.ws LAN ip>:22`;
      the write is authorized (L1 session + L2 root-tier walker on the **router** tree) and persists
      to the **shared router journal** (`writer_key = B`, server `updated_at`).
- [ ] After B's ADD, a fresh `nmap <A.publicIp>` (run by B) shows `:2222` **iff** A's ws `sshd` is
      up; reloading as A, A sees the forward in `rules.v4` / via `nmap <subnet>.1` LAN-side rules.
- [ ] B can also **REMOVE** an A-configured forward; A's exposure drops accordingly.
- [ ] A guest/non-root caller (or no session) is **denied** the `rules.v4` write
      (`403 no_session` at L1, or `403 permission_denied` at L2); fail-closed for an unresolvable
      target is preserved.
- [ ] No `auth.log` trace is written on A's router (deferred to Story 6); no brick assertions
      (deferred to Story 5.3); `noopNonceStore` unchanged.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing
test. Read CLAUDE.md + the testing rules before writing slices. v2 has **no Prettier** — run
`npm run lint`; type gate is `npm run typecheck` (`tsc -b`, covers `api/` + `scripts/`). `api/`
runtime correctness (DB columns) is only proven by the live wire-check / agent-browser E2E.

### Slice 1 (5.2.1 — walking skeleton): B reads A's router filesystem cross-player

**Value**: B, root-session'd on A's router, can `cat`/`ls`/`nano` A's real `/etc/iptables/rules.v4`
(and the rest of A's router tree at the root tier) — the prerequisite for rewriting it (nano loads
existing content from the served tree).

**Path**: B `ssh root@<A.publicIp>` (shipped) → client detects cross-player hop (shipped) → fetches
served tree → `POST /api/network {action:resolveCrossPlayerFs, machine_id: A's router id}` →
`findRegistryByMachineId` matches `router_machine_id`, returns `{kind:'router', owner_key}` →
`handleResolveCrossPlayerFs` branches on kind → `materializeRouterFs({owner_key}, journal)` → tier
filter (tier-2 root → full tree) → serialized router tree on the wire → B's terminal renders it.
_Skipped states:_ no-session tier-3 router allowlist beyond "doesn't crash / leaks only allowlisted
paths"; no write path yet; no auth.log.

**Required implementation skills**: Before code changes, load `tdd`, `testing`, `mutation-testing`,
`refactoring` (+ `typescript-strict` for the discriminated union, `api-design` for the lookup shape).

**Acceptance criteria** (confirm with human before code):

- `handleResolveCrossPlayerFs` resolves a router `machine_id`: discriminated registry `kind:'router'`
  → `materializeRouterFs` (router base + journal); `kind:'workstation'` → `materializeWorkstationFs`
  (unchanged); `null` → `404 host_unreachable`.
- Tier dispatch is unchanged and correct for the router: owner → full; active **root** session →
  full tree incl. `rules.v4`; no session → allowlist only.
- `api/network.ts` `findRegistryByMachineId` matches `workstation_machine_id` OR
  `router_machine_id`, selects the fields each arm needs (`owner_key` always; ws identity for the
  ws arm), and returns the discriminated shape.

**RED**: Core handler test — given a registry row whose `router_machine_id` matches the requested
`machine_id` and a router journal (e.g. a `rules.v4` edit), `handleResolveCrossPlayerFs` returns the
**router** tree with `rules.v4` present for a root-tier session; given a `workstation_machine_id`
match it still returns the workstation tree; given no match → 404. Likely mutators: the kind
discriminator (swap router/workstation branch), the tier conditional, the 404 guard — assert each
distinctly (router tree has `/etc/iptables/rules.v4`; ws tree does not).

**GREEN**: Add the discriminated registry type (router arm) + branch the base materialization on
`kind` in `resolveCrossPlayerFs`; widen `api/network.ts` lookup to the OR-match + discriminated map.

**MUTATE**: Run `mutation-testing` skill on `resolveCrossPlayerFs.ts` — report.
**KILL MUTANTS**: Strengthen tests for any survivor (esp. the kind branch + tier dispatch).
**REFACTOR**: Only if it adds value (e.g. a tiny `materializeForRegistry(kind,...)` selector if the
branch is duplicated). Keep the type per-module per decision #9.

**Done when**: all acceptance criteria met; mutation report reviewed; **live wire-check** — B
`ssh root@<A.publicIp>` then `cat /etc/iptables/rules.v4` shows A's seeded rules (agent-browser vs
`vercel dev` + Supabase, two-identity playbook); human approves commit.

### Slice 2 (5.2.2): B rewrites A's NAT forwards cross-player

**Value**: B (root on A's router) edits A's `/etc/iptables/rules.v4` — adding or removing a forward
— changing A's exposure; the change persists to the shared journal and a fresh scan reflects it.

**Path**: B `nano /etc/iptables/rules.v4` on the cross-player router hop → save → client routes the
patch write to the server (shipped) → `POST /api/patches` upsert → L1 `authorizeMachineAccess`
(session row on router id → pass) → L2 `enforceRemoteWriteL2` → `resolveTargetBaseFs` foreign-router
branch (discriminated registry `kind:'router'` → `buildRouterBaseFs(owner_key)`) → `createFsView`
canWrite at **root** tier → write persists (`writer_key=B`) → A's public scan / LAN-side rules
reflect it. _Skipped states:_ brick (5.3); auth.log (Story 6); real nonce store.

**Required implementation skills**: Before code changes, load `tdd`, `testing`, `mutation-testing`,
`refactoring`.

**Acceptance criteria** (confirm with human before code):

- L2 `resolveTargetBaseFs` resolves a registered foreign **router** target to
  `buildRouterBaseFs(registry.owner_key)` (rebuilt from the OWNER's identity, symmetric with the
  read path), and the root-tier walker permits the `rules.v4` write.
- Branch ordering preserved: own-router (`isOwnRouter`) → LAN host (`hostForMachineId`) → registry
  (discriminated: router → `buildRouterBaseFs`; workstation → `buildRegisteredWorkstationFs`) →
  fail-closed (`null` → `permission_denied`).
- `api/patches.ts` `findRegistryByMachineId` matches either column / returns the discriminated shape.
- A guest/non-root or no-session caller is denied (`403`); workstation cross-player writes unbroken.

**RED**: Core L2 test — given a registry row whose `router_machine_id` matches and a **root**-tier
session, `enforceRemoteWriteL2` returns `null` (allowed) for a `rules.v4` path; given a
non-root/guest tier on the router → `permission_denied`; given an unresolvable id → fail-closed.
Plus an `upsertPatch`/`removePatch` integration test: B's ADD then a `scanResult`/materialized
read reflects the new forward; B's REMOVE drops it. Likely mutators: the new branch's owner-key
source (must be `registry.owner_key`, not caller key), the branch ordering, the fail-closed default.

**GREEN**: Add the foreign-router arm to `resolveTargetBaseFs` (discriminated registry) + widen
`api/patches.ts` lookup.

**MUTATE**: Run `mutation-testing` skill on `remoteWritePermission.ts` — report.
**KILL MUTANTS**: Strengthen for survivors (esp. `registry.owner_key` vs caller key; branch order).
**REFACTOR**: Only if valuable.

**Done when**: all acceptance criteria met; mutation report reviewed; **live E2E** — B
`ssh root@<A.publicIp>` → `nano rules.v4` ADD `forward 2222 to <A.ws LAN ip>:22` → B `nmap
<A.publicIp>` shows `:2222` (A's ws `sshd` up) → reload-as-A sees the forward; then B REMOVE drops
it (agent-browser, two-identity playbook); human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — run `mutation-testing` skill (don't run Stryker with the v2 dev server up —
   `project_v2_stryker_devserver_contention`).
2. Refactoring assessment — run `refactoring` skill.
3. `npm run typecheck` + `npm run lint` pass (no Prettier in v2).
4. Live wire-check / agent-browser E2E for the `api/` paths (untyped locally —
   `project_v2_api_not_typechecked_locally`).

## On completion

- Update `plans/multiplayer-crossplayer-epic.md` (mark 5.2 done; repoint "Next step" to 5.3) and
  `v2/docs/cross-player-architecture.md` (foreign-router read + write branches as-built).
- Version: held at 0.67.0 across 5.1; bump deferred to a Story-5 / epic milestone (confirm at 5.3
  or epic close).
- Merge learnings via `learn`/`adr` if significant; delete this plan file.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
