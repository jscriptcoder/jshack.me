# Plan: Story 5.3 — Router brick → whole public IP dark (+ workstation-behind-NAT dark-gate)

**Branch**: `feat/story-5_3-ws-brick-dark`
**Status**: Active

## Goal

A bricked machine goes dark to other players through the public IP: bricking A's **router** takes A's whole public IP dark (already shipped — verify end-to-end), and bricking A's **workstation behind the NAT** only removes its forwarded ports while the router keeps answering its own (the one net-new gate). Fulfils epic decision **#10**: `dark-gate(addr) = canBoot(machineServing(addr))`.

## Background — what already exists vs. what's net-new

Grilled 2026-06-18. Confirmed against the code:

- **Router brick → whole IP dark is ALREADY shipped + unit-tested.** `resolvePublicScan` and `authCreateSessionPublic` both materialize the **router**, call `canBoot`, and go host-down / `404` on a `/boot` tombstone (each has an explicit "bricked router" test). The router base FS seeds `/boot` (`bootDir()` → `vmlinuz` + `initrd.img`). B's `rm /boot/vmlinuz` on A's router is authorized by the **shipped 5.2 path**: `removePatch` shares `enforceRemoteWriteL2`, which already handles the foreign-router branch at root tier. → **No new mechanism; needs end-to-end confirmation it has never had** (the 5.2 wire-check did create/edit, never `rm`/brick).
- **The one genuine gap (net-new):** decision #10 says bricking the **workstation behind the NAT** should _"only remove its forwarded ports"_, but the shared `buildWorkstationResolver` (`core/scan/workstationPortResolver.ts`) gates **only on pidfile liveness (`readOpenPorts`), never on `canBoot`**. So today a bricked workstation behind a live forward still surfaces its forwarded port on scan **and** still accepts logins through the forward. That contradicts #10.
- **Fix site (decision):** add the `canBoot` gate inside the **shared `buildWorkstationResolver`** — return `null` when the materialized workstation can't boot. The scan path (`buildWorkstationPortResolver` wraps it → maps `null`→`[]`) and the ssh path (`resolveAuthTarget`'s workstation arm → maps `null`→`404 host_unreachable`) are both fixed by the one change, consistent-by-construction. Verified safe: a healthy workstation seeds `/boot` so it passes `canBoot` — only a genuinely bricked one (a `/boot` tombstone) returns `null`. No regression to live forwards.

### Grilled decisions (2026-06-18)

