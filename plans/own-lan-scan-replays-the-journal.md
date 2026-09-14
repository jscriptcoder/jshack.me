# Plan: an own-LAN scan replays the journal

**Branch**: `feat/phase3-a-sibling-scan-tells-the-truth` (S1), then `feat/phase3-the-gateway-scan-tells-the-truth` (S2)
**Status**: Active — **S1 SHIPPED v0.216.0 (#500, merged 2026-09-14)**. S2 is next, cut fresh from
trunk. Do not re-do S1: `resolveSameLanScan` exists, the client routes to it through
`lanHostResolver`, `scripts/testSameLanScan.ts` covers it, and Act 16 step 14 is green.
**Epic**: [`legacy-parity-epic.md`](./legacy-parity-epic.md) — a cross-cutting fix, not one of the
nine Phase 3 slices. Decisions 40-43 were settled at this planning session and are recorded in the
epic. This plan implements them and does not reopen them.
**Delivery**: TWO independent PRs against `main`, in order (decision 40). Behaviour change, TDD.
S2 starts from merged trunk after S1 lands — not a stack.

## Goal

`nmap` stops lying about the player's own LAN. A single-host scan resolves server-side against the
target's own journal, so a box that was patched, bricked, backdoored, filtered or shut reads as what
it actually is — to the player who changed it and to every occupant beside them.

## Why now

This is one defect with four recorded faces, open since D5 (2026-08-22) and documented in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) under *"An own-LAN `nmap`
replays no journals"*. The client resolves an own-LAN scan from seeded trees —
`buildRemoteHostFs` for every NPC sibling, `buildApGatewayBaseFs` for the `.1` AP gateway — while a
PUBLIC-IP scan is server-resolved and replays the target's journal.

| # | Face | Found | Lies about |
|---|---|---|---|
| 1 | A planted `nc` door — or a CLOSED one — is invisible to occupants | D5, Act 14 | somebody else's action |
| 2 | `systemctl stop` on a box you rooted still shows the port open | 2026-08-22 | **the player's own action** |
| 3 | An `snmpset` filter or forward on `.1` changes the public scan, not the LAN one | D8 e2e, 2026-08-31 | the gateway every occupant shares |
| 4 | **A package upgraded on an NPC still scans as the old version, with a live CVE** | slice 4 e2e, 2026-09-13 | **the subject of the whole phase** |

Face 4 is why it stops being a backlog item. The first three lie about PORTS; this one lies about
the VERSION and CVE columns, so the recon tool advertises holes the server refuses — verified live:
`redis 7.2.5 / CVE-2026-0597580 critical` in the scan, `[-] Exploit failed — no known
vulnerability` from `msfconsole`, one command apart, against a box whose journal reads
`Version: 7.3.0`.

## Decisions settled at this planning session

Continuing the epic's numbering.

### 40. All four faces close together, and the `.1` gateway is in scope

One change — routing a single-host own-LAN scan server-side — closes all four, because all four are
the same missing journal replay. Splitting by face would mean shipping the same endpoint twice.

The `.1` AP gateway is included even though it is a different builder
(`buildApGatewayBaseFs`) at a different vantage, because leaving it out knowingly preserves face 3
on the one box every occupant of a network shares. It is a second slice rather than a second PR of
one slice: the gateway answers through `scanResult` at the `sameLAN` vantage and has its own
`canBoot` question, so its observable is distinct.

Rejected: fixing only the VERSION/CVE columns. `readOpenPorts` deliberately answers ports and
versions **from the same read** so a scan can never name a version and a hole belonging to
different software; splitting that into a journal-aware half and a seeded half would reintroduce
exactly the drift that comment exists to prevent.

### 41. A failed resolution reports the host UP with no port table

The `resolveOccupant` precedent, and its reasoning ports exactly: the host list has already placed
this box on the LAN, so collapsing our own failed round trip into "down" would blame a live
neighbour for our outage. `null` means *we could not ask*.

Falling back to the seeded local read was rejected: the fallback is precisely the lie being fixed,
and it would be silent — the player could not tell a resolved table from a seeded one, which is
worse than an absent table.

### 42. The verified signature is the whole authorization

