# Epic Story-Split: Machine / Network Generator (v2)

**Status**: Proposed split — awaiting sequencing confirmation
**Type**: Epic decomposition (not yet a PR plan). The first child story graduates to its
own `plans/<slice>.md` once this sequencing is approved.

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

| Concept           | This epic                                                       |
| ----------------- | -------------------------------------------------------------- |
| Determinism       | Seeded PRNG (Mulberry32 + FNV-1a), ported verbatim from legacy |
| Machine kind      | `'machine' \| 'router'`                                        |
| Gateway sub-kind  | `'router' \| 'switch'` (only matters at layer depth)          |
| Topology          | 1–3 `/24` layers; `.1` = gateway; "see only your layer"       |
| Per-machine FS    | Uniform minimal skeleton (`/etc/passwd`, `/home`, `/root`, `/tmp`, `/bin`) — NO role templates |
| Addressing        | Private subnets (RFC 1918) + per-machine IPs                   |

### Explicitly OUT of this epic (later epics)

Ports/services, CVEs/vuln timelines, NAT/iptables/SNMP/ACL firewalls, DNS zones,
credential leaks, web content, forensics, dpkg version overlay, role-specific FS templates
(webserver/database/etc.), auth (ssh/su/hydra), missions, and anything multiplayer/server-
authoritative. Generation in this epic is **client-side and pure** — it produces in-memory
data the existing read path consumes.

## Reusable spine (port, don't reinvent)

- `prng.ts` — Mulberry32 + FNV-1a. Pure. **Port verbatim.**
- The `SubnetLayer` shape and `.1`-gateway / layer-visibility invariants from legacy
  `src/generation/topology.ts` — port the *shape*, simplified to 2 kinds.
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

### Story 0 — Intro screen: name your workstation **(now FIRST — prerequisite)**

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

### Story 1 — Seeded own-workstation base filesystem **(walking skeleton)**

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

### Story 2 — A reachable single-layer LAN you can scan

**Actor**: Player on a connected LAN.
**Trigger**: a recon command (legacy parity: `nmap <subnet>` host-discovery, e.g. `-sn`).
**Observable outcome**: Player runs recon and sees a deterministic list of generated hosts
in the current layer — IP, hostname, kind (`machine`/`router`), with `.1` as the gateway.
**Production path**: subnet/IP generator + 1-layer topology builder (`SubnetLayer`) +
minimal addressing/"current layer" concept + the recon command rendering the layer.
**Smallest deployable value**: One flat layer, host-discovery only (no ports). First time
topology + addressing become real and observable.
**Depends on**: Story 1 (PRNG + generator scaffolding).

### Story 3 — Enter a generated machine and browse its base FS

**Actor**: Player who scanned the LAN.
**Trigger**: a connect path to a scanned IP (command TBD in that story's plan).
**Observable outcome**: Player connects to a host from the scan and `ls`/`cat`s **that
machine's** generated base filesystem (`/etc/hostname`, `/home`, ...).
**Production path**: per-machine base-FS generation (reuse Story 1 builder) + addressing →
retarget the existing `FsView`/`cwd` to the remote machine's tree.
**Smallest deployable value**: Browse one remote machine's FS read-only; no auth, no ports.
Proves per-machine base-FS generation end-to-end and reuses `FsView`.
**Depends on**: Stories 1 + 2.

### Story 4 — Multi-layer depth (2–3 layers, inner gateways, switch sub-kind)

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

_Delete this file when the epic's stories are all planned + shipped (or fold remaining
stories into their own plan files)._
