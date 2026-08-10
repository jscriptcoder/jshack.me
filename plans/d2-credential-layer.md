# D2 split — a player cracks a credential instead of being told it

> **Status: D2.1 ✅ SHIPPED (v0.111.0). D2.2 ✅ SHIPPED (v0.113.0). D2.3 ✅ SHIPPED (v0.114.0).
> D2.5 ✅ SHIPPED (v0.115.0). Both follow-ups ✅ CLOSED — the apt wordlist wipe (v0.116.0) and
> hydra's workstation-only gate (v0.118.0), which also made a box's wordlist belong to the box.
> D2.4 (cross-player hydra) and D2.6 (wordlist growth) remain — and D2.6 may be a characterisation
> test rather than a slice, now that both tools read the file.**
> Authored 2026-07-31 (`story-splitting`), grounded against the shipped code (every file:line
> below was read, not recalled). Parent: [`legacy-parity-epic.md`](./legacy-parity-epic.md)
> Phase 1, D2.
>
> Every shipped plan's file has been deleted on close-out; their as-built lives in
> [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) and in the rows and
> sections below. Findings 1–5 were all confirmed by building them — read them before planning a
> later slice.
>
> **The difficulty curve as shipped** — the whole credential layer reduces to this table, and
> nothing else in the game decides what falls:
>
> | knob | value | measured | role |
> |---|---|---|---|
> | `guest` | 1.00 | 100% | the always-open door; the cross-player loop rests on it |
> | `npcUser` | 0.70 | 70.3% | the routine win: sweep a LAN, get footholds |
> | `gateway` | 0.40 | 37.0-38.9% | the pre-vulnerability route to root, at every depth |
> | `npcRoot` | 0.12 | 11.9% | ~one crackable root per eight-host LAN |
>
> Measured over 2024 generated hosts and 2000 doors per gateway kind. The gateway figures sit
> below the knob because systematically-generated seeds converge slowly — see the population
> warning below before "correcting" one.

## Parent

> **A player can obtain a machine's credentials by attacking it, and can grow that
> ability by harvesting passwords other players and machines leak.**

- **Actor**: any player, as attacker; the box's owner, as defender.
- **Trigger**: `hydra` against a live service, or `john` against a stolen hash.
- **Outcome**: the ssh door — and every later door — opens with something earned in-game.
  Today `ssh` exists but takes a password no player can obtain, so v2's only door is
  decorative outside tests.
- **Current constraint**: this is four capabilities in one hat — a data-file install seam, a
  world-generation policy change, an online cracking tool with its own server seam, and an
  offline one. Planned as a unit it would produce a PR nobody can review.

---

## What the codebase actually says (read 2026-07-31)

Five findings that decide the split. Two of them contradict the cheapest-looking plan.

### 1. `ssh` authenticates **server-side**, across **four** reachability seams

`SshApi` (`v2/src/core/commands/types.ts:372`) is four methods — `authenticate`,
`authenticatePublic`, `authenticateSameLan`, `authenticateInnerGateway` — each backed by its
own signed action in `api/sessions.ts` (`authCreateSession`, `…Public`, `…SameLan`,
`…InnerGateway`). `ssh.ts:5` states it plainly: *"authenticates the password SERVER-side …
the server regenerates the host's `/etc/passwd` and validates."*

**Consequence — this is the cost driver.** hydra must agree with whatever `ssh` would accept,
or the game lies to the player. So hydra is **server-side too**, and it inherits the same
reachability fan-out. That fan-out is the single best splitting axis, and D1 already proved the
shape: own-LAN first, cross-player second.

### 2. `/etc/passwd` is deliberately **not** tier-3 readable — so hydra can't be client-side

`readFilter.ts:61-68` lists the externally-observable allowlist and its comment names the
exclusion outright: *"Everything NOT matching default-denies — /etc/passwd's inline hashes."*

**Consequence**: there is no client-side shortcut, not even for NPC hosts. The client *can*
regenerate an NPC host's baseline `buildRemoteHostFs(essid, host)` locally — `nmap` does — but
that baseline diverges from truth the moment anyone patches `/etc/passwd`, and the server holds
the patches. Cracking from the local regeneration would produce a password `ssh` then rejects.

### 3. `extraFiles` does not exist yet

`aptPackages.ts:20-24` is `{ name, binaries? }`, and its docstring says `description`/`version`/
`extraFiles` *"land with the future `apt install` command that actually installs them."* That
command shipped (`apt.ts`) — but it writes **binaries only** (`apt.ts:162-171`). There is also
no `/usr/share` anywhere in `workstationFs.ts`.

So the wordlist seam is genuinely net-new: a catalog field, an install-loop step, and a new
directory path. It is small — but it is the hard dependency under both `hydra` and `gobuster`.

### 4. The wordlist must be read as a **file**, or the progression mechanic is stillborn

