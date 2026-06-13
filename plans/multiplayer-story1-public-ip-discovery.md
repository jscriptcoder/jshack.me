# Plan: Story 1 — Cross-player public-IP discovery (walking skeleton)

**Branch**: feat/v2-crossplayer-public-ip-discovery
**Status**: Active — schema-flip timing RESOLVED (deferred to Story 3, 2026-06-13). Two slices: 1a, 1b.
**Parent epic**: `plans/multiplayer-crossplayer-epic.md` (Story 1)

## Goal

Joining a home network registers your workstation as a server-persisted record under your
network's public IP; a **different** player's `nmap <your public IP>` resolves it server-side and
returns its real open ports (the sshd you actually started).

This is the irreducible cross-player whole: it burns down all three architecture risks at once —
(a) the public-IP registry, (b) server-side resolution of one identity's scan against another's
machine, and (c) reading another player's *real* record rather than a per-viewer regeneration —
behind the thinnest observable behavior, demonstrable with two browsers.

---

## Key planning decision (RESOLVED 2026-06-13) — the patches schema flip is DEFERRED to Story 3

The epic framed Story 1 as "flip the `patches` PK from `(player_key, machine_id, path)` →
globally-shared `machine_id` row with `owner_key` + `player_key`-as-provenance." **Grounding the
code shows that flip is not required until Story 3**, and Story 1 is materially thinner without it:

- A player's own-workstation rows are stored under `(player_key = A, machine_id = A's workstation)`.
  For A's **own** box, A is the only writer — so those rows already ARE the canonical record.
- The cross-player **read** (Story 1 port resolution, Story 2 file read) only needs to read A's rows
  *by* `(machine_id, player_key = owner_key)`. The new registry stores `owner_key` (A's verified
  pubkey), so the resolver queries A's existing per-viewer rows directly. **No PK change.**
- Dropping `player_key` from the PK is only needed when **B WRITES to A's machine** (Story 3): B's
  write must land on A's shared row regardless of B's identity. That is the motivating behavior for
  the flip — so the flip belongs in Story 3, where it is testable and not speculative.

**Recommendation: defer the flip to Story 3.** Story 1 = the registry + a read against the existing
schema. This keeps the walking skeleton thin, avoids a behavior-preserving migration slice the epic
itself cautioned against ("don't relabel the schema flip as its own story — it has no observable
behavior alone"), and lands the migration exactly when cross-player writes need it.

> If we instead flip now, this plan gains a third slice (1c: a behavior-preserving migration — add
> `owner_key`, drop `player_key` from the PK, rewrite ~6 read/write call sites in `api/patches.ts`,
> keep every existing own-workstation/ssh/auth.log/scan-log test green). It adds risk and no new
> observable behavior in Story 1. Recorded here as the alternative; **see the question posted
> alongside this plan.**

The slices below assume the **recommended** path (flip deferred). `owner_key` lives only in the new
registry for now; `patches` is untouched.

---

## Shipped foundations this plan builds on (do NOT re-port)

- **`sshd`** (`core/commands/sshd.ts`) — root-gated; writes `/var/run/sshd.pid` (`sshd:port=22`) as a
  patch via `env.patches.write`. **"Open sshd on your own workstation" is already player-reachable**
  (`su` → `sshd`). The epic's open service-assumption is CONFIRMED closed.
- **`readOpenPorts`** (`core/services/pidfile.ts`) — turns a tree's `/var/run/*.pid` files into
  `{ port, service }[]`. The single source of truth for "what ports are open"; reused by the resolver.
- **`buildWorkstationBaseFs`** (`core/generation/workstationFs.ts`) — ships `/var/run` **empty**, so
  open ports come EXCLUSIVELY from runtime pidfile patches. The resolver needs only A's patch rows
  under `/var/run/`, not a base-FS regeneration (and thus not A's `GameConfig`).
- **`assignHomeNetwork` / `generatePublicIp`** (`core/network/homeNetwork.ts`, `core/generation/ip.ts`)
  — deterministic, ESSID-seeded `publicIp` on `HomeNetworkAssignment`. Server-computable from essid;
  the client never claims it.
- **`env.homeNetwork.join`** seam (`ui/env.ts`, `core/commands/types.ts` `HomeNetworkApi`) —
  `Promise`-shaped local stand-in today (`Promise.resolve(assignHomeNetwork(...))`). The documented
  future `/api/join-home-network` round-trip; `nmcli connect` already awaits it, so latency surfaces
  without a UI change.
- **`env.scan.record` → `recordScan` adapter → signed `nmapScan` action** (`core/scan/nmapScan.ts`,
  `api/patches.ts`) — the established "command → ScanApi method → signed adapter → core handler"
  pattern the new resolution action mirrors exactly.
- **Signed-request envelope** (`core/signedRequest/verify.ts`, `verifySignedRequest`) — server stamps
  `player_key` from the verified Ed25519 pubkey; clients never claim identity. The registry's
  `owner_key` and the resolver's caller identity both come from this, never from the body.
- **`computeWorkstationId`** (`core/identity/workstation.ts`) — `${name}-${sha256('ed25519:'+pubkey)[0..8]}`.
  The client knows its own `session.machineId`; join sends it, server records it next to the verified
  `owner_key`. (A forged machine_id only registers a row pointing at patches that aren't yours —
  self-defeating, harmless.)

## Acceptance Criteria (Story 1 overall)

- [ ] After A runs `nmcli connect`, a server-side registry row exists keyed by A's public IP,
      carrying `owner_key` (A's verified pubkey) and A's workstation machine_id (verified end to end,
      two identities).
- [ ] A **different** identity B running `nmap <A's public IP>` reports the host **up** (resolved
      server-side from the registry, NOT a B-side regeneration).
- [ ] B running `nmap <an unregistered public IP>` reports the host **down** / no host.
- [ ] After A does `su` → `sshd`, B's `nmap <A's public IP>` lists `22/tcp open ssh`; before A starts
      sshd, B's scan shows the host up with **no** open ports.
- [ ] A's own-subnet `nmap` (existing behavior) is unchanged.
- [ ] The resolver response exposes only what B's client renders (host up/down, hostname, ports) —
      no `owner_key`/internal fields leak (memory `feedback_minimize_api_projections`).
- [ ] The degenerate NAT is stored as a value, not a shape: the registry row carries
      `{ routerMachineId, forwardTable }` from the start, `forwardTable` = "all → workstation" — so
      Story 5 swaps the value with no schema rework (epic Warning).

## Testing approach (per CLAUDE.md + `feedback_e2e_test_new_primitives`)

- **Unit (vitest)** for every pure layer: the registry-write handler, the resolution handler, the
  `isPublicIp`/target-classification logic, and `nmap`'s public-IP routing/rendering.
- **Integration / E2E through the real UI** for the cross-player seam (A registers → B resolves →
  ports), watching the network tab. The memory is explicit: past effects shipped green-in-units but
  with latent integration bugs at the effect → session → patch → DB seam. The two-identity round-trip
  is exactly such a seam and MUST be exercised end to end before "done" (E2E is reserved for this
  browser-only/multi-identity flow per `feedback_e2e_scope`).
- **No fake delay on the real round-trip** (`feedback_real_latency_over_fake_delays`): a public-IP
  scan's latency IS the server round-trip; do not stack `nmap`'s `SCAN_DELAY_MS` on top. Own-subnet
  scans keep their existing local pacing.

---

## Slices

Every slice follows RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR. No production code without a failing
test. Before code changes for each slice, load `tdd`, `testing`, `mutation-testing`, `refactoring`
(plus `api-design` for the new endpoint/adapter shapes). v2 has no Prettier — `npm run lint` is the
format gate (`project_v2_no_prettier_format_gate`); don't run Stryker with the dev server up
(`project_v2_stryker_devserver_contention`).

### Slice 1a: A different player's `nmap <A's public IP>` resolves server-side to "host is up"

**Value**: The first cross-player observable ever in v2 — B sees that A's network EXISTS at its public
IP, resolved entirely server-side. Burns down the registry + register-on-join + server-resolution +
nmap-routing risks together. (This is the heaviest slice — the walking skeleton — and is expected to
land as one PR with several internal TDD commits.)

**Path**: `nmcli connect` (A) → `env.homeNetwork.join` becomes a signed `/api/...` round-trip →
server verifies envelope, computes the assignment, **upserts the registry** (`public_ip` server-derived
from essid; `owner_key` = verified pubkey; `workstation_machine_id` from the request) → returns the
assignment (unchanged shape). Then `nmap <public IP>` (B) → B's client classifies the target as a
public IP (not its own `/24`) → routes to a new `env.scan.resolvePublic` round-trip → server looks up
the registry by `public_ip` → returns `{ found, hostname }` → `nmap` renders "host is up" / "Host
seems down". Own-subnet scans keep the existing local path untouched. **No `patches` change.**

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`, `api-design`.

**Acceptance criteria** (present + confirm before coding):
- New `network_registry` migration: `public_ip` (PK), `owner_key`, `workstation_machine_id`,
  `router_machine_id`, `forward_table` (JSONB), `essid`, timestamps. RLS enabled, no policies
  (service_role-only, mediated by the function — mirrors `patches`/`sessions`).
- A new signed `registerNetwork` action (core handler `core/network/registerNetwork.ts`, pure +
  unit-tested) verifies the envelope, computes `public_ip = generatePublicIp(essid)` server-side
  (never client-claimed), stamps `owner_key` from the verified pubkey, and upserts the registry row.
  The `env.homeNetwork.join` adapter calls it and returns the (still deterministic) assignment.
- A new signed `resolvePublicScan` action (core handler `core/scan/resolvePublicScan.ts`, pure +
  unit-tested) verifies the caller's envelope, looks up the registry by the target IP, and returns
  `{ found: boolean, hostname?: string }` — and NOTHING else.
- `nmap`: a target that is a valid public IP and not on the player's own subnet routes to
  `env.scan.resolvePublic`; a found result renders the existing "Nmap scan report … Host is up."
  shape; not-found renders "Host seems down."; a foreign **private** subnet still errors "out of
  range" (existing behavior preserved).
- End-to-end (two identities, real UI): A joins → B `nmap <A.publicIp>` → host up; B
  `nmap <random public IP>` → host down; A's own `nmap <own subnet>` → unchanged.

**RED**: (1) `registerNetwork` handler test — a signed join request yields a registry upsert with
server-stamped `owner_key` + server-derived `public_ip`, and REJECTS a client-supplied `player_key`/
`public_ip` (mirrors `nmapScanSchema`'s refine). (2) `resolvePublicScan` handler test — a registered
IP returns `{ found: true, hostname }`; an unregistered IP returns `{ found: false }`; the response
contains no `owner_key`/internal fields. (3) `nmap` test — a public-IP target calls
`env.scan.resolvePublic` and renders host-up/host-down from its result; a foreign private subnet
still returns "out of range"; an own-subnet scan does NOT call the resolver. Mutator watch
(`resources/mutator-rules.md`): the public-vs-private/own-subnet conditional (boolean & comparison
mutators), the found/not-found branch, and the schema `refine` (string-literal/optional mutators).

**GREEN**: minimal registry table + the two thin handlers + adapters + the `isPublicIp` classifier +
`nmap` routing. Reuse `verifySignedRequest`, the `recordScan` adapter shape, and the existing nmap
"Host is up/seems down" rendering. Endpoint placement: a thin `api/network.ts` for `registerNetwork`
+ `resolvePublicScan` (keep handlers in typechecked `core/` per `project_v2_api_not_typechecked_locally`).

**MUTATE**: run `mutation-testing` on the new core handlers + nmap routing; produce a report.
**KILL MUTANTS**: strengthen tests for survivors; ask when value is ambiguous (e.g. a registry
read-back projection field with no consumer → drop the field rather than test it).
**REFACTOR**: only if it adds value (e.g. share the target-classification helper between `nmap`
display and any server-side use, as `scanTarget.ts` shares parsing today).
**Done when**: all acceptance criteria met, the two-identity E2E passes through the real UI (network
tab shows the round-trips), mutation report reviewed, human approves commit.

### Slice 1b: B's scan shows A's real open ports (the sshd A actually started)

**Value**: The cross-player discovery payoff — B sees A's REAL runtime port (port 22), read from A's
persisted record, not from a deterministic regeneration. Proves the "another player's real machine"
half of the gate against the existing per-viewer schema.

**Path**: A: `su` → `sshd` writes `/var/run/sshd.pid` (a patch on `(player_key=A, machine_id=A's
workstation)`). B: `nmap <A.publicIp>` → `resolvePublicScan` looks up the registry → reads A's patch
rows by `(machine_id = workstation_machine_id, player_key = owner_key, path under /var/run)` →
`readOpenPorts` → returns the open ports → `nmap` renders the PORT/STATE/SERVICE table.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (present + confirm before coding):
- `resolvePublicScan` is extended to read A's `/var/run/*.pid` patch rows (scoped to the registry's
  `owner_key` + `workstation_machine_id`) and return the parsed open ports — reusing `readOpenPorts`
  so the ports a cross-player scan shows can never drift from what `sshd`/the world generator write.
- The response carries only `{ found, hostname, ports: [{ port, service }] }` — no internal fields.
- `nmap` renders the returned ports as the existing `PORT/STATE/SERVICE` table for a public-IP scan.
- E2E (two identities): A `su` → `sshd`; B `nmap <A.publicIp>` → `22/tcp open ssh`. Before A starts
  sshd, B's scan shows host up, no ports. A starts sshd on a non-default port (`sshd 2222`) → B sees
  `2222/tcp open ssh` (proves it's read from A's real pidfile, not a hardcoded 22).

**RED**: `resolvePublicScan` handler test — given registry row + A's `/var/run/sshd.pid` patch row,
returns the parsed port; given no pidfile patch, returns empty ports; a non-22 port in the pidfile is
reflected (kills a "hardcode 22" mutant). `nmap` test — a public-IP result with ports renders the
port table; with no ports renders none. Mutator watch: the `/var/run` path filter (string/regex
mutators), the empty-ports branch, the port-number passthrough.

**GREEN**: add the owner-scoped `/var/run` patch read to the resolver (a `listMachineRunFiles`-style
query in `api/network.ts`, mirroring `listMachinePatches`' shape but scoped to `owner_key`); thread
`readOpenPorts` over a minimal tree (or parse the pidfile rows directly); render the port table.
**MUTATE**: run `mutation-testing` on the extended resolver + nmap rendering; produce a report.
**KILL MUTANTS**: strengthen for survivors (esp. the non-default-port case and the path filter).
**REFACTOR**: only if valuable (e.g. a shared "ports for a stored machine record" helper if a second
caller appears).
**Done when**: all acceptance criteria met, the non-default-port E2E proves real-record reads,
mutation report reviewed, human approves commit.

> **No 1c under the recommended path.** 1a + 1b satisfy Story 1's acceptance ("B sees port 22
> resolved from A's real record"). If the schema flip is pulled into Story 1 (see Key planning
> decision), add it here as a behavior-preserving migration slice 1c.

## Parking lot / forward-compatibility notes

- **Source IP for the future trace (Story 6).** `resolvePublicScan` should accept/forward a
  `source_ip` (B's public IP for a cross-network scan, per `feedback_log_source_ip_realism`) so
  Story 6's cross-player kern.log trace has it. Plumb the field now (nullable); Story 6 consumes it.
  Do NOT write any log in Story 1 — the per-host `nmapScan` logging (3a) stays on the own-LAN path.
- **Rehydrate on reload.** `restoreConnection` re-derives `localIp` locally and does NOT re-register.
  The registry row persists server-side, so this is fine; decide in 1a whether to also re-register on
  rehydrate to self-heal after a dev DB reset (idempotent upsert on the `public_ip` PK). Lean: skip
  re-register in 1a; revisit if dev-reset friction shows up.
- **Replay/nonce store.** `api/*` uses `noopNonceStore` locally. The real nonce/rate-limit store is a
  cross-player-WRITE concern (Story 3), not needed for these read/register round-trips.
- **Degenerate NAT.** `router_machine_id` is the workstation's own id and `forward_table` =
  "all → workstation" for now. Story 5 makes the router a distinct machine and the forward table
  selective; the registry shape does not change (epic Warning + `project_dual_homed_router_scan_discrepancy`).

## Pre-PR Quality Gate (each slice)

1. Mutation testing — run `mutation-testing` skill (dev server stopped first).
2. Refactoring assessment — run `refactoring` skill.
3. `npm run lint` + `npm run test:run` + `npm run build` green (v2 has no `format`).
4. Two-identity E2E through the real UI passes (network tab verified).

---

_Delete this file when Story 1 is complete; fold any durable learnings into the epic / CLAUDE.md /
memory, then return to `plans/multiplayer-crossplayer-epic.md` for Story 2._
