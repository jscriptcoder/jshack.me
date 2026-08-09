# Plan: a player cracks a stranger's box across the network

**Branch**: `feat/crack-a-strangers-box`
**Status**: Active — planned 2026-08-09, no code written yet.
**Parent**: [`d2-credential-layer.md`](./d2-credential-layer.md) (D2.4) →
[`legacy-parity-epic.md`](./legacy-parity-epic.md) Phase 1.

## Goal

**Cracking reaches other players — the epic's actual point.** Today `hydra` resolves its target
from `generateHomeLan(essid).hosts`, so it can only ever attack the deterministic world the caller
generates for themselves. Every box belonging to another player, and every box behind a NAT
forward, is out of reach.

`ssh` already reaches all of them, through four handlers. hydra must agree with `ssh` about every
one of those targets or the game lies to the player — so this plan is mostly about hydra reusing
`ssh`'s resolution rather than growing its own.

## What grounding established (read 2026-08-09 — every file:line below was opened)

Five facts decide the slicing. The first one **corrects the split's own acceptance example**.

### 1. A public IP's default port reaches the GATEWAY, not the player's box

`machineServing({ routerFs, port })` routes by destination port before any occupancy work
(`authCreateSessionPublic.ts:302-308`), and the AP gateway serves its own seeded `sshd:22`. So
`ssh user@<public IP>` with no `-p` lands **on the shared AP gateway** — root-only, its admin
password seeded from the ESSID. Reaching the owner's workstation requires a port they published as
a NAT forward (`resolveForwardTarget`, same file).

D2.4's row in the split reads *"B `hydra <A's public IP> ssh` → cracks A's **guest** account"*.
That cannot happen on the default port: port 22 is the gateway, and the gateway has no guest. The
row conflates two different targets, and they become two different slices here.

This is good news for sequencing. The gateway is the **best root target in the game by design**
(v0.113.0, `f69b05d` — the `gateway` knob is 0.40 against `npcRoot`'s 0.12), so the smallest
cross-player slice is also a genuinely valuable one, and it needs no forward, no lease read and no
occupancy resolution.

### 2. hydra has no port argument, and every remaining target is addressed by port

`hydra <host> [service] [user]` (`hydra.ts:106`, manual at `hydra.ts:138`). A NAT-forwarded box on a
stranger's gateway and a deep host behind an inner gateway are both named **by port** — that is the
whole addressing scheme. `ssh` takes `-p` (`ssh.ts:256`). Without the same flag, three of the four
seams have no way to say what they are attacking.

So `-p` is not polish deferred to the end; it is the address bar for slices 3 and 5.

### 3. The public seam is a ~60-line resolution hydra must not copy

`handleAuthCreateSessionPublic` (`authCreateSessionPublic.ts:266-323`) runs, in order:
`findNetworkByPublicIp` → `materializeApGatewayFs` → `canBoot` (a bricked gateway takes the whole
public IP dark) → `machineServing(port)` → `gatewayTarget` **or** `resolveForwardTarget` (leases →
occupant → `bootableOccupantFs` → is its internal service listening). It yields exactly four things:
`{ fs, machineId, hostname, logWriterKey }`.

Those four are **precisely** what a hydra sweep needs, and the warning in the parent plan is
explicit: *"hydra must never disagree with `ssh`. A hydra that cracks from a locally regenerated
baseline will hand the player a password `ssh` then rejects — and the player will read that as a
broken game."* Two copies of this sequence is that bug waiting to happen. Extract it once, use it
twice.

### 4. The source IP has two right answers, and only one is built

`resolveCrossPlayerSourceIp` (`crossPlayerSourceIp.ts:29`) returns the **actor's own home public
IP**, looked up from their verified key. Its docstring states the assumption plainly:
*"Today the operating machine is always the actor's home box (v2 has no command-vantage switch);
when the pivot feature ships, only this seam changes."*

That assumption is correct while the player stands anywhere on their **own** LAN — NAT means the
target sees the home public IP whichever box you launched from — and it becomes wrong the moment
they stand on a **foreign** box, where the honest answer is that network's public IP.

v0.118.0 gave hydra a vantage. **hydra is therefore the command that makes the anticipated change
due**, and slice 4 is where it lands. Slices 2 and 3 keep the current derivation, which is right
for them.

### 5. A vantage precedent already exists — do not invent a second one

`nmapScanDeep.ts` + `DeepScanRecordParams` (`types.ts:464`) already re-derive a vantage box
server-side from the verified pubkey + a `vantageMachineId`, and derive the trace's source address
from that box rather than from the client (*"the client never names a path, source IP, or
content"*). Slice 4 should follow that shape.

## Acceptance Criteria

- [ ] A player can `hydra <a stranger's public IP>` and crack the AP gateway's root account when
      the roll allows, or be told plainly that it held.
