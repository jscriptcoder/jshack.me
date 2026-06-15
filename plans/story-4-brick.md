# Plan: Story 4 — B escalates to root → bricks A's machine

**Branch**: one branch/PR per slice (`feat/v2-su-elevation`, `feat/v2-boot-brick`, `feat/v2-reboot`, `feat/v2-bricked-dark`)
**Status**: Active

## Goal

A player B who has obtained A's root password can `su` to root on A's machine, delete a `/boot` file, and reboot it — permanently bricking A's box (it can't boot next login), observable to A and to other players on the network.

## Context (resolved via grill-me 2026-06-15)

Epic: `plans/multiplayer-crossplayer-epic.md` (Story 4). As-built model: `v2/docs/cross-player-architecture.md`. Legacy reference for the brick mechanic: `src/commands/reboot.ts`, `src/filesystem/fileSystemFactory.ts` (`/boot`), `src/components/BootScreen.tsx`, `src/session/SessionContext.tsx` (`markMachineBricked`).

**Resolved design decisions:**

| Decision       | Resolution                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brick mechanic | `/boot/{vmlinuz,initrd.img}` in the **shared base FS** (every machine). Root `rm` of a boot file (tombstone) + a boot ⇒ the machine can't boot.                                                                                                |
| Brick state    | **Pure-derived from the shared journal** — the boot-file tombstone _is_ the state. No marker, no schema, cross-player by construction.                                                                                                         |
| Detection      | The boot screen runs on **every returning-player app entry**, awaits FS resolution, and checks for the boot files. Missing → GRUB/kernel-panic, **halt, no terminal**.                                                                         |
| Recovery       | **None. Permanent.** Renewal = a new identity (out of scope). Same consequence-family as `chmod`-ing yourself out of `su`.                                                                                                                     |
| Root access    | Server-authoritative `su`-elevation: B sends the typed root password → server validates `md5(typed) === registry.workstation_root_hash` → inserts a root-tier `kind:'su'` session row. L1 already returns the latest active row, so root wins. |
| Others' view   | A bricked box goes **dark** (`nmap` host-down / `ssh` refused) — its boot files are gone, so it's treated as unreachable. Sequenced after the walking skeleton.                                                                                |

**Why no L1 change**: `findActiveSession` (`api/patches.ts:105`, `api/network.ts:132`) is already `.order('created_at', {ascending:false}).limit(1)` — top-of-stack. A root su-session inserted after the guest ssh row is the latest, so L2's `createFsView(tree, { userType }).canWrite` (`core/patches/remoteWritePermission.ts:121`) runs at `root`.

**Why no schema change**: the brick is the boot-file tombstone in the existing `patches` journal; boot/scan/connect all derive "can this box boot?" from the replayed tree.

**Testability**: the root password is **player-chosen** (`config.rootPassword` → `md5` → `network_registry.workstation_root_hash`, `core/generation/workstationFs.ts:161`), _not_ derived from the owner key (only the guest password is). For E2E the dev authors A with a known root password; B types it. Real-gameplay credential theft (hydra / leak / library-CVE) stays parked in the epic.

**Key anchors:**

- Generator (shared): `core/generation/baseFs.ts` (`dir`/`file`/`TRAVERSABLE_DIR`/perm constants) → used by `core/generation/workstationFs.ts` (`buildWorkstationBaseFsFromIdentity`) **and** `core/generation/remoteHostFs.ts` (`buildRemoteHostFs`). Add `/boot` once in the shared layer.
- su command: `core/commands/su.ts` (today reads `/etc/passwd` from `env.fs`; needs a cross-player server branch). ssh's cross-player branch is the template: `core/commands/ssh.ts` (`executePublicLogin`) + `core/sessions/authCreateSessionPublic.ts` + adapter `adapters/sessionsApi.ts` (`authCreateServerSessionPublic`).
- Registry lookup by machine id (already exists): `core/patches/remoteWritePermission.ts` (`FindRegistryByMachineId`, `RegistryWorkstation` with `workstation_root_hash`).
- Sessions: table `supabase/migrations/20260607000000_sessions.sql`; endpoint `api/sessions.ts`; adapter `adapters/sessionsApi.ts`; insert shape `core/sessions/authCreateSession.ts` (`AuthSessionRow`).
- Boot UI: `ui/screens/boot.tsx` (cosmetic today), `ui/screens/app.tsx` (returning-player flow skips boot today), `ui/state.ts` (`startGame`, `resolveActiveRoot`/`fetchOwnPatches`).
- reboot: NEW `core/commands/reboot.ts` + register in `core/commands/registry.ts` (`reboot` binary already in `core/generation/binaries.ts` `SYSTEM_UTILITY_NAMES`).
- Dark-to-others: `core/scan/resolvePublicScan.ts`, `core/sessions/authCreateSessionPublic.ts`.
- Shared boot-check authority (NEW pure module): `core/boot/bootFiles.ts`.