1. **Scope** — router-brick verification **+** build the WS-behind-NAT `canBoot` gate (fulfils #10; a real correctness gap, small).
2. **Gate site** — the shared `buildWorkstationResolver` returns `null` when `!canBoot(workstationFs)` (one site, both scan + ssh paths).
3. **PRs** — code PR (gate + unit tests + wire-check both directions) → then docs + version PR.
4. **Verification** — wire-check proves both brick directions deterministically; **agent-browser drives both directions live** (WS-brick contrast uses the offline-secret-compute trick to reach WS root, per `v2/docs/cross-player-e2e-playbook.md`).
5. **Version** — bump to **0.68.0** in the docs+version PR (Story-5 capstone; the deferred-to milestone).

### Locked non-goals

- **No auth.log brick trace** on the foreign box — that is Story 6 (cross-player su/brick trace on the shared record). The brick `rm` writes only the `/boot` tombstone.
- **Reboot is cosmetic** — the brick state IS the journal tombstone (pure-derived); the box is dark immediately, no `reboot` mechanism work. Own-box brick detection already handled by the boot screen (`ui/screens/boot.tsx`).
- **No multi-layer nets** (Story 5b). No new registry columns / migration.

## Acceptance Criteria

- [ ] `buildWorkstationResolver` returns `null` for a workstation whose materialized FS carries a `/boot/vmlinuz` tombstone (cannot boot), even when `internalIp` is its LAN IP; returns the tree for a healthy workstation (unchanged).
- [ ] Cross-player **scan** of A's public IP, with a live forward to A's workstation, drops the forwarded port once the **workstation** is bricked, while the router's own port(s) remain (`buildWorkstationPortResolver` → `[]` for the bricked target).
- [ ] Cross-player **ssh** to a NAT-forwarded port whose target **workstation** is bricked returns `404 host_unreachable`, before any password check and without inserting a session; ssh to the router's own port (`:22`) still authenticates.
- [ ] Wire-check (`scripts/`) proves **both** brick directions end-to-end against live api/ + Supabase:
      (a) **router brick** → `resolvePublicScan` host-down + `authCreateSessionPublic` `404` (whole IP dark);
      (b) **workstation brick** → scan shows only the router's own port(s), forwarded port gone, router login still `200`.
- [ ] Live agent-browser confirms **both** directions (router-brick headline = whole IP dark to everyone + reload-as-A kernel panic; workstation-brick contrast = forwarded port gone, router still up).
- [ ] Docs updated and version bumped to **0.68.0** (docs+version PR).

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test. Read CLAUDE.md and the v2 testing rules before writing slices. **v2 format gate = `npm run lint` (NOT `npm run format`); type gate = `npm run typecheck` (= `tsc -b`).**

### Slice 1: Bricked workstation behind a NAT forward goes dark (scan drops the forward, ssh-via-forward 404s); router keeps answering its own ports

**Value**: Any authenticated player scanning or ssh-ing A's public IP sees A's workstation drop off behind the NAT once it's bricked, while A's router still answers its own ports — the realistic, decision-#10 behaviour. Also the end-to-end confirmation (via the extended wire-check) that the already-shipped **router** brick takes the whole IP dark.

**Path**:

- Scan: B `nmap <A.publicIp>` → `resolvePublicScan` → `resolveForwardTargets` → `buildWorkstationPortResolver` → **`buildWorkstationResolver` (NEW: `null` when `!canBoot`)** → forwarded port dropped from `scanResult`.
- SSH: B `ssh <user>@<A.publicIp> -p <fwdPort>` → `authCreateSessionPublic` → `resolveAuthTarget` (workstation arm) → **`buildWorkstationResolver` returns `null`** → `404 host_unreachable` (no passwd check, no session insert).
- Router arm unchanged (already boot-gated upstream): bricking the WS does not touch the router's own ports.
- Skipped states: own-LAN `nmap <subnet>.1` view (LAN-side forwards already excluded — dual-homed scar closed); auth.log trace (Story 6).

**Required implementation skills**: Before code changes, load `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (present + confirm before code):

- `buildWorkstationResolver` returns `null` when the materialized workstation FS has a `/boot/vmlinuz` tombstone, even when `internalIp === lanIp`; returns the tree unchanged for a healthy workstation and `null` for a non-LAN `internalIp` (existing behaviour preserved).
- `buildWorkstationPortResolver` returns `[]` for a bricked workstation target (forward dropped) and its open ports for a healthy one.
- `authCreateSessionPublic`: a forwarded port to a bricked workstation → `404 host_unreachable`, before the password check and without inserting; the router's own `:22` still authenticates with a correct admin password.
- `resolvePublicScan`: with a live forward, a bricked workstation behind it → scan returns only the router's own port(s) (forwarded port absent).

**RED**: Failing tests first —

- `workstationPortResolver.test.ts`: (1) `buildWorkstationResolver` → `null` for a `/boot/vmlinuz`-tombstoned workstation at its LAN IP; (2) still returns the tree for a healthy workstation at its LAN IP; (3) `buildWorkstationPortResolver` → `[]` for the bricked target, ports for the healthy one.
- `authCreateSessionPublic.test.ts`: forwarded port → bricked workstation → `404`, no insert, no passwd check; contrast: router `:22` still `200`.
- `resolvePublicScan.test.ts`: live forward + bricked workstation → forwarded port absent from the scan, router's own port present.
- Mutator watch (`resources/mutator-rules.md`): the `!canBoot(...).ok` condition (ConditionalExpression / negation) — the healthy-workstation-still-resolves test plus the bricked-drops test pin both sides; guard against an "always `null`" mutant (healthy test) and a "gate removed" mutant (bricked test).

**GREEN**: In `buildWorkstationResolver`, after materializing `workstationFs`, gate the existing `internalIp === lanIp ? workstationFs : null` so a LAN-IP match that `!canBoot(workstationFs).ok` resolves to `null`. Import `canBoot` from `core/boot/bootFiles`. Minimum change; no touch to the router arms.

**MUTATE**: Run `mutation-testing` on `workstationPortResolver.ts` (+ the two handlers if changed). Produce report.

**KILL MUTANTS**: Strengthen tests for any survivor on the new condition; ask the human if a survivor's value is ambiguous (e.g. equivalent type-narrowing).

**REFACTOR**: Assess only if it adds value (the change is a single guarded return — likely none).

**Wire-check (same PR, not TDD'd itself — it's the live harness)**: extend `scripts/testCrossPlayerRouter.ts` (or a new `scripts/testRouterBrick.ts`) to cover BOTH directions against live api/ + Supabase:

- **(a) Router brick**: seed B's root ssh session on A's **router** → `removePatch /boot/vmlinuz` → assert `resolvePublicScan` → `found:false` (host-down) and `authCreateSessionPublic` (any port) → `404`. Whole IP dark.
- **(b) Workstation brick**: seed a forward in A's router `rules.v4` (`forward <fwd> to <lanIp>:22`) + A's workstation `sshd` pidfile + B's root ssh session on A's **workstation** → `removePatch /boot/vmlinuz` on the workstation → assert `resolvePublicScan` returns only the router's `:22` (forwarded port gone) and `authCreateSessionPublic` on the forwarded port → `404`, but on `:22` (router) → `200`.

**Done when**: all Slice-1 acceptance criteria met, unit tests + mutation report reviewed, wire-check both directions pass, `npm run typecheck` + `npm run lint` green, human approves commit. → open the code PR.

### Live verification (post-merge, before docs PR — not a PR)

Run the full two-identity agent-browser loop against `npm run vercel:dev` (:3100) + Supabase (playbook: `v2/docs/cross-player-e2e-playbook.md`):

- **Router-brick headline**: B `crack → connect → nmap <A.publicIp> → ssh root@<A.publicIp>` (recovers seeded admin pw) → router root → `rm /boot/vmlinuz` → from a fresh scan, `nmap <A.publicIp>` → "Host seems down", `ssh ...@<A.publicIp>` → host unreachable; reload-as-A → kernel-panic boot screen. (Whole IP dark to everyone.)
- **Workstation-brick contrast**: with A's forward live (`:2222` → ws `:22`, ws `sshd` up), B `ssh <user>@<A.publicIp> -p 2222` → workstation → `su root` (WS root recovered via offline-secret-compute) → `rm /boot/vmlinuz` → `nmap <A.publicIp>` now shows only `:22` (`:2222` gone); `ssh root@<A.publicIp>` (router) still works. (WS brick only removes its forwarded ports.)

### Slice 2: Docs + version bump (docs PR, after live confirmation)

**Value**: The as-built record reflects the completed Story-5 cross-player home-NAT arc; the version marks the capstone.
**Not TDD** (docs + version only).

- `v2/docs/cross-player-architecture.md`: §4/§5/§7 — note the **workstation-behind-NAT dark-gate** (the shared `buildWorkstationResolver` `canBoot` gate; `dark-gate(addr) = canBoot(machineServing(addr))` now realised at both router and workstation level). Mark **Story 5.3 complete**; Status & roadmap → **Story 6**.
- `plans/multiplayer-crossplayer-epic.md`: top status line + child-story 5.3 entry + "Next step" → mark 5.3 done, repoint to **Story 6**.
- Bump version to **0.68.0**: `package.json` + `package-lock.json` (via `npm install --package-lock-only`).
- Delete this plan file (`plans/story-5.3-router-brick-dark.md`).

**Done when**: docs reflect confirmed-live behaviour, version is 0.68.0, `npm run lint` green on changed v2 files, human approves commit. → docs PR (merge after the code PR).

## Pre-PR Quality Gate

Before each PR:

1. Mutation testing — run `mutation-testing` skill (Slice 1).
2. Refactoring assessment — run `refactoring` skill (Slice 1).
3. `npm run typecheck` (= `tsc -b`) + `npm run lint` pass. (Do NOT run `npm run format` in v2 — it's the legacy-root Prettier and reformats v2 wrongly.)
4. api/ runtime correctness (DB columns/constraints) is not typechecked locally — proven by the live wire-check + agent-browser run.

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