Matching `resolveInnerGatewayScan`, whose own comment settles it: *"the gateway and the chain behind
it belong to the access point, so every occupant scanning this address is scanning one box."* NPC
siblings and `.1` are ESSID-seeded and shared by every occupant of that network, so the same
reasoning holds without amendment, and diverging would put two different postures on two scan
endpoints sitting beside each other.

**Recorded delta, accepted knowingly:** an ESSID is readable from `airodump-ng` WITHOUT cracking it,
so a crafted client could learn what players have DONE to a network's NPCs without ever joining.
Today that leaks nothing, because the client computes NPC state from a seed anyone can compute.
After this change it leaks journal state. It is the same exposure `resolveInnerGatewayScan` already
accepts, the LAN is not a secret once its name is on the air, and the alternative costs an occupancy
lookup on every single-host scan. Revisit if a mission ever makes NPC state valuable before entry.

### 43. Only single-IP scans resolve — a range needs no journal

The recorded open question was *"route single-IP scans only or batch a range, since a `/24` would
otherwise resolve up to 253 journals"*. It answers itself in the code: `resolveHostPorts` is passed
only to `scanSingle` (`nmap.ts:462-465`), so a RANGE scan prints `IP / HOSTNAME / KIND` and no
ports at all. Confirmed live — `nmap 192.168.211.1-254` returned twelve hosts and not one port.

There is no 253-journal problem to solve, and no batching endpoint to design. Single-IP only,
matching the inner-gateway precedent exactly. **This retires the blocker that deferred this work.**

## Acceptance Criteria