- [ ] `hydra -p <forwarded port> <public IP>` reaches the occupant behind that forward and cracks
      what `ssh` then accepts — the same account, the same password, no disagreement.
- [ ] Every cross-player sweep writes the per-password `Failed password` wall plus any accepted
      line to the **target's** shared `/var/log/auth.log`, at a **server-derived** source IP; a
      client-supplied address is never trusted on a cross-player target.
- [ ] A sweep launched from a box the player is standing on but does not own is traced to **that
      box's** network, not to the attacker's home.
- [ ] hydra reaches a deep host behind an inner gateway, matching `ssh`'s fourth variant.
- [ ] hydra and `ssh` resolve a public target through **one** shared resolver — proved by the
      resolver having two callers, not by a comment.
- [ ] Own-LAN hydra (v0.118.0) is behaviourally unchanged throughout.
- [ ] A `scripts/test*.ts` wire-check passes live with **two identities**.

## Out of scope

- **Growing the wordlist across the network** — already settled and needs nothing here. The read is
  machine-scoped and ownership-blind, and a remote write is tier-gated server-side; see the parent's
  locked decision *"a player's box is a box too"*.
- **Services other than ssh** — each arrives with its own door (ftp with D3, mysql with D6), per the
  epic. D2 ships ssh only.
- **Rate limiting or lockout** as a defender's counter-move — not in legacy, not parity.
- **`AvailabilityRule`** — still inert, still enforce-or-delete, still its own reduction candidate.

## Slices

Five. Slice 1 is a pure refactor that exists to make slice 2 safe; slices 2-5 each ship a target a
player could not previously attack. The order climbs the addressing scheme: no port, then a port,
then a vantage, then a chain.

---

### Slice 1: One resolver decides what a public IP and port reach — ✔ DONE (`1350353`)

**As built.** `core/network/resolvePublicTarget.ts` owns the sequence; the handler keeps the passwd
check, the trace and the session insert. Refusals cross as `{ok:false, status, error}` and are
returned verbatim, mirroring `authorizeMachineAccess`. The port default moved with the routing it
belongs to, so slice 2 cannot fork it.

**Preservation measured, not asserted** — the baseline came from stashing the change and running
Stryker on the original: **96.97% → 97.11%**, with *identical* survivors (2) and *identical*
no-coverage mutants (3); the +8 killed are the result union's own new expressions. 2332/2332 with no
test added, removed or edited beyond an import path. No version bump — `3af0b92`, the last
refactor-only PR, did not bump either.

**Follow-up found, deliberately not taken**: `ApNetworkLookup` and `NatOccupantRow` are declared
**three** times — here, in `resolvePublicScan.ts` and in `resolveHttpFetch.ts`. Same rows, same
tables, three definitions. Its own reduction, unrelated to hydra.

**Known gap inherited, not introduced**: the three no-coverage mutants are `?? []` fallbacks on the
occupants and leases reads — no test supplies a null list. Cheap to close if a later slice touches
those reads.

**Value**: `ssh` keeps behaving exactly as it does, and slice 2 gets to attack the same box `ssh`
would authenticate against — by calling the same code, not by keeping a second copy in step. The
parent's standing warning ("hydra must never disagree with `ssh`") stops being a discipline and
becomes a structural fact.

**Path**: preserved. `handleAuthCreateSessionPublic`'s public surface, status codes and log
behaviour are unchanged; the public-IP → `{ fs, machineId, hostname, logWriterKey }` sequence moves
behind a named seam with the refusal statuses it already returns.

**Class**: Pure refactor.

**Required implementation skills**: `refactoring`, `testing`, `mutation-testing`.
`tdd` is **N/A** — no behaviour changes, so there is no honest RED; fabricating one to assert
module shape is the anti-pattern the skill names.

**Preservation baseline**: `authCreateSessionPublic.test.ts` green before the change, plus the
existing cross-player wire-checks (`testCrossPlayerRouter.ts`, `testSharedApForwards.ts`) — the
`api/` layer is where an extraction can silently drop a dep, and unit tests inject fakes for exactly
those deps.