Decision 6 makes wordlist growth the whole progression: harvest a plaintext → append it → your
coverage widens. That only works if `hydra`/`john` read
`/usr/share/wordlists/passwords.txt` **from the filesystem** at run time, never from an imported
constant. Curation is by `nano` (there is no `>>` — `tokenize.ts` emits `pipe`/`redirect` only).

**This is a design constraint, not a slice.** Get it wrong in the first slice and "grow your
wordlist" is a rewrite rather than a free consequence.

For cross-player cracking the *server* does the matching, and it can read the caller's own
`passwords.txt` from their own persisted patches — no need to ship the list up in the payload,
and no client claim to distrust. Worth confirming at planning.

### 5. The trace is already written, and there are **two** near-duplicate password pools

`formatSshdAuthLine` (`authLog.ts`) already emits `Failed password for <user> from <ip>` and
`Accepted password for …`. A hydra run is N failed lines and maybe one accepted — the format,
the path, the perms and the appender all exist.

And the pools have already forked: `GUEST_PASSWORDS` (`workstationFs.ts:52`, 8 entries) and
`WEAK_PASSWORDS` (`remoteHostFs.ts:91`, 10 entries) overlap heavily and both carry a comment
deferring to *"a later hydra/wordlist epic"*. That epic is this one; the pools converge here.

---

## Recommended first slice — ✔ SHIPPED

> **A player cracks an NPC host on their own LAN and logs into it with what they cracked.**

**Why this first**: it is the only slice that can go first. Nothing else in D2 has a
reachable input — see the ordering trap below. It also lands the two risky unknowns (the
`extraFiles` seam and the server-side crack action) against the *cheapest* target, the one
decision 4 already picked: a generated NPC host on the shared LAN, verifiable with one
identity and no second browser session.

### ⚠️ Ordering trap — `john` cannot go first

`john` looks like the cheap opener: no server, no network, a hash in hand. But **there are no
reachable hashes until hydra opens a door.** A player is only ever on their own box, whose
passwords they already know; `/etc/passwd` is off the tier-3 allowlist (finding 2), and the AP
gateway's is root-only and one line. `john` is gated behind the first successful login, so it
lands *after* hydra, not before.

---

## Split candidates

