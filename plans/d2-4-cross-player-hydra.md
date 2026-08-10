# Plan: a player cracks a stranger's box across the network

**Branch**: next slice cuts a fresh branch from `main` (slices 1-2 shipped from
`feat/crack-a-strangers-box`, slice 3 from `feat/crack-behind-a-nat-forward`)
**Status**: Active — **slices 1-3 SHIPPED**: 1 and 2 in PR #371 (`9b431d7`, v0.119.0), 3 in PR
#374 (`8838aaf`, v0.120.0). **Slice 4 is next**, then slice 5. The slice-5 question is **SETTLED**
(2026-08-10) — see "Settled: slice 5 stays" below. Slice 4 is scoped narrow because of it.

Two pieces of groundwork landed between slice 2 and slice 3, neither of them product work:
`api/sessions.ts` collapsed to one spelling per query (#372), so slice 3 adds a call rather than a
tenth inline copy of every dep builder; and the wire-check fixture defect that made the NAT-forward
path *look* broken was fixed (#373). All 32 wire-checks are green — see the note under slice 3.
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

### Slice 1: One resolver decides what a public IP and port reach — ✔ SHIPPED (#371 `9b431d7`)

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

### Slice 2: A player cracks the gateway behind a stranger's public IP — ✔ SHIPPED (v0.119.0, #371 `9b431d7`)

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

### Slice 3: A player cracks the box behind a stranger's NAT forward — ✅ SHIPPED (#374, v0.120.0)

> **As built.** The mechanism was smaller than planned — `resolvePublicTarget` already routed
> forwards, checked the lease, the boot gate and the internal port, so the new code was `-p` parsing
> plus threading a port through four layers. What was NOT planned is the two defects grounding
> turned up, both of which shipped as fixes here:
>
> 1. **The reported port was about to lie.** The handler returned `open.port`, which through a
>    forward is the port on the OCCUPANT's box. `-p 5544` would have printed
>    `[22][ssh] host: <public ip>` — and `:22` on that address is the GATEWAY. A result must name
>    the door the caller knocked on.
> 2. **A forward to sshd was a door to nginx.** The service check matched any port open on the
>    reached box. `PublicTarget.reachedPort` now pins it to what the forward actually reaches —
>    otherwise hydra reports a credential `ssh` refuses on that port, which is the disagreement this
>    whole plan exists to prevent.
>
> **Criterion 5 was wrong as written** and was corrected before RED: it claimed `-p` "keeps working
> as an ordinary port selector" on an own-LAN target, which has never existed — `handleHydraCrack`
> has no port concept and resolves by service name. `-p` is ignored there rather than refused.
>
> **A test that passed for the wrong reason** was caught and rebuilt: the service-mismatch case
> originally used `mysql`, which today's default-to-gateway also 404s. Only two services exist in
> `serviceCatalog` (`ssh`, `http`), so it now uses two forwards to one box and fails RED with
> `200 + root cracked`.
>
> Evidence: 2372 unit tests, 32/32 wire-checks live (`testHydraCrossPlayer` 8 → 14 checks),
> mutation `hydraCrackPublic` 100% / `resolvePublicTarget` 100% of covered / `hydra.ts` 61% → 79%
> with every `parsePort` survivor killed. Remaining `hydra.ts` survivors are manual and display
> prose, left deliberately.
>
> **For slice 4:** the dep-factory rule from #372 held — this slice added no `api/` change at all,
> because the new field travels through the core schema. Keep it that way.

**Value**: the row's real acceptance example — reaching the **person**, not their gateway. A forward
a player published so their own box is reachable is the same door an attacker walks through, which
is what makes publishing one a decision rather than a freebie.

**Path**: `hydra -p <port> <public IP>` → the same action as slice 2, now carrying a port → slice 1's
resolver routes to `resolveForwardTarget` → the occupant's fs → sweep → trace on the **occupant's**
machine under their owner key.

**Class**: Behaviour change.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirmed 2026-08-10; 5 was corrected, 7-8 added after grounding):
1. `hydra -p <forwarded port> <public IP>` sweeps the occupant's accounts, and the guest account
   falls (guest is 1.00 by design, and is what a cross-player login yields — see the parent).
2. Root and user on a player's workstation never fall, because a player's chosen password is not
   in the crackable pool. This is asserted, not assumed.
3. The trace lands on the **occupant's** `auth.log`, not the gateway's. Already true by
   construction — `resolveForwardTarget` returns `logWriterKey: occupant.owner_key` — so this is
   new evidence at the hydra layer, not new mechanism.
4. A forward pointing at an address nobody currently leases, or at a bricked box, or at a box whose
   internal service is not listening, is refused with no trace. All three refusals already exist in
   `resolveForwardTarget`; what hydra owns here is the **no trace** half.
5. `-p` addresses an access point's forward table, so it is meaningful only against a public IP. On
   an own-LAN target the service name already selects the port — `handleHydraCrack` finds the open
   port by service and has no port concept at all — so passing `-p` there changes nothing, and is
   ignored rather than refused. The player gets the attack they asked for either way.
6. The manual documents `-p`.
7. **hydra reports the door the player knocked on.** The handler returns `open.port`, which through
   a forward is the port on the OCCUPANT's box: a player typing `-p 5544` would read
   `[22][ssh] host: <public ip>`, and port 22 on that address is the GATEWAY — a different machine.
   A forwarded sweep reports the external port it was given.
8. **The service named must be the one behind the forward.** `service` is a separate argument from
   `-p`, so `hydra -p 5544 <ip> mysql` could resolve through a forward to port 22 and then attack
   mysql on the occupant's box. The port is the address; attacking something else through it is the
   same hydra/`ssh` disagreement this plan exists to prevent. Refused as `service_not_running`.

> Criterion 5 originally read *"`-p` on an own-LAN target keeps working as an ordinary port
> selector"*, which described behaviour that has never existed. Criteria 7 and 8 were missing
> outright. All three came out of reading the code before writing the test rather than after.

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
`hydraCrackPublic.ts:130`'s refusal is **deleted**, and the source IP derives from the session row
the handler already holds → the trace records the standing box's network, not the caller's home.

#### Grounding, read 2026-08-10 — it corrects two notes this plan made an hour earlier

**6. The vantage is already in the handler, discarded.** `authorizeMachineAccess` returns
`ActiveSession = { userType, essid }`, and `sessions.essid` is *"the network the target host was
generated [from]"* (`20260611000000_sessions_essid.sql`). Every session creator stamps the right
one: `authCreateSessionPublic.ts:179` stores `target.essid` (the FOREIGN network),
`authCreateSession`/`SameLan`/`InnerGateway` store the caller's own. `hydraCrackPublic.ts:114-121`
fetches that row and reads only `.ok`.

So the derivation is not new machinery — it is `access.session.essid` → `network_public_ips`, and
that lookup already exists inline as the tail of `findHomeNetworkByOwnerKeyVia`
(`api/sessions.ts:208-215`, owner_key → essid → public_ip). Slice 4 splits the second half out and
calls it with a different essid.

**The refusal is therefore a mechanism to REMOVE, not replace.** It stands in for a lookup the
handler could already do. Two branches remain: `access.session === null` (own workstation, the
`isOwnWorkstation` bypass) keeps today's owner-key lookup; anything else uses the session's essid.

**The essid must come from the SESSION, never `payload.essid`.** If placement and the address both
derived from a claimed essid, a player could assert "I am standing on A's LAN" and write a trace
blaming A. `findActiveSession` requires a real `(player_key, machine_id)` row, so the session essid
is unforgeable — that is the whole defence, and it is already there.

**7. A deep-chain box is placed for free — correcting this plan's own note.**
`authCreateSessionInnerGateway.ts:376` records `essid: payload.essid`, the caller's OWN network,
which is the truthful origin for a box behind their own gateway. So the session-essid derivation
places it with no chain walk. Slice 4's criterion 4 no longer holds anything back, and slice 5's
criterion 6 becomes a confirmation rather than work. `pivotVantageForMachineId` is not needed here.

**8. `hydraCrack.ts:185` is a DIFFERENT rule — also correcting an earlier note here.** It derives
`standing.ip`, a LAN address, and the client sends the PLAYER's own essid even inside a remote
session (`ui/env.ts`'s `networkView` reads the player's connectivity — the trap D2.3 recorded). So
standing on A's gateway, `hydra 192.168.1.7` is genuinely ambiguous: the server cannot tell which
LAN that names. That refusal is honest and **stays**. Lifting it is "sweep the LAN you are standing
on", which needs the session essid to become the RESOLUTION WORLD rather than just the trace
address — a separate behaviour, and a separate slice.

**Class**: Behaviour change.

**Required implementation skills**: `tdd`, `testing`, `mutation-testing`, `refactoring`.

**Acceptance criteria** (confirm before any code):
1. B, standing on a box on **A's** network with a live session, sweeps C — and C's `auth.log` names
   **A's** public IP, never B's. This is the pivot: the trace points at the box that was used, which
   is what makes rooting one worth doing.
2. B standing on their **own workstation** is unchanged — their home public IP, by today's
   owner-key lookup (v0.114.0 preserved). This is the branch where there is no session to read.
3. B standing on an NPC box on their **own LAN** also reports their home public IP — the same answer
   as today, now reached by the new route, because that session's essid IS their home essid.
4. A caller naming a machine they hold **no session on** is still refused `no_session`. L1 is
   untouched, and it is the only thing standing between a claimed vantage and a forged trace.
5. A network with **no allocated public IP** degrades to `unknown` rather than guessing an address
   or failing the sweep. The parent's rule stands: a false origin in a defender's log is worse than
   no origin.
6. A **deep-chain box** reports the caller's own public IP — free, per finding 7, and asserted here
   so slice 5 inherits it proven rather than re-deriving it.
7. The **own-LAN handler is untouched**: `hydraCrack`'s `caller_not_on_lan` still fires, and a
   same-LAN trace still carries the standing host's LAN IP (v0.118.0 preserved). Finding 8 is why.
8. B needs hydra and a wordlist **on A's box** to do any of this — no implicit toolchain.

**RED**: a caller whose `caller_machine_id` is a box on a FOREIGN network, with an active session
whose essid is that network; assert the trace's source IP is that network's public IP. Fails today
at `hydraCrackPublic.ts:130` with a 403 `caller_not_on_lan` — the sweep never runs.

**GREEN**: delete the `onOwnLan` predicate; derive the address from `access.session`, falling back
to the owner-key lookup when it is `null` (the own-workstation bypass).

**MUTATE**: Stryker over the derivation and its branch.

Two survivors to expect, and the second is the interesting one:

- the `'unknown'` degradation — a plausible-looking survivor that means "every trace is anonymous";
- **a branch swap.** The two branches return the SAME value in any fixture where the standing box is
  on the caller's own network, so a mutant that reads the session essid for the own-workstation case
  (or the owner key for the pivot case) survives every test that does not use a genuinely foreign
  network with a DIFFERENT public IP. The fixture, not the assertion, is what kills this one.

**KILL MUTANTS**: assert the degraded case explicitly rather than letting it be the untested arm,
and keep A's and B's public IPs distinct in every pivot fixture.

**REFACTOR**: this is where `crossPlayerSourceIp.ts`'s docstring promise comes due, and it reads as
if written for this slice: *"when the pivot feature ships, only this seam changes to resolve the hop
they operate from, masking their real IP with no caller rework."* The seam becomes **essid-first** —
an address for a network — with the owner-key lookup as the branch that answers "which network is
home". Verify the "no caller rework" claim rather than restating it: `resolvePublicScan` and
`authCreateSessionPublic` are the other two callers and neither should have to change.

**Wire-check**: extend `testHydraCrossPlayer.ts` — three parties is the honest test, and
`testCrossPlayerSuElevate.ts` is the precedent for driving more than two. **Mandatory here**:
`api/sessions.ts` grows a query (essid → public IP, split out of `findHomeNetworkByOwnerKeyVia`),
and `api/` is not typechecked against the real schema.

**Done when**: all eight criteria hold, the wire-check passes, and the human approves the commit.

---

### Slice 5: A player cracks a host deep behind their own inner gateway

**Value**: **the deep layer has no credential door at all, and this is it.** Every deep host is
`buildRemoteHostFs` + `FORCE_SSHD_PATCH` (`generateDeepLayer.ts:157`), so it always runs sshd and
always carries a `guest` drawn at `CRACK_CHANCE.guest = 1` — always from the crackable pool. It is
content built to be entered by a wordlist. But deep IPs are absent from `generateHomeLan().hosts`,
so no shell can address one; the single entrance is `ssh -p <fwd> <inner gateway>`, and rooting the
gateway yields the NAT rules — which port reaches which box — not credentials. So today a player
`nmap`s from a pivot vantage, sees a box with sshd open, and has no way in unless the game hands
them the password. That is what this epic exists to end.

It also closes the fourth of `ssh`'s four seams, and repairs the asymmetry slice 3 introduced:
`ssh -p 5544 <inner>` lands on the deep box while `hydra -p 5544 <inner>` attacks the gateway and
silently drops the flag.

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
6. **A rooted deep box is a place to attack FROM** — hydra runs there and the trace names the
   caller's own public IP, honouring the locked *tools run where you stand*. Slice 4's finding 7
   says this arrives free: a deep session records the caller's own essid, so slice 4's derivation
   places it with no chain walk. Slice 4 asserts it (its criterion 6); this slice only has to not
   break it, once there is a real way to root a deep box.
7. hydra's manual stops saying `-p` is only for a public IP, and the own-LAN ignore test
   (`hydra.test.ts:354`) is replaced rather than deleted — an ordinary sibling still ignores `-p`;
   an inner gateway no longer does.

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

**Done when**: all seven criteria hold, the wire-check passes, and the human approves the commit.

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

## Settled: slice 5 stays (2026-08-10)

The question was whether slice 5 earned its own PR, on the grounds that the deep chain is the
caller's own generated world and holds nothing a player cannot already reach by rooting the gateway
and reading forwards. **Reading the generators answered it: that reasoning is about loot, and the
problem is access.**

- Deep hosts are `buildRemoteHostFs` + `FORCE_SSHD_PATCH`, `guest` at `CRACK_CHANCE.guest = 1` —
  a wordlist target by construction.
- Deep IPs are not in `generateHomeLan().hosts`, so the only entrance is `ssh -p <fwd> <inner>`,
  and the gateway holds forwards, not credentials. There is **no** way to obtain a deep host's
  password in game. The layer is furnished and sealed.

So: **kept, its own PR, after slice 4.** Not re-sited — the `-p` asymmetry that makes it urgent was
created by D2.4 slice 3, and D2.4 should not close having shipped a rule it intends to revoke.

**How it scopes slice 4 — corrected the same day, after grounding.** The first answer here was that
slice 5 makes a deep box standable-on, so slice 4 should stay narrow and keep refusing a deep-chain
vantage, leaving slice 5 to walk the chain. **That was wrong**, and slice 4's finding 7 says why: a
deep session records the caller's own essid, so deriving the address from the session row places a
deep box with no chain walk at all. `pivotVantageForMachineId` never enters it. Slice 4 asserts the
deep case and slice 5 inherits it.

What survives the correction is the decision itself — slice 5 keeps its PR — and one real scope
line: `hydraCrack.ts`'s own-LAN refusal is a different rule (slice 4's finding 8) and belongs to
neither slice.

Slice 5 is also smaller than it reads: `authCreateSessionInnerGateway.ts:176` already walks the
chain by port through `machineServing`, so GREEN is slice 1's move again — extract the walk, use it
twice — not new chain machinery.

---
*Slice plan. Delete on close-out; fold the as-built into
[`d2-credential-layer.md`](./d2-credential-layer.md).*