**S1 — a sibling scan tells the truth** ✅ **SHIPPED v0.216.0 (#500)**

- [x] `nmap <ip>` / `nmap -sV <ip>` against an NPC sibling on the player's own LAN resolves through
      a new `resolveSameLanScan` action that replays that machine's journal over its seeded base.
- [x] A package upgraded on that NPC reports the NEW version, and no CVE against it (face 4).
- [x] A listener planted on that NPC shows as an open `unknown` port; one removed stops showing
      (face 1).
- [x] A service stopped with `systemctl stop` on that NPC stops showing (face 2).
- [x] A bricked NPC (`rm /boot/vmlinuz`) reports host down with no ports, as the inner gateway does.
- [x] **The player's OWN address still resolves locally and issues NO request** — a runtime `sshd`
      still shows up, and the existing "own box costs no round trip" guarantee is unchanged.
- [x] A failed round trip reports the host UP with no port table, never down (decision 41).
- [x] A RANGE scan is untouched: no ports, no round trips, no journals (decision 43).
- [x] Whatever trace an own-LAN scan leaves today it still leaves — none added, none lost.
- [x] Wire-check `scripts/testSameLanScan.ts` proves the endpoint live against `vercel dev` +
      supabase.
- [x] Version bumped in `v2/package.json` **and** `v2/package-lock.json`.

**What S1 left behind, for S2 to build on.** `resolveSameLanScan.ts` finds the host on the ESSID's
generated LAN, resolves it through `resolveLanHostIdentity`, replays the journal with
`materializeMachineFs`, gates on `canBoot`, and answers `readOpenPorts`. The `.1` gateway falls
through it today because a router is not `kind === 'machine'` — **that fall-through is S2's seam**:
the gateway needs `scanResult` at the `sameLAN` vantage instead of the plain port read, which is the
whole reason it is a second slice. Client-side, `lanHostResolver` in `nmap.ts` holds the precedence
(own box → occupant → inner gateway → sibling, `.1` falling through); S2 adds the `.1` arm there.
The mutation gate took the handler to 100% and the refactor the plan predicted landed as its own
commit. One pre-existing survivor was found and deliberately NOT fixed: `networkApi.ts:94`
(`parsed.success ? … : null` in `joinHomeNetwork`, from #330) — unrelated to this plan, recorded in
#500's body, still open.

**S2 — the gateway scan tells the truth**

- [ ] `nmap -sV <subnet>.1` resolves the AP gateway through the same action, replaying its journal.
- [ ] An `snmpset` filter or forward written by any occupant changes what an occupant's own scan
      shows, so the LAN view and the public view stop disagreeing (face 3).
- [ ] A listener planted on `.1` is visible to every occupant scanning it (face 1, on the shared box).
- [ ] A bricked gateway reports host down.
- [ ] The `sameLAN` vantage rule is UNCHANGED: the gateway's own services only, never the NAT
      forward table — that split belongs to `scanResult` and this slice does not touch it.
- [ ] The wire-check covers the gateway case.
- [ ] Version bumped in both files.

## Slices

### Slice S1: a sibling scan tells the truth

**Value**: The player's recon tool stops contradicting the server. A defender who patches a box they
hold can confirm it; an attacker stops being sent at holes that are already closed. It is the slice
that makes slice 4's loop legible from the outside.
**Actor / trigger / observable**: a player on a cracked LAN → `nmap -sV <sibling ip>` → a port table
that matches what the box actually is.
**Path**: `nmap` single-host → `env.scan.resolveSameLan(essid, ip)` → `api/network.ts` →
`handleResolveSameLanScan` → `resolveLanHostIdentity` (machine id + seeded base) → `findPatches` →
`materializeMachineFs` → `canBoot` → `readOpenPorts(fs, { gameDay })` → the existing
`scanResolvedHost` renderer.
**Class**: Behaviour change.
**Delivery**: Independent PR against trunk. No stack.
**Required implementation skills**: `tdd`, `testing`; `refactoring` if the three server-resolved
scan paths earn a shared shape once the third exists — they may; `mutation-testing` at PR readiness.
**Reduction program**: N/A.
**Transition/terminal evidence**: N/A.

**Acceptance criteria**: the S1 list above, in full — all met, see #500. *(Historic below.)*

**RED**: Six increments, each failing first. The load-bearing ones are the patched-version case
(face 4), the own-box path staying local and request-free, and the failed round trip reporting up
rather than down.
**GREEN**: The minimum for each. No batching, no range resolution, no occupancy check.
**REFACTOR**: Assess whether `scanInnerGateway`, `scanOccupant` and the new sibling path collapse
into one `scanResolvedHost` caller shape — three call sites of one renderer is the existing pattern,
and a third is where duplication usually announces itself.
**PRE-PR MUTATION**: One Stryker run over the new handler, the `nmap.ts` resolution branch and the
adapter. Conventions §4: `npm run encode` first, scope the RUNNER not just `--mutate`,
`--reporters json,progress`, read `reports/mutation/mutation.json`, and read the timeout column.
**PR-ready when**: every S1 criterion is met, the mutation gate is run and its valuable survivors
addressed, `npm run typecheck` and `npm run lint` pass, the complete non-watch suite is green, and
`testSameLanScan.ts` passes live. Owner approves the commit.
**Slice complete when**: the PR lands.

### Slice S2: the gateway scan tells the truth

**Value**: The one box every occupant of a network shares stops answering two different ways
depending on who is asking and from where. It closes the face D8 could only close at the contract
level.
**Actor / trigger / observable**: any occupant → `nmap -sV <subnet>.1` → a port table that reflects
the filters and forwards written to that gateway.
**Path**: the same action, with `buildApGatewayBaseFs` as the base and `scanResult` at the `sameLAN`
vantage as the reader.
**Class**: Behaviour change.
**Delivery**: Independent PR against trunk, cut after S1 merges. No stack.
**Required implementation skills**: `tdd`, `testing`; `mutation-testing` at PR readiness.
**Reduction program**: N/A.
**Transition/terminal evidence**: N/A.

**Acceptance criteria**: the S2 list above, in full. **Confirm with the owner before any code.**

**RED**: Three increments. The load-bearing one is an `snmpset` filter changing the LAN scan, which
is the assertion D8 could not make.
**GREEN**: The minimum. The vantage split is not touched.
**REFACTOR**: Assess only if S1's shared shape did not already absorb this.
**PRE-PR MUTATION**: One run over the gateway branch and whatever S1 left uncovered.
**PR-ready when**: every S2 criterion is met, the gates pass, and the wire-check covers both cases.
**Slice complete when**: the PR lands.

## Increments

### S1 (RED → GREEN order inside the one PR)

1. **The handler, on the happy path.** `handleResolveSameLanScan`: verify the envelope, resolve the
   host's identity, replay its journal, answer its ports. *RED*: a sibling whose journal moved a
   package version answers the NEW version and no CVE; an untouched sibling answers exactly what the
   seeded read answers today.
2. **Down, and dark.** *RED*: an address no host occupies answers host-down; a bricked sibling
   (`/boot/vmlinuz` tombstoned) answers host-down rather than an empty port list.
3. **The client routes — and only where it should.** *RED*: a sibling address goes through
   `env.scan`; the player's OWN address does not and issues no request at all; a range scan issues
   none either.
4. **The degrade.** *RED*: a failing resolution renders the host UP with no port table, and never
   as down (decision 41).
5. **The other three faces.** *RED*: a planted listener shows; a removed one stops showing; a
   `systemctl stop`ped service stops showing. These are the same replay proving itself on the
   journal rows D5 and D8 wrote.
6. **Live.** `scripts/testSameLanScan.ts` against `vercel dev` + supabase, plus the version bump.

### S2 (RED → GREEN order inside the one PR)

1. **The gateway resolves.** *RED*: `.1` answers from its replayed journal; the vantage still hides
   the NAT forward table.
2. **The filter bites both ways.** *RED*: an `snmpset` filter changes what an occupant's scan shows,
   matching what the public scan already showed.
3. **Bricked, and live.** *RED*: a bricked gateway answers down. Then the wire-check extension and
   the version bump.

## Forced rather than chosen (planning should not re-litigate)

- **The reader does not change.** `readOpenPorts` and `scanResult` already answer correctly for
  whatever tree they are handed — `generatedBoxDoors.test.ts` pins that a stopped port is gone. The
  defect is the TREE, never the reader, so this slice changes what is passed in and nothing else.
- **The identity derivation already exists.** `resolveLanHostIdentity(host, essid)` returns the same
  `machineId` + seeded `baseFs` the client, the `ssh` gate and the inner-gateway scan already agree
  on. Nothing new keys a machine.
- **The renderer already exists.** `scanResolvedHost` backs both `scanInnerGateway` and
  `scanOccupant`; the sibling path is its third caller, not a new display.
- **Fellow PLAYERS are already correct** and stay on `resolveOccupant`. This slice is about NPC
  siblings and `.1` — the boxes the ACCESS POINT owns.
- **Deep-layer scans are already server-side** and are not touched; `resolveInnerGatewayScan` keeps
  its own endpoint, because an inner gateway is scanned from the upstream side at a different
  vantage.

## Folded in as routine (recorded so they are not re-decided)

- **One action, both box kinds.** The gateway is a branch inside `resolveSameLanScan`, not a second
  endpoint — the caller asks the same question about the same LAN, and `api/*.ts` files are Vercel
  functions, so a second file is a second published route for one question.
- **`gameDay` comes from the server's own clock**, as every other scan action does, so a client
  cannot ask what a box looked like on a day it chooses.
- **No new trace.** An own-LAN scan's tracing behaviour is whatever it is today; this slice moves
  where the ports are computed, not who gets told about it.

## Risks this slice carries

- **Every single-host own-LAN scan now costs a round trip.** `nmap` already paces its output
  deliberately, so the latency should be invisible, but offline play degrades from "a seeded table"
  to "no table" — which is decision 41 working as designed, and worth watching in the browser act.
- **The own-box branch is one `if` away from disappearing.** A mutant making the routing
  unconditional would change no output, only how chatty the client is — the exact mutant the
  conventions doc records surviving everything else in D5's backdoor work. Increment 3's
  no-request assertion is what kills it, and it must assert REQUESTS, not lines.
- **Three scan endpoints now sit beside each other** with three vantages and three degrade rules.
  The refactor step exists to stop that becoming three subtly different postures.
- **Wire-check first, browser act second.** The lesson this defect has already taught twice is that
  a green wire-check cannot see a client-rendered tree. `testSameLanScan.ts` proves the endpoint;
  only a browser act proves the scan a player reads. **The act already exists**:
  [Act 16](../v2/docs/e2e-shared-network-verification.md) in the runbook, whose step 14 is written
  as a KNOWN FAILURE against today's build. S1's close-out re-runs steps 9-14, flips step 14 into
  the act's headline assertion, and deletes the paragraph that explains why it fails. S2's close-out
  adds the gateway case beside it.

---
*Retire this plan into [`legacy-parity-epic.md`](./legacy-parity-epic.md) when both PRs have landed,
and delete the file — as D3-D10, X1 and the Phase 3 slices each were. The epic's phase-plan block
gains a line for it, and the four-face gotcha in `conventions-and-gotchas.md` is rewritten as
CLOSED.*