**Verify-before-coding flags:**

1. **su on a cross-player hop** — `su` is `availability: { kind: 'localhost-only' }` (`su.ts:145`). Confirm a command runs on the box you're ssh'd into (the hop is "localhost" from the session's vantage). If `localhost-only` blocks a cross-player hop, fix the availability semantics so on-box commands run regardless of how you arrived. (`wrapWithBinaryCheck` in `availability.ts` is the binary gate, a separate concern.)
2. **NPC-host su-elevation is out of scope** — Slice 1 targets a registered foreign **workstation** (the registry root-hash path). NPC-on-LAN root elevation can reuse `resolveTargetBaseFs`'s NPC branch later; do not build it here.
3. **`api/` is not typechecked locally** (memory `project_v2_api_not_typechecked_locally`) — keep the new `api/sessions.ts` branch thin; push logic into typechecked `core/`; verify via the live two-identity E2E.

## Acceptance Criteria (story-level)

- [x] B, ssh'd into A as guest, can `su` to root with A's root password (server-validated); a wrong password returns `su: Authentication failure` and leaves B as guest. _(Slice 1)_
- [x] As root on A, B can write a root-owned path that guest was denied (proves root-tier authorization is server-enforced, not a client claim). _(Slice 1)_
- [ ] Every generated machine FS contains `/boot/vmlinuz` and `/boot/initrd.img` (root-owned, root-write).
- [ ] On a returning player's app entry, the boot screen checks the replayed FS; with both boot files present it reaches the terminal.
- [ ] If a required boot file is missing in the replayed FS, the boot halts on a GRUB/kernel-panic screen and the terminal never appears (permanent — no recovery action).
- [ ] B (root on A) deletes `/boot/vmlinuz`; on A's next load A's box is bricked.
- [ ] `reboot` (root-only) forces a cold boot: on a box with a missing boot file it shows the panic and the box is bricked; on an intact box it boots successfully.
- [ ] After A is bricked, B (or a third identity) scanning A's public IP sees the host down, and `ssh` to A is refused.

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing test. v2 has **no Prettier** — `npm run lint` is the format gate (memory `project_v2_no_prettier_format_gate`). Browser-only behavior (the boot-screen halt) is E2E'd with **agent-browser, two identities** (v2 has no Playwright).

---

### Slice 1: B can `su` to root on A's box with A's root password, server-validated — ✅ COMPLETE

_Shipped on `feat/v2-su-elevation`: `core/sessions/authElevateSession.ts` (suElevate handler), `adapters/sessionsApi.ts` (`authElevateServerSession` + `SuElevateParams`/`SuApi`), `core/network/crossPlayerHop.ts` (shared `isCrossPlayerWorkstation`), `core/commands/su.ts` cross-player branch, `ui/state.ts`/`ui/env.ts` wiring, `api/sessions.ts` route. Verified: 100% mutation on new pure code; `scripts/testCrossPlayerSuElevate.ts` 7/7; full two-identity browser E2E (crack→connect→nmap→ssh→guest-denied→su root→root write). Auth.log trace deferred to Story 6._

**Value**: Attacker B gains a server-authoritative root session on victim A's registered workstation — the enabling spine; without it every brick write is denied at L2.
**Path**: B (already ssh'd into A as guest) runs `su` → client cross-player branch posts a signed `suElevate` to `/api/sessions` → server resolves A via `findRegistryByMachineId(currentMachineId)`, validates `md5(typed) === workstation_root_hash`, inserts a `kind:'su'` row `{player_key:B, machine_id:A, credentials:{username:'root',userType:'root'}, parent_session_id: the guest ssh row}` → L1 now returns that row (latest) → L2 runs at `root`. Observable through a subsequent write to a root-owned path.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`, `typescript-strict` (Zod schema at the new trust boundary), `api-design` (the new signed action).
**Acceptance criteria** (confirm with human before code):

- New signed action validates the root password against the registry root hash and inserts a root-tier `kind:'su'` session; wrong password → 401, no row inserted.
- After elevation, B's `upsertPatch` to a **root-only** path on A (e.g. create a file under `/etc` or `/root`) succeeds; the same write as guest is `403 permission_denied`.
- The schema **rejects a client-supplied `player_key`/`userType`** (server stamps both from the verified pubkey + the regenerated/stored passwd) — mirrors `authCreateSessionPublic`.
- Client `su` on a **cross-player-workstation** hop routes to the server (does **not** try to read `/etc/passwd` from the pruned `env.fs`); own-box **and NPC-on-own-LAN** hops are unchanged (their tree is regenerated locally with a readable `/etc/passwd`, so local `su` already works — routing them to the server would regress them). Discriminator = `isCrossPlayerHop` (`isOwnWorkstation` false + on no LAN host).
- `su` with a wrong password returns `su: Authentication failure` and leaves B at guest tier.
- **Auth.log trace DEFERRED to Story 6** (decision 2026-06-15): writing B's `su` attempt to A's `auth.log` is a cross-player trace, which `authCreateSessionPublic` already defers to Story 6. Slice 1 logs nothing on the foreign box — the handler mirrors `authCreateSessionPublic`'s deps (`nonceStore`/`findRegistryByMachineId`/`insertSession`), no `now`/`readAuthLog`/`upsertPatch`.

**RED**: unit-test the new handler (`core/sessions/authElevateSession.ts`): valid root password → inserts the expected `kind:'su'` row + returns `{userType:'root'}`; wrong password → 401, `insertSession` not called; unknown username → 401; unregistered machine → 404; registry-lookup error → 500; insert error → 500; client-supplied `player_key` → 400, no lookup/insert; tampered/missing-field envelope → 4xx. Adapter test: 200→`{ok,userType}`, 401→`invalid_credentials`, 404→`host_unreachable`, malformed-200→`network_error`. Likely mutant gaps (per `mutator-rules.md`): the `md5(typed) === hash` equality (assert wrong-password path distinctly), the `!passwordOk` branch, the 401-vs-404 status literals, and the `parent_session_id` wiring.
**GREEN**: add `core/sessions/authElevateSession.ts` (Zod `looseObject` + `.refine(no player_key)`, verify envelope, `findRegistryByMachineId` lookup, `buildWorkstationBaseFsFromIdentity` + `accountIn`, md5 compare, `insertSession` of a `kind:'su'` row on the registry's `workstation_machine_id`); adapter `authElevateServerSession` in `sessionsApi.ts`; route the action in `api/sessions.ts`; cross-player branch in `su.ts` (mirror `ssh.ts` `executePublicLogin`, gated by `isCrossPlayerHop`); push the local root session only on a 200.
**MUTATE**: run `mutation-testing` on the new `core/` modules + the `su.ts` branch.
**KILL MUTANTS**: strengthen tests for any survivor; accept tooling-equivalent string-flag/defensive narrowing per memory.
**REFACTOR**: factor a shared `resolveRootHashForMachine` if Slice 4 / future NPC su can reuse it; otherwise leave inline.
**Done when**: all acceptance criteria met; mutation report reviewed; human approves commit. E2E (agent-browser, two identities): B `ssh guest@<A.publicIp>` → `su` (A's root pw) → create a root-owned file on A → A sees it; wrong pw → denied, still guest.

---

### Slice 2 (walking skeleton): a machine with a missing `/boot` file fails to boot

**Value**: A (owner) and B (attacker) both get the core payoff — a box whose boot file is gone halts at a kernel panic on next load, with no terminal, permanently.
**Path**: `core/generation/baseFs.ts` gains `/boot/{vmlinuz,initrd.img}` (root-owned, root-write) so every generator emits it → on app entry for a returning player, `app.tsx`/`state.ts` resolve the FS (`fetchOwnPatches` + replay), then `boot.tsx` calls the shared `canBoot(root)` → present → terminal; missing → render GRUB/kernel-panic lines and halt (no terminal mount). Cross-player: B (root on A, from Slice 1) `rm /boot/vmlinuz` (shipped tombstone path) → A's next load replays the tombstone → `canBoot` fails → A bricked.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`, `front-end-testing` (Vitest browser mode for `boot.tsx`).
**Acceptance criteria** (confirm with human before code):

- `buildWorkstationBaseFsFromIdentity` and `buildRemoteHostFs` both produce `/boot/vmlinuz` and `/boot/initrd.img`, root-owned, `write:['root']` (so only root can `rm` them; matches legacy `fileSystemFactory.ts`).
- `core/boot/bootFiles.ts` exposes `canBoot(root)` → `{ok:true}` when both present, else `{ok:false, missing:'vmlinuz'|'initrd.img'}` with **vmlinuz checked first** (legacy ordering → correct panic message).
- A returning player (id in localStorage) sees the boot screen on **every** entry (not just new game); on success it hands off to the terminal after FS resolution.
- Missing `/boot/vmlinuz` → boot output ends with the GRUB "no loaded kernel / System halted" lines and the terminal never mounts; missing `/boot/initrd.img` (vmlinuz present) → the "kernel panic — unable to mount root fs" lines; both permanent across reloads.
- Own-box self-brick works end-to-end: A `su root` (shipped own-box su) → `rm /boot/vmlinuz` → reload → bricked.

**RED**:

- `bootFiles.test.ts`: both present → ok; only initrd → missing vmlinuz; only vmlinuz → missing initrd; neither → vmlinuz first. Mutant gaps: the AND/short-circuit between the two checks, the `missing` string literals, the ordering.
- generator tests: `/boot` node exists with the right owner/permissions in both workstation and remote-host trees.
- `boot.tsx` browser test: given a resolved root **with** boot files → fires `onComplete`/shows login line; **without** vmlinuz → shows the halt lines and does **not** fire `onComplete`.
  **GREEN**: add `/boot` to `baseFs.ts`; add `core/boot/bootFiles.ts`; make `boot.tsx` accept the resolved root + branch its final step on `canBoot`; wire `app.tsx`/`state.ts` so returning players run the boot screen against the resolved FS (await patch fetch/replay before the kernel-load step).
  **MUTATE**: run on `bootFiles.ts` + the generator additions; `boot.tsx` covered by browser tests.
  **KILL MUTANTS**: strengthen ordering/branch tests as needed.
  **REFACTOR**: ensure `boot.tsx` stays presentational — the decision lives in `canBoot`, not the component.
  **Done when**: criteria met; mutation report reviewed; human approves. E2E (agent-browser): own-box self-brick, **and** cross-player (B root on A `rm /boot/vmlinuz` → A reloads → panic, no terminal).

---

### Slice 3: `reboot` forces a cold boot (the in-game brick trigger)

**Value**: The attacker (and owner) get the deliberate "delete **and** reboot" verb — force the brick now and see it happen, instead of waiting for the victim's next login; also the realistic way to reboot your own box.
**Path**: NEW `core/commands/reboot.ts` (root-only, current machine). Own box: animate shutdown + BIOS, then `canBoot(env.fs.root())` → success lines or panic lines, then re-enter the boot flow (a real cold boot). Cross-player (B root on A): the command materializes A's `/boot` server-side (same registry rebuild + journal replay the read path uses) to decide success vs which-file-missing, animates the panic, and forces the trigger. Persists nothing new — the `rm` tombstone is the state.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`. Match the legacy `reboot` CLI interface where sensible (memory `feedback_v2_match_legacy_command_interface`): root-required, the GRUB/panic copy, the manual warning.
**Acceptance criteria** (confirm with human before code):

- `reboot` requires root (`env.session.userType !== 'root'` → error, matching legacy copy); a non-root caller cannot reboot.
- On a machine with both boot files: prints the shutdown + successful-boot sequence and returns the session to a booted state.
- On a machine missing `/boot/vmlinuz`: prints shutdown then the GRUB "no loaded kernel / System halted" sequence; missing `initrd.img`: the kernel-panic sequence; the box is bricked.
- Cross-player: B (root on A) running `reboot` reads **A's** boot-file state server-side (not B's own FS) and shows the matching outcome.
- `reboot` is registered in the command registry and resolves as a binary (already in `SYSTEM_UTILITY_NAMES`).

**RED**: `reboot.test.ts`: non-root → permission error, no boot attempted; both files → success branch; missing vmlinuz → halt branch; missing initrd → panic branch (drive via `canBoot`/injected target FS). Cross-player branch: resolves the target via the server materializer, not `env.fs`. Mutant gaps: the root guard equality, the two missing-file branches + their distinct copy, the success-vs-failure selection.
**GREEN**: implement `reboot.ts` reusing `core/boot/bootFiles.ts` (`canBoot`) + the legacy sequence/copy; own-box reads `env.fs`, cross-player reads the server-materialized tree (reuse `resolveCrossPlayerFs`/registry rebuild); register it.
**MUTATE**: run on `reboot.ts`.
**KILL MUTANTS**: strengthen branch/copy tests; accept tooling-equivalents per memory.
**REFACTOR**: keep the animation/timing data declarative (legacy `DELAY` map shape); decision logic in `canBoot`.
**Done when**: criteria met; mutation report reviewed; human approves. E2E (agent-browser): B `ssh → su → rm /boot/vmlinuz → reboot` sees A panic; the full "delete and reboot" loop.

---

### Slice 4: a bricked box goes dark to other players

**Value**: Coherence + the persistent attacker/3rd-party confirmation — a box that can't boot stops answering the network, so B (or a defender) sees A drop off scans and connections.
**Path**: `core/scan/resolvePublicScan.ts` and `core/sessions/authCreateSessionPublic.ts` check the target's boot files (materialize A's tree as the read path does, run `canBoot`) → if it can't boot, the scan returns **host down / no open ports** and the public `ssh` auth returns **host_unreachable**, regardless of pidfiles still present in the journal.
**Required implementation skills**: load `tdd`, `testing`, `mutation-testing`, `refactoring`.
**Acceptance criteria** (confirm with human before code):

- `resolvePublicScan` against a bricked machine (missing boot file) returns host-down / no ports, even though `/var/run/*.pid` rows still exist.
- `authCreateSessionPublic` against a bricked machine returns `404 host_unreachable` (no session created), before/independent of password validation.
- A healthy (bootable) machine is unaffected — scan and ssh behave exactly as Story 1/2 today.

**RED**: handler tests: bricked target (inject a tree missing vmlinuz) → scan host-down, public-ssh 404; bootable target → unchanged behavior. Mutant gaps: the added `canBoot` guard (assert it short-circuits before the open-ports/auth path), the host-down vs normal return shape, the 404 literal.
**GREEN**: insert the `canBoot` check at the top of both server resolution paths (reuse the materialize-then-`canBoot` helper from Slices 2–3).
**MUTATE**: run on the two handlers' new branches.
**KILL MUTANTS**: strengthen the short-circuit/return-shape tests.
**REFACTOR**: extract a single `materializeAndCheckBoot(machineId)` server helper if the scan + ssh paths duplicate it.
**Done when**: criteria met; mutation report reviewed; human approves. E2E (agent-browser): after the brick, B `nmap <A.publicIp>` → host down; `ssh guest@<A.publicIp>` → refused; a healthy box still scans/sshes.

## Pre-PR Quality Gate (each slice)

1. Mutation testing — run `mutation-testing` skill; review the report (do **not** run Stryker while the v2 dev server is up — memory `project_v2_stryker_devserver_contention`).
2. Refactoring assessment — run `refactoring` skill.
3. `npm run lint` + `npm run test:run` (v2). `api/` type errors only surface via `vercel dev`/deploy — verify the live E2E.
4. Squash-merge per convention: `gh pr merge --squash --delete-branch`, Conventional Commits with scoped prefix + `(#N)`.

## On completion

- Update `v2/docs/cross-player-architecture.md` (new "Story 4 — root escalation & bricking" section: `/boot` model, `canBoot` authority, su-elevation session, derived permanent brick, dark-to-others).
- Update the epic `plans/multiplayer-crossplayer-epic.md` (Story 4 → DONE) and bump the version (`package.json` + `package-lock.json`).
- Merge learnings via the `learn`/`adr` agents if significant; then delete this plan file (and `plans/` if empty).

---

_Delete this file when the plan is complete. If `plans/` is empty, delete the directory._