**Preservation change**: move the sequence; leave the passwd check, the session insert and the
trace write where they are. No new dep, no new status code, no behaviour.

**MUTATE**: Stryker over the extracted module and `authCreateSessionPublic.ts`. The score should not
drop — a fall means the extraction moved a branch out from under its test.

**KILL MUTANTS**: only survivors the extraction newly exposes. Pre-existing survivors are noted, not
adopted.

**REFACTOR**: this slice *is* the refactor. Assess afterwards whether `resolvePublicScan.ts` — which
already shares `bootableOccupantFs`, `lanAddressesByOwner` and `canBoot` — wants the same seam. If
so, record it; do **not** widen this slice to take it.

**Done when**: the resolver has one caller and identical behaviour, both wire-checks pass, and the
human approves the commit.

---

### Slice 2: A player cracks the gateway behind a stranger's public IP — ✔ DONE (v0.119.0, `c9958b7`)

**As built.** `hydraCrackPublic` + an `isPublicIp` dispatch mirroring `ssh.ts:272`. All six
acceptance criteria hold. **Wire-check 8/8 live**, including the layer's central claim: the password
hydra reported was posted to `authCreateSessionPublic`, which accepted it and landed a root session
on the gateway — hydra and `ssh` agreeing on a cross-player target, proven rather than argued.

**The sweep-and-trace half moved to `core/wordlist/passwordSweep.ts`** (one exported
`sweepAccounts`), so both hydra paths share one rule. A second copy would become a second difficulty
curve. hydraCrack's 35 tests stayed green across the move, which is what made it safe.

**Mutation: `hydraCrackPublic` 100% (88/88).** The first run scored 72.7% with 11 uncovered, and the
gaps were real refusals rather than mutant noise — an invalid signature, `service_not_running`, a
wordlist the store could not read, plus the empty-trace and nobody-to-log-under paths.
`passwordSweep` 94.6%: its three survivors are the SAME equivalent classes §4 already records, moved
with the code. `hydra.ts` gained no survivor in the new dispatch.

**A fixture caught a real misunderstanding**: making the attacker the lease holder on the target AP
failed the "never writes under the attacker's key" test — correctly, because the ownerless gateway's
stable log key IS the lowest-octet lease holder. The wire-check now asserts the same against the
real table.

**Follow-up, deliberately not taken**: the new `api/sessions.ts` route copies nine dep builders that
already exist verbatim in sibling blocks — that file now holds ~6 spellings of `findPatches`. The
strongest `api/` reduction candidate on the board, and a much better-scoped PR than a slice.

### Slice 2 (original plan text)

**Value**: the first credential ever earned against a box outside the player's own generated world —
and against the best root target in the game (finding 1). A cracked AP gateway is an entrance to a
whole network of somebody else's.

**Path**: `hydra <public IP>` → client routes on `isPublicIp` exactly as `ssh.ts:272` does → new
signed action → slice 1's resolver (port defaults to 22 → the gateway) → sweep `accountsIn` the
gateway's materialized fs against the caller-machine's wordlist → per-password trace onto the
gateway's shared `auth.log` under `apGatewayLogWriterKey`, at `resolveCrossPlayerSourceIp`.

**Class**: Behaviour change.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before any code):
1. `hydra <a stranger's public IP>` sweeps the gateway's `root` and reports the password when the
   gateway's roll made it crackable; reports `0 valid passwords found` when it did not.
2. The password hydra reports is one `ssh root@<that public IP>` then accepts.
3. The gateway's `/var/log/auth.log` gains one `Failed password` line **per password tried** plus
   the accepted line, at the attacker's home public IP — server-derived, never `payload.source_ip`.
4. A bricked gateway, or a public IP nobody holds, is refused with no trace written at all.
5. The wordlist is still read from the machine the player is standing on (v0.118.0 unchanged).
6. Own-LAN hydra is untouched.

**RED**: `hydraCrackPublic.test.ts` — a stranger's network whose gateway root password is present in
the caller's wordlist; assert the sweep returns it. Fails at first because there is no handler; then
fails for the right reason once the module exists but resolves nothing.

**GREEN**: the new handler = slice 1's resolver + the sweep/trace half already proven in
`hydraCrack.ts`. Client: `isPublicIp` branch → `env.hydra.crackPublic`, mirroring the `ssh` dispatch.

