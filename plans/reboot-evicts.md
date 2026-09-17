# Plan: Phase 3 Slice 7 — Reboot Evicts

**Epic:** `plans/legacy-parity-epic.md` — Phase 3 (the "V" series), slice 7. Prior slice
close-out: "Phase 3 slice 6 — the exploit crosses networks" (#508–#514, v0.224.0–v0.230.0).
**V3 closes when this lands.**

**Status:** Active — PR1 merged (#515, v0.231.0). PR2 merged (#516, v0.232.0). PR3 merged
(#517, v0.233.0, squash `06ba75ea`). PR4 next on `feat/reboot-leaves-a-trace`, branching from
`main` at v0.233.0 — the last one, and V3 closes when it lands.

**Delivery:** Four independent PRs, sequenced to trunk (NOT a stack). Each merges to `main`;
the next branches from updated `main`. The blast radius arrives one step at a time — the
action first against the caller's own rows, then the channel that tells a live shell, then
strangers, then the trace.

**Branches:** PR1 `feat/reboot-ends-the-machines-rows` (merged, deleted), PR2
`feat/boot-id-evicts-a-live-shell` (merged, deleted), PR3 `feat/reboot-evicts-strangers`
(merged, deleted), PR4 `feat/reboot-leaves-a-trace`. Versions 0.231.0 → 0.234.0, bumped in
both `v2/package.json` and `v2/package-lock.json` per PR.

---

## Goal

Make `reboot` the defender's one eviction lever: it ends every active session row on the
machine it ran on — including rows belonging to players the rebooter has never met — and the
intruder's open shell finds out on its very next line.

## The one property that makes this safe

**The closed row is the authority; the marker on the box is only how the terminal finds out.**
A tampered client that ignores the marker gains nothing: its rows are ended, so
`resolveCrossPlayerFs` hands it the tier-3 allowlist and the L1 active-session gate refuses its
writes. That split is what lets the player-facing half be a cheap client-side equality check
instead of a round trip per line, and it is the same posture the conventions doc already takes
when it says L1 is enough to launch.

Everything else follows from it. The eviction is one signed action, authorized server-side by
root-on-that-box; the marker is one file on the box's own tree, read through the re-pull
`executeLine` already performs before every line.

## Scope boundary

Eviction, and nothing else new. The boot outcome (`canBoot`, the halt and panic tails, the
brick) is untouched — this slice changes *who is still on the box afterwards*, never whether it
comes back. Libraries (slice 8) and firmware (slice 9) stay out.

## Inherited locked decisions

| # | What it fixes for this slice |
|---|---|
| 19 | Patching stops new exploits and does not terminate a live shell. `apt upgrade` is not an eviction tool — which is what leaves this slice holding the only one. |
| 20 | The decision this slice discharges: `reboot` ends every session row on the machine, server-side, not just the rebooter's stack. Its stated interaction is deliberate — if the intruder already tombstoned `/boot/vmlinuz`, the defender's reboot-to-evict is what bricks them. |
| 1 | The stable-writer rule: a cross-player log line is written under the **target owner's** writer key, so several attackers' lines accrete instead of overwriting. PR4's trace consumes it rather than re-deciding it. |
| 33 | `exploit` is an ssh hop, `exploit_limited` an nc-shaped shell. Both are rows on a machine, so both die here — the slice needs no per-kind rule. |

## Resolved decisions (grilling, 2026-09-17)

Eleven, continuing the epic's numbering from 51.

#### 52. Every active row on the rebooted machine dies — every player, every kind

Not the rebooter's hop chain, not shells only, not foreigners only: every active row whose
`machine_id` is the rebooted box, across all eleven `SessionKind`s. The machine stopped
existing for a moment, and that one sentence answers every kind at once without a table of
exceptions to maintain.

The implicit base login is untouched because it was never a row — the player's own box stays
reachable, exactly as `disconnect()` already guarantees client-side.

The precedent runs this way already: D6 and D7 made `systemctl stop mysqld` and `kill redis`
evict a connected player, so a service session has never been exempt from the box it runs on.
The rejected alternative — leaving the rebooter's own rows to today's client-side pops —
would keep two mechanisms alive for one event and leave a `su` row active in the database
after its own reboot, which is a rehydrate bug waiting to be written.

#### 53. The closed row is the authority; a marker on the box is how the terminal finds out

Closing rows handles the reload. It does not handle the intruder sitting in an open shell, and
that player is the whole point of the slice.

The gate sits beside `socketAlive` in `runCommandLine`, **before the line is parsed** — the
same seam, the same shape of rule (*this session cannot do that*), so a box that went down
answers the connection-closed line rather than `command not found`, and a pipeline can no more
slip past it than `su | grep x` can past a missing pty.

**Corrected at PR2, 2026-09-17.** This paragraph claimed the gate costs **zero new round trips**
because *"`executeLine` already re-pulls the active tree before every line"*. It does not, and
did not: the re-pull was `kind === 'nc'` only — a shipped and deliberately PRICED rule, with a
test that spends the line (`state.test.ts`, "pays the re-pull only…") and a conventions entry
whose very next bullet says *"it costs a round trip only in a backdoor"*. The plan quoted that
entry's conclusion and dropped the guard around it. The gate as written would have worked for
backdoor shells and silently for nothing else — which is most of what this slice is about, since
PR3's headline intruder sits in an ssh or exploit shell.

What shipped instead: the rule widened, and it now has a name. `needsFreshTree`
(`ui/activeRoot.ts`) asks WHETHER to fetch — a backdoor always, plus any session standing on a
box that is not the player's own workstation. `isCrossPlayerHop` still answers WHERE the tree
comes from, which is the two-source dispatch the conventions doc anticipated: *"any future
're-read the box before acting' gate has the same two sources to choose between."* The gate
itself still chooses neither; it reads whatever tree the re-pull produced.

So it costs **one round trip per line while standing on somebody else's box**, and nothing at
all on your own — the priced claim survives intact, and its test now spends the line in both
directions rather than only proving the negative. PR3 and PR4 inherit the corrected rule, not
the original sentence.

Rejected: a liveness call per line (correct, and dead against the repo's own test that a
command on your own box issues no requests at all); and letting the served tree's tier answer
it (elegant cross-player, silent on the journal path, and a silent tier-downgrade is a worse
answer for a player than a line saying the box went down).

#### 54. A boot id compared by equality — never a timestamp compared by ordering

A live session's `createdAt` is `env.now()`, the **client's** clock (`ssh.ts`, `su.ts`,
`nc.ts`, `msfconsole.ts` all stamp it so). A rehydrated session's is
`Date.parse(row.created_at)`, the **server's**. So one session carries two different stamps
depending on whether its player reloaded, and two players never share a clock at all. A
`createdAt < lastBoot` inequality would compare stamps from up to three sources: a player whose
clock runs slow would be falsely evicted from a box that rebooted before they arrived, and one
whose clock runs fast would survive a reboot that should have thrown them out.

So the marker carries an opaque id the **server** mints fresh on each reboot, and the gate
compares with `===`. No clock on either side. A box that has never rebooted has no marker and
its sessions carry `undefined`, which matches, so they live; the first reboot writes one and
every session predating it mismatches and dies.

`Session` gains one optional field, with the same justification that earned it `port` — one
line wider, because "the only door that has to keep asking whether it is still there" becomes
true of every session once a box can reboot under it.

**No migration and no new column.** The field only has to exist on the live in-memory session:
a row still active at rehydrate time is by definition one the server never evicted, so
rehydrate re-stamps it from the box's current marker. See the named risk below — this is the
quietest load-bearing thing in the slice.

#### 55. Authorization is server-derived root-on-that-box, and `endSession` is not widened

`handleEndSession` is scoped to the caller's own `player_key` deliberately — the conventions
doc names it as a rule ("no widening of `endSession`"), and it stays intact. This is a new
signed action, `rebootMachine`, taking the target `machine_id`.

It authorizes if **either** the caller's verified pubkey is that machine's `owner_key`, **or**
the caller holds an active session on that machine at root tier. Never a client claim — the
same shape every other handler in `api/sessions.ts` uses. The owner half is not an invention:
`resolveCrossPlayerFs` already establishes it for tier 1 — *"caller's verified pubkey ==
owner_key → the FULL tree (ownership trumps any session; the session table is not
consulted)"* — and reboot-evict is that same authority applied to the same box.

**Residual, recorded rather than closed:** the owner bypass lets a tampered client reboot-evict
its **own** box without in-game root, because the base login is implicit and has no row for the
server to read a tier from. The in-game gate is real (`/bin/reboot` is `execute:['root']`,
enforced by `wrapWithBinaryCheck` before `execute` runs), so it costs an honest player nothing;
what it buys a cheater is the ability to throw intruders off their own box, which is the
defender's own move anyway. Priced, not dangerous, and closing it would mean persisting an
owner tier that nothing else needs.

#### 56. The shutdown evicts, not the boot

Rows close and the boot id is written whether or not the machine comes back. A halted box has
no sessions on it by definition; whether it ever answers again is a separate fact about the
world, and `canBoot` is untouched by this slice.

This is what makes decision 20's punchline land. The defender **does** get the intruder off,
and pays for it with the box. The alternative would make that sentence false in the worst
direction — the defender bricks their own machine and the intruder is still sitting on it.

The consequence, named: on a bricked box the eviction is permanent for everyone, owner
included. That is already true today and unchanged here; the box was lost the moment the kernel
image was tombstoned. This slice only makes the loss take the intruder along with it.

#### 57. The action fires at the shutdown beat, and Ctrl-C can no longer un-ring it

The call goes immediately after `[ OK ] Stopping system logging...`, which is the fictionally
honest moment: that *is* when a real machine drops its sessions. It retires the shipped promise
that a Ctrl-C mid-animation leaves you connected, and that retirement is deliberate.

It costs nothing to implement, because the aborter evicts themselves through the gate decision
53 already builds. Ctrl-C after the kill leaves them on screen; their next line hits the boot-id
mismatch; a `su`'d owner lands back in their login shell and someone who rebooted a box they had
ssh'd into lands back where they hopped from. The half-state resolves itself on the very next
line, through the same path every other evicted player takes.

#### 58. Every reboot writes one `kern.log` line, with no carve-out for your own

`kern.log` already exists — syslog-shaped, root-owned, world-readable, and already the home of
netfilter and scan traces. A reboot is a kernel event, so there is no new log file to invent
and no new address rule: the actor's address comes from `crossPlayerSourceIp`, which the code
already calls *"shared by every cross-player trace writer."*

Unconditional, including your own reboots on your own box — exactly as your own `su` already
appears in your own `auth.log`. The rejected carve-out ("only log a reboot by someone who is
not the owner") is one more exception to remember and it tells an attacker precisely which act
is invisible.

It gives the defender what decision 20 implies they need: you come back after being evicted,
and the log names who rebooted your box out from under you, at an address you can act on. The
line lands under the **owner's** writer key per the stable-writer rule, so several attackers'
lines accrete instead of erasing each other.

Because the trace is written in the same action as the eviction, at the shutdown beat, it lands
before `canBoot` is ever consulted — so **a bricked box carries a perfectly good log line that
nobody will ever read**, because nothing can boot to read it. That is consistent with decision
56 rather than a defect, and it is left in.

#### 59. A failed eviction fails loudly — the one place best-effort is wrong

Everywhere else in this codebase a swallowed failure costs a **log line**: someone does not
find out who scanned them, and `null` writer key means no log, matching the best-effort posture
throughout. Here a swallowed failure costs **the entire purpose of the command**. The defender
watches a full, convincing reboot animation, is told the system came back up, and walks away
believing they are clear while the intruder is still in a live shell.

So the boot sequence still completes — the box did reboot locally — and the player is told the
eviction did not take, with a non-zero exit. A defensive tool that silently no-ops is worse
than one that refuses.

**It is not gated on `env.network.isOnline()`.** That flag is the in-game "am I joined to a
WiFi" state, and rebooting your own box is local hardware. It matters more than it looks: a
defender who spots an intruder and runs `nmcli disconnect` then `reboot` is executing the panic
sequence correctly, and §9 already records that disconnecting removes occupancy **without**
tearing down sessions already open. Gating on connectivity would break the move precisely when
it is being used properly.

#### 60. The boot id is tier-3 allowlisted, because otherwise the FIRST reboot of every box is silent

Found by walking the tier logic, not by a test. The gate reads the marker off the re-pulled
tree — but the moment the rows close, that player has no active session, so
`resolveCrossPlayerFs` serves them the tier-3 allowlist, and
`EXTERNALLY_OBSERVABLE_ALLOWLIST` is a closed list. A marker outside it is pruned before the
response leaves.

That breaks the first reboot of any box specifically. Sessions on a never-rebooted box carry
`bootId: undefined`; the reboot writes marker `X` and closes the rows; the intruder's next line
re-pulls a tier-3 tree with the marker pruned; the client reads `undefined`, compares it to the
session's `undefined`, matches, and **keeps typing on a box that rebooted them out**. Every
subsequent reboot works, because by then the session holds a real id that mismatches. A
first-reboot-only hole is exactly the kind that survives testing and reads forever after as an
unreproducible bug.

So the marker is world-readable / root-write — the posture `kern.log` and `auth.log` already
take — and its path joins `EXTERNALLY_OBSERVABLE_ALLOWLIST` beside `/var/run/*.pid`. The
disclosure is strictly smaller than the pidfiles already on that list: an unauthenticated
reader learns that a box has rebooted and sees an opaque id, and nothing about **who** rebooted
it, which lives in `kern.log` and is not allowlisted.

The path is `/var/run/boot-id`, confirmed 2026-09-17 (`/var/run` is the established
runtime-truth directory and is root-writable; the real-world analogue is
`/proc/sys/kernel/random/boot_id`). It is not a free choice for the implementation to
revisit: PR2 writes it into `EXTERNALLY_OBSERVABLE_ALLOWLIST`, where it is read by
unauthenticated strangers from that point on, and moving it afterwards means moving a
path other players' clients have already learned to look at.

#### 61. The shared AP gateway is in scope, and needs no branch to be there

A gateway is rootable today — `hydra` sweeps the gateway behind any public IP (D2.4) and slice
6's PR4 opened the CVE route to it — and `reboot`'s availability is already `any-machine`. So
this falls out of the same action: the handler is keyed by `machine_id` and a gateway has one
(`computeApGatewayId`), the owner bypass simply does not apply because a gateway is ownerless
(only the root-session path authorizes), and the writer key was already answered by
`apGatewayLogWriterKey`.

Slice 6 gave the access point its own PR because its damage was **collective and permanent** —
a bricked gateway takes the whole public IP dark for every occupant at once. That argument does
not transfer. Evicting sessions on a gateway throws people off a router they can log back into,
and the permanent version is bricking, which is already shipped and untouched here. So the
blast radius is smaller than the case that earned its own step, and deferring it would mean
writing a refusal branch to prevent behaviour that is already correct by construction.

#### 62. Four independent PRs, and the one that touches `runCommandLine` ships alone

One authoritative action, then the channel that tells a live shell, then strangers, then the
trace. Each step is independently revertable and independently wrong-able — slice 6's argument
for opening one vantage at a time, reapplied.

PR2 is the one that most needs to ship alone: it touches `runCommandLine`, the hottest path in
the game, for every session on every box. A stack earns nothing here, because each PR merges
before the next branches, exactly as slice 6's seven did.

---

## Slices

All four are **behavior change** — fast RED-GREEN-REFACTOR increments, with the
mutation-or-alternate gate run once per PR at PR readiness. Every PR changes `api/` behaviour
and therefore carries a wire-check; none is exempt.

**Required implementation skills:** `tdd`, `testing`, and `functional` throughout;
`refactoring` where a PR also tidies already-tested code; `front-end-testing` for PR2's
terminal-observable behaviour; `mutation-testing` at each PR boundary's readiness. PR3 is the
one with a browser obligation — see its evidence line.

### PR1 — the machine's rows close in one action, and a failure says so (v0.231.0) — merged (#515)

**Value:** A reboot stops relying on N optimistic per-pop calls that report nothing, and starts
being one authoritative act that tells the player when it did not happen.
**Actor/trigger/outcome:** player runs `reboot` → every active row **they hold** on that machine
closes in a single call stamped `rebooted`; if the call fails, the box still comes up locally
but the player is told the eviction did not take, with a non-zero exit.
**Class:** Behavior change.
**Path:** new signed `rebootMachine` action in `api/sessions.ts` + a pure handler in
`core/sessions/`; `END_REASONS` gains `rebooted`; `reboot.ts` calls it at the shutdown beat
(decision 57) and renders the loud failure (decision 59). Authorization is present but still
scoped to the caller's own rows — no stranger is touched yet.
**Acceptance:**
- A reboot closes every active row the caller holds on that machine, not only the contiguous
  hop-chain run today's `disconnect()` pops.
- Rows close with `rebooted`, not the `user_exit` that `popSession` currently stamps for them.
- A failing call leaves the boot sequence intact and reports the failure with a non-zero exit.
- `reboot` still works with `env.network.isOnline()` false.
- `handleEndSession` is unchanged and still refuses to touch a row the caller does not own.
**RED:** a handler test asserting a second active row on the machine — one not on the hop chain
— is closed by the action; and a `reboot.ts` test asserting the failure path reaches the player
rather than being swallowed.
**Evidence:** RED-GREEN unit tests; mutation gate at PR readiness; wire-check extended with a
reboot that closes two of the caller's own rows on one machine.

**Outcome:** merged as #515. 5017 tests / 224 files green; typecheck and lint clean; wire-check
`scripts/testRebootEvicts.ts` 10/10 against `vercel dev` + supabase, with a negative control —
removing the `.is('ended_at', null)` guard turns checks 7–8 red, so the check can fail. Mutation
gate 111 killed (109 + 2 timeouts) / 132 — 84.1%: `rebootMachine.ts` 25/25, `endSession.ts`
25/25, the new adapter lines 13/13. Of the 21 survivors, 14 are the `reboot: Command` metadata
literal, 4 are animation copy the file deliberately leaves unpinned, 1 is the `text()` helper's
`kind`, and 2 are proven equivalent (on abort the `for await` throws and `exitCode()` is never
reached, so the `{ failed: false }` initializer has no reader that could observe it).

Two things the acceptance list did not predict, both worth carrying into PR2 and PR3:

**`endSession` no longer accepts `rebooted` from a caller.** Adding it to `END_REASONS` made it
client-writable, and a caller able to claim it could record a voluntary exit as an eviction — in
the one field that says whether a player left or was thrown off. The wire-facing schema now takes
a narrower `CLIENT_END_REASONS` subset. The acceptance line above said `handleEndSession` is
unchanged; its intent, the ownership scoping decision 55 protects, is intact.

**The endSession UPDATE now touches only rows still open.** `disconnect()`'s pops really do send
an ordinary exit for every row, milliseconds after the reboot closed them, and they were
rewriting `rebooted` into `user_exit`. Found by the wire-check, not by a unit test — which is
the argument for PR3's two-identity wire-check being written before its handler change, not
after.

### PR2 — the box carries a boot id, and a live shell learns it moved (v0.232.0) — merged (#516)

**Value:** An open shell on a rebooted box stops being a shell — the player is told, on their
next line, instead of typing into a machine that threw them out.
**Actor/trigger/outcome:** player Ctrl-Cs a reboot *after* the shutdown beat, then types → the
line is refused before it parses, the session pops, and they land back where they came from.
**Class:** Behavior change.
**Path:** the action writes a freshly minted boot id to the box's tree; the path joins
`EXTERNALLY_OBSERVABLE_ALLOWLIST` (decision 60); `Session` gains the optional `bootId`, stamped
by every door that mints a session; `sessionRehydrate` re-stamps it from the box's current
marker; the gate lands beside `socketAlive` in `runCommandLine`, before the parse.
**Acceptance:**
- A session whose recorded boot id differs from the box's is refused before its line parses,
  pops, and prints the closed line — a typo answers that, not `command not found`.
- A pipeline cannot slip past the gate.
- A session on a never-rebooted box (no marker, `undefined`) runs normally.
- The **first** reboot of a box evicts a live shell on screen, not just in the database — the
  decision-60 case, tested explicitly at tier 3 rather than assumed.
- Rehydrating an active row re-stamps its boot id; the player is not thrown off by reloading.
- A command on your own box still issues no requests at all.
**RED:** a `runCommandLine` test where the tree's marker has moved under an open session, and a
tier-3 pruned-tree test proving the first-reboot case fails without the allowlist entry.
**Evidence:** RED-GREEN unit tests; a Terminal-level test for the Ctrl-C-then-type sequence;
mutation gate; wire-check covering the marker write.

**Outcome:** merged as #516. 5051 tests / 225 files green; typecheck and lint clean; wire-check
`scripts/testRebootEvicts.ts` 13/13 against `vercel dev` + supabase, with a negative control —
pointing the marker write at another path turns its three new checks red. Mutation gate 142 killed
/ 12 not killed — 92.21%, with `rebootMachine.ts`, `runLine.ts`, `readFilter.ts` and
`activeRoot.ts` each at 100%.

**The correction to decision 53 above is this PR's main story**, and PR3 should read it before
starting: that cost argument was false, the pre-line re-pull widened to `needsFreshTree`, and the
whole rule plus the general lesson is recorded in `conventions-and-gotchas.md` §7.

Two deviations from this slice's own wording, both deliberate and both flagged before GREEN:

**`Session.bootId` carries three states, not one.** `undefined` is "has not read the box yet",
`null` is "read it and found no marker", a string is the id. Decision 54 described two, which
cannot work: a session minted on a box that has ALREADY rebooted would carry `undefined`, match
the absence of a reading, and be evicted on its first line — or, read the other way, the first
reboot of every box would evict nobody. The third state is what keeps those apart.

**The stamp is taken at the observation seam, not "by every door that mints a session".**
The doors that reach another player's box get back a machine id and a tier, never a tree
(`RemoteAuthResult`), so a door-stamped session would be stamped from the wrong box — or need a
new field threaded through roughly eight auth endpoints, their api glue, their adapters and their
wire-checks, in the PR that was supposed to ship alone because it touches `runCommandLine`.
`sessionRehydrate` therefore needed NO change, for exactly the reason decision 54 already gives
about rehydrate: a row still active then is one no reboot closed.

**Corrected at PR3, 2026-09-17.** "Once, at the observation seam" was right about WHERE and
wrong about WHEN: PR2 read the box on the first line the session RUNS, which is too late for the
intruder who breaks in and waits — see PR3's outcome below. The seam is unchanged (still one
place, still the client's own tree, still no field on the wire); it now fires in `acquireTree`,
as soon as the client holds that machine's tree, with the per-line call kept as the fallback.
Every door reaches it, because every door pushes a session and every push rebinds the tree.

**One thing decision 52 implied that nothing had written down:** the base login must be left
unstamped. It was never a session row, nothing can close it, and there is nothing beneath it to
drop back to — judge it against the marker and `reboot` on your own machine throws you out of
your own login shell. Verified by hand: that mutant prints `Connection to box closed by remote
host.` at the owner's own prompt.

**The mutation gate earned its keep twice, both times on tests written in this PR.** It raised
`bootId.ts` from 55.88% to 88.24% by showing that nothing pinned the marker's permissions or a
tree with no `/var` in it — the latter load-bearing, because a tier-3 pruned tree of a box with
nothing observable on it arrives with no `/var` at all, and a throw there takes down the shell
rather than the session. Worse, a test asserting the post-evict re-pull's ORDER was being satisfied
by an in-flight refetch from `su`'s own auth.log write; it is now decision 57's actual promise (an
aborted reboot drops the owner back to their login shell on the next line) with the contaminating
refetch awaited first. **The lesson for PR3 and PR4: in a state-level test, a fire-and-forget
refetch from an earlier command can satisfy an ordering assertion on its own.**

Of the 12 survivors: 4 on `BOOT_ID_PERMISSIONS` are provably equivalent (both walker predicates
open with `if (userType === 'root') return ALLOWED`, so a blanked `'root'` entry is unobservable),
4 on the `sessionsClientDeps === undefined` degradation are unreachable through the public surface
— the house pattern every sibling in `state.ts` shares, none of them covered — and 4 sit inside
`rebootEvict`: one harmless extra fetch after a FAILED evict, and three on which source the
re-pull reads from, a rule already at 100% in `activeRoot.test.ts`. **Killing those three needs a
cross-player reboot fixture, which PR3 brings anyway.**

### PR3 — a reboot evicts strangers (v0.233.0) — merged (#517)

**Value:** The slice's headline and V3's closer — the defender's one lever finally reaches rows
the rebooter does not own.
**Actor/trigger/outcome:** A finds B in a shell on A's box and runs `reboot` → B's row closes,
B's next line throws them off, and A's box comes back with B gone. Symmetrically, B holding root
on A's box can reboot it and evict A.
**Class:** Behavior change.
**Path:** authorization widens to owner-or-root-session, server-derived (decision 55); the
action stops scoping row closure to the caller and ends every active row on the machine
(decision 52). The AP gateway is reachable through the same path with no branch (decision 61).
**Acceptance:**
- A reboot ends rows belonging to players the rebooter has never met, across every kind.
- A caller with neither ownership nor a root session on that machine is refused.
- A rooted AP gateway evicts its sessions through the same path, authorized by the root-session
  arm alone.
- A box that fails `canBoot` still evicts everyone (decision 56).
- `handleEndSession` remains scoped to its caller — the widening lives only in the new action.
**RED:** a handler test asserting a foreign player's row closes, paired with the refusal test
for a caller holding neither authority.
**Evidence:** RED-GREEN unit tests; mutation gate; a **two-identity wire-check** inheriting
slice 6's fixture; and a **two-player browser run** — the one thing that belongs in a browser
here, since it is the first time a real player is thrown off a real box.

**Outcome:** merged as #517. 5059 tests / 225 files green; typecheck and lint clean; wire-check
`scripts/testRebootEvicts.ts` 23/23 against `vercel dev` + supabase, with a negative control
(root check bypassed, closure narrowed to one kind) dropping it to 12/23. Mutation:
`rebootMachine.ts` 50/50, the changed `state.ts` ranges 26/38, 76/88 overall.

**Authority landed as decision 55 wrote it**, reusing `authorizeMachineAccess` — the own-box
suffix bypass the patch endpoints already gate on — with the root-tier requirement as reboot's own
extra (`403 not_root`). It is checked BEFORE anything moves, because a machine id travels on every
row and in every hop: an unauthorized reboot that reached the rows or left a marker would evict the
box's occupants just as effectively as one that was allowed. The gateway needed no branch, exactly
as decision 61 predicted. Decision 56 and the `endSession` scoping were already pinned by shipped
tests (`reboot.test.ts`, `endSession.test.ts`) and needed nothing new.

**One thing decision 55 implied that only the wire-check made concrete:** the owner arm cannot be
conditioned on a session row. After the first reboot the box has no open rows at all, so an
authority read off the session table would refuse the owner their own second reboot.

**The two-player browser run earned its place in the evidence line, and PR4 should keep one.**
It found a defect nothing else could: the boot id was stamped on the first line a session RUNS, so
an intruder who breaks in and waits reads the box for the first time AFTER the reboot, records the
new id as though they had always held it, and is never evicted. That is the ordinary case — nothing
makes a player type a line before the box goes down under them. And the shell they keep is not the
one they had: their rows are closed, so the box serves them the tier-3 allowlist and their next
command answers `command not found` because `/bin` is no longer in the tree. **A silent tier
downgrade is precisely what decision 53 rejected**, arriving anyway through the back door. Every
unit test written for the gate passed with the hole in place, because each of them types a line
first to establish the reading. Fixed by stamping in `acquireTree`; PR2's outcome above is
corrected in place. The rule and the lesson are in `conventions-and-gotchas.md` §7.

Two-identity run in full, for the record: B cracked A's WiFi, swept the LAN with `nmap`, took
`guest:sunshine` off A's box with `hydra`, and ssh'd in; A ran `reboot`; B's next line answered
`Connection to alpha closed by remote host.` and dropped them back to their own box. **The server
half was flawless on the first attempt** — the row closed, stamped `rebooted`, marker written — and
that is worth noticing: the wire-check was telling the truth, and the half it does not reach is the
half that was broken.

**Recorded, not fixed:** a closed row does not close a shell on your OWN box. `needsFreshTree`
exempts your own workstation, so an `su` row of yours that somebody else's reboot closed survives
until you reload. It costs nothing defensively and closing it would put a round trip on every line
typed at home, which is what the re-pull rule has refused since it was priced. Also in §7.

Of the 12 mutation survivors, 8 are pre-existing `rebindPatchClient` lines this diff only
reformatted — killing them needs a same-LAN, journal-driven hop fixture, since the cross-player
fixture reads a SERVED tree — and 4 sit on the new guard against stamping a session from a tree
that arrived after the player hopped on. That window is real (it stamps `null` against a cleared
journal and spuriously evicts), but observable only through a two-remote-hop fixture neither this
slice nor PR4 has another use for.

### PR4 — the reboot leaves a trace (v0.234.0)

**Value:** A defender who was evicted can come back and find out who did it, at an address they
can act on.
**Actor/trigger/outcome:** B reboots A's box → A logs back in and reads one `kern.log` line
naming the reboot and B's server-derived address.
**Class:** Behavior change.
**Path:** a `kern.log` line written in the same action as the eviction, at the shutdown beat,
under the owner's writer key, with the address from `crossPlayerSourceIp`.
**Acceptance:**
- Every reboot writes exactly one line, including the owner's own on their own box.
- The address is server-derived; a forged client value changes nothing a defender reads.
- Two different attackers' lines accrete on one box instead of erasing each other.
- A bricked box's line is written and is unreadable forever — asserted, not worked around.
**RED:** a handler test asserting the line's shape and the server-derived address, and one
asserting two actors' lines coexist.
**Evidence:** RED-GREEN unit tests; mutation gate; wire-check covering the traced reboot.

## Named risks

- **PR2 touches `runCommandLine`**, the hottest path in the game, for every session on every
  box. It ships alone for that reason, the way slice 6's PR1 did.
- **Decision 54's rehydrate re-stamp is load-bearing and quiet.** It is correct only because an
  active row at rehydrate time is by definition one the server never evicted. If that stops
  being true, sessions silently survive reboots and nothing fails loudly. The code comment says
  so where the code itself cannot.
- **Decision 57 retires a shipped, documented promise** (Ctrl-C leaves you connected). The
  replacement behaviour is correct but arrives one line later than the old one did, which reads
  as a delay rather than a rule unless the plan and the comment both say otherwise.

## Out of scope (recorded, not forgotten)

- **A bricked gateway evicting the sessions already inside it** — the §9 backlog entry with
  three named shapes and a preferred one (lazy re-validation on the next authorized action). It
  is a topology question, not a reboot one, and this slice does not close it. Worth re-reading
  once the boot-id gate exists: the same seam may make the preferred shape cheaper than it was
  when that entry was written.
- **Session TTL / expiry.** v2 sessions still never expire. Reboot is now *an* answer to a
  stale session; it is not a general one.
- **Libraries and firmware as exploit axes** — slices 8 and 9.
- **The boot outcome itself** — `canBoot`, the halt and panic tails, and the brick are
  untouched.
- **Pushing eviction to the evicted player.** Still a pull, as D5 established; nothing here adds
  a channel.

---
*Retire this file into `plans/legacy-parity-epic.md` on close-out, as every completed slice
plan before it was.*
