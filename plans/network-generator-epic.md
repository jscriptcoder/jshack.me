# Epic Story-Split: Machine / Network Generator (v2)

**Status**: **Mostly SHIPPED — Stories 0, 1, 1.5, 2, 3 done; only Story 4 (multi-layer depth) remains as
generator work.** A new prerequisite surfaced downstream (see "Progress" below): the **cross-player
SHARED machine record**, which is what `plans/scan-logging-cross-player.md` Slice 3b (and the broader
cross-player read-path) is blocked on. (updated 2026-06-13.)
**Type**: Epic decomposition. Shipped child stories went out as their own PRs; remaining work
(Story 4, and the cross-player shared record) graduates to its own `plans/<slice>.md` when started.

## Progress (updated 2026-06-13) — read first

The stories below were authored 2026-06-04. Most have since SHIPPED, and the SSH epic (PRs #219–#228,
separate plan) built on this epic's generators and went beyond the original "read-only, no auth" scope.
Current state of each story:

- **Story 0** (intro screen / typed `gameConfig`) — ✅ SHIPPED (PR #195, v0.17.0).
- **Story 1** (seeded own-workstation base FS) — ✅ SHIPPED (PR #196, v0.18.0). Primitives live in
  `core/generation/` (`prng.ts`, `md5.ts`, `workstationFs.ts`, `generatePasswd`).
- **Story 1.5** (`apt install` installs a tool) — ✅ SHIPPED (`apt install nmap` works; binary/availability
  /library model also shipped, v0.21.0).
- **Story 2** (reachable single-layer LAN you can scan) — ✅ SHIPPED (`nmap` host-discovery, PRs #211/#212/
  #213, v0.37.0). `core/generation/generateHomeLan.ts` + `core/commands/nmap.ts`. The RFC-1918 variety
  conflict (design note 1) is **NOT yet resolved** — `assignHomeNetwork`/`generateHomeLan` still hard-code
  `192.168.x`; widen it when Story 4 (or a dedicated slice) needs the variety.
- **Story 3** (enter a generated machine + browse its FS) — ✅ SHIPPED, via the **SSH epic** (not a
  read-only connect): `ssh user@host` into a generated host + `ls`/`cat`/write its FS, tier-gated. Built on
  `core/generation/remoteHostFs.ts` + `core/generation/remoteHostId.ts` (`hostMachineId`/`hostForMachineId`).
  The SSH epic also added auth (ssh/su), a server `sessions` table, and a writable remote patch path —
  originally "OUT of this epic" but now shipped.
- **Story 4** (multi-layer depth: 2–3 layers, inner gateways, `switch` sub-kind, "see only your layer")
  — 🚧 **NOT shipped — the main remaining GENERATOR story.** Port the legacy `topology.ts` dual-homed
  gateway invariant (design note 2) + the layer-visibility rule. Resolve the RFC-1918 variety conflict
  here. Graduate to `plans/<slice>.md` when started.

### Cross-player shared machine record (NEW prerequisite — surfaced by the SSH + scan-logging epics)

Generated hosts today persist **per-viewer**: each host has a coordinate-derived `machine_id`
(`remoteHostId`), and its FS patches (ssh writes, su/ssh `auth.log`, and now nmap `kern.log`) are stored
in the `patches` table keyed by **the requesting `player_key`**. So a trace/write one identity makes is
**invisible to another identity** — every viewer regenerates the host under their own key.

A **cross-player SHARED machine record** (one generated host readable/writable by multiple identities) is
the missing piece that unblocks:

- `plans/scan-logging-cross-player.md` **Slice 3b** — a _different_ identity reading a scan's `kern.log`
  trace, and scanning real player workstations. (3a shipped the per-viewer write; 3b is just a
  re-key/re-read onto the shared record.)
- The legacy three-tier cross-player **read filter** (`listPatchesForMachines`) — the path by which a
  second player reads another's machine.

This is a **server / multiplayer-persistence** concern (how a generated host becomes a shared, server-
authoritative row), distinct from this epic's original "client-side, pure generation" scope — but it is
the natural next step for the generated world and the gate for all cross-player gameplay. **Decide when
starting next-phase work: does the shared-machine record become a new Story in this epic, or its own
epic/plan?** Either way it is the prerequisite to register for downstream cross-player slices.

> The `story-splitting` skill is not installed in this environment. This split was authored
> manually following the `planning` skill's vertical-slice rules: every child story delivers
> one observable behaviour through the real terminal path, leaves the codebase deployable,
> and is independently mergeable. Library-only / generator-only stories are deliberately
> avoided — a generator is invisible until a command surfaces it.

## Epic Goal

Procedurally generate the game world — machines, layered networks, and per-machine base
filesystems — **deterministically from a seed**, so the same seed always yields the same
world (multiplayer parity later depends on this).

## Scope For This Epic (intentionally simple)

Reconciling the user's "start simple, no templates" framing with the legacy types
(`docs/rewrite-blueprint/sections/02` + `06`) and the existing v2 FS machinery
(`FileNode` / `applyPatches` / `fsView`):

| Concept            | This epic                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Determinism        | Seeded PRNG (Mulberry32 + FNV-1a), ported verbatim from legacy                                                                                                                                                               |
| Machine kind       | `'machine' \| 'router'`                                                                                                                                                                                                      |
| Gateway sub-kind   | `'router' \| 'switch'` (only matters at layer depth)                                                                                                                                                                         |
| Topology           | 1–3 `/24` layers; `.1` = gateway; "see only your layer"                                                                                                                                                                      |
| Per-machine FS     | Uniform minimal skeleton (`/etc/passwd`, `/home`, `/root`, `/tmp`, `/bin`) — NO role templates                                                                                                                               |
| Addressing         | Private subnets across the **full RFC 1918 space** (`10.x`, `172.16–31.x`, `192.168.x`) for variety — NOT `192.168` only + per-machine IPs                                                                                   |
| Gateway interfaces | Every router/switch is **dual-homed**: the main router has a public IP + an internal `.1`; each internal router/switch carries one IP per adjacent layer (its `.1` on the downstream layer, a host IP on the upstream layer) |

## Design notes from owner (2026-06-04) — fold into the relevant stories

1. **Internal-IP variety (legacy parity).** Generated networks must draw subnets from the
   whole RFC 1918 range like legacy `generatePrivateSubnet` (`10.x` / `172.16–31.x` /
   `192.168.x`), not just `192.168.x`. **Conflict to resolve in Story 2**: the shipped
   `assignHomeNetwork` (`core/network/homeNetwork.ts`) hard-codes `192.168.${subnet}.${host}`.
   Widen it to the full RFC 1918 draw (no live players → free to reshape; update its golden test).
2. **Dual-homed gateways.** Routers and switches have **two interfaces**. The main router:
   one public-IP interface + one internal-LAN interface (`.1`). Internal routers/switches:
   one IP per layer they bridge (gateway `.1` on the layer below, a member host IP on the
   layer above). This is the shape Story 4's depth + visibility rule depends on; port the
   legacy `topology.ts` dual-interface invariant faithfully.

### Explicitly OUT of this epic (later epics)

Ports/services, CVEs/vuln timelines, NAT/iptables/SNMP/ACL firewalls, DNS zones,
credential leaks, web content, forensics, dpkg version overlay, role-specific FS templates
(webserver/database/etc.), auth (ssh/su/hydra), missions, and anything multiplayer/server-
authoritative. Generation in this epic is **client-side and pure** — it produces in-memory
data the existing read path consumes.

## Reusable spine (port, don't reinvent)

- `prng.ts` — Mulberry32 + FNV-1a. Pure. **Port verbatim.**
- The `SubnetLayer` shape and `.1`-gateway / layer-visibility invariants from legacy
  `src/generation/topology.ts` — port the _shape_, simplified to 2 kinds.
- v2 already has `FileNode`/`Directory`, `applyPatches`, `fsView` — the generator emits a
  base `Directory` per machine and the existing patch-replay + permission walker ride on top.

---

## Seed source (DECIDED)

The **Ed25519 identity pubkey is the generation seed** (no separate random game seed —
diverges from legacy, which used a `crypto.getRandomValues` game seed). Per-machine PRNGs
namespace it (legacy convention `createPrng('<machine>-' + seed)`). The intro-screen fields
(machine name / username / root password) are **typed config, not seed entropy** — same
split as legacy, where `rootPassword` → `md5()` and only the `guest` password is seed-picked.

## Child Stories (ordered, each vertical + observable)

### Story 0 — Intro screen: name your workstation — ✅ SHIPPED (PR #195)

**Actor**: New player, first launch.
**Trigger**: App boot with no persisted game-config.
**Observable outcome**: Player is shown an intro screen, types a machine name, username, and
root password; these persist (localStorage) and the terminal prompt + workstation reflect
them on this and subsequent loads. Returning players skip straight to the terminal.
**Production path**: new intro UI (Solid) + a persisted `gameConfig` (`{ machineName,
username, rootPassword }`) + boot-flow gating in the app shell + `ui/state.ts`/`seed.ts`
reading the typed values instead of the hardcoded `'alice'`/`'workstation'`.
**Smallest deployable value**: Capture + persist + reflect the three fields; no FS generation
yet (the static `seed.ts` tree just uses the typed name/username). Unblocks Story 1.
**Why first (DECIDED)**: v2 has NO intro screen / persisted config today (identity is
silently auto-created). Story 1 consumes these typed values, so they must exist first.
Building it inside Story 1 would make a multi-concern PR (the planning skill warns against
bundling UI + generator).

### Story 1 — Seeded own-workstation base filesystem — ✅ SHIPPED (PR #196)

**Actor**: Player, on their own workstation.
**Trigger**: Game loads / `ls`, `cat` against the workstation FS.
**Observable outcome**: The workstation tree (minimal skeleton: `/etc/passwd`,
`/home/<username>`, `/root`, `/tmp`) is **generated deterministically from the identity
seed** instead of a hand-written static constant. Same identity → identical tree.
`/etc/passwd` carries root (real `md5(rootPassword)`), the player user, and a seed-derived
`guest` account.
**Production path**: new pure generator (`core/generation/*`: PRNG port + md5 port +
`buildWorkstationBaseFs(seed, config)` + `generatePasswd`) → emits a `Directory` → existing
`applyPatches`/`fsView` → existing `ls`/`cat`.
**Smallest deployable value**: Replace the static base tree with a seeded one; zero new
commands. Establishes the generator primitives every later story reuses.
**Depends on**: Story 0 (typed machineName/username/rootPassword).
**Decided scope**: minimal skeleton only (NOT `/bin` tools, `/lib`, logs, dotfiles — those
land when a command consumes them); real md5 hashes; include the guest row.

### Story 1.5 — `apt install` actually installs a tool — ✅ SHIPPED

**Actor**: Player on their online workstation.
**Trigger**: `apt install <pkg>` (e.g. `apt install nmap`).
**Observable outcome**: A package's binary (or binaries) appear in `/usr/bin`, and a command that
was previously `command not found` (with the install hint) now runs. `apt` reports the install.
**Production path**: new `apt` command → consults `APT_PACKAGES` (`core/commands/aptPackages.ts`)
→ writes the binary stub(s) to `/usr/bin` through the existing write/patch path → the existing
binary-availability wrapper now resolves the command.
**Smallest deployable value**: `apt install <known-pkg>` installs its binary; the gated command
becomes runnable. (Scope of subcommands / online-gate / lib-deps decided in its own plan.)
**Why now (DECIDED 2026-06-04)**: replaces the earlier "preinstall nmap in `/usr/bin`" hack.
`apt install` is the real reachability mechanism and unblocks every gated tool, not just nmap.
Decouples tool acquisition from the scan slice. Graduates to `plans/apt-install.md`.

### Story 2 — A reachable single-layer LAN you can scan — ✅ SHIPPED (PRs #211–#213)

**Actor**: Player on a connected LAN.
**Trigger**: a recon command (legacy parity: `nmap <subnet>` host-discovery, e.g. `-sn`).
**Observable outcome**: Player runs recon and sees a deterministic list of generated hosts
in the current layer — IP, hostname, kind (`machine`/`router`), with `.1` as the gateway.
**Production path**: subnet/IP generator + 1-layer topology builder (`SubnetLayer`) +
minimal addressing/"current layer" concept + the recon command rendering the layer.
**Smallest deployable value**: One flat layer, host-discovery only (no ports). First time
topology + addressing become real and observable.
**Depends on**: Story 1 (PRNG + generator scaffolding) **and Story 1.5** (`apt install nmap`
makes the recon tool reachable). Also resolves the RFC 1918 variety conflict (design note 1).

### Story 3 — Enter a generated machine and browse its base FS — ✅ SHIPPED (via the SSH epic, #219–#228)

**Actor**: Player who scanned the LAN.
**Trigger**: a connect path to a scanned IP (command TBD in that story's plan).
**Observable outcome**: Player connects to a host from the scan and `ls`/`cat`s **that
machine's** generated base filesystem (`/etc/hostname`, `/home`, ...).
**Production path**: per-machine base-FS generation (reuse Story 1 builder) + addressing →
retarget the existing `FsView`/`cwd` to the remote machine's tree.
**Smallest deployable value**: Browse one remote machine's FS read-only; no auth, no ports.
Proves per-machine base-FS generation end-to-end and reuses `FsView`.
**Depends on**: Stories 1 + 2.

### Story 4 — Multi-layer depth (2–3 layers, inner gateways, switch sub-kind) — 🚧 REMAINING

**Actor**: Player pivoting inward.
**Trigger**: scanning from a deeper position after entering a gateway.
**Observable outcome**: Scanning from layer 0 shows only layer-0 hosts + the gateway;
after entering the gateway machine, scanning reveals the next layer. Introduces the
`router` vs `switch` gateway distinction and the dual-homed gateway shape.
**Production path**: extend topology builder to 2–3 layers + inner gateways + the
"see only your layer + its gateway" visibility rule, wired through the recon command.
**Smallest deployable value**: Depth + the visibility invariant; still no ports/firewalls.
**Depends on**: Stories 1–3.

---

## Sequencing rationale

1 establishes the pure primitives behind an already-observable surface (lowest risk).
2 makes topology+addressing observable via one recon command. 3 makes per-machine FS
observable by reusing `FsView`. 4 adds depth + the gateway taxonomy last, once the flat
case is proven. Each story is one PR; stories 2–4 each graduate to their own
`plans/<slice>.md` when reached.

---

_Stories 0–3 + 1.5 are SHIPPED (see "Progress" at top). Remaining before this file can be deleted:
**Story 4** (multi-layer depth) and a decision on the **cross-player shared machine record** (its own
Story here or a new epic) — the latter is the prerequisite for `scan-logging-cross-player.md` Slice 3b
and the cross-player read-path. Fold each remaining piece into its own `plans/<slice>.md` when started._