**MUTATE**: Stryker over the new handler. Watch the outcome-classification branch — D2.3's
experience was that `'failure'`/`'success'` in a two-value branch survives whenever the assertion
only checks the other arm.

**KILL MUTANTS**: expect to need a test asserting the **complete** log line sequence rather than a
`toContain` — the parent records exactly this (a `-1` that `toContain('1/2')` still matched).

**REFACTOR**: assess whether the sweep-and-trace half is now duplicated between `hydraCrack` and
`hydraCrackPublic` enough to share. It probably is — but the two differ in writer key and source-IP
derivation, so decide on evidence, not on symmetry.

**Wire-check**: new `scripts/testHydraCrossPlayer.ts`, two identities, using
`seedCrossPlayerTarget.ts` as the existing seeding precedent.

**Done when**: all six criteria hold, the wire-check passes live, and the human approves the commit.

---

### Slice 3: A player cracks the box behind a stranger's NAT forward

**Value**: the row's real acceptance example — reaching the **person**, not their gateway. A forward
a player published so their own box is reachable is the same door an attacker walks through, which
is what makes publishing one a decision rather than a freebie.

**Path**: `hydra -p <port> <public IP>` → the same action as slice 2, now carrying a port → slice 1's
resolver routes to `resolveForwardTarget` → the occupant's fs → sweep → trace on the **occupant's**
machine under their owner key.

**Class**: Behaviour change.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before any code):
1. `hydra -p <forwarded port> <public IP>` sweeps the occupant's accounts, and the guest account
   falls (guest is 1.00 by design, and is what a cross-player login yields — see the parent).
2. Root and user on a player's workstation never fall, because a player's chosen password is not
   in the crackable pool. This is asserted, not assumed.
3. The trace lands on the **occupant's** `auth.log`, not the gateway's.
4. A forward pointing at an address nobody currently leases, or at a bricked box, or at a box whose
   internal service is not listening, is refused with no trace.
5. `-p` on an own-LAN target keeps working as an ordinary port selector, and its absence still means
   the default.
6. The manual documents `-p`.

**RED**: a seeded forward on a stranger's gateway to an occupant with a known guest password;
assert hydra returns it. Fails today twice over — no port argument, no forward path.

**GREEN**: parse `-p` in `hydra.ts` (the `flags.get('-p')` shape `ssh.ts:256` already uses), thread
it into the action, let the resolver route.

**MUTATE**: Stryker over the flag parsing and the port threading. A default-port fallback is a
classic survivor: `?? 22` mutating to a junk value survives any test that only ever passes a port.

**KILL MUTANTS**: a test that omits `-p` and asserts the gateway is reached, beside one that passes
it and asserts the occupant is.

**REFACTOR**: assess only if slices 2 and 3 left the client branch hard to read.

**Wire-check**: extend `testHydraCrossPlayer.ts` with a forward case.

**Done when**: all six criteria hold, the wire-check passes, and the human approves the commit.

---

### Slice 4: An attack launched from someone else's box is traced to their network

**Value**: the pivot mechanic, and the first time an attacker can put distance between themselves
and their trace honestly. It also lifts the last `caller_not_on_lan` refusal, so a rooted box
anywhere becomes a place to work from — the natural end of "tools run where you stand".

**Path**: `hydra` on a box the caller holds a session on but which is not on their generated LAN →
`hydraCrack.ts:263`'s refusal is replaced by a **server-side vantage derivation** in the shape
`nmapScanDeep` already uses (finding 5) → the trace records the standing box's network, not the
caller's home.

**Class**: Behaviour change.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before any code):
1. B, standing on A's box with a live session, sweeps C — and C's `auth.log` names **A's** network,
   never B's.
2. B standing on their own LAN is unchanged: their home public IP for a cross-player target, the
   standing box's LAN IP for an own-LAN target (v0.114.0 + v0.118.0 both preserved).
3. A caller naming a machine they hold no session on is still refused (`no_session`) — L1 is
   untouched.
4. A vantage the server genuinely cannot place still refuses rather than guessing an address. The
   parent's rule stands: a false origin in a defender's log is worse than a refusal.
5. B needs hydra and a wordlist **on A's box** to do any of this — no implicit toolchain.

**RED**: a caller whose `caller_machine_id` is a foreign workstation they hold a session on; assert
the sweep runs and the trace carries that network's public IP. Fails today with
`caller_not_on_lan`.