| # | Slice | Value | Includes | Defers | Acceptance examples | Release constraint |
|---|---|---|---|---|---|---|
| **D2.1** ✔ | **A player cracks an NPC host on their own LAN and logs in with it** — **SHIPPED v0.111.0** (#351 `4627621`, #352 `b227a0b`) | The first credential earned in-game. Turns `ssh` from decorative into playable | `extraFiles` on `AptPackage` + apt's install loop writes them; `/usr/share/wordlists/passwords.txt` shipped by `apt install hydra`; `hydra <host> [service] [user]` streaming like `aircrack`; a signed same-LAN crack action mirroring `authCreateSessionSameLan`'s reachability; hydra reads the **file** (finding 4) | Every other reachability; the two-pool policy; the defender's trace; `john` | `apt install hydra` → `cat /usr/share/wordlists/passwords.txt` lists words → `hydra 192.168.x.y ssh` → prints a cracked account → `ssh` with it **succeeds** → a wrong password still fails | **Demo-quality, not ship-quality** — with one flat pool, *everything* cracks. See the open question |
| **D2.2** ✔ | **Not every account falls** — **SHIPPED v0.113.0** (#354 `f9ad49b`, #356 `3af0b92`, #357 `f69b05d`) | The difficulty curve — decision 6's "crackable is membership in *your* wordlist", made real | `core/generation/passwordPools.ts` owns one crackable pool, one uncrackable pool (behind `secrets.ts` → `__encoded.ts`), the `CRACK_CHANCE` table and `drawPassword`; `WEAK_PASSWORDS`, `GUEST_PASSWORDS` and `ROUTER_ADMIN_PASSWORDS` all retired into it | — | A day-one root crack happens but is rare across a scanned LAN; a player's chosen workstation root password **never** cracks; guest always does | Shipped. Re-rolled the generated world (free pre-launch) |
| **D2.3** ✔ | **The defender sees the attempt** — **SHIPPED v0.114.0** (#358 `bae79f8`) | The attacker stops being invisible. Same actor-flip that made D1's slice 4 worth its own PR | One `Failed password for <user> from <ip>` per password **TRIED** plus the accepted line, into the target's `/var/log/auth.log`; owner-keyed writer; one append per sweep; client-supplied source IP, matching `ssh` on the LAN | Rate limiting; lockout; alerting; cross-player (D2.4) | A runs `hydra` at an NPC host; the box's `auth.log` shows the failed sweep and the one success, at the attacker's real LAN IP | Shipped |
| **D2.4** | **A player cracks a stranger's box across the network** | Cracking reaches other players — the epic's actual point | hydra over the `public` and `innerGateway` reachability seams, matching `ssh`'s remaining variants; server reads the caller's own wordlist from their persisted patches | — | B `hydra <A's public IP> ssh` → cracks A's **guest** account → `ssh` in → A's `auth.log` carries the sweep | Ships. **Needs a `scripts/test*.ts` wire-check** and two identities |
| **D2.5** ✔ | **A player cracks a stolen hash offline** — **SHIPPED v0.115.0** (#359 `aa70cfc`) | Loot becomes capability, and the **silent** way to do it now that D2.3 made the sweep loud | `john <file>`; reads the file AND the shared wordlist from the current machine; no server call at all | Hash formats beyond md5; `--show`; pot file; bare-hash arguments | B ssh's into a cracked NPC box as a **user**-tier account (guest cannot read passwd — finding 1) → `cat /etc/passwd` → carries the rows home → `john hashes.txt` → plaintext → `su root` succeeds | Shipped |
| **D2.6** | **A player grows their wordlist and cracks what they could not before** | Decision 6's progression loop, closed | Harvest → `nano` append → the previously-failing crack now succeeds. **Probably free** if D2.1 honours finding 4 | — | A password harvested from box X is appended by hand, and box Y — which drew the same password — now cracks | Ships |

### D2.6 may be an acceptance test, not a slice

If `hydra` and `john` read the file rather than a constant, D2.6 is already true the moment
D2.5 lands, and it collapses into a characterisation test plus a docs line. **Do not plan it
until D2.5 is green** — planning it as a slice up front invents work that finding 4 gives away.

---

## Warnings

- ✅ **`gobuster` is no longer in D2 — it is D1c** (decision 2 above). The epic originally
  sited it here because it needs the same `extraFiles` seam, but that seam is *all* it shares:
  gobuster brute-forces **paths**, not credentials, its target is D1's web surface, and its
  whole defender-side tell is a wall of 404s in the `access.log` D1 just built. **D2.1 shipped
  that seam** (`AptPackage.extraFiles`), so D1c is unblocked and can be picked up at any time.
- ✅ **Do not let hydra read a constant.** Finding 4. It is the difference between decision 6's
  progression loop being free and being a rewrite. **Honoured in D2.1** — the server reads
  `/usr/share/wordlists/passwords.txt` from the caller's own journal, per run. `john` (D2.5) must
  read the same file the same way.
- ⚠️ **hydra must never disagree with `ssh`.** Both must resolve the target's `/etc/passwd`
  the same way, server-side, through the same reachability rules. A hydra that cracks from a
  locally regenerated baseline will hand the player a password `ssh` then rejects — and the
  player will read that as a broken game, not a stale cache.
- ✅ **The flat-pool interlude is over.** D2.1 shipped a world where every account fell — a
  known-good checkpoint, not a ship point. D2.2 supplied the policy, so a successful crack is now
  evidence about a *rolled* account rather than about everything.
- ⚠️ **A rate is only observable across a POPULATION, and systematic seeds converge slowly.**
  Crackability is decided at generation, so one box proves nothing about a knob. Worse, sampling
  with `NET-0`, `NET-1`, … is not the sample size it looks like: those strings differ by a few
  characters, so their FNV-1a hashes correlate. A 0.40 knob read 35.8-43.5% at 400 doors,
  37.0-38.9% at 2000, and only reached 39.4-40.0% at 20000. **Do not tune a knob to close that
  gap** — a fresh stream's first draw is uniform to within 0.3pp on unrelated seeds. Sample harder
  or widen the band and say why in the test.
- ⚠️ **Decision 7's accepted cost applies from D2.2 onward.** The uncrackable pool rides
  `contentCodec.ts`, which documents itself as *"OBFUSCATION, NOT SECRECY — the key sits in the
  shipped bundle."* A determined reader recovers the pool. Recorded, accepted, revisited at
  multiplayer-hardening — do not re-litigate it inside a slice.

---

## Parking lot

- **Probability knob values** (open branch 5) — tuning, belongs in D2.2's planning, not here.
- **`hydra` against non-ssh services** — each arrives with its own door (ftp with D3, mysql with
  D6, snmp community strings with D8), per the epic. D2 ships the ssh service only.
- **Rate limiting / lockout** as a defender counter-move — not in legacy, not required for
  parity. Post-ship if wanted.
- **Wordlist hardening** (md5 hashes to the client, plaintext server-side) — the epic's recorded
  path if decision 7 ever bites.

---

## Decisions taken at split (owner, 2026-07-31)

1. **D2.2 stays its own slice — the two-pool policy does NOT fold into D2.1.** D2.1 lands the
   server-side crack seam against a world where the answer is always "cracked", so a failure is
   unambiguously the seam's fault rather than a probability roll. The flat-pool interlude is an
   accepted, temporary checkpoint state.
2. **`gobuster` leaves D2 and becomes D1c**, beside `lynx`. It shares only the `extraFiles`
   seam with the credential layer; its target, its content and its trace are all D1's web
   surface. D2.1 still builds the seam — gobuster just consumes it later, from the web epic.

## What D2.2 settled, beyond its own row

**The third pool the split missed is gone.** Planning found that every gateway was already a hydra
target, drawing from an unmentioned `ROUTER_ADMIN_PASSWORDS` whose eight words included two the
shipped wordlist covered — so gateways cracked at a measured 23.8% by pure accident. That is why
D2.2 ran as two slices. `ROUTER_ADMIN_PASSWORDS` no longer exists: its factory defaults were
folded into the single crackable pool and gateways now draw at their own knob.

**One pool pair, not one per door kind.** The plan called for themed crackable/uncrackable halves
for routers. Review killed both: the uncrackable half is invisible until harvested (so its flavour
buys nothing observable, and a second one would split wordlist growth into two progressions), and
once that half is shared, a separate crackable half makes the two pool pairs identical. The
abstraction collapsed to `drawPassword(prng, crackChance)` over two module-level pools. Cost: a
cracked gateway can print `sunshine` rather than `netgear`. Cheap to reverse pre-launch.

**✅ The `__encoded.ts` server-side risk is discharged.** Decision 7 put the uncrackable pool in
the gitignored, build-generated `__encoded.ts`, and D2.2 was the first time that file crossed to
the server (`api/sessions.ts` → `hydraCrack` / `authCreateSession` → `remoteHostFs`). The failure
mode would have been a runtime import error in production only, invisible to every local gate.
Proved rather than reasoned: `__encoded.ts` deleted, `npm run build` regenerated it via `prebuild`,
and a grep of the bundle found the uncrackable pool **0 times** against a crackable control word at
**2**. Wire-checks then passed live — `testHydraOwnLan.ts` 11/11 and `testInnerGatewayReach.ts`
8/8, the latter authenticating as root on an inner *and* a deep child gateway.

## D2.5 grounding, read 2026-08-09 — two findings, and the second reorders the split

Both verified in the shipped code before writing a line of `john`. The first corrects D2.5's
acceptance example; the second questions whether D2.5 should go next at all.

### 1. The split's own acceptance example cannot happen — **guest cannot read `/etc/passwd`**

`baseFs.ts:26-32` sets the file to `read: ['root', 'user']` and says why outright: *"passwords
live inline (no /etc/shadow), so leaking passwd is a real privilege boundary; guest must not read
it."* Row D2.5 reads *"B is `guest` on a cracked NPC box → `cat /etc/passwd`"* — that `cat` is
denied. The loot path is a cracked **user** account (`npcUser`, 0.70), never a guest one, so
`john` sits behind the routine hydra win rather than the guaranteed one. **Rewrite the row before
planning.**

### 2. `john` as specified cracks nothing hydra has not already cracked

`hydraCrack.ts:176` sweeps `accountsIn(hostFs)` — *every* account in the target's passwd — against
the caller's own wordlist whenever no username is given. `john` would match the same hashes,
against the same file, with the same `md5`. For any host a player can hydra, the two return an
identical set of plaintexts: `john <hash from that host>` is a slower way to read what hydra
already printed.

And today there is no hash hydra cannot reach:

- NPC hosts carry no loot file — `remoteHostFs.ts:180-210` is passwd, empty logs, pidfiles and an
  optional `index.html`, nothing else.
- The AP gateway's passwd is root-only and one line.
- A cross-player box only ever yields a **guest** session, which finding 1 blocks from reading
  passwd at all.

So the split's stated reason for D2.5 — *"root accounts genuinely hold, so a stolen root hash is a
real next move"* — does not survive contact with the code. When root holds, it holds against
`john` too: same wordlist, same hash function. D2.2 changed how often a root falls; it did not give
`john` anything hydra lacks.

**What would make `john` non-redundant**, one of:

- **Ship D2.3 first.** `hydraCrack.ts` deliberately writes no trace *yet* (its own docstring:
  *"NOT here: the attempt's auth.log trace … the defender's view of it is its own slice"*). Once a
  sweep costs the attacker a visible `Failed password` wall, `john` becomes the **silent**
  alternative — and its value is legible with no new content and no new generation.
- **Generate loot hydra cannot reach** — a hash in a file rather than in a live host's passwd
  (legacy's `john /tmp/backup_hashes.txt`). That is new generated content and a slice of its own.

### Also confirmed while grounding

- **`john` is already an apt package** (`aptPackages.ts:49`, binary only) — the `command not
  found. Install with: apt install john` path works today; only the command is missing.
- **`su` is fully shipped** (`su.ts`), prompts, and compares `md5(typed)` against the passwd hash
  (`su.ts:201`) — so the hash → plaintext → `su root` chain needs nothing but `john` itself.
- **`>` redirect exists** (`shell/pipeline.ts`, `shell/runLine.ts`), so a player *can* park looted
  rows in a file on their own box without `scp`. Legacy's `john <file>` shape stays open.
- **`john` must be localhost-only in practice**: the wordlist is a patch on the player's own box
  (`hydraCrack.ts:161`), so standing on a remote host there is no list to read.

## What D2.3 settled, beyond its own row

**The trace is per password TRIED, and that was the whole decision.** One summary line per account
would have made a three-account sweep quieter than three ordinary ssh logins. A default wordlist is
~37 words against 3 accounts, so one sweep now writes ~110 lines — as a single append, not 110 — and
repeat sweeps grow the log without bound. That is the attacker's cost made visible and it is what
`john` will buy its way out of. Unbounded growth is accepted, not overlooked.

**The source IP is client-supplied here, deliberately.** The split's row said "server-derived", but
that would have made hydra disagree with `ssh`, which uses `payload.source_ip` for a same-LAN login
(`authCreateSession.ts:196`). Only the cross-player writers use the server-authoritative
`resolveCrossPlayerSourceIp`. On your own generated LAN the occupant is an NPC and there is nobody
to frame — consistency with `ssh` is worth more than purity. **D2.4 must switch to server
derivation**, where the box belongs to another player.

**Log exactly what was attempted.** Unreachable, serviceless, bricked, and no-wordlist all write
nothing. One stateable rule, and it stops a dead machine being probed through its own log.

**Seven copies of the same appender now exist.** `recordSweep` joined `authCreateSession`,
`…SameLan`, `…Public`, `…InnerGateway` and `authElevateSession` in hand-rolling the same
best-effort `appendMachineLog` call. Extraction is earned by the codebase and was deliberately kept
out of D2.3 — it would open six files that behaviour change had no reason to touch. **Open
follow-up**, pure behaviour-preserving.

## Locked decision (owner, 2026-08-09) — tools run where you stand

**`hydra`, `john` and `apt install` must all work on an NPC box, and a player must be able to
carry things from their home box onto one.** The player's machine is a place they operate *from*,
not the only place the toolchain exists. Ordinary tier gates still apply — `apt` needs root on
whatever box you are standing on, exactly as real apt does — but there is to be no "this is not
your machine" refusal on top of them.

**The shipped code contradicted this in one place, and no longer does** (✅ v0.118.0). hydra gated
the whole command on `isOwnWorkstation`, at both ends — the client refused outright and the server
re-checked the `caller_machine_id` the client passed. Lifting it was a behaviour change with a
server half, so it went as its own slice rather than a line in D2.5; see "What lifting hydra's gate
settled" below.

**What this settles for D2.5 right now**: `john` must NOT copy hydra's gate. It reads
`/usr/share/wordlists/passwords.txt` through the ordinary filesystem view of the CURRENT machine.
On the player's own box that is their list; on an NPC box it is "no wordlist here" until they can
bring one over. No special-casing, and the principle costs nothing to honour today.

**Deferred, not dropped**: carrying the list to an NPC box needs `scp` (D3 — `ftp` is a catalog
entry at `aptPackages.ts:51` with no command behind it, and there is no `scp` at all). Sequencing
that is a separate conversation.

## Locked decision (owner, 2026-08-09) — an NPC box is one box, and tier is the only lens

**Everything on an NPC machine is shared. What a player sees there is decided by their user type
on that box, never by who wrote it: B as root sees exactly what A as root sees, B as guest exactly
what A as guest sees.** A wordlist A leaves on a box A rooted is loot for whoever roots it next —
deliberately. Writes stay root-gated (`WORDLIST_PERMISSIONS.write: ['root']`), so growing a shared
list is still a considered act rather than a side effect of walking through.

**This is already how the world works everywhere except one read.** The journal is keyed by
machine and read by machine — `listPatches` is *"scoped to the MACHINE … not to a writer, so every
writer's rows on that machine come back"* (`listPatches.ts:9-12`), gated on holding a session
there; `materializeMachineFs` replays every writer's rows chronologically, latest write per path
winning. The tier lens is the ordinary filesystem permission model on top of that tree. So a player
standing on a box already sees the shared truth of it, filtered by their tier.

**The one divergence was hydra's server-side wordlist read**, which filtered on the CALLER's
`writer_key` — invisible only because a player is the sole writer on their own workstation. It is
**fixed** (v0.117.0): the read takes the machine's rows and replays them, so hydra agrees with `cat`
by construction rather than by a second resolver staying in step. Had the gate been lifted first, a
player would have `cat`-ed a wordlist plainly on screen while hydra answered *"no wordlist"*.

**One scope limit stands.** The rule reaches NPC boxes and gateways, not other players'
workstations — standing on one is refused (`caller_not_on_lan`), because the server cannot place it
on your LAN to derive an honest source address. D2.4 is where that changes.

**The wordlist itself needs no tier branch.** `WORDLIST_PERMISSIONS` is
`read: ['root', 'user', 'guest']` (`defaultWordlist.ts:34-38`) — every tier may read it, which is
what lets a guest-tier tool consult one. The tier lens governs the *rule*; for this particular file
it resolves to "everyone standing here".

## Locked decision (owner, 2026-08-09) — a player's box is a box too

**A wordlist on another player's machine is an ordinary file on that machine.** If B is standing on
A's box and adds words, edits, corrupts or deletes the list, then that is what gets read there —
by B, by A, by whoever stands there next — exactly as for any other file with changes. There is no
"whose list is this" question to answer: the machine owns its journal, and the tier you hold decides
what you may do to it. The NPC rule above was never NPC-specific; **every** box is one box.

**Grounded 2026-08-09 — the read already does this, and the write is already gated correctly.**
Verified in the shipped code, not recalled:

- `hydraCrack.ts:296-307` reads `caller_machine_id`'s rows at `WORDLIST_PATH` and replays every
  writer's, last write winning, a deletion reading as absent. No writer scoping, no ownership
  scoping — it does not know or care whose box it is. **So the rule needs no new mechanism.**
- Writes are constrained server-side, not just in the UI: `upsertPatch.ts:171-182` runs
  `enforceRemoteWriteL2`, which limits a remote write to the login's tier, and
  `WORDLIST_PERMISSIONS.write` is `['root']` (`defaultWordlist.ts:34-38`).

**So what B can actually do on A's box falls out of the difficulty curve rather than a rule.** A
cross-player ssh grants the account's own tier (`authCreateSessionPublic.ts:353`), and on a player's
workstation root and user are player-chosen — never crackable — while guest is the always-open door.
B therefore lands as **guest**: free to *read* A's curated wordlist and attack with it, unable to
touch it. Corrupting A's list needs root on A's box, which means harvesting A's root password
somewhere and `su`-ing — a real achievement, not a walk-in. That is the intended shape, and it
arrives free.

**Two consequences worth naming.** A's curated wordlist becomes a weapon for whoever stands on A's
box — the same loot logic as an NPC box, now pointed at a player. And A can pre-emptively `rm` their
own list so an intruder finds no tool there, which is an emergent defensive move nobody designed.
Both are accepted.

**What this leaves for D2.4**: only the *standing* check. `hydraCrack.ts:263` refuses any caller it
cannot place on the generated LAN (`caller_not_on_lan`), and another player's workstation is not a
host on your LAN. Lifting that means deriving the address the server-authoritative way — which D2.4
owed anyway (D2.3's note). One change, not two.

## What D2.5 settled, beyond its own row

**`john`'s argument is a FILE, and that choice is load-bearing for later.** `john <file>` is legacy
parity, it works today by copy-paste (`cat /etc/passwd` on the cracked box → `nano` at home), and it
is the *same* command the player will run standing *on* an NPC box once `scp` lets the wordlist
travel. One shape serves both, so nothing has to be redesigned. A bare-hash argument was rejected
for exactly that reason — it is a second shape the end-state does not want.

**One wordlist, not one per tool.** `john` ships no `extraFiles` of its own and reads the shared
`/usr/share/wordlists/passwords.txt` that `apt install hydra` installs. Two lists would split
D2.6's progression into two, and a second package writing the same path would be a second way to
trigger the `apt` bug below.

**`john` needs no gate, and that is the whole cost of the "tools run where you stand" principle.**
It reads the current machine through `env.fs`, so it works on any box that has a wordlist on it,
with no `isOwnWorkstation` check to write now or remove later. Contrast hydra, which still refuses.

**`AvailabilityRule` is declared on ten commands and read by nothing.** `types.ts:632` defines
`localhost-only` / `any-machine` / `installed-package`; `registry.ts` wraps only with
`wrapWithBinaryCheck` + `wrapWithLibraryCheck`, and no test asserts a behavioural consequence. So
`apt` is *declared* `localhost-only` yet already runs on NPC boxes gated only by root — the
principle was half-true already — and hydra's real restriction is its hand-written check, not its
declaration. Either enforce the field or delete it; it is a reduction candidate, not a behaviour
change.

**Mutation: 109 mutants, 84 killed, 25 survived — all 25 inside the declarative `manual` block**
(survivors start at line 151; the last executable line is 147). 84/84 logic mutants killed. Three
real gaps the first run (70.8%) exposed:

1. **A blank-line filter that was dead** against the missing-hash guard downstream — a blank line
   has no `:`, so six mutants over it survived. The comment half *was* load-bearing, but only for a
   comment containing a colon, which no test had.
2. **`cracked += 1` → `-= 1` survived** because `toContain('1/2 …')` also matches `'-1/2 …'`. A
   substring assertion cannot catch a sign error; the fix was one test asserting the complete line
   sequence, which also killed both unasserted blank separators.
3. **`username === undefined` was dead code** — `String.split` always returns at least one element.
   Verified not type-required with `tsc -b --force`, then deleted rather than filed as equivalent.

**Read a survivor's `location` span before blaming the harness.** Stryker mutates sub-expressions
and reports only the swapped fragment, so a `=> "false"` on a two-operand condition replaced just
the first operand. Hand-testing the whole condition as `if (false)` killed it and looked like a
false positive twice over. It was not. Recorded in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §4.

## What lifting hydra's gate settled, beyond its own row — SHIPPED v0.118.0 (#370 `aea2450`)

**The wordlist read was the codebase's only writer-scoped view of a machine.** Everything else —
`listPatches`, `materializeMachineFs`, the permission model on top — is machine-scoped and lensed by
the tier you hold there. hydra alone read the caller's own row, which nobody could notice while a
player was the sole writer on their own workstation. Fixing that read FIRST is why no version ever
shipped where `cat` displayed a wordlist the sweep denied existed.

**The replacement rule already existed.** `authorizeMachineAccess` — own workstation, or an active
session on the machine — is what `upsertPatch` / `listPatches` / `removePatch` already use, and it
hands back the session's `userType` and `essid`. So the slice **removed** a bespoke check rather than
adding one, and a sweep and a write from one shell can no longer disagree about where the player is
standing.

**A caller the server cannot place on the LAN is refused, not traced** (`caller_not_on_lan`). There
is no address to record for a deep-chain box or another player's workstation, and a guessed origin
in a defender's log is worse than a refusal now that the log is an attack's whole visible cost.
Nothing regressed: those boxes could not run hydra at all before.

**`env.network` inside a remote session is the PLAYER's connectivity, not the box's**
(`ui/env.ts:179-192` reads one global `connectivity()`). The essid that falls out is still correct —
it is the LAN whose hosts you can reach — but `wlan0.ipv4` is the workstation's address. That is why
the source IP had to be derived server-side inside the same slice rather than after it, and it is a
trap for any future command that reads `env.network` from a hop.

**Wire-check 23/23 live**, including all five new checks: a stranger's wordlist used,
newest-row-wins across writers, a sweep launched from a session-backed LAN box, the trace naming
that box and never the workstation, and an unplaceable caller refused with no trace written. The
line that run produced is the whole feature in one string — signed on a workstation at
`192.168.1.50`, launched from `192.168.204.4`, and what landed on the target reads
`Accepted password for root from 192.168.204.4`.

## Next step

**D2.4 slices 1-4 SHIPPED; slice 5 and D2.6 remain.** Slices 1-2 of
[`d2-4-cross-player-hydra.md`](./d2-4-cross-player-hydra.md) landed 2026-08-09 (v0.119.0, #371
`9b431d7`); slice 3 on 2026-08-10 (v0.120.0, #374 `8838aaf`) — read its grounding before touching
the row above, which its finding 1 corrects — and slice 4 the same day (v0.121.0, #375 `f6748da`).

**What shipped**: one shared resolver (`core/network/resolvePublicTarget`) decides what a public IP
and port reach, so `ssh` and `hydra` cannot disagree about a cross-player target by construction;
`hydra <a stranger's public IP>` sweeps the access point's gateway; and `hydra -p <forwarded port>`
reaches the OCCUPANT behind a NAT forward — the row's real acceptance example. The sweep-and-trace
rule moved to `core/wordlist/passwordSweep`, shared by both hydra paths, because a second copy of
"an account falls iff its password is a word in the file" would become a second difficulty curve.

**What that settled**: a public IP's DEFAULT port reaches the AP GATEWAY, not the owner's
workstation (`machineServing` routes by port before any occupancy work). The split's row said
"cracks A's guest account"; that needed a NAT-forwarded port, which slice 3 delivered — and with it
the rule that behind a public IP the PORT is the address, so a service must be matched against what
that port actually reaches and a result must report the port the caller named. Both directions were
live defects; the as-built is in
[`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §1.

**The row above is now fully delivered**: a player's guest account falls to a cross-player crack,
their chosen root password does not.

Still carried over:

- ✅ **Server-derived vantage LANDED in slice 4** (D2.3's note, discharged). The derivation was
  already sitting in the handler: `authorizeMachineAccess` returns the active session's `essid` — the
  network the standing box was generated from, stamped server-side at hop time — and
  `hydraCrackPublic` read only `.ok` from it. So `caller_not_on_lan` was a stand-in for a lookup, and
  the slice **removed** it rather than replacing it. `resolveVantageSourceIp` now answers "which
  network is this actor operating on", with the owner-key lookup as the own-workstation branch. A
  deep-chain box is placed for free by the same route. Proven live: a sweep launched from a box on a
  third party's network is logged at that network's address, with the attacker's own appearing
  nowhere.
- **`ssh` and `nmap` do not pivot yet** — the seam slice 4 opened and did not close. Neither
  `authCreateSessionPublic` nor `resolvePublicScan` carries a `caller_machine_id`, so they cannot
  derive a vantage even in principle and still trace to the actor's home. One shell on a rooted box
  gives a hydra trace pointing at the pivot and an `ssh` trace pointing at the attacker — a
  tools-disagree seam of exactly the kind this epic exists to close. Its own slice; the seam is
  already shaped for it, the client half is the work.
- ✅ **Slice 5 stays, its own PR, after slice 4** — settled 2026-08-10. The deep layer is furnished
  and sealed: every deep host force-runs sshd and carries a `guest` drawn at `CRACK_CHANCE.guest =
  1`, yet deep IPs are absent from `generateHomeLan().hosts`, so the only entrance is
  `ssh -p <fwd> <inner gateway>` and the gateway holds forwards, not credentials. There is no way in
  game to obtain a deep host's password. The earlier "nothing down there a player cannot already
  reach" reasoning was about loot; the problem is access, and it is total. (A first answer here also
  had slice 5 paying for the deep-chain vantage. Corrected the same day: slice 4's session-essid
  derivation places a deep box for free, so slice 5 inherits it.)
- **The shared-wordlist RULE already reaches players' boxes; the standing check does not.** The
  read is machine-scoped and ownership-blind already (see the locked decision above), so D2.4 owes
  no wordlist work — only the `caller_not_on_lan` refusal, which is the same line that must derive
  the address anyway. One change over one handler, not two passes.
- **D2.6 may be a characterisation test, not a slice.** Both tools now read the FILE rather than a
  constant, which is the condition the split named. Confirm before planning it as work.
- ✅ **`api/sessions.ts` was half supabase dep builders** and every hydra seam added more. Collapsed
  before slice 3 as a terminal reduction (#372, `1b2626d`): 43 builder closures → 13 declarations,
  six spellings of the journal column list → one. Slice 3 now calls a factory instead of pasting a
  tenth copy. As-built in
  [`conventions-and-gotchas.md`](../v2/docs/conventions-and-gotchas.md) §5.
- ✅ **The NAT-forward path was never broken.** `testRouterBrick` and `testCrossPlayerRouter` were
  red in a way that read like a forward regression; the cause was a wire-check whose fixture
  silently failed to seed (`network_public_ips` is keyed on essid, cleaned up by public_ip, and the
  rejected insert was swallowed). Fixed in #373 (`1b5ea4f`) — all 32 wire-checks green.

**Follow-ups, both closed:**

1. ✅ **`apt install` no longer overwrites a data file that is already there** — FIXED (v0.116.0).
   A shipped data file becomes the player's the moment it lands, so a reinstall keeps their copy
   and says so. Deliberately per-FILE rather than an already-installed short-circuit: both `hydra`
   and `john` tell a player with no wordlist to reinstall hydra to get one back, so an absent file
   is still written and that recovery keeps working. The same shape `installPackageLibraries`
   already used for `/lib/*.so` (`apt.ts:111`).
2. ✅ **hydra's workstation-only gate is lifted** — SHIPPED (v0.118.0, #370 `aea2450`), as two
   slices: the wordlist read first, the gate second, so the contradiction between `cat` and the
   sweep was never reachable in a shipped version. See the section above; the slice plan is deleted.

**Still open, unowned:** `AvailabilityRule` is declared on ten commands and read by nothing. hydra's
declaration is now truthful (`any-machine`), but the field remains inert — enforce it or delete it.
A reduction candidate, not a behaviour change.

Per the epic, before any code in a slice: load `tdd`, `testing`, `mutation-testing`,
`refactoring`; run full RED-GREEN-MUTATE-KILL MUTANTS-REFACTOR; present before the next slice
starts.

### ⚠️ Known gaps left behind, worth a short PR

D2.2's honest mutation run (once a raised timeout stopped scoring timeouts as kills) exposed **9
genuine survivors in code it never touched**: the `RULES_V4_SEED` / `ACL_CONF_SEED` header lines
and their `join('\n')` separator, and `buildDeepSwitchBaseFs`'s config subtree mutating to `{}`.
The tests assert those files *parse*, so blanking the header a player reads with `cat`, or building
a deep switch with no `acl.conf`, goes unnoticed. Not blocking anything; small and well understood.

---
*Split artifact. Delete once every slice above is shipped or re-sited.*
