# Plan: Story 5.1 — Router as a real machine + player-controlled NAT

**Branch**: feat/story-5_1-router-nat (one branch per slice/PR below)
**Status**: Active — 5.1.1a ✅ (#258, `33e7444`) + 5.1.1b ✅ (#259, `f9c52ea`) + 5.1.2 ✅ (#261, `6d742ee`) shipped. 5.1.3 split into **5.1.3a/b/c** (A's own journal-backed router is a NEW machine category, distinct from own-workstation / regenerated-sibling / cross-player-foreign); **5.1.3a ✅ (#263, `3d33021`)** + **5.1.3b ✅ (#265, `47d45b9`)** shipped; next **5.1.3c**.

> Parent: `plans/multiplayer-crossplayer-epic.md` — Story 5 (cross-player home NAT only). The 11 locked
> SCOPE decisions live in §"Story 5 — resolved scope & decisions"; the 7 IMPLEMENTATION decisions this
> plan executes live in §"Story 5.1 — resolved implementation decisions" (grill-me, 2026-06-17). **Read
> both before starting any slice.**

## Goal

The player's router becomes a distinct, journal-backed, registered machine bearing the public IP and
running its own `sshd:22`; a single `scanResult(address, vantage)` total function — fed by the parsed
`/etc/iptables/rules.v4` — drives both scan paths; ssh routes by destination port through the NAT; and the
owner opts a workstation forward in by `nano`-editing `rules.v4`, reflected cross-player.

## Acceptance Criteria

Behaviour-driven, tested at the lowest level that gives confidence: vitest units for the pure
generators/parsers/`scanResult`, vitest integration (stubbed `fetch`/deps) for the handler flips, and one
reshaped **agent-browser E2E** for the full cross-player loop (browser-only; per `feedback_e2e_scope`).

- [x] A fresh box's public IP resolves to the **router** on `nmap`: `nmap <A.publicIp>` (by any other
      identity) shows the router's own `:22` and nothing else — the workstation is dark behind NAT (no
      default forward). _(5.1.1b, #259 — unit + 6/6 live wire-check)_
- [ ] `ssh root@<A.publicIp>` lands on the **router** (validated against its seeded admin password);
      `ssh …@<A.publicIp> -p <port>` routes by destination port through the parsed forward table.
      _(router login ✅ 5.1.2, #261 — unit + 6/6 live wire-check; `-p` forward → workstation routing in 5.1.3)_
- [x] With no forward configured, `ssh …@<A.publicIp> -p 2222` is `host_unreachable` (opt-in default).
      _(5.1.2, #261 — unit + live wire-check)_
- [x] A configures a forward by `ssh root@<subnet>.1` → `nano /etc/iptables/rules.v4` → add
      `forward 2222 to <ws.lanIp>:22` → save; the edit persists to the shared journal.
      _(5.1.3a, #263 — unit; agent-browser confirm deferred to 5.1.3 close)_
- [ ] After A's edit, B's `nmap <A.publicIp>` shows `:2222` **iff** A's workstation `sshd` is up
      _(scan ✅ 5.1.3b, #265 — unit + mutation; live confirm deferred to 5.1.3c)_, and
      `ssh guest@<A.publicIp> -p 2222` lands on the **workstation** _(ssh → 5.1.3c)_.
- [ ] `nmap <subnet>.1` from inside the LAN shows the router's own `:22` but **NOT** the forwards (the
      dual-homed `.1`-vs-public invariant — never a merged view).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. Before code on any slice, load `tdd`,
`testing`, `mutation-testing`, `refactoring`. v2 format gate = `npm run lint` (no Prettier in v2); type
gate = `npm run typecheck` (`tsc -b`, covers `api/`+`scripts/`). `api/` runtime correctness (DB columns)
needs a wire-check, not just typecheck (`project_v2_api_not_typechecked_locally`).

---

### Slice 5.1.1a: Pure router primitives (foundations that unlock the flip) — ✅ DONE (PR #258, squash `33e7444`)

**Value**: Developer/internal — the framework-agnostic building blocks the scan flip (5.1.1b) consumes.
A **justified horizontal exception** (planning skill): every primitive is independently unit-testable
(verifiable), is consumed immediately by 5.1.1b (no speculative abstraction — shapes are pinned by the
grill), and is smaller to build/verify in isolation than inside the integrating handler.
**Path**: pure `core/` modules only — no wire, no handler. Each verified by vitest in isolation.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `typescript-strict`.
**Acceptance criteria** (present + confirm before code):

- `computeRouterId(playerKeyHex)` returns `router-<8 hex>` where the suffix is
  `sha256('ed25519-router:'+playerKeyHex)[0..8]` — a **distinct** namespace, so for the same key it
  differs from `computeWorkstationId(name, key)`'s suffix and `isOwnWorkstation(routerId, key)` is `false`.
- `seedRouterAdminPw(playerKeyHex)` returns a deterministic weak password from a fixed pool, seeded by the
  owner key alone (server-recoverable, like `workstationGuestPassword`). `seedRouterHasSsh(playerKeyHex)`
  returns a deterministic boolean (pinned `true` for now via a probability knob).
- `buildRouterBaseFsFromIdentity({ ownerKeyHex, adminPwHash })` returns a `Directory` with: a **root-only**
  `/etc/passwd` (hash = `adminPwHash`, no player/guest); full `/bin`+`/usr/bin`+`/usr/sbin`+`/lib`
  (so `nano`/`ls`/`cat` resolve); `/boot` (`bootDir()`); `/var/log/{auth,kern}.log`; `/var/run`; `/tmp`;
  `/root`; `/etc/iptables/rules.v4` seeded to a comment header + commented example + **no active forward**;
  and — when `seedRouterHasSsh` — `/var/run/sshd.pid` = `formatPidfileContent(sshSpec, 22)` (`sshd:port=22`).
- A `forward` grammar parser (ported from legacy `src/network/iptablesParser.ts`): parses
  `forward <pub> to <ip>:<port>` lines → `{ publicPort, internalIp, internalPort }`, **lenient** (skips
  `#`/blank/malformed lines), rejecting out-of-range ports (1–65535).
- `scanResult({ vantage, routerFs, resolveTargetPorts })` → `readonly OpenPort[]`: `own =
readOpenPorts(routerFs)`; `sameLAN` → `own` only; `external` → `dedupe(own ∪ forwards)` where each parsed
  forward is kept **iff** `resolveTargetPorts(internalIp)` contains its `internalPort`, mapped to the
  **public** port. The vantage branch is the single place forwards are excluded LAN-side.

**RED** (mutator-aware): router-id distinct-suffix + `isOwnWorkstation===false`; seed determinism + pool
membership; base-FS presence of each required path AND the conditional `sshd.pid` (toggle the boolean →
pidfile absent → `readOpenPorts` empty); parser boundary cases (port 0/65536, `#`-comment, missing `:port`,
extra whitespace); `scanResult` each vantage, the liveness filter (target port up vs down flips a forward
on/off), and dedupe (router `:22` not double-listed when a forward also targets 22).
**GREEN**: minimum pure implementations.
**MUTATE / KILL MUTANTS**: Stryker over `core/**` (router id, seeds, router FS, parser, `scanResult`);
accept only documented equivalents (e.g. manual-example metadata strings).
**REFACTOR**: assess sharing the box-FS skeleton with `buildWorkstationBaseFsFromIdentity` via `baseFs.ts`
(DRY only if the same knowledge, not incidental similarity).
**Done when**: all AC met, mutation report reviewed, human approves commit.

---

### Slice 5.1.1b: Scan flip — `nmap <A.publicIp>` resolves the real router (WALKING SKELETON) — ✅ DONE (PR #259, squash `f9c52ea`)

**Value**: An attacking player (B) scanning A's public IP — the headline cross-player observable. Proves the
router is a real machine on the public IP end-to-end through the signed wire.
**Path**: `nmap <A.publicIp>` → signed `resolvePublicScan` → `findRegistryByPublicIp` (now returns the real
`router_machine_id` + identity) → materialize the **router** (base via `buildRouterBaseFsFromIdentity` +
router journal) → `canBoot(router)` → `scanResult({ vantage:'external', routerFs, resolveTargetPorts })`
with an empty forward table → router's own `:22`. `registerNetwork` writes the real `router_machine_id`;
the `forward_table` column is dropped. resolveTargetPorts is a stub here (never called — no forwards yet),
fully wired in 5.1.3.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `api-design`.
**Acceptance criteria** (present + confirm before code):

- `registerNetwork` writes `router_machine_id = computeRouterId(owner_key)` (no longer the workstation id);
  the `forward_table` column is removed from the row type, the upsert, and the DB schema (migration).
- `resolvePublicScan` resolves, boot-checks, and reads ports off the **router** (`router_machine_id`), via a
  `materializeRouterFs(registry, routerPatches)` (base = `buildRouterBaseFsFromIdentity` from the registry
  identity; journal replayed) and `scanResult` external-branch.
- For a fresh registered box, `nmap <A.publicIp>` returns exactly the router's own `:22`; the workstation's
  ports are NOT shown (dark behind NAT — opt-in default).
- A router that is bootable answers; the boot-state gate now keys on the **router** (decision 10 seam —
  bricking the router would take the IP dark; proven in 5.3).
- `api/network.ts` deps updated: registry `select` includes `router_machine_id`; `findRunFiles`/`findPatches`
  scoped to the router machine id. Wire-checked against a live endpoint (DB column correctness).

**RED**: handler-level (stubbed deps) — fresh box → `{ found:true, ports:[{port:22,...}] }` and no
workstation ports; registry handler writes the distinct `router_machine_id` and omits `forward_table`;
materializeRouterFs replays a router journal row over the router base. Reshape the existing
`resolvePublicScan.test.ts` expectations (was: workstation ports) — `feedback_no_backward_compat` makes the
behavior change free.
**GREEN**: flip the registry value + handler target; new `materializeRouterFs`; drop `forward_table`.
**MUTATE / KILL MUTANTS**: Stryker over the changed `core/` (handler + materialize + registry); verify the
router-vs-workstation target isn't a survivable swap.
**REFACTOR**: assess generalizing `materializeWorkstationFs` ↔ `materializeRouterFs` (both = base-from-
identity + ordered journal replay) into one `materializeMachineFs` taking the base builder.
**Done when**: all AC met, mutation report reviewed, agent-browser smoke (B `nmap <A.publicIp>` → router
`:22`) confirmed against `vercel dev`+Supabase, human approves commit. **Reshapes** the Story 2–4 E2E
(which `ssh guest@<A.publicIp>` on `:22`) — that loop is repaired in 5.1.2/5.1.3.

---

### Slice 5.1.2: ssh routes by destination port (`:22` → router) — ✅ DONE (PR #261, squash `6d742ee`)

**Value**: An attacking player — `ssh root@<A.publicIp>` now reaches the router itself (root via the
recovered seeded admin pw), the foothold 5.2's router attack builds on.
**Path**: `ssh [-p N] <user>@<A.publicIp>` → `authCreateSessionPublic` carries the destination port (default 22) → `machineServing(<publicIp>, port)` materializes the router, parses `rules.v4`, and returns which
machine serves that port: router own ports → the router machine (build router FS, validate against the
seeded admin passwd, session on `router_machine_id`); a forwarded port → the internal machine (current
workstation behavior); neither → `host_unreachable`.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `api-design`.
**Acceptance criteria** (present + confirm before code):

- A new `machineServing({ routerFs, port })` (pure, `core/`) returns the served machine + internal port:
  router own ports → router; a parsed forward whose `publicPort === port` → its `internalIp`/`internalPort`;
  else none.
- `authCreateSessionPublic` consults `machineServing` on the request's destination port: port 22 (router
  own) → build the **router** FS, validate `payload.password` against its root account (seeded admin pw),
  insert the session on `router_machine_id`, return its host.
- With no forward, `ssh …@<A.publicIp> -p 2222` → `host_unreachable` (404) before any password check.
- The ssh command + `authCreateSessionPublic` payload carry the destination port (default 22), matching the
  legacy `ssh -p` interface (`feedback_v2_match_legacy_command_interface`).

**RED**: `machineServing` unit cases (own port, forwarded port, unmatched port, malformed rule ignored);
handler — `ssh root@pub` with the seeded admin pw → 200 session on the router; wrong pw → 401; `-p 2222` with
no forward → 404.
**GREEN**: thread the port; branch on `machineServing`.
**MUTATE / KILL MUTANTS**: Stryker; verify the port-routing branch and the router-vs-workstation FS choice
aren't survivable.
**REFACTOR**: share the boot-state + materialize between `resolvePublicScan` and `authCreateSessionPublic`
(both now resolve a machine behind a public IP by port).
**Done when**: AC met, mutation reviewed, agent-browser `ssh root@<A.publicIp>` → router root prompt
confirmed, human approves commit.

---

### Slice 5.1.3a: A `ssh root@<subnet>.1` → journal-backed router; `nano rules.v4` persists to the shared journal — ✅ DONE (PR #263, squash `3d33021`)

**Value**: The victim/defender player (A) — logs into their OWN router and edits its NAT config; the edit
sticks on the shared journal. The FIRST own-LAN-but-journal-backed machine (decision 6 seam) — a new machine
category the whole stack must recognize, distinct from own-workstation (L1 bypass), regenerated LAN sibling
(`hostForMachineId`→`buildRemoteHostFs`), and cross-player foreign box (registry→`buildWorkstationBaseFsFromIdentity`).
**Path**: `ssh root@<subnet>.1` → own-LAN reachability checked against the **router** FS (seeded `sshd:22`,
not `buildRemoteHostFs`) → server `authCreateSession` **router branch** (build the router FS from the caller's
verified key, validate the seeded admin pw, session on `computeRouterId(publicKey)`) → client materializes the
router via the **own-router FS branch** (`buildRouterBaseFsFromIdentity(ownKey)` + replayed router journal, NOT
a served tree) → `nano /etc/iptables/rules.v4` save → L1 session-gate (no own-box bypass — router is a distinct
namespace) + L2 walker on the **router** tree at root tier → patch persisted under `router_machine_id`.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `api-design`.
**Sub-decisions** (confirmed): **D-a** — new `isOwnRouter(machineId, publicKeyHex) = machineId ===
computeRouterId(publicKeyHex)`, the identity-derived sibling of `isOwnWorkstation`, used client-side (FS-view
branch + exclude from `isCrossPlayerWorkstation`) and server-side L2. **D-b** — EXTEND `authCreateSession` with
a `host.kind === 'router'` branch (caller is the owner ⇒ every router secret is server-derivable), not a new
handler.
**Acceptance criteria** (confirmed):

- `ssh root@<subnet>.1` authenticates against the router's seeded admin pw and opens a **root** session whose
  `machineId === computeRouterId(env.identity.publicKeyHex)` (the id the registry stores + B's public paths
  resolve). Reachability/port checked against the **router** FS. Wrong pw → `Permission denied`; a non-root
  user → `Permission denied` (router is root-only).
- Inside the session, `ls`/`cat`/`nano` read the **router** tree (root-only `/etc/passwd`, the seeded
  `/etc/iptables/rules.v4` template, `/bin` etc.) — client base = `buildRouterBaseFsFromIdentity(ownKey)` +
  replayed router journal, NOT a regenerated sibling, NOT a served cross-player tree.
- `nano /etc/iptables/rules.v4` → add `forward 2222 to <ws.lanIp>:22` → Ctrl-O persists a patch under
  `router_machine_id` at **root** tier (passes L1 session-gate + L2 router-tree walker). A fresh session
  re-opening the file shows the line; the edit is visible when the router is re-materialized server-side.
- The own router is **not** a cross-player hop (no served-tree fetch) and **not** the own workstation (no L1
  bypass — session-gated).

**Deferred to 5.1.3b/c**: B seeing/using the forward (`resolveTargetPorts`, forward→ws auth). Deferred to
5.1.4: the dual-homed `.1` sameLAN scan. Deferred to Story 5.2: foreign-router L2 (B's brick).
**RED** (mutator-aware): ssh.ts own-LAN router routing (root@.1 reachable on 22 via router FS; session
`machineId === computeRouterId`; non-root/bad-pw → Permission denied); `authCreateSession` router branch (root
+ seeded admin pw → 200 on router id; wrong pw → 401; non-root → 401); `isOwnRouter` true/false +
`isCrossPlayerWorkstation` false for the own router; `baseFsFor` own-router branch (router id → router base,
not `buildRemoteHostFs`/ownBase); `resolveTargetBaseFs` own-router branch (router id → router FS so root
`canWrite` rules.v4; guest tier denied).
**GREEN**: `isOwnRouter` + thread the router branch through ssh.ts / `authCreateSession` / `baseFsFor` /
`resolveTargetBaseFs`.
**MUTATE / KILL MUTANTS**: Stryker over the changed `core/`; verify the router-vs-sibling FS choice and the
own-router-vs-cross-player classification aren't survivable swaps.
**REFACTOR**: assess a single `routerFsForCaller(publicKey)` helper shared by the auth branch + L2 branch.
**Done when**: AC met, mutation reviewed, agent-browser (A `ssh root@.1` → router root prompt → `nano
rules.v4` → save → re-open shows the line) confirmed against `vercel dev`+Supabase, human approves commit.

---

### Slice 5.1.3b: B's external scan reflects A's forward (`resolveTargetPorts` wired for real) — ✅ DONE (PR #265, squash `47d45b9`)

**Value**: An attacking player (B) — `nmap <A.publicIp>` now reveals a forwarded port, the recon step before
using it. Wires the `resolveTargetPorts` seam `scanResult` already consumes (stubbed `() => []` since 5.1.1b).
**Path**: `nmap <A.publicIp>` → `resolvePublicScan` materializes the router (already), parses `rules.v4`, and
for each forward calls a REAL `resolveTargetPorts(internalIp)`: map `internalIp` → A's workstation via
`assignHomeNetwork(owner_key, essid).localIp`, materialize it (`materializeWorkstationFs`), `readOpenPorts`;
`scanResult` keeps the forward (mapped to its public port) iff the target's internal port is up.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `api-design`.
**Acceptance criteria** (present + confirm before code):

- A new server-side `resolveTargetPorts(internalIp)` (injected into `scanResult`) resolves `internalIp` → A's
  workstation (`assignHomeNetwork(owner_key, essid).localIp` match), materializes it from base + ws journal,
  and returns its open ports; an `internalIp` that matches no host → empty.
- After A's 5.1.3a forward edit, B's `nmap <A.publicIp>` includes `:2222` **iff** A's workstation `sshd` is up;
  with the ws `sshd` down (or the forward line removed/malformed) `:2222` is absent. The router's own `:22` is
  always present and never double-listed.
- `resolvePublicScan` passes the real resolver (no longer `() => []`); the registry/patches deps it needs
  (owner_key, essid, ws journal) are wired + wire-checked for DB-column correctness.

**RED**: `resolveTargetPorts` (internalIp matches ws → ws ports; no match → empty; ws sshd down → port absent);
`resolvePublicScan` integration (forward in router journal + ws up → `:2222` shown; ws down → hidden).
**GREEN**: implement + inject `resolveTargetPorts`; thread the ws lookup deps.
**MUTATE / KILL MUTANTS**: Stryker over the resolver + the liveness branch.
**REFACTOR**: assess sharing the internalIp→ws materialization with 5.1.3c's auth path.
**Done when**: AC met, mutation reviewed, agent-browser (A forwards → B `nmap <A.publicIp>` shows `:2222`)
confirmed, human approves commit.

---

### Slice 5.1.3c: B's `ssh … -p 2222` lands on the workstation (restores the cross-player loop E2E)

**Value**: An attacking player (B) — `ssh guest@<A.publicIp> -p 2222` finally lands on A's exposed workstation,
completing the cross-player NAT loop. Restores the Story 2–4 agent-browser E2E (reshaped since 5.1.1b).
**Path**: `ssh guest@<A.publicIp> -p 2222` → `authCreateSessionPublic`; `machineServing` already returns the
`forward` branch — wire it: resolve `internalIp` → A's workstation (same lookup as 5.1.3b), materialize it,
validate `payload.password` against ITS `/etc/passwd`, insert the session on `workstation_machine_id`, return
its host. A bricked/booted gate + boot-state stay on the router for the IP; the ws is the auth target.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `api-design`.
**Acceptance criteria** (present + confirm before code):

- With A's `2222 → ws:22` forward live, `ssh guest@<A.publicIp> -p 2222` validates against the **workstation**'s
  passwd and opens a session on `workstation_machine_id` (not the router); a wrong pw → 401; an unforwarded port
  → 404 (unchanged from 5.1.2).
- The forward→ws auth reuses 5.1.3b's internalIp→workstation materialization (no second copy of the lookup).
- The reshaped agent-browser E2E passes end-to-end: A starts ws `sshd` + forwards `2222→ws:22` (front step,
  decision 8) → B `crack→connect→nmap <A.publicIp>` (sees `:22` + `:2222`) → `ssh guest@<A.publicIp> -p 2222` →
  operates on A's workstation.

**RED**: `authCreateSessionPublic` forward branch (`-p 2222` + ws-valid pw → 200 on `workstation_machine_id`;
wrong pw → 401; ws sshd down → 404/refused); E2E reshape.
**GREEN**: wire the `forward` branch of `machineServing` to ws auth.
**MUTATE / KILL MUTANTS**: Stryker over the auth branch.
**REFACTOR**: assess unifying the router-port and forward-port auth arms.
**Done when**: AC met, mutation reviewed, full agent-browser cross-player loop green, human approves commit.
**Restores** the Story 2–4 E2E with the front step (A starts ws `sshd` + forwards `2222→ws:22`) per decision 8.

---

### Slice 5.1.4: dual-homed `.1` sameLAN view (closes the scar)

**Value**: A player scanning their own LAN — `nmap <subnet>.1` shows the router's own services but not its
forwards, the realistic dual-homed behavior (`project_dual_homed_router_scan_discrepancy`).
**Path**: client `nmap <subnet>.1` → materialize the player's OWN router (owned, regenerated + own journal)
→ `scanResult({ vantage:'sameLAN', routerFs, resolveTargetPorts: stub })` → router own `:22` only. The `.1`
host stops being cosmetic in `generateHomeLan`/`scanTarget` — scanning it yields the router's ports.
**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (present + confirm before code):

- `nmap <subnet>.1` (own LAN) shows the router's own `:22`; it does **NOT** show any configured forward
  (e.g. `:2222`), even after 5.1.3 added one — the `sameLAN` vantage excludes forwards.
- The same router materialization underlies both the LAN `.1` view (sameLAN) and the public-IP view
  (external) — one `scanResult`, two vantages, never a merged view.

**RED**: `nmap <subnet>.1` shows `:22`; with a forward present, the LAN `.1` view still omits `:2222` while the
public view includes it (the invariant, asserted in one test).
**GREEN**: resolve `.1` to the own router; call `scanResult` sameLAN.
**MUTATE / KILL MUTANTS**: Stryker; verify the sameLAN-excludes-forwards branch can't be mutated to leak
forwards LAN-side.
**REFACTOR**: assess final shape of the `.1` host in `generateHomeLan` vs the registered router.
**Done when**: AC met, mutation reviewed, agent-browser `nmap <subnet>.1` (own `:22`, no forwards) confirmed,
human approves commit.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — run `mutation-testing` over the changed `core/` (UI/`api/` out of Stryker scope).
2. Refactoring assessment — run `refactoring`.
3. `npm run typecheck` + `npm run lint` pass.
4. `api/` changes (5.1.1b registry/scan, 5.1.2/5.1.3 auth) — wire-check the live endpoint (DB columns):
   typecheck does NOT prove runtime column correctness.
5. E2E only for the browser-reachable loop (per `feedback_e2e_scope`); do not duplicate unit/integration
   coverage in agent-browser.

---

_Delete this file when Story 5.1 is complete (all four slices shipped). Update the epic's "Next step" to 5.2._