**GREEN**: derive the vantage's network server-side from the machine id; keep the refusal as the
fallback for an unplaceable vantage.

**MUTATE**: Stryker over the derivation. The `'unknown'` degradation path in
`resolveCrossPlayerSourceIp` is the mutant to watch — it is a plausible-looking survivor that means
"every trace is anonymous".

**KILL MUTANTS**: assert the degraded case explicitly rather than letting it be the untested arm.

**REFACTOR**: this is where `crossPlayerSourceIp.ts`'s docstring promise comes due — the seam should
end up resolving a vantage, with its callers unchanged. Verify that claim rather than restating it.

**Wire-check**: extend `testHydraCrossPlayer.ts` — three parties is the honest test, and
`testCrossPlayerSuElevate.ts` is the precedent for driving more than two.

**Done when**: all five criteria hold, the wire-check passes, and the human approves the commit.

---

### Slice 5: A player cracks a host deep behind their own inner gateway

**Value**: closes the fourth seam, so hydra reaches everywhere `ssh` does. The deep chain is the
multi-layer payoff D1/5b built, and today a player must already know a deep host's password to use
it — which is to say they must have been told, which is what this whole epic exists to end.

**Path**: `hydra -p <forwarded port> <inner gateway IP>` → the inner-gateway action, mirroring
`ssh.ts:305`'s `isInnerGateway(host) && port !== runningPort` dispatch → `machineServing` walks the
forward chain, `canBoot` at each hop → sweep the terminal box → trace on it.

**Class**: Behaviour change.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before any code):
1. `hydra -p <fwd> <inner gateway>` sweeps the deep box behind that forward, not the gateway.
2. A chain of forwards reaches an arbitrarily deep box, as `ssh` already does.
3. A bricked intermediate darkens everything below it — refused, no trace.
4. The deep layers stay private: every box on the chain is regenerated from the **caller's own**
   verified key, so this seam never touches the cross-player lookup.
5. The gateway's own `:22` still attacks the gateway (slice 3's default-port behaviour, unchanged).

**RED**: a seeded forward chain on the caller's own inner gateway to a deep NPC with a crackable
account; assert hydra cracks it. Fails today — the deep box is not in `generateHomeLan().hosts`.

**GREEN**: the inner-gateway resolution, reusing `authCreateSessionInnerGateway`'s walk. Assess an
extraction there the way slice 1 did for the public seam — same reasoning, and if it applies, do it
as this slice's own preparatory refactor rather than inline.

**MUTATE**: Stryker over the chain walk. Depth-limit and loop-termination mutants are the ones a
single-hop fixture cannot kill.

**KILL MUTANTS**: expect to need a **two-hop** fixture, not one.

**REFACTOR**: assess whether four hydra actions now want the registry treatment `ssh`'s four got.

**Wire-check**: extend `testInnerGatewayReach.ts` or add a hydra case beside it —
`testDeepChainReach.ts` is the multi-hop precedent.

**Done when**: all five criteria hold, the wire-check passes, and the human approves the commit.

---

## Pre-PR Quality Gate

Per slice, before asking for a commit:

1. `npx vitest run` — full suite green.
2. `npm run typecheck` (`tsc -b`; a plain `tsc --noEmit` is a NO-OP here) and `npm run lint`.
3. Stryker over the changed files; survivors either killed or recorded as equivalent **with the
   reason read from the consuming code**, and added to the known-equivalent inventory in
   `v2/docs/conventions-and-gotchas.md` §4 if they generalise.
4. Version bumped in **both** `v2/package.json` and `v2/package-lock.json`
   (`npm install --package-lock-only`), minor not patch.
5. For any slice touching `api/`: the wire-check **actually run** against live `vercel dev` +
   supabase. `api/` is not typechecked against the real schema and the wire-checks are not in CI —
   a wrong column name ships green through every other gate.

## Open question for the owner

**Slice 5 may not be worth its PR yet.** It closes the seam for symmetry, but the deep chain is the
caller's **own** generated world — no other player is involved, and the boxes down there hold
nothing a player cannot already reach by rooting the gateway and reading forwards. If the answer is
"not yet", it re-sites cleanly into the deep-chain work rather than blocking D2.4's close-out; the
epic's D2.4 row would then read "public seam only" and say why.

Slices 1-4 are the ones that carry the epic's stated point.

---
*Slice plan. Delete on close-out; fold the as-built into
[`d2-credential-layer.md`](./d2-credential-layer.md).*
